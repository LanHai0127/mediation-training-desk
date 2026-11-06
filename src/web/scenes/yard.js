// S4 · 张家院（上午 10:00）—— 张守义的主场
// -----------------------------------------------------------------------------
// 按 docs/场景与人物建模提示词.md v5 §3 S4 重做（2026-11-04，质量第一）。
// 七段结构一一对应：画面风格 / 底座与构图 / 时间与氛围 / 建筑 / 陈设 / 基础动效 / 避免。
//
//   ① 颜色只用 kit 的 PAL 那 19 个（15 + 4 个土地色），本文件没有任何一个色板外色值；
//   ② 大件描边由 kit.b 自动加（最大边 > 0.55），小件与重复的瓦垄不加，免得糊成一片；
//   ③ 零噪点：水泥地 / 砖墙 / 菜地全部纯色，补丁与裂缝改用几何薄片贴在地上；
//      一张噪点贴图都没有，一处随机数都没有（砖格用 kit.brickTex 的纯色错缝）；
//   ④ 四格：西北 柴垛 + 腌菜缸 + 台账 / 东北 鸡窝 + 两只鸡 + 方桌 + 菜地 /
//            西南 院门 + 三轮车 + 锄头 / 东南 菜地 + 晾衣绳 + 扫帚；
//   ⑤ 视觉中心 堂屋门口的方桌（玻璃板下压着权证），次中心 西侧院门与那辆旧三轮车；
//   ⑥ 南墙只留 0.62 高（剖开面）：相机从南边进来时不能挡住整个院子；
//   ⑦ 堂屋坡屋顶 16 道瓦垄（旧瓦发灰），脊 + 檐口压边 + 檐下一排瓦当，
//      东北角缺一片瓦（断口留暗缝，不靠贴图）；
//   ⑧ onFrame 12 条 2% 量级的循环（收音机指示灯 / 两只鸡 / 屋檐影 / 小孩衣 /
//      权证角 / 筒灯 / 辣椒串 / 门帘 / 鸡食盆 / 白菜外叶 / 缸里的茶面 / 晾衣绳）。
//
// 证据点位：方桌 s_table（权证按现状确权）/ 门边台账 s_ledger（鸡蛋 1.6 元一枚）/
//          菜地 s_field / 院门 s_gate
// -----------------------------------------------------------------------------
import * as THREE from "./vendor/three.module.min.js";
import { PAL as C, M, b, cy, ball, ground, bush, brickTex } from "./kit.js";
import { createScene } from "./scene3d.js";

window.__err = "";
window.addEventListener("error", (e) => {
  window.__err = (e.message || "error") + " @ " + (e.filename || "") + ":" + (e.lineno || 0);
});

// ---------------------------------------------------------------- 动画句柄
// 所有会动的部件在这里登记，onFrame 统一驱动；幅度一律 2% 量级。
const A = {
  led: null,            // 收音机指示灯（呼吸）
  lamp: null,           // 檐下筒灯（1.8% 呼吸）
  hens: [],             // 两只鸡（原地啄食，不位移）
  clothes: [],          // 晾衣绳上的小孩衣服
  veil: [],             // 门帘五片
  cert: null,           // 玻璃板外那张权证被掀起的角
  chili: [],            // 檐下干辣椒串
  feed: null,           // 鸡食盆里的水
  cabbages: [],         // 白菜外叶
  tea: null,            // 搪瓷缸里的茶面
  eaveWall: null,       // 墙面上的瓦垄影
  eaveGround: null      // 地上的檐影
};

// ---------------------------------------------------------------- 尺寸
// 院子 12.7 × 11.7：堂屋在北，院墙三面，院门在西；菜地在东南角，柴垛靠西墙。
const G = {
  x0: -6.35, x1: 6.35,        // 东西院墙轴线
  z0: -6.55, z1: 5.15,        // 北（堂屋后墙）/ 南（矮墙）
  wallH: 1.68,                // 院墙墙身：加墙基与压顶约 1.9
  wallT: 0.30,
  house: { x: 0.2, z: -4.9, w: 6.6, d: 3.3, h: 3.0 },
  gate: { z: 2.35, z0: 1.35, z1: 3.35, h: 2.05 }
};

// ---------------------------------------------------------------- 小工具
// 贴地薄片（补丁、裂缝、磨痕、水渍、落叶）：不写深度、纯色、不参与光照。
// 提示词 §2 第 3 条：地面不铺噪点贴图，"旧"是靠这些几何薄片说出来的。
function flat(w, d, color, x, y, z, op = 1, ry = 0) {
  const geo = new THREE.PlaneGeometry(w, d);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color, transparent: op < 1, opacity: op, depthWrite: false
  }));
  m.position.set(x, y, z);
  m.rotation.y = ry;
  return m;
}
// 贴在墙面上的薄片（雨痕、苔、瓦垄影）：朝 +z，不写深度
function face(w, h, color, x, y, z, op = 1) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: op, depthWrite: false
  }));
  m.position.set(x, y, z);
  return m;
}
// 确定性抖动：不用随机数，也不让每片叶子的位置一模一样
const jit = (i) => (Math.sin(i * 2.399) + 1) / 2;
// 一道裂缝：几段首尾相接的薄片（不是一条条散落的小棍）
function crackLine(pts, w, op) {
  const g = new THREE.Group();
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dz = pts[i + 1][1] - pts[i][1];
    const len = Math.hypot(dx, dz);
    const m = flat(w, len + w, C.tile,
      (pts[i][0] + pts[i + 1][0]) / 2, 0.012, (pts[i][1] + pts[i + 1][1]) / 2, op);
    m.rotation.y = Math.atan2(dx, dz);
    g.add(m);
  }
  return g;
}
// 两点之间拉一根细杆（晾衣绳、铁丝、绳索）
function rope(x0, y0, z0, x1, y1, z1, r, color) {
  const a = new THREE.Vector3(x0, y0, z0);
  const c = new THREE.Vector3(x1, y1, z1);
  const v = new THREE.Vector3().subVectors(c, a);
  const m = cy(r, r, v.length(), color, 0, 0, 0, 5);
  m.position.copy(a).addScaledVector(v, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize());
  m.castShadow = false;
  return m;
}
// 纯色砖格：没有一粒噪点，错缝还在（kit 的 v6 版本就是这个做法）
function brickMap(base, mortar, w, h) {
  const t = brickTex(base, mortar, 8, 5);
  t.repeat.set(Math.max(1, w / 1.15), Math.max(1, h / 1.15));
  return t;
}

// ---------------------------------------------------------------- 院墙
// 一道墙三段：墙基一皮 + 砖身 + 压顶压条。东西北三面高 1.9，南面只留 0.62。
// 砖是三十年前的旧砖：土黄发灰，砖缝深两号；红砖只留在院外那堆剩砖里，做一点暖点缀。
function yardWall(len, h = G.wallH) {
  const g = new THREE.Group();
  g.add(b(len, h, G.wallT, M(C.white, { map: brickMap(C.soil, C.tile, len, h) }),
    0, 0.12 + h / 2, 0));
  g.add(b(len + 0.06, 0.12, G.wallT + 0.10, C.tile, 0, 0.06, 0));            // 墙基
  g.add(b(len + 0.10, 0.10, G.wallT + 0.14, C.tile, 0, 0.12 + h + 0.05, 0)); // 压顶
  g.add(b(len + 0.02, 0.05, G.wallT + 0.04, C.road, 0, 0.12 + h + 0.12, 0)); // 压顶上一皮薄砖
  return g;
}
// 南墙：墙身 0.48 + 墙基 0.05 + 压顶 0.09 = 0.62 —— "剖开的那一面"
function southWall(len) {
  const g = new THREE.Group();
  g.add(b(len, 0.48, G.wallT, M(C.white, { map: brickMap(C.soil, C.tile, len, 0.48) }),
    0, 0.30, 0));
  g.add(b(len + 0.05, 0.06, G.wallT + 0.08, C.tile, 0, 0.03, 0));
  g.add(b(len + 0.08, 0.08, G.wallT + 0.12, C.tile, 0, 0.58, 0));            // 压顶（上表面 0.62）
  g.add(b(len - 0.2, 0.006, 0.015, C.tile, 0, 0.615, 0.16));                 // 压顶上一道缝
  return g;
}

// ---------------------------------------------------------------- 堂屋
// 6.6 × 3.3，白墙、木门（开着一条缝）、玻璃板门帘五片、十字窗棂、窗台一道浅沿。
// 屋顶：两片瓦坡 + 脊 + 16 道瓦垄 + 檐口压边 + 檐下一排瓦当；东北角缺一片瓦。
function roofSlope() {
  const g = new THREE.Group();
  // 旧瓦发灰：瓦背与瓦垄同取偏冷的那一档，靠起伏 + 一道深缝说话。
  // 一旦让垄与沟两种颜色相间，远看就是彩钢瓦雨棚；这一版把它按回单色。
  g.add(b(7.3, 0.13, 2.44, C.road, 0, 0, 0));                     // 瓦背（旧瓦发灰）
  for (let i = 0; i < 16; i++) {                                  // 16 道瓦垄
    const x = -3.48 + i * 0.464;
    g.add(b(0.21, 0.078, 2.32, C.road, x, 0.098, 0, { outline: false }));
    g.add(b(0.038, 0.014, 2.30, C.tile, x + 0.232, 0.070, 0,
      { outline: false }));                                          // 垄沟
  }
  g.add(b(7.3, 0.13, 0.16, C.tile, 0, 0.0, 1.24, { outline: false }));  // 檐口压边
  for (let i = 0; i < 16; i++) {                                  // 瓦当：檐口一排瓦头
    const x = -3.44 + i * 0.464;
    g.add(b(0.19, 0.08, 0.10, C.tile, x, 0.115, 1.245, { outline: false }));
  }
  g.add(b(7.3, 0.07, 0.22, C.tile, 0, 0.04, -1.22, { outline: false })); // 靠脊的一道收口
  return g;
}

function gablePlate() {
  // 山墙三角：ShapeGeometry 一片，双面；没有它，从东边看过去能看进屋顶空腔
  const sh = new THREE.Shape();
  sh.moveTo(-1.65, 0); sh.lineTo(1.65, 0); sh.lineTo(0, 1.02); sh.closePath();
  return new THREE.Mesh(new THREE.ShapeGeometry(sh),
    new THREE.MeshToonMaterial({ color: C.white, side: THREE.DoubleSide }));
}

function house() {
  const g = new THREE.Group();
  const W = G.house.w, D = G.house.d, H = G.house.h;
  const FX = -0.55;                 // 门在本地 x 的位置
  const DW = 1.15, DH = 2.15;       // 门洞
  const WX = 1.35, WW = 1.0, WH = 1.15, WY = 1.55;
  const fz = D / 2;                 // 前脸

  // ---- 墙身：白墙 + 水泥墙裙 + 墙脚一皮
  g.add(b(W, H, D, C.white, 0, H / 2, 0));
  g.add(b(W + 0.04, 0.44, D + 0.04, C.road, 0, 0.22, 0));           // 水泥墙裙（0.44）
  g.add(b(W + 0.06, 0.06, D + 0.06, C.tile, 0, 0.46, 0));           // 裙上一道压条
  g.add(b(W + 0.08, 0.10, D + 0.08, C.tile, 0, 0.05, 0));           // 墙脚一皮
  // 雨痕：屋檐水常年冲下来的两道
  g.add(face(0.16, 0.9, C.tile, -2.55, 2.35, fz + 0.025, 0.13));
  g.add(face(0.10, 0.7, C.tile, 2.95, 2.42, fz + 0.025, 0.10));
  g.add(face(0.7, 0.4, C.sand, -1.2, 0.72, fz + 0.028, 0.16));      // 墙根一块掉了皮

  // ---- 门：门框 + 门洞里那片暗 + 一扇往外开的门
  // 堂屋墙是一整块实体，所以"门洞"用一片贴在墙面上的暗面来演；门框、门帘、门扇
  // 依次压在它前面 0.1 米内，近看有厚度、远看是一个洞。
  g.add(b(0.10, DH + 0.12, 0.12, C.tile, FX - DW / 2 - 0.05, (DH + 0.12) / 2, fz + 0.06));
  g.add(b(0.10, DH + 0.12, 0.12, C.tile, FX + DW / 2 + 0.05, (DH + 0.12) / 2, fz + 0.06));
  g.add(b(DW + 0.32, 0.12, 0.14, C.tile, FX, DH + 0.06, fz + 0.06));
  g.add(b(DW + 0.28, 0.07, 0.20, C.road, FX, 0.035, fz + 0.10));    // 门槛石
  g.add(b(DW, DH, 0.02, C.ink, FX, DH / 2, fz + 0.02));             // 门洞里是暗的
  // 门扇：挂在西侧门框上，往外开 65°（开在眼前，院子才有"进得去"的深度）
  const hinge = new THREE.Group();
  hinge.position.set(FX - DW / 2, 0.14, fz + 0.09);
  hinge.rotation.y = -1.13;
  hinge.add(b(DW - 0.02, DH - 0.18, 0.055, C.wood, (DW - 0.02) / 2, (DH - 0.18) / 2, 0));
  for (let i = 0; i < 3; i++) {                                     // 门上的三道横撑
    hinge.add(b(DW - 0.12, 0.07, 0.02, C.tile, (DW - 0.02) / 2, 0.34 + i * 0.62, 0.038,
      { outline: false }));
  }
  hinge.add(b(0.07, DH - 0.34, 0.02, C.tile, (DW - 0.05) / 2, DH / 2 - 0.06, 0.038,
    { outline: false }));
  const ring = cy(0.05, 0.05, 0.02, C.road, DW - 0.24, 1.36, 0.045, 10);
  ring.rotation.x = Math.PI / 2;
  hinge.add(ring);
  hinge.add(b(0.08, 0.26, 0.012, C.sand, DW - 0.2, 0.28, 0.04, { outline: false })); // 一块补的铁皮
  g.add(hinge);
  // 玻璃板门帘五片：挂在门洞上沿，夏天挡苍蝇
  for (let i = 0; i < 5; i++) {
    const v = new THREE.Group();
    v.position.set(FX - 0.40 + i * 0.20, DH - 0.03, fz + 0.05);
    v.add(b(0.155, 0.52, 0.012, M(C.glass, { transparent: true, opacity: 0.62 }),
      0, -0.26, 0, { outline: false }));
    v.add(b(0.155, 0.03, 0.016, C.road, 0, -0.02, 0, { outline: false }));
    g.add(v);
    A.veil.push(v);
  }

  // ---- 窗：十字窗棂 + 窗台一道浅沿（窗套压在白墙外面，玻璃再压在窗套前面）
  g.add(b(WW + 0.18, WH + 0.18, 0.07, C.cream, WX, WY, fz + 0.035));
  g.add(b(WW, WH, 0.02, C.dark, WX, WY, fz + 0.075));               // 屋里暗
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(WW - 0.05, WH - 0.05),
    M(C.glass, { transparent: true, opacity: 0.46 }));
  pane.position.set(WX, WY, fz + 0.09);
  g.add(pane);
  g.add(b(0.045, WH, 0.025, C.cream, WX, WY, fz + 0.105, { outline: false }));
  g.add(b(WW, 0.045, 0.025, C.cream, WX, WY + 0.03, fz + 0.105, { outline: false }));
  g.add(b(WW + 0.30, 0.06, 0.18, C.cream, WX, WY - WH / 2 - 0.09, fz + 0.09));  // 窗台
  g.add(b(WW + 0.30, 0.03, 0.20, C.road, WX, WY - WH / 2 - 0.13, fz + 0.10));
  // 窗台上一个罐头瓶，插着两根绿萝
  g.add(cy(0.055, 0.05, 0.12, C.glass, WX + 0.22, WY - WH / 2 - 0.01, fz + 0.09, 10));
  for (let i = 0; i < 2; i++) {
    g.add(cy(0.008, 0.007, 0.16, C.grass, WX + 0.20 + i * 0.05, WY - WH / 2 + 0.10, fz + 0.09, 4));
    const lf = ball(0.045, C.mint, WX + 0.24 + i * 0.06, WY - WH / 2 + 0.19, fz + 0.09, 6);
    lf.scale.set(1, 0.6, 1);
    g.add(lf);
  }

  // ---- 檐口：一道横木 + 六根椽（檐下那排影子就是它们投的）
  g.add(b(W + 0.12, 0.11, 0.18, C.tile, 0, 2.955, D / 2 + 0.28));
  for (let i = 0; i < 6; i++) {
    const raf = b(0.09, 0.08, 0.64, C.wood, -2.55 + i * 1.02, 2.89, D / 2 + 0.30,
      { outline: false });
    raf.rotation.x = -0.10;
    g.add(raf);
  }

  // ---- 坡屋顶：两坡 + 脊 + 16 道瓦垄
  const RX = 0.445;                     // 坡度：rise 1.05 / run 2.2
  for (const s of [1, -1]) {
    const sl = roofSlope();
    sl.position.set(0, 3.475, s * 1.1);
    sl.rotation.y = s > 0 ? 0 : Math.PI;
    sl.rotation.x = s > 0 ? RX : -RX;
    g.add(sl);
  }
  // 脊：一条压脊 + 一道筒瓦 + 两头翘起来一点
  g.add(b(7.32, 0.14, 0.24, C.tile, 0, 4.04, 0));
  const roll = cy(0.075, 0.075, 7.28, C.road, 0, 4.13, 0, 10);
  roll.rotation.z = Math.PI / 2;
  g.add(roll);
  for (const s of [1, -1]) {
    const tip = b(0.24, 0.17, 0.26, C.tile, s * 3.62, 4.08, 0, { outline: false });
    tip.rotation.z = s * 0.26;
    g.add(tip);
  }
  // 东北角缺一片瓦：檐口压边断了一截，露出底下的暗缝
  g.add(b(0.30, 0.06, 0.20, C.dark, 3.30, 3.00, -1.98, { outline: false }));
  // 山墙三角
  for (const s of [1, -1]) {
    const gp = gablePlate();
    gp.position.set(s * 3.29, H, 0);
    gp.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
    gp.castShadow = true;
    g.add(gp);
  }
  g.add(b(7.36, 0.07, 0.16, C.tile, 0, 3.02, 2.12, { outline: false }));  // 前檐一道滴水线

  // ---- 堂屋北墙（背面）：一扇小后窗 + 一个电表箱
  g.add(b(0.86, 0.86, 0.06, C.cream, -1.5, 2.05, -D / 2 - 0.02));
  g.add(b(0.72, 0.72, 0.04, C.dark, -1.5, 2.05, -D / 2 - 0.05));
  g.add(b(0.04, 0.72, 0.03, C.cream, -1.5, 2.05, -D / 2 - 0.06, { outline: false }));
  g.add(b(0.72, 0.04, 0.03, C.cream, -1.5, 2.05, -D / 2 - 0.06, { outline: false }));
  g.add(b(0.34, 0.44, 0.12, C.road, 1.9, 1.9, -D / 2 - 0.06));             // 电表箱
  g.add(b(0.26, 0.10, 0.03, C.cream, 1.9, 2.0, -D / 2 - 0.12, { outline: false }));
  g.add(cy(0.022, 0.022, 1.85, C.road, 1.9, 0.92, -D / 2 - 0.10, 6));      // 一根落水管
  return g;
}

// ---------------------------------------------------------------- 院门（次中心）
// 两根门柱 + 门楣 + 半坡瓦顶 + 两扇木门，其中一扇用铁丝拴住；门墩石、门槛石、褪色的春联。
function gate() {
  const g = new THREE.Group();
  const HZ = 1.0;                                   // 门洞半宽（沿 z）
  for (const s of [-1, 1]) {
    const z = s * (HZ + 0.20);
    g.add(b(0.40, G.gate.h, 0.40, M(C.white, { map: brickMap(C.soil, C.tile, 0.4, G.gate.h) }),
      0, G.gate.h / 2, z));
    g.add(b(0.52, 0.12, 0.52, C.road, 0, 0.06, z));                 // 柱础
    g.add(b(0.46, 0.09, 0.46, C.tile, 0, G.gate.h + 0.045, z));     // 柱头
    g.add(b(0.26, 0.10, 0.60, C.tile, 0.18, 0.05, z));              // 门墩石
  }
  // 门楣 + 小双坡瓦顶（院门是这场戏的次中心，顶上要有东西收住；
  // 但绝不能做成一块大平板，否则从任何角度看都像彩钢雨棚）
  g.add(b(0.34, 0.24, 2.62, C.wood, 0, 2.28, 0));
  for (const s of [-1, 1]) {
    const sl = new THREE.Group();
    sl.position.set(s * 0.16, 2.44, 0);
    sl.rotation.z = -s * 0.34;
    sl.add(b(0.38, 0.055, 2.58, C.road, 0, 0, 0));
    sl.add(b(0.055, 0.06, 2.60, C.tile, s * 0.19, 0.015, 0));        // 檐口一皮瓦当
    for (let i = 0; i < 3; i++) {                                    // 三道瓦行，别让它像一块雨棚
      sl.add(b(0.008, 0.012, 2.54, C.tile, -0.10 + i * 0.10, 0.033, 0,
        { outline: false }));
    }
    g.add(sl);
  }
  const gRoll = cy(0.05, 0.05, 2.62, C.tile, 0, 2.53, 0, 10);
  gRoll.rotation.x = Math.PI / 2;
  g.add(gRoll);
  for (const s of [-1, 1]) {                                         // 两端的封头
    g.add(b(0.62, 0.10, 0.06, C.tile, 0, 2.44, s * 1.30, { outline: false }));
  }

  // 两扇木门：合缝在 z = 0
  for (const s of [-1, 1]) {
    const z = s * 0.49;
    g.add(b(0.07, 1.96, 0.94, C.wood, 0.06, 1.00, z));
    for (let i = 0; i < 3; i++) {                                   // 三道横撑
      g.add(b(0.02, 0.08, 0.84, C.tile, 0.10, 0.42 + i * 0.62, z, { outline: false }));
    }
    g.add(b(0.02, 1.7, 0.07, C.tile, 0.10, 1.0, z + s * 0.34, { outline: false })); // 竖撑
    const huan = cy(0.055, 0.055, 0.02, C.road, 0.12, 1.12, z - s * 0.16, 10);      // 门环
    huan.rotation.z = Math.PI / 2;
    g.add(huan);
    g.add(b(0.02, 0.30, 0.22, C.sand, 0.10, 0.34, z - s * 0.10, { outline: false })); // 底下包的铁皮
  }
  g.add(b(0.04, 1.96, 0.03, C.dark, 0.11, 1.0, 0, { outline: false }));             // 门缝
  // 铁丝：把那扇门和柱子拴在一起（案子里"一扇用铁丝拴住"）
  const wire = rope(0.16, 1.30, 0.62, 0.24, 1.02, 1.02, 0.012, C.road);
  g.add(wire);
  g.add(cy(0.016, 0.016, 0.16, C.road, 0.22, 1.18, 0.92, 5));
  // 春联：褪成粉红的两条，没有字（不许出现真实姓名与乱码）
  for (const s of [-1, 1]) {
    g.add(b(0.02, 0.86, 0.17, C.peach, -0.205, 1.42, s * 0.94, { outline: false }));
    g.add(b(0.02, 0.80, 0.11, C.coral, -0.218, 1.42, s * 0.94, { outline: false }));
  }
  // 门槛石 + 门前一块踩凹的石板
  g.add(b(0.42, 0.09, 2.06, C.road, 0.02, 0.045, 0));
  return g;
}

// ---------------------------------------------------------------- 方桌（视觉中心）
// 玻璃板下压着三样东西：宅基地使用权证、一张全家福、一张更老的黑白照片。
// 桌面：搪瓷缸、收音机（天线拉出一半）、降压药板、老花镜。
function tableTop() {
  const g = new THREE.Group();
  // 桌面：原木，四周一圈桌沿
  g.add(b(1.56, 0.07, 1.02, C.wood, 0, 0.755, 0));
  g.add(b(1.62, 0.045, 1.08, C.tile, 0, 0.715, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(b(0.075, 0.72, 0.075, C.tile, sx * 0.66, 0.36, sz * 0.40, { outline: false }));
  }
  for (const sz of [-1, 1]) {                                      // 两条横撑
    g.add(b(1.30, 0.05, 0.05, C.tile, 0, 0.22, sz * 0.40, { outline: false }));
  }
  // ---- 玻璃板：physical，低透明、不投影（提示词 §2 第 6 条）
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.10, 0.012, 0.68),
    new THREE.MeshPhysicalMaterial({
      color: C.glass, transparent: true, opacity: 0.24, roughness: 0.10,
      metalness: 0, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.06
    }));
  glass.position.set(0.02, 0.803, 0.02);
  glass.castShadow = false;
  glass.receiveShadow = false;
  g.add(glass);
  // 压条：玻璃四边压着四根细木条（不然"玻璃板"会像一块悬空的冰）
  for (const sz of [-1, 1]) {
    g.add(b(1.14, 0.014, 0.03, C.tile, 0.02, 0.812, sz * 0.345, { outline: false }));
  }
  for (const sx of [-1, 1]) {
    g.add(b(0.03, 0.014, 0.70, C.tile, 0.02 + sx * 0.565, 0.812, 0.02, { outline: false }));
  }
  // ---- 玻璃板上的高光：一块擦得很亮的玻璃，远看也要看得出来
  g.add(flat(0.86, 0.03, C.white, -0.06, 0.8125, 0.10, 0.45, 0.10));
  g.add(flat(0.30, 0.02, C.white, 0.28, 0.8125, -0.16, 0.40, 0.55));
  // ---- 玻璃板下：权证（有红头与印章）、全家福、黑白照片
  g.add(b(0.54, 0.006, 0.38, C.cream, -0.46, 0.792, -0.02));
  g.add(b(0.54, 0.004, 0.07, C.coral, -0.46, 0.7955, 0.13, { outline: false }));  // 权证红头
  for (let i = 0; i < 4; i++) {
    g.add(b(0.40, 0.002, 0.012, C.road, -0.50, 0.7965, 0.02 - i * 0.055,
      { outline: false }));
  }
  g.add(cy(0.045, 0.045, 0.003, C.coral, -0.24, 0.7965, -0.13, 12));             // 红印章
  g.add(b(0.22, 0.005, 0.16, C.white, 0.30, 0.792, 0.12));                        // 全家福
  g.add(b(0.05, 0.006, 0.10, C.peach, 0.27, 0.7965, 0.12, { outline: false }));
  g.add(b(0.05, 0.006, 0.10, C.blue, 0.34, 0.7965, 0.12, { outline: false }));
  g.add(b(0.19, 0.005, 0.14, C.road, 0.33, 0.792, -0.18));                        // 黑白照片
  g.add(b(0.12, 0.006, 0.08, C.tile, 0.33, 0.7965, -0.18, { outline: false }));
  // ---- 被风掀起的那只角：露在玻璃板外面，风一来抬起 4~5 毫米，又被压回去
  const flap = new THREE.Group();
  flap.position.set(-0.60, 0.795, -0.09);
  flap.add(b(0.13, 0.005, 0.12, C.cream, -0.065, 0, -0.06, { outline: false }));
  flap.add(b(0.10, 0.004, 0.012, C.road, -0.065, 0.004, -0.07, { outline: false }));
  g.add(flap);
  A.cert = flap;
  // ---- 桌面小物
  // 搪瓷缸：白底蓝边，缸沿磕掉一块
  const mug = new THREE.Group();
  mug.position.set(0.44, 0.79, 0.22);
  mug.add(cy(0.072, 0.064, 0.16, C.white, 0, 0.08, 0, 12));
  mug.add(cy(0.074, 0.074, 0.03, C.blue, 0, 0.145, 0, 12));
  mug.add(cy(0.060, 0.060, 0.005, C.wood, 0, 0.155, 0, 12));            // 茶面
  mug.add(b(0.02, 0.07, 0.03, C.white, 0.075, 0.09, 0, { outline: false }));   // 缸把
  g.add(mug);
  A.tea = mug.children[2];
  // 收音机：机身 + 喇叭格栅 + 两个旋钮 + 指示灯 + 拉出一半的天线
  const radio = new THREE.Group();
  radio.position.set(-0.46, 0.79, -0.28);
  radio.rotation.y = 0.18;
  radio.add(b(0.30, 0.16, 0.14, C.tile, 0, 0.08, 0, { outline: false }));
  radio.add(b(0.27, 0.135, 0.006, C.cream, 0, 0.085, 0.071, { outline: false }));
  for (let i = 0; i < 4; i++) {
    radio.add(b(0.15, 0.007, 0.004, C.road, -0.04, 0.055 + i * 0.021, 0.076,
      { outline: false }));
  }
  radio.add(cy(0.020, 0.020, 0.012, C.road, 0.085, 0.055, 0.076, 10));
  radio.add(cy(0.020, 0.020, 0.012, C.road, 0.085, 0.100, 0.076, 10));
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.013, 8, 6),
    M(C.coral, { emissive: C.coral, emissiveIntensity: 0.9 }));
  led.position.set(0.09, 0.137, 0.072);
  radio.add(led);
  A.led = led;
  const ant = cy(0.004, 0.004, 0.20, C.road, 0, 0, 0, 5);
  ant.position.set(-0.11, 0.22, 0);
  ant.rotation.z = 0.5;
  ant.castShadow = false;
  radio.add(ant);
  const ant2 = cy(0.003, 0.003, 0.12, C.road, 0, 0, 0, 5);
  ant2.position.set(-0.06, 0.31, 0);
  ant2.rotation.z = 0.36;
  ant2.castShadow = false;
  radio.add(ant2);
  g.add(radio);
  // 降压药板 + 两片抠掉的空泡
  g.add(b(0.13, 0.008, 0.09, C.white, 0.12, 0.795, 0.30, { outline: false }));
  for (let i = 0; i < 3; i++) {
    g.add(cy(0.011, 0.011, 0.006, C.blue, 0.08 + i * 0.035, 0.801, 0.30, 6));
  }
  g.add(b(0.05, 0.006, 0.05, C.coral, 0.20, 0.799, 0.30, { outline: false }));
  // 老花镜：两个圈 + 鼻梁 + 两条腿
  const specs = new THREE.Group();
  specs.position.set(0.30, 0.797, -0.30);
  specs.rotation.y = -0.5;
  for (const s of [-1, 1]) {
    const lens = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.005, 5, 14), M(C.ink));
    lens.rotation.x = Math.PI / 2;
    lens.position.set(s * 0.05, 0, 0);
    specs.add(lens);
    const arm = cy(0.004, 0.004, 0.14, C.ink, s * 0.095, 0, -0.08, 4);
    arm.rotation.x = Math.PI / 2;
    arm.rotation.z = s * 0.10;
    specs.add(arm);
  }
  specs.add(b(0.03, 0.006, 0.006, C.ink, 0, 0, 0, { outline: false }));
  g.add(specs);
  return g;
}

// ---------------------------------------------------------------- 门边台账
// 钉子上挂着翻开的收货台账，五行横线；下面坠着一支铅笔。
function ledgerBoard() {
  const g = new THREE.Group();
  g.add(cy(0.012, 0.012, 0.07, C.road, 0, 2.34, 0.02, 5));          // 钉子
  const bd = new THREE.Group();
  bd.position.set(0, 2.03, 0.06);
  bd.rotation.z = 0.045;
  bd.add(b(0.40, 0.54, 0.024, C.cream, 0, 0, 0));
  bd.add(b(0.40, 0.075, 0.026, C.blue, 0, 0.24, 0.002, { outline: false }));   // 蓝色表头
  bd.add(b(0.055, 0.09, 0.03, C.road, 0, 0.235, 0.014, { outline: false }));   // 铁夹
  for (let i = 0; i < 5; i++) {                                     // 五行横线
    bd.add(b(0.33, 0.006, 0.004, C.ink, 0, 0.13 - i * 0.075, 0.014, { outline: false }));
    bd.add(b(0.10, 0.006, 0.004, C.road, -0.10, 0.13 - i * 0.075, 0.015, { outline: false }));
  }
  bd.add(b(0.005, 0.42, 0.003, C.road, 0.02, -0.02, 0.014, { outline: false })); // 一道装订折痕
  const pen = cy(0.006, 0.006, 0.14, C.wood, 0.10, -0.30, 0.03, 5); // 铅笔
  pen.rotation.z = 0.25;
  bd.add(pen);
  bd.add(rope(0.10, -0.24, 0.03, 0.06, -0.18, 0.02, 0.004, C.road)); // 铅笔上的线
  g.add(bd);
  // 台账上沿再压一块小石头，风大，纸不飞
  g.add(b(0.07, 0.03, 0.05, C.road, 0.13, 2.31, 0.06, { outline: false }));
  return g;
}

// ---------------------------------------------------------------- 西侧
// 柴垛：原木的断面一律朝东（从院门进来先看见一圈一圈的年轮）
function woodPile() {
  const g = new THREE.Group();
  // 原木一律横着码：轴沿 x（从院子看过去是一圈一圈的断面），行距 0.30、层高 0.27
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 4 - r; i++) {
      const z = -0.45 + i * 0.30 + r * 0.15;
      const y = 0.15 + r * 0.27;
      const log = cy(0.13, 0.13, 1.12, r === 1 ? C.wood : C.tile, 0, y, z, 10);
      log.rotation.z = Math.PI / 2;
      g.add(log);
      for (const s of [-1, 1]) {
        const cap = cy(0.127, 0.127, 0.014, C.sand, s * 0.566, y, z, 10);
        cap.rotation.z = Math.PI / 2;
        g.add(cap);
      }
    }
  }
  // 顶上不盖板：俯视时原木的断面才是这一垛的表情
  g.add(flat(0.6, 0.45, C.sand, 0.35, 0.012, 0.72, 0.55));               // 地上的锯末
  g.add(flat(0.9, 0.5, C.tile, -0.1, 0.011, -0.72, 0.16));               // 潮气
  return g;
}
// 腌菜缸：粗陶的大肚缸，盖着木板、蒙一层布，布上压一块石头
function jarPickle() {
  const g = new THREE.Group();
  g.add(cy(0.24, 0.22, 0.07, C.tile, 0, 0.035, 0, 18));            // 圈足
  g.add(cy(0.29, 0.34, 0.34, C.soil, 0, 0.25, 0, 18));             // 缸腹（下大上小）
  g.add(cy(0.30, 0.29, 0.18, C.soil, 0, 0.51, 0, 18));             // 缸肩
  g.add(cy(0.31, 0.30, 0.05, C.tile, 0, 0.625, 0, 18));            // 缸沿
  g.add(cy(0.30, 0.30, 0.04, C.wood, 0, 0.67, 0, 18));             // 盖板
  g.add(cy(0.25, 0.25, 0.02, C.cream, 0, 0.695, 0, 16));           // 蒙着的一层布
  const stone = b(0.20, 0.16, 0.18, C.road, 0.02, 0.78, 0.02);     // 压石
  stone.rotation.z = 0.08;
  g.add(stone);
  g.add(flat(0.86, 0.66, C.tile, 0, 0.012, 0, 0.12));              // 缸脚一圈水渍
  g.add(flat(0.5, 0.34, C.blue, 0.12, 0.014, 0.16, 0.16));
  return g;
}
// 锄头：靠在西墙上（柄往 -x 倒，正好搭在墙面上）
function hoe() {
  const g = new THREE.Group();
  const h = cy(0.032, 0.030, 1.34, C.wood, 0, 0.68, 0, 8);
  h.rotation.z = -0.28;
  g.add(h);
  const bl = b(0.24, 0.19, 0.035, C.road, -0.24, 0.06, 0);
  bl.rotation.z = -0.28;
  g.add(bl);
  g.add(b(0.06, 0.05, 0.04, C.tile, -0.16, 0.14, 0, { outline: false }));
  return g;
}

// ---------------------------------------------------------------- 东侧
// 鸡窝：砖砌小窝 + 瓦顶 + 栖架 + 食盆 + 一堆稻草
function coop() {
  const g = new THREE.Group();
  g.add(b(1.30, 0.84, 1.00, M(C.white, { map: brickMap(C.soil, C.tile, 1.3, 0.84) }),
    0, 0.42, 0));
  g.add(b(1.46, 0.07, 1.16, C.tile, 0, 0.88, 0));                  // 窝顶
  const cap = b(1.50, 0.055, 1.22, C.road, 0, 0.955, 0);
  cap.rotation.x = -0.10;
  g.add(cap);
  g.add(b(0.34, 0.40, 0.06, C.ink, 0.05, 0.26, 0.50));             // 门洞
  g.add(b(0.40, 0.05, 0.09, C.tile, 0.05, 0.47, 0.50, { outline: false }));
  for (let i = 0; i < 2; i++) {                                     // 栖架
    const p = cy(0.028, 0.028, 0.92, C.wood, 0.86, 0.26 + i * 0.20, -0.1, 6);
    p.rotation.x = Math.PI / 2;
    g.add(p);
  }
  for (const s of [-1, 1]) {
    g.add(b(0.05, 0.46, 0.05, C.wood, 0.86, 0.23, s * 0.42, { outline: false }));
  }
  g.add(flat(1.3, 0.9, C.sand, 0.15, 0.012, 0.7, 0.35));           // 稻草
  g.add(flat(0.8, 0.42, C.sand, 0.5, 0.014, 0.86, 0.3));
  return g;
}

// 鸡：白羽、红冠、黄脚；头单独成组，啄食时只低头不挪窝
function chicken(tint = C.white, rot = 0) {
  const g = new THREE.Group();
  const body = ball(0.17, tint, 0, 0.27, -0.02, 12);
  body.scale.set(1.0, 0.92, 1.28);
  g.add(body);
  const head = new THREE.Group();
  head.position.set(0, 0.40, 0.17);
  const hd = ball(0.088, tint, 0, 0.02, 0, 10);
  head.add(hd);
  head.add(b(0.035, 0.07, 0.05, C.coral, 0, 0.10, -0.01, { outline: false }));  // 冠
  head.add(b(0.042, 0.026, 0.06, C.yellow, 0, 0.015, 0.10, { outline: false }));// 喙
  head.add(b(0.03, 0.038, 0.025, C.coral, 0, -0.035, 0.075, { outline: false }));// 肉垂
  g.add(head);
  for (let i = 0; i < 3; i++) {                                     // 尾巴三片
    const t = b(0.05, 0.17 - i * 0.02, 0.02, i ? C.cream : C.white,
      0, 0.36 + i * 0.015, -0.24 - i * 0.02, { outline: false });
    t.rotation.x = 0.65 + i * 0.12;
    g.add(t);
  }
  for (const s of [-1, 1]) {
    g.add(cy(0.012, 0.012, 0.20, C.yellow, s * 0.055, 0.10, 0.01, 5));
    // 一只脚踩在地上，一只微微抬着（站着歇腿）
    g.add(b(0.06, 0.02, 0.09, C.yellow, s * 0.055, 0.01, 0.05, { outline: false }));
  }
  g.rotation.y = rot;
  A.hens.push({ head, body, ph: A.hens.length * 2.7, per: 5.6 + A.hens.length * 2.1 });
  return g;
}

// 菜地：三垄，每垄三棵白菜，各带外叶
function cabbage(x, z, s = 1) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  for (let i = 0; i < 5; i++) {
    const a = i * (Math.PI * 2 / 5) + 0.28;
    const leaf = ball(0.135 * s, C.mint,
      Math.cos(a) * 0.08 * s, 0.085 * s, Math.sin(a) * 0.08 * s, 7);
    leaf.scale.set(1.45, 0.32, 1.0);
    leaf.rotation.y = a;
    leaf.rotation.z = 0.20;
    g.add(leaf);
    A.cabbages.push({ m: leaf, base: 0.20, ph: i * 1.7 + z });
  }
  const core = ball(0.125 * s, C.grass, 0, 0.17 * s, 0, 9);
  core.scale.set(1, 0.95, 1);
  g.add(core);
  g.add(ball(0.075 * s, C.grass, 0.02, 0.25 * s, 0.01, 7));      // 菜心再收一层
  return g;
}
function vegetablePlot() {
  const g = new THREE.Group();
  g.add(b(2.90, 0.14, 1.95, C.tile, 0, 0.07, 0));                 // 畦面：翻过的湿土
  for (let r = 0; r < 3; r++) {
    const z = -0.58 + r * 0.58;
    g.add(b(2.48, 0.14, 0.42, C.tile, 0, 0.13, z));               // 垄
    g.add(b(2.34, 0.07, 0.28, C.tile, 0, 0.21, z, { outline: false }));
    for (let c = 0; c < 3; c++) {
      g.add(cabbage(-0.78 + c * 0.78 + (r % 2) * 0.05, z, 1.22 + ((r + c) % 3) * 0.05));
    }
  }
  g.add(flat(2.4, 0.18, C.soil, 0, 0.16, 0.30, 0.18));            // 垄沟里一点干土
  return g;
}

// ---------------------------------------------------------------- 三轮车（次中心的一件）
// 车斗是旧绿的，轮子小；车斗里扔着半袋粮食和一把小铲。
function tricycle() {
  const g = new THREE.Group();
  // 车斗（旧绿漆，掉得一块一块）
  g.add(b(0.98, 0.44, 1.34, C.sea, 0, 0.62, 0));
  g.add(b(1.02, 0.05, 1.38, C.tile, 0, 0.86, 0));                 // 车斗上沿
  g.add(b(0.98, 0.06, 1.30, C.road, 0, 0.36, 0));                 // 斗底
  g.add(b(0.80, 0.10, 1.10, C.tile, 0, 0.34, 0, { outline: false }));
  g.add(b(0.16, 0.10, 0.20, C.coral, 0.44, 0.52, -0.34, { outline: false })); // 锈洞
  // 斗里装着半车干草 + 两只麻袋：从头顶看下去才知道这是一辆拉货的车，不是一张桌子
  const hay = ball(0.36, C.sand, 0, 0.74, 0.10, 10);
  hay.scale.set(1.10, 0.60, 1.25);
  g.add(hay);
  g.add(b(0.56, 0.06, 0.66, C.grass, 0.12, 0.86, 0.30, { outline: false }));
  g.add(b(0.34, 0.24, 0.26, C.cream, 0.24, 0.72, -0.40, { outline: false }));
  // 车架 + 前叉 + 车把
  g.add(b(0.16, 0.10, 1.30, C.road, 0, 0.30, 0, { outline: false }));
  g.add(b(0.12, 0.86, 0.10, C.road, 0, 0.52, 0.80));
  g.add(cy(0.035, 0.035, 0.62, C.ink, 0, 0.95, 0.80, 8));        // 车把立管
  const bar = cy(0.028, 0.028, 0.78, C.ink, 0, 1.16, 0.80, 8);
  bar.rotation.x = Math.PI / 2;
  g.add(bar);
  for (const s of [-1, 1]) {
    const grip = cy(0.036, 0.036, 0.12, C.dark, 0, 1.16, 0.80 + s * 0.36, 8);
    grip.rotation.x = Math.PI / 2;
    g.add(grip);
  }
  // 三个轮子：后二前一小
  for (const s of [-1, 1]) {
    const w = cy(0.26, 0.26, 0.075, C.dark, 0, 0.26, s * 0.60, 16);
    w.rotation.z = Math.PI / 2;
    g.add(w);
    g.add(cy(0.09, 0.09, 0.085, C.road, 0, 0.26, s * 0.60, 8));
  }
  const fw = cy(0.21, 0.21, 0.065, C.dark, 0, 0.21, 0.94, 16);
  fw.rotation.z = Math.PI / 2;
  g.add(fw);
  g.add(cy(0.06, 0.06, 0.075, C.road, 0, 0.21, 0.94, 8));
  // 车斗里的东西
  const sack = ball(0.22, C.sand, -0.12, 0.78, -0.30, 9);
  sack.scale.set(1, 0.72, 1.05);
  g.add(sack);
  g.add(b(0.06, 0.60, 0.10, C.wood, 0.30, 0.70, 0.26, { outline: false })); // 小铲柄
  g.add(b(0.16, 0.14, 0.03, C.road, 0.30, 0.44, 0.26, { outline: false }));
  return g;
}

// ---------------------------------------------------------------- 南边小件
function broom() {
  const g = new THREE.Group();
  // 帚柄斜靠在南墙上（往 +z 倒），帚头落地
  const h = cy(0.028, 0.028, 1.30, C.wood, 0, 1.05, 0.16, 6);
  h.rotation.x = -0.28;
  g.add(h);
  for (let i = 0; i < 7; i++) {                                    // 扫帚头：一束高粱秆
    const s = b(0.018, 0.34, 0.018, i % 2 ? C.sand : C.soil, (i - 3) * 0.026, 0.2, -0.02,
      { outline: false });
    s.rotation.x = -0.28;
    g.add(s);
  }
  g.add(b(0.24, 0.05, 0.05, C.coral, 0, 0.38, 0.06, { outline: false }));  // 捆绳
  return g;
}
function shoes() {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const sh = b(0.15, 0.09, 0.30, C.dark, s * 0.10, 0.045, 0, { outline: false });
    sh.rotation.y = s * 0.07;
    g.add(sh);
    g.add(b(0.16, 0.02, 0.32, C.cream, s * 0.10, 0.012, 0, { outline: false }));
    g.add(b(0.13, 0.03, 0.06, C.road, s * 0.10, 0.09, -0.13, { outline: false }));
  }
  return g;
}

// ---------------------------------------------------------------- 晾衣绳（东南）
// 一头拴在堂屋东山的墙角，一头拴在院南的竹竿上；两件小孩衣服轻摆。
function laundry() {
  const g = new THREE.Group();
  const AX = 3.42, AY = 1.98, AZ = -3.18;
  const BX = 4.55, BY = 1.92, BZ = 4.62;
  g.add(rope(AX, AY, AZ, BX, BY, BZ, 0.008, C.tile));
  // 竹竿 + 竿脚的石块
  g.add(cy(0.036, 0.032, 2.0, C.wood, BX, 1.0, BZ, 8));
  for (let i = 0; i < 3; i++) {
    g.add(cy(0.037, 0.037, 0.03, C.sand, BX, 0.4 + i * 0.55, BZ, 8));
  }
  g.add(b(0.28, 0.10, 0.28, C.road, BX, 0.05, BZ, { outline: false }));
  // 两件小孩衣服：一件上衣、一条裤子
  for (let i = 0; i < 2; i++) {
    const t = 0.28 + i * 0.30;
    const x = AX + (BX - AX) * t;
    const y = AY + (BY - AY) * t;
    const z = AZ + (BZ - AZ) * t;
    const cl = new THREE.Group();
    cl.position.set(x, y, z);
    // 衣服往一边歪着挂：正对绳向的话，从东西两头看过去会薄成一条线
    cl.rotation.y = Math.atan2(BX - AX, BZ - AZ) + (i ? 0.42 : -0.34);
    cl.rotation.z = i ? 0.04 : -0.05;
    if (i === 0) {
      cl.add(b(0.30, 0.30, 0.012, C.peach, 0, -0.19, 0, { outline: false }));
      for (const s of [-1, 1]) {
        const sleeve = b(0.09, 0.17, 0.011, C.peach, s * 0.19, -0.12, 0,
          { outline: false });
        sleeve.rotation.y = s * 0.30;
        cl.add(sleeve);
      }
      cl.add(b(0.16, 0.05, 0.02, C.cream, 0, -0.045, 0, { outline: false }));   // 领口
      cl.add(b(0.30, 0.025, 0.016, C.cream, 0, -0.34, 0, { outline: false }));  // 下摆
    } else {
      cl.add(b(0.30, 0.10, 0.012, C.blue, 0, -0.07, 0, { outline: false }));
      for (const s of [-1, 1]) {
        const leg = b(0.12, 0.24, 0.011, C.blue, s * 0.075, -0.23, 0, { outline: false });
        leg.rotation.z = s * 0.04;
        cl.add(leg);
      }
      cl.add(b(0.30, 0.025, 0.014, C.cream, 0, -0.025, 0, { outline: false })); // 松紧带
    }
    cl.add(b(0.05, 0.06, 0.02, C.road, 0, -0.01, 0, { outline: false }));  // 夹子
    g.add(cl);
    A.clothes.push(cl);
  }
  return g;
}

// ---------------------------------------------------------------- 屋檐的影子
// 阴影贴图只算一次（§2 第 9 条），所以"太阳在走"只能靠这层假影：
// 墙上一排瓦垄的明暗线 + 地上一道檐影，两者一起极缓横移。
function eaveShadowWall() {
  const g = new THREE.Group();
  g.add(face(6.5, 0.30, C.tile, 0, 2.80, 0.0, 0.10));            // 檐口底下那条暗带
  for (let i = 0; i < 16; i++) {                                   // 16 道瓦垄的影
    g.add(face(0.12, 0.62, C.tile, -3.3 + i * 0.44, 2.44, 0.004, 0.07));
  }
  g.add(face(6.5, 0.10, C.tile, 0, 2.98, 0.002, 0.16));           // 檐口压边的一道硬影
  return g;
}
function eaveShadowGround() {
  const g = new THREE.Group();
  g.add(flat(6.9, 0.62, C.tile, 0, 0.017, 0.30, 0.10));
  for (let i = 0; i < 6; i++) {
    g.add(flat(0.16, 0.86, C.tile, -2.8 + i * 1.12, 0.016, 0.55, 0.06));
  }
  return g;
}

// ---------------------------------------------------------------- 杂项
function feedBowl() {
  const g = new THREE.Group();
  g.add(cy(0.21, 0.17, 0.11, C.tile, 0, 0.055, 0, 14));
  g.add(cy(0.175, 0.175, 0.008, C.blue, 0, 0.10, 0, 14));
  A.feed = g.children[1];
  for (let i = 0; i < 5; i++) {                                    // 撒在外面的几粒玉米
    g.add(ball(0.014, C.yellow, 0.26 + (i % 3) * 0.05, 0.012, (i - 2) * 0.05, 5));
  }
  return g;
}
function stool(x = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.add(b(0.34, 0.045, 0.30, C.wood, 0, 0.235, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(b(0.035, 0.23, 0.035, C.tile, sx * 0.13, 0.115, sz * 0.11, { outline: false }));
  }
  g.add(b(0.30, 0.03, 0.03, C.tile, 0, 0.09, 0, { outline: false }));
  return g;
}
function basket() {
  const g = new THREE.Group();
  g.add(cy(0.21, 0.17, 0.28, C.sand, 0, 0.14, 0, 14));
  for (let i = 0; i < 3; i++) {
    g.add(cy(0.205 - i * 0.012, 0.205 - i * 0.012, 0.02, C.wood, 0, 0.05 + i * 0.09, 0, 14));
  }
  g.add(cy(0.20, 0.20, 0.03, C.grass, 0, 0.29, 0, 12));            // 里面一把草
  return g;
}
function stonePile(n, spread) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const s = ball(0.06 + jit(i + 1) * 0.06, i % 2 ? C.road : C.tile,
      (jit(i * 3 + 1) - 0.5) * spread, 0.05, (jit(i * 5 + 2) - 0.5) * spread * 0.7, 6);
    s.scale.set(1.25, 0.7, 1.0);
    g.add(s);
  }
  return g;
}

// ---------------------------------------------------------------- 场景数据
// 一层：地面（水泥 / 土路 / 草地）；二层：院墙 / 堂屋 / 院门；三层：陈设与人物。
const props = [
  // ===== 地面：院外一圈（土路 + 草沿）
  { id: "g_laneS", x: 0, z: 6.95, w: 14.6, d: 2.9, passable: true,
    build: () => ground(14.6, 2.9, 0, 0, null, C.soil, 0.004) },
  { id: "g_rut1", x: 0, z: 6.42, w: 14.0, d: 0.16, passable: true,
    build: () => flat(14.0, 0.16, C.tile, 0, 0.013, 0, 0.16) },
  { id: "g_rut2", x: 0, z: 7.55, w: 14.0, d: 0.16, passable: true,
    build: () => flat(14.0, 0.16, C.tile, 0, 0.013, 0, 0.13) },
  { id: "g_roadPatch", x: -1.1, z: 7.0, w: 2.2, d: 1.1, passable: true,
    build: () => flat(2.2, 1.1, C.road, 0, 0.012, 0, 0.30) },
  { id: "g_vergeS", x: 0, z: 8.62, w: 15.2, d: 1.15, passable: true,
    build: () => ground(15.2, 1.15, 0, 0, null, C.grass, 0.005) },
  { id: "g_laneW", x: -7.75, z: -0.45, w: 2.42, d: 12.0, passable: true,
    build: () => ground(2.42, 12.0, 0, 0, null, C.soil, 0.0045) },
  { id: "g_eastGrass", x: 7.85, z: -0.8, w: 2.40, d: 11.4, passable: true,
    build: () => ground(2.40, 11.4, 0, 0, null, C.grass, 0.005) },
  { id: "g_northGrass", x: 0, z: -8.05, w: 15.0, d: 2.2, passable: true,
    build: () => ground(15.0, 2.2, 0, 0, null, C.grass, 0.005) },
  { id: "g_gatePath", x: -6.92, z: 2.35, w: 1.25, d: 2.5, passable: true,
    build: () => {
      const g = new THREE.Group();
      g.add(ground(1.25, 2.5, 0, 0, null, C.road, 0.006));
      for (let i = 0; i < 3; i++) {
        g.add(b(0.9, 0.05, 0.62, C.tile, 0, 0.025, -0.72 + i * 0.72, { outline: false }));
      }
      return g;
    } },
  { id: "g_puddle", x: 2.4, z: 7.32, w: 1.5, d: 0.7, passable: true,
    build: () => {
      const g = new THREE.Group();
      g.add(flat(1.45, 0.66, C.blue, 0, 0.014, 0, 0.24));
      g.add(flat(0.8, 0.3, C.glass, -0.15, 0.016, 0, 0.20));
      return g;
    } },

  // ===== 院子地面：水泥一整块 + 三块补丁 + 两道裂缝 + 一条磨痕
  { id: "g_yard", x: 0, z: -0.70, w: 12.62, d: 11.7, passable: true,
    build: () => ground(12.62, 11.7, 0, 0, null, C.sand, 0.006) },
  { id: "g_apron", x: 0.2, z: -3.02, w: 6.9, d: 0.52, passable: true,
    build: () => ground(6.9, 0.52, 0, 0, null, C.cream, 0.0075) },
  { id: "g_patch1", x: -2.32, z: 2.16, w: 2.2, d: 1.55, passable: true,
    build: () => {
      const g = new THREE.Group();
      g.add(flat(2.2, 1.55, C.soil, 0, 0.010, 0, 0.42));
      g.add(flat(2.0, 1.35, C.tile, 0, 0.011, 0, 0.10));
      return g;
    } },
  { id: "g_patch2", x: 2.62, z: 0.62, w: 1.55, d: 1.15, passable: true,
    build: () => {
      const g = new THREE.Group();
      g.add(flat(1.55, 1.15, C.cream, 0, 0.010, 0, 0.22, 0.05));
      g.add(flat(1.30, 0.95, C.white, 0, 0.011, 0, 0.14, 0.05));
      return g;
    } },
  { id: "g_patch3", x: 5.05, z: -0.42, w: 1.0, d: 0.72, passable: true,
    build: () => flat(1.0, 0.72, C.soil, 0, 0.010, 0, 0.34) },
  { id: "g_patch4", x: -1.45, z: 1.35, w: 3.2, d: 2.0, passable: true,
    build: () => flat(3.2, 2.0, C.cream, 0, 0.0095, 0, 0.17, 0.05) },
  { id: "g_patch5", x: 2.60, z: 3.95, w: 2.4, d: 1.3, passable: true,
    build: () => flat(2.4, 1.3, C.cream, 0, 0.0095, 0, 0.14, -0.07) },
  { id: "g_crack1", x: 1.10, z: 2.30, w: 1.9, d: 1.6, passable: true,
    build: () => crackLine([[-0.86, 0.72], [-0.20, 0.40], [0.22, 0.28],
      [0.30, -0.12], [0.92, -0.34]], 0.032, 0.52) },
  { id: "g_crack2", x: -3.90, z: 0.32, w: 1.5, d: 1.2, passable: true,
    build: () => crackLine([[-0.70, 0.56], [-0.16, 0.40], [0.18, 0.44],
      [0.40, 0.10], [0.76, -0.06]], 0.028, 0.46) },
  { id: "g_worn", x: -3.65, z: 2.95, w: 1.5, d: 3.2, passable: true,
    build: () => {
      const g = new THREE.Group();
      g.add(flat(1.45, 3.2, C.tile, 0, 0.009, 0, 0.10));
      g.add(flat(0.9, 2.9, C.tile, 0.05, 0.0095, 0, 0.07));
      return g;
    } },
  { id: "g_damp", x: -5.10, z: 1.58, w: 1.1, d: 0.8, passable: true,
    build: () => {
      const g = new THREE.Group();
      g.add(flat(1.1, 0.8, C.tile, 0, 0.011, 0, 0.20));
      g.add(flat(0.55, 0.34, C.blue, 0.1, 0.013, 0.05, 0.16));
      return g;
    } },
  { id: "g_leaves", x: -4.30, z: 3.95, w: 2.0, d: 1.3, passable: true,
    build: () => {
      const g = new THREE.Group();
      for (let i = 0; i < 9; i++) {
        const lf = flat(0.13, 0.075, i % 3 ? C.wood : C.tile,
          (jit(i + 2) - 0.5) * 1.9, 0.013, (jit(i * 2 + 5) - 0.5) * 1.2, 0.85);
        lf.rotation.y = i * 1.1;
        g.add(lf);
      }
      return g;
    } },
  { id: "g_straw", x: 4.55, z: -2.95, w: 1.6, d: 0.9, passable: true,
    build: () => {
      const g = new THREE.Group();
      for (let i = 0; i < 10; i++) {
        const st = flat(0.22, 0.022, i % 2 ? C.sand : C.wood,
          (jit(i + 7) - 0.5) * 1.5, 0.013, (jit(i * 3 + 2) - 0.5) * 0.8, 0.9);
        st.rotation.y = i * 0.7;
        g.add(st);
      }
      return g;
    } },
  { id: "g_laneStones", x: -0.4, z: 6.15, w: 2.4, d: 0.8, passable: true,
    build: () => stonePile(6, 2.2) },

  // ===== 院墙三面（南面只留 0.62）
  { id: "s_wallS", x: 0, z: 5.15, w: 12.9, d: 0.30, build: () => southWall(12.9),
    interact: { x: 0, z: 4.30 } },
  { id: "s_wallE", x: 6.35, z: -0.70, w: 0.30, d: 11.7, rot: Math.PI / 2,
    build: () => yardWall(11.7),
    interact: { x: 5.60, z: 0.60 } },
  { id: "s_wallW1", x: -6.35, z: -2.60, w: 0.30, d: 7.90, rot: Math.PI / 2,
    build: () => yardWall(7.90),
    interact: { x: -5.60, z: -2.60 } },
  { id: "s_wallW2", x: -6.35, z: 4.25, w: 0.30, d: 1.80, rot: Math.PI / 2,
    build: () => yardWall(1.80) },
  { id: "s_wallN1", x: -4.75, z: -6.55, w: 3.20, d: 0.30, build: () => yardWall(3.20) },
  { id: "s_wallN2", x: 4.90, z: -6.55, w: 2.90, d: 0.30, build: () => yardWall(2.90) },

  // ===== 院门（次中心）
  { id: "s_gate", x: -6.35, z: 2.35, w: 0.62, d: 2.62, build: gate,
    interact: { x: -5.55, z: 2.35 } },
  { id: "s_gateStep", x: -5.92, z: 2.35, w: 0.85, d: 2.30, passable: true,
    build: () => {
      const g = new THREE.Group();
      g.add(b(0.85, 0.08, 2.30, C.road, 0, 0.04, 0, { outline: false }));
      g.add(b(0.70, 0.06, 2.10, C.tile, 0, 0.09, 0, { outline: false }));
      return g;
    } },

  // ===== 堂屋（北）
  { id: "s_house", x: 0.2, z: -4.9, w: 6.6, d: 3.3, build: house,
    interact: { x: -0.35, z: -2.30 } },
  { id: "s_step", x: -0.35, z: -2.95, w: 1.95, d: 0.58,
    build: () => {
      const g = new THREE.Group();
      g.add(b(1.95, 0.10, 0.56, C.road, 0, 0.05, 0));
      g.add(b(1.78, 0.02, 0.44, C.cream, 0, 0.11, 0.01, { outline: false }));
      g.add(b(1.70, 0.06, 0.10, C.tile, 0, 0.03, 0.30, { outline: false }));
      return g;
    } },
  { id: "s_ledger", x: -1.75, z: -3.14, w: 0.40, d: 0.10, build: ledgerBoard,
    interact: { x: -1.75, z: -2.30 } },
  { id: "s_chili", x: 2.44, z: -3.02, w: 0.9, d: 0.20, passable: true,
    build: () => {
      const g = new THREE.Group();
      for (let k = 0; k < 2; k++) {
        const str = new THREE.Group();
        str.position.set(k * 0.44 - 0.22, 2.88, 0.04);
        str.add(cy(0.006, 0.006, 0.16, C.wood, 0, -0.08, 0, 4));
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const pep = cy(0.024, 0.016, 0.17, i % 2 ? C.coral : C.peach,
            Math.cos(a) * 0.075, -0.16 - i * 0.028, Math.sin(a) * 0.075, 6);
          pep.rotation.z = Math.cos(a) * 0.22;
          pep.rotation.x = -Math.sin(a) * 0.22;
          str.add(pep);
        }
        str.add(ball(0.035, C.grass, 0, -0.02, 0, 6));      // 顶上一片叶
        g.add(str);
        A.chili.push(str);
      }
      return g;
    } },
  { id: "s_lamp", x: -0.35, z: -2.98, w: 0.2, d: 0.2, passable: true,
    build: () => {
      const g = new THREE.Group();
      g.add(cy(0.012, 0.012, 0.22, C.road, 0, 2.94, 0, 5));       // 从檐口吊下来的杆
      g.add(cy(0.10, 0.10, 0.09, C.white, 0, 2.80, 0, 14));        // 筒灯外壳
      g.add(cy(0.115, 0.115, 0.03, C.cream, 0, 2.855, 0, 14));
      const bulb = cy(0.075, 0.075, 0.014, M(C.yellow, {
        emissive: C.yellow, emissiveIntensity: 0.55
      }), 0, 2.752, 0, 16);
      g.add(bulb);
      A.lamp = bulb;
      return g;
    } },
  { id: "s_plant1", x: -2.78, z: -2.94, w: 0.6, d: 0.5, passable: true,
    build: () => bush(0, 0, 0.19, C.grass, C.mint) },
  { id: "s_plant2", x: 2.72, z: -2.94, w: 0.6, d: 0.5, passable: true,
    build: () => bush(0, 0, 0.17, C.grass, C.mint) },

  // ===== 方桌（视觉中心）+ 座具 + 左右两只鸡
  { id: "s_table", x: 0.45, z: -1.55, w: 1.66, d: 1.12, build: tableTop,
    interact: { x: 0.45, z: -0.62 } },
  { id: "s_stool", x: -0.90, z: -1.70, w: 0.36, d: 0.32, passable: true,
    build: () => stool(0, 0) },
  { id: "s_stool2", x: -1.85, z: -2.12, w: 0.36, d: 0.32, passable: true,
    build: () => { const g = stool(0, 0); g.rotation.y = 0.4; return g; } },
  { id: "s_shoes", x: 1.05, z: -2.92, w: 0.4, d: 0.3, passable: true, build: shoes },
  { id: "s_hen1", x: 4.42, z: -1.30, w: 0.4, d: 0.4, passable: true,
    build: () => chicken(C.white, 2.2) },
  { id: "s_hen2", x: 3.52, z: -0.55, w: 0.4, d: 0.4, passable: true,
    build: () => chicken(C.cream, -0.9) },
  { id: "s_feed", x: 4.05, z: -2.12, w: 0.44, d: 0.44, passable: true, build: feedBowl },

  // ===== 西侧：柴垛、腌菜缸、锄头、三轮车
  { id: "s_wood", x: -5.22, z: -2.50, w: 1.95, d: 1.30, build: woodPile,
    interact: { x: -3.95, z: -2.50 } },
  { id: "s_pickle", x: -5.52, z: -0.30, w: 0.80, d: 0.80, build: jarPickle,
    interact: { x: -4.75, z: -0.30 } },
  { id: "s_hoe", x: -5.82, z: 0.10, w: 0.50, d: 0.40, passable: true, build: hoe },
  { id: "s_trike", x: -4.35, z: 4.25, w: 1.95, d: 1.05, rot: Math.PI / 2, build: tricycle,
    interact: { x: -4.35, z: 3.50 } },
  { id: "s_trikeShadow", x: -4.35, z: 4.25, w: 0.1, d: 0.1, passable: true,
    build: () => flat(2.4, 1.25, C.dark, 0, 0.014, 0, 0.16) },
  { id: "s_basket", x: -2.70, z: 4.62, w: 0.5, d: 0.5, passable: true, build: basket },

  // ===== 东侧：鸡窝、菜地、水桶、绿植
  { id: "s_coop", x: 5.38, z: -2.55, w: 1.5, d: 1.2, build: coop,
    interact: { x: 4.35, z: -2.55 } },
  { id: "s_field", x: 4.55, z: 1.95, w: 2.92, d: 1.97, build: vegetablePlot,
    interact: { x: 2.80, z: 1.95 } },
  { id: "s_bucket", x: 2.86, z: 1.30, w: 0.36, d: 0.36, passable: true,
    build: () => {
      const g = new THREE.Group();
      g.add(cy(0.16, 0.13, 0.26, C.road, 0, 0.13, 0, 12));
      g.add(cy(0.155, 0.155, 0.02, C.blue, 0, 0.25, 0, 12));
      g.add(cy(0.012, 0.012, 0.36, C.ink, 0, 0.42, 0, 4));
      return g;
    } },
  { id: "s_plant3", x: 5.90, z: -4.55, w: 0.7, d: 0.7, passable: true,
    build: () => bush(0, 0, 0.30, C.grass, C.mint) },
  { id: "s_tiles", x: 4.75, z: -4.72, w: 0.5, d: 0.4, passable: true,
    build: () => {
      const g = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const t = b(0.24, 0.035, 0.17, i % 2 ? C.tile : C.road,
          (i - 1) * 0.15, 0.02, (i % 2) * 0.10, { outline: false });
        t.rotation.y = i * 0.8;
        t.rotation.z = 0.12;
        g.add(t);
      }
      return g;
    } },

  // ===== 东南：晾衣绳、扫帚、竹筐
  { id: "s_laundry", x: 0, z: 0, w: 0.1, d: 0.1, passable: true, build: laundry },
  { id: "s_broom", x: 5.20, z: 4.78, w: 0.45, d: 0.30, passable: true, build: broom,
    interact: { x: 4.60, z: 4.30 } },

  // ===== 外景小件
  { id: "s_outStones", x: -7.35, z: 0.85, w: 0.9, d: 0.7, passable: true,
    build: () => stonePile(4, 0.8) },
  { id: "s_outBasket", x: -7.55, z: 3.85, w: 0.5, d: 0.5, passable: true, build: basket },
  { id: "s_brickPile", x: 7.60, z: -4.30, w: 1.0, d: 0.8, passable: true,
    build: () => {
      const g = new THREE.Group();
      for (let r = 0; r < 3; r++) {
        for (let i = 0; i < 3 - r; i++) {
          g.add(b(0.42, 0.12, 0.22, r % 2 ? C.road : C.brick,
            -0.3 + i * 0.3 + r * 0.08, 0.07 + r * 0.13, (r % 2) * 0.04,
            { outline: false }));
        }
      }
      return g;
    } },
  { id: "s_outBush1", x: 7.75, z: 1.60, w: 0.7, d: 0.7, passable: true,
    build: () => bush(0, 0, 0.30, C.grass, C.mint) },
  { id: "s_outBush2", x: -7.90, z: -5.60, w: 0.7, d: 0.7, passable: true,
    build: () => bush(0, 0, 0.28, C.grass, C.mint) },
  { id: "s_outBush3", x: 2.90, z: -7.55, w: 0.7, d: 0.7, passable: true,
    build: () => bush(0, 0, 0.26, C.grass, C.mint) },

  // ===== 影子与光（一律 passable，不参与碰撞）
  { id: "s_eaveWall", x: 0.2, z: -3.235, w: 0.1, d: 0.1, passable: true,
    build: () => { A.eaveWall = eaveShadowWall(); return A.eaveWall; } },
  { id: "s_eaveGround", x: 0.2, z: -2.45, w: 0.1, d: 0.1, passable: true,
    build: () => { A.eaveGround = eaveShadowGround(); return A.eaveGround; } }
];

// 障碍：院墙、堂屋、院门、方桌、柴垛、腌菜缸、三轮车、鸡窝、菜地
const obstacles = props.filter((p) => !p.passable).map((p) => ({
  x: p.x, z: p.z, w: p.w, d: p.d
}));

// 关键人物：张守义站在方桌东侧（一手按在玻璃板上）；张建军在院门里侧
const characters = [
  { id: "p_b", label: "张守义", name: "张守义", role: "被投诉人",
    x: 1.66, z: -1.42, facing: -1.85, pose: "stand",
    color: C.navy, pants: C.tile, hair: "#8d8579" },
  { id: "zhang_jianjun", label: "张建军", name: "张建军", role: "村委会副主任",
    x: -5.28, z: 2.30, facing: 1.70, pose: "stand",
    color: C.road, pants: C.dark, hair: "#2e251e" }
];

let scene;
try {
  scene = createScene({
    mount: document.getElementById("stage"),
    room: null,                                   // 室外：没有墙、没有吊顶
    props,
    obstacles,
    characters,
    lamps: [],
    // 底座三层出边 + 外景草地：模型落在一片同色环境里，不是悬在虚空
    baseColor: C.cream, baseSideColor: C.navy, siteColor: C.grass,
    terrainSideColor: C.tile,
    outer: true, outerColor: C.grass,
    // 上午十点：天顶一点蓝、地平线一线暖，日头已经高了
    skyTop: C.blue, skyMid: C.glass, skyBottom: C.cream,
    light: { sun: C.cream, sunI: 2.15, fill: C.blue, fillI: 0.9, hemi: 0.62,
             hemiSky: C.glass, hemiGround: C.sand, exposure: 0.95 },
    fogDensity: 0.008,
    actor: { x: -2.20, z: 3.70 },
    camYaw: 0.42, camPitch: 0.60, camDist: 17, camFocus: [0, 1.0, -0.6],
    walk: { x0: -5.75, x1: 5.75, z0: -2.55, z1: 4.55 },
    onSpot: (p) => { (window.__events = window.__events || []).push(["spot", p.id]); },
    onPerson: (p) => { (window.__events = window.__events || []).push(["person", p.id]); },
    onArrived: (p) => { (window.__events = window.__events || []).push(["arrived", +p.x.toFixed(2), +p.z.toFixed(2)]); },
    onSeat: (p) => { (window.__events = window.__events || []).push(["seat", p.id]); },
    // ---- 基础动效：12 条，幅度全部 2% 量级
    onFrame: (t) => {
      // ① 收音机指示灯：极缓的呼吸 1.8%（只够看出来"还通着电"）
      if (A.led) {
        A.led.material.emissiveIntensity = 0.9 * (1 + Math.sin(t * 0.55) * 0.018);
      }
      // ② 两只鸡原地啄食：只转头和一点身体，position 一次都不碰（不位移）
      for (const h of A.hens) {
        const q = (t + h.ph) % h.per;
        const a = q < 0.9 ? Math.sin((q / 0.9) * Math.PI) : 0;
        h.head.rotation.x = a * 0.58;
        h.body.rotation.x = a * 0.035;
      }
      // ③ 屋檐的影子随太阳缓慢移动：瓦垄的明暗线一条条扫过墙面（周期约 8 分钟）
      if (A.eaveWall) { A.eaveWall.position.x = Math.sin(t * 0.012) * 0.10; }
      if (A.eaveGround) { A.eaveGround.position.x = Math.sin(t * 0.012 + 0.4) * 0.16; }
      // ④ 晾衣绳上的小孩衣服轻轻摆（0.025 弧度，两件不同相）
      for (let i = 0; i < A.clothes.length; i++) {
        const c = A.clothes[i];
        c.rotation.z = Math.sin(t * 1.05 + i * 1.9) * 0.025;
        c.rotation.x = Math.sin(t * 0.72 + i * 1.3) * 0.012;
      }
      // ⑤ 玻璃板外那只证件角：风一来抬起 4~5 毫米，又被玻璃压回去
      if (A.cert) {
        const gust = Math.pow(Math.max(0, Math.sin(t * 0.42 + 0.7)), 3);
        A.cert.rotation.z = -0.055 * gust;
        A.cert.rotation.x = 0.040 * gust;
      }
      // ⑥ 檐下筒灯：1.8% 的呼吸（白天也一直亮着，省电，但没关）
      if (A.lamp) {
        A.lamp.material.emissiveIntensity = 0.55 * (1 + Math.sin(t * 1.35) * 0.018);
      }
      // ⑦ 檐下两串干辣椒轻轻摆（0.018 弧度）
      for (let i = 0; i < A.chili.length; i++) {
        A.chili[i].rotation.x = Math.sin(t * 0.72 + i * 1.4) * 0.018;
        A.chili[i].rotation.z = Math.sin(t * 0.51 + i) * 0.012;
      }
      // ⑧ 门帘五片：穿堂风一阵一阵，0.02 弧度，两片错开
      for (let i = 0; i < A.veil.length; i++) {
        const g2 = 0.55 + 0.45 * Math.sin(t * 0.19 + i * 0.7);
        A.veil[i].rotation.x = Math.sin(t * 0.86 + i * 1.9) * 0.02 * g2;
      }
      // ⑨ 鸡食盆里的水：极缓的一圈呼吸 2%
      if (A.feed) {
        const k = 1 + Math.sin(t * 1.05) * 0.02;
        A.feed.scale.set(k, 1, 1 + Math.cos(t * 0.92) * 0.02);
      }
      // ⑩ 白菜的外叶：一层一层轻轻起伏（0.02 弧度）
      for (let i = 0; i < A.cabbages.length; i++) {
        const cb = A.cabbages[i];
        cb.m.rotation.z = cb.base * (0.9 + 0.10 * Math.sin(t * 0.8 + cb.ph));
      }
      // ⑪ 搪瓷缸里的茶面：一圈 2% 的呼吸
      if (A.tea) {
        const k = 1 + Math.sin(t * 1.6) * 0.02;
        A.tea.scale.set(k, 1, k);
      }
      // ⑫ 地上的檐影再往南挪一点点：太阳每十分钟高一寸，影子缩回墙根
      if (A.eaveGround) {
        A.eaveGround.position.z = Math.sin(t * 0.05) * 0.02;
      }
    }
  });
} catch (err) {
  window.__err = String((err && err.stack) || err);
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
