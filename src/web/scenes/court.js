// S2 · 社区篮球场（黄昏 19:00）—— 广场舞案主场景
// -----------------------------------------------------------------------------
// 按 docs/场景与人物建模提示词.md v5 §3 S2（第 275 行起）重做（2026-11-04，质量第一）。
// 七段一一对应：画面风格 / 底座与构图 / 时间与氛围 / 场地 / 陈设 / 基础动效 / 避免出现。
//
//  ① 地面是主角：塑胶场地用**纯色 + 白线 + 半透贴片**，旧的 1800 噪点 rubberTex 已删。
//     磨损、占位粉笔圈、球鞋磨痕全部是几何薄片，没有一张噪点贴图。
//  ② 颜色只从 kit.PAL 里取；唯三例外都是提示词点名的：
//     塑胶 #4f7f96 / 主光 #ffb078 / 补光 #7f9dc4 / 天空三段 #5b7ba0 #a9b6bd #f0a878。
//  ③ 四格：西北围网（16 米，一段被撞凹）+ 两根灯杆 / 东北篮架 + 三分线弧 /
//     西南看台两级 + 宣传栏 + 双桶垃圾桶 / 东南长椅两把 + 音箱 + 插线板 + 三辆自行车。
//  ④ onFrame 里 10 条 2% 量级的循环：灯闪一下后稳定、音箱红灯呼吸、围网凹处回弹、
//     树冠风动 0.02、半瓶水水面细晃、影子随天光变冷、车灯 12 秒扫过、落叶飘。
//
// 证据点位：地面占位痕 s_mark + 音箱 s_speaker（19:05 边界音量 78 分贝 / 舞队 23 人 / 打球 5 人）
// -----------------------------------------------------------------------------
import * as THREE from "./vendor/three.module.min.js";
import { PAL as C, M, b, cy, ball, bush, ground, grassTex, shade } from "./kit.js";
import { createScene } from "./scene3d.js";

window.__err = "";
window.addEventListener("error", (e) => {
  window.__err = (e.message || "error") + " @ " + (e.filename || "") + ":" + (e.lineno || 0);
});

// ---------------------------------------------------------------- 动画句柄
// 全部 2% 量级；onFrame 统一驱动，任何一条都不许"动得像 bug"
const A = {
  lampFace: null,      // 亮了的那盏球场灯（灯面）
  pool: null,          // 地面的冷亮斑
  led: null,           // 音箱红灯
  woofer: null,        // 低音单元（随节拍轻振）
  dent: null,          // 围网被撞凹的那一段
  canopies: [],        // 树冠
  water: null,         // 半瓶水的水面
  car: null,           // 远处车灯
  falls: [],           // 飘落的叶子
  ledMark: null,
  halo: null,          // 亮着那盏灯的光晕
  poolSoft: null,      // 冷斑外面的半影
  ledGlow: null,       // 音箱红灯的红晕
  stripLED: null       // 插线板上的小红灯
};

// ---------------------------------------------------------------- 常量
const RUBBER = "#4f7f96";          // §3 S2 定死的塑胶场色（本文件唯一自带的场景色）
const PX = 0, PZ = -0.4;           // 球场中心
const CW = 14.0, CD = 9.6;         // 球场尺寸（半个场）
const FZ = -6.6;                   // 北围网
const FX = 8.0;                    // 东围网

// ---------------------------------------------------------------- 基本件
// 地面薄片：不参与拾取（否则点地面会变成"走到那个物件"），只接收阴影
function noPick(m) { m.raycast = () => {}; return m; }

function slab(w, d, color, x, z, y = 0.006, op = 1, order = 0) {
  const mat = op < 1
    ? M(color, { transparent: true, opacity: op, depthWrite: false })
    : M(color);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.renderOrder = order;
  m.receiveShadow = op >= 1;
  return noPick(m);
}

function disk(r, color, x, z, y = 0.02, op = 1, order = 0, sx = 1, sz = 1) {
  const mat = op < 1
    ? M(color, { transparent: true, opacity: op, depthWrite: false })
    : M(color);
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 40), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.scale.set(sx, sz, 1);
  m.renderOrder = order;
  return noPick(m);
}

// 弧/环（白线、罚球圈、粉笔圈）：a0→a1 是弧度
function ring(r, thick, color, x, z, y, a0 = 0, a1 = Math.PI * 2, op = 0.62, order = 0, sx = 1, sz = 1) {
  const geo = new THREE.RingGeometry(Math.max(0.002, r - thick / 2), r + thick / 2, 72, 1, a0, a1 - a0);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide
  }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.scale.set(sx, sz, 1);
  m.renderOrder = order;
  return noPick(m);
}

// 贴地斜片（磨痕、粉笔碎、传单）：先躺平再绕法线转
function patch(w, d, color, x, z, y, op, rot = 0, order = 4) {
  const m = slab(w, d, color, x, z, y, op, order);
  m.rotation.z = rot;
  return m;
}

// 折线管（篮网、车架、灯臂、电线）
function tube(pts, r, color, closed = false, seg = 18) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, seg, r, 5, closed), M(color));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// 多段细线塞进一个 BufferGeometry：链网、辐条、篮网
function segs(list, color, op = 1) {
  const pos = [];
  for (const [p, q] of list) { pos.push(p[0], p[1], p[2], q[0], q[1], q[2]); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
    color, transparent: true, opacity: op, depthWrite: false
  }));
  l.renderOrder = 1;
  return l;
}

// ============================================================================
// 地面：绿化带 / 人行道 / 球场 / 白线 / 痕迹
// ============================================================================
const T = { grass: grassTex(4, 4) };

function groundBase() {
  const g = new THREE.Group();
  // 外圈绿化带（底座边缘切在绿化带外面，切面利落）
  g.add(ground(18.4, 18.4, 0, 0, T.grass, C.white, 0.003));
  // 人行道 / 广场铺装
  g.add(slab(17.0, 14.0, C.road, 0, 0, 0.006));
  // 铺装缝：横四竖五，很淡，只用来"分格"，不是噪点
  for (let i = -1; i <= 2; i++) {
    g.add(slab(17.0, 0.03, C.ink, 0, i * 3.5, 0.0075, 0.07, 1));
    g.add(slab(0.03, 14.0, C.ink, i * 4.25, 0, 0.0075, 0.07, 1));
  }
  // 南侧人行道上一条浅浅的排水坡（贴片）
  g.add(slab(17.0, 0.5, C.ink, 0, 6.75, 0.0074, 0.05, 1));
  return g;
}

function curbs() {
  const g = new THREE.Group();
  const Y = 0.045;
  g.add(b(17.4, 0.09, 0.16, C.sand, 0, Y, -7.0));
  g.add(b(17.4, 0.09, 0.16, C.sand, 0, Y, 7.0));
  g.add(b(0.16, 0.09, 13.8, C.sand, -8.5, Y, 0));
  g.add(b(0.16, 0.09, 13.8, C.sand, 8.5, Y, 0));
  // 路缘石的分缝（四角 + 每 1.7 米一道，靠几块很薄的暗片暗示）
  for (let i = 0; i < 10; i++) {
    g.add(b(0.03, 0.095, 0.17, C.ink, -7.65 + i * 1.7, Y, 7.0));
    g.add(b(0.03, 0.095, 0.17, C.ink, -7.65 + i * 1.7, Y, -7.0));
  }
  for (let i = 0; i < 8; i++) {
    g.add(b(0.17, 0.095, 0.03, C.ink, -8.5, Y, -6.0 + i * 1.7));
    g.add(b(0.17, 0.095, 0.03, C.ink, 8.5, Y, -6.0 + i * 1.7));
  }
  return g;
}

// 不规则贴片：轮廓用几层正弦叠出毛边，比完美的椭圆更像"磨出来的/踩出来的"
function blob(cx, cz, rx, rz, color, op, y, seed, order = 2) {
  const seg = 34;
  const pts = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const k = 1
      + 0.075 * Math.sin(a * 3 + seed)
      + 0.045 * Math.sin(a * 5.3 + seed * 2.7)
      + 0.022 * Math.sin(a * 9.1 + seed * 4.1);
    pts.push(new THREE.Vector2(Math.cos(a) * rx * k, Math.sin(a) * rz * k));
  }
  const m = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pts)),
    M(color, { transparent: true, opacity: op, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(cx, y, cz);
  m.renderOrder = order;
  return noPick(m);
}

function courtSurface() {
  const g = new THREE.Group();
  // 场边一圈浅色混凝土（0.25 宽），把场地从人行道里"托"出来
  g.add(slab(14.5, 10.1, C.sand, 0, 0, 0.008));
  // 塑胶：纯色，零噪点
  g.add(slab(14.0, 9.6, RUBBER, 0, 0, 0.012));
  // 三秒区刷了一层更深的漆（半透薄片，不是贴图）
  g.add(slab(4.6, 3.2, C.navy, 4.7, 0, 0.014, 0.09, 2));
  // 中圈那一块略亮（常年踩踏磨出来的）
  g.add(blob(-7, 0, 1.15, 1.05, C.sand, 0.07, 0.0145, 2.2, 2));
  return g;
}

function courtLines() {
  const g = new THREE.Group();
  const LW = 0.09, OP = 0.62, Y = 0.018;
  // 一个半场：只有篮筐这一头有线，另一端到中线为止，地上干干净净
  g.add(slab(CW, LW, C.cream, 0, -CD / 2, Y, OP, 3));      // 北边线
  g.add(slab(CW, LW, C.cream, 0, CD / 2, Y, OP, 3));       // 南边线
  g.add(slab(LW, CD, C.cream, -CW / 2, 0, Y, OP, 3));      // 中线（半场的另一端）
  g.add(slab(LW, CD, C.cream, CW / 2, 0, Y, OP, 3));       // 底线
  // 罚球区：3.2 宽 × 4.6 长的竖长条
  const KEY_W = 3.2, KEY_X = 2.4;
  g.add(slab(LW, KEY_W, C.cream, KEY_X, 0, Y, OP, 3));     // 罚球线
  g.add(slab(4.6, LW, C.cream, 4.7, -KEY_W / 2, Y, OP, 3));
  g.add(slab(4.6, LW, C.cream, 4.7, KEY_W / 2, Y, OP, 3));
  g.add(ring(1.17, LW, C.cream, KEY_X, 0, Y + 0.001, 0, Math.PI * 2, OP, 3));
  // 三分线：半径 5.17，从两段直的端点起画整条弧（ring 收的是 a0 / a1 两个端点角）
  g.add(ring(5.17, LW, C.cream, 5.9, 0, Y + 0.001, 2.176, 4.107, OP, 3));
  g.add(slab(4.04, LW, C.cream, 4.98, -4.25, Y, OP, 3));
  g.add(slab(4.04, LW, C.cream, 4.98, 4.25, Y, OP, 3));
  return g;
}

// 粉笔痕只留一处：舞队占位时画歪的一个圈，被踩断成两截，旁边一截残线 + 粉笔头。
// 画成细折线而不是"圆环薄片"——圆规式的正圆在球场上一眼就假。
function chalkMarks() {
  const g = new THREE.Group();
  const arc = (r, op, cover, n, a0, ox, oz) => {
    const total = Math.PI * 2 * cover;
    const gap = (Math.PI * 2 - total) / n;
    let a = a0;
    for (let k = 0; k < n; k++) {
      const span = total / n;
      const steps = Math.max(5, Math.round(span * 14));
      const list = [];
      let prev = null;
      for (let s = 0; s <= steps; s++) {
        const t = a + (span * s) / steps;
        const rr = r * (1 + 0.045 * Math.sin(t * 3 + k * 2.1) + 0.02 * Math.sin(t * 7.7));
        const p = [Math.cos(t) * rr + ox, 0.022, Math.sin(t) * rr + oz];
        if (prev) { list.push([prev, p]); }
        prev = p;
      }
      g.add(segs(list, C.white, op));
      a += span + gap;
    }
  };
  arc(0.58, 0.42, 0.62, 2, 0.35, 0, 0);
  arc(0.62, 0.20, 0.20, 1, 3.45, 0.03, 0.02);     // 同一圈被踩断的一小截
  arc(0.40, 0.15, 0.34, 1, 5.10, 1.30, 1.00);     // 旁边漏画的一小段
  // 两粒粉笔点 + 一截粉笔头
  g.add(ring(0.07, 0.03, C.white, -0.48, 0.33, 0.0225, 0, Math.PI * 2, 0.12, 5));
  g.add(ring(0.07, 0.03, C.white, 0.54, -0.40, 0.0225, 0, Math.PI * 2, 0.10, 5));
  const ch = b(0.07, 0.017, 0.017, C.white, 0.60, 0.011, 0.34, null);
  ch.rotation.y = 0.7;
  g.add(ch);
  return g;
}

// 磨损失色：只在篮下留一块（毛边，不是规整椭圆）
function wearPatches() {
  const g = new THREE.Group();
  g.add(blob(5.35, -0.6, 1.60, 1.05, C.sand, 0.10, 0.0145, 1.2));
  g.add(blob(4.35, -0.1, 1.00, 0.74, C.sand, 0.06, 0.0146, 3.4));
  return g;
}

// 一条球鞋磨痕 + 两个转身的鞋底印（几何薄片，不是贴图）
function scuffMarks() {
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    g.add(patch(1.05 - i * 0.14, 0.085, C.ink, 4.55 + i * 0.16, -2.6 + i * 0.30,
      0.0205, 0.13 + i * 0.01, -0.42, 6));
  }
  for (let i = 0; i < 2; i++) {
    g.add(ring(0.30 + i * 0.16, 0.07, C.ink, 4.9 + i * 0.38, -0.9, 0.0205,
      0.6, 3.0, 0.10, 6));
  }
  return g;
}

// 地面上的一堆小东西：传单、落叶、杂草、粉笔盒（都在场外或围网边）
function debris() {
  const g = new THREE.Group();
  // 被踩过的传单（两折）
  const f1 = patch(0.26, 0.19, C.white, -0.9, 3.25, 0.017, 0.9, 0.55, 6);
  const f2 = patch(0.19, 0.14, C.cream, -0.78, 3.12, 0.0172, 0.8, -0.5, 6);
  g.add(f1, f2);
  // 落叶堆（围网边）+ 零散几片
  for (let i = 0; i < 9; i++) {
    const lf = patch(0.15, 0.09, i % 3 ? C.wood : C.sand,
      -4.6 + (i % 3) * 0.42 + (i * 0.13), -6.0 + (i % 2) * 0.34, 0.018, 0.8, i * 0.9, 6);
    g.add(lf);
  }
  for (let i = 0; i < 5; i++) {
    g.add(patch(0.13, 0.08, i % 2 ? C.sand : C.wood,
      2.2 + i * 0.85, 5.9 + (i % 2) * 0.3, 0.018, 0.7, i * 1.3, 6));
  }
  // 围网边两丛杂草
  for (const [x, z, r] of [[-7.6, -5.95, 0.13], [5.4, -6.1, 0.11]]) {
    const wg = bush(x, z, r);
    wg.scale.y = 0.55;
    g.add(wg);
  }
  // 粉笔盒（塑料小盒，盖子开着）
  g.add(b(0.16, 0.07, 0.11, C.blue, 2.55, 0.036, 3.35));
  g.add(b(0.15, 0.02, 0.10, C.white, 2.55, 0.082, 3.38));
  return g;
}

// 两只矿泉水瓶：一只立着半瓶水（水面会晃），一只倒在边线外
function bottles() {
  const g = new THREE.Group();
  // 立着的半瓶
  const bt = new THREE.Group();
  bt.add(cy(0.045, 0.042, 0.20, C.glass, 0, 0.10, 0, 12));
  bt.add(cy(0.044, 0.044, 0.10, C.sea, 0, 0.055, 0, 12));
  const w = new THREE.Mesh(new THREE.CircleGeometry(0.041, 14),
    M(C.blue, { transparent: true, opacity: 0.85 }));
  w.rotation.x = -Math.PI / 2;
  w.position.set(0, 0.106, 0);
  bt.add(w);
  A.water = w;
  bt.add(cy(0.021, 0.024, 0.05, C.white, 0, 0.225, 0, 10));   // 瓶口
  bt.add(b(0.05, 0.03, 0.05, C.blue, 0, 0.255, 0));            // 盖
  bt.add(b(0.07, 0.05, 0.012, C.cream, 0, 0.12, 0.043));       // 标签
  g.add(bt);
  // 倒着的那只（横躺）
  const fall = new THREE.Group();
  const body = cy(0.044, 0.041, 0.19, C.glass, 0, 0, 0, 12);
  body.rotation.z = Math.PI / 2;
  fall.add(body);
  const cap = cy(0.022, 0.022, 0.045, C.blue, 0.115, 0, 0, 10);
  cap.rotation.z = Math.PI / 2;
  fall.add(cap);
  fall.position.set(0.0, 0.045, 0.62);
  fall.rotation.y = 0.5;
  g.add(fall);
  return g;
}

// 场边一颗没人捡的球
function strayBall() {
  const g = new THREE.Group();
  g.add(ball(0.12, C.coral, 0, 0.12, 0, 14));
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(new THREE.TorusGeometry(0.121, 0.006, 4, 20), M(C.ink));
    s.rotation.set(i === 0 ? Math.PI / 2 : 0, i === 1 ? Math.PI / 2 : 0, 0);
    s.position.set(0, 0.12, 0);
    g.add(s);
  }
  return g;
}

// ============================================================================
// 围网：链网用线段画（没有贴图），一段被撞凹
// ============================================================================
function chainLinks(w, h, s = 0.26) {
  const out = [];
  const x0 = -w / 2, x1 = w / 2, y0 = 0.05, y1 = h - 0.06;
  for (let c = x0 - y1; c <= x1 - y0; c += s) {
    const ya = Math.max(y0, x0 - c), yb = Math.min(y1, x1 - c);
    if (yb - ya > 0.03) { out.push([[c + ya, ya], [c + yb, yb]]); }
  }
  for (let c = x0 + y0; c <= x1 + y1; c += s) {
    const ya = Math.max(y0, c - x1), yb = Math.min(y1, c - x0);
    if (yb - ya > 0.03) { out.push([[c - ya, ya], [c - yb, yb]]); }
  }
  return out;
}

// 被球砸出来的一处鼓包：中间 0.30、两端归零
function dentAt(x, w) {
  const t = 1 - (x / (w * 0.56)) ** 2;
  return t > 0 ? t * t * 0.30 : 0;
}

function fencePanel(w, h, opt) {
  const g = new THREE.Group();
  const dented = !!opt.dent;
  const zAt = (x) => (dented ? dentAt(x, w) : 0);
  const lines = chainLinks(w, h).map(([p, q]) => [
    [p[0], p[1], zAt(p[0])], [q[0], q[1], zAt(q[0])]
  ]);
  g.add(segs(lines, C.ink, 0.42));
  if (dented) {
    // 撞凹段：上下横杆顺着鼓包弯过去
    for (const y of [0.10, h * 0.52, h - 0.03]) {
      const pts = [];
      for (let i = 0; i <= 12; i++) {
        const x = -w / 2 + (w * i) / 12;
        pts.push([x, y, zAt(x)]);
      }
      g.add(tube(pts, 0.024, C.navy, false, 16));
    }
  } else {
    for (const y of [0.10, h * 0.52, h - 0.03]) {
      g.add(b(w, 0.045, 0.045, C.navy, 0, y, 0));
    }
  }
  for (const x of opt.posts || []) {
    g.add(cy(0.042, 0.05, h + 0.10, C.navy, x, (h + 0.10) / 2, 0, 8));
    g.add(cy(0.048, 0.048, 0.05, C.dark, x, h + 0.11, 0, 8));
  }
  return g;
}

// ============================================================================
// 球场灯：灯杆 + 内弯灯臂 + 朝下的灯头
// ============================================================================
function lampPost(lit) {
  const g = new THREE.Group();
  g.add(b(0.62, 0.10, 0.62, C.road, 0, 0.05, 0));               // 混凝土基础
  g.add(b(0.42, 0.26, 0.42, C.dark, 0, 0.19, 0));                // 底座
  g.add(cy(0.075, 0.11, 4.30, C.navy, 0, 2.36, 0, 10));          // 杆
  for (const s of [-1, 1]) {                                      // 两根斜撑（上端向杆身收）
    const br = b(0.05, 0.86, 0.05, C.navy, s * 0.19, 0.62, 0.03);
    br.rotation.z = s * 0.27;
    g.add(br);
  }
  // 灯臂：从杆顶向场内（+z）伸出去，末端微微上扬
  g.add(tube([[0, 4.44, 0], [0, 4.62, 0.22], [0, 4.68, 0.62], [0, 4.66, 0.94]], 0.042, C.navy, false, 14));
  // 灯头
  const head = new THREE.Group();
  head.add(b(0.62, 0.13, 0.34, C.navy, 0, 0.02, 0));
  head.add(b(0.5, 0.05, 0.26, C.dark, 0, -0.055, 0));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.24),
    M(C.yellow, { emissive: C.yellow, emissiveIntensity: lit ? 1.85 : 0.04, side: THREE.DoubleSide }));
  face.rotation.x = Math.PI / 2;
  face.position.set(0, -0.078, 0);
  head.add(face);
  head.position.set(0, 4.63, 0.92);
  head.rotation.x = 0.24;
  g.add(head);
  if (lit) { A.lampFace = face; }
  return g;
}

// ============================================================================
// 篮架：立柱 + 悬臂 + 半透篮板 + 红漆篮筐 + 篮网
// ============================================================================
function hoop() {
  const g = new THREE.Group();
  g.add(b(0.74, 0.10, 0.74, C.road, 0, 0.05, 0));                  // 基础
  g.add(b(0.52, 0.24, 0.52, C.dark, 0, 0.21, 0));                   // 配重箱
  g.add(b(0.17, 2.86, 0.17, C.navy, 0, 1.62, 0));                   // 立柱
  g.add(b(0.22, 0.07, 0.22, C.navy, 0, 3.10, 0));
  // 悬臂：从柱顶朝场内（-x）伸出 1.06
  g.add(b(1.06, 0.15, 0.15, C.navy, -0.50, 3.02, 0));
  for (const s of [-1, 1]) {                                        // 两根斜撑（x-y 平面）
    const br = b(1.02, 0.05, 0.05, C.navy, -0.46, 2.78, s * 0.09);
    br.rotation.z = -0.36;
    g.add(br);
  }
  g.add(cy(0.085, 0.085, 0.16, C.navy, -0.98, 3.02, 0, 8));
  // 篮板（半透亚克力：低透明、不投影；用 toon 材质，别让高光把板子打成一块纯白）
  const bd = new THREE.Mesh(new THREE.BoxGeometry(0.035, 1.05, 1.75),
    M(C.glass, { transparent: true, opacity: 0.34, depthWrite: false }));
  bd.position.set(-1.06, 3.06, 0);
  bd.castShadow = false;
  g.add(bd);
  // 篮板白框（上、下、左、右）
  g.add(b(0.06, 0.055, 1.79, C.cream, -1.06, 3.61, 0));
  g.add(b(0.06, 0.055, 1.79, C.cream, -1.06, 2.51, 0));
  g.add(b(0.06, 1.11, 0.055, C.cream, -1.06, 3.06, -0.895));
  g.add(b(0.06, 1.11, 0.055, C.cream, -1.06, 3.06, 0.895));
  // 红漆瞄准框
  g.add(b(0.028, 0.028, 0.60, C.coral, -1.088, 3.285, 0));
  g.add(b(0.028, 0.028, 0.60, C.coral, -1.088, 2.835, 0));
  g.add(b(0.028, 0.45, 0.028, C.coral, -1.088, 3.06, -0.30));
  g.add(b(0.028, 0.45, 0.028, C.coral, -1.088, 3.06, 0.30));
  // 篮筐 + 连接件（筐心在篮板前面 0.30）
  const RIMX = -1.36;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.225, 0.017, 8, 26), M(C.coral));
  rim.rotation.x = Math.PI / 2;
  rim.position.set(RIMX, 3.05, 0);
  rim.castShadow = true;
  g.add(rim);
  g.add(b(0.30, 0.055, 0.11, C.coral, -1.21, 3.05, 0));
  // 篮网：12 股之字线
  const net = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, a2 = ((i + 0.5) / 12) * Math.PI * 2;
    const top = [RIMX + Math.cos(a) * 0.215, 3.04, Math.sin(a) * 0.215];
    const mid = [RIMX + Math.cos(a2) * 0.165, 2.83, Math.sin(a2) * 0.165];
    const bot = [RIMX + Math.cos(a) * 0.115, 2.62, Math.sin(a) * 0.115];
    net.push([top, mid], [mid, bot]);
  }
  const netMesh = segs(net, C.cream, 0.62);
  netMesh.renderOrder = 3;
  g.add(netMesh);
  return g;
}

// ============================================================================
// 看台 / 宣传栏 / 长椅 / 音箱 / 插线板 / 双桶 / 自行车 / 电动车 / 饮水台
// ============================================================================
function stand() {
  const g = new THREE.Group();
  g.add(b(3.4, 0.34, 0.72, C.road, 0, 0.17, -0.36));              // 前级
  g.add(b(3.4, 0.66, 0.72, C.road, 0, 0.33, 0.36));               // 后级
  // 两道刷白的踏步鼻线（社区水泥看台的常见做法，也是这一场唯一的"白")
  g.add(b(3.44, 0.035, 0.10, C.cream, 0, 0.352, -0.71));
  g.add(b(3.44, 0.035, 0.10, C.cream, 0, 0.672, 0.01));
  // 踏步与立面的接缝
  g.add(b(3.44, 0.02, 0.03, C.ink, 0, 0.335, -0.66));
  g.add(b(3.44, 0.02, 0.03, C.ink, 0, 0.655, 0.06));
  for (let i = 0; i < 4; i++) {                                    // 边沿四个小塞子
    g.add(cy(0.038, 0.038, 0.05, C.dark, -1.25 + i * 0.84, 0.38, -0.55, 8));
  }
  for (const s of [-1, 1]) {                                       // 两端封边（同色，只留一道暗缝）
    g.add(b(0.05, 0.66, 1.44, C.road, s * 1.70, 0.33, 0.0));
    g.add(b(0.02, 0.66, 1.40, C.ink, s * 1.665, 0.33, 0.0));
  }
  // 前级边上掉了一小块角
  g.add(b(0.16, 0.10, 0.06, C.road, 1.56, 0.05, -0.72));
  return g;
}

function noticeBoard() {
  const g = new THREE.Group();
  for (const x of [-0.82, 0.82]) {
    g.add(cy(0.045, 0.052, 2.15, C.navy, x, 1.07, 0, 8));
    g.add(cy(0.075, 0.075, 0.06, C.dark, x, 0.03, 0, 8));
  }
  g.add(b(1.88, 1.14, 0.07, C.navy, 0, 1.46, 0));                  // 外框
  g.add(b(1.72, 0.98, 0.03, C.cream, 0, 1.46, 0.052));             // 板面
  g.add(b(1.94, 0.07, 0.28, C.navy, 0, 2.06, 0.06));               // 雨檐
  g.add(b(1.70, 0.13, 0.02, C.blue, 0, 1.87, 0.068));              // 顶条
  const cols = [C.white, C.peach, C.mint];
  for (let i = 0; i < 3; i++) {
    const x = -0.54 + i * 0.54;
    g.add(b(0.44, 0.60, 0.012, cols[i], x, 1.40, 0.070));
    g.add(b(0.26, 0.018, 0.006, C.coral, x, 1.63, 0.078));
    for (let k = 0; k < 4; k++) {
      g.add(b(0.32 - k * 0.05, 0.016, 0.006, C.ink, x, 1.55 - k * 0.085, 0.078));
    }
    g.add(cy(0.008, 0.008, 0.012, C.coral, x, 1.70, 0.079, 6));    // 图钉
  }
  return g;
}

function bench(broken) {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {                                     // 座面三条板
    g.add(b(1.72, 0.055, 0.14, C.wood, 0, 0.45, -0.14 + i * 0.155));
  }
  for (const s of [-1, 1]) {                                        // 铸铁腿
    g.add(b(0.07, 0.43, 0.46, C.dark, s * 0.72, 0.215, 0));
    g.add(b(0.09, 0.05, 0.52, C.dark, s * 0.72, 0.025, 0));
    g.add(b(0.06, 0.44, 0.06, C.dark, s * 0.72, 0.68, -0.22));
  }
  if (!broken) {
    for (let i = 0; i < 3; i++) {                                   // 靠背三条板
      g.add(b(1.72, 0.13, 0.05, C.wood, 0, 0.60 + i * 0.17, -0.235));
    }
  } else {
    g.add(b(1.72, 0.13, 0.05, C.wood, 0, 0.60, -0.235));
    g.add(b(0.72, 0.13, 0.05, C.wood, -0.5, 0.775, -0.235));        // 断掉一条：只剩左半
    const hang = b(0.34, 0.13, 0.05, C.wood, 0.52, 0.70, -0.20);    // 一头挂着的一块
    hang.rotation.z = -0.62;
    hang.rotation.x = 0.16;
    g.add(hang);
    g.add(b(0.05, 0.1, 0.05, C.ink, 0.30, 0.79, -0.235));           // 断口
  }
  // 搭在椅背上的一条毛巾
  g.add(b(0.42, 0.30, 0.03, C.cream, -0.35, 0.62, -0.26));
  g.add(b(0.42, 0.16, 0.03, C.white, -0.35, 0.50, -0.28));
  return g;
}

function speaker() {
  const g = new THREE.Group();
  g.add(b(0.46, 0.05, 0.34, C.ink, 0, 0.025, 0));                 // 底盘
  g.add(b(0.44, 0.64, 0.32, C.dark, 0, 0.35, 0));                 // 箱体
  g.add(b(0.40, 0.34, 0.02, C.ink, 0, 0.24, 0.17));               // 前面板
  const woofer = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.04, 20), M(C.ink));
  woofer.rotation.x = Math.PI / 2;
  woofer.position.set(0, 0.24, 0.185);
  g.add(woofer);
  A.woofer = woofer;
  g.add(cy(0.045, 0.045, 0.03, C.blue, 0, 0.49, 0.17, 12));       // 高音单元
  g.add(cy(0.05, 0.05, 0.012, C.ink, 0, 0.49, 0.183, 12));
  // 提手
  g.add(tube([[-0.10, 0.67, 0], [-0.06, 0.75, 0], [0.06, 0.75, 0], [0.10, 0.67, 0]], 0.016, C.ink, false, 10));
  // 红色指示灯（呼吸）：做得比真实略大一档，远景才看得见"次中心"
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.034, 0.016),
    M(C.coral, { emissive: C.coral, emissiveIntensity: 1.2 }));
  led.position.set(0.125, 0.585, 0.168);
  g.add(led);
  A.led = led;
  // 灯罩：一圈很淡的红晕
  const ringGlow = new THREE.Mesh(new THREE.CircleGeometry(0.055, 14),
    new THREE.MeshBasicMaterial({
      color: C.coral, transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
  ringGlow.position.set(0.125, 0.585, 0.178);
  g.add(ringGlow);
  A.ledGlow = ringGlow;
  // 旋钮
  for (let i = 0; i < 2; i++) {
    g.add(cy(0.022, 0.022, 0.02, C.cream, -0.12 + i * 0.09, 0.585, 0.168, 8));
  }
  return g;
}

function powerStrip() {
  const g = new THREE.Group();
  const st = b(0.38, 0.06, 0.15, C.cream, 0, 0.03, 0);
  st.rotation.y = 0.36;
  g.add(st);
  for (let i = 0; i < 3; i++) {
    const hole = b(0.05, 0.012, 0.055, C.ink, -0.11 + i * 0.11, 0.062, 0);
    hole.rotation.y = 0.36;
    g.add(hole);
  }
  const sw = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.016, 0.02),
    M(C.mint, { emissive: C.mint, emissiveIntensity: 1.1 }));
  sw.position.set(0.15, 0.066, 0.03);
  g.add(sw);
  A.stripLED = sw;
  // 绕两圈的线
  for (let i = 0; i < 2; i++) {
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.15 - i * 0.022, 0.011, 5, 20), M(C.ink));
    coil.rotation.x = Math.PI / 2;
    coil.position.set(0.10, 0.014 + i * 0.024, 0.24);
    g.add(coil);
  }
  // 线尾从插线板拖到音箱脚下
  g.add(tube([[0.05, 0.016, 0.34], [-0.18, 0.016, 0.42], [-0.55, 0.016, 0.20],
              [-0.92, 0.016, -0.36], [-1.12, 0.016, -0.62]], 0.009, C.ink, false, 18));
  return g;
}

function binPair() {
  const g = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const x = (i - 0.5) * 0.46;
    g.add(cy(0.18, 0.155, 0.50, i ? C.blue : C.mint, x, 0.25, 0, 14));
    g.add(cy(0.19, 0.19, 0.045, C.dark, x, 0.525, 0, 14));
    g.add(b(0.10, 0.02, 0.02, C.cream, x, 0.53, 0.16));
    g.add(cy(0.185, 0.185, 0.02, C.ink, x, 0.012, 0, 14));
  }
  g.add(b(0.92, 0.05, 0.06, C.dark, 0, 0.60, -0.19));               // 后横杆
  return g;
}

function fountain() {
  const g = new THREE.Group();
  g.add(b(0.36, 0.84, 0.32, C.blue, 0, 0.42, 0));
  g.add(b(0.42, 0.06, 0.38, C.cream, 0, 0.87, 0));
  g.add(cy(0.115, 0.09, 0.05, C.glass, 0, 0.90, 0.04, 16));
  g.add(tube([[0, 0.90, -0.08], [0, 1.02, -0.09], [0, 1.04, 0.0], [0, 1.02, 0.05]], 0.012, C.dark, false, 10));
  g.add(cy(0.007, 0.007, 0.14, C.sea, 0, 0.95, 0.05, 6));           // 一道细水柱
  g.add(b(0.34, 0.16, 0.02, C.cream, 0, 0.66, 0.17));               // 使用说明牌
  return g;
}

// 自行车：轮 + 菱形车架 + 把手 + 座 + 车筐
function bike(color) {
  const g = new THREE.Group();
  const R = 0.31;
  for (const z of [-0.53, 0.53]) {
    const tire = new THREE.Mesh(new THREE.TorusGeometry(R, 0.022, 6, 22), M(C.ink));
    tire.rotation.y = Math.PI / 2;
    tire.position.set(0, R, z);
    tire.castShadow = true;
    g.add(tire);
    const spokes = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      spokes.push([[0, R + Math.cos(a) * 0.29, z + Math.sin(a) * 0.29],
                   [0, R - Math.cos(a) * 0.29, z - Math.sin(a) * 0.29]]);
    }
    g.add(segs(spokes, C.navy, 0.5));
    g.add(cy(0.03, 0.03, 0.05, C.navy, 0, R, z, 8));
  }
  const hubR = [0, R, -0.53], hubF = [0, R, 0.53], bb = [0, 0.30, -0.02];
  const seatTop = [0, 0.74, -0.17], headTop = [0, 0.70, 0.34];
  g.add(tube([bb, [0, 0.46, 0.14], headTop], 0.022, color, false, 12));      // 下管
  g.add(tube([bb, seatTop], 0.022, color, false, 10));                        // 立管
  g.add(tube([seatTop, headTop], 0.020, color, false, 10));                   // 上管
  g.add(tube([bb, hubR], 0.016, color, false, 10));                           // 后下叉
  g.add(tube([seatTop, hubR], 0.016, color, false, 10));                      // 后上叉
  g.add(tube([headTop, hubF], 0.018, color, false, 10));                      // 前叉
  // 座 + 把 + 曲柄 + 车筐
  g.add(b(0.13, 0.05, 0.22, C.dark, 0, 0.78, -0.17));
  g.add(b(0.46, 0.026, 0.026, C.ink, 0, 0.77, 0.36));
  g.add(cy(0.028, 0.028, 0.06, C.navy, 0, 0.30, -0.02, 8));
  g.add(b(0.2, 0.02, 0.03, C.ink, 0.09, 0.30, 0.0));
  g.add(b(0.2, 0.02, 0.03, C.ink, -0.09, 0.30, 0.0));
  g.add(b(0.06, 0.05, 0.10, C.dark, 0.09, 0.31, 0.06));
  g.add(b(0.06, 0.05, 0.10, C.dark, -0.09, 0.31, -0.06));
  // 前车筐（铁条，几根线暗示）
  g.add(b(0.28, 0.18, 0.22, C.cream, 0, 0.62, 0.52));
  for (let i = 0; i < 3; i++) {
    g.add(b(0.30, 0.012, 0.012, C.ink, 0, 0.56 + i * 0.06, 0.63));
  }
  return g;
}

function scooter() {
  const g = new THREE.Group();
  for (const z of [-0.40, 0.42]) {
    const w = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.045, 6, 18), M(C.ink));
    w.rotation.y = Math.PI / 2;
    w.position.set(0, 0.21, z);
    g.add(w);
    g.add(cy(0.05, 0.05, 0.04, C.road, 0, 0.21, z, 8));
  }
  g.add(b(0.26, 0.06, 0.58, C.cream, 0, 0.20, 0.06));               // 踏板
  g.add(b(0.22, 0.30, 0.30, C.cream, 0, 0.38, -0.26));              // 车体
  g.add(b(0.24, 0.18, 0.26, C.blue, 0, 0.30, -0.44));               // 电池盒
  g.add(b(0.22, 0.08, 0.40, C.dark, 0, 0.56, -0.24));               // 座
  g.add(cy(0.03, 0.03, 0.14, C.ink, 0, 0.50, -0.24, 6));            // 座杆
  const stem = cy(0.032, 0.038, 0.62, C.blue, 0, 0.52, 0.44, 8);
  stem.rotation.x = -0.18;
  g.add(stem);
  g.add(b(0.52, 0.03, 0.03, C.ink, 0, 0.82, 0.50));                 // 车把
  g.add(b(0.05, 0.05, 0.05, C.coral, 0.24, 0.82, 0.50));            // 车把套
  g.add(b(0.05, 0.05, 0.05, C.coral, -0.24, 0.82, 0.50));
  g.add(b(0.24, 0.16, 0.16, C.cream, 0, 0.74, 0.60));               // 前筐
  g.add(b(0.10, 0.06, 0.05, C.yellow, 0, 0.86, 0.62));              // 车灯
  const mirror = cy(0.008, 0.008, 0.14, C.ink, 0.20, 0.90, 0.50, 4);
  mirror.rotation.z = 0.3;
  g.add(mirror);
  return g;
}

// ============================================================================
// 树：木干 + 两层的冠（冠是 kit.bush 堆的，绿色来自零件库）
// 树干用 PAL 的木色压暗一档（shade 是从 PAL 派生的，不是新色号）——黄昏的树是深色剪影
// ============================================================================
const TREE_WOOD = shade(C.wood, 0.70);
const TREE_BARK = shade(C.wood, 0.54);

function tree(h, r, ph) {
  const g = new THREE.Group();
  // 主干下粗上细，略歪一点（自然，不是一根柱子）
  const trunk = cy(0.085, 0.17, h * 0.74, TREE_WOOD, 0, h * 0.37, 0, 9);
  trunk.rotation.z = 0.035;
  g.add(trunk);
  // 两根主枝向上分叉
  for (let i = 0; i < 2; i++) {
    const a = (i ? 1.05 : -0.55) + ph;
    const br = cy(0.05, 0.085, h * 0.6, TREE_BARK, Math.cos(a) * 0.24, h * 0.74, Math.sin(a) * 0.22, 7);
    br.rotation.z = -Math.cos(a) * 0.52;
    br.rotation.x = Math.sin(a) * 0.52;
    g.add(br);
  }
  // 树冠：两层的蓬，压成偏椭圆的冠，不是一颗蘑菇
  const can = new THREE.Group();
  const spots = [[0, 0, 0, 1.00], [-0.46, 0.10, 0.14, 0.78], [0.44, 0.06, -0.12, 0.80],
                 [0.06, 0.16, 0.38, 0.70], [-0.08, 0.20, -0.36, 0.68],
                 [-0.26, 0.42, -0.10, 0.56], [0.30, 0.38, 0.22, 0.52]];
  for (const [dx, dy, dz, k] of spots) {
    const bl = bush(0, 0, r * k);
    bl.position.set(dx * r, h * 0.86 + dy * r * 2.0, dz * r);
    bl.scale.set(1.12, 0.72, 1.12);
    can.add(bl);
  }
  g.add(can);
  A.canopies.push({ o: can, ph });
  return g;
}

// 远处车灯：北围网后面扫过的一条冷白
function carGlow() {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.5),
    new THREE.MeshBasicMaterial({
      color: C.yellow, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    }));
  m.position.set(-11, 0.95, -6.95);
  m.renderOrder = 6;
  A.car = m;
  return m;
}

// ============================================================================
// 场景数据
// ============================================================================
const props = [
  // ---------------------------------------------------------------- 地面
  { id: "g_ground", x: 0, z: 0, w: 0.1, d: 0.1, passable: true, build: groundBase },
  { id: "s_curb", x: 0, z: 0, w: 0.1, d: 0.1, passable: true, build: curbs },
  { id: "g_court", x: PX, z: PZ, w: 0.1, d: 0.1, passable: true, build: courtSurface },
  { id: "s_lines", x: PX, z: PZ, w: 0.1, d: 0.1, passable: true, build: courtLines },

  // ---------------------------------------------------------------- 地面痕迹
  // 粉笔痕挪到篮筐这一侧（秦秀兰脚边），没篮筐的那半边地面保持干净
  { id: "s_mark", x: 2.2, z: 2.9, w: 0.1, d: 0.1, passable: true, build: chalkMarks,
    interact: { x: 2.2, z: 2.9 } },
  { id: "s_wear", x: 0, z: 0, w: 0.1, d: 0.1, passable: true, build: wearPatches },
  { id: "s_scuff", x: 0, z: 0, w: 0.1, d: 0.1, passable: true, build: scuffMarks },
  { id: "s_debris", x: 0, z: 0, w: 0.1, d: 0.1, passable: true, build: debris },
  { id: "s_bottles", x: -0.95, z: 4.80, w: 0.14, d: 0.5, passable: true, build: bottles,
    interact: { x: -1.3, z: 4.3 } },
  { id: "s_ball", x: 6.30, z: 1.05, w: 0.24, d: 0.24, passable: true, build: strayBall },

  // ---------------------------------------------------------------- 灯打下来的冷斑
  // 亮斑压在球场北半边（灯就在那儿），南半边仍是黄昏的暖光——冷暖在这一场上分层
  { id: "s_pool", x: -1.2, z: -3.1, w: 0.1, d: 0.1, passable: true,
    build: () => {
      const g = new THREE.Group();
      // 硬边光斑像贴纸：外面套一圈 0.05 的半影，边界就成了两级过渡
      const soft = disk(1.0, C.glass, 0, 0, 0.0235, 0.035, 1, 5.55, 4.75);
      const m = disk(4.2, C.glass, 0, 0, 0.024, 0.14, 1, 1.16, 0.99);
      g.add(soft, m);
      A.pool = m;
      A.poolSoft = soft;
      return g;
    } },

  // ---------------------------------------------------------------- 西北：围网 + 灯杆
  { id: "s_fenceL", x: -5.6, z: FZ, w: 4.8, d: 0.12,
    build: () => fencePanel(4.8, 2.0, { posts: [-2.4, -0.8, 0.8, 2.4] }) },
  { id: "s_fenceD", x: -2.4, z: FZ, w: 1.6, d: 0.12,
    build: () => { const g2 = fencePanel(1.6, 2.0, { dent: true }); A.dent = g2; return g2; } },
  { id: "s_fenceR", x: 3.2, z: FZ, w: 9.6, d: 0.12,
    build: () => fencePanel(9.6, 2.0, { posts: [-4.8, -3.2, -1.6, 0, 1.6, 3.2, 4.8] }) },
  { id: "s_fenceE", x: FX, z: -1.2, w: 0.12, d: 10.8, rot: Math.PI / 2,
    build: () => fencePanel(10.8, 2.0, { posts: [-5.4, -3.9, -2.4, -0.9, 0.6, 2.1, 3.6, 5.4] }) },
  { id: "s_lamp1", x: -6.8, z: -6.05, w: 0.7, d: 0.7, build: () => lampPost(false) },
  { id: "s_lamp2", x: -1.2, z: -6.05, w: 0.7, d: 0.7, build: () => lampPost(true) },
  { id: "s_car", x: 0, z: 0, w: 0.1, d: 0.1, passable: true, build: carGlow },

  // ---------------------------------------------------------------- 东北：篮架
  { id: "s_hoop", x: 7.35, z: PZ, w: 1.1, d: 1.9, build: hoop,
    interact: { x: 6.0, z: -0.4 } },

  // ---------------------------------------------------------------- 西南：看台 + 宣传栏 + 双桶
  { id: "s_stand", x: -5.2, z: 5.55, w: 3.5, d: 1.5, build: stand,
    interact: { x: -5.2, z: 4.6 } },
  { id: "s_board", x: -7.95, z: 4.35, w: 0.3, d: 1.95, rot: Math.PI / 2, build: noticeBoard,
    interact: { x: -6.9, z: 4.35 } },
  { id: "s_bin", x: -3.35, z: 6.35, w: 0.95, d: 0.45, build: binPair,
    interact: { x: -3.35, z: 5.6 } },
  { id: "s_fountain", x: -8.0, z: 1.15, w: 0.5, d: 0.45, build: fountain,
    interact: { x: -7.2, z: 1.15 } },
  { id: "s_planter", x: -7.85, z: -2.45, w: 0.95, d: 2.05, build: () => {
      const g = new THREE.Group();
      g.add(b(0.9, 0.34, 2.0, C.road, 0, 0.17, 0));                 // 花池
      g.add(b(0.96, 0.06, 2.06, C.cream, 0, 0.36, 0));              // 压顶
      g.add(slab(0.78, 1.9, C.ink, 0, 0, 0.35, 0.20, 2));           // 土
      for (let i = 0; i < 3; i++) {
        const bl = bush(0, 0, 0.3);
        bl.position.set((i % 2 - 0.5) * 0.24, 0.36, -0.62 + i * 0.62);
        bl.scale.set(1.0, 0.9, 1.0);
        g.add(bl);
      }
      return g;
    } },

  // ---------------------------------------------------------------- 东南：长椅 + 音箱 + 插线板 + 自行车
  { id: "s_bench1", x: 4.45, z: 5.15, w: 1.85, d: 0.62, seat: true, facing: Math.PI, rot: Math.PI,
    build: () => bench(false), interact: { x: 4.45, z: 4.25 } },
  { id: "s_bench2", x: 6.35, z: 5.15, w: 1.85, d: 0.62, seat: true, facing: Math.PI, rot: Math.PI,
    build: () => bench(true), interact: { x: 6.35, z: 4.25 } },
  { id: "s_speaker", x: 2.35, z: 4.85, w: 0.55, d: 0.45, rot: 0.42, build: speaker,
    interact: { x: 2.35, z: 4.0 } },
  { id: "s_strip", x: 3.45, z: 5.55, w: 0.1, d: 0.1, passable: true, build: powerStrip },
  { id: "s_bike1", x: 7.72, z: 2.18, w: 0.42, d: 1.12, build: () => {
      const g = bike(C.navy); g.rotation.z = -0.15; return g; } },
  { id: "s_bike2", x: 7.75, z: 3.00, w: 0.42, d: 1.12, build: () => {
      const g = bike(C.coral); g.rotation.z = -0.13; return g; } },
  { id: "s_bike3", x: 7.70, z: 3.82, w: 0.42, d: 1.12, build: () => {
      const g = bike(C.mint); g.rotation.z = -0.17; return g; } },
  { id: "s_scooter", x: 0.55, z: 6.35, w: 0.55, d: 1.15, rot: -0.28, build: scooter,
    interact: { x: 1.5, z: 6.1 } },

  // ---------------------------------------------------------------- 绿化带
  { id: "s_tree1", x: -7.45, z: -8.05, w: 0.3, d: 0.3, build: () => tree(2.9, 0.62, 0.4) },
  { id: "s_tree2", x: 5.95, z: -8.35, w: 0.3, d: 0.3, build: () => tree(2.6, 0.56, 1.9) },
  { id: "s_tree3", x: 8.55, z: 6.55, w: 0.3, d: 0.3, build: () => tree(2.4, 0.52, 3.1) },
  { id: "s_bush1", x: -3.9, z: 8.15, w: 0.7, d: 0.7, passable: true, build: () => bush(0, 0, 0.38) },
  { id: "s_bush2", x: -1.9, z: 8.30, w: 0.7, d: 0.7, passable: true, build: () => bush(0, 0, 0.32) },
  { id: "s_bush3", x: 2.4, z: 8.20, w: 0.7, d: 0.7, passable: true, build: () => bush(0, 0, 0.36) },
  { id: "s_bush4", x: 5.4, z: 8.00, w: 0.7, d: 0.7, passable: true, build: () => bush(0, 0, 0.30) },
  { id: "s_bush5", x: -8.7, z: -3.2, w: 0.6, d: 0.6, passable: true, build: () => bush(0, 0, 0.30) },
  { id: "s_bush6", x: 8.7, z: -5.4, w: 0.6, d: 0.6, passable: true, build: () => bush(0, 0, 0.28) },
  { id: "s_bush7", x: -8.65, z: 6.9, w: 0.6, d: 0.6, passable: true, build: () => bush(0, 0, 0.32) }
];

const obstacles = props.filter((p) => !p.passable).map((p) => ({ x: p.x, z: p.z, w: p.w, d: p.d }));
// 围网本身也要挡一挡（否则人会从网里穿过去）
obstacles.push({ x: 0, z: FZ, w: 16.4, d: 0.16 });
obstacles.push({ x: FX, z: -1.2, w: 0.16, d: 11.0 });

// 三个人站位是一条斜线：老吴在场边、秦秀兰在场中央（音箱旁）、阿凯在篮架下；
// 场边还有两位氛围人物：压腿的老人、推车路过的学生。
const characters = [
  { id: "p_c", label: "老吴", name: "老吴", role: "球场管理员",
    x: -5.55, z: 0.55, facing: 1.35, pose: "stand", scale: 0.93,
    color: C.road, pants: C.navy, hair: "#6f6a62" },
  { id: "p_a", label: "秦秀兰", name: "秦秀兰", role: "广场舞队领队",
    x: 1.40, z: 3.05, facing: 0.62, pose: "stand", scale: 0.97,
    color: C.coral, pants: C.dark, hair: "#3a2c22" },
  { id: "p_b", label: "阿凯", name: "阿凯", role: "打球青年",
    x: 5.05, z: -1.30, facing: -1.75, pose: "stand", scale: 1.0,
    color: C.blue, pants: C.dark, hair: "#231d18" },
  { id: "amb_old", label: "", name: "压腿的老人", role: "锻炼的居民",
    x: -6.15, z: 5.42, y: -0.11, facing: Math.PI, pose: "sit",
    scale: 0.92, color: C.cream, pants: C.dark, hair: "#8d8579", ambient: true },
  { id: "amb_student", label: "", name: "路过的学生", role: "社区居民",
    x: 6.95, z: 6.25, facing: 2.3, pose: "stand", scale: 0.95,
    color: C.mint, pants: C.navy, hair: "#2f2620", ambient: true }
];

let scene;
try {
  scene = createScene({
    mount: document.getElementById("stage"),
    room: null,                                    // 室外：没有墙、没有吊顶
    props,
    obstacles,
    characters,
    lamps: [],
    siteColor: C.sand,                             // 底座顶面被绿化带压住，只在切边露出一点土色
    terrainSideColor: C.road,
    // 蓝调时刻：天顶靛蓝 → 中段灰蓝 → 地平线蜜桃橘
    skyTop: "#5b7ba0", skyMid: "#a9b6bd", skyBottom: "#f0a878",
    fogDensity: 0.016,
    light: {
      sun: "#ffb078", sunI: 1.9, fill: "#7f9dc4", fillI: 1.25,
      fillPos: [-9.5, 7.0, -7.0],                  // 冷补光从西北来，和暖主光打对台
      hemi: 0.46, exposure: 0.96
    },
    actor: { x: 0.4, z: 3.6 },
    camYaw: 0.44, camPitch: 0.57, camDist: 16.4, camFocus: [0, 0.9, 0.35],
    walk: { x0: -8.2, x1: 7.6, z0: -6.25, z1: 6.65 },
    onSpot: (p) => { (window.__events = window.__events || []).push(["spot", p.id]); },
    onPerson: (p) => { (window.__events = window.__events || []).push(["person", p.id]); },
    onArrived: (p) => { (window.__events = window.__events || []).push(["arrived", +p.x.toFixed(2), +p.z.toFixed(2)]); },
    onSeat: (p) => { (window.__events = window.__events || []).push(["seat", p.id]); },

    // ---------------------------------------------------------------- 动效
    // 全部 2% 量级（§1 第 16 条）：只有"极缓""轻轻""偶尔"，没有跳变。
    onFrame: (t, dt) => {
      // ① 球场灯：头 1.1 秒闪两下（继电器打火），之后稳定，只剩 1.8% 的电压波动
      const spark = t < 1.1 ? (Math.sin(t * 46) > 0.15 ? 1 : 0.22) * (t < 0.36 ? 0.45 : 1) : 1;
      const volt = 1 + Math.sin(t * 1.7) * 0.018;
      if (A.lampFace) {
        A.lampFace.material.emissiveIntensity = 1.85 * spark * volt;
      }
      if (A.pool) {
        A.pool.material.opacity = 0.14 * spark * volt;
      }
      if (A.poolSoft) {
        A.poolSoft.material.opacity = 0.05 * spark * volt;
      }
      // ② 音箱红灯：两秒一次呼吸
      if (A.led) {
        A.led.material.emissiveIntensity = 0.55 + 0.85 * (0.5 + 0.5 * Math.sin(t * Math.PI));
      }
      if (A.ledGlow) {
        A.ledGlow.material.opacity = 0.08 + 0.12 * (0.5 + 0.5 * Math.sin(t * Math.PI));
      }
      // ③ 低音单元随节拍轻振（±2%）
      if (A.woofer) {
        const k = 1 + Math.sin(t * 4.4) * 0.02;
        A.woofer.scale.set(k, 1, k * 1.0);
      }
      // ④ 围网被撞凹的那一段轻轻回弹
      if (A.dent) {
        A.dent.position.z = Math.sin(t * 2.3) * 0.02;
        A.dent.rotation.z = Math.sin(t * 1.7 + 0.6) * 0.004;
      }
      // ⑤ 树冠被风带动：0.02 弧度
      for (const c of A.canopies) {
        c.o.rotation.z = Math.sin(t * 0.85 + c.ph) * 0.02;
        c.o.rotation.x = Math.cos(t * 0.63 + c.ph) * 0.016;
      }
      // ⑥ 半瓶水的水面细晃
      if (A.water) {
        const s = 1 + Math.sin(t * 2.1) * 0.03;
        A.water.scale.set(s, 1 + Math.cos(t * 1.7) * 0.03, 1);
        A.water.position.y = 0.106 + Math.sin(t * 3.1) * 0.0015;
      }
      // ⑦ 影子随天光变冷：太阳压到 25°，影子拉长；再极缓地下沉、主光暖度微降
      if (window.__dbg) {
        const { sun, fill } = window.__dbg;
        sun.position.set(8.5, 5.1 * (1 - 0.02 * (0.5 + 0.5 * Math.sin(t * 0.014))), 11.0);
        sun.intensity = 1.9 * (1 + Math.sin(t * 0.011) * 0.02);       // 20 分钟一个来回
        fill.intensity = 1.25 * (1 + Math.sin(t * 0.021) * 0.015);
      }
      // ⑧ 远处偶尔有车灯扫过围网：12 秒一次，很暗
      if (A.car) {
        const p = (t % 12) / 1.5;
        if (p < 1) {
          A.car.position.x = -7.4 + p * 14.8;
          A.car.material.opacity = Math.sin(p * Math.PI) * 0.11;
        } else {
          A.car.material.opacity = 0;
        }
      }
      // ⑨ 落叶：从树冠上慢慢飘下来，落地停一会儿再回到树上
      for (let i = 0; i < A.falls.length; i++) {
        const f = A.falls[i];
        const q = ((t * 0.055 + f.ph) % 1);
        f.o.position.y = 2.55 - q * 2.45;
        f.o.position.x = f.x + Math.sin(q * 7 + f.ph * 9) * 0.22;
        f.o.rotation.z = Math.sin(q * 9 + f.ph * 5) * 1.2;
        f.o.rotation.y = q * 5;
      }
      // ⑩ 插线板上的小红灯：一直亮着，极缓呼吸
      if (A.stripLED) {
        A.stripLED.material.emissiveIntensity = 1.1 * (1 + Math.sin(t * 1.9 + 1.2) * 0.02);
      }
      // ⑪ 秦秀兰抬起的那只手：跟着拍子上下 0.12 弧度（约 2%）
      if (A.beat) {
        A.beat.rotation.z = Math.sin(t * 2.6) * 0.12;
        A.beat.rotation.x = Math.sin(t * 1.3) * 0.04;
      }
    }
  });
} catch (err) {
  window.__err = String((err && err.stack) || err);
}

// ---------------------------------------------------------------- 人物小动作
// 运行时的人只有"站/坐"两种姿势，这里在关节上补三个小动作（不改 scene3d）：
//   · 秦秀兰抬起一只手，像在给舞队打拍子
//   · 阿凯把球夹在腰侧，手臂搭在球上
//   · 路过的学生背着书包
// 全部包在 try 里：拿不到内部结构就安静地跳过，不影响场景。
try {
  const root = window.__dbg && window.__dbg.scene;
  const findChar = (x, z) => {
    let hit = null;
    root.traverse((o) => {
      if (o.isGroup && o.children.length >= 6 &&
          Math.abs(o.position.x - x) < 0.01 && Math.abs(o.position.z - z) < 0.01) { hit = o; }
    });
    return hit;
  };
  // 运行时的手臂是一根直圆柱，抬起来就像一根棍。这里把它藏掉，换两截带肘的：
  // 肩点 → 肘 → 手，姿势才立得住。
  const bentArm = (g, s, side, E, H, col) => {
    const arm = g.children.find((o) => o.isMesh && o.geometry &&
      o.geometry.type === "CylinderGeometry" &&
      Math.abs(o.position.y - 1.16 * s) < 0.02 &&
      Math.sign(o.position.x) === side);
    if (arm) { arm.visible = false; }
    const gp = new THREE.Group();
    gp.position.set(side * 0.26 * s, 1.40 * s, 0);
    gp.add(tube([[0, 0, 0], [side * E[0], E[1], E[2]]], 0.052 * s, col, false, 9));
    gp.add(tube([[side * E[0], E[1], E[2]], [side * H[0], H[1], H[2]]], 0.046 * s, col, false, 9));
    gp.add(b(0.075 * s, 0.085 * s, 0.075 * s, C.peach, side * H[0], H[1] + 0.045 * s, H[2]));
    g.add(gp);
    return gp;
  };

  const qsl = findChar(1.40, 3.05);                 // 秦秀兰：前臂抬到耳边，打拍子
  if (qsl) {
    A.beat = bentArm(qsl, 0.97, 1, [0.10, -0.22, 0.06], [0.09, 0.15, 0.11], C.coral);
  }
  const ak = findChar(5.05, -1.30);                 // 阿凯：球夹腰侧，手搭在球上
  if (ak) {
    bentArm(ak, 1.0, 1, [0.05, -0.22, 0.06], [0.02, -0.35, 0.14], C.blue);
    const bb = ball(0.125, C.coral, 0.30, 0.92, 0.14, 14);
    for (let i = 0; i < 3; i++) {
      const sm = new THREE.Mesh(new THREE.TorusGeometry(0.126, 0.006, 4, 18), M(C.ink));
      sm.rotation.set(i === 0 ? Math.PI / 2 : 0, i === 1 ? Math.PI / 2 : 0, 0);
      bb.add(sm);
    }
    ak.add(bb);
  }
  const stu = findChar(6.95, 6.25);                 // 学生：背上的书包
  if (stu) {
    stu.add(b(0.30, 0.34, 0.15, C.navy, 0, 1.02, -0.22));
    stu.add(b(0.26, 0.10, 0.05, C.ink, 0, 0.86, -0.16));
  }

  // 飘落的叶子（挂在树冠附近）
  for (let i = 0; i < 7; i++) {
    const lf = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.08),
      M(i % 2 ? C.wood : C.sand, { side: THREE.DoubleSide }));
    const bx = i < 4 ? -6.9 : 5.7;
    lf.position.set(bx, 2.4, i < 4 ? -7.6 : -7.9);
    root.add(lf);
    A.falls.push({ o: lf, x: bx, ph: i * 0.137 });
  }
} catch (e) {
  // 人物微调失败不影响场景
}

window.__mini = scene;

window.addEventListener("message", (ev) => {
  const d = ev.data || {};
  if (!scene) { return; }
  if (d.type === "actor:move" && d.payload) { scene.walkTo(d.payload.x, d.payload.z); }
  if (d.type === "actor:teleport" && d.payload) { scene.setActor(d.payload.x, d.payload.z); }
  if (d.type === "spot:goto" && d.payload) { scene.goToProp(d.payload.id); }
});

if (window.parent !== window) {
  window.parent.postMessage({ source: "mini3d", type: "scene:ready", payload: {} }, "*");
}
