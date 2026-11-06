// S5 · 李家院（上午 10:00）—— 李秀兰的主场，真相暗线所在地
// -----------------------------------------------------------------------------
// 按 docs/场景与人物建模提示词.md §1 + §3 S5 重做（2026-11-04，质量第一）。
// 七段结构一一对应：画面风格 / 底座与构图 / 时间与氛围 / 建筑 / 陈设 / 动效 / 避免。
//   ① 颜色只用 kit.PAL 那 19 个（15 主色 + 4 个土地色），本文件没有一个色板外色值；
//   ② 大件描边由 kit.b 自动给（最大边 > 0.55），小件不加，免得糊；
//   ③ 零噪点：院地 / 墙 / 瓦 / 菜地全纯色，砖只用 kit.brickTex 的纯色砖格，
//      全文件一处 Math.random 都没有（噪点会让模型显脏）；
//   ④ 四格：西北 蜂窝煤 + 旧自行车 + 水缸 / 东北 鸡窝 + 晾衣绳 + 两只鸡 /
//            西南 木栅栏小门 + 翻墙剩的砖 + 扫帚 / 东南 菜地 + 菜筐 + 李秀兰；
//   ⑤ 视觉中心 堂屋门口那张方桌（缴费单 + 低保材料），次中心 新檐 + 檐下滴水坑；
//   ⑥ onFrame 12 条 2% 量级的循环（檐水 / 涟漪 / 挂珠 / 晾衣 / 衣角滴水 / 啄食 /
//      藤蔓 / 檐影下移 / 玉米串 / 门帘 / 水缸水面 / 单据翘角）。
//
// ★ 全场最重要的物证：新翻的坡屋顶 —— 十六道瓦垄、瓦色比张家亮两档，
//   但檐口是一条**平齐的瓦头**：没有滴水线、没有雨槽、没有引水管。
//   雨水从这条平瓦口直接外抛，正下方的地上被砸出一个坑。
//   所以 DRIP_X / DRIP_Z 不是随手给的：DRIP_Z 就等于檐口前缘的世界 z（EAVE_Z），
//   水珠垂直落下，落点与瓦头在同一条铅垂线上 —— 这是"新檐不接水"唯一可能的位置。
// -----------------------------------------------------------------------------
import * as THREE from "./vendor/three.module.min.js";
import { PAL as C, M, b, cy, ball, decal, ground, bush, brickTex } from "./kit.js";
import { createScene } from "./scene3d.js";

window.__err = "";
window.addEventListener("error", (e) => {
  window.__err = (e.message || "error") + " @ " + (e.filename || "") + ":" + (e.lineno || 0);
});

// ---------------------------------------------------------------- 坐标：先算数，再摆东西
const HX = -1.00, HZ = -4.75;                    // 堂屋中心（世界 x / z）
const HW = 6.40, HD = 3.30, HH = 2.70;           // 面阔 / 进深 / 檐墙高
const OVER = 0.55;                               // 出檐
const FACE = HZ + HD / 2;                        // 前脸 z = -3.10
const EAVE_Z = FACE + OVER;                      // 檐口前缘 z = -2.55
const EAVE_TOP = 2.62;                           // 檐口瓦头顶面
const EAVE_UNDER = 2.55;                         // 檐口瓦头底面（水珠从这里离檐）
const RIDGE_Y = EAVE_TOP + 1.00;                 // 屋脊 3.62
const RUN = HD / 2 + OVER;                       // 坡面水平投影 2.20
const SLOPE = Math.atan2(1.00, RUN);             // 坡角 0.427
const SLOPE_L = Math.hypot(1.00, RUN);           // 坡长 2.416
const DRIP_X = -2.75, DRIP_Z = EAVE_Z;           // ★ 落点 = 檐口正下方
const YARD = { x0: -7.60, x1: 7.60, z0: -6.90, z1: 5.40 };
const WT = 0.34;                                 // 院墙厚

// ---------------------------------------------------------------- 动画句柄
// 所有会动的部件登记在这里，onFrame 统一驱动；幅度一律 2% 量级。
const A = {
  drop: null, beads: [], rings: [], clothes: [], hem: null, hens: [],
  vine: null, corn: [], strips: [], jars: [], paper: null
};

// ---------------------------------------------------------------- 小工具
// 贴地薄片（湿印、磨痕、落叶）：不写深度、不参与光照
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
// 贴在墙面 / 立面上的一层（雨痕、白灰补丁）
function face(w, h, color, x, y, z, op) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: op, depthWrite: false
  }));
  m.position.set(x, y, z);
  return m;
}
// 任意两点之间的一溜地面（土路、车辙、溅开的水痕）
function strip(x1, z1, x2, z2, w, color, y, op = 1) {
  const dx = x2 - x1, dz = z2 - z1;
  const L = Math.hypot(dx, dz);
  const geo = new THREE.PlaneGeometry(L, w);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color, transparent: op < 1, opacity: op, depthWrite: false
  }));
  m.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
  m.rotation.y = -Math.atan2(dz, dx);
  return m;
}
// 确定性抖动：不用 Math.random，也不让每片叶子一模一样
const jit = (i) => (Math.sin(i * 2.399) + 1) / 2;
// 纯色砖格：没有一粒噪点，但错缝还在
function brickMap(base, mortar, w, h) {
  const t = brickTex(base, mortar, 8, 5);
  t.repeat.set(Math.max(1, w / 1.05), Math.max(1, h / 1.05));
  return t;
}
// 两点之间的一根杆（车架、竹竿、藤）
function tube(x1, y1, x2, y2, r, color, z = 0) {
  const dx = x2 - x1, dy = y2 - y1;
  const L = Math.hypot(dx, dy);
  const m = cy(r, r, L, color, (x1 + x2) / 2, (y1 + y2) / 2, z, 7);
  m.rotation.z = Math.atan2(-dx, dy);
  return m;
}

// ============================================================================
// 院墙与院门
// ============================================================================
// 旧院墙：灰砖 + 一皮石基 + 一道压顶。这面墙和张家院那道是同一批砖，
// 唯独堂屋的瓦是新翻的 —— 新旧的反差靠"墙灰、瓦亮"这一组对比说清楚。
function wallSeg(len, h = 1.80) {
  const g = new THREE.Group();
  g.add(b(len, h, WT, M(C.white, { map: brickMap(C.sand, C.cream, len, h) }), 0, 0.16 + h / 2, 0));
  g.add(b(len + 0.08, 0.16, WT + 0.10, C.tile, 0, 0.08, 0));                 // 石基
  g.add(b(len + 0.10, 0.09, WT + 0.10, C.tile, 0, 0.16 + h + 0.045, 0));     // 压顶
  g.add(b(len + 0.02, 0.035, WT + 0.02, C.road, 0, 0.16 + h + 0.108, 0));    // 压顶上一皮薄砖
  g.add(decal(0.44, len, C.grass, -WT / 2 - 0.02, 0, 0.008, 0.16));          // 墙根苔
  return g;
}
// 南面矮墙：剖开的那一面，只留 0.58 米
function lowWall(len) {
  const g = new THREE.Group();
  g.add(b(len, 0.42, WT, M(C.white, { map: brickMap(C.sand, C.cream, len, 0.42) }), 0, 0.31, 0));
  g.add(b(len + 0.08, 0.10, WT + 0.10, C.tile, 0, 0.05, 0));
  g.add(b(len + 0.10, 0.07, WT + 0.10, C.tile, 0, 0.535, 0));
  g.add(b(len + 0.02, 0.025, WT + 0.02, C.road, 0, 0.578, 0));
  return g;
}
// 木栅栏小门：一根根竖板 + 两道横枨，半开着（通向争议地界那一侧）。
// 门与院墙同向：板子沿 z 排，铰在北侧门柱上，绕 y 往院里开 0.3 弧度。
function woodGate() {
  const g = new THREE.Group();
  const leaf = new THREE.Group();
  leaf.position.set(0.02, 0, -0.69);
  const N = 6, W = 1.34;
  for (let i = 0; i < N; i++) {
    const z = 0.09 + i * 0.235;
    const p = b(0.055, 1.02 + (i % 3) * 0.035, 0.115, C.wood, 0, 0.56, z);
    p.rotation.x = (i - 2) * 0.006;
    leaf.add(p);
    leaf.add(b(0.06, 0.03, 0.11, C.sand, 0, 1.02, z));                       // 板头
  }
  for (const y of [0.30, 0.86]) {
    leaf.add(b(0.045, 0.075, W - 0.02, C.wood, 0.02, y, W / 2));               // 横枨
    leaf.add(b(0.05, 0.018, W - 0.06, C.sand, 0.022, y + 0.03, W / 2));
  }
  leaf.add(cy(0.02, 0.02, 0.10, C.tile, -0.02, 0.72, 0.02, 6));                // 两道门轴
  leaf.add(cy(0.02, 0.02, 0.10, C.tile, -0.02, 0.24, 0.02, 6));
  leaf.rotation.y = 0.30;                                                      // 半开
  g.add(leaf);
  return g;
}
// 门柱 + 院门：西墙缺口 1.4 米
function gate() {
  const g = new THREE.Group();
  g.add(woodGate());
  for (const s of [-1, 1]) {
    g.add(b(0.46, 1.92, 0.44, M(C.white, { map: brickMap(C.sand, C.cream, 0.44, 1.92) }),
      -0.02, 0.96, s * 0.82));
    g.add(b(0.54, 0.10, 0.54, C.tile, -0.02, 0.05, s * 0.82));
    g.add(b(0.56, 0.08, 0.56, C.tile, -0.02, 1.96, s * 0.82));
    g.add(b(0.48, 0.03, 0.48, C.road, -0.02, 2.01, s * 0.82));
  }
  g.add(b(0.30, 0.14, 1.86, C.tile, -0.02, 1.90, 0));                          // 门楣
  return g;
}

// ============================================================================
// 堂屋（局部坐标：原点在屋心，+z 是朝院子的前脸）
// ============================================================================
// 单片坡：整面瓦 → 十六道瓦垄 → 八道瓦的横缝。
// 瓦色是全场最亮的一块：南坡用 brick 打底、peach 起垄（比张家那片瓦的 tile 亮两档），
// 垄背只在受光面提一档，绝不加白色亮线 —— 白线一多，新瓦就变成铁皮棚。
function roofSlope(dir) {
  const g = new THREE.Group();
  const south = dir > 0;
  const base = C.brick;                                                       // 两坡都是新翻的瓦，北坡只是没晒着
  const ridgeC = south ? C.peach : C.coral;
  const seam = south ? C.tile : C.tile;
  const shade = C.tile;
  const midY = RIDGE_Y - Math.sin(SLOPE) * (SLOPE_L / 2);
  const midZ = Math.cos(SLOPE) * (SLOPE_L / 2);
  const slab = b(6.90, 0.13, SLOPE_L + 0.05, base, 0, midY - 0.065, dir * midZ);
  slab.rotation.x = dir * SLOPE;
  g.add(slab);
  // 瓦垄与瓦缝一律不加描边：十六道垄的 EdgesGeometry 一起亮出来，
  // 整片屋顶会变成一张"梯子"，瓦的质感全没了 —— 这部分靠光和色阶说话。
  const NO_EDGE = { outline: false };
  for (let i = 0; i < 16; i++) {
    const x = -3.24 + i * 0.432;                                               // ★ 十六道瓦垄
    const rg = b(0.105, 0.058, SLOPE_L, ridgeC, x, midY + 0.029, dir * midZ, NO_EDGE);
    rg.rotation.x = dir * SLOPE;
    g.add(rg);
    if (south) {                                                               // 垄背受光的那一条
      const hl = b(0.016, 0.004, SLOPE_L - 0.16, C.cream, x - 0.026, midY + 0.059, dir * midZ, NO_EDGE);
      hl.rotation.x = dir * SLOPE;
      g.add(hl);
    }
    const sh = b(0.024, 0.05, SLOPE_L, shade, x + 0.065, midY + 0.02, dir * midZ, NO_EDGE);
    sh.rotation.x = dir * SLOPE;                                               // 垄侧的暗缝
    g.add(sh);
  }
  for (let i = 0; i < 8; i++) {                                                 // 八道瓦的横缝
    const s = (i + 0.55) * (SLOPE_L / 8);
    const sm = b(6.86, 0.006, 0.012, seam,
      0, RIDGE_Y - Math.sin(SLOPE) * s + 0.004, dir * Math.cos(SLOPE) * s, NO_EDGE);
    sm.rotation.x = dir * SLOPE;
    g.add(sm);
  }
  return g;
}
// ★★ 檐口：一条**平齐的瓦头**（0.07 厚）。
// 这里只有三样东西：瓦头、瓦头下一道暗线、十七道瓦缝。
// 没有一滴水线（不带下垂的尖舌）、没有雨槽、没有引水管 —— 这是全场要人看见的"没有"。
function eaveLip() {
  const g = new THREE.Group();
  const NO_EDGE = { outline: false };
  g.add(b(6.90, 0.07, 0.15, C.peach, 0, EAVE_TOP - 0.035, 2.230, NO_EDGE));   // 平齐瓦头
  g.add(b(6.90, 0.026, 0.12, C.tile, 0, EAVE_TOP - 0.085, 2.222, NO_EDGE));   // 瓦头下的暗线
  for (let i = 0; i <= 16; i++) {                                              // 十六块瓦口的分缝
    g.add(b(0.010, 0.072, 0.152, C.brick, -3.45 + i * 0.43125, EAVE_TOP - 0.034, 2.228, NO_EDGE));
  }
  return g;
}
function roof() {
  const g = new THREE.Group();
  g.add(roofSlope(1), roofSlope(-1));
  g.add(b(6.96, 0.10, 0.34, C.brick, 0, RIDGE_Y + 0.015, 0));                  // 脊
  g.add(b(6.98, 0.042, 0.20, C.peach, 0, RIDGE_Y + 0.083, 0));                 // 脊上一道压瓦
  g.add(b(7.00, 0.012, 0.10, C.cream, 0, RIDGE_Y + 0.107, 0, { outline: false }));
  for (let i = 0; i < 12; i++) {
    g.add(b(0.012, 0.105, 0.35, C.brick, -3.2 + i * 0.58, RIDGE_Y + 0.015, 0,
      { outline: false }));
  }
  g.add(eaveLip());
  // 山墙：檐墙以上那块三角，白灰刷白
  const gs = new THREE.Shape();
  gs.moveTo(-1.70, 2.54); gs.lineTo(1.70, 2.54); gs.lineTo(0, 3.63); gs.lineTo(-1.70, 2.54);
  const gg = new THREE.ExtrudeGeometry(gs, { depth: 0.12, bevelEnabled: false });
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(gg, M(C.cream));
    m.rotation.y = Math.PI / 2;
    m.position.x = s > 0 ? 3.02 : -3.14;
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    // 山墙上的一只小通风窗：不然两片山墙就是两块大白板
    g.add(b(0.03, 0.42, 0.42, C.wood, s * 3.135, 2.98, 0.02));
    g.add(b(0.04, 0.34, 0.34, C.dark, s * 3.150, 2.98, 0.02));
    g.add(b(0.045, 0.028, 0.34, C.wood, s * 3.152, 2.98, 0.02));
    g.add(b(0.045, 0.34, 0.028, C.wood, s * 3.152, 2.98, 0.02));
  }
  return g;
}
// 玻璃板门帘五片：五条半透的软片，挂在门洞里，被穿堂风带得轻轻错位
function stripCurtain(x) {
  const g = new THREE.Group();
  const rod = cy(0.014, 0.014, 0.70, C.road, x, 2.13, 1.73, 6);
  rod.rotation.x = Math.PI / 2;
  g.add(rod);
  for (let i = 0; i < 5; i++) {
    const px = x - 0.30 + i * 0.15;
    const hgt = 0.44 + (i % 3) * 0.045;
    const hang = new THREE.Group();
    hang.position.set(px, 2.12, 1.735);
    const pane = b(0.145, hgt, 0.012, i % 2 ? C.mint : C.glass, 0, -hgt / 2, 0);
    pane.material.transparent = true;
    pane.material.opacity = 0.62;
    pane.castShadow = false;
    hang.add(pane);
    hang.add(b(0.15, 0.02, 0.022, C.road, 0, -0.012, 0));                      // 夹条
    g.add(hang);
    A.strips.push(hang);
  }
  return g;
}
// 挂着的两串玉米（檐下的干粮，也是"新檐"下唯一旧的东西）
function cornString(x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.add(cy(0.012, 0.012, 0.16, C.sand, 0, 0.08, 0, 5));                        // 吊绳
  const cob = new THREE.Group();
  cob.position.y = -0.30;
  cob.add(cy(0.022, 0.022, 0.34, C.wood, 0, 0.17, 0, 5));                      // 玉米芯
  for (let i = 0; i < 6; i++) {
    const c = cy(0.048, 0.042, 0.10, i % 2 ? C.yellow : C.sand,
      Math.cos(i * 2.1) * 0.045, 0.05 - i * 0.055, Math.sin(i * 2.1) * 0.045, 7);
    c.rotation.z = Math.cos(i * 2.1) * 0.22;
    c.rotation.x = Math.sin(i * 2.1) * 0.22;
    cob.add(c);
  }
  cob.add(b(0.07, 0.06, 0.07, C.wood, 0, 0.34, 0));                            // 玉米把
  cob.add(b(0.08, 0.09, 0.09, C.sand, 0, -0.16, 0));                           // 剥下来的苞叶
  g.add(cob);
  A.corn.push(cob);
  return g;
}
function house() {
  const g = new THREE.Group();
  // ---- 墙身：新刷的白灰（这一家刚翻修过），墙裙一道新抹的水泥
  g.add(b(HW, HH, HD, C.white, 0, HH / 2, 0));
  g.add(b(HW + 0.06, 0.34, HD + 0.06, C.road, 0, 0.17, 0));
  g.add(b(HW + 0.10, 0.11, HD + 0.10, C.tile, 0, 0.055, 0));
  g.add(b(HW + 0.04, 0.045, HD + 0.04, C.cream, 0, HH - 0.02, 0));
  g.add(face(0.92, 0.62, C.cream, -2.52, 1.62, HD / 2 + 0.006, 0.55));         // 补灰一块
  g.add(face(0.52, 0.42, C.cream, 1.62, 0.88, HD / 2 + 0.006, 0.45));
  g.add(face(0.30, 0.26, C.sand, -3.00, 0.60, HD / 2 + 0.006, 0.35));          // 墙根蹭掉的一块

  // ---- 门：木门朝外半开，门洞里五片玻璃板门帘
  const DX = 1.90;                                                              // 门的局部 x（世界 +0.90）
  g.add(b(1.10, 2.06, 0.14, C.dark, DX, 1.16, 1.60));                           // 门洞里（前脸 1.67）
  for (const sx of [-1, 1]) {                                                   // 门框：两根立框
    g.add(b(0.11, 2.20, 0.10, C.wood, DX + sx * 0.585, 1.20, 1.70));
  }
  g.add(b(1.28, 0.11, 0.10, C.wood, DX, 2.27, 1.70));                           // 门楣
  g.add(b(1.16, 0.03, 0.11, C.sand, DX, 2.205, 1.705));
  const leaf = new THREE.Group();
  leaf.position.set(DX - 0.52, 0, 1.755);
  leaf.rotation.y = -1.02;                                                      // 往外开（院里）
  const panel = b(1.02, 2.02, 0.055, C.wood, 0.51, 1.15, 0);
  leaf.add(panel);
  leaf.add(b(0.74, 0.60, 0.02, C.sand, 0.51, 1.66, 0.036));                     // 上凹板
  leaf.add(b(0.74, 0.50, 0.02, C.sand, 0.51, 0.74, 0.036));                     // 下凹板
  leaf.add(b(0.66, 0.52, 0.012, C.wood, 0.51, 1.66, 0.047));
  leaf.add(b(0.66, 0.42, 0.012, C.wood, 0.51, 0.74, 0.047));
  // 四边立档 + 中冒头：门是"拼"出来的，不是一块板
  leaf.add(b(0.075, 2.02, 0.062, C.sand, 0.055, 1.15, 0.002));
  leaf.add(b(0.075, 2.02, 0.062, C.sand, 0.965, 1.15, 0.002));
  leaf.add(b(1.02, 0.075, 0.062, C.sand, 0.51, 2.16, 0.002));
  leaf.add(b(1.02, 0.075, 0.062, C.sand, 0.51, 0.14, 0.002));
  leaf.add(b(0.86, 0.05, 0.058, C.sand, 0.51, 1.22, 0.002));                    // 中冒头
  leaf.add(b(0.86, 0.012, 0.058, C.tile, 0.51, 1.19, 0.004));                   // 门缝下的暗线
  leaf.add(cy(0.026, 0.026, 0.035, C.yellow, 0.90, 1.12, 0.058, 10));           // 锁扣
  leaf.add(b(0.10, 0.035, 0.035, C.yellow, 0.86, 1.12, 0.052));
  g.add(leaf);
  g.add(stripCurtain(DX));
  g.add(b(1.30, 0.09, 0.24, C.tile, DX, 0.095, 1.74));                          // 门槛石
  g.add(b(2.05, 0.12, 0.46, C.tile, DX, 0.06, 1.94));                           // 门口石阶
  g.add(b(2.05, 0.02, 0.08, C.road, DX, 0.128, 2.15));                          // 阶沿压线

  // ---- 窗：一扇木格窗，玻璃后面是屋里的暗
  const WX = -2.00, WY = 1.82;                                                  // 世界 -3.00
  g.add(b(0.94, 0.82, 0.08, C.dark, WX, WY, 1.655));                            // 窗洞
  for (const sx of [-1, 1]) {
    g.add(b(0.10, 0.98, 0.10, C.wood, WX + sx * 0.48, WY, 1.70));               // 立框
  }
  g.add(b(1.06, 0.09, 0.10, C.wood, WX, WY + 0.445, 1.70));                     // 上框
  g.add(b(1.06, 0.09, 0.10, C.wood, WX, WY - 0.445, 1.70));                     // 下框
  const pane = b(0.90, 0.78, 0.014, C.glass, WX, WY, 1.716);
  pane.material.transparent = true;
  pane.material.opacity = 0.42;
  pane.castShadow = false;
  g.add(pane);
  g.add(b(0.028, 0.78, 0.026, C.wood, WX, WY, 1.726));                          // 竖棂
  g.add(b(0.90, 0.028, 0.026, C.wood, WX, WY, 1.726));                          // 横棂
  g.add(b(1.22, 0.06, 0.22, C.cream, WX, 1.31, 1.75));                          // 窗台
  g.add(b(1.22, 0.025, 0.24, C.sand, WX, 1.283, 1.76));
  // 窗台上一盆吊兰（屋里人的日子，不悲情）
  g.add(cy(0.09, 0.07, 0.13, C.brick, WX - 0.34, 1.38, 1.78, 10));
  g.add(cy(0.095, 0.095, 0.018, C.sand, WX - 0.34, 1.452, 1.78, 10));
  for (let i = 0; i < 5; i++) {
    const a = i * 1.25;
    const lf = ball(0.055, i % 2 ? C.mint : C.grass,
      WX - 0.34 + Math.cos(a) * 0.07, 1.49 + (i % 2) * 0.03, 1.78 + Math.sin(a) * 0.05, 7);
    lf.scale.set(1.5, 0.45, 1);
    g.add(lf);
  }

  // ---- 檐下的两串玉米
  g.add(cornString(-2.55, 2.46, 2.02));
  g.add(cornString(2.58, 2.46, 2.02));

  // ---- 檐口下墙面上的雨痕（水从这条平瓦口甩下来，墙上留一道白印）
  g.add(face(0.34, 1.86, C.tile, DRIP_X - HX, 1.28, HD / 2 + 0.008, 0.10));
  g.add(face(0.16, 0.50, C.tile, DRIP_X - HX + 0.02, 0.30, HD / 2 + 0.009, 0.12));
  g.add(face(0.50, 0.10, C.tile, DRIP_X - HX, 0.10, HD / 2 + 0.009, 0.10));     // 墙根溅上来的一圈

  g.add(roof());
  return g;
}

// ============================================================================
// 堂屋桌（视觉中心）：一张单据、一摞低保材料、一只搪瓷缸
// ============================================================================
// ★ 缴费通知单：背面朝上（铅笔算过账的那一面），四个角都起了翘。
//   这是全场"她反复摸过这张纸"的唯一物证 —— 不看字，看纸的形。
function paper() {
  const g = new THREE.Group();
  g.add(b(0.42, 0.0045, 0.30, C.cream, 0, 0, 0));
  // 七道铅笔横线（纸背那一面算账的横格）
  for (let i = 0; i < 7; i++) {
    g.add(b(0.345 - (i % 3) * 0.04, 0.0016, 0.006, C.road, -0.012, 0.0028, -0.118 + i * 0.038));
  }
  // 右端几笔竖式：铅笔在算的短划
  for (let i = 0; i < 4; i++) {
    g.add(b(0.028, 0.0016, 0.012, C.road, 0.135, 0.0028, -0.10 + i * 0.055));
    g.add(b(0.052, 0.0016, 0.008, C.road, 0.10, 0.0028, -0.085 + i * 0.055));
  }
  g.add(b(0.18, 0.0016, 0.005, C.ink, 0.02, 0.0029, 0.128));                    // 中性笔划的一道
  // 四个角起翘：一角掀得最高，对角只是翻边
  const corners = [
    { x: -0.185, z: 0.125, rx: -0.42, rz: 0.16, w: 0.10, d: 0.085 },
    { x: 0.185, z: 0.128, rx: -0.20, rz: -0.26, w: 0.085, d: 0.07 },
    { x: 0.186, z: -0.125, rx: 0.30, rz: -0.14, w: 0.09, d: 0.075 },
    { x: -0.187, z: -0.126, rx: 0.16, rz: 0.22, w: 0.075, d: 0.06 }
  ];
  for (let i = 0; i < corners.length; i++) {
    const c = corners[i];
    const flap = b(c.w, 0.0035, c.d, C.cream, c.x, 0.009, c.z);
    flap.rotation.x = c.rx;
    flap.rotation.z = c.rz;
    g.add(flap);
    if (i === 0) { A.paper = flap; }                                            // 风一吹会动的那一角
    const edge = b(c.w * 0.9, 0.002, 0.008, C.sand,
      c.x, 0.0125 + Math.abs(c.rx) * 0.02, c.z + Math.sign(c.z) * c.d * 0.4);
    edge.rotation.x = c.rx;
    g.add(edge);
  }
  return g;
}
// 一摞低保申请材料：八张，夹着一张病故证明（露出半行标题与一个方章）
function benefits() {
  const g = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const s = b(0.34, 0.004, 0.26, i % 3 === 1 ? C.cream : C.white,
      (jit(i) - 0.5) * 0.012, 0.0025 + i * 0.0042, (jit(i + 5) - 0.5) * 0.012);
    s.rotation.y = (jit(i + 9) - 0.5) * 0.05;
    g.add(s);
  }
  // 病故证明：从第三张底下露出一个边
  const cert = b(0.30, 0.004, 0.235, C.white, 0.012, 0.0128, -0.012);
  cert.rotation.y = -0.06;
  g.add(cert);
  g.add(b(0.16, 0.0022, 0.014, C.ink, 0.012, 0.0158, -0.012));                  // 标题那一行
  g.add(b(0.22, 0.0022, 0.006, C.road, 0.012, 0.0158, 0.016));
  g.add(b(0.10, 0.0022, 0.006, C.road, 0.012, 0.0158, 0.034));
  g.add(b(0.055, 0.0022, 0.035, C.coral, 0.088, 0.0157, 0.075));                // 一个方章
  g.add(b(0.30, 0.003, 0.006, C.sand, 0.012, 0.011, 0.10));                     // 露出来的折边
  return g;
}
function mug() {
  const g = new THREE.Group();
  g.add(cy(0.088, 0.078, 0.155, C.white, 0, 0.078, 0, 16));                     // 搪瓷缸
  g.add(cy(0.09, 0.09, 0.014, C.navy, 0, 0.157, 0, 16));                        // 缸口一圈蓝
  g.add(cy(0.088, 0.088, 0.03, C.navy, 0, 0.11, 0, 16));                        // 蓝箍
  g.add(b(0.02, 0.04, 0.024, C.dark, 0.086, 0.09, 0));                          // 磕掉一块瓷
  g.add(b(0.028, 0.07, 0.018, C.wood, -0.09, 0.085, 0));                        // 木把
  return g;
}
function bowl() {
  const g = new THREE.Group();
  g.add(cy(0.115, 0.072, 0.085, C.white, 0, 0.043, 0, 18));                     // 碗身
  g.add(cy(0.118, 0.118, 0.012, C.cream, 0, 0.086, 0, 18));                     // 碗口
  g.add(cy(0.10, 0.10, 0.006, C.tile, 0, 0.081, 0, 18));                        // 碗里
  g.add(b(0.045, 0.03, 0.03, C.cream, 0.105, 0.088, 0.02));                     // 豁口
  const n = b(0.03, 0.026, 0.024, C.tile, 0.112, 0.086, 0.026);
  n.rotation.z = 0.3;
  g.add(n);
  return g;
}
function soapBag() {
  const g = new THREE.Group();
  const bag = b(0.20, 0.24, 0.10, C.white, 0, 0.12, 0);
  bag.rotation.z = 0.06;
  g.add(bag);
  g.add(b(0.205, 0.06, 0.105, C.blue, -0.004, 0.10, 0));                        // 蓝标一条
  g.add(b(0.18, 0.045, 0.09, C.cream, 0.004, 0.245, 0.002));                    // 折下来的袋口
  g.add(b(0.09, 0.03, 0.012, C.blue, -0.04, 0.19, 0.055));                      // 洗衣粉的字块
  g.add(b(0.06, 0.02, 0.012, C.road, 0.05, 0.155, 0.055));
  return g;
}
function diningTable() {
  const g = new THREE.Group();
  // ---- 桌：1.35 × 0.95，桌面 0.76
  g.add(b(1.35, 0.07, 0.95, C.wood, 0, 0.725, 0));
  g.add(b(1.41, 0.035, 1.01, C.wood, 0, 0.688, 0));                             // 台沿
  g.add(b(1.16, 0.10, 0.76, C.sand, 0, 0.625, 0));                              // 牙板
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(b(0.085, 0.60, 0.085, C.wood, sx * 0.60, 0.30, sz * 0.40));
    g.add(b(0.10, 0.025, 0.10, C.tile, sx * 0.60, 0.012, sz * 0.40));
  }
  g.add(b(1.12, 0.055, 0.055, C.wood, 0, 0.16, 0.40));                          // 横撑
  g.add(b(1.12, 0.055, 0.055, C.wood, 0, 0.16, -0.40));
  g.add(b(0.006, 0.004, 0.94, C.sand, -0.20, 0.762, 0));                        // 桌面拼缝两道
  g.add(b(0.006, 0.004, 0.94, C.sand, 0.24, 0.762, 0));
  // ---- 桌面陈设（台面 0.760）
  const TY = 0.7615;
  const p = paper();
  p.position.set(-0.30, TY, 0.02);
  p.rotation.y = 0.16;                                                          // 斜着放，被反复摸过
  g.add(p);
  const bs = benefits();
  bs.position.set(0.31, TY, -0.20);
  bs.rotation.y = -0.10;
  g.add(bs);
  const m = mug();                                                              // 搪瓷缸压在单据的角上
  m.position.set(-0.455, TY, -0.055);
  g.add(m);
  // 一支铅笔，停在算到一半那一行
  const pencil = new THREE.Group();
  pencil.position.set(-0.03, TY + 0.011, 0.29);
  pencil.rotation.y = -0.24;
  const pb = cy(0.011, 0.011, 0.16, C.yellow, 0, 0, 0, 6);
  pb.rotation.z = Math.PI / 2;
  pencil.add(pb);
  const pt = cy(0.011, 0.003, 0.026, C.tile, -0.093, 0, 0, 6);
  pt.rotation.z = Math.PI / 2;
  pencil.add(pt);
  const pe = cy(0.011, 0.011, 0.016, C.peach, 0.088, 0, 0, 6);
  pe.rotation.z = Math.PI / 2;
  pencil.add(pe);
  g.add(pencil);
  const bw = bowl();
  bw.position.set(0.44, TY, 0.24);
  g.add(bw);
  const sb = soapBag();
  sb.position.set(-0.52, TY, 0.30);
  sb.rotation.y = 0.42;
  g.add(sb);
  // 桌下的竹篮（装着择下来的豆角，说明桌上那盘菜从哪来）
  const under = new THREE.Group();
  under.position.set(0.10, 0.02, 0.06);
  under.add(cy(0.17, 0.14, 0.16, C.wood, 0, 0.08, 0, 12));
  under.add(cy(0.175, 0.175, 0.02, C.sand, 0, 0.155, 0, 12));
  for (let i = 0; i < 5; i++) {
    const bean = cy(0.008, 0.008, 0.20, C.grass, -0.06 + i * 0.03, 0.17, (i % 2) * 0.04, 5);
    bean.rotation.z = 1.2;
    under.add(bean);
  }
  g.add(under);
  return g;
}

// ============================================================================
// 檐下的滴水坑 + 三滴水珠（次中心 / 物证）
// ============================================================================
function dripHole() {
  const g = new THREE.Group();
  // 0.6 米直径的湿圈：中心更深，往外散成湿边的浅色
  g.add(flat(0.66, 0.60, C.tile, 0, 0.010, 0, 0.34));
  g.add(flat(0.50, 0.46, C.dark, 0, 0.012, 0, 0.30));
  g.add(flat(0.30, 0.28, C.dark, 0, 0.014, 0, 0.55));                           // 坑底暗
  // 坑沿：湿土被水顶起来的一圈，0.16 米深靠"暗 + 沿"做出来
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.018, 6, 22), M(C.soil));
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.020;
  rim.castShadow = true;
  g.add(rim);
  for (let i = 0; i < 7; i++) {
    const a = i * 0.897;
    const clod = ball(0.036 + (i % 3) * 0.012, i % 2 ? C.soil : C.tile,
      Math.cos(a) * 0.34, 0.02, Math.sin(a) * 0.31, 6);
    clod.scale.set(1.3, 0.62, 1);
    g.add(clod);
  }
  // 溅开的水痕：六道朝外甩的细线
  for (let i = 0; i < 6; i++) {
    const a = -0.5 + i * 0.62;
    const r0 = 0.30, r1 = 0.44 + (i % 3) * 0.05;
    g.add(strip(Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * r1, Math.sin(a) * r1,
      0.010 + (i % 2) * 0.005, C.tile, 0.011, 0.24));
  }
  g.add(flat(0.20, 0.14, C.blue, -0.06, 0.0135, 0.04, 0.12));                   // 坑里剩的一线水光
  // 三圈涟漪（onFrame 里 0.8 秒扩散一圈）
  for (let i = 0; i < 3; i++) {
    const geo = new THREE.RingGeometry(0.42, 0.5, 26);
    geo.rotateX(-Math.PI / 2);
    const r = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: C.white, transparent: true, opacity: 0, depthWrite: false
    }));
    r.position.y = 0.028;
    r.visible = false;
    g.add(r);
    A.rings.push(r);
  }
  return g;
}
// 三滴水珠：两滴挂在瓦头下（水在聚集），一滴落下去（每三秒一次）
function drips() {
  const g = new THREE.Group();
  const bead = (y, r) => {
    const m = ball(r, C.glass, 0, y, 0, 8);
    m.scale.set(1, 1.35, 1);
    m.material.transparent = true;
    m.material.opacity = 0.88;
    m.castShadow = false;
    m.userData.y = y;
    g.add(m);
    return m;
  };
  A.beads.push(bead(EAVE_UNDER - 0.11, 0.030), bead(EAVE_UNDER - 0.23, 0.024));
  A.drop = bead(EAVE_UNDER - 0.02, 0.040);
  return g;
}

// ============================================================================
// 院子里的家什
// ============================================================================
// 蜂窝煤：三层，每块掏四个孔（西北那堆，李家唯一显旧的东西之一）
function coalStack() {
  const g = new THREE.Group();
  const spots = [
    [[-0.17, 0], [0.17, 0], [0, 0.28]],
    [[-0.08, 0.13], [0.10, 0.13]],
    [[0, 0.24]]
  ];
  for (let r = 0; r < 3; r++) {
    for (const [cx, cz] of spots[r]) {
      g.add(cy(0.155, 0.155, 0.11, C.ink, cx, 0.055 + r * 0.112, cz, 14));
      g.add(cy(0.152, 0.152, 0.014, C.dark, cx, 0.11 + r * 0.112, cz, 14));    // 上一块的底
      for (let k = 0; k < 4; k++) {                                             // 四个煤孔
        const a = (k / 4) * Math.PI * 2 + 0.7;
        g.add(cy(0.026, 0.026, 0.116, C.dark,
          cx + Math.cos(a) * 0.085, 0.055 + r * 0.112, cz + Math.sin(a) * 0.085, 6));
      }
    }
  }
  g.add(decal(0.9, 0.8, C.dark, 0, 0, 0.008, 0.10));                            // 煤堆底下的黑
  for (let i = 0; i < 5; i++) {                                                 // 掉下来的煤渣
    g.add(ball(0.022 + (i % 3) * 0.01, C.ink, -0.42 + i * 0.2, 0.012, 0.42 + (i % 2) * 0.1, 6));
  }
  return g;
}
// 旧自行车：车架擦得发亮，车筐里塞着一只买菜袋（唯一"贵重"的家当）
function bike() {
  const g = new THREE.Group();
  const R = 0.29, RY = R + 0.035;
  // ---- 两只轮子：胎 + 圈 + 十根辐条 + 花鼓
  for (const sx of [-0.52, 0.52]) {
    const tire = new THREE.Mesh(new THREE.TorusGeometry(R, 0.032, 7, 24), M(C.ink));
    tire.position.set(sx, RY, 0);
    tire.castShadow = true;
    g.add(tire);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R - 0.045, 0.011, 5, 24), M(C.blue));
    rim.position.set(sx, RY, 0);
    g.add(rim);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const sp = cy(0.0045, 0.0045, R - 0.06, C.blue,
        sx + Math.cos(a) * (R - 0.06) / 2, RY + Math.sin(a) * (R - 0.06) / 2, 0, 4);
      sp.rotation.z = a - Math.PI / 2;
      g.add(sp);
    }
    const hub = cy(0.032, 0.032, 0.075, C.road, sx, RY, 0, 8);
    hub.rotation.x = Math.PI / 2;
    g.add(hub);
    // 挡泥板：一段圆弧
    const fender = new THREE.Mesh(
      new THREE.TorusGeometry(R + 0.035, 0.014, 4, 10, Math.PI * 0.75), M(C.road));
    fender.position.set(sx, RY, 0);
    fender.rotation.z = Math.PI * 0.62;
    fender.castShadow = true;
    g.add(fender);
  }
  // ---- 车架：下管 / 上管 / 立管 / 前叉 / 后叉
  g.add(tube(-0.52, RY, -0.06, 0.42, 0.021, C.navy));                           // 后下叉
  g.add(tube(-0.52, RY, -0.10, 0.78, 0.019, C.navy));                           // 后上叉
  g.add(tube(-0.06, 0.42, 0.30, 0.72, 0.024, C.navy));                          // 下管
  g.add(tube(-0.10, 0.80, 0.28, 0.76, 0.021, C.navy));                          // 上管
  g.add(tube(-0.06, 0.42, -0.10, 0.80, 0.022, C.navy));                         // 立管
  g.add(tube(0.52, RY, 0.30, 0.80, 0.019, C.blue));                             // 前叉
  g.add(tube(0.34, 0.86, 0.30, 1.00, 0.018, C.blue));                           // 车把立管
  // ---- 车把 + 把套 + 铃
  const bar = cy(0.014, 0.014, 0.44, C.blue, 0.32, 1.02, 0, 6);
  bar.rotation.x = Math.PI / 2;
  g.add(bar);
  g.add(b(0.10, 0.03, 0.03, C.ink, 0.32, 1.02, 0.235));
  g.add(b(0.10, 0.03, 0.03, C.ink, 0.32, 1.02, -0.235));
  g.add(cy(0.045, 0.045, 0.05, C.blue, 0.32, 1.05, 0.13, 10));                  // 车铃
  g.add(cy(0.05, 0.05, 0.012, C.road, 0.32, 1.075, 0.13, 10));
  // ---- 座垫 + 弹簧
  g.add(b(0.26, 0.05, 0.15, C.ink, -0.13, 0.88, 0));
  g.add(b(0.20, 0.03, 0.11, C.road, -0.13, 0.915, 0));
  g.add(cy(0.012, 0.012, 0.09, C.road, -0.13, 0.84, 0, 5));
  // ---- 后货架
  g.add(b(0.34, 0.025, 0.24, C.road, -0.42, 0.86, 0));
  g.add(tube(-0.52, RY + 0.02, -0.42, 0.85, 0.012, C.road));
  g.add(tube(-0.30, RY + 0.02, -0.42, 0.85, 0.012, C.road));
  // ---- 车筐 + 买菜袋
  g.add(b(0.30, 0.20, 0.26, C.wood, 0.40, 0.94, 0));
  for (let i = 0; i < 3; i++) {
    g.add(b(0.31, 0.012, 0.27, C.sand, 0.40, 0.86 + i * 0.065, 0));
  }
  const bag = b(0.22, 0.09, 0.19, C.white, 0.40, 1.07, 0.01);
  bag.rotation.z = 0.05;
  g.add(bag);
  g.add(b(0.10, 0.05, 0.03, C.mint, 0.36, 1.09, 0.10));                         // 袋口露一把青菜
  // ---- 链罩 + 脚撑 + 旧锁
  g.add(b(0.30, 0.03, 0.05, C.road, -0.14, 0.40, 0.05));
  g.add(tube(-0.16, 0.36, -0.34, 0.02, 0.012, C.road, -0.08));                  // 脚撑
  g.add(cy(0.02, 0.02, 0.16, C.dark, 0.30, 0.62, 0.04, 6));                     // 挂在车上的锁
  return g;
}
// 鸡：身体一组（会小幅起伏）、头一组（单独点头）
function chicken(tone, comb) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  const bd = ball(0.195, tone, 0, 0.30, 0, 14);
  bd.scale.set(1.02, 0.92, 1.34);
  body.add(bd);
  for (const s of [-1, 1]) {
    const wg = ball(0.105, tone, s * 0.165, 0.33, 0.02, 10);
    wg.scale.set(0.42, 0.78, 1.12);
    body.add(wg);
  }
  const tail = b(0.15, 0.22, 0.055, tone, 0, 0.44, -0.235);
  tail.rotation.x = 0.62;
  body.add(tail);
  for (let i = 0; i < 3; i++) {
    const f = b(0.035, 0.16, 0.03, i % 2 ? tone : C.cream, -0.05 + i * 0.05, 0.53, -0.30);
    f.rotation.x = 0.75 + i * 0.06;
    body.add(f);
  }
  for (const s of [-1, 1]) {
    body.add(cy(0.013, 0.013, 0.20, C.yellow, s * 0.062, 0.10, 0.02, 6));
    body.add(b(0.05, 0.012, 0.075, C.yellow, s * 0.062, 0.006, 0.055));
  }
  g.add(body);
  const head = new THREE.Group();
  head.position.set(0, 0.46, 0.155);
  head.add(ball(0.09, tone, 0, 0, 0, 12));
  head.add(b(0.05, 0.03, 0.095, C.yellow, 0, -0.012, 0.105));                   // 喙
  head.add(b(0.042, 0.07, 0.05, comb, 0, 0.082, 0.012));                        // 冠
  head.add(b(0.06, 0.038, 0.05, comb, 0, 0.10, -0.03));
  head.add(b(0.028, 0.045, 0.028, comb, 0, -0.055, 0.075));                     // 肉垂
  for (const s of [-1, 1]) {
    head.add(ball(0.014, C.ink, s * 0.048, 0.022, 0.055, 6));
  }
  g.add(head);
  return { g, body, head };
}
// 鸡窝：砖砌小窝 + 一坡石棉瓦 + 栖架（东北角）
function coop() {
  const g = new THREE.Group();
  g.add(b(1.18, 0.64, 0.92, M(C.white, { map: brickMap(C.brick, C.tile, 1.18, 0.64) }), 0, 0.32, 0));
  g.add(b(1.26, 0.07, 1.00, C.tile, 0, 0.675, 0));                              // 压顶
  // 窝顶：一坡小瓦（五道瓦垄 + 两道瓦缝），和堂屋的新瓦同一个色系但压两档
  const r1 = b(1.42, 0.045, 1.08, C.brick, 0.02, 0.775, 0.04, { outline: false });
  r1.rotation.x = 0.17;
  g.add(r1);
  for (let i = 0; i < 5; i++) {
    const rib = b(0.055, 0.028, 1.08, C.peach, -0.52 + i * 0.27, 0.802, 0.04,
      { outline: false });
    rib.rotation.x = 0.17;
    g.add(rib);
  }
  for (const z of [-0.24, 0.16, 0.44]) {
    const seam = b(1.42, 0.006, 0.010, C.tile, 0.02, 0.795 - z * 0.17, z + 0.04,
      { outline: false });
    seam.rotation.x = 0.17;
    g.add(seam);
  }
  g.add(b(1.46, 0.028, 0.075, C.brick, 0.02, 0.812, -0.50, { outline: false })); // 屋脊一道
  g.add(b(0.34, 0.34, 0.12, C.dark, 0.20, 0.34, 0.47));                         // 窝门
  g.add(b(0.28, 0.30, 0.02, C.dark, 0.20, 0.34, 0.535));
  g.add(b(0.36, 0.045, 0.14, C.wood, 0.20, 0.18, 0.50));                        // 门槛
  const perch = cy(0.026, 0.026, 1.06, C.wood, 0.02, 0.40, 0.60, 6);
  perch.rotation.z = Math.PI / 2;
  g.add(perch);
  g.add(b(0.05, 0.32, 0.05, C.wood, -0.42, 0.16, 0.60));
  g.add(b(0.05, 0.32, 0.05, C.wood, 0.46, 0.16, 0.60));
  // 窝门口的一堆稻草 + 两枚蛋
  for (let i = 0; i < 5; i++) {
    const st = b(0.10, 0.012, 0.02, C.sand, -0.30 + i * 0.15, 0.012, 0.64 + (i % 2) * 0.06);
    st.rotation.y = i * 0.7;
    g.add(st);
  }
  g.add(ball(0.032, C.cream, 0.20, 0.028, 0.56, 8)).scale.set(1, 1.2, 1);
  g.add(ball(0.030, C.cream, 0.40, 0.028, 0.52, 8)).scale.set(1, 1.2, 1);
  return g;
}
// 鸡食盆：一只缺角瓦盆，底上一层玉米碴
function feedPan() {
  const g = new THREE.Group();
  g.add(cy(0.19, 0.15, 0.09, C.tile, 0, 0.045, 0, 14));
  g.add(cy(0.18, 0.18, 0.012, C.sand, 0, 0.075, 0, 14));
  for (let i = 0; i < 14; i++) {
    const a = i * 2.4;
    g.add(ball(0.011, C.yellow, Math.cos(a) * 0.11 * jit(i + 3), 0.082,
      Math.sin(a) * 0.11 * jit(i + 7), 5));
  }
  g.add(b(0.10, 0.05, 0.06, C.dark, 0.17, 0.03, 0.02));                         // 磕破的一角
  return g;
}
// 晾衣绳：两根竹竿撑起，两件小孩衣服（最下面一件还在滴水）
function laundry(len) {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    g.add(cy(0.042, 0.055, 2.10, C.wood, s * len / 2, 1.05, 0, 8));             // 竹竿
    for (const y of [0.52, 1.22, 1.86]) {
      g.add(cy(0.05, 0.05, 0.035, C.sand, s * len / 2, y, 0, 8));               // 竹节
    }
    g.add(cy(0.12, 0.145, 0.08, C.tile, s * len / 2, 0.04, 0, 8));              // 竿脚
    g.add(cy(0.09, 0.09, 0.02, C.soil, s * len / 2, 0.008, 0, 8));
  }
  const rope = cy(0.008, 0.008, len, C.sand, 0, 1.95, 0, 5);
  rope.rotation.z = Math.PI / 2;
  g.add(rope);
  // 两件小孩衣服：一件小褂、一条小裤
  const cloths = [
    { x: -len / 2 + 1.05, w: 0.44, h: 0.40, c: C.blue, kind: "shirt" },
    { x: -len / 2 + 2.55, w: 0.34, h: 0.48, c: C.peach, kind: "pants" }
  ];
  for (let i = 0; i < cloths.length; i++) {
    const d = cloths[i];
    const hang = new THREE.Group();
    hang.position.set(d.x, 1.95, 0.012);
    hang.add(b(d.w, d.h, 0.02, d.c, 0, -d.h / 2 - 0.015, 0));
    if (d.kind === "shirt") {
      hang.add(b(0.13, 0.18, 0.018, d.c, -d.w / 2 - 0.04, -0.14, 0));           // 袖子
      hang.add(b(0.13, 0.18, 0.018, d.c, d.w / 2 + 0.04, -0.14, 0));
      hang.add(b(0.15, 0.045, 0.022, C.white, 0, -0.05, 0.003));                // 领口
      hang.add(b(d.w - 0.08, 0.018, 0.022, C.white, 0, -d.h + 0.02, 0.003));    // 下摆
      hang.add(b(0.014, d.h - 0.09, 0.022, C.glass, 0.09, -d.h / 2 - 0.01, 0.003)); // 一道褶
      hang.add(b(0.05, 0.05, 0.02, C.mint, -0.09, -0.24, 0.004));                // 补丁
    } else {
      hang.add(b(0.14, 0.16, 0.018, d.c, -0.085, -d.h - 0.05, 0));              // 两条裤腿
      hang.add(b(0.14, 0.16, 0.018, d.c, 0.085, -d.h - 0.05, 0));
      hang.add(b(d.w, 0.035, 0.024, C.white, 0, -0.02, 0.003));                 // 腰
      hang.add(b(0.014, d.h - 0.14, 0.022, C.glass, -0.06, -d.h / 2, 0.003));   // 裤线
      hang.add(b(0.045, 0.05, 0.02, C.mint, 0.06, -0.20, 0.004));
    }
    for (const sx of [-1, 1]) {
      hang.add(b(0.032, 0.085, 0.032, C.wood, sx * (d.w / 2 - 0.015), 0, 0.028)); // 两只衣夹
    }
    g.add(hang);
    A.clothes.push({ g: hang, ph: i * 1.7 });
  }
  // 最下面那件（小裤）的裤脚在滴水
  const hem = ball(0.026, C.glass, -len / 2 + 2.55, 1.86, 0.02, 8);
  hem.material.transparent = true;
  hem.material.opacity = 0.9;
  hem.castShadow = false;
  hem.visible = false;
  g.add(hem);
  A.hem = hem;
  g.add(decal(0.6, 0.5, C.dark, -len / 2 + 2.55, 0.02, 0.008, 0.16));           // 脚下那片湿
  return g;
}
// 白菜（每颗带外叶）
function cabbage(seed) {
  const g = new THREE.Group();
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.4 + seed * 0.3;
    const leaf = ball(0.15 + (k % 2) * 0.018, C.grass,
      Math.cos(a) * 0.17, 0.09 + (k % 2) * 0.02, Math.sin(a) * 0.17, 8);
    leaf.scale.set(1.28, 0.36, 1.28);
    g.add(leaf);
  }
  const head = ball(0.15, C.mint, 0, 0.19, 0, 10);
  head.scale.y = 0.98;
  g.add(head);
  g.add(ball(0.068, C.mint, 0.01, 0.29, 0.01, 8));
  g.add(cy(0.10, 0.13, 0.07, C.grass, 0, 0.035, 0, 8));
  return g;
}
// 菜地：三垄白菜 + 一头豆角架（东墙根，李家院子最鲜的一块颜色）
function vegPlot() {
  const g = new THREE.Group();
  for (let r = 0; r < 3; r++) {
    const x = -0.72 + r * 0.72;
    g.add(b(0.54, 0.14, 4.30, C.soil, x, 0.07, 0));                             // 垄身
    g.add(b(0.52, 0.02, 4.24, C.soil, x, 0.15, 0));                             // 垄顶干一层
    if (r < 2) {
      g.add(b(0.18, 0.02, 4.30, C.tile, x + 0.36, 0.03, 0));                    // 垄沟
      g.add(b(0.16, 0.012, 4.20, C.tile, x + 0.36, 0.036, 0));
    }
  }
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const i = r * 3 + c;
      const cab = cabbage(i);
      cab.position.set(-0.72 + r * 0.72 + (jit(i) - 0.5) * 0.05, 0.14,
        -1.42 + c * 1.38 + (jit(i + 9) - 0.5) * 0.1);
      cab.rotation.y = i * 0.9;
      g.add(cab);
    }
  }
  for (let i = 0; i < 6; i++) {                                                 // 地头的土块
    g.add(b(0.09 + (i % 3) * 0.03, 0.04, 0.07, i % 2 ? C.tile : C.soil,
      -1.05 + (i % 3) * 0.9, 0.02, 2.05 + (i % 2) * 0.16));
  }
  // 豆角架：人字架 + 架上的一根藤（onFrame 里轻轻晃）
  const frame = new THREE.Group();
  frame.position.set(0.04, 0, 1.92);
  for (const s of [-1, 1]) {
    frame.add(tube(0, 0.02, s * 0.34, 1.62, 0.022, C.wood));
    frame.add(cy(0.026, 0.026, 0.05, C.sand, s * 0.05, 1.06, 0, 6));
  }
  frame.add(tube(-0.30, 1.28, 0.30, 1.28, 0.018, C.wood));
  frame.add(tube(-0.26, 0.62, 0.26, 0.62, 0.016, C.wood));
  const vine = new THREE.Group();
  vine.position.set(-0.16, 0.62, 0.02);
  for (let i = 0; i < 7; i++) {
    const y = 0.08 + i * 0.15;
    const x = Math.sin(i * 1.3) * 0.05;
    vine.add(cy(0.009, 0.009, 0.16, C.grass, x, y, 0, 5));
    const lf = ball(0.05, i % 2 ? C.mint : C.grass, x + 0.06, y + 0.04, 0.02, 7);
    lf.scale.set(1.5, 0.4, 1);
    vine.add(lf);
  }
  frame.add(vine);
  A.vine = vine;
  g.add(frame);
  return g;
}
// 菜筐：柳条编的圆筐，择了一半的豆角堆到筐沿上，旁边散着三根择下来的
function basket() {
  const g = new THREE.Group();
  const RIM = 0.245, H = 0.235;
  // 筐身：下窄上宽的锥台 + 一圈厚筐沿
  g.add(cy(RIM - 0.012, 0.175, H, C.wood, 0, H / 2, 0, 20));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(RIM, 0.020, 6, 22), M(C.sand));
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = H;
  rim.castShadow = true;
  g.add(rim);
  // 竖条：十六根柳条，一根根贴在筐壁上（这是"筐"和"饼"的区别）
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const rib = b(0.016, H - 0.01, 0.014, i % 2 ? C.sand : C.wood,
      Math.cos(a) * (RIM - 0.02), H / 2, Math.sin(a) * (RIM - 0.02));
    rib.rotation.y = -a;
    rib.rotation.z = Math.cos(a) * 0.10;
    rib.rotation.x = -Math.sin(a) * 0.10;
    rib.material = M(i % 2 ? C.sand : C.wood);
    g.add(rib);
  }
  // 横箍两道
  for (const y of [0.075, 0.155]) {
    const r = RIM - 0.035 + y * 0.14;
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(r, 0.009, 5, 20), M(C.wood));
    hoop.rotation.x = -Math.PI / 2;
    hoop.position.y = y;
    g.add(hoop);
  }
  // 豆角：堆到筐沿外面，有长有短
  for (let i = 0; i < 11; i++) {
    const a = i * 2.1;
    const len = 0.18 + (i % 4) * 0.035;
    const bean = cy(0.009, 0.007, len, i % 3 ? C.grass : C.mint,
      Math.cos(a) * 0.10, H + 0.012 + (i % 3) * 0.014, Math.sin(a) * 0.10, 5);
    bean.rotation.z = 1.35 + (i % 3) * 0.16;
    bean.rotation.y = a;
    g.add(bean);
  }
  for (let i = 0; i < 3; i++) {                                                 // 掉在筐沿上的一根
    const out = cy(0.008, 0.006, 0.16, C.grass,
      0.16 + i * 0.02, H + 0.03 - i * 0.01, 0.10 - i * 0.05, 5);
    out.rotation.z = 1.25;
    out.rotation.y = 0.5 + i * 0.4;
    g.add(out);
  }
  // 地上散着择下来的三根豆角
  for (let i = 0; i < 3; i++) {
    const tail = cy(0.007, 0.006, 0.13, C.grass, 0.30 + i * 0.06, 0.012, 0.16 - i * 0.10, 5);
    tail.rotation.z = 1.45;
    tail.rotation.y = i * 0.8;
    g.add(tail);
  }
  return g;
}
// 小板凳（她坐的那只）
function stool() {
  const g = new THREE.Group();
  g.add(b(0.40, 0.045, 0.30, C.wood, 0, 0.40, 0));                              // 凳面
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(b(0.045, 0.40, 0.045, C.wood, sx * 0.145, 0.20, sz * 0.10));
  }
  g.add(b(0.34, 0.025, 0.025, C.wood, 0, 0.13, 0.10));                          // 横撑
  g.add(b(0.34, 0.025, 0.025, C.wood, 0, 0.13, -0.10));
  g.add(b(0.36, 0.012, 0.27, C.sand, 0, 0.424, 0));                             // 垫的一片草席
  return g;
}
// 她膝盖上的围裙（跟着人坐的方向摆）
function apron() {
  const g = new THREE.Group();
  g.position.y = 0.41;                                                         // 搭在她膝盖上，不落地
  const cloth = b(0.40, 0.018, 0.34, C.blue, 0, 0.02, 0);
  cloth.rotation.x = -0.28;
  g.add(cloth);
  g.add(b(0.40, 0.008, 0.03, C.cream, 0, 0.05, -0.14));                         // 围裙的腰绳
  g.add(b(0.06, 0.008, 0.16, C.cream, -0.17, 0.035, -0.02));
  g.add(b(0.06, 0.008, 0.16, C.cream, 0.17, 0.035, -0.02));
  return g;
}
// 水缸：接雨水的那一口（李家靠天喝水，这也解释了屋檐下为什么"该"有引水的东西）
function waterJar() {
  const g = new THREE.Group();
  g.add(cy(0.40, 0.31, 0.74, C.tile, 0, 0.37, 0, 20));                          // 缸身
  g.add(cy(0.42, 0.42, 0.07, C.road, 0, 0.755, 0, 20));                         // 缸沿
  g.add(cy(0.37, 0.37, 0.03, C.dark, 0, 0.71, 0, 20));                          // 缸口内壁
  const water = cy(0.355, 0.355, 0.02, M(C.blue, { transparent: true, opacity: 0.85 }), 0, 0.70, 0, 20);
  water.castShadow = false;
  g.add(water);
  A.jars.push(water);
  g.add(decal(0.94, 0.94, C.soil, 0, 0, 0.008, 0.28));                           // 缸脚的湿土
  g.add(decal(0.66, 0.66, C.dark, 0, 0.02, 0.009, 0.12));
  // 木盖斜靠在墙上
  const lid = cy(0.40, 0.40, 0.045, C.wood, -0.34, 0.36, 0.30, 20);
  lid.rotation.x = Math.PI / 2 - 0.30;
  lid.rotation.z = 0.16;
  g.add(lid);
  const lidTop = cy(0.40, 0.40, 0.012, C.sand, -0.355, 0.375, 0.312, 20);
  lidTop.rotation.x = Math.PI / 2 - 0.30;
  lidTop.rotation.z = 0.16;
  g.add(lidTop);
  // 水瓢搭在缸沿上
  const gourd = cy(0.075, 0.06, 0.07, C.wood, 0.30, 0.775, -0.12, 10);
  gourd.rotation.z = 0.4;
  g.add(gourd);
  const gs = cy(0.014, 0.014, 0.16, C.wood, 0.42, 0.80, -0.12, 5);
  gs.rotation.z = 1.2;
  g.add(gs);
  return g;
}
// 一摞旧砖（翻墙剩下的料：这院子刚动过，砖还没收）
function brickPile() {
  const g = new THREE.Group();
  const spots = [
    [[-0.26, 0.02, 0], [0.02, 0.02, 0], [0.30, 0.02, 0.02]],
    [[-0.24, 0.115, 0.03], [0.06, 0.115, 0.03]],
    [[-0.10, 0.21, 0.05]]
  ];
  for (let r = 0; r < 3; r++) {
    for (const [x, y, z] of spots[r]) {
      const br = b(0.24, 0.10, 0.14, r === 0 ? C.road : C.brick, x, y, z);
      br.rotation.y = (jit(x * 10 + r) - 0.5) * 0.16;
      g.add(br);
      g.add(b(0.235, 0.012, 0.135, C.tile, x, y + 0.055, z));                   // 砖面的压痕
    }
  }
  for (let i = 0; i < 4; i++) {                                                 // 碎砖与灰
    g.add(b(0.06 + (i % 2) * 0.04, 0.03, 0.05, C.tile,
      -0.34 + i * 0.24, 0.015, 0.26 + (i % 2) * 0.08));
  }
  g.add(decal(0.9, 0.7, C.tile, 0, 0, 0.007, 0.16));
  for (let i = 0; i < 6; i++) {
    g.add(ball(0.016, C.sand, -0.3 + i * 0.12, 0.012, 0.18 + (i % 3) * 0.05, 5));
  }
  return g;
}
function broom() {
  const g = new THREE.Group();
  const handle = cy(0.022, 0.022, 1.05, C.wood, 0, 0.62, 0, 6);
  handle.rotation.z = 0.14;
  g.add(handle);
  for (let i = 0; i < 7; i++) {                                                 // 高粱穗
    const s = b(0.016, 0.30, 0.016, C.sand, -0.10 + i * 0.028, 0.16, (i % 2) * 0.02);
    s.rotation.z = 0.14 + (i - 3) * 0.03;
    g.add(s);
  }
  g.add(b(0.20, 0.04, 0.05, C.road, -0.02, 0.30, 0.01));                        // 捆绳
  g.add(b(0.07, 0.02, 0.16, C.tile, -0.06, 0.01, 0.06));
  return g;
}
function slippers() {
  const g = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const s = b(0.10, 0.045, 0.25, C.ink, i * 0.14, 0.026, i * 0.03);
    s.rotation.y = i * 0.24;
    g.add(s);
    const strap = b(0.10, 0.018, 0.10, C.peach, i * 0.14, 0.058, 0.02 + i * 0.03);
    strap.rotation.y = i * 0.24;
    g.add(strap);
  }
  return g;
}
// 落叶：确定性摆位，不用随机数
function litter(n, w, d, seed) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const x = (jit(i * 3.1 + seed) - 0.5) * w;
    const z = (jit(i * 5.7 + seed) - 0.5) * d;
    const lf = flat(0.09 + jit(i + seed) * 0.06, 0.055, i % 3 ? C.wood : C.brick,
      x, 0.014 + (i % 3) * 0.001, z, 0.9, jit(i * 2.3 + seed) * 3.14);
    g.add(lf);
  }
  return g;
}
// 野草：几根贴地的草叶
function weeds(n, spread, seed) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + seed;
    const r = 0.05 + jit(i + seed) * spread;
    const h = 0.12 + jit(i * 2 + seed) * 0.13;
    const lf = b(0.014, h, 0.012, i % 2 ? C.grass : C.mint,
      Math.cos(a) * r, h / 2, Math.sin(a) * r);
    lf.rotation.z = Math.cos(a) * 0.4;
    lf.rotation.x = Math.sin(a) * 0.3;
    g.add(lf);
  }
  return g;
}
function stones(n, spread, seed) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + seed;
    const r = 0.06 + jit(i + seed) * spread;
    const st = ball(0.04 + jit(i * 3) * 0.035, i % 2 ? C.road : C.tile,
      Math.cos(a) * r, 0.022, Math.sin(a) * r, 6);
    st.scale.set(1.3, 0.6, 1);
    g.add(st);
  }
  return g;
}

// ============================================================================
// 场景数据
// ============================================================================
// 布局：堂屋在北（-z），木栅栏小门在西墙南段（+x 是东）。
// 视线从西南的小门进来，先撞见堂屋门口的方桌，再往上是新檐，最后才看见墙角的煤。
const props = [
  // ---- 地面：院地是一整片扫过的夯土；扫地扫出来的亮痕用低透明度的贴片压上去，
  //      不让"扫过的一片"变成一块有硬边的地毯。
  { id: "g_yard", x: 0, z: -0.75, w: 14.86, d: 11.96, passable: true,
    build: () => ground(14.86, 11.96, 0, 0, null, C.sand, 0.004) },
  { id: "g_swept", x: 0.10, z: -1.45, w: 6.60, d: 3.60, passable: true,
    build: () => {
      const g = new THREE.Group();
      g.add(flat(6.4, 3.4, C.cream, 0, 0.0058, 0, 0.34, 0.05));
      g.add(flat(4.4, 2.3, C.cream, 0.3, 0.0062, -0.2, 0.28, -0.04));
      g.add(flat(2.6, 1.5, C.cream, 0.6, 0.0066, 0.15, 0.26, 0.02));
      return g;
    } },
  { id: "g_pathA", x: -4.15, z: 2.22, w: 6.6, d: 1.4, passable: true,
    build: () => {
      const g = new THREE.Group();
      g.add(strip(-7.35, 3.35, -0.95, 1.10, 1.44, C.cream, 0.0068, 0.30));
      g.add(strip(-7.35, 3.35, -0.95, 1.10, 0.66, C.cream, 0.0071, 0.24));
      return g;
    } },
  { id: "g_pathB", x: -0.22, z: -0.68, w: 3.4, d: 1.4, passable: true,
    build: () => {
      const g = new THREE.Group();
      g.add(strip(-0.95, 1.10, 0.55, -2.45, 1.44, C.cream, 0.0069, 0.30));
      g.add(strip(-0.95, 1.10, 0.55, -2.45, 0.66, C.cream, 0.0072, 0.24));
      return g;
    } },
  { id: "g_pathWorn", x: -3.40, z: 2.00, w: 5.6, d: 0.5, passable: true,
    build: () => strip(-6.90, 3.10, -1.10, 1.25, 0.42, C.cream, 0.0076, 0.22) },
  { id: "g_wetEave", x: -0.30, z: -2.46, w: 6.9, d: 0.72, passable: true,
    build: () => {
      const g = new THREE.Group();
      g.add(flat(6.9, 0.72, C.tile, 0, 0.009, 0, 0.10));
      g.add(flat(6.2, 0.34, C.dark, 0, 0.0105, 0.05, 0.10));
      return g;
    } },
  { id: "g_moss1", x: -6.95, z: -2.60, w: 0.9, d: 3.4, passable: true,
    build: () => decal(0.9, 3.4, C.grass, 0, 0, 0.0095, 0.24) },
  { id: "g_moss2", x: 6.90, z: -2.20, w: 0.9, d: 1.8, passable: true,
    build: () => decal(0.9, 1.8, C.grass, 0, 0, 0.0095, 0.22) },
  { id: "g_outPath", x: -8.55, z: 3.75, w: 2.0, d: 1.9, passable: true,
    build: () => {
      const g = new THREE.Group();
      g.add(strip(-7.55, 3.30, -9.10, 4.05, 1.60, C.soil, 0.006, 0.55));
      g.add(strip(-7.60, 3.55, -9.10, 4.30, 0.34, C.tile, 0.008, 0.22));
      return g;
    } },
  { id: "g_outRoad", x: 0, z: 7.10, w: 15.6, d: 2.6, passable: true,
    build: () => ground(15.6, 2.2, 0, 0, null, C.soil, 0.005) },
  { id: "g_outWorn", x: 0, z: 6.20, w: 15.4, d: 0.34, passable: true,
    build: () => flat(15.4, 0.34, C.dark, 0, 0.008, 0, 0.14) },

  // ---- 院墙（三面 1.8 米，南面 0.58 米矮墙；西墙南段留 1.4 米院门）
  { id: "s_wallN", x: 0, z: YARD.z0, w: 15.54, d: WT, build: () => wallSeg(15.54) },
  { id: "s_wallE", x: YARD.x1, z: -0.75, w: WT, d: 12.30, rot: Math.PI / 2,
    build: () => wallSeg(12.30) },
  { id: "s_wallW1", x: YARD.x0, z: -2.10, w: WT, d: 9.60, rot: Math.PI / 2,
    build: () => wallSeg(9.60) },
  { id: "s_wallW2", x: YARD.x0, z: 4.75, w: WT, d: 1.30, rot: Math.PI / 2,
    build: () => wallSeg(1.30) },
  { id: "s_wallS", x: 0, z: YARD.z1, w: 15.54, d: WT, build: () => lowWall(15.54) },
  { id: "s_gate", x: YARD.x0, z: 3.40, w: 0.62, d: 1.9, build: gate,
    interact: { x: -6.30, z: 3.40 } },

  // ---- 堂屋（视觉中心所在）
  { id: "s_house", x: HX, z: HZ, w: HW, d: HD, build: house,
    interact: { x: 0.90, z: -2.90 } },

  // ---- 堂屋桌（视觉中心）：缴费单 + 低保材料
  { id: "s_table", x: 0.55, z: -1.60, w: 1.45, d: 1.05, build: diningTable,
    interact: { x: 0.55, z: -0.35 } },

  // ---- 檐下的滴水坑（次中心 / 物证）
  { id: "s_dripHole", x: DRIP_X, z: DRIP_Z, w: 0.7, d: 0.7, passable: true,
    build: dripHole, interact: { x: DRIP_X + 0.10, z: DRIP_Z + 0.85 } },
  { id: "s_drip", x: DRIP_X, z: DRIP_Z + 0.01, w: 0.1, d: 0.1, passable: true,
    build: drips },

  // ---- 西北：蜂窝煤 + 旧自行车 + 水缸 + 木桶
  { id: "s_coal", x: -5.60, z: -3.10, w: 1.15, d: 1.05, build: coalStack,
    interact: { x: -5.10, z: -2.05 } },
  { id: "s_bike", x: -7.02, z: -1.30, w: 0.62, d: 1.80, rot: Math.PI / 2, build: bike,
    interact: { x: -6.05, z: -1.30 } },
  { id: "s_jar", x: -6.55, z: -5.05, w: 0.86, d: 0.86, build: waterJar },
  { id: "s_pail", x: -6.55, z: -0.10, w: 0.4, d: 0.4, passable: true,
    build: () => {
      const g = new THREE.Group();
      g.add(cy(0.15, 0.13, 0.26, C.blue, 0, 0.13, 0, 14));
      g.add(cy(0.155, 0.155, 0.02, C.road, 0, 0.265, 0, 14));
      g.add(cy(0.13, 0.13, 0.01, C.glass, 0, 0.245, 0, 14));                    // 桶里的水
      const handle = new THREE.Mesh(
        new THREE.TorusGeometry(0.14, 0.008, 4, 12, Math.PI), M(C.road));
      handle.position.set(0, 0.26, 0);
      g.add(handle);
      return g;
    } },

  // ---- 东北：晾衣绳 + 鸡窝 + 两只鸡 + 鸡食盆
  { id: "s_laundry", x: 4.60, z: -3.55, w: 4.6, d: 0.4, passable: true,
    build: () => laundry(4.6), interact: { x: 4.60, z: -2.55 } },
  { id: "s_coop", x: 6.35, z: -5.45, w: 1.4, d: 1.05, build: coop,
    interact: { x: 6.30, z: -4.35 } },
  { id: "s_hen1", x: 4.75, z: -4.45, w: 0.4, d: 0.4, passable: true,
    build: () => {
      const h = chicken(C.cream, C.coral);
      A.hens.push({ head: h.head, body: h.body, ph: 0.0, per: 6.3 });
      return h.g;
    } },
  { id: "s_hen2", x: 5.62, z: -3.05, w: 0.4, d: 0.4, passable: true,
    build: () => {
      const h = chicken(C.wood, C.coral);
      h.g.rotation.y = 2.30;
      A.hens.push({ head: h.head, body: h.body, ph: 3.4, per: 8.1 });
      return h.g;
    } },
  { id: "s_feed", x: 6.10, z: -2.35, w: 0.4, d: 0.4, passable: true, build: feedPan },

  // ---- 西南：木栅栏门外 + 翻墙剩的砖 + 扫帚
  { id: "s_bricks", x: -6.05, z: 1.95, w: 1.05, d: 0.85, build: brickPile,
    interact: { x: -5.35, z: 1.95 } },
  { id: "s_broom", x: -7.12, z: 0.85, w: 0.34, d: 0.30, passable: true, build: broom },
  { id: "s_leafSW", x: -4.30, z: 3.60, w: 2.6, d: 1.4, passable: true,
    build: () => litter(9, 2.6, 1.4, 2) },
  { id: "s_weedSW", x: -6.85, z: 4.55, w: 0.5, d: 0.5, passable: true,
    build: () => weeds(6, 0.18, 1.2) },

  // ---- 东南：菜地 + 菜筐 + 小板凳（李秀兰）+ 拖鞋
  { id: "s_plot", x: 6.15, z: 2.30, w: 2.45, d: 4.50, build: vegPlot,
    interact: { x: 4.75, z: 2.40 } },
  { id: "s_basket", x: 1.55, z: 1.25, w: 0.52, d: 0.52, passable: true, build: basket },
  { id: "s_stool", x: 2.40, z: 0.20, w: 0.46, d: 0.36, build: stool },
  { id: "s_apron", x: 2.16, z: 0.50, w: 0.44, d: 0.38, rot: -0.75, passable: true, build: apron },
  { id: "s_slipper", x: 1.28, z: -2.32, w: 0.32, d: 0.28, passable: true, build: slippers },
  { id: "s_leafSE", x: 3.60, z: 3.30, w: 2.4, d: 1.2, passable: true,
    build: () => litter(7, 2.4, 1.2, 5) },

  // ---- 院子里的零碎：绿植、石子、墙根的草
  { id: "s_bush1", x: -6.35, z: -6.05, w: 0.7, d: 0.7, passable: true,
    build: () => bush(0, 0, 0.30, C.grass, C.mint) },
  { id: "s_bush2", x: 7.02, z: -1.10, w: 0.6, d: 0.6, passable: true,
    build: () => bush(0, 0, 0.26, C.grass, C.mint) },
  { id: "s_bush3", x: -8.05, z: 1.55, w: 0.8, d: 0.8, passable: true,
    build: () => bush(0, 0, 0.34, C.grass, C.mint) },
  { id: "s_stones1", x: -3.20, z: -2.55, w: 0.5, d: 0.4, passable: true,
    build: () => stones(5, 0.20, 0.7) },
  { id: "s_stones2", x: 7.75, z: 4.60, w: 0.6, d: 0.5, passable: true,
    build: () => stones(4, 0.24, 2.1) },
  { id: "s_weed1", x: -7.18, z: -4.10, w: 0.5, d: 0.5, passable: true,
    build: () => weeds(6, 0.20, 0.4) },
  { id: "s_weed2", x: 7.20, z: -6.10, w: 0.5, d: 0.5, passable: true,
    build: () => weeds(5, 0.20, 1.9) },
  { id: "s_weed3", x: -8.60, z: 5.60, w: 0.6, d: 0.6, passable: true,
    build: () => weeds(7, 0.24, 2.8) },
  { id: "s_weed4", x: 8.60, z: 1.20, w: 0.6, d: 0.6, passable: true,
    build: () => weeds(6, 0.24, 0.9) },
  { id: "s_litterOut", x: -2.20, z: 6.30, w: 2.2, d: 0.9, passable: true,
    build: () => litter(6, 2.2, 0.9, 8) }
];

// 碰撞：单独登记，不复用 passable —— scene3d 会给每个非 passable 的物件铺一块
// 方形接触阴影贴片，在这么亮的夯土地面上它是一块块灰垫子。这一场的影子交给主光自己打。
for (const p of props) { p.passable = true; }
const obstacles = [
  { x: HX, z: HZ, w: HW, d: HD },                                   // 堂屋
  { x: 0, z: YARD.z0, w: 15.54, d: WT },                            // 北墙
  { x: YARD.x1, z: -0.75, w: WT, d: 12.30 },                        // 东墙
  { x: YARD.x0, z: -2.10, w: WT, d: 9.60 },                         // 西墙北段
  { x: YARD.x0, z: 4.75, w: WT, d: 1.30 },                          // 西墙南段
  { x: 0, z: YARD.z1, w: 15.54, d: WT },                            // 南矮墙
  { x: YARD.x0, z: 3.40, w: 0.62, d: 1.90 },                        // 院门
  { x: 0.55, z: -1.60, w: 1.45, d: 1.05 },                          // 方桌
  { x: -5.60, z: -3.10, w: 1.15, d: 1.05 },                         // 蜂窝煤
  { x: -7.02, z: -1.30, w: 0.62, d: 1.80 },                         // 自行车
  { x: -6.55, z: -5.05, w: 0.86, d: 0.86 },                         // 水缸
  { x: -6.05, z: 1.95, w: 1.05, d: 0.85 },                          // 砖堆
  { x: 6.35, z: -5.45, w: 1.40, d: 1.05 },                          // 鸡窝
  { x: 6.15, z: 2.30, w: 2.45, d: 4.50 },                           // 菜地
  { x: 2.40, z: 0.20, w: 0.46, d: 0.36 },                           // 小板凳（她坐着，不让上台）
  { x: -2.20, z: 6.30, w: 2.20, d: 0.90 }
];

// 关键人物：李秀兰坐在堂屋门口的小板凳上择菜，膝盖上搭着围裙。
// 她不看镜头 —— 这一场的难处全在桌上那张纸，不在她脸上。
const characters = [
  { id: "p_a", label: "李秀兰", name: "李秀兰", role: "报案人",
    x: 2.40, z: 0.20, y: -0.15, facing: -0.75, pose: "sit",
    scale: 0.98, color: C.peach, pants: C.dark, hair: "#3a2c22" }
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
    // 底座三层出边 + 外景草地：模型落在同一片环境里，不是悬在虚空
    baseColor: C.cream, baseSideColor: C.navy, siteColor: C.grass,
    terrainSideColor: C.soil,
    outer: true, outerColor: C.grass,
    // 上午十点：天顶是干净的海盐蓝，地平线压一层奶油白
    skyTop: C.blue, skyMid: C.glass, skyBottom: C.cream,
    light: { sun: C.cream, sunI: 2.15, fill: C.blue, fillI: 0.90, hemi: 0.86,
             hemiSky: C.glass, hemiGround: C.sand, exposure: 0.95 },
    fogDensity: 0.0062,
    actor: { x: 0.30, z: 3.55 },
    camYaw: 0.40, camPitch: 0.60, camDist: 15.5, camFocus: [0, 1.0, -0.90],
    walk: { x0: -6.85, x1: 6.85, z0: -2.75, z1: 4.85 },
    onSpot: (p) => { (window.__events = window.__events || []).push(["spot", p.id]); },
    onPerson: (p) => { (window.__events = window.__events || []).push(["person", p.id]); },
    onArrived: (p) => { (window.__events = window.__events || []).push(["arrived", +p.x.toFixed(2), +p.z.toFixed(2)]); },
    // ---- 基础动效：12 条，幅度全部 2% 量级
    onFrame: (t) => {
      // ① 屋檐滴水：每三秒一滴，从瓦头前缘的铅垂线落进坑里
      const ph = t % 3.0;
      if (A.drop) {
        if (ph < 0.58) {
          const k = ph / 0.58;
          A.drop.visible = true;
          A.drop.position.y = EAVE_UNDER - 0.02 - k * k * (EAVE_UNDER - 0.07);
          A.drop.scale.setScalar(0.74 + k * 0.40);
        } else {
          A.drop.visible = false;
        }
      }
      // ② 落进坑里：0.8 秒扩散一圈涟漪（三圈错开，接得上）
      const q = (ph - 0.58) / 0.8;
      for (let i = 0; i < A.rings.length; i++) {
        const qq = q - i * 0.24;
        const on = qq >= 0 && qq <= 1;
        A.rings[i].visible = on;
        if (on) {
          const s = 0.20 + qq * 0.84;
          A.rings[i].scale.set(s, 1, s);
          A.rings[i].material.opacity = 0.42 * (1 - qq);
        }
      }
      // ③ 挂着的两滴水珠：水在聚集，2% 的鼓与沉
      for (let i = 0; i < A.beads.length; i++) {
        const bd = A.beads[i];
        bd.position.y = bd.userData.y + Math.sin(t * 1.35 + i * 1.9) * 0.008;
        bd.scale.set(1 + Math.sin(t * 1.1 + i * 2.2) * 0.02, 1.35,
          1 + Math.cos(t * 1.1 + i) * 0.02);
      }
      // ④ 晾衣绳上的两件小孩衣服轻摆（0.025 弧度，两件错开相位）
      for (const c of A.clothes) {
        c.g.rotation.z = Math.sin(t * 1.05 + c.ph) * 0.025;
        c.g.rotation.x = Math.sin(t * 0.72 + c.ph * 0.6) * 0.012;
      }
      // ⑤ 最下面那件的裤脚在滴水：每 4.2 秒一滴
      if (A.hem) {
        const hp = t % 4.2;
        if (hp < 0.52) {
          A.hem.visible = true;
          A.hem.position.y = 1.86 - (hp / 0.52) * (hp / 0.52) * 1.80;
        } else {
          A.hem.visible = false;
        }
      }
      // ⑥ 两只鸡在原地啄食，偶尔侧头，不位移
      for (const h of A.hens) {
        const qq = (t + h.ph) % h.per;
        const a = qq < 1.05 ? Math.sin(qq * Math.PI) : 0;
        h.head.rotation.x = a * 0.60;
        h.head.rotation.y = Math.sin(t * 0.33 + h.ph) * 0.12;
        h.body.rotation.x = a * 0.05;
        h.body.position.y = Math.sin(a * Math.PI) * 0.012;
      }
      // ⑦ 豆角架的藤蔓在风里轻晃 0.025 弧度
      if (A.vine) {
        A.vine.rotation.z = Math.sin(t * 0.63) * 0.025;
        A.vine.rotation.x = Math.sin(t * 0.48 + 1.1) * 0.014;
      }
      // ⑧ 屋檐投在墙上的硬边随太阳极缓下移（十分钟约一指宽）。
      //    与其在墙上贴一条假阴影，不如把主光挪一点 —— 影子自己会爬。
      //    十点的日头已经很高：光从南面稍偏西下来，屋影全缩到檐后的墙根，
      //    院子（和桌上那两张纸）整片晒着，这才是"上午十点"。
      const sun = window.__dbg && window.__dbg.sun;
      if (sun) {
        const k = Math.sin(t * 0.0016) * 0.12;
        sun.position.set(-4.5 + k, 15.5, 11.0 + k * 0.8);
      }
      // ⑨ 檐下两串玉米轻摆 0.018 弧度
      for (let i = 0; i < A.corn.length; i++) {
        A.corn[i].rotation.x = Math.sin(t * 0.70 + i * 1.3) * 0.018;
        A.corn[i].rotation.z = Math.sin(t * 0.53 + i) * 0.012;
      }
      // ⑩ 门洞里五片玻璃板门帘被穿堂风带得轻轻错位
      for (let i = 0; i < A.strips.length; i++) {
        A.strips[i].rotation.z = Math.sin(t * 0.90 + i * 0.7) * 0.020;
        A.strips[i].rotation.x = Math.sin(t * 0.62 + i * 1.1) * 0.012;
      }
      // ⑪ 水缸的水面：极缓的一圈呼吸，2%
      for (let i = 0; i < A.jars.length; i++) {
        const k = 1 + Math.sin(t * 1.10 + i * 1.9) * 0.02;
        A.jars[i].scale.set(k, 1, k);
      }
      // ⑫ 桌上那张单据掀起的一角：被风顶一下又落回去
      if (A.paper) { A.paper.rotation.x = -0.42 + Math.sin(t * 0.85) * 0.03; }
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
