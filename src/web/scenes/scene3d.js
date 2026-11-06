// 调解台 · 3D 微缩场景运行时
// -----------------------------------------------------------------------------
// 职责：把「一块微缩底座 + 一个能走的人 + 可点的东西」跑起来。
// 场景数据（房间、家具、站位人物）由外部传入，运行时本身不含任何案子内容。
//
// 关键约定（改了要同步 docs/场景与人物建模提示词.md §1.2）：
//   · 底座 20×20，中心为原点；地面 y=0；人物脚底 origin。
//   · 网格 0.5 单位，A* 八向，斜走要求两个正交格都通。
//   · 障碍按 AABB 膨胀人物半径 0.45。
//   · 点物件/人物只是"走过去"，到位才回调；不做隔空触发。
// -----------------------------------------------------------------------------
import * as THREE from "./vendor/three.module.min.js";

const GRID = 0.5;
const HALF = 9.2;                 // 可站立范围 [-9.2, 9.2]
const COLS = Math.round((HALF * 2) / GRID);
const ACTOR_R = 0.34;
const SPEED = 3.4;
const INTERACT = 2.2;
const EYE_H = 0.9;

// 手机 / 平板：像素比封顶 1.5（桌面仍是 1.75），阴影贴图减半。
// 判定用“触摸能力 + 短边”而不是 UA —— 无头/WebView/折叠屏都能落对。
const IS_TOUCH_DEVICE = (() => {
  try {
    return matchMedia("(pointer: coarse)").matches || ("ontouchstart" in window);
  } catch (err) { return "ontouchstart" in window; }
})();
const IS_MOBILE_SCENE = IS_TOUCH_DEVICE
  || Math.min(window.innerWidth || 0, window.innerHeight || 0) <= 600;
const PIXEL_RATIO_CAP = IS_MOBILE_SCENE ? 1.5 : 1.75;

// 相机距离 / 俯仰的公用夹取：滚轮、双指、setCam 三处必须同一套，不然一个放开了
// 另一个还卡着。4 = 贴着人物但不穿模；40 = 1440×900、fov 38 下整块 20m 底座四边
// 都留得下边（实测见 docs 报告）。俯仰 0.12 接近平视，1.48 接近正俯视（π/2 = 1.57）。
const CAM_DIST_MIN = 4;
const CAM_DIST_MAX = 36;
const CAM_PITCH_MIN = 0.12;
const CAM_PITCH_MAX = 1.48;

const COL = {
  base: "#cfd8dc", baseSide: "#8fa3ad",
  floor: "#e8e6e0", wall: "#f2efe8", wallIn: "#f6f3ec",
  brand: "#2f4a6d", wood: "#b98b5e", metal: "#8f9aa3", dark: "#3f4a56",
  skin: "#e8c9a8", hair: "#2b3138", chair: "#5b6672"
};

// 可点物件的高亮：珊瑚色细描边。静息克制（0.38），悬停提亮到 0.95。
// 用 EdgesGeometry 而不是给所有材质加 emissive：描边只加在"有交互点"的物件上，
// 布景不会被染红，也不会因为共用材质把别的家具一起点亮。
const HL = { base: "#e98578", hot: "#ff9c86", opacity: 0.38, hotOpacity: 0.95 };

// 头发默认色：深褐（不是墨蓝）。场景仍可用 characters[].hair 覆盖（白发/花白）。
const HAIR_DEFAULT = "#3a2c22";

// 三渲二阶梯：4 档明度 + NearestFilter = 硬台阶（卡通渲染的"块面"就是这么来的）。
// 传 gradientMap 之前，MeshToonMaterial 只在明暗交界处给一次柔化，全场景因此"糊成一片"。
const RAMP = (() => {
  const d = new Uint8Array([92, 150, 205, 255]);
  const t = new THREE.DataTexture(d, d.length, 1, THREE.RedFormat);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
})();

function toon(color, opts = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: RAMP, ...opts });
}

// 圆角盒几何：把细分盒的顶点夹到"内缩盒"里，再按偏移方向推到半径 r 的球面上。
// 硬边盒子是"积木感"的第一来源；0.02~0.05 的圆角就能让轮廓亮起来一条边。
// 同尺寸共用几何（缓存），几百件家具也只占几份内存。
const _rgeo = new Map();
export function roundedGeo(w, h, d, r = 0.03, seg = 3) {
  const key = w.toFixed(3) + "|" + h.toFixed(3) + "|" + d.toFixed(3) + "|" + r.toFixed(3) + "|" + seg;
  const hit = _rgeo.get(key);
  if (hit) { return hit; }
  r = Math.max(0.001, Math.min(r, Math.min(w, h, d) / 2 - 0.001));
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const pos = g.attributes.position;
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const cx = Math.max(-hx, Math.min(hx, x));
    const cy = Math.max(-hy, Math.min(hy, y));
    const cz = Math.max(-hz, Math.min(hz, z));
    const dx = x - cx, dy = y - cy, dz = z - cz;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len > 1e-6) {
      const k = r / len;
      pos.setXYZ(i, cx + dx * k, cy + dy * k, cz + dz * k);
    }
  }
  g.computeVertexNormals();
  _rgeo.set(key, g);
  return g;
}

// 面数按尺寸给：小东西细分没意义，大件才值得圆
export function roundedSeg(w, h, d) {
  const m = Math.max(w, h, d);
  return m >= 1.6 ? 4 : (m >= 0.7 ? 3 : 2);
}

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cyl(r1, r2, h, mat, x = 0, y = 0, z = 0, seg = 16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ------------------------------------------------------------------ 主角
// 主角与站位人物共用同一套人形零件（loft 躯干 + 两段四肢 + 五官），
// 但关节分组要能摆臂/迈腿：arms / legs / knees 都留给 tick 用，结构不能变。
function makeActor() {
  const g = new THREE.Group();
  const mats = {
    skin: toon(COL.skin),
    hair: toon("#2b2420"),
    cloth: toon("#2f4a6d"),
    pants: toon("#2b3542"),
    shoe: toon("#23282e"),
    eye: toon("#20262b"),
    brow: toon("#2b2119"),
    mouth: toon("#b0655a"),
    collar: toon("#e8eef5"),
    highlight: new THREE.MeshBasicMaterial({ color: "#fffaf0" })
  };

  const torso = loft8([
    { y: 0.80, rx: 0.158, rz: 0.106 },
    { y: 0.96, rx: 0.146, rz: 0.098 },
    { y: 1.13, rx: 0.204, rz: 0.126 },
    { y: 1.27, rx: 0.214, rz: 0.128 },
    { y: 1.35, rx: 0.086, rz: 0.072 }
  ], mats.cloth);
  g.add(torso);
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.088, 0.108, 0.04, 10, 1, true), mats.collar);
  collar.position.y = 1.322;
  collar.castShadow = true;
  collar.receiveShadow = true;
  g.add(collar);
  g.add(cyl(0.048, 0.058, 0.11, mats.skin, 0, 1.375, -0.004, 8));

  const head = humanHead(mats);
  head.position.set(0, 1.47, 0);
  g.add(head);

  // 警徽：左胸一小块白牌（原来贴在方盒子正面的那块，位置跟着新躯干走）
  const badge = box(0.09, 0.062, 0.012, toon("#ffffff"), -0.095, 1.145, 0.118);
  badge.rotation.y = -0.10;
  g.add(badge);

  const arms = [];
  const legs = [];
  const knees = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(s * 0.205, 1.262, 0);
    arm.rotation.z = s * 0.09;
    arm.add(cyl(0.052, 0.045, 0.28, mats.cloth, 0, -0.14, 0, 8));
    const elbow = new THREE.Group();
    elbow.position.y = -0.28;
    elbow.rotation.x = 0.20;
    elbow.add(cyl(0.045, 0.036, 0.25, mats.cloth, 0, -0.125, 0, 8));
    const hand = new THREE.Group();
    hand.position.y = -0.25;
    hand.add(box(0.072, 0.095, 0.042, mats.skin, 0, -0.048, 0));
    const thumb = box(0.026, 0.05, 0.026, mats.skin, s * 0.042, -0.028, 0.012);
    thumb.rotation.z = s * 0.5;
    hand.add(thumb);
    elbow.add(hand);
    arm.add(elbow);
    g.add(arm);
    arms.push(arm);

    const leg = new THREE.Group();
    leg.position.set(s * 0.10, 0.80, 0);
    leg.add(cyl(0.082, 0.068, 0.36, mats.pants, 0, -0.18, 0, 8));
    const knee = new THREE.Group();
    knee.position.y = -0.36;
    knee.rotation.x = 0.08;
    knee.add(cyl(0.060, 0.046, 0.34, mats.pants, 0, -0.17, 0, 8));
    const shoe = new THREE.Mesh(roundedGeo(0.155, 0.095, 0.30, 0.042, 2), mats.shoe);
    shoe.position.set(0, -0.395, 0.045);
    shoe.castShadow = true;
    shoe.receiveShadow = true;
    knee.add(shoe);
    leg.add(knee);
    g.add(leg);
    legs.push(leg);
    knees.push(knee);
  }

  g.userData.parts = { arms, legs, knees, torso, head };
  return g;
}

// ------------------------------------------------------------------ 头顶姓名牌
// Sprite + canvas 贴图：billboard 自动面向相机，不跟人物 rot 走。
// 世界尺寸固定 0.9×0.34m（不做"随距离缩放"）——标签只有这么大，远近都读得出来。
// 可交互（有 personId）：珊瑚色左条 + 名字 700 字重；布景人物：整体 0.75 透明度。
// 超过 18m 统一淡到 0.35，避免远景糊成一片。
const PLATE_W = 256;
const PLATE_H = 96;
const PLATE_FONT = '"Microsoft YaHei","PingFang SC","Hiragino Sans GB",sans-serif';
const PLATE = {
  bg: "rgba(255,243,215,0.92)",     // 米白底（半透明）
  edge: "rgba(53,83,100,0.92)",     // 墨色描边
  name: "#2b3138",
  role: "#5b6672",
  coral: "#e98578"
};
const PLATE_FAR = 18;               // 超过这个距离开始淡出
const PLATE_FAR_OPACITY = 0.35;

function roundRectPath(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// 文本超宽时逐级缩字号：宁可小一号，也不要出框
function fitPlateFont(g, text, weight, px, maxW) {
  let size = px;
  while (size > 11) {
    g.font = weight + " " + size + "px " + PLATE_FONT;
    if (g.measureText(text).width <= maxW) { break; }
    size -= 1;
  }
  return size;
}

function nameplateTexture(name, role, npc) {
  const c = document.createElement("canvas");
  c.width = PLATE_W; c.height = PLATE_H;
  const g = c.getContext("2d");
  g.clearRect(0, 0, PLATE_W, PLATE_H);
  const R = 16;
  g.fillStyle = PLATE.bg;
  roundRectPath(g, 1, 1, PLATE_W - 2, PLATE_H - 2, R);
  g.fill();
  // 珊瑚色左条：裁进圆角里，左上/左下才跟着圆
  const barW = 9;
  if (npc) {
    g.save();
    roundRectPath(g, 1, 1, PLATE_W - 2, PLATE_H - 2, R);
    g.clip();
    g.fillStyle = PLATE.coral;
    g.fillRect(1, 1, barW, PLATE_H - 2);
    g.restore();
  }
  // 墨色描边 + 一道极淡的内衬，牌子才有"厚度"而不是一张贴纸
  g.strokeStyle = PLATE.edge;
  g.lineWidth = 2.4;
  roundRectPath(g, 1.2, 1.2, PLATE_W - 2.4, PLATE_H - 2.4, R - 1);
  g.stroke();
  g.strokeStyle = "rgba(53,83,100,0.16)";
  g.lineWidth = 1;
  roundRectPath(g, 5.5, 5.5, PLATE_W - 11, PLATE_H - 11, R - 5);
  g.stroke();

  const x = 14 + barW;
  const maxW = PLATE_W - x - 12;
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  const nameSize = fitPlateFont(g, name, npc ? 700 : 600, 31, maxW);
  g.fillStyle = PLATE.name;
  g.font = (npc ? "700 " : "600 ") + nameSize + "px " + PLATE_FONT;
  g.fillText(name, x, 40);
  if (role) {
    // 名字与身份之间一道极淡的分隔线
    g.strokeStyle = "rgba(53,83,100,0.22)";
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, 49.5); g.lineTo(PLATE_W - 12, 49.5); g.stroke();
    const roleSize = fitPlateFont(g, role, 400, 19, maxW);
    g.fillStyle = PLATE.role;
    g.font = "400 " + roleSize + "px " + PLATE_FONT;
    g.fillText(role, x, 72);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;      // 不声明会按线性采样，米白会发灰
  t.anisotropy = 4;
  return t;
}

// 名牌可点（2026-11 用户要求：点姓名贴就能对话，不再"先走过去"）。
// 只有**可交互人物**的牌子参与射线；布景人物的牌子 raycast 置空，点它等于点后面的地/家具，
// 不会拦截点击。牌子上的身份是 nameplateFor，不写 personId —— 写了会把牌子并进人物的
// 包围盒（qa/手机探针按 personId 求 bbox 中心），人物拾取点会被抬高半米。
function makeNameplate(name, role, npc, forId) {
  const mat = new THREE.SpriteMaterial({
    map: nameplateTexture(name, role, npc),
    transparent: true,
    opacity: npc ? 1 : 0.75,
    depthTest: true,          // 被墙/家具挡住时该被挡住
    depthWrite: false,        // 透明片不写深度，别把后面的人脸挖掉
    toneMapped: false,        // 保持米白/墨色的原色，不被 ACES 拉灰
    fog: false
  });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(0.9, 0.34, 1);
  sp.renderOrder = 20;        // 排在其它透明物之后，家具边缘不会把它切掉
  sp.castShadow = false;      // 标签不投影、也不接阴影
  sp.receiveShadow = false;
  if (forId) {
    sp.userData.nameplateFor = forId;   // pickAt / 宿主的 pickTargetAt 认这一个
  } else {
    sp.raycast = () => {};
  }
  sp.userData.nameplate = true;
  sp.userData.baseOpacity = npc ? 1 : 0.75;
  sp.userData.plateName = name;
  sp.userData.plateRole = role;
  sp.userData.npc = npc;
  return sp;
}

// ------------------------------------------------------------------ 人形零件
// 8 边 loft 躯干：方盒子太"积木"，8 边足够读成"肩—胸—腰—胯"的身体。
// 顶点数 = 8×5 + 2 极点；三角面 64 + 16 = 80，面数账见 makePerson 末尾。
function loft8(rings, mat) {
  const SEG = 8;
  const pos = [];
  const idx = [];
  const push = (x, y, z) => { pos.push(x, y, z); return pos.length / 3 - 1; };
  const rows = rings.map((r) => {
    const arr = [];
    for (let j = 0; j < SEG; j++) {
      const a = (j / SEG) * Math.PI * 2 + Math.PI / SEG;  // 前后是平面（背/胸是平的）
      arr.push(push(Math.cos(a) * r.rx, r.y, Math.sin(a) * r.rz));
    }
    return arr;
  });
  for (let k = 0; k < rows.length - 1; k++) {
    const A = rows[k], B = rows[k + 1];
    for (let j = 0; j < SEG; j++) {
      const j2 = (j + 1) % SEG;
      // 绕序按"从外面看逆时针"：错了会被背面剔除，人变成一个空壳
      idx.push(A[j], B[j], B[j2], A[j], B[j2], A[j2]);
    }
  }
  const topC = push(0, rings[rings.length - 1].y, 0);
  const botC = push(0, rings[0].y, 0);
  const top = rows[rows.length - 1], bot = rows[0];
  for (let j = 0; j < SEG; j++) {
    const j2 = (j + 1) % SEG;
    idx.push(top[j], topC, top[j2]);
    idx.push(bot[j2], botC, bot[j]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// 头：球体顶点直接改（下颌收窄 + 腮部，不加面），再挂耳/鼻/眼/眉/嘴/头发。
// 三角面：颅骨 14×9 段 252 + 耳 2×40 + 鼻 15 + 眼 2×40 + 高光 2×2 + 眉 24
//          + 嘴 12 + 短发 120 + 后脑 64 ≈ 650。
function humanHead(mats) {
  const g = new THREE.Group();
  const R = 0.155;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(R, 14, 9), mats.skin);
  const pos = skull.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const t = Math.max(0, Math.min(1, -y / R));                 // 0 赤道 → 1 下巴
    const jaw = 1 - 0.30 * Math.pow(t, 1.25);                   // 下颌收窄
    const cheek = 1 + 0.055 * Math.exp(-Math.pow((y / R + 0.30) / 0.26, 2));  // 腮部
    pos.setX(i, x * jaw * cheek);
    pos.setZ(i, z * jaw * cheek * (1 + 0.10 * t));              // 下巴略往前
  }
  skull.geometry.computeVertexNormals();
  skull.castShadow = true;
  skull.receiveShadow = true;
  g.add(skull);

  for (const sd of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.036, 5, 4), mats.skin);
    ear.scale.set(0.52, 1, 0.82);
    ear.position.set(sd * 0.150, -0.004, 0.004);
    ear.rotation.y = sd * 0.18;
    ear.castShadow = true;
    g.add(ear);
  }
  // 鼻子：小锥体，尖端朝 +z（人物正面）
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.046, 5), mats.skin);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, -0.024, 0.146);
  nose.castShadow = true;
  g.add(nose);
  for (const sd of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.019, 5, 4), mats.eye);
    eye.scale.set(1, 1, 0.72);
    eye.position.set(sd * 0.056, 0.018, 0.139);
    g.add(eye);
    // 1px 等效高光：4 个三角面的白点，比再堆一个球便宜得多
    const hi = new THREE.Mesh(new THREE.PlaneGeometry(0.011, 0.011), mats.highlight);
    hi.position.set(sd * 0.056 - 0.004, 0.025, 0.153);
    g.add(hi);
    const brow = box(0.054, 0.011, 0.012, mats.brow, sd * 0.058, 0.058, 0.136);
    brow.rotation.z = sd * -0.10;
    g.add(brow);
  }
  g.add(box(0.05, 0.009, 0.008, mats.mouth, 0, -0.082, 0.127));
  // 头发：贴头皮的短发（不是原来那个盖到耳朵的半盔）+ 后脑一小块
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.163, 12, 5, 0, Math.PI * 2, 0, Math.PI * 0.36), mats.hair);
  cap.position.set(0, 0.006, -0.004);
  cap.rotation.x = -0.10;                    // 发际线前高后低
  cap.castShadow = true;
  g.add(cap);
  const back = new THREE.Mesh(
    new THREE.SphereGeometry(0.158, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.40), mats.hair);
  back.position.set(0, -0.006, -0.030);      // 往后退，正面看不见，只补后脑
  back.scale.set(1, 0.92, 1);
  back.castShadow = true;
  g.add(back);
  return g;
}

// ------------------------------------------------------------------ 站位人物
// 面数账（站/坐同价，≈1180，上限 1200）：
//   头 650 + 脖子 32 + 躯干 80 + 领口 20 + 手臂 2×88 + 腿 2×112
// 站姿：左右脚略分开、重心微偏右侧（躯干 x 偏 0.008），不是镜面对称。
function makePerson(o) {
  const g = new THREE.Group();
  const sit = o.pose === "sit";
  const s = o.scale || 1;
  // 只有本案当事人（p_*）才算『可对话』；npc_* 是能点但没有案卷数据的布景，
  // 牌子上不加珊瑚条、透明度按布景走，避免『看起来能问、点了却说不是本案当事人』。
  const _pid = String(o.personId || "");
  const npc = !!((_pid && !_pid.startsWith("npc_")) || (!o.ambient && o.id));
  const mats = {
    skin: toon(o.skin || COL.skin),
    hair: toon(o.hair || HAIR_DEFAULT),
    cloth: toon(o.color || "#7c8a99"),
    pants: toon(o.pants || "#3c4652"),
    shoe: toon("#23282e"),
    eye: toon("#20262b"),
    brow: toon("#2b2119"),
    mouth: toon("#b0655a"),
    collar: toon("#fff3d7"),
    highlight: new THREE.MeshBasicMaterial({ color: "#fffaf0" })
  };

  // 上身在坐姿整体下移 0.20：座面 0.57，胯落到 0.60 刚好坐实
  const upper = new THREE.Group();
  upper.position.y = sit ? -0.20 : 0;
  const torso = loft8([
    { y: 0.80, rx: 0.158, rz: 0.106 },   // 胯
    { y: 0.96, rx: 0.146, rz: 0.098 },   // 腰（收一点，肩才会显宽）
    { y: 1.13, rx: 0.204, rz: 0.126 },   // 胸
    { y: 1.27, rx: 0.214, rz: 0.128 },   // 肩线
    { y: 1.35, rx: 0.086, rz: 0.072 }    // 领口收窄 = 斜肩
  ], mats.cloth);
  upper.add(torso);
  // 锁骨/领口：一道浅色环
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.088, 0.108, 0.04, 10, 1, true), mats.collar);
  collar.position.y = 1.322;
  collar.castShadow = true;
  collar.receiveShadow = true;
  upper.add(collar);
  upper.add(cyl(0.048, 0.058, 0.11, mats.skin, 0, 1.375, -0.004, 8));

  const head = humanHead(mats);
  head.position.set(0, 1.47, 0);
  upper.add(head);

  // 手臂：上臂 + 前臂两段，肘部微弯；手 = 掌 + 拇指
  const arms = [];
  for (const sd of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(sd * 0.205, 1.262, 0);
    arm.rotation.z = sd * 0.09;                 // 自然下垂时略微外张
    arm.add(cyl(0.052, 0.045, 0.28, mats.cloth, 0, -0.14, 0, 8));
    const elbow = new THREE.Group();
    elbow.position.y = -0.28;
    elbow.rotation.x = 0.22;                    // 手肘往前弯一点，不是直棍
    elbow.add(cyl(0.045, 0.036, 0.25, mats.cloth, 0, -0.125, 0, 8));
    const hand = new THREE.Group();
    hand.position.y = -0.25;
    hand.add(box(0.072, 0.095, 0.042, mats.skin, 0, -0.048, 0));
    const thumb = box(0.026, 0.05, 0.026, mats.skin, sd * 0.042, -0.028, 0.012);
    thumb.rotation.z = sd * 0.5;
    hand.add(thumb);
    elbow.add(hand);
    arm.add(elbow);
    upper.add(arm);
    arms.push(arm);
  }
  g.add(upper);

  // 腿：大腿 + 小腿两段。坐姿贴座面往前伸（座面 0.57），站姿补上膝盖与厚底鞋。
  const legs = [];
  for (const sd of [-1, 1]) {
    if (sit) {
      const seatLocal = 0.57;
      const thigh = cyl(0.078, 0.068, 0.30, mats.pants, sd * 0.11, seatLocal + 0.005, 0.15, 8);
      thigh.rotation.x = Math.PI / 2;
      g.add(thigh);
      g.add(cyl(0.062, 0.048, 0.40, mats.pants, sd * 0.11, seatLocal - 0.20, 0.28, 8));
      const shoe = new THREE.Mesh(roundedGeo(0.15, 0.095, 0.26, 0.042, 2), mats.shoe);
      shoe.position.set(sd * 0.11, seatLocal - 0.40, 0.34);
      shoe.castShadow = true;
      shoe.receiveShadow = true;
      g.add(shoe);
    } else {
      const leg = new THREE.Group();
      leg.position.set(sd * 0.098 + (sd > 0 ? 0.004 : 0.012), 0.80, sd > 0 ? -0.012 : 0.016);
      leg.rotation.y = sd > 0 ? -0.05 : 0.11;   // 脚尖一外一正，不是复制粘贴
      leg.add(cyl(0.082, 0.068, 0.36, mats.pants, 0, -0.18, 0, 8));
      const knee = new THREE.Group();
      knee.position.y = -0.36;
      knee.rotation.x = sd > 0 ? 0.10 : 0.05;   // 一腿微屈 = 重心偏一侧
      knee.add(cyl(0.060, 0.046, 0.34, mats.pants, 0, -0.17, 0, 8));
      const shoe = new THREE.Mesh(roundedGeo(0.155, 0.095, 0.30, 0.042, 2), mats.shoe);
      shoe.position.set(sd * 0.022, -0.395, 0.045);
      shoe.castShadow = true;
      shoe.receiveShadow = true;
      knee.add(shoe);
      leg.add(knee);
      g.add(leg);
      legs.push(leg);
    }
  }

  // 姓名牌：头顶上方 0.28m（牌高 0.34，牌底离头顶 0.11，不会盖住脸）
  const headTop = (sit ? 1.425 : 1.625) * s;
  const nm = o.name || o.label || "";
  if (nm) {
    // 可交互人物的牌子也能点：pid 与 createScene 里 people 注册用的那一套完全一致
    const pid = o.personId || (o.ambient ? "" : o.id);
    const plate = makeNameplate(nm, o.role || "", npc, pid);
    plate.position.set(0, headTop + 0.28, 0);
    g.add(plate);
  }

  // o.y：坐姿人物要落到座面高度上（座面 0.5 时给 -0.3），否则人是悬在椅子上方的
  g.position.set(o.x, o.y || 0, o.z);
  g.userData.sit = sit;
  g.userData.baseY = o.y || 0;   // 坐姿人物要落到座面上：这个值不能被动画覆盖
  g.userData.npc = npc;
  g.userData.headTop = headTop;
  g.userData.parts = { arms, legs, torso, head: head };
  g.rotation.y = o.facing || 0;
  return g;
}

// ------------------------------------------------------------------ A*
function buildGrid(obstacles, walk) {
  const blocked = new Uint8Array(COLS * COLS);
  const mark = (x0, z0, x1, z1) => {
    // 两端都用 floor：用 ceil 会把"刚好在边界外"的那一格也圈进来，
    // 每件家具因此多出半米宽的"幽灵墙"——通道被压窄、目标点判定不可达。
    const c0 = Math.max(0, Math.floor((x0 + HALF) / GRID));
    const c1 = Math.min(COLS - 1, Math.floor((x1 + HALF) / GRID));
    const r0 = Math.max(0, Math.floor((z0 + HALF) / GRID));
    const r1 = Math.min(COLS - 1, Math.floor((z1 + HALF) / GRID));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) { blocked[r * COLS + c] = 1; }
    }
  };
  for (const o of obstacles) {
    mark(o.x - o.w / 2 - ACTOR_R, o.z - o.d / 2 - ACTOR_R,
         o.x + o.w / 2 + ACTOR_R, o.z + o.d / 2 + ACTOR_R);
  }
  // 可走范围：默认整块底座；室内场景由场景侧给 `walk` 收进房间。
  // 不收的话，前墙敞开的那一面会被当成"可以走出屋子"，人会走到台座外的石子地上。
  if (walk) {
    for (let r = 0; r < COLS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = c * GRID - HALF + GRID / 2;
        const z = r * GRID - HALF + GRID / 2;
        if (x < walk.x0 || x > walk.x1 || z < walk.z0 || z > walk.z1) {
          blocked[r * COLS + c] = 1;
        }
      }
    }
  }
  return blocked;
}

const cell = (v) => Math.max(0, Math.min(COLS - 1, Math.floor((v + HALF) / GRID)));
const center = (i) => i * GRID - HALF + GRID / 2;

function freeNear(blocked, c, r) {
  if (!blocked[r * COLS + c]) { return [c, r]; }
  for (let d = 1; d < 14; d++) {
    for (let dr = -d; dr <= d; dr++) {
      for (let dc = -d; dc <= d; dc++) {
        if (Math.abs(dr) !== d && Math.abs(dc) !== d) { continue; }
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= COLS || rr >= COLS) { continue; }
        if (!blocked[rr * COLS + cc]) { return [cc, rr]; }
      }
    }
  }
  return null;
}

function astar(blocked, from, to) {
  const key = (c, r) => r * COLS + c;
  const open = [from];
  const gScore = new Float32Array(COLS * COLS).fill(Infinity);
  const came = new Int32Array(COLS * COLS).fill(-1);
  const closed = new Uint8Array(COLS * COLS);
  const h = (c, r) => Math.hypot(c - to[0], r - to[1]);
  gScore[key(...from)] = 0;

  while (open.length) {
    let bi = 0, bf = Infinity;
    for (let i = 0; i < open.length; i++) {
      const [c, r] = open[i];
      const f = gScore[key(c, r)] + h(c, r);
      if (f < bf) { bf = f; bi = i; }
    }
    const cur = open.splice(bi, 1)[0];
    const [cc, rr] = cur;
    const ck = key(cc, rr);
    if (cc === to[0] && rr === to[1]) {
      const path = [cur];
      let k = ck;
      while (came[k] >= 0) { const prev = came[k]; path.unshift([prev % COLS, Math.floor(prev / COLS)]); k = prev; }
      return path;
    }
    closed[ck] = 1;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) { continue; }
        const nc = cc + dc, nr = rr + dr;
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= COLS) { continue; }
        if (blocked[nr * COLS + nc]) { continue; }
        if (dr && dc && (blocked[rr * COLS + nc] || blocked[nr * COLS + cc])) { continue; } // 不切角
        const nk = nr * COLS + nc;
        if (closed[nk]) { continue; }
        const ng = gScore[ck] + (dr && dc ? 1.414 : 1);
        if (ng < gScore[nk]) {
          gScore[nk] = ng;
          came[nk] = ck;
          if (!open.some(([oc, orr]) => oc === nc && orr === nr)) { open.push([nc, nr]); }
        }
      }
    }
  }
  return null;
}

// ------------------------------------------------------------------ 贴图
// 全部 canvas 现画：不加载任何外部图，断网双击也能开。
function skyTexture(top, bottom, mid) {
  const c = document.createElement("canvas");
  c.width = 8; c.height = 256;
  const g = c.getContext("2d");
  const lg = g.createLinearGradient(0, 0, 0, 256);
  lg.addColorStop(0, top);
  lg.addColorStop(0.5, mid || "#e7ebe6");
  lg.addColorStop(1, bottom);
  g.fillStyle = lg;
  g.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 地砖：底 + 分格 + 一道高光边。旧的只有分格，地面像一张网格纸。
function floorTexture(tint, rx = 6, ry = 6) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = tint || "#ece9e2";
  g.fillRect(0, 0, 256, 256);
  // 砖缝
  g.strokeStyle = "rgba(140,132,118,.42)";
  g.lineWidth = 2.5;
  for (let i = 0; i <= 3; i++) {
    const p = 85.33 * i + 0.5;
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 256); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(256, p); g.stroke();
  }
  // 每块砖的上沿一道亮线 + 轻微的色差，砖才有"厚度"
  for (let ix = 0; ix < 3; ix++) {
    for (let iy = 0; iy < 3; iy++) {
      const x = 85.33 * ix, y = 85.33 * iy;
      g.fillStyle = "rgba(255,255,255,.20)";
      g.fillRect(x + 2, y + 2, 81, 2);
      g.fillStyle = "rgba(" + (192 + ((ix + iy) % 2) * 6) + "," + (188 + ((ix * iy) % 3) * 4) + ",178,.16)";
      g.fillRect(x + 2, y + 4, 81, 79);
    }
  }
  // 细颗粒：把"纯色块"变成"有材质的面"
  for (let i = 0; i < 900; i++) {
    g.fillStyle = "rgba(120,112,100," + (Math.random() * 0.06).toFixed(3) + ")";
    g.fillRect(Math.random() * 256, Math.random() * 256, 1.4, 1.4);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// 场地（房间外的石子地）：比地砖粗、比墙暗，底色带斑
function siteTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "#b3aa99";
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const r = Math.random();
    g.fillStyle = r < 0.45 ? "rgba(150,140,124,.35)"
      : (r < 0.8 ? "rgba(196,187,170,.5)" : "rgba(122,112,98,.28)");
    const s = 1 + Math.random() * 2.6;
    g.fillRect(Math.random() * 256, Math.random() * 256, s, s);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(9, 9);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ------------------------------------------------------------------ 场景
export function createScene(opts) {
  const host = opts.mount;
  const room = opts.room; // {x0,x1,z0,z1,h}
  const scene = new THREE.Scene();
  // 天空：竖向渐变。单色背景是"单色画面"的起点——上半冷、下半暖，光才有来处。
  scene.background = skyTexture(opts.skyTop || "#c6dbe9", opts.skyBottom || "#efe6d7", opts.skyMid);
  // 雾色必须等于天空"地平线"那一档，否则远处的地平线会和天空接出一条硬缝
  const SKY_BOTTOM = opts.skyBottom || "#efe6d7";
  scene.fog = new THREE.FogExp2(SKY_BOTTOM, opts.fogDensity ?? 0.0075);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PIXEL_RATIO_CAP));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = (opts.light && opts.light.exposure) ?? 1.0;
  host.appendChild(renderer.domElement);

  // 光：暖主光 + 冷补光 + 回光。三件套缺一件，画面就只剩"均匀亮"，没有体积。
  const L = opts.light || {};
  const hemi = new THREE.HemisphereLight(L.hemiSky || "#e8f2ff", L.hemiGround || "#c8ae92", L.hemi ?? 0.7);
  const sun = new THREE.DirectionalLight(L.sun || "#ffd2a1", L.sunI ?? 2.55);
  sun.position.set(-9.5, 13.5, 9.5);
  sun.castShadow = true;
  // 手机上 1024 已经够用：2048 在 390px 宽的屏上几乎看不出差别，却贵一倍
  const SHADOW_SIZE = IS_MOBILE_SCENE ? 1024 : 2048;
  sun.shadow.mapSize.set(SHADOW_SIZE, SHADOW_SIZE);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  const sc = sun.shadow.camera;
  sc.left = -14; sc.right = 14; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 48;
  const fill = new THREE.DirectionalLight(L.fill || "#9dc2e4", L.fillI ?? 0.95);
  fill.position.set(L.fillPos ? L.fillPos[0] : 11.5, L.fillPos ? L.fillPos[1] : 7, L.fillPos ? L.fillPos[2] : 4.5);
  const bounce = new THREE.DirectionalLight(L.bounce || "#ffe6c2", L.bounceI ?? 0.4);
  bounce.position.set(1.5, 4.5, -13);
  scene.add(hemi, sun, fill, bounce);

  // 场景自带的灯：**会穿墙**——点光源没有遮挡，墙外面的立面会被室内灯照亮，
  // 三渲二把这段渐变量化成硬台阶，外墙就出现一块块"白斑"。默认不用，
  // 真要暖光池就给很小的 distance（<3）并确保墙外看不见。
  for (const lp of opts.lamps || []) {
    const pl = new THREE.PointLight(lp.color || "#ffd9a8", lp.intensity || 1.2, lp.distance || 4.2, 2);
    pl.position.set(lp.x, lp.y || 2.6, lp.z);
    scene.add(pl);
  }

  // ---------------------------------------------------------------- 底座（v6：照海边便利店的断面）
  // 下宽上窄三级：台身（最宽，navy）→ 台阶（cream）→ 顶面（沙/水泥）。
  // 外面再铺一张 2000×2000 的同色环境面 —— 模型是"浮在一片环境里"，不是摆在虚空中。
  const TERRAIN_W = room ? (room.x1 - room.x0) + 2.0 : 18.4;
  const TERRAIN_D = room ? (room.z1 - room.z0) + 2.0 : 18.4;
  const BASE_W = TERRAIN_W + 1.7, BASE_D = TERRAIN_D + 1.7;
  {
    // 地面表面固定在 y=0：场景里的东西全部按 y=0 摆放，这里只往下长
    const body = box(BASE_W, 0.62, BASE_D, toon(opts.baseSideColor || "#315c72"), 0, -0.79, 0);
    const step = box(BASE_W - 0.45, 0.22, BASE_D - 0.45,
                     toon(opts.baseColor || "#fff3d7"), 0, -0.37, 0);
    body.receiveShadow = true;
    step.receiveShadow = true;
    scene.add(body, step);
  }

  // 外景面：让底座"落"在一片同色环境里。
  // 室内场景不铺 —— 房间本身没有"外面的地"，硬铺一张大平面会在画面上切出一条灰带。
  // 默认不铺：铺一张无限大的平面，它在远处还没被雾吃掉时就是一条硬地平线。
  // 要靠外景面收边的场景，显式传 outer: true。
  if (opts.outer === true) {
    const ext = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000),
      new THREE.MeshStandardMaterial({ color: opts.outerColor || "#b5b0a2",
                                       roughness: 0.6, metalness: 0.02 }));
    ext.rotation.x = -Math.PI / 2;
    ext.position.y = -1.0;
    ext.receiveShadow = true;
    ext.castShadow = false;
    scene.add(ext);
  }

  // 地形块 = 底座顶面那一层（最窄的一级），顶面在 y=0，侧面比顶面深两号。
  const terrainH = 0.26;
  const terrainSide = toon(opts.terrainSideColor || "#8a7c66");
  {
    const side = new THREE.Mesh(
      new THREE.BoxGeometry(TERRAIN_W, terrainH, TERRAIN_D), terrainSide);
    side.position.y = -terrainH / 2;
    side.castShadow = true;
    side.receiveShadow = true;
    scene.add(side);

    // v6：顶面改成纯色（原来的 siteTexture 是噪点，模型会显脏）
    const top = new THREE.Mesh(new THREE.PlaneGeometry(TERRAIN_W, TERRAIN_D),
      toon(opts.siteColor || "#e8cca1"));
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.001;
    top.receiveShadow = true;
    scene.add(top);
  }

  // ---------------------------------------------------------------- 房间
  // 室外场景（院墙、球场、晒谷场）没有房间：room 传 null，整块跳过，
  // 地形块铺满底座，地面材质由场景自己用 passable 贴片叠出来。
  if (room) {
  const RW = room.x1 - room.x0, RD = room.z1 - room.z0, RH = room.h;
  const CX = (room.x0 + room.x1) / 2, CZ = (room.z0 + room.z1) / 2;

  const floorMat = toon(opts.floorColor || COL.floor, {
    map: floorTexture(opts.floorColor, Math.max(4, Math.round(RW / 2.2)), Math.max(4, Math.round(RD / 2.2)))
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(RW, RD), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(CX, 0.012, CZ);
  floor.receiveShadow = true;
  scene.add(floor);

  // 剖开的楼板：前开口那一条暗色边。没有它，地面就像纸片飘在半空。
  scene.add(box(RW + 0.3, 0.07, 0.16, toon("#9a907d"), CX, 0.035, room.z1 + 0.08));

  // 散水：贴墙一圈 0.5 宽的浅色护脚，把"墙根"和"野地"分开
  const apronMat = toon("#cfc6b3");
  scene.add(box(RW + 0.9, 0.04, 0.5, apronMat, CX, 0.02, room.z0 - 0.25));
  scene.add(box(0.5, 0.04, RD + 0.9, apronMat, room.x0 - 0.25, 0.02, CZ));
  scene.add(box(0.5, 0.04, RD + 0.9, apronMat, room.x1 + 0.25, 0.02, CZ));

  // 墙（前墙不建，方便看进去）。三面墙 = 内面浅 / 外面深 / 顶面压顶色，
  // 顶面如果跟墙身同色，从上往下就是一整条"纸板宽带"。
  const WT = 0.22;
  const wallIn = toon(opts.wallColor || "#f6f2e9");
  const wallOut = toon(opts.wallOutColor || "#b9ab92");
  const capMat = toon(opts.wallCapColor || "#9b8d75");
  const darkEdge = toon("#7d7362");
  const wallMats = (inner) => {
    const m = [wallOut, wallOut, capMat, darkEdge, wallOut, wallOut];
    m[inner] = wallIn;
    return m;
  };
  const addWall = (w, h, d, x, z, inner) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMats(inner));
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    // 墙**不接收**阴影：MeshToonMaterial 用的是半兰伯特，背面也会拿到一份渐变光照，
    // 再乘 shadowMask，外墙就会浮出一块块的"白斑"（自阴影被量化成硬台阶）。
    mesh.receiveShadow = false;
    scene.add(mesh);
    return mesh;
  };
  addWall(RW + WT * 2, RH, WT, CX, room.z0 - WT / 2, 4);          // 后（内表面朝 +z）
  addWall(WT, RH, RD, room.x0 - WT / 2, CZ, 0);                    // 左（内表面朝 +x）
  addWall(WT, RH, RD, room.x1 + WT / 2, CZ, 1);                    // 右（内表面朝 -x）

  // 压顶：墙顶出 0.04 的一圈，制造一道阴影线 —— 剖面因此有厚度
  const lipMat = toon("#b8ab94");
  const lip = (w, d, x, z) => scene.add(box(w, 0.055, d, lipMat, x, RH + 0.027, z));
  lip(RW + WT * 2 + 0.1, WT + 0.09, CX, room.z0 - WT / 2);
  lip(WT + 0.09, RD, room.x0 - WT / 2, CZ);
  lip(WT + 0.09, RD, room.x1 + WT / 2, CZ);

  // 墙裙：0.85 高的护墙 + 一道压条 + 0.08 踢脚，墙面分成三段才像"装修过"
  const skirtMat = toon(opts.skirtColor || "#ded3bd");
  const trimMat = toon("#c9bca2");
  const baseTrimMat = toon("#b3a68c");
  const wallRun = (len, x, z, axis) => {
    const w = axis === "x" ? len : 0.055, d = axis === "x" ? 0.055 : len;
    scene.add(box(w, 0.85, d, skirtMat, x, 0.425, z));
    scene.add(box(w + 0.014, 0.045, d + 0.014, trimMat, x, 0.872, z));
    scene.add(box(w + 0.02, 0.08, d + 0.02, baseTrimMat, x, 0.04, z));
  };
  wallRun(RW, CX, room.z0 + 0.025, "x");
  wallRun(RD, room.x0 + 0.025, CZ, "z");
  wallRun(RD, room.x1 - 0.025, CZ, "z");
  }

  // 道具
  const pickable = new THREE.Group();
  scene.add(pickable);
  const propById = new Map();
  for (const p of opts.props || []) {
    const holder = new THREE.Group();
    holder.position.set(p.x, 0, p.z);
    holder.rotation.y = p.rot || 0;
    const mesh = p.build ? p.build(THREE, toon) : box(p.w || 0.6, p.h || 0.6, p.d || 0.6, toon(p.color || COL.wood), 0, (p.h || 0.6) / 2, 0);
    holder.add(mesh);
    // 只有"真挡路 / 有交互点"的物件才带 propId（家具身份）。passable 的地面贴片、
    // 雾片、藤蔓、玉米串、挂件不挡路也不是可查看的家具 —— 点到它们应该走到手指
    // 点的那块地（和 g_* 地面同一条规则），而不是被当成家具去走固定交互点。
    // propById 仍保留全部 prop：场景自己的 goToProp / 测试 API 不受影响。
    // 以后某个 passable 物件真要可点，给它加 interact 即可，别删掉这个条件。
    if (!p.passable || p.interact) {
      mesh.traverse((o) => { if (o.isMesh) { o.userData.propId = p.id; } });
    }
    // 可点物件的珊瑚色细描边（用户要求：能点的东西要看得出来）。
    // 只给有交互点的物件加；布景/地面贴片不加 —— 描边本身就是"这里能点"的信号。
    // 悬停时同一份材质提亮（见 highlight），线不参与拾取（没有 propId）。
    let hl = null;
    if (p.interact || p.seat) {
      hl = new THREE.LineBasicMaterial({
        color: HL.base, transparent: true, opacity: HL.opacity, depthWrite: false, fog: true
      });
      mesh.traverse((o) => {
        if (!o.isMesh || !o.geometry) { return; }
        let big = false;
        try {
          const bb = new THREE.Box3().setFromObject(o);
          const sz = bb.getSize(new THREE.Vector3());
          big = Math.max(sz.x, sz.y, sz.z) >= 0.14;      // 螺丝/贴纸那种小件不描，免得糊
        } catch (err) { big = false; }
        if (!big) { return; }
        const ln = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 40), hl);
        ln.renderOrder = 3;
        o.add(ln);
      });
    }
    scene.add(holder);

    // 接触阴影：物件脚下一片很淡的暗色，缺了它整个模型会"浮"起来
    if (!p.passable && p.w && p.d) {
      const ao = new THREE.Mesh(
        new THREE.PlaneGeometry(p.w + 0.22, p.d + 0.22),
        new THREE.MeshBasicMaterial({ color: "#2b3138", transparent: true, opacity: 0.085, depthWrite: false })
      );
      ao.rotation.x = -Math.PI / 2;
      ao.position.set(p.x, 0.006, p.z);
      scene.add(ao);
    }
    pickable.add(holder);
    propById.set(p.id, { data: p, obj: holder, baseY: 0, hl });
  }

  // 站位人物
  const people = new Map();
  const allPeople = [];        // 含布景人物：hidePeople / 标签淡出要一起管
  for (const c of opts.characters || []) {
    const g = makePerson(c);
    // 可交互人物必须留在 pickable 里：pickAt() 只对 pickable.children 做射线。
    // 旧写法先 pickable.add(g)、下一行又 scene.add(g)：THREE 的 add() 会先把节点从
    // 旧父级摘下来，于是人物最后全挂回 Scene 根，点人永远命中不到（只剩"走到地面点"）。
    // ambient 人物默认只是氛围（不进 pickable / people）；显式给了 personId 才按 NPC 接进来。
    const pid = c.personId || (c.ambient ? "" : c.id);
    if (pid) {
      g.traverse((o) => { if (o.isMesh) { o.userData.personId = pid; } });
      pickable.add(g);
      people.set(pid, g);
    } else {
      scene.add(g);
    }
    allPeople.push(g);
  }
  // 姓名牌：每帧按相机距离淡出（> 18m → 0.35）。数量是"每场 2~4 个"，逐帧算很便宜。
  // 距离按**水平距离**（相机在地面上的投影到人物脚下）算：俯视角下相机在 13m 高、
  // 到标签的 3D 距离会平白多出十来米，用 3D 距离会让"落到俯瞰位"那一眼所有名字都淡掉。
  const nameplates = [];
  for (const g of allPeople) {
    g.traverse((o) => {
      if (o.isSprite && o.userData.nameplate) {
        nameplates.push({ sprite: o, root: g, base: o.userData.baseOpacity ?? 1 });
      }
    });
  }
  const _plateWorld = new THREE.Vector3();
  function updateNameplates() {
    for (const p of nameplates) {
      p.root.getWorldPosition(_plateWorld);
      const hd = Math.hypot(camera.position.x - _plateWorld.x,
                            camera.position.z - _plateWorld.z);
      const want = hd > PLATE_FAR ? Math.min(p.base, PLATE_FAR_OPACITY) : p.base;
      const mat = p.sprite.material;
      // 阻尼到目标值：跨过 18m 阈值时不会"啪"地跳一档
      mat.opacity += (want - mat.opacity) * 0.18;
      if (Math.abs(want - mat.opacity) < 0.01) { mat.opacity = want; }
    }
  }

  // 主角
  const actor = makeActor();
  actor.position.set(opts.actor?.x ?? 0, 0, opts.actor?.z ?? 4);
  scene.add(actor);

  // 选点圈
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.5, 40),
    new THREE.MeshBasicMaterial({ color: "#2f6feb", transparent: true, opacity: 0.5, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  ring.visible = false;
  scene.add(ring);

  const blocked = buildGrid(opts.obstacles || opts.props || [], opts.walk);
  // 机位：45° 是"看得见两个立面"的通用角，但室内场景 45° 会把侧墙的外立面
  // 顶到画面中央（那一块永远是空的）。室内用 15~25°，更接近"站在开放的门口往里看"。
  const HOME = {
    yaw: opts.camYaw ?? Math.PI / 4,
    pitch: opts.camPitch ?? 0.76,
    dist: opts.camDist ?? 24
  };
  const state = {
    path: [], target: null, pending: null, walking: false, phase: 0, sitting: false,
    camYaw: HOME.yaw, camPitch: HOME.pitch, camDist: HOME.dist,
    focusLock: false,
    focus: opts.camFocus
      ? new THREE.Vector3(opts.camFocus[0], opts.camFocus[1] ?? EYE_H, opts.camFocus[2])
      : new THREE.Vector3(actor.position.x, EYE_H, actor.position.z)
  };

  // ---------------------------------------------------------------- 相机
  // 相机归属权：默认归场景自己；flight.js 接管时置 true，场景只更新 state，不再落笔到 camera。
  let cameraExternal = false;

  // 外壳（app.js）控制相机：flight 在外壳里算机位，逐帧 postMessage 过来。
  // 十场场景共用这一条监听，场景自己的 message 监听只管业务事件。
  window.addEventListener("message", (ev) => {
    const d = ev.data || {};
    if (d.source !== "host") { return; }
    if (d.type === "camera:owner") { cameraExternal = !!d.payload?.external; return; }
    if (d.type === "camera:set" && d.payload) {
      const { pos, look, fov } = d.payload;
      camera.position.set(pos[0], pos[1], pos[2]);
      camera.lookAt(look[0], look[1], look[2]);
      if (fov && Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = fov; camera.updateProjectionMatrix();
      }
    }
  });
  function placeCamera() {
    if (cameraExternal) { return; }
    const d = state.camDist;
    const y = Math.sin(state.camPitch) * d;
    const r = Math.cos(state.camPitch) * d;
    camera.position.set(
      state.focus.x + Math.sin(state.camYaw) * r,
      Math.max(1.2, y),
      state.focus.z + Math.cos(state.camYaw) * r
    );
    camera.lookAt(state.focus);
  }

  // 浮尘：室内空气里的一点微粒，让画面不像真空。室外场景由场景自己给落叶/飞虫。
  if (opts.dust !== false && room) {
    const n = 140;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * (room.x1 - room.x0 - 1);
      pos[i * 3 + 1] = Math.random() * 2.6 + 0.2;
      pos[i * 3 + 2] = (Math.random() - 0.5) * (room.z1 - room.z0 - 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const dust = new THREE.Points(geo, new THREE.PointsMaterial({
      color: "#fff6e2", size: 0.028, transparent: true, opacity: 0.45, depthWrite: false
    }));
    dust.position.set((room.x0 + room.x1) / 2, 0, (room.z0 + room.z1) / 2);
    scene.add(dust);
    state.dust = dust;
  }

  // ---------------------------------------------------------------- 输入
  let dragging = false, dragMoved = 0, lastX = 0, lastY = 0, lastInteract = 0;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();

  function pickAt(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(pickable.children, true);
    // 不能取 hits[0]：家具的描边线（LineSegments）也参与射线、而且比表面更近，
    // 它们的 userData 上没有 propId —— 拿第一个命中会得到空身份，点物件退化成
    // "走到地面点"，goToProp / spot:click 都不发。这里取**第一个带 personId / propId
    // 的命中**，跳过描边线、墙、底座这些没有身份的东西。
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    for (const h of hits) {
      const u = (h.object && h.object.userData) || {};
      // 姓名牌：牌面比人身体大得多，是"隔几米点人"最稳的落点。
      // 用 nameplateFor 而不是 personId：牌子不能并进人物的包围盒（见 makeNameplate）。
      if (u.nameplateFor) { return { personId: u.nameplateFor, plate: true }; }
      if (u.personId) { return u; }
      if (!u.propId) { continue; }
      // 地面 / 路面 / 草皮本身也是 prop（id 形如 g_*），又平又大：它们不是可查看的
      // 家具，点到它们要按"地面点"处理（走到手指点的那一点），不能走到某个固定交互点。
      let flat = false;
      try {
        box.setFromObject(h.object);
        box.getSize(size);
        flat = size.y < 0.35 && Math.max(size.x, size.z) > 8;
      } catch (err) { flat = false; }
      if (flat) { continue; }
      return u;
    }
    return {};
  }

  function groundAt(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    if (ray.ray.intersectPlane(groundPlane, hitPoint)) { return hitPoint.clone(); }
    return null;
  }

  const el = renderer.domElement;
  // 触摸与鼠标分开：触摸走下面 touchstart/move/end 的显式链路（轻点/拖动/捏合），
  // 浏览器为触摸合成的 pointer 事件在这里全部让路，避免一次轻点被走两遍。
  // 鼠标逻辑一行未动。
  el.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType === "touch") { return; }
    dragging = true; dragMoved = 0; lastX = ev.clientX; lastY = ev.clientY;
    el.setPointerCapture?.(ev.pointerId);
  });
  el.addEventListener("pointermove", (ev) => {
    if (ev.pointerType === "touch") { return; }
    if (dragging) {
      const dx = ev.clientX - lastX, dy = ev.clientY - lastY;
      dragMoved += Math.abs(dx) + Math.abs(dy);
      lastX = ev.clientX; lastY = ev.clientY;
      if (dragMoved > 6) {
        state.camYaw -= dx * 0.006;
        state.camPitch = Math.max(CAM_PITCH_MIN, Math.min(CAM_PITCH_MAX, state.camPitch + dy * 0.004));
        state.idleSince = performance.now();
        placeCamera();
      }
      return;
    }
    const now = performance.now();
    if (now - lastInteract < 60) { return; }
    lastInteract = now;
    const hit = pickAt(ev);
    highlight(hit.propId || hit.personId || null);
    el.style.cursor = (hit.propId || hit.personId) ? "pointer" : "default";
  });
  el.addEventListener("pointerup", (ev) => {
    if (ev.pointerType === "touch") { return; }
    const wasDrag = dragMoved > 8;
    dragging = false;
    if (wasDrag) { return; }
    const hit = pickAt(ev);
    if (hit.personId) {
      // 身体 → 走过去，到位才开口；姓名牌 → 原地立刻开口
      if (hit.plate) { talkToPerson(hit.personId); }
      else { clearWalk(); goToPerson(hit.personId); }
      return;
    }
    // 点到"没有交互点"的家具时，不要把人钉在原地——就近走到的地面点才是符合直觉的结果
    if (hit.propId) {
      // 走场景自己的 propById 查；以前这里用的是未声明的 props（宿主在 app.js 里
      // 塞了个 w.props 垫片才没炸），场景单独打开时真命中家具会抛 ReferenceError。
      const p = propById.get(hit.propId);
      if (p && p.data.interact) { goToProp(hit.propId); return; }
    }
    const p = groundAt(ev);
    if (p) { walkTo(p.x, p.z); }
  });
  // 视角复位：R 键或双击画面
  function resetView() {
    state.camYaw = HOME.yaw;
    state.camPitch = HOME.pitch;
    state.camDist = HOME.dist;
    placeCamera();
  }
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "r" || ev.key === "R") { resetView(); }
  });
  el.addEventListener("dblclick", resetView);

  el.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    state.camDist = Math.max(CAM_DIST_MIN, Math.min(CAM_DIST_MAX, state.camDist + ev.deltaY * 0.012));
    state.idleSince = performance.now();
    placeCamera();
  }, { passive: false });

  // ---------------------------------------------------------------- 触屏
  // 三种手势，位移/时长阈值写成常量，方便现场按手感调：
  //   单指轻点  <10px 且 <350ms  → 点地面走 / 点人 / 点物件（与鼠标 pointerup 同一套拾取）
  //   单指拖动  ≥10px            → 转 yaw / pitch（拖动一旦成立，这一次就不再算轻点）
  //   双指捏合                    → 按两指距离比例改 camDist；双指期间单指旋转全部让路
  const TAP_SLOP = 10;
  const TAP_MS = 350;
  let touchOne = null;       // { x0,y0,x,y,t0,moved }
  let pinchDist = 0;
  let pinchActive = false;

  function touchLen(ev) {
    const a = ev.touches[0], b = ev.touches[1];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  // 轻点的落点判定：和鼠标 pointerup 完全一致（身体 → 走位过去；姓名牌 → 原地开口；
  // 可交互物件 → 走位并触发；其余 → 走到点到的地面点）。
  function tapAt(clientX, clientY) {
    const fake = { clientX, clientY };
    const hit = pickAt(fake);
    if (hit.personId) {
      if (hit.plate) { talkToPerson(hit.personId); }
      else { clearWalk(); goToPerson(hit.personId); }
      return;
    }
    if (hit.propId) {
      const p = propById.get(hit.propId);
      if (p && p.data.interact) { goToProp(hit.propId); return; }
    }
    const p = groundAt(fake);
    if (p) { walkTo(p.x, p.z); }
  }

  el.addEventListener("touchstart", (ev) => {
    if (ev.touches.length >= 2) {
      touchOne = null;                  // 第二根手指落下：取消还没成立的轻点/拖动
      pinchActive = true;
      pinchDist = touchLen(ev);
      ev.preventDefault();
      return;
    }
    if (ev.touches.length !== 1) { return; }
    const t = ev.touches[0];
    touchOne = { x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY,
                 t0: performance.now(), moved: 0 };
    pinchActive = false;
    pinchDist = 0;
  }, { passive: false });

  el.addEventListener("touchmove", (ev) => {
    if (ev.touches.length >= 2) {
      // 双指：单指拖动状态立即作废，只做缩放
      touchOne = null;
      pinchActive = true;
      const d = touchLen(ev);
      if (pinchDist > 0 && Math.abs(d - pinchDist) > 0.5) {
        state.camDist = Math.max(CAM_DIST_MIN, Math.min(CAM_DIST_MAX, state.camDist - (d - pinchDist) * 0.05));
        state.idleSince = performance.now();
        placeCamera();
      }
      pinchDist = d;
      ev.preventDefault();
      return;
    }
    if (!touchOne || pinchActive) { return; }
    const t = ev.touches[0];
    if (!t) { return; }
    const dx = t.clientX - touchOne.x, dy = t.clientY - touchOne.y;
    touchOne.x = t.clientX; touchOne.y = t.clientY;
    touchOne.moved += Math.abs(dx) + Math.abs(dy);
    if (touchOne.moved >= TAP_SLOP) {
      // 拖动成立：从这里开始转视角（只算超出阈值后的位移，画面不会先跳一下）
      state.camYaw -= dx * 0.006;
      state.camPitch = Math.max(CAM_PITCH_MIN, Math.min(CAM_PITCH_MAX, state.camPitch + dy * 0.004));
      state.idleSince = performance.now();
      placeCamera();
      ev.preventDefault();
    }
  }, { passive: false });

  el.addEventListener("touchend", (ev) => {
    const changed = ev.changedTouches && ev.changedTouches[0];
    if (pinchActive) {
      // 双指：等最后一根也抬起再清状态；抬一根后剩下的不接成单指拖动
      if (ev.touches.length === 0) { pinchActive = false; pinchDist = 0; touchOne = null; }
      return;
    }
    if (!touchOne) { return; }
    const st = touchOne;
    touchOne = null;
    if (ev.touches.length > 0) { return; }

    const dur = performance.now() - st.t0;
    if (!changed || st.moved >= TAP_SLOP || dur >= TAP_MS) { return; }
    tapAt(changed.clientX, changed.clientY);
  }, { passive: false });

  el.addEventListener("touchcancel", () => {
    touchOne = null; pinchActive = false; pinchDist = 0;
  }, { passive: true });

  // ---------------------------------------------------------------- 高亮
  let hot = null;
  let highlightOn = true;
  function highlight(id) {
    if (!highlightOn) { id = null; }
    if (hot === id) { return; }
    if (hot) {
      const old = propById.get(hot);
      if (old) {
        old.obj.traverse((o) => {
          if (o.isMesh && o.material && o.material.emissive) { o.material.emissive.setHex(0x000000); }
        });
        if (old.hl) { old.hl.opacity = HL.opacity; old.hl.color.set(HL.base); }
      }
    }
    hot = id;
    if (id) {
      const cur = propById.get(id);
      if (cur) {
        cur.obj.traverse((o) => {
          if (o.isMesh && o.material && o.material.emissive) { o.material.emissive.setHex(0x4a201a); }
        });
        if (cur.hl) { cur.hl.opacity = HL.hotOpacity; cur.hl.color.set(HL.hot); }
      }
    }
  }
  // 全局开关（截图/性能兜底）：关掉静态珊瑚描边，也顺手把当前悬停清掉。
  function setHighlight(v) {
    highlightOn = !!v;
    propById.forEach((p) => { if (p.hl) { p.hl.visible = highlightOn; } });
    highlight(hot);
  }

  // ---------------------------------------------------------------- 寻路
  function walkTo(x, z, pending) {
    state.sitting = false;              // 起身由"要走"触发，不靠帧判断
    const from = [cell(actor.position.x), cell(actor.position.z)];
    const goal = freeNear(blocked, cell(x), cell(z));
    if (!goal) { fire("actor:blocked", {}); return false; }
    const cells = astar(blocked, freeNear(blocked, ...from) || from, goal);
    if (!cells || cells.length < 2) {
      state.path = [];
      return false;
    }
    const pts = cells.map(([c, r]) => new THREE.Vector3(center(c), 0, center(r)));
    const visible = (a, b) => {
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (GRID * 0.5));
      for (let i = 0; i <= steps; i++) {
        const tt = steps ? i / steps : 0;
        const c = cell(a.x + (b.x - a.x) * tt);
        const r = cell(a.z + (b.z - a.z) * tt);
        if (blocked[r * COLS + c]) { return false; }
      }
      return true;
    };
    const straight = [];
    let anchor = 0;
    while (anchor < pts.length - 1) {
      let far = pts.length - 1;
      for (; far > anchor + 1; far--) {
        if (visible(pts[anchor], pts[far])) { break; }
      }
      straight.push(pts[far]);
      anchor = far;
    }
    if (straight.length) { pts.length = 0; pts.push(...straight); }
    // 去掉共线的中间点：A* 给的是格路径，直接走会一抖一抖
    const path = [pts[0] || state.path[0] || new THREE.Vector3()];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = path[path.length - 1], b = pts[i], c = pts[i + 1];
      const cross = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
      if (Math.abs(cross) > 1e-6) { path.push(b); }
    }
    if (pts.length > 1) { path.push(pts[pts.length - 1]); }
    state.path = path.filter(Boolean);
    state.pending = pending || null;
    ring.position.set(x, 0.02, z);
    ring.visible = true;
    return true;
  }

  function goToProp(id) {
    const p = propById.get(id);
    if (!p) { return false; }
    const d = p.data;
    const ip = d.interact || { x: d.x, z: d.z + (d.d || 0.8) / 2 + 1.0 };
    if (walkTo(ip.x, ip.z, { type: "spot", id, seat: !!d.seat, facing: d.facing || 0 })) {
      return true;
    }
    // 走不过去：如果不是"已经站在交互点旁边"，给一个明确的 blocked（宿主会弹提示），
    // 绝不让这次点击变成一声不响。
    const dist = Math.hypot(actor.position.x - ip.x, actor.position.z - ip.z);
    if (dist > 1.2) {
      fire("actor:blocked", { id, reason: "prop" });
      return false;
    }
    // 已经贴着交互点（walkTo 因为路径不足 2 格返回 false）：直接算"到位"。
    ring.visible = false;
    if (d.seat) {
      state.sitting = true;
      actor.rotation.y = d.facing || actor.rotation.y;
      fire("actor:seat", { id });
    } else {
      fire("actor:arrived", { x: actor.position.x, z: actor.position.z });
      fire("spot:click", { id });
    }
    return true;
  }

  function goToPerson(id) {
    const g = people.get(id);
    if (!g) { return; }
    const dx = g.position.x - actor.position.x;
    const dz = g.position.z - actor.position.z;
    const len = Math.hypot(dx, dz) || 1;
    walkTo(g.position.x - dx / len * 1.5, g.position.z - dz / len * 1.5, { type: "person", id });
  }

  // 取消还没走完的路：点人/点牌之后，旧目标不能晚一步再发一次事件、再弹一次面板。
  function clearWalk() {
    if (!state.path.length && !state.pending) { ring.visible = false; return; }
    state.path = [];
    state.pending = null;
    state.walking = false;
    ring.visible = false;
  }

  // 两条通道（用户 2026-11 定的折中方案）：
  //   · 点**身体** → goToPerson：走过去，到位才 fire（保留空间感）；
  //   · 点**姓名牌** → talkToPerson：原地转身 + 立刻 fire（快速通道，不走位）。
  // goToPerson 原样保留：测试脚本与"寻路过去"的调用还要它。
  function talkToPerson(id) {
    const g = people.get(id);
    if (!g) { return; }
    // 主角只转身看过去，不位移 —— 面板里谈的是这个人，画面里也该是这个人
    const dx = g.position.x - actor.position.x;
    const dz = g.position.z - actor.position.z;
    if (Math.hypot(dx, dz) > 0.02) { actor.rotation.y = Math.atan2(dx, dz); }
    clearWalk();
    fire("person:click", { id });
  }

  function fire(type, payload) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ source: "mini3d", type, payload }, "*");
    }
    const cb = {
      "spot:click": opts.onSpot,
      "person:click": opts.onPerson,
      "actor:arrived": opts.onArrived,
      "actor:seat": opts.onSeat,
      "actor:blocked": opts.onBlocked
    }[type];
    if (cb) { cb(payload); }
  }

  // ---------------------------------------------------------------- 循环
  const clock = new THREE.Clock();
  let idleSince = performance.now();

  // 自适应分辨率：帧率连续 3 秒低于 45 就把 pixelRatio 降一档（1.5 → 1.25 → 1.0），
  // 只降不升，避免在 45 帧边界来回抖。桌面不启用（桌面没有降级必要，也不影响回归）。
  const quality = {
    base: Math.min(window.devicePixelRatio || 1, PIXEL_RATIO_CAP),
    ratio: Math.min(window.devicePixelRatio || 1, PIXEL_RATIO_CAP),
    fps: 0, frames: 0, acc: 0, lowSec: 0,
    // 首 2.5 秒不算样本：编译着色器 / 建贴图的那几帧天生慢，不能一进场景就降画质
    startedAt: performance.now()
  };
  function setPixelRatio(r) {
    const next = Math.max(1, Math.min(quality.base, Math.round(r * 100) / 100));
    if (Math.abs(next - quality.ratio) < 0.01) { return; }
    quality.ratio = next;
    renderer.setPixelRatio(next);
    renderer.setSize(host.clientWidth || window.innerWidth,
                     host.clientHeight || window.innerHeight, false);
  }
  function sampleQuality(dt) {
    if (!IS_MOBILE_SCENE || document.visibilityState === "hidden") { return; }
    if (performance.now() - quality.startedAt < 2500) { return; }  // 首屏编译期不采样
    if (!(dt > 0) || dt > 0.5) { return; }        // 切后台回来的大跳帧不算样本
    quality.frames += 1;
    quality.acc += dt;
    if (quality.acc < 1) { return; }
    quality.fps = quality.frames / quality.acc;
    quality.frames = 0;
    quality.acc = 0;
    if (quality.fps < 45) { quality.lowSec += 1; } else { quality.lowSec = 0; }
    if (quality.lowSec >= 3 && quality.ratio > 1.001) {
      setPixelRatio(Math.max(1, quality.ratio - 0.25));
      quality.lowSec = 0;
    }
  }

  function tick() {
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;
    sampleQuality(dt);

    // 走位
    if (state.path.length) {
      const next = state.path[0];
      const dx = next.x - actor.position.x, dz = next.z - actor.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.12) {
        state.path.shift();
        if (!state.path.length) {
          const want = Math.atan2(actor.rotation.y >= 0 ? 0 : 0, 1);
          ring.visible = false;
          const pending = state.pending;
          state.pending = null;
          if (pending && pending.seat) {
            state.sitting = true;
            actor.rotation.y = pending.facing || actor.rotation.y;
            fire("actor:seat", { id: pending.id });
          } else {
            fire("actor:arrived", { x: actor.position.x, z: actor.position.z });
            if (pending) { fire(pending.type === "spot" ? "spot:click" : "person:click", { id: pending.id }); }
          }
        }
      } else {
        const step = Math.min(dist, SPEED * dt);
        actor.position.x += (dx / dist) * step;
        actor.position.z += (dz / dist) * step;
        const wantYaw = Math.atan2(dx, dz);
        let diff = wantYaw - actor.rotation.y;
        while (diff > Math.PI) { diff -= Math.PI * 2; }
        while (diff < -Math.PI) { diff += Math.PI * 2; }
        actor.rotation.y += Math.max(-0.14, Math.min(0.14, diff));
        state.phase += dt * 7.5;
      }
      state.walking = true;
    } else {
      state.walking = false;
      state.phase += dt * 1.6;
    }

    // 坐下 / 起身：走路或点击地面就自动站起
    if (state.path.length && state.sitting) { state.sitting = false; }
    if (state.sitting) {
      state.phase += dt * 1.2;
    }

    // 摆臂 / 走路起伏
    const parts = actor.userData.parts;
    const swing = state.walking ? Math.sin(state.phase) * 0.5 : Math.sin(state.phase) * 0.03;
    parts.arms[0].rotation.x = swing;
    parts.arms[1].rotation.x = -swing;
    if (state.sitting) {
      // 坐姿：大腿抬平、小腿垂下来。髋关节在 0.80，座面 0.45 → 整体下沉 0.35。
      // 膝盖必须反向转回来，否则小腿会跟着大腿一起往前伸（旧版就是"两条腿平举"）。
      parts.legs[0].rotation.x = -Math.PI / 2;
      parts.legs[1].rotation.x = -Math.PI / 2;
      if (parts.knees) {
        parts.knees[0].rotation.x = Math.PI / 2;
        parts.knees[1].rotation.x = Math.PI / 2;
      }
      parts.arms[0].rotation.x = -0.15;
      parts.arms[1].rotation.x = -0.15;
      actor.position.y = (state.seatY ?? 0.45) - 0.80 + Math.sin(state.phase) * 0.006;
    } else {
      parts.legs[0].rotation.x = -swing * 0.9;
      parts.legs[1].rotation.x = swing * 0.9;
      if (parts.knees) {
        // 迈步时屈膝：腿往后摆的那一侧弯得多一点（脚跟抬起），不是两根直棍
        parts.knees[0].rotation.x = 0.08 + Math.max(0, swing) * 0.35;
        parts.knees[1].rotation.x = 0.08 + Math.max(0, -swing) * 0.35;
      }
      actor.position.y = state.walking ? Math.abs(Math.sin(state.phase)) * 0.035 : 0;
    }

    // 站位人物呼吸
    people.forEach((g, id) => {
      const ph = (id.charCodeAt(1) || 0) * 0.7;
      // 坐着的人整体抬到椅面高度（0.42），否则看起来像蹲在半空
      const baseY = g.userData.sit ? (g.userData.baseY || 0) : 0;
      g.position.y = baseY + Math.sin(t * 1.3 + ph) * 0.008;
    });

    // 浮尘缓慢上浮，到顶回到底部
    if (state.dust) {
      const arr = state.dust.geometry.attributes.position.array;
      for (let i = 1; i < arr.length; i += 3) {
        arr[i] += dt * 0.05;
        if (arr[i] > 2.8) { arr[i] = 0.15; }
      }
      state.dust.geometry.attributes.position.needsUpdate = true;
    }

    // 灯微呼吸
    sun.intensity = 2.6 * (1 + Math.sin(t * 1.7) * 0.004);

    // 相机跟随（死区 + 回正）。截图探针可以 setCam({lock:true}) 钉住视点，
    // 否则补间会把人从取景框里慢慢拽走。
    if (!state.focusLock) {
      const dxc = actor.position.x - state.focus.x;
      const dzc = actor.position.z - state.focus.z;
      if (Math.hypot(dxc, dzc) > 3) {
        state.focus.x += dxc * 0.08;
        state.focus.z += dzc * 0.08;
      } else {
        state.focus.x += dxc * 0.03;
        state.focus.z += dzc * 0.03;
      }
      state.focus.y += (EYE_H - state.focus.y) * 0.1;
    }

    placeCamera();

    // 姓名牌：按到相机的距离淡出（远景不糊成一片）。机位可能在外部（外壳 flight），
    // 所以每帧读 camera，不缓存距离。
    updateNameplates();

    // 场景自己的微动：钟摆、指示灯、贴片呼吸……都由场景侧接管（幅度按 §1 第 16 条，2% 量级）
    if (opts.onFrame) { opts.onFrame(t, dt); }

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  function resize() {
    const w = host.clientWidth || window.innerWidth;
    const h = host.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    placeCamera();
  }
  window.addEventListener("resize", resize);

  resize();
  placeCamera();
  requestAnimationFrame(tick);

  // 调试句柄：截图探针/测试脚本要看渲染器时用，不进任何业务逻辑
  window.__dbg = { THREE, scene, camera, renderer, sun, fill, bounce, hemi,
    quality: () => ({ mobile: IS_MOBILE_SCENE, cap: PIXEL_RATIO_CAP,
                      pixelRatio: +quality.ratio.toFixed(2), fps: +quality.fps.toFixed(1),
                      lowSec: quality.lowSec, shadow: SHADOW_SIZE }) };

  return {
    walkTo,
    goToProp,
    goToPerson,
    actorPos: () => ({ x: actor.position.x, z: actor.position.z }),
    stats: () => ({ path: state.path.length, walking: state.walking, sitting: state.sitting,
                    camDist: Math.round(state.camDist), yaw: +state.camYaw.toFixed(2),
                    actorY: +actor.position.y.toFixed(3),
                    actorXZ: [+actor.position.x.toFixed(2), +actor.position.z.toFixed(2)] }),
    // 调试用：查某点是否被标成障碍、以及整行障碍分布
    blockedAt: (x, z) => blocked[cell(z) * COLS + cell(x)] === 1,
    debugPath: (x, z) => {
      const from = [cell(actor.position.x), cell(actor.position.z)];
      const goal = freeNear(blocked, cell(x), cell(z));
      const start = freeNear(blocked, ...from) || from;
      const cells = goal ? astar(blocked, start, goal) : null;
      const nb = goal ? [[1,0],[-1,0],[0,1],[0,-1]].filter(([dc, dr]) => {
        const c2 = goal[0] + dc, r2 = goal[1] + dr;
        return c2 >= 0 && r2 >= 0 && c2 < COLS && r2 < COLS && !blocked[r2 * COLS + c2];
      }).length : -1;
      return { from, start, goal, len: cells ? cells.length : 0,
               fromBlocked: blocked[from[1] * COLS + from[0]] === 1,
               goalBlocked: goal ? blocked[goal[1] * COLS + goal[0]] === 1 : null,
               goalFreeNeighbors: nb };
    },
    rowOf: (z) => {
      const r = cell(z), out = [];
      for (let c = 0; c < COLS; c++) { out.push(blocked[r * COLS + c] ? 1 : 0); }
      return out.join("");
    },
    setCameraOwner: (v) => { cameraExternal = !!v; },
    camera,
    setActor: (x, z) => { actor.position.set(x, 0, z); state.focus.set(x, EYE_H, z); placeCamera(); },

    // 截图探针用：直接摆机位。§1.3 的自检要求"每转 90° 截一张"，
    // 没有这个入口就只能靠拖鼠标，截出来的角度全靠手感，没法复核。
    setCam: (o = {}) => {
      if (o.yaw !== undefined) { state.camYaw = o.yaw; }
      if (o.pitch !== undefined) { state.camPitch = Math.max(CAM_PITCH_MIN, Math.min(CAM_PITCH_MAX, o.pitch)); }
      if (o.dist !== undefined) { state.camDist = Math.max(CAM_DIST_MIN, Math.min(CAM_DIST_MAX, o.dist)); }
      if (o.focus) { state.focus.set(o.focus[0], o.focus[1] ?? EYE_H, o.focus[2]); }
      if (o.lock !== undefined) { state.focusLock = !!o.lock; }   // 截图探针：钉住视点
      placeCamera();
    },
    hideActor: (v = true) => { actor.visible = !v; },
    hidePeople: (v = true) => { for (const g of allPeople) { g.visible = !v; } },
    // 可点物件的珊瑚描边开关（截图/性能兜底）：__mini.setHighlight(false)
    setHighlight,
    // 面数与绘制调用：§7 第 6 条要靠它说话，不靠肉眼估
    info: () => ({
      tris: renderer.info.render.triangles,
      calls: renderer.info.render.calls,
      props: propById.size,
      people: people.size,
      plates: nameplates.length,
      yaw: +state.camYaw.toFixed(3),
      pitch: +state.camPitch.toFixed(3),
      dist: +state.camDist.toFixed(2)
    }),
    // 姓名牌状态（验收用）：名字 / 是否可交互 / 当前透明度 / 离相机多远
    plates: () => nameplates.map((p) => {
      p.root.getWorldPosition(_plateWorld);
      return {
        name: p.sprite.userData.plateName || "",
        role: p.sprite.userData.plateRole || "",
        npc: !!p.sprite.userData.npc,
        opacity: +p.sprite.material.opacity.toFixed(2),
        base: p.base,
        dist: +Math.hypot(camera.position.x - _plateWorld.x,
                          camera.position.z - _plateWorld.z).toFixed(1)
      };
    }),
    resize
  };
}
