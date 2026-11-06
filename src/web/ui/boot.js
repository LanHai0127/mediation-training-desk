// boot.js · 首屏浮空看板（最终形态提示词 §1）
// -----------------------------------------------------------------------------
// 首屏只剩一块 3D 板：「开始调解」。它悬在值班室上空，点击即进加载页。
// 画面里没有一个 DOM 按钮或文字面板 —— 文字全部现画在 canvas 上做贴图，
// 材质一律 toneMapped:false，保证奶油白 #fff3d7 与墨色 #355364 走到屏幕上不走样。
//
// 三条实现纪律：
//   ① 视差只动「看板组的旋转 + 每块板自己的局部纵深」，绝不平移整组（§1.2 明令禁止）；
//   ② 相机只有一个主人：flight.js。开场运镜的每一个采样点都通过 flight.to() 下发，
//      最后一段交回 flight.follow()，boot 自己从不直接写 camera；
//   ③ update(dt) 只吃真实秒数，掉帧不会让运镜变快或变慢。
//
// 用法：
//   import { createBoot } from "./boot.js";
//   const boot = createBoot({
//     camera, flight, dom: renderer.domElement,
//     onStart,
//     scene,                        // 可选：给了就自动 add，没给就宿主自己 scene.add(boot.group)
//     actorPos: { x: 0.9, z: 2.6 }, // 可选：主角位置，决定 flight.follow() 的落点
//     facing: 0                     // 可选：主角朝向
//   });
//   每帧： boot.update(dt)          卸载： boot.dispose()
//
// 返回：
//   { group, scene, start, skip, reset, update(dt), dispose,
//     introActive, introDone, hovered, progress, layout() }
//   layout() 读的是这块板的真实世界坐标（验收脚本对着 0 / 5.0 核）。
//
// 前置条件：点「开始调解」时，相机应该已经在 BOARD 位（宿主先 flight.to("BOARD")），
// 否则贝塞尔会从相机当前所在的位置起飞。
//
// 兼容性约定：flight.follow(p, f, opts) 会读内部 state.yaw（BOARD 下恒为 0），
// 所以开场运镜的落点按 state.yaw = 0 预算，与 follow() 的换算逐位一致，落定不跳。
// -----------------------------------------------------------------------------
import * as THREE from "../scenes/vendor/three.module.min.js";
import { PAL } from "../scenes/kit.js";

// ---------------------------------------------------------------- 尺寸与阈值
// 首屏只有一块板：比原来的四块板主视觉略大（3.6 × 2.0），重心仍在画面中央。
const W = 3.6;                    // 看板宽（世界单位）
const H = 2.0;                    // 看板高
const D = 0.08;                   // 看板厚
const GROUP_Y = 4.9;              // 看板组原点 = 这块板的形心高度

const YAW_AMP = 0.35;             // 视差：偏航上限（弧度，§1.2 的 ±0.35）
const PITCH_AMP = 0.18;           // 视差：俯仰上限（§1.2：±0.18，刻意比偏航小，防晕）
const DAMP = 0.08;                // 视差阻尼（60fps 下的每帧插值系数）
const SEC_K = 0.4;                // 二级视差幅度：看板组再叠 0.4 倍（§1.2）
const SEC_DAMP = 0.045;           // 二级视差阻尼：比主层慢半拍
const IDLE_SEC = 3.0;             // 静止多少秒后回正
const RECENTER = 0.02;            // 回正速度下限（弧度/秒）
const RECENTER_K = 0.03;          // 回正指数系数（约 2 秒归零，慢到不抢眼）
const HOVER_LIFT = 0.12;          // 悬停抬起
const BAR_H = 0.06;               // 暖黄光条高度
const MAX_DT = 0.1;               // 单帧步长上限：切后台回来不会瞬移

const INTRO_TOTAL = 2.4;          // 开场运镜总时长（§1.3）
const INTRO_SCATTER = 0.35;       // 起：散开淡出
const INTRO_BEZIER = 1.65;        // 落：贝塞尔下坠
const INTRO_SETTLE = 0.4;         // 定：flight.follow 收尾
const INTRO_FOV = 42;             // 落定 FOV（38 → 42）

const LAND_DIST = 2.6;            // 落点：主角背后 2.6m（与 flight.follow 默认值一致）
const LAND_H = 1.6;               // 落点：相机高 1.6
const LAND_LOOK_Y = 1.2;          // 落点：看向主角胸口（与 flight.follow 的 lookY 一致）

const SHARD_N = 24;               // 主看板碎裂片数（6 × 4）
const SHARD_SIZE = 0.12;          // 每片 0.12 × 0.12
const SHARD_LIFE = 1.2;           // 碎片 1.2s 内淡出
const SHARD_G = 4.2;              // 碎片重力

const TEX_W = 1024;               // 贴图分辨率：1024 / 3.2 = 320px 每世界单位
const TEX_H = 576;                // 与 3.2 : 1.8 同比例

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- 布局（世界坐标）
// 首屏只留一块板：居中、略微做大，正对相机。z=0 是看板组的正中面。
const LAYOUT = [
  { id: "start", x: 0, wy: 4.9, z: 0, depth: 0.9, tilt: 0, no: "",
    scatter: { x: 0, y: 0.42, z: 0.52 } }
];

// ---------------------------------------------------------------- 画布版式常量

const FONT_SERIF = '"Songti SC","Noto Serif SC","Source Han Serif SC","SimSun",serif';
const FONT_SANS = '"PingFang SC","Microsoft YaHei","Noto Sans SC","Heiti SC",sans-serif';

// ---------------------------------------------------------------- 小工具
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const easeOutCubic = (t) => 1 - (1 - t) * (1 - t) * (1 - t);
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
// 阻尼按 60fps 标定，换帧率手感不变
const dampK = (c, dt) => 1 - Math.pow(1 - c, Math.max(0.0001, dt) * 60);
// 以固定速度逼近目标（回正在指数逼近之外再保一个"看得见的位移"）
function approach(cur, target, step) {
  if (cur < target) { return Math.min(target, cur + step); }
  if (cur > target) { return Math.max(target, cur - step); }
  return target;
}
// 最短有符号角差
function angleDelta(from, to) {
  let d = (to - from) % TAU;
  if (d > Math.PI) { d -= TAU; }
  if (d < -Math.PI) { d += TAU; }
  return d;
}
// 确定性伪随机（碎片方向要能复现，不用 Math.random）
function hash01(i) {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
// 三次贝塞尔
function bezier(p0, p1, p2, p3, t, out) {
  const it = 1 - t;
  const a = it * it * it, b = 3 * it * it * t, c = 3 * it * t * t, d = t * t * t;
  return out.set(
    a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    a * p0.z + b * p1.z + c * p2.z + d * p3.z
  );
}

// ---------------------------------------------------------------- canvas 版式
// 字距要自己排：canvas 的 letterSpacing 在旧浏览器上没有
function spaced(g, text, x, y, gap, align) {
  const chars = Array.from(text);
  if (!chars.length) { return 0; }
  const widths = chars.map((ch) => g.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (chars.length - 1);
  let cx = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
  const prev = g.textAlign;
  g.textAlign = "left";
  for (let i = 0; i < chars.length; i++) {
    g.fillText(chars[i], cx, y);
    cx += widths[i] + gap;
  }
  g.textAlign = prev;
  return total;
}

// 奶油白底 + 墨色描边（1024px 下 3px ≈ 1.5 个屏幕像素的观感）+ 角标
// 角标默认在右上；学习板的上半截会被左右两块板压住，所以它把角标放到右下。
function drawBase(g, w, h, no, bottom) {
  g.clearRect(0, 0, w, h);
  g.fillStyle = PAL.cream;
  g.fillRect(0, 0, w, h);

  g.strokeStyle = PAL.ink;
  g.lineWidth = 3;
  g.globalAlpha = 0.9;
  g.strokeRect(11, 11, w - 22, h - 22);

  // 四角短刻线：给"这是一块牌子"的边界感，不加不显
  g.lineWidth = 5;
  g.globalAlpha = 0.55;
  const L = 26, P = 11;
  const corners = [
    [P, P, 1, 1], [w - P, P, -1, 1], [P, h - P, 1, -1], [w - P, h - P, -1, -1]
  ];
  for (const [cx, cy, sx, sy] of corners) {
    g.beginPath();
    g.moveTo(cx + sx * L, cy);
    g.lineTo(cx, cy);
    g.lineTo(cx, cy + sy * L);
    g.stroke();
  }

  g.textBaseline = "alphabetic";
  g.textAlign = "left";
  g.globalAlpha = 1;

  if (no) {
    g.fillStyle = PAL.ink;
    g.globalAlpha = 0.36;
    g.font = `24px ${FONT_SANS}`;
    g.textAlign = "right";
    g.fillText(no, w - 44, bottom ? h - 34 : 80);
    g.textAlign = "left";
    g.globalAlpha = 1;
  }
}

function drawStart(g, w, h) {
  drawBase(g, w, h, "");

  // 首屏只剩这一块板：文字全部居中，做成一张"开场卡"，而不是四块板里的一个按钮。
  g.fillStyle = PAL.ink;
  g.globalAlpha = 0.42;
  g.font = `22px ${FONT_SANS}`;
  spaced(g, "MEDIATION TRAINING", w / 2, 128, 7, "center");

  g.globalAlpha = 1;
  g.font = `148px ${FONT_SERIF}`;
  spaced(g, "开始调解", w / 2, 330, 18, "center");

  g.globalAlpha = 0.72;
  g.font = `32px ${FONT_SANS}`;
  spaced(g, "基层矛盾纠纷调解训练  ·  十场实景", w / 2, 402, 4, "center");

  // 珊瑚色下划线：全篇唯一的高饱和色，只用来标"这一下可以点"
  g.globalAlpha = 1;
  g.fillStyle = PAL.coral;
  g.fillRect(w / 2 - 190, 438, 380, 7);

  // 底部一行小字：告诉第一次来的人这是入口，而不是标题
  g.globalAlpha = 0.46;
  g.fillStyle = PAL.ink;
  g.font = `24px ${FONT_SANS}`;
  spaced(g, "点这一块，进值班室", w / 2, 508, 6, "center");
  g.globalAlpha = 1;
}

const PAINTERS = { start: drawStart };

// ============================================================================
// 主入口
// ============================================================================
export function createBoot({
  camera,
  flight,
  dom,
  onStart,
  onStartClick,
  scene = null,
  actorPos = { x: 0, z: 0 },
  facing = 0
} = {}) {
  if (!camera) { throw new Error("createBoot: 需要 camera（相机的所有权仍归 flight）"); }

  const actor = actorPos && typeof actorPos.x === "number" && typeof actorPos.z === "number"
    ? actorPos : { x: 0, z: 0 };
  const face = Number.isFinite(facing) ? facing : 0;

  const el = dom || (typeof window !== "undefined" ? window : null);
  const win = typeof window !== "undefined" ? window : null;
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const viewW = () => (typeof window !== "undefined" ? window.innerWidth : 1);
  const viewH = () => (typeof window !== "undefined" ? window.innerHeight : 1);

  // ---------------------------------------------------------------- 状态
  const state = {
    time: 0,
    reveal: 0,               // 首屏浮现进度（0→1，0.55s）
    disposed: false,
    cursor: null,
    cursorPrev: el && el.style ? el.style.cursor : null
  };

  // 视差三层：目标（鼠标）/ 当前（阻尼跟随）/ 二级（慢半拍）
  const par = {
    yaw: 0, pitch: 0,
    secYaw: 0, secPitch: 0,
    baseYaw: 0, basePitch: 0,
    nx: 0, ny: 0,
    active: false,
    idle: IDLE_SEC
  };

  // 悬停：当下命中的看板（「当前案件」板上没有可点的章）
  const hover = { board: null };
  let press = null;
  let shards = [];

  // 开场运镜状态
  const intro = {
    active: false, done: false, fired: false, settled: false, hidden: false,
    t: 0, fov0: 38,
    startPos: new THREE.Vector3(),
    startLook: new THREE.Vector3(),
    landingPos: new THREE.Vector3(),
    landingLook: new THREE.Vector3()
  };
  const P0 = new THREE.Vector3(), P1 = new THREE.Vector3();
  const P2 = new THREE.Vector3(), P3 = new THREE.Vector3();

  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpDir = new THREE.Vector3();
  const shardBase = new THREE.Vector3();
  const _eul = new THREE.Euler();
  const _qBase = new THREE.Quaternion();
  const _qInv = new THREE.Quaternion();
  const _off = new THREE.Vector3();

  // ---------------------------------------------------------------- 场景与相机朝向
  const group = new THREE.Group();
  group.name = "boot-boards";
  group.position.set(0, GROUP_Y, 0);
  group.rotation.order = "YXZ";
  group.scale.setScalar(0.945);
  if (scene && typeof scene.add === "function") { scene.add(group); }

  const basePos = group.position.clone();
  // 碎片挂哪儿：有 scene 就挂世界（重力才是竖直的），没有就退回看板组
  const fxRoot = (scene && typeof scene.add === "function") ? scene : group;

  // 看板永远"朝向相机"：这是 §1.1 的硬要求，也是深度错位能读成"悬在空中"的前提。
  function faceCamera(dt) {
    const dx = camera.position.x - group.position.x;
    const dy = camera.position.y - group.position.y;
    const dz = camera.position.z - group.position.z;
    const horizontal = Math.hypot(dx, dz);
    // 相机还没落位（原点/正上方）时 atan2 会退化成 90°，宁可先不动
    if (horizontal < 0.35) { return; }
    const wantYaw = Math.atan2(dx, dz);
    const wantPitch = -Math.atan2(dy, horizontal);            // YXZ 下 +z 对准相机的俯仰
    const k = dt >= 1 ? 1 : dampK(0.1, dt);
    par.baseYaw += angleDelta(par.baseYaw, wantYaw) * k;
    par.basePitch += (wantPitch - par.basePitch) * k;
  }
  faceCamera(1);

  // 组的朝向由"朝向相机"决定，而布局表写的是世界坐标；
  // 每帧把世界偏移乘上朝向的逆四元数转回局部坐标 —— 静止时这块板的世界高度
  // 就是 5.6 / 4.9 / 4.9 / 4.2，跟提示词一致，不会被整组的俯仰带歪。
  function syncBaseQuat() {
    _eul.set(par.basePitch, par.baseYaw, 0, "YXZ");
    _qBase.setFromEuler(_eul);
    _qInv.copy(_qBase).invert();
  }
  function baseLocal(b, out) {
    return out.set(b.baseX, b.worldY - GROUP_Y, b.baseZ).applyQuaternion(_qInv);
  }
  syncBaseQuat();

  // ---------------------------------------------------------------- 几何（一次建，全实例共享）
  const geo = {
    plate: new THREE.BoxGeometry(W, H, D),
    face: new THREE.PlaneGeometry(W, H),
    shadow: new THREE.PlaneGeometry(W + 0.18, H + 0.18),
    bar: new THREE.BoxGeometry(W * 0.62, BAR_H, 0.02),
    glow: new THREE.PlaneGeometry(W * 0.72, 0.4),
    shard: new THREE.BoxGeometry(SHARD_SIZE, SHARD_SIZE, 0.03)
  };
  const edgeGeo = new THREE.EdgesGeometry(geo.plate);
  const shardEdgeGeo = new THREE.EdgesGeometry(geo.shard);

  // 共享材质：碎片只有一批，同一时刻出生、同一时刻淡完
  const shardMat = new THREE.MeshBasicMaterial({
    color: PAL.cream, transparent: true, opacity: 0, toneMapped: false, depthWrite: false
  });
  const shardEdgeMat = new THREE.LineBasicMaterial({
    color: PAL.ink, transparent: true, opacity: 0
  });

  const C_INK = new THREE.Color(PAL.ink);
  const C_WHITE = new THREE.Color(PAL.white);
  const textures = [];

  function makeTexture(cfg) {
    const c = document.createElement("canvas");
    c.width = TEX_W; c.height = TEX_H;
    const g = c.getContext("2d");
    const painter = PAINTERS[cfg.id] || drawStart;
    painter(g, TEX_W, TEX_H);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    textures.push(t);
    return t;
  }

  // ---------------------------------------------------------------- 建板
  const hitList = [];

  function makeBoard(cfg, index) {
    const pivot = new THREE.Group();
    // 先按"世界 → 组局部"摆到位，免得第一帧出现在错误高度
    _off.set(cfg.x, cfg.wy - GROUP_Y, cfg.z).applyQuaternion(_qInv);
    pivot.position.copy(_off);
    pivot.rotation.z = cfg.tilt;
    group.add(pivot);

    // 板背后的暗边：让奶油白在空气里有一圈"影子"，不然像贴纸
    const shadowMat = new THREE.MeshBasicMaterial({
      color: PAL.dark, transparent: true, opacity: 0.1, toneMapped: false, depthWrite: false
    });
    const shadow = new THREE.Mesh(geo.shadow, shadowMat);
    shadow.position.z = -0.075;
    shadow.renderOrder = 0;
    pivot.add(shadow);

    const plateMat = new THREE.MeshBasicMaterial({
      color: PAL.cream, transparent: true, opacity: 1, toneMapped: false
    });
    const plate = new THREE.Mesh(geo.plate, plateMat);
    plate.renderOrder = 1;
    pivot.add(plate);

    const faceMat = new THREE.MeshBasicMaterial({
      map: makeTexture(cfg), transparent: true, opacity: 1, toneMapped: false, depthWrite: false
    });
    const face = new THREE.Mesh(geo.face, faceMat);
    face.position.z = D / 2 + 0.004;
    face.renderOrder = 2;
    pivot.add(face);

    // 墨色描边：单独一条线，悬停时它负责"变亮"（贴图里的边是死的）
    const edgeMat = new THREE.LineBasicMaterial({
      color: PAL.ink, transparent: true, opacity: 0.5
    });
    const edge = new THREE.LineSegments(edgeGeo, edgeMat);
    edge.renderOrder = 3;
    pivot.add(edge);

    // 悬停才出现的暖黄光条：0.06 高，加法混合，压在板子下沿外
    const barMat = new THREE.MeshBasicMaterial({
      color: PAL.yellow, transparent: true, opacity: 0, toneMapped: false,
      depthWrite: false, blending: THREE.AdditiveBlending
    });
    const bar = new THREE.Mesh(geo.bar, barMat);
    bar.position.set(0, -H / 2 - 0.09, D / 2 + 0.01);
    bar.visible = false;
    bar.renderOrder = 5;
    pivot.add(bar);

    // 光条的柔光：比光条矮胖一点，压低透明度当泛光用
    const glowMat = new THREE.MeshBasicMaterial({
      color: PAL.yellow, transparent: true, opacity: 0, toneMapped: false,
      depthWrite: false, blending: THREE.AdditiveBlending
    });
    const glow = new THREE.Mesh(geo.glow, glowMat);
    glow.position.copy(bar.position);
    glow.position.z -= 0.004;
    glow.renderOrder = 4;
    pivot.add(glow);

    const b = {
      id: cfg.id,
      pivot,
      plate,
      tex: faceMat.map,                    // 「当前案件」板要能原地重画
      baseX: cfg.x, baseZ: cfg.z,
      worldY: cfg.wy,
      tilt: cfg.tilt,
      phase: index * 1.7,
      depthK: 1.25 - cfg.depth * 0.6,            // 0.6 → 0.89（近，动得多）；1.2 → 0.53
      scale: 1 + (0.9 - cfg.depth) * 0.05,       // 近的略微放大、远的略微减小
      hover: 0,
      hoverTarget: 0,
      bar,
      mats: { shadow: shadowMat, plate: plateMat, face: faceMat, edge: edgeMat, bar: barMat, glow: glowMat },
      // 散开方向：只有一块板，让它向相机、向斜上方碎开
      scatterX: (cfg.scatter && cfg.scatter.x) || 0,
      scatterY: (cfg.scatter && cfg.scatter.y) || 0.42,
      scatterZ: (cfg.scatter && cfg.scatter.z) || 0.52,
      spinX: -0.1,
      spinY: 0.08,
      spinZ: 0.16
    };

    plate.userData = { board: b };
    hitList.push(plate);
    return b;
  }

  const boards = LAYOUT.map((cfg, i) => makeBoard(cfg, i));

  // ---------------------------------------------------------------- 上色（透明度 / 描边 / 光条）
  function paintBoard(b, alpha, hov) {
    const a = clamp01(alpha);
    const h = clamp01(hov);
    b.mats.plate.opacity = a;
    b.mats.face.opacity = a;
    b.mats.shadow.opacity = 0.1 * a;
    b.mats.edge.opacity = (0.5 + 0.5 * h) * a;
    b.mats.edge.color.copy(C_INK).lerp(C_WHITE, h * 0.85);
    b.mats.bar.opacity = h * a;
    b.mats.glow.opacity = 0.14 * h * a;
    b.bar.visible = h > 0.004;
  }

  // ---------------------------------------------------------------- 指针
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function setCursor(v) {
    if (!el || !el.style) { return; }
    if (state.cursor === v) { return; }
    state.cursor = v;
    el.style.cursor = v;
  }

  function ndcFromEvent(e) {
    let left = 0, top = 0, w = viewW(), h = viewH();
    if (el && typeof el.getBoundingClientRect === "function") {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) { left = r.left; top = r.top; w = r.width; h = r.height; }
    }
    ndc.set(((e.clientX - left) / w) * 2 - 1, -((e.clientY - top) / h) * 2 + 1);
    return ndc;
  }

  // 射线拾取：相机由 flight 每帧写位置，matrixWorld 可能还停在上一帧，拾取前补一次
  function raycastAt() {
    if (!hitList.length) { return { board: null }; }
    camera.updateMatrixWorld();
    group.updateMatrixWorld(true);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(hitList, false);
    if (!hits.length) { return { board: null }; }
    const u = hits[0].object.userData || {};
    return { board: u.board || null };
  }

  function onMove(e) {
    if (state.disposed) { return; }
    ndcFromEvent(e);
    par.nx = clamp(ndc.x, -1, 1);
    par.ny = clamp(ndc.y, -1, 1);
    par.active = true;
    par.idle = 0;
    if (press) {
      const dx = e.clientX - press.x, dy = e.clientY - press.y;
      if (dx * dx + dy * dy > 81) { press.moved = true; }
    }
  }

  function onLeave() {
    par.active = false;
    par.idle = 0;
    hover.board = null;
    for (const b of boards) { b.hoverTarget = 0; }
    setCursor("");
  }

  function onDown(e) {
    if (state.disposed) { return; }
    if (e.button !== undefined && e.button !== 0) { return; }   // 只认左键/触摸
    if (intro.active) { skipIntro(); press = null; return; }   // 运镜期间点一下就跳过
    if (intro.done) { return; }
    ndcFromEvent(e);
    const hit = raycastAt();
    press = {
      x: e.clientX, y: e.clientY, t: now(),
      board: hit.board, moved: false
    };
  }

  function onUp(e) {
    if (state.disposed || !press) { return; }
    const p = press;
    press = null;
    if (!p.board) { return; }
    const dx = (e.clientX || 0) - p.x, dy = (e.clientY || 0) - p.y;
    if (p.moved || dx * dx + dy * dy > 81) { return; }          // 拖动不算点击
    if (now() - p.t > 700) { return; }
    activate(p);
  }

  function activate(p) {
    const id = p.board && p.board.id;
    // 首屏只剩「开始调解」一块板：其余分支已经随三块板一起删掉。
    if (id === "start") {
      if (typeof onStartClick === "function") { onStartClick(); return; }
      startIntro();
    }
  }

  if (el && typeof el.addEventListener === "function") {
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerleave", onLeave);
  }
  if (win && win.addEventListener) {
    // 抬起挂在 window：在画布外松手也要能收尾，否则 press 会一直挂着
    win.addEventListener("pointerup", onUp);
  }

  // ---------------------------------------------------------------- 视差
  function updateParallax(dt) {
    const live = par.active && par.idle <= IDLE_SEC;
    if (live) {
      // 鼠标 → 目标角：x 控制偏航、y 控制俯仰，幅度封在 ±0.35 / ±0.18
      const wantYaw = par.nx * YAW_AMP;
      const wantPitch = -par.ny * PITCH_AMP;
      const k = dampK(DAMP, dt);
      par.yaw += (wantYaw - par.yaw) * k;
      par.pitch += (wantPitch - par.pitch) * k;
      par.idle += dt;
    } else {
      // 静止 3 秒（或指针离开）：目标归零，先按 3%/帧的指数回正，再保 0.02 弧度/秒的下限
      const k = dampK(RECENTER_K, dt);
      const stepY = Math.max(RECENTER * dt, Math.abs(par.yaw) * k);
      const stepP = Math.max(RECENTER * dt, Math.abs(par.pitch) * k);
      par.yaw = approach(par.yaw, 0, stepY);
      par.pitch = approach(par.pitch, 0, stepP);
      par.idle += dt;
    }

    // 二级视差：再叠 0.4 倍，阻尼更小 → 比主层慢半拍，深度就出来了
    const ks = dampK(SEC_DAMP, dt);
    par.secYaw += (par.yaw * SEC_K - par.secYaw) * ks;
    par.secPitch += (par.pitch * SEC_K - par.secPitch) * ks;
  }

  // ---------------------------------------------------------------- 悬停
  function updateHover() {
    let hit = { board: null };
    if (par.active) {
      hit = raycastAt();
    }
    hover.board = hit.board;
    for (const b of boards) { b.hoverTarget = b === hit.board ? 1 : 0; }
    setCursor(hit.board ? "pointer" : "");
  }

  // ---------------------------------------------------------------- 稳定态：浮动 + 抬起 + 光条
  function applyBoards(dt) {
    // 浮现：0.945 → 1，材料一起淡入，首屏不是"啪"地出现
    state.reveal = Math.min(1, state.reveal + dt / 0.55);
    const reveal = easeOutCubic(state.reveal);

    faceCamera(dt);
    syncBaseQuat();
    group.rotation.set(par.basePitch + par.pitch, par.baseYaw + par.yaw, 0);
    // 只沿视深呼吸（z），横向一律不动 —— "整块平移"是 §1.2 明令禁止的假 3D
    group.position.z = basePos.z + par.pitch * 0.22;
    group.scale.setScalar(0.945 + 0.055 * reveal);

    for (const b of boards) {
      b.hover += (b.hoverTarget - b.hover) * dampK(0.18, dt);
      const lift = b.hover * HOVER_LIFT;
      const bob = Math.sin(state.time * 0.85 + b.phase) * 0.018;

      baseLocal(b, _off);
      b.pivot.position.set(
        _off.x + par.secYaw * 0.1 * b.depthK,
        _off.y + bob + lift,
        _off.z + par.secYaw * 0.14 * b.depthK
      );
      b.pivot.rotation.set(
        par.secPitch * b.depthK,
        par.secYaw * b.depthK,
        b.tilt + Math.sin(state.time * 0.62 + b.phase) * 0.006
      );
      b.pivot.scale.setScalar(b.scale);

      b.bar.scale.x = 0.55 + 0.45 * b.hover;
      paintBoard(b, reveal, b.hover);
    }
  }

  // ---------------------------------------------------------------- 开场运镜
  function landingPoint() {
    const ax = actor.x, az = actor.z, f = face;
    return {
      x: ax - Math.sin(f) * LAND_DIST,
      z: az - Math.cos(f) * LAND_DIST,
      lookX: ax, lookZ: az
    };
  }

  function planIntro() {
    const L = landingPoint();
    intro.landingPos.set(L.x, LAND_H, L.z);
    intro.landingLook.set(L.lookX, LAND_LOOK_Y, L.lookZ);

    intro.startPos.copy(camera.position);
    camera.getWorldDirection(tmpDir);
    intro.startLook.copy(camera.position).addScaledVector(tmpDir, 12);
    intro.fov0 = camera.fov || 38;

    // ① 起：原地后拉 0.6m（只退水平方向，不抬俯角）
    tmpA.set(-tmpDir.x, 0, -tmpDir.z);
    if (tmpA.lengthSq() < 1e-6) { tmpA.set(0, 0, 1); }
    tmpA.normalize().multiplyScalar(0.6);
    P0.copy(intro.startPos).add(tmpA);

    // ② 落：贝塞尔从高处扎进房间，终点压在落点上方 0.3、向相机侧退 0.45
    tmpB.set(intro.landingPos.x - P0.x, 0, intro.landingPos.z - P0.z);
    if (tmpB.lengthSq() < 1e-6) { tmpB.set(0, 0, 1); }
    tmpB.normalize();                                    // 朝屋里（前）
    P3.copy(intro.landingPos).addScaledVector(tmpB, -0.45);
    P3.y = intro.landingPos.y + 0.3;
    P1.copy(P0).addScaledVector(tmpB, 1.5);              // 先往屋里扎
    P1.y = P0.y - 1.0;
    P2.copy(P3).addScaledVector(tmpB, -1.2);             // 最后从上方压下来
    P2.y = P3.y + 3.0;
  }

  function startIntro() {
    if (state.disposed || intro.active || intro.done) { return; }
    planIntro();
    intro.active = true;
    intro.done = false;
    intro.settled = false;
    intro.hidden = false;
    intro.t = 0;
    state.reveal = 1;
    group.scale.setScalar(1);
    par.idle = IDLE_SEC;
    setCursor("");
    spawnShards();

    // 段 1 的相机：交给 flight 补间（它自己会从当前 cur 起算）
    if (flight && typeof flight.to === "function") {
      flight.to({
        pos: [P0.x, P0.y, P0.z],
        look: [intro.startLook.x, intro.startLook.y, intro.startLook.z],
        fov: intro.fov0,
        dur: INTRO_SCATTER,
        ease: "inOutCubic"
      });
    } else {
      // 没有 flight 时退化成自己写相机（只在单模块试跑时用）
      camera.position.copy(P0);
      camera.lookAt(intro.startLook);
    }
  }

  function updateIntro(dt) {
    intro.t += dt;
    const t = intro.t;

    // —— 段 1：0 → 0.35s，这一块板向外散开、透明度 1→0，同时碎成 24 片
    const se = easeOutCubic(clamp01(t / INTRO_SCATTER));
    syncBaseQuat();
    if (!intro.hidden) {
      for (const b of boards) {
        baseLocal(b, _off);
        b.pivot.position.set(
          _off.x + b.scatterX * se,
          _off.y + b.scatterY * se,
          _off.z + b.scatterZ * se
        );
        b.pivot.rotation.set(b.spinX * se, b.spinY * se, b.tilt + b.spinZ * se);
        paintBoard(b, 1 - se, 0);
      }
      if (se >= 1) {
        intro.hidden = true;
        for (const b of boards) { b.pivot.visible = false; }
      }
    }

    updateShards(dt);

    // —— 段 2：0.35 → 2.0s，贝塞尔下坠。
    // flight 只会两点直线补间，所以这里每帧把曲线上的采样点重新下发成一次极短补间，
    // 相机的主人始终是 flight（它内部的 cur 会平滑地追这条曲线）。
    if (t >= INTRO_SCATTER && t <= INTRO_SCATTER + INTRO_BEZIER) {
      const raw = clamp01((t - INTRO_SCATTER) / INTRO_BEZIER);
      const k = easeInOutCubic(raw);
      bezier(P0, P1, P2, P3, k, tmpA);
      tmpB.copy(intro.startLook).lerp(intro.landingLook, k);
      const fov = intro.fov0 + (INTRO_FOV - intro.fov0) * k;

      if (flight && typeof flight.to === "function") {
        flight.to({
          pos: [tmpA.x, tmpA.y, tmpA.z],
          look: [tmpB.x, tmpB.y, tmpB.z],
          fov,
          dur: Math.max(0.024, dt * 2),
          ease: "linear"
        });
      } else {
        camera.position.copy(tmpA);
        camera.lookAt(tmpB);
        if (Math.abs(camera.fov - fov) > 0.01) {
          camera.fov = fov;
          camera.updateProjectionMatrix();
        }
      }
    }

    // —— 段 3：2.0s 交给 flight.follow 做 0.4s easeOutCubic 落定
    if (!intro.settled && t >= INTRO_SCATTER + INTRO_BEZIER) {
      intro.settled = true;
      if (flight && typeof flight.follow === "function") {
        flight.follow(actor, face, {
          dist: LAND_DIST, height: LAND_H, dur: INTRO_SETTLE, ease: "outCubic"
        });
      } else {
        camera.position.copy(intro.landingPos);
        camera.lookAt(intro.landingLook);
        if (Math.abs(camera.fov - INTRO_FOV) > 0.01) {
          camera.fov = INTRO_FOV;
          camera.updateProjectionMatrix();
        }
      }
    }

    if (t >= INTRO_TOTAL) { finishIntro(); }
  }

  function hideBoards() {
    for (const b of boards) {
      b.pivot.visible = false;
      paintBoard(b, 0, 0);
    }
    hover.board = null;
  }

  function finishIntro() {
    if (!intro.active) { return; }
    intro.active = false;
    intro.done = true;
    intro.t = INTRO_TOTAL;
    hideBoards();
    clearShards();
    setCursor("");
    if (!intro.fired) {
      intro.fired = true;
      if (typeof onStart === "function") { onStart(); }
    }
  }

  // 运镜期间点一下 = 跳过（§1.3：跳到"定"段末尾）
  function skipIntro() {
    if (!intro.active) { return; }
    if (flight && typeof flight.follow === "function") {
      flight.follow(actor, face, {
        dist: LAND_DIST, height: LAND_H, dur: 0.18, ease: "outCubic"
      });
    } else {
      camera.position.copy(intro.landingPos);
      camera.lookAt(intro.landingLook);
    }
    intro.settled = true;
    intro.t = INTRO_TOTAL;
    finishIntro();
  }

  // ---------------------------------------------------------------- 碎片
  function spawnShards() {
    clearShards();
    const main = boards[0];
    if (!main) { return; }
    const world = fxRoot !== group;
    syncBaseQuat();
    baseLocal(main, _off);
    const bx = _off.x, by = _off.y, bz = _off.z;
    if (world) { group.updateMatrixWorld(true); }

    for (let i = 0; i < SHARD_N; i++) {
      const col = i % 6;
      const row = Math.floor(i / 6);
      const lx = (col / 5 - 0.5) * (W - 0.34);
      const ly = (row / 3 - 0.5) * (H - 0.34);

      shardBase.set(bx + lx, by + ly, bz + D / 2 + 0.012);
      if (world) { shardBase.applyMatrix4(group.matrixWorld); }

      const mesh = new THREE.Mesh(geo.shard, shardMat);
      mesh.add(new THREE.LineSegments(shardEdgeGeo, shardEdgeMat));
      mesh.position.copy(shardBase);
      mesh.rotation.z = (hash01(i) - 0.5) * 0.5;
      mesh.renderOrder = 6;
      fxRoot.add(mesh);

      shards.push({
        mesh,
        age: 0,
        vx: lx * 2.0 + (hash01(i + 11) - 0.5) * 0.9,
        vy: 0.55 + hash01(i + 23) * 1.0,
        vz: 0.35 + hash01(i + 37) * 0.8,
        rx: (hash01(i + 41) - 0.5) * 7,
        ry: (hash01(i + 53) - 0.5) * 7
      });
    }
    shardMat.opacity = 1;
    shardEdgeMat.opacity = 0.7;
  }

  function updateShards(dt) {
    if (!shards.length) { return; }
    let maxAge = 0;
    for (const s of shards) {
      s.age += dt;
      if (s.age > maxAge) { maxAge = s.age; }
      s.vy -= SHARD_G * dt;
      s.mesh.position.x += s.vx * dt;
      s.mesh.position.y += s.vy * dt;       // 抛物线：速度递减 → 先抛后落
      s.mesh.position.z += s.vz * dt;
      s.mesh.rotation.x += s.rx * dt;
      s.mesh.rotation.y += s.ry * dt;
    }
    const a = 1 - clamp01(maxAge / SHARD_LIFE);
    shardMat.opacity = a;
    shardEdgeMat.opacity = 0.7 * a;
    if (maxAge >= SHARD_LIFE) { clearShards(); }
  }

  function clearShards() {
    for (const s of shards) {
      if (s.mesh.parent) { s.mesh.parent.remove(s.mesh); }
    }
    shards = [];
    shardMat.opacity = 0;
    shardEdgeMat.opacity = 0;
  }

  // ---------------------------------------------------------------- 回到首屏
  // 从场景返回 BOARD 时用：把这块板复原、重新浮现一次（相机由宿主 flight.to("BOARD") 负责）
  function reset() {
    if (state.disposed) { return; }
    clearShards();
    intro.active = false;
    intro.done = false;
    intro.fired = false;
    intro.settled = false;
    intro.hidden = false;
    intro.t = 0;
    press = null;
    state.reveal = 0;
    hover.board = null;
    faceCamera(1);
    syncBaseQuat();
    for (const b of boards) {
      b.pivot.visible = true;
      baseLocal(b, _off);
      b.pivot.position.copy(_off);
      b.pivot.rotation.set(0, 0, b.tilt);
      b.hover = 0;
      b.hoverTarget = 0;
      paintBoard(b, 0, 0);
    }
  }

  // ---------------------------------------------------------------- 每帧
  function update(dtIn) {
    if (state.disposed) { return; }
    const dt = clamp(typeof dtIn === "number" ? dtIn : 1 / 60, 0, MAX_DT);
    state.time += dt;

    if (intro.active) { updateIntro(dt); return; }
    if (intro.done) { return; }        // 已经进了场景，看板退场，不再耗帧

    updateParallax(dt);
    updateHover();
    applyBoards(dt);
  }

  // ---------------------------------------------------------------- 清理
  function dispose() {
    if (state.disposed) { return; }
    state.disposed = true;

    if (el && typeof el.removeEventListener === "function") {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerleave", onLeave);
    }
    if (win && win.removeEventListener) {
      win.removeEventListener("pointerup", onUp);
    }
    if (el && el.style && state.cursorPrev !== null) {
      el.style.cursor = state.cursorPrev;
    }

    clearShards();

    const geos = new Set();
    const mats = new Set();
    const texs = new Set(textures);
    group.traverse((o) => {
      if (o.geometry) { geos.add(o.geometry); }
      if (o.material) {
        const list = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of list) {
          mats.add(m);
          if (m.map) { texs.add(m.map); }
        }
      }
    });
    geos.add(geo.plate); geos.add(geo.face); geos.add(geo.shadow);
    geos.add(geo.bar); geos.add(geo.glow); geos.add(geo.shard);
    geos.add(edgeGeo); geos.add(shardEdgeGeo);
    mats.add(shardMat); mats.add(shardEdgeMat);

    for (const t of texs) { t.dispose(); }
    for (const g of geos) { g.dispose(); }
    for (const m of mats) { m.dispose(); }

    if (group.parent) { group.parent.remove(group); }
    boards.length = 0;
    hitList.length = 0;
    textures.length = 0;
    press = null;
    hover.board = null;
  }

  // ---------------------------------------------------------------- 对外
  return {
    group,
    scene: scene || null,
    get introActive() { return intro.active; },
    get introDone() { return intro.done; },
    get hovered() { return hover; },
    get progress() { return { reveal: state.reveal, yaw: par.yaw, pitch: par.pitch }; },

    // 手动入口：验收脚本没有鼠标时也能走完整条链路
    start: startIntro,
    skip: skipIntro,
    reset,
    // 首屏这块板的真实世界坐标 + 尺寸：A1 那类"看板在哪、多高"的检查不用靠肉眼
    layout() {
      const out = [];
      for (const b of boards) {
        b.pivot.updateWorldMatrix(true, false);
        const p = _off.setFromMatrixPosition(b.pivot.matrixWorld);
        out.push({
          id: b.id,
          x: Math.round(p.x * 1000) / 1000,
          y: Math.round(p.y * 1000) / 1000,
          z: Math.round(p.z * 1000) / 1000,
          size: [W, H, D]
        });
      }
      return out;
    },

    update,
    dispose
  };
}
