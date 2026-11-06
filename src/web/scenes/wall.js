// S3 · 院墙争议地界（清晨 06:10）—— 院墙案的起点
// -----------------------------------------------------------------------------
// 按 docs/场景与人物建模提示词.md §1 + §3 S3 重做（2026-11-04，质量第一）。
// 七段结构一一对应：画面风格 / 底座与构图 / 时间与氛围 / 院墙与建筑 / 陈设 /
// 基础动效 / 避免出现。
//   ① 颜色只用 kit 的 PAL 那 19 个（15 + 4 个土地色），本文件没有第二个色板；
//   ② 零噪点贴图：地面 / 土 / 菜地全是纯色 + 几何分格，只有砖墙用 kit 的纯色砖格，
//      本文件里一个随机数都没有（位置扰动一律走确定性 jit(i)）；
//   ③ 大件描边由 kit.b 自动加（最大边 > 0.55），界石单独补一道墨线——它是视觉中心；
//   ④ 四格：西北 李家屋角 + 水缸 + 晾衣 / 东北 新砖院墙 + 瓦檐 + 剩砖灰槽沙堆 /
//            西南 土路 + 老树 + 竹筐 / 东南 菜地 + 柴垛 + 砧木；
//   ⑤ 视觉中心 界石（旧砖与新砖的接缝处），次中心 排水沟的砖砌封堵；
//   ⑥ onFrame 12 条 2% 量级循环（屋檐滴水 3 秒一滴 / 涟漪 / 沟水缓流 / 封堵打旋 /
//      丝瓜藤叶 0.025 / 晾衣三件 / 衣角滴水 / 贴地雾横移 / 树冠风动 / 两只鸡低头 /
//      玉米串 / 水缸水面）。
// -----------------------------------------------------------------------------
import * as THREE from "./vendor/three.module.min.js";
import { PAL as C, M, b, cy, ball, decal, ground, bush, brickTex, outline } from "./kit.js";
import { createScene } from "./scene3d.js";

window.__err = "";
window.addEventListener("error", (e) => {
  window.__err = (e.message || "error") + " @ " + (e.filename || "") + ":" + (e.lineno || 0);
});

// ---------------------------------------------------------------- 动画句柄
// 所有会动的部件在这里登记，onFrame 统一驱动；幅度一律 2% 量级。
const A = {
  drop: null, rings: [], flow: [], swirl: null,
  vine: null, leaves: [], clothes: [], hemDrop: null,
  fog: [], canopy: null, hens: [], corn: [], jars: []
};

// ---------------------------------------------------------------- 小工具
// 贴地薄片（苔、水渍、脚印、落叶）：不写深度、纯色、不参与光照
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
// 立在墙面上的薄片（水痕、霉斑、刻痕、雨渍）：朝 +z，flip 时贴到北面
function face(w, h, color, x, y, z, op = 1, flip = false) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({
      color, transparent: op < 1, opacity: op, depthWrite: false, side: THREE.DoubleSide
    }));
  m.position.set(x, y, flip ? -z : z);
  if (flip) { m.rotation.y = Math.PI; }
  return m;
}
// 确定性抖动：不掷随机数，也不让每片叶子的位置一模一样
const jit = (i) => (Math.sin(i * 2.399) + 1) / 2;

// ---------------------------------------------------------------- 院墙
// 一道墙把底座劈成两半：西段旧砖（张家父亲三十年前砌）、东段新砖（李家翻新）。
// 砖色分界 + 半埋界石 = 这件案子的视觉中心。墙总高 1.55 / 1.61（半堵墙）。
const Z_W = 0.15, T_W = 0.34, FACE = T_W / 2 + 0.004;
const OLD_L = 9.70, OLD_X = -3.70, OLD_H = 1.26;
const NEW_L = 7.30, NEW_X = 4.80, NEW_H = 1.32;
const OLD_TOP = 0.16 + OLD_H + 0.13;     // 1.55：压顶顶面
const NEW_TOP = 0.16 + NEW_H + 0.13;     // 1.61

function brickMap(base, mortar, w, h) {
  // 纯色砖格：没有一粒噪点，错缝还在
  const t = brickTex(base, mortar, 8, 5);
  t.repeat.set(Math.max(1, w / 1.05), Math.max(1, h / 1.05));
  return t;
}

// 一段墙：墙基一皮 + 砖身 + 压顶 + 压顶薄砖（四层，剖面上才不是一块板）
function wallRun(len, h, brick, mortar, tint) {
  const g = new THREE.Group();
  g.add(b(len, h, T_W, M(tint, { map: brickMap(brick, mortar, len, h) }), 0, 0.16 + h / 2, 0));
  g.add(b(len + 0.05, 0.16, T_W + 0.07, C.tile, 0, 0.08, 0));                    // 墙基一皮
  g.add(b(len + 0.07, 0.035, T_W + 0.09, C.road, 0, 0.177, 0));                  // 墙基压条
  g.add(b(len + 0.14, 0.05, T_W + 0.14, C.tile, 0, 0.16 + h + 0.025, 0));        // 压顶下皮（出檐）
  g.add(b(len + 0.18, 0.07, T_W + 0.18, C.tile, 0, 0.16 + h + 0.085, 0));        // 压顶
  g.add(b(len + 0.12, 0.035, T_W + 0.12, C.tile, 0, 0.16 + h + 0.137, 0));       // 压顶上的薄砖
  g.add(face(len + 0.18, 0.014, C.sand, 0, 0.16 + h + 0.106, (T_W + 0.18) / 2 + 0.002, 0.40));
  g.add(b(len + 0.04, 0.014, 0.05, C.sand, 0, 0.16 + h + 0.161, 0));             // 顶面一道雨淋亮
  return g;
}

// 东段墙头的瓦檐：十四道圆筒瓦 + 十四片板瓦 + 十四个瓦当 + 一道瓦口压条
// 扁长条会读成"冰砖"，圆筒瓦才有亮边，从俯视角度也能看出是一排瓦。
function eaveTiles(len) {
  const g = new THREE.Group();
  const y0 = NEW_TOP;
  g.add(b(len, 0.06, 0.72, C.tile, 0, y0 + 0.03, 0.02));                         // 灰背
  // 三道瓦行 + 叠瓦缝。上一版在背上压了 14 根蓝灰细条当"瓦垄"，
  // 俯视时那 14 根横条读成了一道栏杆——瓦垄只在檐口用瓦当交代，背上不再加条。
  for (let k = 0; k < 3; k++) {
    g.add(b(len, 0.035, 0.22, C.tile, 0, y0 + 0.072, -0.16 + k * 0.24));
    g.add(b(len, 0.012, 0.02, C.dark, 0, y0 + 0.094, -0.05 + k * 0.24));         // 叠瓦缝
  }
  for (let i = 0; i < 14; i++) {                                                 // 十四个瓦当（檐口才有的圆头）
    const x = -len / 2 + 0.28 + i * 0.52;
    const d = cy(0.044, 0.044, 0.026, C.tile, x, y0 + 0.056, 0.355, 8);
    d.rotation.x = Math.PI / 2;
    g.add(d);
    g.add(b(0.030, 0.018, 0.10, C.road, x, y0 + 0.090, 0.28));                   // 瓦当后的一小截筒瓦
  }
  g.add(b(len, 0.022, 0.05, C.sand, 0, y0 + 0.014, 0.365));                      // 瓦口下的一道浅
  return g;
}

// 东端墙垛：墙到这里收头，侧面才不是一刀切的纸板
function wallPier() {
  const g = new THREE.Group();
  g.add(b(0.5, 1.86, 0.56, M(C.white, { map: brickMap(C.brick, C.sand, 0.5, 1.86) }), 0, 0.93, 0));
  g.add(b(0.6, 0.18, 0.66, C.tile, 0, 0.09, 0));
  g.add(b(0.62, 0.05, 0.68, C.road, 0, 0.185, 0));
  g.add(b(0.62, 0.08, 0.68, C.tile, 0, 1.90, 0));
  g.add(b(0.54, 0.04, 0.60, C.road, 0, 1.96, 0));
  g.add(face(0.3, 0.9, C.dark, 0, 1.3, 0.285, 0.13));                            // 墙面雨痕
  g.add(face(0.18, 0.16, C.grass, -0.08, 0.26, 0.286, 0.3));                     // 墙脚苔
  return g;
}

// 界石：半埋、被雨淋白的顶、三道竖刻痕 —— 全场的视觉中心
// 一块上窄下宽的整石（四棱锥台），不是叠起来的柜子。
function boundaryStone() {
  const g = new THREE.Group();
  const body = cy(0.300, 0.380, 1.06, C.road, 0, 0.51, 0, 4);                    // 四棱台：下宽上窄
  body.rotation.y = Math.PI / 4;
  outline(body, 1.0);
  g.add(body);
  const cap = cy(0.325, 0.325, 0.07, C.sand, 0, 1.045, 0, 4);                    // 顶面（雨淋白）
  cap.rotation.y = Math.PI / 4;
  cap.rotation.z = 0.03;
  g.add(cap);
  g.add(b(0.10, 0.09, 0.14, C.tile, 0.26, 1.02, 0.10));                          // 崩掉的一角
  g.add(b(0.08, 0.05, 0.10, C.tile, -0.25, 1.045, -0.05));
  g.add(b(0.26, 0.02, 0.02, C.sand, 0.0, 1.078, 0.22));                          // 顶面的一道磨亮
  for (let i = 0; i < 3; i++) {                                                  // 三道竖刻痕（记数）
    g.add(face(0.024, 0.30, C.dark, -0.12 + i * 0.115, 0.58, 0.250, 0.68));
    g.add(face(0.006, 0.30, C.sand, -0.106 + i * 0.115, 0.58, 0.251, 0.4));      // 刻痕的一道亮边
  }
  g.add(face(0.40, 0.14, C.grass, -0.05, 0.10, 0.252, 0.42));                    // 石脚苔
  g.add(face(0.22, 0.10, C.ink, 0.20, 0.05, 0.252, 0.34));                       // 湿到发暗的底
  g.add(face(0.18, 0.20, C.sand, -0.22, 0.66, 0.250, 0.26));                     // 一块被摸亮的边
  g.add(face(0.30, 0.34, C.dark, 0.14, 0.80, 0.248, 0.10));                      // 背光的一片
  g.add(decal(1.3, 1.0, C.soil, 0, 0, 0.006, 0.55));                             // 周围的土
  g.add(decal(0.9, 0.62, C.dark, 0, 0.02, 0.007, 0.16));
  g.add(flat(0.36, 0.22, C.ink, 0.02, 0.012, 0.12, 0.22));                       // 石脚踩实的暗
  for (let i = 0; i < 5; i++) {                                                  // 五粒碎石
    const a = i * 1.31 + 0.2;
    g.add(ball(0.032 + (i % 3) * 0.012, i % 2 ? C.road : C.tile,
      Math.cos(a) * 0.58, 0.028, 0.14 + Math.sin(a) * 0.32, 7));
  }
  g.add(ball(0.06, C.sand, -0.52, 0.05, 0.44, 7));                               // 石缝里的一撮土
  return g;
}

// 排水沟：贴着墙根往东流，尽头被砖砌死，水停在那里打旋 —— 次中心
function ditch(len) {
  const g = new THREE.Group();
  g.add(b(len, 0.05, 0.50, C.dark, 0, 0.022, 0));                                // 沟底（暗湿）
  for (const s of [-1, 1]) {
    g.add(b(len, 0.11, 0.09, C.tile, 0, 0.055, s * 0.295));                      // 两侧沟壁
    g.add(b(len, 0.028, 0.12, C.road, 0, 0.118, s * 0.295));                     // 壁顶压条
    g.add(b(len, 0.016, 0.012, C.sand, 0, 0.082, s * 0.247));                    // 水线（水垢）
    for (let i = 0; i < 8; i++) {                                                // 沟沿的砖牙
      g.add(b(0.16, 0.045, 0.05, i % 2 ? C.brick : C.tile,
        -len / 2 + 0.35 + i * 0.62, 0.145, s * 0.30));
    }
  }
  // 水：一层深、一层亮，才有"沟里有水"的体积
  const water = new THREE.Mesh(new THREE.PlaneGeometry(len - 0.26, 0.40),
    M(C.blue, { transparent: true, opacity: 0.72 }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0.058, 0);
  g.add(water);
  const sheen = new THREE.Mesh(new THREE.PlaneGeometry(len - 0.5, 0.07),
    new THREE.MeshBasicMaterial({ color: C.glass, transparent: true, opacity: 0.30, depthWrite: false }));
  sheen.rotation.x = -Math.PI / 2;
  sheen.position.set(-0.1, 0.062, -0.10);
  g.add(sheen);
  // 缓流：四条极细的流线，由 onFrame 推着往东走
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.022),
      new THREE.MeshBasicMaterial({ color: C.glass, transparent: true, opacity: 0.32, depthWrite: false }));
    f.rotation.x = -Math.PI / 2;
    f.position.set(-len / 2 + 0.3 + i * 1.1, 0.064, -0.11 + (i % 3) * 0.10);
    g.add(f);
    A.flow.push({ m: f, o: i * 0.72 });
  }
  // 封堵处打旋（两圈细弧，onFrame 转）
  const swirl = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const geo = new THREE.RingGeometry(0.05 + i * 0.04, 0.068 + i * 0.04, 20, 1, i * 1.7, 3.4);
    geo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: C.white, transparent: true, opacity: 0.42 - i * 0.13, depthWrite: false
    }));
    swirl.add(ring);
  }
  swirl.position.set(len / 2 - 0.46, 0.066, 0);
  g.add(swirl);
  A.swirl = swirl;
  // 砖砌封堵：沟到这儿断掉（f_e05 的视觉依据）
  g.add(b(0.26, 0.40, 0.68, M(C.white, { map: brickMap(C.brick, C.soil, 0.26, 0.40) }),
    len / 2 - 0.13, 0.20, 0));
  g.add(b(0.32, 0.05, 0.72, C.tile, 0, 0.415, 0));
  g.add(b(0.34, 0.02, 0.74, C.road, 0, 0.448, 0));
  g.add(b(0.26, 0.03, 0.6, C.dark, len / 2 - 0.13, 0.05, 0));                    // 封堵根的湿痕
  g.add(face(0.2, 0.16, C.sand, 0, 0.30, 0.343, 0.35));                          // 抹上去的灰
  g.add(face(0.1, 0.3, C.dark, 0.08, 0.2, 0.344, 0.2));
  // 三片落叶 + 一层淤泥
  for (let i = 0; i < 3; i++) {
    g.add(flat(0.17, 0.11, [C.grass, C.wood, C.brick][i], -len / 3 + i * len / 3.6,
      0.056 + i * 0.001, -0.08 + (i % 2) * 0.14, 0.92, i * 0.9));
  }
  g.add(flat(len - 0.9, 0.26, C.tile, 0, 0.048, 0, 0.26));
  // 沟沿两簇草
  for (let i = 0; i < 5; i++) {
    const h = 0.16 + jit(i) * 0.12;
    const w = cy(0.01, 0.004, h, C.grass, -len / 2 + 0.7 + i * 0.9, 0.14 + h / 2, 0.34, 4);
    w.rotation.z = (jit(i + 2) - 0.5) * 0.5;
    g.add(w);
  }
  return g;
}

// 墙根：苔、水痕、裂缝、掉皮（旧砖的证据都在这一层）
function wallFooting() {
  const g = new THREE.Group();
  g.add(decal(3.6, 0.5, C.grass, -0.2, 0.02, 0.008, 0.30));
  g.add(decal(1.5, 0.34, C.dark, 1.5, 0.02, 0.009, 0.18));
  g.add(face(2.4, 0.44, C.grass, -1.2, 0.20, FACE, 0.28));                       // 墙脚一圈苔线
  g.add(face(1.2, 0.9, C.dark, 1.8, 0.50, FACE, 0.11));                          // 返潮的水痕
  g.add(face(0.5, 0.7, C.tile, 2.6, 0.5, FACE, 0.14));
  for (let i = 0; i < 3; i++) {                                                  // 三道裂缝（贴面，不凸出来）
    const c = face(0.012, 0.32 + i * 0.14, C.ink, -2.9 + i * 0.9, 0.78 + i * 0.1, FACE, 0.38);
    c.rotation.z = 0.05 - i * 0.04;
    g.add(c);
  }
  g.add(face(0.64, 0.48, C.tile, -3.9, 1.0, FACE, 0.5));                         // 掉了一块皮，露出里头的砖
  for (let i = 0; i < 4; i++) {
    g.add(face(0.15, 0.1, i % 2 ? C.brick : C.road,
      -4.1 + (i % 2) * 0.16, 0.84 + Math.floor(i / 2) * 0.15, FACE + 0.001, 0.85));
  }
  g.add(face(0.68, 0.03, C.sand, -3.9, 1.25, FACE + 0.001, 0.5));                // 裂口上沿的一道灰
  g.add(face(0.5, 0.05, C.ink, -3.6, 0.765, FACE + 0.001, 0.4));                 // 掉皮的下沿
  g.add(face(1.4, 0.10, C.sand, 0.4, 0.36, FACE, 0.16));                         // 墙根泛出的白霜
  return g;
}

// 新墙的"病"：一道新渍缝 + 墙基下沉一指宽（f_wall 的两处依据）
function newWallMarks() {
  const g = new THREE.Group();
  g.add(face(0.26, 1.0, C.dark, 0.10, 0.84, FACE, 0.18));                        // 竖着的一条新渍
  g.add(face(0.09, 0.46, C.ink, 0.10, 0.36, FACE + 0.001, 0.13));
  g.add(face(0.16, 0.2, C.sand, 0.10, 1.26, FACE, 0.28));                        // 泛出来的一点白霜
  g.add(b(0.9, 0.026, 0.03, C.ink, -0.55, 0.026, FACE - 0.02));                  // 墙基与地面之间那道缝
  g.add(b(0.06, 0.2, 0.02, C.ink, -0.10, 0.13, FACE - 0.03));
  g.add(b(0.5, 0.05, 0.05, C.tile, 0.35, 0.02, FACE - 0.01));                    // 缝口顶出来的碎砖
  g.add(face(0.12, 0.12, C.grass, -0.02, 0.14, FACE, 0.3));                      // 新墙根也起苔了
  return g;
}

// 丝瓜藤：十四片叶爬满旧墙头，三处垂下来的卷须，两朵花，两只小丝瓜
function squashVine() {
  const g = new THREE.Group();
  g.add(cy(0.022, 0.017, 2.7, C.grass, -0.2, OLD_TOP + 0.02, 0.05, 5));          // 主藤
  const leaves = [];
  for (let i = 0; i < 14; i++) {                                                 // 十四片叶，分两排
    const row = i < 7 ? 0 : 1;
    const x = -1.6 + (i % 7) * 0.28 + row * 0.14;
    const y = OLD_TOP + 0.04 + jit(i) * 0.26;
    const z = (row ? -0.08 : 0.15) + (jit(i + 7) - 0.5) * 0.16;
    const leaf = ball(0.15 + jit(i + 3) * 0.05, i % 5 ? C.grass : C.mint, x, y, z, 7);
    leaf.scale.set(1.35, 0.5, 1.05);
    leaf.rotation.y = i * 0.8;
    leaf.rotation.z = (jit(i + 5) - 0.5) * 0.55;
    g.add(leaf);
    leaves.push({ m: leaf, y, ph: i * 0.6 });
  }
  for (let i = 0; i < 3; i++) {                                                  // 垂到墙南面的须
    const x = -1.2 + i * 0.95;
    g.add(cy(0.012, 0.008, 0.44, C.grass, x, OLD_TOP - 0.12, 0.20, 5));
    g.add(ball(0.06, C.mint, x + 0.04, OLD_TOP - 0.35, 0.21, 6));
    g.add(ball(0.04, C.mint, x - 0.05, OLD_TOP - 0.28, 0.22, 6));
  }
  for (let i = 0; i < 2; i++) {                                                  // 两朵花
    g.add(cy(0.05, 0.05, 0.02, C.yellow, -1.0 + i * 1.8, OLD_TOP + 0.25, 0.06, 8));
    g.add(ball(0.035, C.yellow, -1.0 + i * 1.8, OLD_TOP + 0.28, 0.06, 6));
    g.add(cy(0.012, 0.012, 0.10, C.grass, -1.0 + i * 1.8, OLD_TOP + 0.18, 0.06, 4));
  }
  for (let i = 0; i < 2; i++) {                                                  // 两只小丝瓜
    const sc = cy(0.045, 0.032, 0.26, C.mint, 0.55 + i * 0.5, OLD_TOP - 0.13, 0.26, 8);
    sc.rotation.z = 0.15 - i * 0.3;
    g.add(sc);
    g.add(cy(0.012, 0.012, 0.04, C.yellow, 0.57 + i * 0.5, OLD_TOP + 0.0, 0.26, 5));
  }
  A.vine = g;
  A.leaves = leaves;
  return g;
}

// 墙头的玉米串：两串，绳子挂在压顶下
function cornString() {
  const g = new THREE.Group();
  for (let s = 0; s < 2; s++) {
    const bunch = new THREE.Group();
    bunch.position.set(-0.24 + s * 0.48, OLD_TOP + 0.01, FACE + 0.06);
    bunch.add(cy(0.008, 0.008, 0.14, C.tile, 0, -0.05, 0, 4));                   // 吊绳
    bunch.add(b(0.16, 0.03, 0.03, C.tile, 0, -0.12, 0));                         // 绳结
    for (let i = 0; i < 3; i++) {
      const cob = cy(0.036, 0.03, 0.36, C.yellow, (i - 1) * 0.07, -0.33, 0, 7);
      cob.rotation.z = (i - 1) * 0.14;
      bunch.add(cob);
      const husk = b(0.06, 0.2, 0.02, C.sand, (i - 1) * 0.07 - 0.03, -0.17, -0.01);
      husk.rotation.z = (i - 1) * 0.14 + 0.12;
      bunch.add(husk);                                                           // 剥开的苞叶
      bunch.add(b(0.02, 0.05, 0.02, C.sand, (i - 1) * 0.07, -0.5, 0.01));        // 须
    }
    g.add(bunch);
    A.corn.push(bunch);
  }
  return g;
}

// ---------------------------------------------------------------- 李家（西北）
function gable(w, rise, side, thick, color) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, side);
  s.lineTo(0, rise);
  s.lineTo(-w / 2, side);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false });
  const m = new THREE.Mesh(geo, M(color));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// 一片瓦坡：灰瓦底 + 七道瓦行 + 十四道筒瓦（圆的才像瓦）+ 檐口十四片板瓦 + 瓦当
// 旧做法把瓦垄做成扁平长条，远看像彩钢瓦；这里改成"圆脊 + 横course"两层，
// 亮边落在筒瓦上、暗线落在瓦行里，坡面才有瓦的排线。
function roofSlope(dir) {
  const g = new THREE.Group();
  g.position.set(0, 3.24, dir * 1.02);
  g.rotation.x = dir * 0.288;
  g.add(b(6.0, 0.12, 2.24, C.tile, 0, 0, 0));                                    // 瓦坡底（灰瓦）
  // 九道瓦行：横着压过坡面。上一版用"竖扁条 + 暗线"做成网格，看着像彩钢瓦/花架；
  // 这里只留横向的叠瓦缝，竖垄压到极浅（0.012），远看是瓦、近看有层。
  for (let k = 0; k < 9; k++) {
    const z = -0.98 + k * 0.245 + 0.12;
    const row = b(6.0, 0.045, 0.27, k % 3 === 1 ? C.road : C.tile, 0, 0.066, z);
    row.rotation.x = 0.018;
    g.add(row);
    g.add(b(6.0, 0.016, 0.028, C.dark, 0, 0.088, z + 0.115));                     // 叠瓦缝的影
  }
  for (let i = 0; i < 14; i++) {                                                 // 十四道极浅的瓦垄
    g.add(b(0.030, 0.010, 0.16, C.tile, -2.74 + i * 0.421, 0.100, 1.06));        // 只在檐口交代，坡面上不画条
  }
  g.add(b(5.98, 0.10, 0.07, C.tile, 0, 0.02, 1.10));                             // 檐口封板（平直）
  g.add(b(5.98, 0.08, 0.05, C.cream, 0, -0.045, 1.145));                         // 封檐板一道白
  for (let i = 0; i < 14; i++) {                                                 // 檐口十四片板瓦
    const t = b(0.40, 0.045, 0.26, C.tile, -2.78 + i * 0.424, 0.048, 1.13);
    t.rotation.x = -0.10;
    g.add(t);
    const lip = b(0.40, 0.02, 0.03, C.road, -2.78 + i * 0.424, 0.030, 1.255);
    lip.rotation.x = -0.10;
    g.add(lip);
  }
  for (let i = 0; i < 14; i++) {                                                 // 檐口的瓦当
    const d = cy(0.042, 0.042, 0.026, C.road, -2.78 + i * 0.424, 0.028, 1.272, 8);
    d.rotation.x = Math.PI / 2;
    g.add(d);
  }
  for (let i = 0; i < 9; i++) {                                                  // 檐下一排椽子
    g.add(b(0.06, 0.07, 0.9, C.wood, -2.6 + i * 0.65, -0.13, 0.92));
    g.add(b(0.075, 0.02, 0.9, C.sand, -2.6 + i * 0.65, -0.085, 0.92));           // 椽子上的亮边
  }
  g.add(b(0.40, 0.02, 0.44, C.grass, 2.2, 0.112, 0.62));                         // 檐口附近的一小片苔
  g.add(b(0.30, 0.02, 0.28, C.mint, -2.0, 0.112, 0.86));
  return g;
}

function liHouse() {
  const g = new THREE.Group();
  const HW = 5.4, HD = 3.4, HH = 2.86;
  g.add(b(HW + 0.12, 0.30, HD + 0.12, C.tile, 0, 0.15, 0));                      // 石脚
  g.add(b(HW + 0.16, 0.04, HD + 0.16, C.road, 0, 0.32, 0));                      // 石脚压条
  g.add(b(HW, HH - 0.34, HD, C.cream, 0, 0.34 + (HH - 0.34) / 2, 0));            // 白灰墙身
  g.add(b(HW + 0.02, 0.52, HD + 0.02, C.sand, 0, 0.62, 0));                      // 墙裙（浅沙）
  g.add(b(HW + 0.04, 0.05, HD + 0.04, C.tile, 0, 0.90, 0));                      // 墙裙压条
  g.add(b(HW + 0.08, 0.10, HD + 0.08, C.tile, 0, HH + 0.05, 0));                 // 墙顶压一圈
  // ---- 坡屋顶：两片瓦坡 + 脊 + 十四道瓦垄；檐口平直，没有滴水线、没有雨槽
  g.add(roofSlope(1));
  g.add(roofSlope(-1));
  g.add(b(6.04, 0.16, 0.30, C.tile, 0, 3.60, 0));                                // 脊瓦
  g.add(b(6.06, 0.06, 0.36, C.road, 0, 3.395, 0));                               // 脊下压一道
  g.add(b(6.10, 0.05, 0.20, C.road, 0, 3.695, 0));                               // 脊顶的一道亮
  for (const s of [-1, 1]) {                                                     // 两端收一个脊头（不外伸）
    const tip = b(0.22, 0.24, 0.30, C.tile, s * 2.92, 3.615, 0);
    tip.rotation.z = -s * 0.14;
    g.add(tip);
    g.add(b(0.12, 0.06, 0.26, C.road, s * 2.96, 3.735, 0));
  }
  g.add(b(0.44, 0.03, 0.32, C.grass, 2.1, 3.63, 0.06));                          // 脊上的一点苔
  // ---- 山墙：两块五边形，补上"从侧面看进去是一个黑洞"
  for (const s of [-1, 1]) {
    const ge = gable(HD, 0.72, 0.34, 0.12, C.cream);
    ge.rotation.y = s * Math.PI / 2;
    ge.position.set(s * 2.70, HH, 0);
    g.add(ge);
    const trim = b(0.06, 0.06, 1.86, C.tile, s * 2.775, 3.44, 0.58);             // 山墙边一压条
    trim.rotation.x = 0.28;
    g.add(trim);
    const trim2 = b(0.06, 0.06, 1.86, C.tile, s * 2.775, 3.44, -0.58);
    trim2.rotation.x = -0.28;
    g.add(trim2);
    g.add(face(0.5, 0.8, C.tile, s * 2.775, 1.5, 0.6, 0.16));                    // 山墙雨痕
  }
  // ---- 南面：门、窗、檐下
  g.add(b(1.18, 2.24, 0.10, C.tile, 1.92, 1.12, 1.72));                          // 门套
  g.add(b(1.00, 2.10, 0.06, C.wood, 1.92, 1.05, 1.78));                          // 门扇
  g.add(b(0.76, 0.74, 0.02, C.sand, 1.92, 1.58, 1.815));                         // 上凹板
  g.add(b(0.76, 0.58, 0.02, C.sand, 1.92, 0.66, 1.815));                         // 下凹板
  g.add(b(0.62, 0.03, 0.03, C.ink, 2.28, 1.05, 1.83));                           // 门闩
  for (const y of [0.5, 1.62]) {
    g.add(b(0.10, 0.09, 0.03, C.ink, 1.48, y, 1.815));                           // 合页
  }
  g.add(cy(0.045, 0.045, 0.02, C.road, 1.66, 1.02, 1.825, 10));                  // 门环
  g.add(b(1.30, 0.14, 0.52, C.tile, 1.92, 0.07, 1.98));                          // 门槛石
  g.add(b(0.03, 0.02, 0.44, C.dark, 1.92, 0.005, 1.70));                         // 门缝下的一道暗
  g.add(face(0.16, 0.10, C.coral, 1.92, 1.95, 1.822, 0.55));                     // 门楣上的一小片红（年红）
  g.add(cy(0.20, 0.20, 0.025, C.sand, 1.15, 1.95, 1.75, 12));                    // 挂在门边的草帽
  g.add(cy(0.10, 0.08, 0.10, C.wood, 1.15, 1.87, 1.75, 10));
  // 窗：木框 + 亮玻璃 + 五根棂条 + 窗台（玻璃是亮的，不能是一个黑洞）
  g.add(b(1.06, 1.0, 0.08, C.wood, -1.05, 1.84, 1.72));
  g.add(b(0.88, 0.82, 0.05, C.glass, -1.05, 1.84, 1.735));
  for (let i = 0; i < 3; i++) { g.add(b(0.024, 0.82, 0.03, C.wood, -1.31 + i * 0.26, 1.84, 1.765)); }
  for (let i = 0; i < 2; i++) { g.add(b(0.88, 0.024, 0.03, C.wood, -1.05, 1.64 + i * 0.40, 1.765)); }
  g.add(b(1.08, 0.06, 0.16, C.sand, -1.05, 1.33, 1.77));                         // 窗台
  g.add(face(0.7, 0.55, C.tile, -1.05, 0.97, 1.706, 0.13));                      // 窗下的雨痕
  g.add(b(0.36, 0.10, 0.16, C.sand, -1.05, 1.30, 1.79));                         // 窗台上的一只小罐
  // 檐下：一挂辣椒 + 一只竹篮
  for (let i = 0; i < 5; i++) {
    g.add(b(0.05, 0.13, 0.04, C.coral, 2.52, 2.06 - i * 0.12, 1.76));
  }
  g.add(b(0.10, 0.04, 0.04, C.sand, 2.52, 2.12, 1.76));
  g.add(cy(0.14, 0.10, 0.18, C.wood, 2.62, 2.25, 1.72, 10));
  g.add(cy(0.15, 0.15, 0.03, C.tile, 2.62, 2.35, 1.72, 10));
  // 檐下的小坑：没有滴水线，水直接砸下来（f_e09 的依据）
  g.add(decal(0.44, 0.36, C.dark, 0.6, 2.55, 0.012, 0.30));
  g.add(flat(0.26, 0.20, C.blue, 0.6, 0.018, 2.55, 0.30));
  g.add(b(0.16, 0.07, 0.12, C.road, 0.42, 0.035, 2.42));
  // ---- 北面：后门、窗、东山的小窗（NW / NE 两个机位都要有东西看）
  g.add(b(0.88, 1.92, 0.08, C.tile, -1.5, 0.96, -1.73));
  g.add(b(0.76, 1.82, 0.05, C.wood, -1.5, 0.91, -1.78));
  g.add(b(0.74, 0.66, 0.07, C.wood, 1.6, 1.92, -1.73));
  g.add(b(0.62, 0.54, 0.02, C.glass, 1.6, 1.92, -1.745));
  g.add(b(0.80, 0.05, 0.12, C.sand, 1.6, 1.56, -1.77));
  g.add(b(0.70, 0.62, 0.07, C.wood, 2.72, 2.05, -0.4));                          // 东山的窗（NE 机位）
  g.add(b(0.58, 0.48, 0.02, C.glass, 2.745, 2.05, -0.4));
  g.add(cy(0.09, 0.09, 0.02, C.wood, 2.73, 1.3, 0.9, 10));                       // 挂在东山墙的绳圈
  g.add(cy(0.07, 0.07, 0.02, C.wood, 2.73, 1.3, 0.9, 10));
  g.add(face(0.5, 0.9, C.tile, 2.712, 0.7, 1.2, 0.16));                          // 东山墙的雨痕
  return g;
}

function waterJar(full) {
  const g = new THREE.Group();
  g.add(cy(0.38, 0.30, 0.62, C.tile, 0, 0.31, 0, 18));                           // 缸身
  g.add(cy(0.40, 0.40, 0.07, C.tile, 0, 0.655, 0, 18));                          // 缸沿
  g.add(cy(0.34, 0.34, 0.02, C.dark, 0, 0.625, 0, 18));                          // 缸口里的暗
  for (let i = 0; i < 3; i++) {                                                  // 缸身上三道箍
    g.add(cy(0.375 - i * 0.008, 0.365 - i * 0.008, 0.025, C.soil, 0, 0.18 + i * 0.20, 0, 18));
  }
  const water = new THREE.Mesh(new THREE.CircleGeometry(0.335, 20),
    M(C.blue, { transparent: true, opacity: 0.78 }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = full ? 0.60 : 0.33;
  g.add(water);
  const rim = new THREE.Mesh(new THREE.RingGeometry(0.29, 0.335, 20),
    new THREE.MeshBasicMaterial({ color: C.glass, transparent: true, opacity: 0.4, depthWrite: false }));
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = (full ? 0.60 : 0.33) + 0.002;
  g.add(rim);
  if (full) {                                                                    // 满缸里漂一只瓢
    g.add(cy(0.085, 0.085, 0.05, C.sand, 0.06, 0.62, 0.02, 10));
    g.add(cy(0.014, 0.014, 0.30, C.wood, 0.16, 0.68, 0.06, 6));
  } else {                                                                       // 半缸：木盖搁在缸边地上
    const lid = cy(0.37, 0.37, 0.04, C.wood, 0.52, 0.03, 0.18, 16);
    lid.rotation.z = 0.1;
    g.add(lid);
    g.add(b(0.5, 0.03, 0.06, C.sand, 0.52, 0.06, 0.18));
  }
  g.add(decal(1.0, 1.0, C.soil, 0, 0, 0.007, 0.5));                              // 缸脚一圈湿土
  g.add(decal(0.7, 0.7, C.dark, 0, 0.02, 0.008, 0.16));
  g.add(cy(0.44, 0.44, 0.02, C.dark, 0, 0.002, 0, 18));                          // 压在土里的一圈
  A.jars.push(water);
  return g;
}

// 晾衣绳：三件衣服，最下面那件还在滴水
function laundry(len) {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    g.add(cy(0.035, 0.05, 2.10, C.wood, s * len / 2, 1.05, 0, 8));               // 竹竿
    g.add(cy(0.10, 0.12, 0.06, C.tile, s * len / 2, 0.03, 0, 8));                // 竿脚
    g.add(cy(0.05, 0.05, 0.03, C.sand, s * len / 2, 1.42, 0, 8));                // 竹节
    g.add(cy(0.05, 0.05, 0.03, C.sand, s * len / 2, 0.82, 0, 8));
  }
  const rope = cy(0.008, 0.008, len, C.sand, 0, 1.93, 0, 5);                     // 绳
  rope.rotation.z = Math.PI / 2;
  g.add(rope);
  const cloths = [
    { x: -len / 2 + 0.55, w: 0.46, h: 0.50, c: C.white, kind: "shirt" },
    { x: -len / 2 + 1.42, w: 0.48, h: 0.36, c: C.peach, kind: "towel" },
    { x: -len / 2 + 2.30, w: 0.38, h: 0.56, c: C.blue, kind: "pants" }
  ];
  for (let i = 0; i < cloths.length; i++) {
    const d = cloths[i];
    const hang = new THREE.Group();                                              // 以绳为轴，整件摆
    hang.position.set(d.x, 1.93, 0.02);
    const body = b(d.w, d.h, 0.022, d.c, 0, -d.h / 2 - 0.02, 0);
    hang.add(body);
    if (d.kind === "shirt") {
      hang.add(b(0.14, 0.20, 0.02, d.c, -d.w / 2 - 0.05, -0.16, 0));
      hang.add(b(0.14, 0.20, 0.02, d.c, d.w / 2 + 0.05, -0.16, 0));
      hang.add(b(0.16, 0.05, 0.024, C.sand, 0, -0.06, 0.002));                   // 领口
      hang.add(b(d.w - 0.08, 0.02, 0.024, C.sand, 0, -d.h + 0.02, 0.002));       // 下摆压线
      hang.add(b(0.016, d.h - 0.1, 0.024, C.glass, 0.10, -d.h / 2 - 0.02, 0.002)); // 一道褶
      hang.add(b(0.02, 0.02, 0.026, C.glass, -0.14, -0.20, 0.002));              // 一颗扣子
    } else if (d.kind === "towel") {
      for (let k = 0; k < 2; k++) {
        hang.add(b(d.w - 0.06, 0.03, 0.024, C.sand, 0, -0.12 - k * 0.12, 0.002));
      }
      for (let k = 0; k < 5; k++) {                                              // 流苏
        hang.add(b(0.02, 0.05, 0.018, C.sand, -d.w / 2 + 0.06 + k * 0.09, -d.h - 0.03, 0));
      }
    } else {
      hang.add(b(0.15, 0.18, 0.02, d.c, -0.09, -d.h - 0.06, 0));                 // 两条裤腿
      hang.add(b(0.15, 0.18, 0.02, d.c, 0.09, -d.h - 0.06, 0));
      hang.add(b(d.w, 0.04, 0.026, C.sand, 0, -0.03, 0.002));                    // 腰
      hang.add(b(0.016, d.h - 0.12, 0.024, C.glass, -0.06, -d.h / 2, 0.002));    // 裤线
    }
    for (const sx of [-1, 1]) {                                                  // 两只衣夹
      hang.add(b(0.035, 0.09, 0.035, C.wood, sx * (d.w / 2 - 0.02), -0.01, 0.03));
    }
    g.add(hang);
    A.clothes.push({ g: hang, ph: i * 1.7 });
  }
  // 衣角滴水：从最下面那件（裤子）的下摆往下掉
  const hem = ball(0.03, C.glass, -len / 2 + 2.30, 1.20, 0.03, 8);
  hem.material.transparent = true;
  hem.material.opacity = 0.9;
  hem.visible = false;
  g.add(hem);
  A.hemDrop = hem;
  g.add(decal(0.6, 0.5, C.dark, -len / 2 + 2.30, 0.02, 0.01, 0.14));             // 底下那片湿印
  return g;
}

function washBasin() {
  const g = new THREE.Group();
  g.add(cy(0.28, 0.22, 0.16, C.wood, 0, 0.08, 0, 16));                           // 木盆
  g.add(cy(0.27, 0.27, 0.02, C.tile, 0, 0.165, 0, 16));
  g.add(cy(0.24, 0.24, 0.02, C.blue, 0, 0.17, 0, 16));                           // 盆里的水
  g.add(b(0.34, 0.03, 0.12, C.wood, 0.10, 0.19, 0.04));                          // 搓衣板
  g.add(b(0.30, 0.01, 0.05, C.sand, 0.10, 0.205, 0.04));
  g.add(b(0.07, 0.04, 0.05, C.cream, -0.12, 0.19, -0.06));                       // 一块皂
  return g;
}

// 靠墙的小件：筛子、麻袋、两只布鞋、小凳
function sieve() {
  const g = new THREE.Group();
  const hoop = cy(0.36, 0.36, 0.06, C.wood, 0, 0.40, 0.02, 18);
  hoop.rotation.x = Math.PI / 2 - 0.16;
  g.add(hoop);
  const mesh = cy(0.32, 0.32, 0.02, C.sand, 0, 0.40, 0.04, 18);
  mesh.rotation.x = Math.PI / 2 - 0.16;
  g.add(mesh);
  g.add(b(0.50, 0.04, 0.04, C.wood, 0, 0.42, 0.08));                             // 一道横档
  g.add(b(0.12, 0.03, 0.03, C.tile, 0.18, 0.42, 0.09));
  return g;
}

function grainSack() {
  const g = new THREE.Group();
  g.add(b(0.42, 0.50, 0.34, C.sand, 0, 0.25, 0));                                // 袋身
  g.add(b(0.44, 0.06, 0.36, C.soil, 0, 0.48, 0));                                // 袋口一圈
  g.add(b(0.30, 0.14, 0.24, C.sand, 0.02, 0.55, 0));                             // 折下来的袋口
  g.add(b(0.40, 0.02, 0.32, C.tile, 0, 0.34, 0.172));                            // 一道缝线
  g.add(b(0.10, 0.06, 0.06, C.soil, -0.16, 0.53, 0.1));                          // 撒出来的一小撮
  g.add(b(0.34, 0.36, 0.30, C.sand, 0.44, 0.18, 0.12));                          // 第二袋歪着
  g.add(b(0.30, 0.05, 0.10, C.sand, 0.50, 0.38, 0.12));
  return g;
}

function shoes() {
  const g = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const s = b(0.11, 0.06, 0.24, C.ink, i * 0.14, 0.03, i * 0.02);
    s.rotation.y = i * 0.2;
    g.add(s);
    g.add(b(0.10, 0.02, 0.10, C.tile, i * 0.14, 0.065, -0.05));                  // 鞋帮
  }
  return g;
}

function stool() {
  const g = new THREE.Group();
  g.add(b(0.34, 0.05, 0.28, C.wood, 0, 0.30, 0));                                // 凳面
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(b(0.04, 0.30, 0.04, C.wood, sx * 0.13, 0.15, sz * 0.10));
  }
  g.add(b(0.28, 0.03, 0.03, C.wood, 0, 0.12, 0.10));
  g.add(b(0.28, 0.03, 0.03, C.wood, 0, 0.12, -0.10));
  return g;
}

// 院角的石磨：磨盘 + 上扇 + 推杆，旁边一只接面的木盆
function stoneMill() {
  const g = new THREE.Group();
  g.add(cy(0.58, 0.62, 0.12, C.tile, 0, 0.06, 0, 20));                           // 磨台
  g.add(cy(0.52, 0.52, 0.16, C.road, 0, 0.20, 0, 20));                           // 下扇
  g.add(cy(0.40, 0.40, 0.14, C.road, 0, 0.35, 0, 20));                           // 上扇
  g.add(cy(0.12, 0.12, 0.16, C.tile, 0, 0.36, 0, 12));                           // 磨眼
  g.add(cy(0.42, 0.42, 0.02, C.sand, 0, 0.425, 0, 20));                          // 上扇顶面
  for (let i = 0; i < 8; i++) {                                                  // 上扇的八道凿痕
    const a = i * 0.785;
    g.add(b(0.05, 0.015, 0.16, C.tile, Math.cos(a) * 0.28, 0.432, Math.sin(a) * 0.28));
  }
  const handle = cy(0.035, 0.035, 0.9, C.wood, 0.5, 0.45, 0.1, 6);               // 推杆
  handle.rotation.z = Math.PI / 2 - 0.1;
  g.add(handle);
  g.add(b(0.08, 0.08, 0.08, C.tile, 0.85, 0.47, 0.12));
  g.add(decal(1.4, 1.4, C.soil, 0, 0, 0.007, 0.35));                             // 磨盘下扫不净的土
  g.add(cy(0.32, 0.28, 0.26, C.wood, -0.70, 0.13, 0.42, 14));                    // 接面的木盆
  g.add(cy(0.30, 0.30, 0.03, C.sand, -0.70, 0.27, 0.42, 14));
  g.add(b(0.12, 0.08, 0.10, C.cream, -0.70, 0.30, 0.42));                        // 盆里的一点面
  return g;
}

function broom() {
  const g = new THREE.Group();
  const pole = cy(0.018, 0.018, 1.5, C.wood, 0, 0.75, 0, 6);
  pole.rotation.x = -0.16;                                                       // 靠在墙上
  g.add(pole);
  for (let i = 0; i < 7; i++) {                                                  // 扫帚头
    const s = b(0.02, 0.30, 0.02, C.sand, 0.12 + (i % 3) * 0.03, 0.15, -0.06 + i * 0.02);
    s.rotation.z = 0.2;
    g.add(s);
  }
  g.add(b(0.09, 0.05, 0.09, C.tile, 0.12, 0.31, 0));
  return g;
}

function bambooLadder() {
  const g = new THREE.Group();
  const l = new THREE.Group();
  l.rotation.z = 0.20;                                                           // 靠在山墙上
  for (const s of [-1, 1]) {
    l.add(cy(0.03, 0.03, 2.5, C.wood, s * 0.19, 1.25, 0, 6));
  }
  for (let i = 0; i < 6; i++) {                                                  // 六道横档
    const r = cy(0.022, 0.022, 0.4, C.sand, 0, 0.35 + i * 0.36, 0, 6);
    r.rotation.z = Math.PI / 2;
    l.add(r);
  }
  g.add(l);
  return g;
}

function rainBarrel() {
  const g = new THREE.Group();
  g.add(cy(0.34, 0.30, 0.86, C.wood, 0, 0.43, 0, 16));                           // 桶身
  g.add(cy(0.36, 0.36, 0.06, C.tile, 0, 0.86, 0, 16));                           // 桶沿
  g.add(cy(0.30, 0.30, 0.02, C.blue, 0, 0.83, 0, 16));                           // 雨水
  for (const y of [0.24, 0.62]) {                                                // 两道箍
    g.add(cy(0.345, 0.345, 0.035, C.road, 0, y, 0, 16));
  }
  g.add(b(0.30, 0.04, 0.30, C.tile, 0, 0.90, 0.02));                             // 木盖斜搭
  g.add(decal(0.9, 0.9, C.dark, 0, 0.01, 0.006, 0.16));
  return g;
}

// 墙北面挂的几件：木橛 + 挂着的篮子 / 筛子 / 绳
function wallPegs() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const x = -1.5 + i * 0.8;
    const peg = cy(0.02, 0.02, 0.18, C.wood, x, 1.16, -0.08, 5);                 // 木橛
    peg.rotation.x = Math.PI / 2;
    g.add(peg);
  }
  const basket = new THREE.Group();                                              // 挂着的篮子
  basket.position.set(-1.5, 1.02, -0.16);
  basket.add(cy(0.14, 0.10, 0.20, C.wood, 0, -0.12, 0, 12));
  basket.add(cy(0.15, 0.15, 0.03, C.tile, 0, -0.02, 0, 12));
  basket.add(cy(0.012, 0.012, 0.12, C.wood, 0, 0.06, 0, 5));
  g.add(basket);
  const coil = new THREE.Group();                                                // 一盘绳
  coil.position.set(-0.7, 1.0, -0.1);
  for (let i = 0; i < 3; i++) {
    coil.add(cy(0.10, 0.10, 0.03, C.sand, 0, -i * 0.04, 0, 12));
  }
  g.add(coil);
  g.add(b(0.02, 0.16, 0.02, C.sand, -0.7, 1.1, -0.1));                           // 绳头
  const sieve2 = new THREE.Group();                                              // 挂着的筛子
  sieve2.position.set(0.1, 0.98, -0.12);
  sieve2.rotation.x = -0.1;
  sieve2.add(cy(0.24, 0.24, 0.04, C.wood, 0, 0, 0, 16));
  sieve2.add(cy(0.21, 0.21, 0.02, C.sand, 0, 0.02, 0, 16));
  g.add(sieve2);
  return g;
}

// 靠在墙北面的一张草席
function strawMat() {
  const g = new THREE.Group();
  const m = b(1.1, 0.9, 0.05, C.sand, 0, 0.48, 0);
  m.rotation.x = -0.16;
  g.add(m);
  for (let i = 0; i < 4; i++) {
    g.add(b(1.06, 0.02, 0.06, C.soil, 0, 0.12 + i * 0.24, 0.02));
  }
  return g;
}

// 鸡窝：稻草窝 + 两只蛋，放在屋角的檐下
function nestBox() {
  const g = new THREE.Group();
  g.add(b(0.62, 0.26, 0.46, C.wood, 0, 0.13, 0));                                // 木箱
  g.add(b(0.66, 0.05, 0.50, C.tile, 0, 0.265, 0));                               // 箱沿
  g.add(cy(0.22, 0.20, 0.08, C.sand, 0, 0.28, 0, 14));                           // 草窝
  g.add(ball(0.055, C.white, -0.06, 0.30, 0.02, 8));                             // 两只蛋
  g.add(ball(0.055, C.white, 0.06, 0.30, -0.03, 8));
  g.add(b(0.70, 0.03, 0.52, C.soil, 0, 0.012, 0));                               // 底下垫的土
  return g;
}

// 屋前到院子的几块石板（把空地分出"走人的"和"不走的"）
function stonePath() {
  const g = new THREE.Group();
  const pts = [[0, 0], [0.52, -0.06], [1.02, 0.04], [1.5, 0.28], [1.9, 0.66]];
  for (let i = 0; i < pts.length; i++) {
    const s = b(0.46, 0.035, 0.40, i % 2 ? C.road : C.tile, pts[i][0], 0.018, pts[i][1]);
    s.rotation.y = (i % 3) * 0.12 - 0.1;
    g.add(s);
    g.add(flat(0.5, 0.44, C.dark, pts[i][0], 0.006, pts[i][1], 0.12));
  }
  return g;
}

// 北边的竹篱笆：把院子的后边界收住（也是底座后缘的收边）
function bambooFence(len) {
  const g = new THREE.Group();
  const n = Math.round(len / 0.30);
  for (let i = 0; i <= n; i++) {
    const x = -len / 2 + i * (len / n);
    const h = 1.06 + jit(i) * 0.10;
    g.add(cy(0.038, 0.034, h, i % 2 ? C.wood : C.sand, x, h / 2, 0, 6));
    g.add(cy(0.042, 0.042, 0.02, C.tile, x, h * 0.62, 0, 6));                    // 竹节
    const tip = cy(0.030, 0.02, 0.06, C.sand, x, h + 0.03, 0, 5);
    g.add(tip);
  }
  for (let k = 0; k < 3; k++) {                                                  // 三道横档
    const rail = cy(0.026, 0.026, len, C.wood, 0, 0.28 + k * 0.34, -0.05, 6);
    rail.rotation.z = Math.PI / 2;
    g.add(rail);
  }
  for (let k = 0; k < 6; k++) {                                                  // 五处草绳捆扎
    g.add(cy(0.032, 0.032, 0.05, C.sand, -len / 2 + 0.5 + k * (len / 6), 0.96, -0.05, 6));
  }
  g.add(decal(len, 0.5, C.grass, 0, 0.04, 0.008, 0.28));                         // 篱笆根的一线草
  return g;
}

// ---------------------------------------------------------------- 张家（东南）
function cabbage(i) {
  const g = new THREE.Group();
  // 外圈六片深叶（压得低），内圈五片浅叶，中心一个菜心：三档明度才读得出"一棵菜"
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3 + i * 0.4;
    const leaf = ball(0.165, C.grass, Math.cos(a) * 0.19, 0.085, Math.sin(a) * 0.19, 8);
    leaf.scale.set(1.40, 0.30, 1.05);
    leaf.rotation.y = a;
    leaf.rotation.z = 0.10;
    g.add(leaf);
  }
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.9 + i * 0.4;
    const leaf = ball(0.125, C.mint, Math.cos(a) * 0.10, 0.155, Math.sin(a) * 0.10, 8);
    leaf.scale.set(1.15, 0.34, 0.95);
    leaf.rotation.y = a;
    g.add(leaf);
  }
  const head = ball(0.105, C.mint, 0, 0.195, 0, 10);
  head.scale.y = 0.85;
  g.add(head);
  g.add(cy(0.09, 0.12, 0.06, C.tile, 0, 0.03, 0, 8));                            // 根脚
  return g;
}

function vegetablePlot() {
  const g = new THREE.Group();
  // 地块：整块翻过的地（有床、有埂），三垄压在床里 —— 没有这一步，三条垄会像一只木箱
  g.add(b(2.96, 0.03, 2.06, C.soil, 0, 0.015, 0));                               // 地床
  g.add(b(3.02, 0.05, 0.07, C.soil, 0, 0.03, -1.02));                            // 四边地埂
  g.add(b(3.02, 0.05, 0.07, C.soil, 0, 0.03, 1.02));
  g.add(b(0.07, 0.05, 2.04, C.soil, -1.46, 0.03, 0));
  g.add(b(0.07, 0.05, 2.04, C.soil, 1.46, 0.03, 0));
  g.add(b(3.04, 0.016, 0.04, C.tile, 0, 0.056, -1.05));                          // 地埂北侧的一道影
  for (let r = 0; r < 3; r++) {                                                  // 三垄
    const z = -0.60 + r * 0.60;
    g.add(b(2.56, 0.13, 0.40, C.soil, 0, 0.075, z));                             // 垄身（湿土）
    g.add(b(2.46, 0.025, 0.31, C.soil, 0, 0.152, z));                            // 垄顶干一层
    g.add(b(2.50, 0.012, 0.05, C.dark, 0, 0.136, z + 0.19));                     // 垄边的一道湿
    if (r < 2) {                                                                 // 垄沟
      g.add(b(2.56, 0.014, 0.13, C.tile, 0, 0.040, z + 0.30));
      g.add(b(2.56, 0.006, 0.02, C.dark, 0, 0.050, z + 0.30));
    }
    for (let k = 0; k < 4; k++) {                                                // 垄边的碎土
      g.add(b(0.10, 0.05, 0.07, k % 2 ? C.tile : C.soil,
        -1.1 + k * 0.72, 0.025, z + 0.24 * (k % 2 ? 1 : -1)));
    }
  }
  for (let r = 0; r < 3; r++) {                                                  // 六棵白菜
    for (let c = 0; c < 2; c++) {
      const cab = cabbage(r * 2 + c);
      cab.position.set(-0.62 + c * 1.24, 0.16, -0.60 + r * 0.60);
      cab.rotation.y = (r * 2 + c) * 0.7;
      cab.scale.setScalar(0.95 + (r + c) % 2 * 0.08);
      g.add(cab);
    }
  }
  // 东头泡过水：深色土 + 一层极薄的亮（不是蓝条）
  g.add(flat(0.62, 1.12, C.dark, 0.9, 0.02, 0, 0.28));
  g.add(flat(0.42, 0.66, C.glass, 0.92, 0.024, -0.1, 0.14));
  g.add(b(0.04, 0.02, 1.12, C.tile, 1.24, 0.03, 0));
  g.add(b(0.16, 0.03, 0.06, C.soil, -0.95, 0.035, -0.94));                       // 翻出来的一截草根
  g.add(b(0.10, 0.02, 0.05, C.grass, 0.3, 0.035, -0.9));
  return g;
}

// 李家檐下的两垄小菜地：北院那半块空地不能真的空着
function smallPlot() {
  const g = new THREE.Group();
  g.add(b(1.94, 0.03, 1.34, C.soil, 0, 0.015, 0));                               // 地床
  g.add(b(2.00, 0.05, 0.06, C.tile, 0, 0.03, -0.66));
  g.add(b(2.00, 0.05, 0.06, C.tile, 0, 0.03, 0.66));
  g.add(b(0.06, 0.05, 1.32, C.tile, -0.97, 0.03, 0));
  g.add(b(0.06, 0.05, 1.32, C.tile, 0.97, 0.03, 0));
  for (let r = 0; r < 2; r++) {
    const z = -0.33 + r * 0.66;
    g.add(b(1.62, 0.11, 0.34, C.tile, 0, 0.07, z));
    g.add(b(1.54, 0.02, 0.26, C.soil, 0, 0.13, z));
  }
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      const cab = cabbage(r * 3 + c);
      cab.position.set(-0.50 + c * 0.50, 0.14, -0.33 + r * 0.66);
      cab.rotation.y = (r * 3 + c) * 0.9;
      cab.scale.setScalar(0.72);
      g.add(cab);
    }
  }
  g.add(b(0.30, 0.02, 0.12, C.sand, -0.6, 0.04, 0.58));                          // 掉在地头的一小把草
  return g;
}

// 檐下的劈柴垛：断面朝外，前面留一条走道
function firewoodStack() {
  const g = new THREE.Group();
  for (let r = 0; r < 3; r++) {
    const n = 5 - (r % 2);
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 0.21;
      const y = 0.10 + r * 0.16;
      const log = cy(0.085, 0.08, 0.95, C.wood, x, y, 0, 7);
      log.rotation.x = Math.PI / 2;
      g.add(log);
      g.add(cy(0.078, 0.078, 0.012, C.sand, x, y, 0.485, 7));                    // 断面
      g.add(cy(0.045, 0.045, 0.014, C.soil, x, y, 0.492, 7));                    // 髓心
    }
  }
  g.add(b(1.0, 0.05, 0.06, C.tile, 0, 0.48, -0.2));                              // 压顶的一根横木
  g.add(b(0.05, 0.09, 0.95, C.tile, -0.48, 0.20, 0));                            // 两端的挡木
  g.add(b(0.05, 0.09, 0.95, C.tile, 0.48, 0.20, 0));
  g.add(decal(1.3, 0.9, C.wood, 0, 0.01, 0.006, 0.16));
  return g;
}

function woodPile() {
  const g = new THREE.Group();
  for (let r = 0; r < 3; r++) {
    const n = 4 - r;
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 0.30 + (r % 2 ? 0.14 : 0);
      const y = 0.15 + r * 0.255;
      const log = cy(0.14, 0.135, 0.96, C.tile, x, y, 0, 9);                     // 树皮（深）
      log.rotation.x = Math.PI / 2;                                              // 断口朝外（+z）
      g.add(log);
      g.add(b(0.27, 0.02, 0.9, C.soil, x, y + 0.13, 0));                         // 树皮上的一道裂
      for (const s of [-1, 1]) {                                                 // 两端的断口
        const cap = cy(0.132, 0.132, 0.03, C.sand, x, y, s * 0.48, 9);           // 断面（浅）
        cap.rotation.x = Math.PI / 2;
        g.add(cap);
        g.add(cy(0.095, 0.095, 0.006, C.soil, x, y, s * 0.497, 9));              // 年轮圈
        g.add(cy(0.05, 0.05, 0.008, C.tile, x, y, s * 0.499, 9));                // 年轮心
      }
    }
  }
  // 塑料布：薄薄一层压在垛顶，前面垂下一角（能看见下面的木头）
  const top = new THREE.Mesh(new THREE.PlaneGeometry(1.40, 0.78),
    M(C.glass, { transparent: true, opacity: 0.18, side: THREE.DoubleSide }));
  top.rotation.x = -Math.PI / 2 + 0.07;
  top.position.set(0.02, 0.86, -0.04);
  g.add(top);
  const flap = new THREE.Mesh(new THREE.PlaneGeometry(1.40, 0.36),
    M(C.glass, { transparent: true, opacity: 0.18, side: THREE.DoubleSide }));
  flap.rotation.x = -0.34;
  flap.position.set(0.02, 0.74, 0.52);
  g.add(flap);
  g.add(b(0.05, 0.02, 0.78, C.glass, 0.42, 0.88, -0.04));                        // 布上的折痕
  g.add(b(0.04, 0.06, 0.04, C.sand, -0.60, 0.88, 0.26));                         // 压布的土块
  g.add(b(0.04, 0.05, 0.04, C.tile, 0.54, 0.87, -0.30));
  g.add(decal(1.7, 1.4, C.wood, 0, 0, 0.006, 0.14));                             // 树皮屑
  for (let i = 0; i < 6; i++) {                                                  // 掉在脚边的柴枝
    g.add(b(0.03, 0.03, 0.28, C.tile, -0.9 + i * 0.28, 0.02, 0.52 + (i % 2) * 0.16));
  }
  return g;
}

function axeBlock() {
  const g = new THREE.Group();
  g.add(cy(0.24, 0.26, 0.28, C.wood, 0, 0.14, 0, 14));                           // 砧木
  g.add(cy(0.25, 0.25, 0.02, C.sand, 0, 0.29, 0, 14));
  g.add(cy(0.12, 0.12, 0.01, C.tile, 0.02, 0.30, 0.02, 12));                     // 砍痕
  const handle = cy(0.022, 0.022, 0.50, C.wood, 0.02, 0.52, -0.04, 6);
  handle.rotation.x = 0.28;
  g.add(handle);
  const head = b(0.16, 0.12, 0.05, C.road, 0.02, 0.31, 0.07);                    // 斧头
  head.rotation.x = 0.28;
  g.add(head);
  g.add(b(0.04, 0.04, 0.06, C.tile, 0.02, 0.34, 0.06));
  return g;
}

function hoe() {
  const g = new THREE.Group();
  const h = cy(0.03, 0.03, 1.5, C.wood, 0, 0.78, 0, 8);                          // 木柄
  h.rotation.z = 0.30;
  h.rotation.x = 0.10;
  g.add(h);
  const blade = b(0.26, 0.20, 0.04, C.road, -0.24, 0.12, 0.04);                  // 锄板，插在土里
  blade.rotation.z = 0.30;
  g.add(blade);
  g.add(b(0.24, 0.03, 0.06, C.tile, -0.24, 0.21, 0.04));
  g.add(decal(0.5, 0.4, C.dark, -0.24, 0.04, 0.008, 0.28));                      // 翻出来的湿土
  return g;
}

function footprint() {
  const g = new THREE.Group();
  g.add(decal(0.17, 0.30, C.dark, 0, 0.01, 0.008, 0.4));                         // 脚掌
  for (let i = 0; i < 4; i++) {
    g.add(decal(0.04, 0.05, C.dark, -0.06 + i * 0.04, 0.01, 0.009, 0.34));       // 四个趾
  }
  g.add(decal(0.08, 0.06, C.dark, 0, -0.13, 0.009, 0.30));                       // 脚跟
  return g;
}

// ---------------------------------------------------------------- 环境
function oldTree() {
  const g = new THREE.Group();
  g.add(cy(0.46, 0.56, 0.40, C.tile, 0, 0.20, 0, 12));                           // 根部土包
  g.add(cy(0.30, 0.44, 2.50, C.tile, 0, 1.25, 0, 12));                           // 主干
  g.add(cy(0.23, 0.28, 1.00, C.tile, 0, 2.62, 0, 10));
  // 树皮：八片竖着的薄板，树干才不是一根光圆柱
  for (let i = 0; i < 8; i++) {
    const a = i * 0.785 + 0.2;
    const plate = b(0.14, 1.7, 0.05, i % 3 ? C.wood : C.tile,
      Math.cos(a) * 0.27, 1.35, Math.sin(a) * 0.27);
    plate.rotation.y = -a;
    g.add(plate);
  }
  for (let i = 0; i < 5; i++) {                                                  // 露出来的根
    const a = i * 1.257 + 0.3;
    const rt = cy(0.11, 0.045, 0.70, C.tile, Math.cos(a) * 0.44, 0.13, Math.sin(a) * 0.44, 7);
    rt.rotation.z = 1.35;
    rt.rotation.y = -a;
    g.add(rt);
    g.add(ball(0.11, C.tile, Math.cos(a) * 0.68, 0.07, Math.sin(a) * 0.68, 7));
  }
  for (let i = 0; i < 3; i++) {                                                  // 三根主枝
    const a = -0.7 + i * 1.5;
    const br = cy(0.13, 0.05, 1.6, C.tile, Math.cos(a) * 0.55, 3.0, Math.sin(a) * 0.55, 7);
    br.rotation.z = 0.72 * Math.cos(a);
    br.rotation.x = -0.72 * Math.sin(a);
    g.add(br);
    const br2 = cy(0.08, 0.035, 0.9, C.tile, Math.cos(a) * 1.0, 3.35, Math.sin(a) * 1.0, 6);
    br2.rotation.z = 0.95 * Math.cos(a);
    br2.rotation.x = -0.95 * Math.sin(a);
    g.add(br2);
  }
  const canopy = new THREE.Group();
  for (let i = 0; i < 16; i++) {                                                 // 树冠：十六团
    const a = i * 0.71;
    const r = 0.34 + (i % 4) * 0.36;
    const bl = ball(0.52 - (i % 3) * 0.05, i % 6 ? C.grass : C.mint,
      Math.cos(a) * r, 3.18 + (i % 5) * 0.16, Math.sin(a) * r, 10);
    bl.scale.set(1.2, 0.66, 1.2);
    canopy.add(bl);
  }
  for (let i = 0; i < 3; i++) {                                                  // 三团压低的下垂枝
    const a = 2.2 + i * 2.2;
    const low = ball(0.40, C.grass, Math.cos(a) * 1.10, 2.52 - i * 0.06, Math.sin(a) * 1.10, 9);
    low.scale.set(1.3, 0.5, 1.3);
    canopy.add(low);
  }
  g.add(canopy);
  A.canopy = canopy;
  g.add(decal(2.4, 2.2, C.grass, 0, 0.02, 0.006, 0.30));                         // 树下的草
  g.add(decal(1.5, 1.3, C.dark, 0, 0.04, 0.007, 0.16));
  g.add(decal(1.0, 0.9, C.mint, 0.3, 0.03, 0.005, 0.16));
  return g;
}

// 院外第二棵小树（远树）：高度 2.4，只给 NE 那个空角一点纵深
function smallTree() {
  const g = new THREE.Group();
  g.add(cy(0.10, 0.15, 1.55, C.tile, 0, 0.78, 0, 8));
  g.add(cy(0.06, 0.055, 0.6, C.tile, 0.18, 1.55, 0.06, 6));
  g.children[1].rotation.z = -0.5;
  const canopy = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9;
    const r = 0.22 + (i % 3) * 0.22;
    const bl = ball(0.34, i % 4 ? C.grass : C.mint, Math.cos(a) * r, 1.72 + (i % 3) * 0.16, Math.sin(a) * r, 9);
    bl.scale.set(1.15, 0.7, 1.15);
    canopy.add(bl);
  }
  g.add(canopy);
  g.add(decal(1.1, 1.0, C.grass, 0, 0.02, 0.006, 0.26));
  return g;
}

function bambooBasket() {
  const g = new THREE.Group();
  g.add(cy(0.27, 0.20, 0.34, C.wood, 0, 0.17, 0, 14));                           // 筐身
  g.add(cy(0.29, 0.29, 0.04, C.tile, 0, 0.35, 0, 14));                           // 筐沿
  g.add(cy(0.22, 0.22, 0.02, C.sand, 0, 0.345, 0, 14));                          // 筐里
  for (let i = 0; i < 10; i++) {                                                 // 十根竹篾
    const a = (i / 10) * Math.PI * 2;
    const s = b(0.028, 0.33, 0.012, i % 2 ? C.wood : C.sand,
      Math.cos(a) * 0.245, 0.17, Math.sin(a) * 0.245);
    s.rotation.y = -a;
    s.rotation.x = 0.10;
    g.add(s);
  }
  for (const sx of [-1, 1]) {                                                    // 提梁的两根立柱
    g.add(b(0.03, 0.24, 0.03, C.wood, sx * 0.19, 0.46, 0));
  }
  const handle = cy(0.014, 0.014, 0.42, C.wood, 0, 0.575, 0, 6);                 // 提梁
  handle.rotation.z = Math.PI / 2;
  g.add(handle);
  g.add(ball(0.10, C.sand, -0.08, 0.36, 0.04, 8));                               // 筐里两个芋头
  g.add(ball(0.085, C.soil, 0.09, 0.36, -0.03, 8));
  return g;
}

function chicken(tone) {
  const g = new THREE.Group();
  const body = ball(0.21, tone, 0, 0.31, 0, 12);
  body.scale.set(1.10, 0.95, 1.45);
  g.add(body);
  const neck = cy(0.075, 0.105, 0.22, tone, 0, 0.42, 0.13, 8);                   // 脖子（头才有来处）
  neck.rotation.x = -0.38;
  g.add(neck);
  const head = new THREE.Group();                                                // 头：以脖子为轴低头
  head.position.set(0, 0.50, 0.19);
  head.add(ball(0.10, tone, 0, 0.02, 0.02, 10));
  head.add(b(0.05, 0.035, 0.10, C.yellow, 0, -0.005, 0.11));                     // 喙
  head.add(b(0.035, 0.07, 0.05, C.coral, 0, 0.095, 0.02));                       // 冠
  head.add(b(0.028, 0.05, 0.03, C.coral, 0, -0.045, 0.085));                     // 肉垂
  head.add(ball(0.014, C.ink, 0.042, 0.045, 0.070, 6));                          // 眼
  head.add(ball(0.014, C.ink, -0.042, 0.045, 0.070, 6));
  g.add(head);
  for (let i = 0; i < 3; i++) {                                                  // 尾翎三片
    const t = b(0.03, 0.26, 0.20, tone, (i - 1) * 0.03, 0.42, -0.30);
    t.rotation.x = 0.70;
    t.rotation.z = (i - 1) * 0.25;
    g.add(t);
  }
  for (const s of [-1, 1]) {                                                     // 翅
    const w = ball(0.13, tone, s * 0.19, 0.32, -0.02, 8);
    w.scale.set(0.5, 0.8, 1.1);
    g.add(w);
    g.add(cy(0.016, 0.016, 0.20, C.yellow, s * 0.06, 0.10, 0.03, 6));            // 腿
    g.add(b(0.05, 0.02, 0.10, C.yellow, s * 0.06, 0.012, 0.07));                 // 爪
  }
  g.rotation.y = -0.6;
  return { g, head, body };
}

function weeds(n, spread) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const h = 0.20 + jit(i) * 0.24;
    const w = cy(0.012, 0.005, h, i % 2 ? C.grass : C.mint,
      (jit(i + 3) - 0.5) * spread, h / 2, (jit(i + 5) - 0.5) * spread * 0.5, 5);
    w.rotation.z = (jit(i + 7) - 0.5) * 0.55;
    w.rotation.x = (jit(i + 9) - 0.5) * 0.3;
    g.add(w);
  }
  return g;
}

function litter(n, wide, deep, seed) {
  const g = new THREE.Group();
  const cols = [C.wood, C.grass, C.brick];
  for (let i = 0; i < n; i++) {
    g.add(flat(0.11 + jit(i + seed) * 0.07, 0.07 + jit(i + seed + 2) * 0.05,
      cols[(i + seed) % 3],
      (jit(i + seed + 4) - 0.5) * wide, 0.01 + i * 0.0006,
      (jit(i + seed + 6) - 0.5) * deep, 0.62, jit(i + seed + 8) * 3));
  }
  return g;
}

function brokenTile() {
  const g = new THREE.Group();
  g.add(b(0.30, 0.035, 0.20, C.tile, 0, 0.02, 0));
  g.add(b(0.14, 0.03, 0.12, C.road, 0.12, 0.03, 0.06));                          // 断掉的另一半
  g.add(decal(0.4, 0.3, C.dark, 0, 0.01, 0.006, 0.14));
  return g;
}

function brickStack() {
  const g = new THREE.Group();
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 5 - r; i++) {
      const x = -0.44 + i * 0.22 + (r % 2 ? 0.11 : 0);
      g.add(b(0.20, 0.07, 0.10, C.brick, x, 0.035 + r * 0.075, 0));
      g.add(b(0.205, 0.008, 0.105, C.soil, x, 0.073 + r * 0.075, 0));
    }
  }
  for (let i = 0; i < 3; i++) {                                                  // 三块散的
    const s = b(0.20, 0.07, 0.10, C.brick, 0.50 + i * 0.06, 0.035, 0.28 + i * 0.05);
    s.rotation.y = i * 0.5;
    g.add(s);
  }
  g.add(b(0.12, 0.07, 0.10, C.brick, -0.60, 0.035, 0.30));                       // 半块
  g.add(decal(1.3, 0.9, C.sand, 0, 0.01, 0.006, 0.20));                          // 撒出来的灰
  return g;
}

function mortarTrough() {
  const g = new THREE.Group();
  g.add(b(0.84, 0.18, 0.44, C.tile, 0, 0.09, 0));                                // 灰槽
  g.add(b(0.76, 0.03, 0.36, C.sand, 0, 0.175, 0));                               // 灰浆
  g.add(b(0.10, 0.03, 0.30, C.road, 0.24, 0.20, 0.06));                          // 抹子
  g.add(b(0.20, 0.02, 0.06, C.sand, 0.24, 0.185, 0.06));                         // 抹子上的灰
  const h = b(0.04, 0.16, 0.04, C.wood, 0.34, 0.24, 0.06);
  h.rotation.z = -0.5;
  g.add(h);
  g.add(b(0.30, 0.12, 0.20, C.brick, -0.50, 0.06, 0.20));                        // 垫着的两块砖
  g.add(decal(1.1, 0.7, C.sand, 0, 0.01, 0.006, 0.18));
  return g;
}

function sandPile() {
  const g = new THREE.Group();
  const m = ball(0.62, C.sand, 0, 0.14, 0, 12);
  m.scale.set(1.25, 0.42, 1.0);
  g.add(m);
  const m2 = ball(0.40, C.sand, 0.35, 0.12, 0.20, 10);
  m2.scale.set(1.0, 0.40, 0.9);
  g.add(m2);
  const shovel = cy(0.022, 0.022, 1.2, C.wood, -0.50, 0.55, 0.16, 6);            // 插在沙堆上的铁锹
  shovel.rotation.z = 0.34;
  g.add(shovel);
  const blade = b(0.24, 0.30, 0.03, C.road, -0.78, 0.20, 0.16);
  blade.rotation.z = 0.34;
  g.add(blade);
  g.add(decal(1.7, 1.3, C.sand, 0, 0.01, 0.006, 0.18));
  return g;
}

// 一摞新瓦：施工到一半的证据
function tileStack() {
  const g = new THREE.Group();
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 4; i++) {
      g.add(b(0.24, 0.035, 0.34, r % 2 ? C.tile : C.road,
        -0.30 + i * 0.20, 0.04 + r * 0.04, 0));
    }
  }
  const one = b(0.24, 0.035, 0.34, C.tile, 0.45, 0.045, 0.16);
  one.rotation.y = 0.5;
  g.add(one);
  g.add(decal(0.9, 0.6, C.sand, 0, 0.01, 0.006, 0.16));
  return g;
}

function roadStone(i) {
  const g = new THREE.Group();
  const r = 0.14 + i * 0.03;
  const s = ball(r, i % 2 ? C.road : C.tile, 0, r * 0.55, 0, 8);
  s.scale.set(1.2, 0.7, 1.0);
  g.add(s);
  g.add(decal(r * 2.6, r * 2.2, C.dark, 0, 0.01, 0.006, 0.2));
  return g;
}

// 路边的一堆稻草：三层码起来的草垛 + 四面支出来的草 + 一道捆绳
// 一整颗光滑的球会读成石头；分层 + 毛边才读成"草"。
function strawPile() {
  const g = new THREE.Group();
  const lay = [[0.44, 0.19, C.sand], [0.36, 0.16, C.soil], [0.27, 0.14, C.sand]];
  for (let i = 0; i < 3; i++) {
    const [r, h, col] = lay[i];
    g.add(cy(r, r * 1.12, h, col, 0, 0.095 + i * 0.155, 0, 14));
    g.add(cy(r * 0.98, r * 1.10, 0.02, i % 2 ? C.sand : C.soil, 0, 0.19 + i * 0.155, 0, 14));
  }
  g.add(ball(0.17, C.sand, 0, 0.53, 0, 10));                                     // 顶上一撮
  for (let i = 0; i < 22; i++) {                                                 // 四面支出来的草
    const a = i * 0.9;
    const rr = 0.30 + (i % 4) * 0.06;
    const s = b(0.016, 0.016, 0.22 + jit(i) * 0.12, i % 3 ? C.soil : C.sand,
      Math.cos(a) * rr, 0.10 + (i % 4) * 0.13, Math.sin(a) * rr);
    s.rotation.y = -a;
    s.rotation.z = (jit(i + 3) - 0.5) * 0.7;
    g.add(s);
  }
  g.add(cy(0.455, 0.455, 0.035, C.tile, 0, 0.24, 0, 16));                        // 一道捆绳
  g.add(b(0.05, 0.05, 0.9, C.wood, -0.34, 0.09, 0.12));                          // 压草的一根木杆
  g.add(decal(1.6, 1.2, C.soil, 0, 0.01, 0.006, 0.16));
  return g;
}

function vergeStones() {
  const g = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const s = ball(0.09 + (i % 3) * 0.03, i % 2 ? C.road : C.tile,
      -5.2 + i * 1.7, 0.05, (i % 2) * 0.16, 7);
    s.scale.set(1.3, 0.7, 1.0);
    g.add(s);
  }
  return g;
}

function bucket() {
  const g = new THREE.Group();
  g.add(cy(0.17, 0.13, 0.30, C.blue, 0, 0.15, 0, 14));
  g.add(cy(0.175, 0.175, 0.03, C.road, 0, 0.305, 0, 14));
  g.add(cy(0.15, 0.15, 0.02, C.blue, 0, 0.30, 0, 14));                           // 半桶水
  const h = cy(0.012, 0.012, 0.34, C.road, 0, 0.42, 0, 6);                       // 提梁
  h.rotation.z = Math.PI / 2;
  g.add(h);
  return g;
}

// 一根斜靠在新墙上的竹竿（挑水/支棚用）
function bambooPole() {
  const g = new THREE.Group();
  const pole = new THREE.Group();
  pole.rotation.x = -0.42;
  pole.add(cy(0.045, 0.038, 1.85, C.wood, 0, 0.92, 0, 8));
  for (let i = 0; i < 4; i++) {
    pole.add(cy(0.05, 0.05, 0.03, C.sand, 0, 0.30 + i * 0.44, 0, 8));            // 竹节
  }
  g.add(pole);
  g.add(decal(0.5, 0.4, C.dark, 0, 0.01, 0.006, 0.14));
  return g;
}

// 贴地晨雾：一片软边的雾面（shader 做径向衰减，没有硬边，也不用任何贴图）
function fogPatch(color, op) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOp: { value: op } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "uniform vec3 uColor; uniform float uOp; varying vec2 vUv;" +
      "void main(){ float d = length(vUv - 0.5) * 2.0;" +
      "float a = smoothstep(1.0, 0.1, d) * uOp; gl_FragColor = vec4(uColor, a); }",
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
}

function fogBank(n) {
  const g = new THREE.Group();
  const cols = [C.white, C.glass, C.white, C.glass, C.white, C.glass];
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(10 + i * 1.4, 4.8 + (i % 3) * 1.0),
      fogPatch(cols[i], 0.15 + (i % 3) * 0.02));
    m.rotation.x = -Math.PI / 2;
    m.position.set(-6.4 + i * 2.7, 0.13 + (i % 3) * 0.05, -1.6 + (i % 4) * 2.5);
    g.add(m);
    A.fog.push({ m, x0: m.position.x, z0: m.position.z, ph: i * 1.3 });
  }
  return g;
}

// ---------------------------------------------------------------- 场景数据
// 布局：院墙沿 x 轴，z = 0.15。北侧(-z) = 李家，南侧(+z) = 张家。
// 一层：土路 / 菜地 / 湿土；二层：院墙 / 界石 / 排水沟；三层：屋檐 / 柴垛 / 水缸 / 晾衣。
const P_B = { x: 0.55, z: 1.32 };          // 张守义的站位：界石西南侧的空地（两格内可走）

const props = [
  // ---- 地面：草地打底（siteColor），院前空地、土路、李家院子、菜地四块纯色铺开。
  //      靠明度差分格，不铺深色大块（深块一多，画面就碎成拼贴）。
  { id: "g_yard", x: 1.7, z: 3.0, w: 9.0, d: 4.8, passable: true,
    build: () => ground(9.0, 4.8, 0, 0, null, C.soil, 0.004) },
  { id: "g_yardWet", x: 0.2, z: 0.95, w: 2.2, d: 0.8, passable: true,
    build: () => flat(2.2, 0.8, C.tile, 0, 0.012, 0, 0.34) },
  { id: "g_worn", x: 1.0, z: 3.1, w: 0.9, d: 2.8, passable: true,
    build: () => {
      const g = new THREE.Group();
      g.add(flat(1.1, 2.5, C.sand, 0, 0.014, 0, 0.30));
      g.add(flat(0.62, 1.5, C.sand, 0.22, 0.016, -0.55, 0.26, 0.12));
      return g;
    } },
  { id: "g_yardEdge", x: -2.9, z: 2.2, w: 0.9, d: 2.6, passable: true,
    build: () => {
      const g = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        g.add(flat(0.7 - (i % 2) * 0.2, 0.7, C.grass, -0.1 + (i % 3) * 0.12,
          0.012 + i * 0.0006, -1.0 + i * 0.62, 0.42, i * 0.7));
      }
      return g;
    } },
  { id: "g_liYard", x: -3.35, z: -1.85, w: 9.2, d: 3.4, passable: true,
    build: () => ground(9.2, 3.4, 0, 0, null, C.soil, 0.0042) },
  { id: "g_liWet", x: -5.2, z: -0.62, w: 2.6, d: 0.9, passable: true,
    build: () => flat(2.6, 0.9, C.tile, 0, 0.012, 0, 0.42) },
  { id: "g_liPath", x: -3.6, z: -2.7, w: 2.2, d: 0.5, passable: true,
    build: () => flat(2.2, 0.5, C.sand, 0, 0.013, 0, 0.28) },
  { id: "g_road", x: 0, z: 7.05, w: 16.4, d: 3.2, passable: true,
    build: () => ground(16.4, 3.2, 0, 0, null, C.sand, 0.005) },
  { id: "g_roadShade", x: 0, z: 8.55, w: 16.4, d: 0.5, passable: true,
    build: () => flat(16.4, 0.5, C.soil, 0, 0.011, 0, 0.28) },
  { id: "g_verge", x: 0, z: 4.95, w: 16.4, d: 0.95, passable: true,
    build: () => ground(16.4, 0.95, 0, 0, null, C.grass, 0.0055) },
  { id: "g_rut1", x: -0.3, z: 6.35, w: 14.4, d: 0.18, passable: true,
    build: () => flat(14.4, 0.18, C.tile, 0, 0.012, 0, 0.32) },
  { id: "g_rut2", x: -0.1, z: 7.75, w: 14.4, d: 0.18, passable: true,
    build: () => flat(14.4, 0.18, C.tile, 0, 0.012, 0, 0.30) },
  { id: "g_roadPuddle", x: -3.2, z: 7.0, w: 1.7, d: 0.8, passable: true,
    build: () => {
      const g = new THREE.Group();
      g.add(flat(1.5, 0.66, C.blue, 0, 0.013, 0, 0.26));
      g.add(flat(0.9, 0.34, C.glass, -0.1, 0.015, 0, 0.20));
      g.add(decal(2.0, 1.0, C.dark, 0, 0.011, 0.012, 0.16));
      return g;
    } },
  { id: "g_grassE", x: 8.3, z: -1.6, w: 2.2, d: 3.2, passable: true,
    build: () => ground(2.2, 3.2, 0, 0, null, C.grass, 0.005) },
  { id: "g_grassW", x: -7.9, z: 3.6, w: 2.4, d: 3.2, passable: true,
    build: () => ground(2.4, 3.2, 0, 0, null, C.grass, 0.005) },
  { id: "g_grassN", x: 2.4, z: -7.6, w: 12.4, d: 2.6, passable: true,
    build: () => ground(12.4, 2.6, 0, 0, null, C.grass, 0.0052) },

  // ---- 院墙
  { id: "s_wallOld", x: OLD_X, z: Z_W, w: OLD_L, d: T_W,
    build: () => wallRun(OLD_L, OLD_H, C.road, C.sand, C.cream),
    interact: { x: -2.2, z: 1.45 } },
  { id: "s_wallNew", x: NEW_X, z: Z_W, w: NEW_L, d: T_W,
    build: () => wallRun(NEW_L, NEW_H, C.brick, C.sand, C.cream),
    interact: { x: 2.9, z: 1.45 } },
  { id: "s_wallEave", x: NEW_X, z: Z_W, w: 7.3, d: 0.72, passable: true,
    build: () => eaveTiles(7.3) },
  { id: "s_wallPier", x: 8.58, z: Z_W, w: 0.62, d: 0.68, build: wallPier },
  { id: "s_wallFoot", x: -2.6, z: Z_W, w: 6.4, d: 0.3, passable: true, build: wallFooting },
  { id: "s_wallMark", x: 2.6, z: Z_W, w: 1.2, d: 0.1, passable: true, build: newWallMarks },
  { id: "s_vine", x: -0.9, z: Z_W, w: 3.4, d: 0.5, passable: true, build: squashVine },
  { id: "s_corn", x: -1.2, z: Z_W, w: 0.9, d: 0.3, passable: true, build: cornString },
  { id: "s_hang", x: -3.30, z: Z_W, w: 1.4, d: 0.2, passable: true,
    build: () => {
      const g = new THREE.Group();
      for (const dx of [-0.52, 0.52]) {                                          // 两根木橛
        const peg = cy(0.02, 0.02, 0.16, C.wood, dx, 1.16, FACE - 0.03, 5);
        peg.rotation.x = Math.PI / 2;
        g.add(peg);
      }
      const braid = new THREE.Group();                                           // 一挂蒜辫
      braid.position.set(-0.52, 1.08, FACE + 0.03);
      braid.add(cy(0.01, 0.01, 0.14, C.tile, 0, 0.06, 0, 4));
      for (let i = 0; i < 7; i++) {
        const a = i * 1.3;
        braid.add(ball(0.052, C.white, Math.cos(a) * 0.045, -i * 0.075, 0.02 + Math.sin(a) * 0.03, 7));
        braid.add(ball(0.020, C.sand, Math.cos(a) * 0.05, -i * 0.075 + 0.045, 0.03 + Math.sin(a) * 0.03, 5));
      }
      g.add(braid);
      const pan = new THREE.Group();                                             // 一个挂着的簸箕
      pan.position.set(0.46, 0.98, FACE + 0.04);
      const bowl = cy(0.24, 0.19, 0.06, C.wood, 0, 0, 0, 14);
      bowl.rotation.x = Math.PI / 2 - 0.30;
      pan.add(bowl);
      const inner = cy(0.20, 0.16, 0.02, C.sand, 0, 0.01, 0, 14);
      inner.rotation.x = Math.PI / 2 - 0.30;
      pan.add(inner);
      pan.add(b(0.32, 0.03, 0.04, C.tile, 0, -0.24, -0.02));
      g.add(pan);
      return g;
    } },
  { id: "s_pegs", x: -0.9, z: Z_W - 0.2, w: 2.4, d: 0.4, passable: true, build: wallPegs },
  { id: "s_mat", x: -2.9, z: -0.25, w: 1.2, d: 0.2, passable: true, build: strawMat },

  // ---- 争议点：界石（旧砖与新砖的接缝上）、排水沟（砖砌封堵）
  { id: "s_stone", x: 1.34, z: 0.66, w: 0.8, d: 0.5, rot: 0.06, build: boundaryStone,
    interact: { x: 1.15, z: 1.60 } },
  { id: "s_ditch", x: -2.12, z: 0.60, w: 5.15, d: 0.56, build: () => ditch(5.15),
    interact: { x: -1.2, z: 1.55 } },
  { id: "s_drip", x: 4.55, z: 0.42, w: 0.1, d: 0.1, passable: true,
    build: () => {
      const g = new THREE.Group();
      g.add(b(0.50, 0.06, 0.40, C.tile, 0, 0.03, 0.02));                         // 墙根的青石
      g.add(cy(0.10, 0.10, 0.012, C.dark, 0, 0.062, 0.02, 14));                  // 被砸出来的小坑
      g.add(cy(0.12, 0.12, 0.008, C.road, 0, 0.058, 0.02, 14));
      g.add(flat(0.9, 0.76, C.blue, 0, 0.014, 0.02, 0.24));                      // 水洼
      g.add(flat(0.6, 0.48, C.glass, -0.06, 0.016, 0.02, 0.22));
      g.add(decal(1.2, 1.0, C.dark, 0, 0.012, 0.012, 0.16));
      const drop = ball(0.036, C.glass, 0, 1.60, 0.02, 8);                       // 那滴水
      drop.material.transparent = true;
      drop.material.opacity = 0.92;
      drop.visible = false;
      g.add(drop);
      A.drop = drop;
      for (let i = 0; i < 3; i++) {                                              // 三圈涟漪
        const geo = new THREE.RingGeometry(0.42, 0.5, 24);
        geo.rotateX(-Math.PI / 2);
        const r = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
          color: C.white, transparent: true, opacity: 0, depthWrite: false
        }));
        r.position.set(0, 0.03, 0.02);
        r.visible = false;
        g.add(r);
        A.rings.push(r);
      }
      return g;
    } },

  // ---- 李家（北侧）：屋身一角、新檐、水缸、晾衣、竹竿、院墙
  { id: "s_house", x: -5.6, z: -5.3, w: 5.4, d: 3.4, build: liHouse },
  { id: "s_yardWallW", x: -8.55, z: -2.15, w: 0.32, d: 4.6,
    build: () => {
      const g = new THREE.Group();
      g.add(b(0.32, 1.26, 4.6, M(C.white, { map: brickMap(C.road, C.sand, 4.6, 1.26) }), 0, 0.16 + 0.63, 0));
      g.add(b(0.42, 0.16, 4.68, C.tile, 0, 0.08, 0));
      g.add(b(0.46, 0.05, 4.70, C.road, 0, 0.185, 0));
      g.add(b(0.44, 0.09, 4.70, C.tile, 0, 1.465, 0));
      g.add(b(0.36, 0.045, 4.62, C.road, 0, 1.532, 0));
      g.add(decal(0.6, 4.2, C.grass, 0.22, 0.02, 0.008, 0.26));                  // 墙根的苔
      return g;
    } },
  { id: "s_mill", x: -6.9, z: -1.15, w: 1.3, d: 1.3, build: stoneMill },
  { id: "s_jar1", x: -3.15, z: -2.55, w: 0.9, d: 0.9, build: () => waterJar(true) },
  { id: "s_jar2", x: -2.35, z: -1.72, w: 0.9, d: 0.9, build: () => waterJar(false) },
  { id: "s_laundry", x: -6.4, z: -2.32, w: 2.9, d: 0.2, passable: true,
    build: () => laundry(2.9) },
  { id: "s_basin", x: -6.2, z: -2.95, w: 0.6, d: 0.6, passable: true, build: washBasin },
  { id: "s_bench", x: -7.7, z: -3.15, w: 1.0, d: 0.38, build: () => {
    const g = new THREE.Group();
    g.add(b(1.0, 0.07, 0.34, C.wood, 0, 0.42, 0));                               // 凳面
    for (const s of [-1, 1]) { g.add(b(0.08, 0.40, 0.30, C.wood, s * 0.40, 0.21, 0)); }
    g.add(b(0.86, 0.05, 0.05, C.wood, 0, 0.16, 0));                              // 横撑
    g.add(b(0.30, 0.02, 0.30, C.sand, 0.10, 0.455, 0));                          // 摊着的布
    return g;
  } },
  { id: "s_broom", x: -4.75, z: -3.42, w: 0.3, d: 0.2, passable: true, build: broom },
  { id: "s_sieve", x: -6.95, z: -3.4, w: 0.4, d: 0.2, passable: true, build: sieve },
  { id: "s_sack", x: -3.75, z: -2.75, w: 0.6, d: 0.5, build: grainSack },
  { id: "s_shoes", x: -3.0, z: -3.32, w: 0.3, d: 0.3, passable: true, build: shoes },
  { id: "s_stool", x: -7.15, z: -2.55, w: 0.4, d: 0.34, passable: true, build: stool },
  { id: "s_ladder", x: -2.42, z: -4.8, w: 0.5, d: 0.3, build: bambooLadder },
  { id: "s_barrel", x: -2.95, z: -7.35, w: 0.72, d: 0.72, build: rainBarrel },
  { id: "s_nest", x: -2.85, z: -3.55, w: 0.66, d: 0.5, build: nestBox },
  { id: "s_pole", x: -5.4, z: 1.05, w: 0.24, d: 0.24, passable: true, build: bambooPole },
  { id: "s_hat", x: -3.6, z: 0.9, w: 0.44, d: 0.44, passable: true,
    build: () => {
      const g = new THREE.Group();
      g.add(cy(0.22, 0.22, 0.02, C.sand, 0, 0.02, 0, 16));
      g.add(cy(0.11, 0.09, 0.10, C.wood, 0, 0.08, 0, 12));
      return g;
    } },
  { id: "s_fence", x: -3.6, z: -8.35, w: 10.6, d: 0.14, build: () => bambooFence(10.6) },
  { id: "s_path", x: -3.9, z: -2.4, w: 2.4, d: 1.2, passable: true, build: stonePath },

  // ---- 张家（南侧）：菜地、柴垛、锄头、湿土脚印
  { id: "s_field", x: 3.6, z: 4.15, w: 2.8, d: 1.9, build: vegetablePlot,
    interact: { x: 3.6, z: 2.85 } },
  { id: "s_wood", x: 7.4, z: 3.1, w: 1.5, d: 1.1, build: woodPile,
    interact: { x: 6.0, z: 2.6 } },
  { id: "s_axe", x: 7.85, z: 1.85, w: 0.5, d: 0.5, passable: true, build: axeBlock },
  { id: "s_hoe", x: 1.95, z: 4.55, w: 0.5, d: 0.4, passable: true, build: hoe },
  { id: "s_bucket", x: 2.15, z: 3.25, w: 0.4, d: 0.4, passable: true, build: bucket },
  { id: "s_print1", x: 4.3, z: 3.0, w: 0.3, d: 0.5, passable: true, build: footprint },
  { id: "s_print2", x: 4.55, z: 3.5, w: 0.3, d: 0.5, passable: true,
    build: () => { const g = footprint(); g.rotation.y = 0.5; return g; } },
  { id: "s_print3", x: 2.0, z: 1.2, w: 0.3, d: 0.5, passable: true,
    build: () => { const g = footprint(); g.rotation.y = -0.4; return g; } },
  { id: "s_print4", x: 1.28, z: 2.25, w: 0.3, d: 0.5, passable: true,
    build: () => { const g = footprint(); g.rotation.y = 0.2; return g; } },

  // ---- 东北：新砖院墙的"现场"（剩砖、灰槽、沙堆、一摞新瓦）
  { id: "s_bricks", x: 7.15, z: -1.25, w: 1.2, d: 0.8, build: brickStack },
  { id: "s_mortar", x: 5.95, z: -0.95, w: 0.9, d: 0.5, passable: true, build: mortarTrough },
  { id: "s_sand", x: 7.45, z: -3.15, w: 1.4, d: 1.0, build: sandPile },
  { id: "s_tiles", x: 6.15, z: -2.35, w: 1.1, d: 0.7, build: tileStack },
  { id: "s_plotN", x: 1.35, z: -6.30, w: 2.0, d: 1.4, build: smallPlot },
  { id: "s_woodN", x: 3.55, z: -7.25, w: 1.1, d: 1.0, build: firewoodStack },
  { id: "s_treeN", x: 7.05, z: -5.55, w: 1.1, d: 1.1, build: smallTree },
  { id: "s_stonesN", x: 5.30, z: -8.00, w: 1.2, d: 0.5, passable: true, build: () => {
    const g = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const s = ball(0.13 + (i % 3) * 0.05, i % 2 ? C.road : C.tile,
        -0.4 + i * 0.26, 0.07, (i % 2) * 0.16, 7);
      s.scale.set(1.25, 0.65, 1.0);
      g.add(s);
    }
    g.add(decal(1.4, 0.7, C.dark, 0, 0.01, 0.006, 0.16));
    return g;
  } },

  // ---- 环境：老树、竹筐、路边石、落叶、野草、碎瓦、鸡
  { id: "s_tree", x: -8.0, z: 4.3, w: 1.7, d: 1.7, build: oldTree },
  { id: "s_basket", x: -5.4, z: 5.9, w: 0.6, d: 0.6, passable: true, build: bambooBasket },
  { id: "s_vergeStones", x: 0, z: 4.85, w: 12.0, d: 0.4, passable: true, build: vergeStones },
  { id: "s_roadStones3", x: 5.4, z: 6.7, w: 0.9, d: 0.5, passable: true, build: () => {
    const g = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const s = ball(0.10 + (i % 3) * 0.04, i % 2 ? C.road : C.tile,
        -0.3 + i * 0.2, 0.05, (i % 2) * 0.14, 7);
      s.scale.set(1.3, 0.7, 1.0);
      g.add(s);
    }
    return g;
  } },
  { id: "s_straw", x: 4.95, z: 7.95, w: 1.4, d: 1.0, build: strawPile },
  { id: "s_roadStone4", x: -6.2, z: 8.3, w: 0.4, d: 0.3, passable: true,
    build: () => roadStone(3) },
  { id: "s_weed6", x: -7.0, z: 5.3, w: 0.6, d: 0.3, passable: true, build: () => weeds(6, 0.6) },
  { id: "s_rut3", x: 2.4, z: 7.0, w: 4.2, d: 0.16, passable: true, rot: 0.09,
    build: () => flat(4.2, 0.16, C.dark, 0, 0.012, 0, 0.16) },
  { id: "s_puddle2", x: 1.2, z: 6.2, w: 0.9, d: 0.4, passable: true,
    build: () => {
      const g = new THREE.Group();
      g.add(flat(0.8, 0.34, C.blue, 0, 0.013, 0, 0.22));
      g.add(flat(0.4, 0.16, C.glass, -0.1, 0.015, 0, 0.24));
      return g;
    } },
  { id: "s_litter5", x: 2.2, z: 7.6, w: 2.4, d: 1.2, passable: true, build: () => litter(7, 2.4, 1.2, 13) },
  { id: "s_roadStone1", x: -1.2, z: 8.45, w: 0.4, d: 0.3, passable: true,
    build: () => roadStone(1) },
  { id: "s_roadStone2", x: 2.7, z: 5.35, w: 0.3, d: 0.3, passable: true,
    build: () => roadStone(2) },
  { id: "s_litter1", x: -0.6, z: 3.3, w: 2.6, d: 1.4, passable: true, build: () => litter(9, 2.6, 1.4, 1) },
  { id: "s_litter2", x: 5.8, z: 1.5, w: 2.2, d: 1.2, passable: true, build: () => litter(7, 2.2, 1.2, 4) },
  { id: "s_litter3", x: -5.0, z: 4.2, w: 2.4, d: 1.2, passable: true, build: () => litter(8, 2.4, 1.2, 7) },
  { id: "s_litter4", x: -4.4, z: -2.0, w: 2.2, d: 1.0, passable: true, build: () => litter(6, 2.2, 1.0, 10) },
  { id: "s_weed1", x: -6.4, z: 0.34, w: 0.7, d: 0.3, passable: true, build: () => weeds(6, 0.6) },
  { id: "s_weed2", x: 0.5, z: 0.34, w: 0.7, d: 0.3, passable: true, build: () => weeds(5, 0.55) },
  { id: "s_weed3", x: 7.7, z: 0.9, w: 0.7, d: 0.3, passable: true, build: () => weeds(6, 0.6) },
  { id: "s_weed4", x: 3.9, z: -0.2, w: 0.6, d: 0.3, passable: true, build: () => weeds(4, 0.5) },
  { id: "s_weed5", x: -8.2, z: -0.6, w: 0.6, d: 0.3, passable: true, build: () => weeds(5, 0.5) },
  { id: "s_tuft1", x: -8.4, z: 1.4, w: 0.6, d: 0.4, passable: true, build: () => weeds(7, 0.7) },
  { id: "s_tuft2", x: 8.4, z: 2.4, w: 0.6, d: 0.4, passable: true, build: () => weeds(6, 0.6) },
  { id: "s_tuft3", x: 0.4, z: -3.2, w: 0.6, d: 0.4, passable: true, build: () => weeds(5, 0.55) },
  { id: "s_tile1", x: 5.9, z: 2.2, w: 0.4, d: 0.3, passable: true, build: brokenTile },
  { id: "s_tile2", x: -2.0, z: 4.5, w: 0.4, d: 0.3, passable: true,
    build: () => { const g = brokenTile(); g.rotation.y = 1.1; return g; } },
  { id: "s_hen1", x: -2.7, z: 2.2, w: 0.4, d: 0.4, passable: true,
    build: () => { const h = chicken(C.cream); A.hens.push({ head: h.head, body: h.body, ph: 0, per: 6.3 }); return h.g; } },
  { id: "s_hen2", x: -1.55, z: 2.9, w: 0.4, d: 0.4, passable: true,
    build: () => {
      const h = chicken(C.wood);
      h.g.rotation.y = 2.1;
      A.hens.push({ head: h.head, body: h.body, ph: 3.4, per: 8.1 });
      return h.g;
    } },
  { id: "s_bush1", x: 5.6, z: -3.4, w: 0.8, d: 0.8, passable: true,
    build: () => bush(0, 0, 0.34, C.grass, C.grass) },
  { id: "s_bush2", x: 8.3, z: -1.5, w: 0.8, d: 0.8, passable: true,
    build: () => bush(0, 0, 0.30, C.grass, C.grass) },
  { id: "s_bush3", x: -8.6, z: 6.6, w: 0.8, d: 0.8, passable: true,
    build: () => bush(0, 0, 0.32, C.grass, C.mint) },
  { id: "s_bush4", x: -0.2, z: -7.9, w: 0.8, d: 0.8, passable: true,
    build: () => bush(0, 0, 0.30, C.grass, C.grass) },
  { id: "s_edge1", x: -2.80, z: 1.85, w: 0.5, d: 1.7, passable: true, build: () => weeds(7, 0.5) },
  { id: "s_edge2", x: 5.55, z: 2.10, w: 0.5, d: 1.4, passable: true, build: () => weeds(6, 0.5) },
  { id: "s_edge3", x: -4.60, z: 5.42, w: 1.2, d: 0.4, passable: true, build: () => weeds(7, 0.9) },
  { id: "s_edge4", x: 6.80, z: 5.42, w: 1.2, d: 0.4, passable: true, build: () => weeds(6, 0.9) },
  { id: "s_fog", x: 0, z: 0, w: 0.1, d: 0.1, passable: true, build: () => fogBank(6) }
];

// 障碍：院墙、屋身、柴垛、菜地、界石、排水沟、树；地面贴片全部 passable
const obstacles = props.filter((p) => !p.passable).map((p) => ({ x: p.x, z: p.z, w: p.w, d: p.d }));

// 关键人物：两人隔墙相对（§4.2）。李秀兰在李家檐下的门边，张守义在界石旁的空地上。
// 张守义的站位不能贴墙：goToPerson 会停在人物前 1.5 处，太近就与主角同格，A* 给不出路。
const characters = [
  { id: "p_a", label: "李秀兰", name: "李秀兰", role: "报案人",
    x: -3.45, z: -3.12, facing: 1.05, pose: "stand",
    color: C.peach, pants: C.dark, hair: "#3a2c22" },
  { id: "p_b", label: "张守义", name: "张守义", role: "被投诉人",
    x: P_B.x, z: P_B.z, facing: 2.27, pose: "stand",
    color: C.navy, pants: C.tile, hair: "#8d8579" }
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
    // 底座三层出边 + 外景：模型落在一片同色的晨雾里，不是悬在虚空
    baseColor: C.cream, baseSideColor: C.navy, siteColor: C.grass,
    terrainSideColor: C.tile,
    outer: true, outerColor: C.glass,
    // 清晨：天顶冷青、地平线一线暖。主光暖白但压暗，天光（hemi）偏冷，
    // 阴影因此是青的、受光面才带一点暖——而不是整场都泡在一层奶黄里。
    skyTop: C.blue, skyMid: C.glass, skyBottom: C.cream,
    light: { sun: C.peach, sunI: 2.20, fill: C.blue, fillI: 0.80, hemi: 0.46,
             hemiSky: C.glass, hemiGround: C.tile, exposure: 0.86 },
    fogDensity: 0.011,
    actor: { x: 0.6, z: 5.4 },
    camYaw: 0.42, camPitch: 0.64, camDist: 20, camFocus: [0, 1.15, 0.6],
    walk: { x0: -8.1, x1: 8.2, z0: 0.8, z1: 8.6 },
    onSpot: (p) => { (window.__events = window.__events || []).push(["spot", p.id]); },
    onPerson: (p) => { (window.__events = window.__events || []).push(["person", p.id]); },
    onArrived: (p) => { (window.__events = window.__events || []).push(["arrived", +p.x.toFixed(2), +p.z.toFixed(2)]); },
    onSeat: (p) => { (window.__events = window.__events || []).push(["seat", p.id]); },
    // ---- 基础动效：12 条，幅度全部 2% 量级
    onFrame: (t) => {
      // ① 屋檐滴水：每 3 秒一滴，从瓦口落到墙根的青石上
      if (A.drop) {
        const ph = t % 3;
        if (ph < 0.42) {
          const k = ph / 0.42;
          A.drop.visible = true;
          A.drop.position.y = 1.58 - k * k * 1.50;
          A.drop.scale.setScalar(0.8 + k * 0.5);
        } else {
          A.drop.visible = false;
        }
        // ② 涟漪：落地后 0.8 秒扩散一圈（三圈错开，接得上）
        const q = (ph - 0.42) / 0.8;
        for (let i = 0; i < A.rings.length; i++) {
          const qq = q - i * 0.26;
          const on = qq >= 0 && qq <= 1;
          A.rings[i].visible = on;
          if (on) {
            const s = 0.16 + qq * 0.92;
            A.rings[i].scale.set(s, 1, s);
            A.rings[i].material.opacity = 0.46 * (1 - qq);
          }
        }
      }
      // ③ 沟里的水极缓地往东流（0.05 单位/秒），流到封堵处就没了
      for (const f of A.flow) {
        const run = (t * 0.05 + f.o) % 2.4;
        f.m.position.x = -2.35 + run;
        f.m.material.opacity = 0.34 * Math.sin((run / 2.4) * Math.PI);
      }
      // ④ 封堵处打一个小旋：0.55 弧度/秒 + 2% 的呼吸
      if (A.swirl) {
        A.swirl.rotation.y = t * 0.55;
        A.swirl.scale.setScalar(1 + Math.sin(t * 1.3) * 0.02);
      }
      // ⑤ 丝瓜藤的叶轻晃 0.025 弧度（每片错开相位，整条藤也跟着走一点）
      if (A.vine) { A.vine.rotation.z = Math.sin(t * 0.63) * 0.025; }
      for (const lf of A.leaves) {
        lf.m.position.y = lf.y + Math.sin(t * 0.9 + lf.ph) * 0.006;
        lf.m.scale.y = 0.5 + Math.sin(t * 0.75 + lf.ph) * 0.02;
      }
      // ⑥ 晾着的三件衣服轻摆
      for (const c of A.clothes) {
        c.g.rotation.z = Math.sin(t * 1.05 + c.ph) * 0.025;
        c.g.rotation.x = Math.sin(t * 0.72 + c.ph * 0.6) * 0.012;
      }
      // ⑦ 最下面那件还在滴水：每 4.5 秒一滴
      if (A.hemDrop) {
        const q = (t % 4.5) / 0.5;
        if (q < 1) {
          A.hemDrop.visible = true;
          A.hemDrop.position.y = 1.22 - q * q * 1.18;
        } else {
          A.hemDrop.visible = false;
        }
      }
      // ⑧ 贴地薄雾横移 0.02 单位/秒，走到边上就绕回来
      for (const f of A.fog) {
        f.m.position.x = f.x0 + ((t * 0.02) % 12);
        if (f.m.position.x > 11) { f.m.position.x -= 22; }
        f.m.material.uniforms.uOp.value = 0.14 + 0.03 * Math.sin(t * 0.4 + f.ph);
      }
      // ⑨ 老树树冠被风吹动：整团摆 0.02 弧度
      if (A.canopy) {
        A.canopy.rotation.z = Math.sin(t * 0.55) * 0.02;
        A.canopy.rotation.x = Math.sin(t * 0.41 + 1.1) * 0.012;
      }
      // ⑩ 两只鸡偶尔低头啄一下，不位移
      for (const h of A.hens) {
        const q = (t + h.ph) % h.per;
        const a = q < 1.0 ? Math.sin(q * Math.PI) : 0;
        h.head.rotation.x = a * 0.62;
        h.body.rotation.x = a * 0.05;
        h.body.position.y = 0.30 + Math.sin(a * Math.PI) * 0.012;
      }
      // ⑪ 墙头的玉米串轻轻摆 0.018 弧度
      for (let i = 0; i < A.corn.length; i++) {
        A.corn[i].rotation.x = Math.sin(t * 0.7 + i * 1.3) * 0.018;
        A.corn[i].rotation.z = Math.sin(t * 0.53 + i) * 0.012;
      }
      // ⑫ 两只水缸的水面：极缓的一圈呼吸，2%
      for (let i = 0; i < A.jars.length; i++) {
        const k = 1 + Math.sin(t * 1.1 + i * 1.9) * 0.02;
        A.jars[i].scale.set(k, 1, k);
      }
    }
  });
} catch (err) {
  window.__err = String((err && err.stack) || err);
}

window.__mini = scene;

// 与训练台的事件桥（§6）。消息统一带 { source: "mini3d", type, payload }。
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
