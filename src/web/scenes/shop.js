// S7 · 村口小卖部（上午 10:30）—— 王彩凤的证词
// -----------------------------------------------------------------------------
// 按 docs/场景与人物建模提示词.md v5 §3 S7 重做（2026-11-04，质量第一）。
//   ① 只用 PAL 那 15 个颜色（brickTex 的两个色值也从 PAL 取）；
//   ② 大件自动描边（kit.b 已经做了）；
//   ③ 没有任何噪点贴图：砖用 brickTex 两色错缝，地面用纯色 + 几何分格；
//   ④ 四格：西北遮阳伞+鸡蛋筐 / 东北长凳+歪脖子树+啤酒箱 /
//           西南冰柜+台阶+拖鞋 / 东南柜台+货架；
//   ⑤ 视觉中心是长凳上的王彩凤，次中心是半开卷帘门里那一格暖光；
//   ⑥ onFrame 里挂 10 条 2% 量级的循环动效。
//
// 门脸的构造要点：房子是一个实心盒，门洞不是"挖"出来的——门里的内衬
// 必须画在墙面前面（local z ≈ 1.82~2.0，world z ≈ 1.72~1.9），再让卷帘门
// 挡住上半格、门框挡住四边，才读得成一个"凹进去的亮着灯的屋子"。
// -----------------------------------------------------------------------------
import * as THREE from "./vendor/three.module.min.js";
import {
  PAL as C, M, b, cy, ball, decal, ground, bush,
  tex, brickTex, soilTex, grassTex
} from "./kit.js";
import { createScene } from "./scene3d.js";

window.__err = "";
window.addEventListener("error", (e) => {
  window.__err = (e.message || "error") + " @ " + (e.filename || "") + ":" + (e.lineno || 0);
});

// ---------------------------------------------------------------- 动画句柄
// 每个 build 里把要动的部件挂到这里，onFrame 统一驱动（幅度全部 2% 量级）
const A = {
  led: null, lid: null, parasolFlap: null,
  curtains: [], leaves: [], hand: null, handBase: null,
  matCorner: null, matBase: 0, signGlow: null,
  swallow: null, wings: [], flyer: null, flyerBase: 0,
  bulb: null, bulbBase: 0, clothes: []
};

// ---------------------------------------------------------------- 材质与零件
// 同色共用一份材质：几百个色块也只有十几份材质，绘制调用不会被材质数量拖爆
const _mats = new Map();
function mt(col) {
  let m = _mats.get(col);
  if (!m) { m = M(col); _mats.set(col, m); }
  return m;
}
// 发光面（灯珠、灯管、指示灯）
function glow(col, k) {
  return M(col, { emissive: col, emissiveIntensity: k });
}
// 透明件（玻璃、门帘）：不投影，否则整块玻璃会在柜台上压出一块黑
function glass(w, h, d, x, y, z, op = 0.4, col = C.glass) {
  const m = b(w, h, d, M(col, { transparent: true, opacity: op, depthWrite: false }), x, y, z);
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}
// 两点之间的圆杆：树枝、秤杆吊绳、凳子斜撑都用它，比一节节圆柱自然
function rod(ax, ay, az, bx, by, bz, r, col, seg = 8) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz) || 0.001;
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg),
    typeof col === "string" ? mt(col) : col);
  m.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(dx, dy, dz).normalize());
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
// 折线圆管：电线、晾衣绳、拴狗绳
function cord(pts, r, col, seg = 20) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, seg, r, 5, false), mt(col));
  m.castShadow = true;
  return m;
}
// 墙面纸片（告示、海报）：板 + 边框 + 一角
function notice(w, h, x, y, z, ry = 0) {
  const g = new THREE.Group();
  g.add(b(w + 0.04, h + 0.04, 0.018, mt(C.coral), 0, 0, 0));
  g.add(b(w, h, 0.02, mt(C.cream), 0, 0, 0.012));
  for (let i = 0; i < 4; i++) {
    g.add(b(w * (0.5 - i * 0.06), 0.018, 0.008, mt(C.ink), -w * 0.04, h * 0.28 - i * h * 0.17, 0.025));
  }
  g.rotation.y = ry;
  g.position.set(x, y, z);
  return g;
}

// ---------------------------------------------------------------- 贴图
// 砖：两个 PAL 色、错缝、无噪点。repeat 按房子和院墙分别设。
const T = {
  brick: brickTex(C.wood, C.sand, 8, 5),
  wall: brickTex(C.wood, C.sand, 6, 4),
  grass: grassTex(3, 3),
  road: soilTex(C.wood, C.dark, 5, 2)
};
T.brick.repeat.set(4.0, 2.6);
T.wall.repeat.set(4.8, 1.15);
const BRICK = M(C.white, { map: T.brick });
const WALLBRICK = M(C.white, { map: T.wall });

// ============================================================================
// 门脸：砖房 + 半开卷帘门 + 门里内衬 + 红白雨棚 + 招牌
// ============================================================================
function shopHouse() {
  const g = new THREE.Group();
  const F = 1.8;                       // 前立面（local）

  // ---- 墙基 / 砖体 / 勒脚
  g.add(b(5.28, 0.3, 3.68, mt(C.road), 0, 0.15, 0));
  g.add(b(5.2, 2.9, 3.6, BRICK, 0, 1.75, 0));
  g.add(b(5.34, 0.12, 3.74, mt(C.cream), 0, 3.16, 0));

  // ---- 屋顶：女儿墙 + 压顶 + 排水沟
  g.add(b(5.44, 0.16, 3.84, mt(C.sand), 0, 3.3, 0));
  const cap = mt(C.cream);
  g.add(b(5.48, 0.18, 0.12, cap, 0, 3.46, 1.9));
  g.add(b(5.48, 0.18, 0.12, cap, 0, 3.46, -1.9));
  g.add(b(0.12, 0.18, 3.68, cap, 2.68, 3.46, 0));
  g.add(b(0.12, 0.18, 3.68, cap, -2.68, 3.46, 0));
  g.add(b(5.5, 0.04, 0.07, mt(C.road), 0, 3.53, 1.92));
  g.add(b(5.5, 0.04, 0.07, mt(C.road), 0, 3.53, -1.92));

  // 屋顶生活：水塔、太阳能热水器、天线、排气管
  g.add(b(0.9, 0.14, 0.9, mt(C.road), 1.35, 3.42, -0.45));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(cy(0.035, 0.035, 0.24, mt(C.ink), 1.35 + sx * 0.28, 3.53, -0.45 + sz * 0.28, 6));
  }
  g.add(cy(0.38, 0.38, 0.36, mt(C.blue), 1.35, 3.62, -0.45, 16));
  g.add(cy(0.3, 0.4, 0.07, mt(C.glass), 1.35, 3.83, -0.45, 16));
  g.add(cy(0.05, 0.05, 0.07, mt(C.road), 1.2, 3.87, -0.45, 8));
  // 太阳能：斜面板 + 玻璃管 + 横置水桶
  const sol = new THREE.Group();
  sol.position.set(-1.35, 3.42, -0.85);
  sol.rotation.x = -0.5;
  sol.add(b(1.5, 0.06, 0.95, mt(C.blue), 0, 0, 0));
  for (let i = 0; i < 7; i++) {
    sol.add(cy(0.035, 0.035, 0.92, mt(C.glass), -0.6 + i * 0.2, 0.05, 0, 6));
  }
  g.add(sol);
  g.add(b(1.4, 0.18, 0.4, mt(C.road), -1.35, 3.46, -1.05));
  const solarTank = cy(0.16, 0.16, 1.5, mt(C.cream), -1.35, 3.56, -1.05, 12);
  solarTank.rotation.z = Math.PI / 2;
  g.add(solarTank);
  // 天线
  g.add(cy(0.025, 0.025, 0.3, mt(C.ink), 2.25, 3.48, -1.25, 6));
  for (let i = 0; i < 3; i++) {
    g.add(b(0.5 - i * 0.1, 0.02, 0.02, mt(C.ink), 2.25, 3.56 - i * 0.08, -1.25));
  }
  g.add(cy(0.05, 0.06, 0.5, mt(C.road), -2.15, 3.68, 0.75, 8));
  g.add(cy(0.11, 0.03, 0.1, mt(C.road), -2.15, 3.97, 0.75, 8));

  // 屋顶的分格缝：一大片水泥顶，没有缝就是一块"空板"
  for (let i = 0; i < 4; i++) {
    g.add(b(0.018, 0.004, 3.7, mt(C.sand), -2.2 + i * 1.46, 3.386, 0));
  }
  g.add(b(5.3, 0.004, 0.018, mt(C.sand), 0, 3.386, -0.6));
  g.add(b(5.3, 0.004, 0.018, mt(C.sand), 0, 3.386, 0.7));
  // 检修口
  g.add(b(0.92, 0.3, 0.78, mt(C.cream), -1.05, 3.53, 0.9));
  g.add(b(0.98, 0.06, 0.84, mt(C.road), -1.05, 3.71, 0.9));
  g.add(b(0.16, 0.04, 0.05, mt(C.ink), -1.05, 3.74, 1.28));
  // 卫星锅
  g.add(cy(0.035, 0.035, 0.42, mt(C.ink), 2.15, 3.59, 0.95, 6));
  const dish = new THREE.Mesh(new THREE.ConeGeometry(0.33, 0.16, 16, 1, true), mt(C.white));
  dish.position.set(2.15, 3.83, 0.95);
  dish.rotation.x = -1.0;
  dish.castShadow = true;
  g.add(dish);
  g.add(rod(2.15, 3.83, 0.95, 2.15, 3.92, 1.14, 0.012, C.ink, 5));
  // 屋顶晾衣绳不放在最高处：22° 机位会把它切在画面顶上，改用低处的检修口/卫星锅/盆栽
  // 三盆屋顶植物 + 一摞砖 + 一个蓝桶
  for (let i = 0; i < 3; i++) {
    const x = -2.25 + i * 0.72;
    g.add(cy(0.16, 0.13, 0.2, mt(C.wood), x, 3.48, 1.58, 10));
    g.add(ball(0.19, C.mint, x, 3.62, 1.58, 8));
    g.add(ball(0.12, C.sea, x + 0.1, 3.7, 1.62, 7));
  }
  for (let i = 0; i < 3; i++) {
    g.add(b(0.3, 0.1, 0.18, mt(C.coral), -2.0 + (i % 2) * 0.2, 3.43 + i * 0.1, -0.35));
  }
  g.add(cy(0.13, 0.11, 0.28, mt(C.blue), 0.85, 3.52, 1.35, 10));
  g.add(cy(0.14, 0.14, 0.025, mt(C.road), 0.85, 3.67, 1.35, 10));

  // ---- 门洞内衬（全部在墙面之前，否则被实心盒子挡死）
  const D = -0.95;                      // 门中心
  // 内墙：奶油灰的旧墙，下半截是木护墙——暗是暗在雨棚的影子里，不是刷成黑墙
  g.add(b(1.98, 2.02, 0.04, mt(C.sand), D, 1.31, F + 0.02));
  g.add(b(1.9, 0.78, 0.03, mt(C.wood), D, 0.69, F + 0.04));
  // 门里暖光：一块低亮度黄面 + 一根灯管，保证门洞绝不是纯黑
  const warm = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 1.05),
    new THREE.MeshBasicMaterial({ color: C.yellow, transparent: true, opacity: 0.3, depthWrite: false }));
  warm.position.set(D, 1.05, F + 0.048);
  g.add(warm);
  const tube = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.032, 0.032),
    new THREE.MeshBasicMaterial({ color: C.yellow }));
  tube.position.set(D, 1.12, F + 0.16);
  g.add(tube);
  // 两层货架剪影：每层 6 个色块，让门里像"有货的店"而不是墙板
  for (let row = 0; row < 2; row++) {
    const y = 0.5 + row * 0.4;
    g.add(b(1.6, 0.045, 0.16, mt(C.wood), D, y, F + 0.11));
    g.add(b(0.05, 0.34, 0.14, mt(C.ink), D - 0.76, y + 0.18, F + 0.1));
    g.add(b(0.05, 0.34, 0.14, mt(C.ink), D + 0.76, y + 0.18, F + 0.1));
    const goods = [C.coral, C.yellow, C.mint, C.blue, C.peach, C.cream];
    for (let k = 0; k < 6; k++) {
      const hh = 0.13 + ((k + row) % 3) * 0.03;
      g.add(b(0.17, hh, 0.12, mt(goods[(k + row) % 6]),
        D - 0.62 + k * 0.245, y + 0.03 + hh / 2, F + 0.12));
    }
  }
  // 门里地上一摞纸箱
  g.add(b(0.46, 0.28, 0.3, mt(C.sand), D - 0.5, 0.44, F + 0.09));
  g.add(b(0.4, 0.22, 0.26, mt(C.wood), D - 0.45, 0.7, F + 0.08));
  // 门里吊灯泡
  g.add(cy(0.008, 0.008, 0.42, mt(C.ink), D - 0.62, 1.32, F + 0.15, 4));
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8),
    new THREE.MeshBasicMaterial({ color: C.yellow }));
  bulb.position.set(D - 0.62, 1.08, F + 0.15);
  g.add(bulb);
  // 门里两边的侧壁：制造"厚度"
  g.add(b(0.09, 2.0, 0.12, mt(C.ink), D - 0.97, 1.3, F + 0.08));
  g.add(b(0.09, 2.0, 0.12, mt(C.ink), D + 0.97, 1.3, F + 0.08));
  // 一层很淡的暗色片：把门里压暗一档（不然太阳会把内衬照得比外面还亮）
  const shade = new THREE.Mesh(new THREE.PlaneGeometry(1.86, 1.94),
    new THREE.MeshBasicMaterial({ color: C.ink, transparent: true, opacity: 0.1, depthWrite: false }));
  shade.position.set(D, 1.27, F + 0.15);
  g.add(shade);

  // ---- 半开卷帘门：六道银色横纹 + 底梁 + 导轨
  // 底梁抬到 1.17，门洞里能看见 3~4 道横纹；最上面几道由雨棚挡住是正常的。
  for (let i = 0; i < 6; i++) {
    g.add(b(1.86, 0.135, 0.075, mt(C.road), D, 1.27 + i * 0.16, F + 0.21));
    g.add(b(1.84, 0.03, 0.01, mt(C.glass), D, 1.33 + i * 0.16, F + 0.252));
    g.add(b(1.84, 0.014, 0.075, mt(C.ink), D, 1.19 + i * 0.16, F + 0.21));
  }
  g.add(b(1.92, 0.09, 0.1, mt(C.navy), D, 1.17, F + 0.215));      // 底梁
  g.add(b(0.18, 0.065, 0.012, mt(C.yellow), D + 0.62, 1.17, F + 0.27)); // 警示贴
  for (const sx of [-1, 1]) {
    g.add(b(0.08, 1.18, 0.11, mt(C.ink), D + sx * 0.985, 1.7, F + 0.215));
  }
  g.add(b(2.12, 0.18, 0.14, mt(C.ink), D, 2.18, F + 0.21));       // 卷帘盒
  g.add(b(2.04, 0.04, 0.05, mt(C.road), D, 2.26, F + 0.25));

  // ---- 门框：深蓝门套 + 石质过梁
  for (const sx of [-1, 1]) {
    g.add(b(0.16, 2.14, 0.17, mt(C.navy), D + sx * 0.97, 1.37, F + 0.055));
  }
  g.add(b(2.12, 0.18, 0.17, mt(C.navy), D, 2.4, F + 0.055));
  g.add(b(2.3, 0.1, 0.2, mt(C.road), D, 2.5, F + 0.04));
  g.add(b(2.0, 0.06, 0.36, mt(C.road), D, 0.33, F + 0.12));      // 门槛石

  // ---- 塑料门帘：两束挂在两侧，中间留出一米多的门洞
  // 竖条只挂在边上，才看得见卷帘门和内衬；风一吹两束各自错开。
  g.add(b(2.0, 0.05, 0.05, mt(C.navy), D, 2.3, F + 0.29));
  const stripX = [-0.9, -0.72, -0.54, 0.6, 0.78, 0.9];
  for (let i = 0; i < stripX.length; i++) {
    const pg = new THREE.Group();
    pg.position.set(D + stripX[i], 2.28, F + 0.3 + (i % 2) * 0.005);
    const strip = b(0.14, 1.5, 0.012,
      M(C.glass, { transparent: true, opacity: 0.2, depthWrite: false }), 0, -0.75, 0);
    strip.castShadow = false;
    pg.add(strip);
    g.add(pg);
    A.curtains.push({ g: pg, ph: i * 0.7 });
  }

  // ---- 雨棚：8 条红白条纹 + 前檐 + 两根柱子
  const aw = new THREE.Group();
  aw.position.set(0, 2.56, F);
  aw.rotation.x = -0.075;
  for (let i = 0; i < 8; i++) {
    aw.add(b(0.745, 0.035, 1.52, mt(i % 2 ? C.coral : C.white),
      -2.625 + i * 0.75, 0, 0.76));
  }
  aw.add(b(6.0, 0.06, 0.05, mt(C.navy), 0, -0.02, 1.52));
  g.add(aw);
  // 前檐垂布（八片，和棚面错开一格）
  for (let i = 0; i < 8; i++) {
    g.add(b(0.735, 0.22, 0.03, mt(i % 2 ? C.white : C.coral),
      -2.625 + i * 0.75, 2.34, 3.3));
  }
  g.add(b(6.0, 0.035, 0.045, mt(C.navy), 0, 2.45, 3.3));
  for (const sx of [-1, 1]) {
    g.add(cy(0.055, 0.055, 2.45, mt(C.ink), sx * 2.9, 1.225, 3.12, 10));
    g.add(cy(0.14, 0.14, 0.05, mt(C.road), sx * 2.9, 0.025, 3.12, 10));
    g.add(b(0.1, 0.1, 0.1, mt(C.ink), sx * 2.9, 2.44, 3.12));
  }
  // 棚下挂灯：一条黑线 + 一个黄灯罩
  const hb = new THREE.Group();
  hb.position.set(0.55, 2.44, 2.98);
  hb.add(cy(0.006, 0.006, 0.24, mt(C.ink), 0, -0.12, 0, 4));
  hb.add(cy(0.1, 0.04, 0.09, mt(C.cream), 0, -0.26, 0, 10));
  hb.add(ball(0.045, C.yellow, 0, -0.31, 0, 8));
  g.add(hb);
  A.bulb = hb;
  A.bulbBase = hb.position.clone();

  // ---- 招牌：三块抽象字板（不写品牌）+ 一条灯带
  g.add(b(3.62, 0.68, 0.1, mt(C.coral), 0, 2.92, F + 0.04));
  g.add(b(3.48, 0.54, 0.06, mt(C.cream), 0, 2.92, F + 0.1));
  const boards = [-1.08, 0, 1.08];
  for (let ib = 0; ib < 3; ib++) {
    const bx = boards[ib];
    g.add(b(0.9, 0.48, 0.035, mt(C.white), bx, 2.92, F + 0.14));
    // 三块板各一种抽象笔画：避开能读成真字的组合
    if (ib === 0) {
      g.add(b(0.06, 0.4, 0.014, mt(C.ink), bx - 0.2, 2.92, F + 0.165));
      g.add(b(0.34, 0.05, 0.014, mt(C.ink), bx + 0.06, 3.07, F + 0.165));
      g.add(b(0.22, 0.05, 0.014, mt(C.coral), bx + 0.0, 2.92, F + 0.165));
      g.add(b(0.3, 0.05, 0.014, mt(C.ink), bx + 0.04, 2.77, F + 0.165));
      g.add(b(0.09, 0.09, 0.014, mt(C.coral), bx + 0.2, 3.05, F + 0.165));
    } else if (ib === 1) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.03, 6, 20), mt(C.coral));
      ring.position.set(bx, 2.95, F + 0.17);
      g.add(ring);
      g.add(b(0.5, 0.05, 0.014, mt(C.ink), bx, 2.75, F + 0.165));
      g.add(b(0.18, 0.05, 0.014, mt(C.ink), bx + 0.17, 3.12, F + 0.165));
      g.add(b(0.07, 0.07, 0.014, mt(C.ink), bx - 0.24, 3.12, F + 0.165));
    } else {
      for (let k = 0; k < 3; k++) {
        const a = k * Math.PI / 3;
        g.add(rod(bx - Math.cos(a) * 0.2, 2.92 - Math.sin(a) * 0.2, F + 0.17,
          bx + Math.cos(a) * 0.2, 2.92 + Math.sin(a) * 0.2, F + 0.17, 0.023, C.ink, 5));
      }
      g.add(b(0.09, 0.09, 0.014, mt(C.coral), bx, 2.92, F + 0.18));
    }
  }
  const lampMat = glow(C.yellow, 1.5);
  g.add(b(3.3, 0.035, 0.05, lampMat, 0, 2.61, F + 0.16));
  A.signGlow = lampMat;
  for (let i = 0; i < 3; i++) {
    g.add(cy(0.018, 0.018, 0.09, mt(C.ink), boards[i], 2.53, F + 0.13, 6));
  }

  // ---- 立面细节：小窗、电表、落水管、告示、扫帚印
  // 左窗（雨棚下）
  g.add(b(0.92, 0.66, 0.08, mt(C.cream), -2.12, 1.98, F + 0.05));
  g.add(b(0.8, 0.54, 0.03, mt(C.dark), -2.12, 1.98, F + 0.095));
  g.add(glass(0.74, 0.48, 0.02, -2.12, 1.98, F + 0.115, 0.34));
  g.add(b(0.05, 0.5, 0.02, mt(C.ink), -2.12, 1.98, F + 0.13));
  g.add(b(0.76, 0.035, 0.02, mt(C.ink), -2.12, 1.98, F + 0.13));
  g.add(b(0.98, 0.06, 0.14, mt(C.blue), -2.12, 1.62, F + 0.08));       // 窗台
  g.add(b(0.28, 0.16, 0.03, mt(C.cream), -2.3, 1.75, F + 0.12));       // 窗里搁的两只碗
  g.add(cy(0.07, 0.06, 0.05, mt(C.blue), -2.42, 1.66, F + 0.13, 10));
  // 电表箱
  g.add(b(0.36, 0.48, 0.12, mt(C.white), 2.32, 2.3, F + 0.06));
  g.add(b(0.28, 0.16, 0.02, mt(C.glass), 2.32, 2.42, F + 0.13));
  g.add(b(0.16, 0.03, 0.02, mt(C.ink), 2.32, 2.25, F + 0.13));
  // 雨棚左柱后的落水管
  g.add(cy(0.05, 0.05, 3.05, mt(C.road), -2.52, 1.53, F + 0.04, 8));
  g.add(cy(0.07, 0.07, 0.08, mt(C.road), -2.52, 3.1, F + 0.04, 8));
  g.add(b(0.14, 0.05, 0.14, mt(C.road), -2.52, 0.03, F + 0.04));
  // 门口左侧的小黑板（抽象两行）
  g.add(b(0.54, 0.72, 0.05, mt(C.dark), -2.3, 2.2, F + 0.08));
  g.add(b(0.46, 0.62, 0.02, mt(C.ink), -2.3, 2.2, F + 0.115));
  for (let i = 0; i < 3; i++) {
    g.add(b(0.3 - i * 0.04, 0.02, 0.01, mt(C.cream), -2.3, 2.34 - i * 0.1, F + 0.13));
  }
  // 门右侧墙上的旧告示（纸角会掀）
  const fl = notice(0.52, 0.66, 2.3, 2.22, F + 0.06);
  g.add(fl);
  const flap = b(0.14, 0.14, 0.01, mt(C.cream), 0.26, -0.33, 0.02);
  fl.add(flap);
  A.flyer = flap;
  A.flyerBase = flap.rotation.x;

  // ---- 东侧墙：手绘旧广告 + 侧窗 + 水龙头 + 爬藤
  // 这块墙在 112° 机位是正面，不能只留一片砖
  g.add(b(0.04, 1.5, 1.9, mt(C.cream), 2.63, 1.95, -0.55));
  g.add(b(0.05, 0.07, 1.98, mt(C.coral), 2.66, 2.74, -0.55));
  g.add(b(0.05, 0.07, 1.98, mt(C.coral), 2.66, 1.16, -0.55));
  g.add(b(0.05, 1.66, 0.07, mt(C.coral), 2.66, 1.95, -1.51));
  g.add(b(0.05, 1.66, 0.07, mt(C.coral), 2.66, 1.95, 0.41));
  const adDisc = cy(0.3, 0.3, 0.03, mt(C.coral), 2.67, 2.3, -0.95, 18);
  adDisc.rotation.z = Math.PI / 2;
  g.add(adDisc);
  g.add(b(0.03, 0.62, 0.2, mt(C.blue), 2.67, 1.86, -0.46));
  g.add(b(0.03, 0.18, 0.09, mt(C.blue), 2.67, 2.26, -0.46));
  g.add(b(0.03, 0.06, 0.12, mt(C.coral), 2.67, 2.38, -0.46));
  const adSun = cy(0.13, 0.13, 0.02, mt(C.yellow), 2.67, 1.62, -1.22, 14);
  adSun.rotation.z = Math.PI / 2;
  g.add(adSun);
  for (let i = 0; i < 3; i++) {
    g.add(b(0.03, 0.022, 0.95, mt(C.sand), 2.67, 1.34 - i * 0.07, -0.35));
  }
  g.add(b(0.035, 0.32, 0.38, mt(C.sand), 2.68, 1.5, 0.12));       // 刮掉的一块旧漆
  // 侧窗
  g.add(b(0.08, 0.75, 0.98, mt(C.cream), 2.62, 2.1, 1.1));
  g.add(b(0.03, 0.62, 0.84, mt(C.dark), 2.66, 2.1, 1.1));
  g.add(glass(0.02, 0.58, 0.8, 2.68, 2.1, 1.1, 0.34));
  g.add(b(0.02, 0.62, 0.035, mt(C.ink), 2.69, 2.1, 1.1));
  g.add(b(0.02, 0.035, 0.82, mt(C.ink), 2.69, 2.1, 1.1));
  g.add(b(0.16, 0.06, 1.06, mt(C.blue), 2.66, 1.7, 1.1));
  g.add(cy(0.08, 0.07, 0.16, mt(C.cream), 2.82, 1.81, 0.9, 10));
  g.add(ball(0.12, C.mint, 2.82, 1.93, 0.9, 8));
  // 墙上吊灯
  g.add(cy(0.02, 0.02, 0.18, mt(C.ink), 2.72, 2.72, 1.35, 6));
  g.add(cy(0.11, 0.04, 0.08, mt(C.cream), 2.82, 2.64, 1.35, 10));
  const el1 = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), glow(C.yellow, 1.0));
  el1.position.set(2.82, 2.58, 1.35);
  g.add(el1);
  // 水龙头 + 接水的蓝桶
  g.add(rod(2.63, 0.78, 1.55, 2.9, 0.78, 1.55, 0.022, C.ink, 6));
  g.add(rod(2.9, 0.78, 1.55, 2.9, 0.62, 1.55, 0.018, C.ink, 6));
  g.add(cy(0.14, 0.11, 0.3, mt(C.blue), 2.95, 0.15, 1.55, 12));
  g.add(cy(0.15, 0.15, 0.025, mt(C.road), 2.95, 0.3, 1.55, 12));
  // 落水管 + 爬藤
  g.add(cy(0.05, 0.05, 3.02, mt(C.road), 2.7, 1.51, -1.66, 8));
  g.add(cy(0.07, 0.07, 0.08, mt(C.road), 2.7, 3.06, -1.66, 8));
  g.add(b(0.14, 0.05, 0.14, mt(C.road), 2.7, 0.03, -1.66));
  for (let i = 0; i < 5; i++) {
    g.add(ball(0.16, i % 2 ? C.sea : C.mint, 2.74, 0.9 + i * 0.45, -1.55 + (i % 2) * 0.12, 7));
  }

  // ---- 西侧墙：侧窗 + 靠墙木梯 + 落水管 + 吊灯
  g.add(b(0.08, 0.72, 0.95, mt(C.cream), -2.62, 2.05, 0.55));
  g.add(b(0.03, 0.6, 0.82, mt(C.dark), -2.66, 2.05, 0.55));
  g.add(glass(0.02, 0.56, 0.78, -2.68, 2.05, 0.55, 0.34));
  g.add(b(0.02, 0.6, 0.035, mt(C.ink), -2.69, 2.05, 0.55));
  g.add(b(0.02, 0.035, 0.8, mt(C.ink), -2.69, 2.05, 0.55));
  g.add(b(0.16, 0.06, 1.02, mt(C.blue), -2.66, 1.66, 0.55));
  g.add(cy(0.08, 0.07, 0.16, mt(C.cream), -2.82, 1.77, 0.35, 10));
  g.add(ball(0.12, C.mint, -2.82, 1.89, 0.35, 8));
  g.add(cy(0.02, 0.02, 0.18, mt(C.ink), -2.72, 2.68, 1.2, 6));
  g.add(cy(0.11, 0.04, 0.08, mt(C.cream), -2.82, 2.6, 1.2, 10));
  const el2 = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), glow(C.yellow, 1.0));
  el2.position.set(-2.82, 2.54, 1.2);
  g.add(el2);
  g.add(cy(0.05, 0.05, 3.0, mt(C.road), -2.7, 1.5, -1.55, 8));
  g.add(b(0.14, 0.05, 0.14, mt(C.road), -2.7, 0.03, -1.55));
  // 靠在墙上的旧木梯（292° 机位能看到它把墙面竖向切开）
  for (const sz of [-1.02, -0.54]) {
    g.add(rod(-3.08, 0.04, sz, -2.65, 3.38, sz, 0.032, C.wood, 6));
  }
  for (let i = 0; i < 7; i++) {
    const yy = 0.42 + i * 0.42;
    const xx = -3.08 + (yy / 3.38) * 0.43;
    g.add(rod(xx, yy, -1.02, xx, yy, -0.54, 0.024, C.wood, 5));
  }
  for (let i = 0; i < 4; i++) {
    g.add(ball(0.14, i % 2 ? C.mint : C.sea, -2.74, 0.65 + i * 0.4, 1.65, 6));
  }

  // ---- 后墙：后门 + 后窗 + 外机 + 管线（202° 机位）
  g.add(b(1.12, 2.2, 0.1, mt(C.cream), 1.1, 1.3, -1.83));
  g.add(b(0.94, 2.02, 0.06, mt(C.navy), 1.1, 1.31, -1.86));
  g.add(b(0.32, 0.42, 0.01, mt(C.cream), 1.1, 1.6, -1.9));
  g.add(b(0.2, 0.015, 0.005, mt(C.ink), 1.1, 1.7, -1.905));
  g.add(b(0.14, 0.015, 0.005, mt(C.ink), 1.1, 1.64, -1.905));
  g.add(b(0.05, 0.05, 0.1, mt(C.yellow), 1.38, 1.05, -1.9));      // 门把手
  g.add(b(1.4, 0.12, 0.4, mt(C.road), 1.1, 0.06, -2.0));          // 后门台阶
  g.add(b(1.5, 0.06, 0.36, mt(C.road), 1.1, 2.46, -2.0));         // 门头小挑檐
  g.add(b(0.05, 0.3, 0.32, mt(C.ink), 0.45, 2.3, -1.96));
  g.add(b(0.05, 0.3, 0.32, mt(C.ink), 1.75, 2.3, -1.96));
  g.add(cy(0.02, 0.02, 0.16, mt(C.ink), 1.1, 2.38, -2.06, 5));
  const el3 = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), glow(C.yellow, 1.0));
  el3.position.set(1.1, 2.3, -2.06);
  g.add(el3);
  // 后窗
  g.add(b(1.05, 0.76, 0.08, mt(C.cream), -1.25, 2.05, -1.83));
  g.add(b(0.91, 0.64, 0.03, mt(C.dark), -1.25, 2.05, -1.865));
  g.add(glass(0.85, 0.58, 0.02, -1.25, 2.05, -1.882, 0.34));
  g.add(b(0.035, 0.64, 0.02, mt(C.ink), -1.25, 2.05, -1.89));
  g.add(b(0.9, 0.035, 0.02, mt(C.ink), -1.25, 2.05, -1.89));
  g.add(b(1.12, 0.06, 0.14, mt(C.blue), -1.25, 1.64, -1.86));
  g.add(cy(0.1, 0.09, 0.18, mt(C.coral), -1.5, 1.77, -1.88, 10));
  g.add(ball(0.16, C.mint, -1.5, 1.9, -1.88, 8));
  // 空调外机
  g.add(b(0.86, 0.54, 0.3, mt(C.white), -2.25, 2.2, -1.98));
  for (let i = 0; i < 5; i++) {
    g.add(b(0.72, 0.025, 0.02, mt(C.road), -2.25, 2.02 + i * 0.075, -1.82));
  }
  g.add(b(0.94, 0.05, 0.34, mt(C.ink), -2.25, 1.9, -1.98));
  g.add(cy(0.022, 0.022, 0.55, mt(C.road), -1.82, 1.9, -1.98, 5));
  g.add(b(0.4, 0.12, 0.09, mt(C.road), 2.3, 1.9, -1.85));          // 电表
  g.add(b(0.3, 0.05, 0.02, mt(C.ink), 2.3, 1.95, -1.805));
  // 后墙上的横管 + 落水管
  g.add(cy(0.03, 0.03, 4.7, mt(C.road), 0, 2.92, -1.86, 6));
  g.add(cy(0.03, 0.03, 4.7, mt(C.road), 0, 2.86, -1.88, 6));
  g.add(cy(0.05, 0.05, 3.0, mt(C.road), 2.44, 1.5, -1.86, 8));
  for (let i = 0; i < 4; i++) {
    g.add(b(0.12, 0.035, 0.1, mt(C.ink), -2.0 + i * 1.35, 2.33, -1.87));
  }
  for (let i = 0; i < 4; i++) {
    g.add(ball(0.15, i % 2 ? C.mint : C.sea, -2.5, 0.55 + i * 0.42, -1.74, 6));
  }

  // ---- 屋顶下的燕子窝 + 一只燕子（动效：偶尔飞出）
  g.add(cy(0.11, 0.07, 0.1, mt(C.wood), 2.35, 3.04, F + 0.03, 8));
  const sw = new THREE.Group();
  const body = ball(0.055, C.ink, 0, 0, 0, 8);
  body.scale.set(1, 0.8, 1.35);
  sw.add(body);
  for (const s of [-1, 1]) {
    const wg = new THREE.Group();
    wg.position.set(s * 0.045, 0.02, 0);
    const wing = b(0.18, 0.012, 0.06, mt(C.ink), s * 0.09, 0, 0);
    wing.castShadow = false;
    wg.add(wing);
    sw.add(wg);
    A.wings.push({ g: wg, s });
  }
  sw.add(b(0.05, 0.02, 0.06, mt(C.yellow), 0, -0.01, 0.08));
  sw.position.set(2.35, 3.1, F + 0.04);
  g.add(sw);
  A.swallow = sw;
  A.swallowHome = sw.position.clone();

  return g;
}

// ============================================================================
// 东南：柜台（1.9×0.6，玻璃台面 / 算盘 / 老秤 / 糖罐 / 账本）
// ============================================================================
function counter() {
  const g = new THREE.Group();
  // 柜体：木身 + 深蓝台沿 + 前脸玻璃橱窗
  g.add(b(1.9, 0.8, 0.6, mt(C.wood), 0, 0.44, 0));
  g.add(b(1.94, 0.06, 0.64, mt(C.navy), 0, 0.87, 0));
  g.add(b(1.86, 0.04, 0.56, mt(C.wood), 0, 0.915, 0));
  g.add(glass(1.8, 0.025, 0.54, 0, 0.938, 0, 0.46));
  // 柜脚
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(b(0.09, 0.08, 0.09, mt(C.ink), sx * 0.82, 0.04, sz * 0.22));
  }
  // 前脸橱窗：三格色块
  g.add(b(1.7, 0.56, 0.03, mt(C.cream), 0, 0.5, 0.305));
  for (let i = 0; i < 3; i++) {
    g.add(b(0.02, 0.5, 0.04, mt(C.navy), -0.56 + i * 0.56, 0.5, 0.325));
  }
  const show = [C.yellow, C.coral, C.mint];
  for (let i = 0; i < 3; i++) {
    const x = -0.56 + i * 0.56;
    g.add(b(0.42, 0.06, 0.06, mt(C.wood), x, 0.27, 0.33));
    for (let k = 0; k < 3; k++) {
      const hh = 0.18 + ((i + k) % 3) * 0.06;
      g.add(b(0.11, hh, 0.12, mt(show[(i + k) % 3]), x - 0.13 + k * 0.13, 0.31 + hh / 2, 0.34));
    }
  }
  g.add(b(1.72, 0.02, 0.012, mt(C.glass), 0, 0.79, 0.345));      // 橱窗玻璃压条
  g.add(b(1.76, 0.05, 0.045, mt(C.navy), 0, 0.19, 0.33));
  // 台面：算盘
  const ab = new THREE.Group();
  ab.position.set(-0.58, 0.965, 0.04);
  ab.add(b(0.46, 0.045, 0.24, mt(C.wood), 0, 0, 0));
  ab.add(b(0.4, 0.012, 0.18, mt(C.cream), 0, 0.028, 0));
  for (let i = 0; i < 8; i++) {
    ab.add(cy(0.006, 0.006, 0.2, mt(C.ink), -0.2 + i * 0.057, 0.038, 0, 4));
    for (let k = 0; k < 3; k++) {
      ab.add(cy(0.017, 0.017, 0.012, mt(k === 0 ? C.coral : C.navy),
        -0.2 + i * 0.057, 0.05, -0.06 + k * 0.055, 6));
    }
  }
  g.add(ab);
  // 台面：摊开的账本 + 一张压在下面的收据
  g.add(b(0.4, 0.02, 0.28, mt(C.coral), 0.02, 0.95, 0.06));
  g.add(b(0.38, 0.012, 0.24, mt(C.cream), 0.02, 0.962, 0.06));
  g.add(b(0.19, 0.008, 0.24, mt(C.white), -0.08, 0.968, 0.06));
  for (let i = 0; i < 4; i++) {
    g.add(b(0.14, 0.004, 0.008, mt(C.ink), 0.13, 0.971, 0.0 + i * 0.05));
  }
  g.add(b(0.36, 0.006, 0.002, mt(C.coral), 0.02, 0.973, 0.06));   // 账本中缝红
  // 台面：老秤（秤杆 + 秤盘 + 秤砣）
  g.add(b(0.05, 0.34, 0.05, mt(C.wood), 0.62, 1.12, -0.02));
  const beam = b(0.56, 0.04, 0.04, mt(C.wood), 0.42, 1.27, -0.02);
  beam.rotation.z = -0.08;
  g.add(beam);
  g.add(b(0.05, 0.05, 0.05, mt(C.ink), 0.68, 1.28, -0.02));
  g.add(cy(0.006, 0.006, 0.2, mt(C.ink), 0.2, 1.18, -0.02, 4));
  g.add(cy(0.006, 0.006, 0.2, mt(C.ink), 0.28, 1.18, -0.02, 4));
  g.add(cy(0.11, 0.1, 0.025, mt(C.sand), 0.24, 1.08, -0.02, 14));
  g.add(cy(0.09, 0.08, 0.015, mt(C.road), 0.24, 1.095, -0.02, 14));
  g.add(b(0.05, 0.06, 0.05, mt(C.ink), 0.0, 1.24, -0.02));
  // 台面：糖罐两只 + 零钱盒 + 茶杯
  g.add(cy(0.095, 0.085, 0.2, mt(C.glass), 0.42, 1.05, 0.16, 12));
  g.add(cy(0.082, 0.078, 0.16, mt(C.cream), 0.42, 1.04, 0.16, 12));
  g.add(cy(0.1, 0.09, 0.035, mt(C.white), 0.42, 1.17, 0.16, 12));
  g.add(cy(0.08, 0.072, 0.15, mt(C.glass), 0.3, 1.03, -0.14, 12));
  g.add(cy(0.065, 0.06, 0.12, mt(C.coral), 0.3, 1.02, -0.14, 12));
  g.add(cy(0.07, 0.06, 0.1, mt(C.white), 0.75, 1.0, 0.16, 10));    // 搪瓷杯
  g.add(cy(0.058, 0.05, 0.085, mt(C.ink), 0.75, 1.06, 0.16, 10));
  g.add(b(0.16, 0.05, 0.13, mt(C.blue), 0.8, 0.99, -0.1));         // 零钱盒
  g.add(b(0.1, 0.012, 0.07, mt(C.yellow), 0.8, 1.02, -0.1));
  // 台面：纸袋 + 价格牌
  g.add(b(0.2, 0.22, 0.14, mt(C.cream), -0.82, 1.03, -0.12));
  g.add(b(0.2, 0.02, 0.14, mt(C.wood), -0.82, 1.14, -0.12));
  g.add(b(0.28, 0.18, 0.02, mt(C.white), -0.7, 1.02, 0.2));
  g.add(b(0.18, 0.02, 0.01, mt(C.coral), -0.7, 1.07, 0.215));
  g.add(b(0.12, 0.02, 0.01, mt(C.ink), -0.7, 1.01, 0.215));
  // 柜台前的小招牌
  g.add(b(0.36, 0.5, 0.04, mt(C.cream), -0.55, 0.28, 0.33));
  for (let i = 0; i < 3; i++) {
    g.add(b(0.24, 0.02, 0.01, mt(C.ink), -0.55, 0.4 - i * 0.08, 0.355));
  }
  return g;
}

// ============================================================================
// 东南：货架（两层，每层七色块，四种颜色循环）
// ============================================================================
function shelf() {
  const g = new THREE.Group();
  const W = 1.7, D = 0.4, H = 1.72;
  // 背板 + 侧板
  g.add(b(W + 0.02, H, 0.05, mt(C.cream), 0, H / 2, -D / 2 + 0.03));
  for (const sx of [-1, 1]) {
    g.add(b(0.07, H, D, mt(C.wood), sx * (W / 2), H / 2, 0));
  }
  // 三层搁板（两层商品 + 顶板）
  for (const y of [0.55, 1.1, 1.68]) {
    g.add(b(W - 0.1, 0.05, D - 0.04, mt(C.wood), 0, y, 0));
    g.add(b(W - 0.12, 0.02, 0.03, mt(C.navy), 0, y + 0.035, D / 2 - 0.04));
  }
  // 每层七个商品：四种颜色循环；形态在盒/罐/瓶之间换，插得整齐但有两个歪的
  const cols = [C.coral, C.yellow, C.mint, C.peach];
  for (let row = 0; row < 2; row++) {
    const y0 = row === 0 ? 0.575 : 1.125;
    for (let i = 0; i < 7; i++) {
      const x = -0.63 + i * 0.21;
      const col = cols[i % 4];
      const hh = 0.22 + ((i + row) % 3) * 0.045;
      let item;
      if (i % 3 === 1) {
        item = cy(0.072, 0.072, hh, mt(col), x, y0 + hh / 2, 0.015, 10);
        item.add(cy(0.074, 0.074, 0.03, mt(C.cream), 0, hh / 2 - 0.015, 0, 10));
      } else {
        item = b(0.15, hh, 0.15, mt(col), x, y0 + hh / 2, 0.015);
        g.add(b(0.11, 0.08, 0.005, mt(C.white), x, y0 + hh * 0.45, 0.095));
        g.add(b(0.08, 0.012, 0.006, mt(C.ink), x, y0 + hh * 0.38, 0.099));
      }
      // 两个歪的：上层第 4 个歪着，下层第 6 个倒着
      if (row === 1 && i === 3) { item.rotation.z = 0.12; }
      if (row === 0 && i === 5) { item.rotation.x = Math.PI / 2; item.position.y = y0 + 0.075; }
      g.add(item);
      // 货架前沿的薄荷绿标签条
      g.add(b(0.12, 0.04, 0.008, mt(C.mint), x, y0 - 0.02, D / 2 - 0.02));
    }
  }
  // 上层顶上：一只纸箱 + 一串挂着的塑料袋
  g.add(b(0.52, 0.26, 0.34, mt(C.sand), -0.35, 1.84, 0));
  g.add(b(0.54, 0.02, 0.36, mt(C.cream), -0.35, 1.97, 0));
  g.add(b(0.06, 0.06, 0.02, mt(C.ink), -0.35, 1.84, 0.18));
  for (let i = 0; i < 3; i++) {
    const bag = b(0.12, 0.2, 0.02, mt(i % 2 ? C.white : C.blue), 0.5, 1.6 - i * 0.01, 0.19);
    bag.rotation.z = 0.06 + i * 0.02;
    g.add(bag);
  }
  return g;
}

// ============================================================================
// 东北：长凳（视觉中心）+ 王彩凤的围裙 / 袖套 / 择菜的手
// ============================================================================
function bench() {
  const g = new THREE.Group();
  // 凳面：座面高 0.51（王彩凤 y=-0.01，比例为 0.92 → 0.51-0.57×0.92≈-0.014）
  g.add(b(1.85, 0.09, 0.46, mt(C.wood), 0, 0.465, 0));
  g.add(b(1.85, 0.1, 0.42, mt(C.wood), 0, 0.41, 0));
  g.add(b(0.12, 0.03, 0.4, mt(C.navy), 0, 0.5, 0.02));
  // 凳腿：左腿垫砖（矮 0.06）
  g.add(b(0.1, 0.36, 0.4, mt(C.dark), -0.72, 0.25, 0));
  g.add(b(0.1, 0.42, 0.4, mt(C.dark), 0.72, 0.21, 0));
  g.add(b(1.34, 0.06, 0.06, mt(C.wood), 0, 0.14, 0));
  g.add(b(0.22, 0.07, 0.16, mt(C.road), -0.72, 0.035, 0.08));    // 垫的砖
  g.add(b(0.2, 0.02, 0.14, mt(C.cream), -0.72, 0.075, 0.08));
  // 凳上的旧布垫 + 蒲扇
  g.add(b(0.42, 0.045, 0.32, mt(C.cream), 0.62, 0.515, 0.02));
  g.add(b(0.3, 0.015, 0.22, mt(C.coral), 0.64, 0.54, 0.02));
  const fan = b(0.28, 0.14, 0.012, mt(C.sand), 0.62, 0.6, 0.02);
  fan.rotation.z = 0.18;
  g.add(fan);
  // ---- 王彩凤的附件（人物本身在 characters 里，这里是围裙/袖套/手/菜盆）
  // 围裙
  g.add(b(0.36, 0.34, 0.028, mt(C.navy), 0, 0.79, 0.16));
  g.add(b(0.3, 0.05, 0.03, mt(C.cream), 0, 0.94, 0.17));
  // 袖套
  for (const sx of [-1, 1]) {
    g.add(cy(0.068, 0.068, 0.22, mt(C.cream), sx * 0.258, 0.93, 0.005, 10));
  }
  // 小臂 + 手：从袖口向前下方伸到膝上的菜盆
  for (const sx of [-1, 1]) {
    const hand = new THREE.Group();
    hand.position.set(sx * 0.17, 0.765, 0.36);
    hand.add(ball(0.05, C.sand, 0, 0, 0, 10));
    hand.add(b(0.07, 0.018, 0.09, C.sand, 0, -0.03, 0.01));
    g.add(hand);
    if (sx === 1) {
      const pod = b(0.16, 0.022, 0.035, mt(C.mint), 0.03, 0.0, 0.03);
      pod.rotation.y = -0.25;
      hand.add(pod);
      A.hand = hand;
      A.handBase = hand.position.clone();
    }
    // 小臂：不是整根圆柱，用一段皮色杆接袖口和手
    g.add(rod(sx * 0.258, 0.8, 0.02, sx * 0.17, 0.77, 0.35, 0.042, C.sand, 8));
  }
  // 膝上的搪瓷菜盆：择了一半的豆角
  g.add(cy(0.19, 0.17, 0.1, mt(C.white), 0.02, 0.69, 0.34, 14));
  g.add(cy(0.16, 0.15, 0.04, mt(C.navy), 0.02, 0.715, 0.34, 14));
  for (let i = 0; i < 7; i++) {
    const pod = b(0.13, 0.018, 0.032, mt(C.mint),
      -0.08 + (i % 3) * 0.06, 0.73 + (i % 2) * 0.01, 0.28 + (i % 4) * 0.03);
    pod.rotation.y = i * 0.7;
    g.add(pod);
  }
  // 发髻 + 发卡（老人）
  g.add(ball(0.078, C.ink, 0, 1.27, -0.135, 8));
  g.add(b(0.12, 0.02, 0.005, mt(C.coral), 0.02, 1.3, -0.13));
  return g;
}

// ============================================================================
// 西南：冰柜（旧广告贴纸 + 绿色指示灯 + 压缩机的细震）
// ============================================================================
function freezer() {
  const g = new THREE.Group();
  g.add(b(1.16, 0.86, 0.66, mt(C.white), 0, 0.47, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(b(0.1, 0.06, 0.1, mt(C.ink), sx * 0.46, 0.03, sz * 0.24));
  }
  // 顶盖：金属框 + 两片滑动玻璃；玻璃下面露出几罐饮料
  g.add(b(1.22, 0.07, 0.72, mt(C.road), 0, 0.93, 0));
  g.add(b(1.08, 0.02, 0.58, mt(C.ink), 0, 0.905, 0));
  for (const sx of [-1, 1]) {
    g.add(b(0.06, 0.06, 0.58, mt(C.navy), sx * 0.52, 0.955, 0));
  }
  g.add(b(1.08, 0.06, 0.05, mt(C.navy), 0, 0.955, -0.28));
  const lid = glass(0.54, 0.025, 0.58, 0, 0.985, 0, 0.4);
  g.add(lid);
  A.lid = lid;
  const bottles = [C.mint, C.coral, C.yellow, C.mint, C.cream];
  for (let i = 0; i < 5; i++) {
    g.add(cy(0.032, 0.032, 0.065, mt(bottles[i]), -0.4 + i * 0.2, 0.94, 0.04, 8));
    g.add(cy(0.018, 0.018, 0.012, mt(C.white), -0.4 + i * 0.2, 0.978, 0.04, 6));
  }
  g.add(b(1.16, 0.04, 0.66, mt(C.road), 0, 0.87, 0));
  // 正面旧广告贴纸：一张褪色的大海报 + 一张小标贴 + 翘角
  g.add(b(0.66, 0.64, 0.02, mt(C.cream), -0.17, 0.46, 0.335));
  g.add(b(0.7, 0.06, 0.012, mt(C.coral), -0.17, 0.75, 0.342));
  g.add(b(0.7, 0.06, 0.012, mt(C.coral), -0.17, 0.17, 0.342));
  g.add(cy(0.15, 0.15, 0.01, mt(C.coral), -0.2, 0.54, 0.348, 18));
  g.add(b(0.36, 0.04, 0.005, mt(C.ink), -0.17, 0.66, 0.35));
  g.add(b(0.08, 0.3, 0.014, mt(C.blue), -0.17, 0.42, 0.352));      // 海报里的瓶子
  g.add(b(0.12, 0.04, 0.014, mt(C.ink), -0.17, 0.58, 0.352));
  for (let i = 0; i < 3; i++) {
    g.add(b(0.4, 0.015, 0.005, mt(C.ink), -0.17, 0.33 - i * 0.05, 0.35));
  }
  g.add(cy(0.07, 0.07, 0.01, mt(C.yellow), 0.08, 0.58, 0.35, 12));
  g.add(b(0.3, 0.42, 0.02, mt(C.yellow), 0.37, 0.48, 0.335));
  g.add(b(0.08, 0.24, 0.02, mt(C.ink), 0.37, 0.45, 0.348));
  g.add(b(0.06, 0.06, 0.02, mt(C.coral), 0.37, 0.62, 0.348));
  g.add(b(0.12, 0.12, 0.012, mt(C.cream), 0.51, 0.62, 0.345));    // 翘起的纸角
  // 蓝色雪花小标
  g.add(b(0.2, 0.2, 0.02, mt(C.blue), 0.05, 0.72, 0.335));
  for (let i = 0; i < 3; i++) {
    const s = b(0.15, 0.015, 0.005, mt(C.white), 0.05, 0.72, 0.348);
    s.rotation.z = i * Math.PI / 3;
    g.add(s);
  }
  // 绿色指示灯（呼吸）
  const ledMat = glow(C.mint, 1.2);
  g.add(b(0.07, 0.035, 0.025, ledMat, 0.48, 0.85, 0.335));
  A.led = ledMat;
  // 侧面压缩机格栅
  for (let i = 0; i < 5; i++) {
    g.add(b(0.02, 0.04, 0.36, mt(C.road), 0.59, 0.28 + i * 0.075, -0.05));
  }
  g.add(cy(0.04, 0.04, 0.06, mt(C.ink), 0.62, 0.12, 0.18, 6));    // 排水口
  return g;
}

// ============================================================================
// 西北：遮阳伞（红）+ 鸡蛋筐三只
// ============================================================================
function parasol() {
  const g = new THREE.Group();
  g.add(b(0.58, 0.1, 0.58, mt(C.road), 0, 0.05, 0));
  g.add(cy(0.06, 0.07, 0.16, mt(C.ink), 0, 0.16, 0, 10));
  g.add(cy(0.045, 0.045, 2.3, mt(C.ink), 0, 1.35, 0, 10));
  // 伞面：八边形锥 + 八根白伞骨
  const top = new THREE.Mesh(new THREE.ConeGeometry(1.34, 0.46, 8), mt(C.coral));
  top.position.set(0, 2.62, 0);
  top.castShadow = true;
  top.receiveShadow = true;
  g.add(top);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    g.add(rod(0, 2.84, 0, Math.cos(a) * 1.3, 2.44, Math.sin(a) * 1.3, 0.012, C.cream, 6));
  }
  g.add(cy(0.07, 0.03, 0.14, mt(C.cream), 0, 2.86, 0, 10));
  g.add(ball(0.05, C.cream, 0, 2.94, 0, 8));
  // 前沿的八片垂布：其中一片跟着风掀角 0.02 rad
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const flap = new THREE.Group();
    flap.position.set(Math.cos(a) * 1.27, 2.44, Math.sin(a) * 1.27);
    flap.rotation.y = -a + Math.PI / 2;
    flap.add(b(0.42, 0.17, 0.018, mt(i % 2 ? C.cream : C.coral), 0, -0.085, 0));
    g.add(flap);
    if (i === 2) { A.parasolFlap = flap; A.parasolBase = flap.rotation.x; }
  }
  A.parasolCanopy = top;
  return g;
}

function eggBaskets() {
  const g = new THREE.Group();
  const basket = (x, y, z, s = 1) => {
    const bg = new THREE.Group();
    bg.position.set(x, y, z);
    bg.scale.setScalar(s);
    bg.add(cy(0.25, 0.18, 0.2, mt(C.wood), 0, 0.1, 0, 14));
    bg.add(cy(0.255, 0.24, 0.035, mt(C.sand), 0, 0.205, 0, 14));
    bg.add(cy(0.21, 0.21, 0.035, mt(C.yellow), 0, 0.19, 0, 14));
    // 鸡蛋：一圈一圈码上去
    for (let i = 0; i < 7; i++) {
      const a = i * 1.7;
      bg.add(ball(0.055, i % 3 ? C.cream : C.white,
        Math.cos(a) * 0.12, 0.235 + (i % 2) * 0.035, Math.sin(a) * 0.1, 10));
    }
    bg.add(b(0.2, 0.015, 0.2, mt(C.cream), 0.08, 0.23, 0.06));
    return bg;
  };
  g.add(basket(-0.48, 0, 0.04, 1));
  g.add(basket(0.38, 0, 0.26, 0.94));
  // 木箱垫高的一筐
  g.add(b(0.72, 0.3, 0.5, mt(C.wood), 0.06, 0.15, -0.44));
  for (let i = 0; i < 3; i++) {
    g.add(b(0.66, 0.03, 0.03, mt(C.sand), 0.06, 0.07 + i * 0.09, 0.19));
  }
  g.add(basket(0.06, 0.3, -0.44, 0.9));
  // 一小块写着价钱的纸片（抽象）
  g.add(b(0.16, 0.12, 0.01, mt(C.cream), -0.24, 0.27, 0.3));
  g.add(b(0.1, 0.015, 0.005, mt(C.coral), -0.24, 0.3, 0.308));
  g.add(b(0.07, 0.012, 0.005, mt(C.ink), -0.24, 0.27, 0.308));
  return g;
}

// ============================================================================
// 东北：歪脖子树（树冠四团，树下拴绳）+ 啤酒箱
// ============================================================================
function crookedTree() {
  const g = new THREE.Group();
  // 树干：从根部长出来时带一个明显的歪
  g.add(rod(0, 0, 0, 0.42, 2.35, 0.08, 0.21, C.wood, 10));
  g.add(rod(0.1, 0.4, 0.02, -0.18, 0.55, 0.08, 0.13, C.wood, 7));
  g.add(rod(0.08, 0.12, 0.02, -0.28, 0.02, 0.22, 0.09, C.wood, 6));
  g.add(rod(0.08, 0.12, 0.02, 0.34, 0.02, -0.24, 0.08, C.wood, 6));
  // 三根主枝
  g.add(rod(0.42, 2.2, 0.08, 0.15, 2.99, -0.28, 0.1, C.wood, 7));
  g.add(rod(0.42, 2.2, 0.08, 1.0, 3.14, 0.4, 0.09, C.wood, 7));
  g.add(rod(0.42, 2.2, 0.08, -0.4, 3.19, 0.25, 0.08, C.wood, 7));
  // 树冠四团：三团薄荷绿、一团偏冷的海水绿，压扁一点
  const canopy = [
    [0.28, 3.21, -0.12, 0.84, C.mint],
    [1.12, 3.38, 0.34, 0.68, C.sea],
    [-0.48, 3.28, 0.18, 0.74, C.mint],
    [0.58, 3.54, 0.42, 0.62, C.mint]
  ];
  for (const [x, y, z, r, col] of canopy) {
    const m = ball(r, col, x, y, z, 10);
    m.scale.set(1.05, 0.76, 1.0);
    m.userData.bx = x;
    m.userData.bz = z;
    g.add(m);
    A.leaves.push(m);
  }
  // 树根边的土、几块小石头
  g.add(decal(1.0, 0.8, C.wood, 0.1, 0.1, 0.012, 0.55));
  g.add(ball(0.09, C.road, -0.35, 0.07, 0.28, 8));
  g.add(ball(0.07, C.sand, 0.5, 0.05, -0.32, 8));
  // 拴在树干上的绳圈
  g.add(new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.02, 6, 14), mt(C.sand)));
  const knot = g.children[g.children.length - 1];
  knot.position.set(0.16, 0.92, 0.04);
  knot.rotation.x = Math.PI / 2;
  return g;
}

function beerCrates() {
  const g = new THREE.Group();
  const crate = (x, y, z, ry = 0) => {
    const cg = new THREE.Group();
    cg.position.set(x, y, z);
    cg.rotation.y = ry;
    cg.add(b(0.42, 0.3, 0.32, mt(C.coral), 0, 0.15, 0));
    for (let i = 0; i < 3; i++) {
      cg.add(b(0.36, 0.045, 0.02, mt(C.dark), 0, 0.06 + i * 0.075, 0.17));
    }
    for (let i = 0; i < 4; i++) {
      cg.add(cy(0.032, 0.032, 0.2, mt(C.glass), -0.14 + i * 0.095, 0.34, 0.02, 8));
      cg.add(cy(0.015, 0.015, 0.05, mt(C.yellow), -0.14 + i * 0.095, 0.47, 0.02, 6));
    }
    return cg;
  };
  g.add(crate(0, 0, 0));
  g.add(crate(0.02, 0.32, 0.01, 0.06));
  g.add(crate(0.52, 0, 0.12, -0.12));
  // 倒着的一只空箱
  const lying = crate(0.28, 0.17, 0.48, 1.35);
  lying.rotation.z = Math.PI / 2;
  g.add(lying);
  // 地上两只空瓶
  for (let i = 0; i < 2; i++) {
    const bot = cy(0.038, 0.038, 0.24, mt(C.glass), 0.7 + i * 0.12, 0.13, 0.52 - i * 0.1, 8);
    bot.rotation.z = Math.PI / 2 - 0.1;
    g.add(bot);
  }
  return g;
}

// ============================================================================
// 门口小物：台阶、地垫、拖鞋、豆角筐、纸箱、扫帚、瓶箱、落叶
// ============================================================================
function steps() {
  const g = new THREE.Group();
  g.add(b(2.6, 0.09, 0.38, mt(C.road), 0, 0.045, 0.18));
  g.add(b(2.3, 0.13, 0.36, mt(C.road), 0, 0.12, -0.18));
  g.add(b(2.34, 0.03, 0.4, mt(C.cream), 0, 0.195, -0.18));
  g.add(b(2.64, 0.02, 0.04, mt(C.sand), 0, 0.1, 0.38));
  g.add(decal(1.75, 0.3, C.yellow, 0, -0.18, 0.212, 0.14));       // 门里灯落在台阶上的一条暖边
  return g;
}
function doorMat() {
  const g = new THREE.Group();
  g.add(b(1.2, 0.025, 0.72, mt(C.wood), 0, 0.02, 0));
  g.add(b(1.1, 0.018, 0.64, mt(C.coral), 0, 0.038, 0));
  g.add(b(0.94, 0.006, 0.5, mt(C.cream), 0, 0.049, 0));
  for (let i = 0; i < 3; i++) {
    g.add(b(0.8, 0.004, 0.035, mt(C.coral), 0, 0.053, -0.15 + i * 0.15));
  }
  const corner = new THREE.Group();
  corner.position.set(-0.46, 0.04, 0.3);
  const flap = b(0.2, 0.014, 0.16, mt(C.coral), 0.1, 0, -0.08);
  corner.add(flap);
  g.add(corner);
  A.matCorner = corner;
  A.matBase = corner.rotation.x;
  return g;
}
function slippers() {
  const g = new THREE.Group();
  const one = (x, z, ry, flip) => {
    const sg = new THREE.Group();
    sg.position.set(x, 0, z);
    sg.rotation.y = ry;
    sg.add(b(0.11, 0.03, 0.25, mt(C.coral), 0, 0.02, 0));
    sg.add(b(0.09, 0.012, 0.23, mt(C.cream), 0, 0.038, 0));
    const strap = b(0.1, 0.05, 0.03, mt(C.coral), 0, 0.06, 0.02);
    if (flip) { strap.rotation.z = Math.PI / 2; strap.position.y = 0.035; }
    sg.add(strap);
    return sg;
  };
  g.add(one(-0.08, 0, 0.22, false));
  const f = one(0.1, 0.12, -0.6, true);
  f.rotation.z = 0.9;
  f.position.y = 0.045;
  g.add(f);
  return g;
}
function vegBasket() {
  const g = new THREE.Group();
  // 小木凳 + 豆角筐
  g.add(b(0.48, 0.06, 0.38, mt(C.wood), 0, 0.33, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(b(0.05, 0.32, 0.05, mt(C.dark), sx * 0.19, 0.16, sz * 0.14));
  }
  g.add(cy(0.25, 0.17, 0.2, mt(C.wood), 0, 0.46, 0, 14));
  g.add(cy(0.255, 0.24, 0.03, mt(C.sand), 0, 0.565, 0, 14));
  for (let i = 0; i < 8; i++) {
    const pod = b(0.14, 0.018, 0.034, mt(C.mint),
      -0.12 + (i % 4) * 0.07, 0.59 + (i % 2) * 0.02, -0.08 + (i % 3) * 0.07);
    pod.rotation.y = i * 0.6;
    g.add(pod);
  }
  g.add(b(0.24, 0.01, 0.2, mt(C.cream), 0.05, 0.58, 0.05));      // 垫筐的布
  // 地上挑出来的一小堆
  g.add(decal(0.38, 0.3, C.cream, 0.32, 0.25, 0.012, 0.8));
  for (let i = 0; i < 5; i++) {
    const pod = b(0.12, 0.016, 0.03, mt(C.mint), 0.24 + (i % 3) * 0.06, 0.025, 0.18 + (i % 2) * 0.07);
    pod.rotation.y = i * 0.9;
    g.add(pod);
  }
  return g;
}
function cardboardBoxes() {
  const g = new THREE.Group();
  const box = (x, y, z, w, h, d, ry) => {
    const bg = new THREE.Group();
    bg.position.set(x, y, z);
    bg.rotation.y = ry;
    bg.add(b(w, h, d, mt(C.wood), 0, 0, 0));
    bg.add(b(w + 0.01, 0.015, d + 0.01, mt(C.sand), 0, h / 2, 0));
    bg.add(b(0.05, h + 0.02, d + 0.01, mt(C.cream), 0, 0, 0));
    bg.add(b(w * 0.7, 0.02, 0.01, mt(C.ink), 0, h * 0.1, d / 2 + 0.005));
    return bg;
  };
  g.add(box(0, 0.16, 0, 0.5, 0.32, 0.4, 0.1));
  g.add(box(0.04, 0.47, -0.02, 0.44, 0.3, 0.36, -0.14));
  g.add(box(0.12, 0.76, 0.03, 0.36, 0.28, 0.32, 0.22));
  const bag = b(0.26, 0.34, 0.12, mt(C.blue), 0.3, 0.2, 0.18);
  bag.rotation.z = 0.15;
  g.add(bag);
  return g;
}
function broom() {
  const g = new THREE.Group();
  const handle = cy(0.02, 0.025, 1.4, mt(C.wood), 0, 0.7, 0, 6);
  handle.rotation.z = 0.12;
  handle.rotation.x = -0.16;
  g.add(handle);
  g.add(b(0.26, 0.18, 0.08, mt(C.sand), -0.1, 0.09, 0.12));
  for (let i = 0; i < 6; i++) {
    g.add(b(0.02, 0.2, 0.02, mt(C.yellow), -0.2 + i * 0.04, 0.1, 0.16));
  }
  g.add(b(0.28, 0.04, 0.05, mt(C.coral), -0.1, 0.17, 0.12));
  return g;
}
function bottleCrate() {
  const g = new THREE.Group();
  g.add(b(0.46, 0.24, 0.32, mt(C.coral), 0, 0.12, 0));
  for (let i = 0; i < 3; i++) {
    g.add(b(0.38, 0.04, 0.02, mt(C.dark), 0, 0.06 + i * 0.06, 0.17));
  }
  for (let i = 0; i < 6; i++) {
    const x = -0.14 + (i % 3) * 0.14;
    const z = i < 3 ? -0.07 : 0.07;
    g.add(cy(0.04, 0.04, 0.24, mt(C.glass), x, 0.3, z, 8));
    g.add(cy(0.015, 0.015, 0.06, mt(C.cream), x, 0.45, z, 6));
  }
  return g;
}
function leafPile() {
  const g = new THREE.Group();
  g.add(decal(0.56, 0.44, C.wood, 0, 0, 0.014, 0.55));
  for (let i = 0; i < 9; i++) {
    const leaf = b(0.1, 0.008, 0.05, mt(i % 3 === 0 ? C.yellow : (i % 3 === 1 ? C.coral : C.sand)),
      -0.18 + (i % 4) * 0.12, 0.02 + (i % 2) * 0.01, -0.12 + Math.floor(i / 3) * 0.1);
    leaf.rotation.y = i * 0.8;
    leaf.rotation.z = (i % 2) * 0.2;
    g.add(leaf);
  }
  g.add(b(0.24, 0.06, 0.14, mt(C.ink), 0.28, 0.03, 0.1));        // 簸箕
  g.add(b(0.02, 0.3, 0.02, mt(C.wood), 0.34, 0.17, 0.1));
  return g;
}

// ============================================================================
// 院子边界：西砖墙 / 东木栅 / 北院墙 / 后树 / 电线杆 / 晾衣绳
// ============================================================================
function westWall() {
  const g = new THREE.Group();
  g.add(b(0.26, 0.72, 6.56, WALLBRICK, 0, 0.36, 0));
  g.add(b(0.36, 0.08, 6.68, mt(C.cream), 0, 0.76, 0));
  g.add(b(0.34, 0.12, 6.68, mt(C.road), 0, 0.06, 0));
  // 墙面的青苔块和一块补丁
  for (let i = 0; i < 4; i++) {
    g.add(b(0.02, 0.1 + (i % 2) * 0.08, 0.34, mt(C.sea), 0.14, 0.3 + (i % 2) * 0.2, -2.2 + i * 1.4));
  }
  g.add(b(0.02, 0.24, 0.5, mt(C.sand), 0.14, 0.42, 1.8));
  // 墙头的草
  for (let i = 0; i < 5; i++) {
    g.add(ball(0.11, C.mint, 0.1, 0.82, -2.6 + i * 1.1, 6));
  }
  return g;
}
function eastFence() {
  const g = new THREE.Group();
  // 竖板条 + 两道横梁
  for (let i = 0; i < 29; i++) {
    g.add(b(0.07, 1.05 + (i % 3) * 0.04, 0.03, mt(i % 2 ? C.wood : C.sand),
      0, 0.55, -2.9 + i * 0.205));
  }
  for (const y of [0.32, 0.92]) {
    g.add(b(0.05, 0.07, 5.95, mt(C.wood), 0.03, y, 0));
  }
  for (let i = 0; i < 4; i++) {
    g.add(b(0.11, 1.25, 0.11, mt(C.dark), 0, 0.62, -2.9 + i * 1.9));
  }
  // 爬在栅栏上的藤
  for (let i = 0; i < 7; i++) {
    g.add(ball(0.1, C.mint, 0.06, 0.35 + (i % 4) * 0.22, -2.2 + i * 0.72, 6));
    if (i % 3 === 0) { g.add(ball(0.04, C.coral, 0.1, 0.5 + (i % 4) * 0.2, -2.2 + i * 0.72, 5)); }
  }
  return g;
}
function backWall() {
  const g = new THREE.Group();
  g.add(b(14.4, 0.86, 0.28, WALLBRICK, 0, 0.43, 0));
  g.add(b(14.5, 0.08, 0.38, mt(C.cream), 0, 0.9, 0));
  g.add(b(14.5, 0.12, 0.4, mt(C.road), 0, 0.06, 0));
  // 墙里的铁门
  g.add(b(1.5, 1.1, 0.05, mt(C.navy), 4.6, 0.55, 0.17));
  for (let i = 0; i < 6; i++) {
    g.add(cy(0.022, 0.022, 1.0, mt(C.ink), 4.0 + i * 0.24, 0.56, 0.2, 6));
  }
  for (let i = 0; i < 3; i++) {
    g.add(ball(0.09, C.mint, -5.8 + i * 1.4, 0.94, 0.1, 6));
  }
  return g;
}
function backTrees() {
  const g = new THREE.Group();
  const tree = (x, z, s) => {
    g.add(cy(0.13 * s, 0.17 * s, 2.1 * s, mt(C.wood), x, 1.05 * s, z, 8));
    for (let i = 0; i < 3; i++) {
      const m = ball(0.78 * s - i * 0.05, i % 2 ? C.sea : C.mint,
        x + (i - 1) * 0.55 * s, 2.5 * s + (i % 2) * 0.3 * s, z + ((i % 2) ? 0.3 : -0.2) * s, 10);
      m.scale.y = 0.72;
      g.add(m);
    }
  };
  tree(-5.6, -7.9, 1.15);
  tree(3.4, -8.1, 1.0);
  return g;
}
function utilityPole() {
  const g = new THREE.Group();
  g.add(b(0.4, 0.12, 0.4, mt(C.road), 0, 0.06, 0));
  g.add(cy(0.12, 0.15, 4.3, mt(C.wood), 0, 2.15, 0, 10));
  g.add(b(1.3, 0.09, 0.09, mt(C.wood), 0, 3.98, 0));
  for (let i = 0; i < 3; i++) {
    g.add(cy(0.04, 0.04, 0.12, mt(C.glass), -0.48 + i * 0.48, 4.1, 0, 8));
  }
  g.add(b(0.3, 0.48, 0.3, mt(C.road), 0, 3.1, 0));
  for (let i = 0; i < 4; i++) {
    g.add(b(0.32, 0.02, 0.02, mt(C.ink), 0, 2.95 + i * 0.07, 0.16));
  }
  g.add(b(0.22, 0.3, 0.02, mt(C.blue), 0.14, 1.9, 0.13));
  g.add(b(0.14, 0.02, 0.01, mt(C.white), 0.14, 1.95, 0.145));
  return g;
}
function wires() {
  const g = new THREE.Group();
  g.add(cord([[7.15, 4.08, 5.2], [4.9, 3.68, 3.6], [2.2, 3.55, 1.9]], 0.012, C.ink, 18));
  g.add(cord([[7.15, 3.98, 5.2], [4.6, 3.55, 3.4], [1.8, 3.5, 1.85]], 0.012, C.ink, 18));
  g.add(cord([[7.15, 4.08, 5.2], [7.4, 3.6, 2.0], [7.0, 3.4, -0.6]], 0.012, C.ink, 16));
  return g;
}
function clothesline() {
  const g = new THREE.Group();
  g.add(cy(0.05, 0.06, 2.3, mt(C.wood), -4.6, 1.15, -4.7, 8));
  g.add(cy(0.05, 0.06, 2.3, mt(C.wood), 3.4, 1.15, -4.7, 8));
  g.add(cord([[-4.6, 2.24, -4.7], [-0.6, 2.06, -4.7], [3.4, 2.2, -4.7]], 0.012, C.sand, 16));
  const cloths = [C.cream, C.coral, C.mint, C.blue];
  for (let i = 0; i < 4; i++) {
    const x = -3.5 + i * 1.7;
    const cg = new THREE.Group();
    cg.position.set(x, 2.04, -4.7);
    const cl = b(0.5, 0.62, 0.02, mt(cloths[i]), 0, -0.31, 0);
    cg.add(cl);
    cg.add(b(0.05, 0.05, 0.03, mt(C.wood), -0.2, 0.01, 0));
    cg.add(b(0.05, 0.05, 0.03, mt(C.wood), 0.2, 0.01, 0));
    g.add(cg);
    A.clothes.push(cg);
  }
  return g;
}
function rearYard() {
  const g = new THREE.Group();
  // 后门口的药箱/纸箱堆 + 雨桶
  const box = (x, y, z, w, h, d, ry) => {
    const bg = new THREE.Group();
    bg.position.set(x, y, z);
    bg.rotation.y = ry;
    bg.add(b(w, h, d, mt(C.wood), 0, 0, 0));
    bg.add(b(w + 0.01, 0.02, d + 0.01, mt(C.sand), 0, h / 2, 0));
    bg.add(b(0.06, h + 0.02, d + 0.01, mt(C.cream), 0, 0, 0));
    return bg;
  };
  g.add(box(-4.2, 0.18, -4.1, 0.62, 0.36, 0.44, 0.1));
  g.add(box(-4.15, 0.53, -4.05, 0.54, 0.32, 0.4, -0.12));
  g.add(box(2.0, 0.2, -4.4, 0.55, 0.4, 0.45, 0.3));
  // 雨桶
  g.add(cy(0.28, 0.24, 0.65, mt(C.blue), 4.2, 0.33, -4.6, 14));
  g.add(cy(0.29, 0.29, 0.05, mt(C.road), 4.2, 0.68, -4.6, 14));
  g.add(cy(0.26, 0.26, 0.02, mt(C.glass), 4.2, 0.71, -4.6, 14));
  // 靠墙的旧扫帚 + 拖把
  const bm = cy(0.02, 0.025, 1.3, mt(C.wood), 5.2, 0.65, -4.7, 6);
  bm.rotation.z = 0.2;
  g.add(bm);
  g.add(b(0.2, 0.14, 0.06, mt(C.sand), 5.05, 0.1, -4.62));
  return g;
}

// ============================================================================
// 场景数据
// ============================================================================
const props = [
  // ---- 地面：土场 + 门前水泥 + 土路 + 草沿（全部 passable）
  { id: "g_apron", x: 0, z: 2.9, w: 7.8, d: 3.0, passable: true,
    build: () => {
      const g = new THREE.Group();
      g.add(ground(7.8, 3.0, 0, 0, null, C.cream, 0.006));
      for (let i = 0; i < 4; i++) {                     // 水泥分格
        g.add(b(0.018, 0.004, 2.98, mt(C.sand), -2.6 + i * 1.73, 0.009, 0));
      }
      g.add(b(7.8, 0.004, 0.018, mt(C.sand), 0, 0.009, -0.5));
      g.add(b(7.8, 0.004, 0.018, mt(C.sand), 0, 0.009, 0.9));
      return g;
    } },
  { id: "g_road", x: 0, z: 5.95, w: 18.6, d: 2.9, passable: true,
    build: () => {
      const g = new THREE.Group();
      g.add(ground(18.6, 2.9, 0, 0, T.road, C.white, 0.004));
      // 车辙、碎石、路肩的草
      g.add(decal(17.8, 0.16, C.sand, 0, -0.7, 0.012, 0.38));
      g.add(decal(17.8, 0.16, C.sand, 0, 0.55, 0.012, 0.38));
      g.add(decal(17.2, 0.08, C.cream, 0, 0.05, 0.011, 0.22));
      for (let i = 0; i < 10; i++) {
        const st = ball(0.05 + (i % 3) * 0.025, i % 2 ? C.road : C.sand,
          -8.2 + i * 1.75, 0.03, -1.2 + (i % 4) * 0.7, 7);
        st.scale.y = 0.55;
        g.add(st);
      }
      return g;
    } },
  { id: "g_grassW", x: -8.05, z: 1.2, w: 2.1, d: 7.2, passable: true,
    build: () => ground(2.1, 7.2, 0, 0, T.grass, C.white, 0.003) },
  { id: "g_grassE", x: 8.1, z: 1.0, w: 2.0, d: 7.4, passable: true,
    build: () => ground(2.0, 7.4, 0, 0, T.grass, C.white, 0.003) },
  { id: "g_grassN", x: 0, z: -8.0, w: 17.6, d: 2.2, passable: true,
    build: () => ground(17.6, 2.2, 0, 0, T.grass, C.white, 0.003) },
  { id: "g_grassS", x: 0, z: 8.6, w: 17.6, d: 1.1, passable: true,
    build: () => ground(17.6, 1.1, 0, 0, T.grass, C.white, 0.003) },

  // ---- 门脸 ============================================================
  { id: "s_shop", x: 0, z: -0.1, w: 5.2, d: 3.6, build: shopHouse,
    interact: { x: -0.95, z: 2.2 } },

  // ---- 东南：柜台 + 货架 ==============================================
  { id: "s_counter", x: 0.7, z: 2.55, w: 1.9, d: 0.6, build: counter,
    interact: { x: 0.7, z: 3.7 } },
  { id: "s_shelf", x: 2.4, z: 2.05, w: 1.7, d: 0.4, build: shelf,
    interact: { x: 2.4, z: 3.1 } },

  // ---- 东北：长凳 + 王彩凤 + 豆角筐 + 树 + 绳 + 啤酒 ==================
  { id: "s_bench", x: 3.7, z: 2.5, w: 1.85, d: 0.5, seat: true, facing: 0,
    build: bench, interact: { x: 3.7, z: 3.65 } },
  { id: "s_veg", x: 4.35, z: 3.3, w: 0.55, d: 0.45, passable: true, build: vegBasket },
  { id: "s_tree", x: 5.1, z: 2.0, w: 0.75, d: 0.75, build: crookedTree },
  { id: "s_rope", x: 0, z: 0, w: 0.1, d: 0.1, passable: true,
    build: () => {
      const g = new THREE.Group();
      g.add(cord([[5.23, 0.9, 2.12], [5.1, 0.55, 2.85], [4.92, 0.16, 3.55]], 0.018, C.sand, 16));
      g.add(cy(0.035, 0.045, 0.5, mt(C.wood), 4.92, 0.25, 3.55, 6));
      g.add(b(0.1, 0.04, 0.1, mt(C.road), 4.92, 0.02, 3.55));
      return g;
    } },
  { id: "s_beer", x: 5.8, z: 3.15, w: 0.95, d: 0.7, build: beerCrates },

  // ---- 西南：冰柜 + 蛋 + 伞 + 台阶 + 拖鞋 =============================
  { id: "s_freezer", x: -4.15, z: 2.8, w: 1.2, d: 0.7, build: freezer,
    interact: { x: -4.15, z: 4.0 } },
  { id: "s_eggs", x: -5.4, z: 3.15, w: 1.45, d: 1.05, passable: true, build: eggBaskets },
  { id: "s_parasol", x: -5.15, z: 1.55, w: 0.65, d: 0.65, passable: true, build: parasol },
  { id: "s_steps", x: -0.95, z: 2.05, w: 2.6, d: 0.72, passable: true, build: steps },
  { id: "s_mat", x: -0.95, z: 2.78, w: 1.2, d: 0.74, passable: true, build: doorMat },
  { id: "s_slippers", x: -2.35, z: 2.55, w: 0.3, d: 0.3, passable: true, build: slippers },
  { id: "s_boxes", x: -3.3, z: 2.15, w: 0.65, d: 0.5, build: cardboardBoxes },
  { id: "s_bottles", x: -5.35, z: 2.3, w: 0.5, d: 0.35, passable: true, build: bottleCrate },
  { id: "s_broom", x: -2.62, z: 2.02, w: 0.28, d: 0.25, passable: true, build: broom },
  { id: "s_leaves", x: 1.25, z: 3.65, w: 0.6, d: 0.45, passable: true, build: leafPile },

  // ---- 院子边界 ========================================================
  { id: "s_westwall", x: -6.95, z: 1.4, w: 0.32, d: 6.6, build: westWall },
  { id: "s_eastfence", x: 7.0, z: 0.6, w: 0.18, d: 6.0, build: eastFence },
  { id: "s_backwall", x: 0, z: -6.95, w: 14.4, d: 0.3, build: backWall },
  { id: "s_backtrees", x: 0, z: 0, w: 0.1, d: 0.1, passable: true, build: backTrees },
  { id: "s_pole", x: 7.15, z: 5.2, w: 0.35, d: 0.35, build: utilityPole },
  { id: "s_wires", x: 0, z: 0, w: 0.1, d: 0.1, passable: true, build: wires },
  { id: "s_clothes", x: 0, z: 0, w: 0.1, d: 0.1, passable: true, build: clothesline },
  { id: "s_rearyard", x: 0, z: 0, w: 0.1, d: 0.1, passable: true, build: rearYard },

  // ---- 灌木与草：把四角填住 ===========================================
  { id: "s_bushW1", x: -7.9, z: 4.6, w: 0.9, d: 0.9, passable: true,
    build: () => bush(0, 0, 0.42, C.sea, C.mint) },
  { id: "s_bushW2", x: -8.2, z: -1.6, w: 0.8, d: 0.8, passable: true,
    build: () => bush(0, 0, 0.34, C.sea, C.mint) },
  { id: "s_bushE1", x: 8.0, z: -1.4, w: 0.8, d: 0.8, passable: true,
    build: () => bush(0, 0, 0.36, C.sea, C.mint) },
  { id: "s_bushE2", x: 7.9, z: 4.1, w: 0.8, d: 0.8, passable: true,
    build: () => bush(0, 0, 0.32, C.sea, C.mint) },
  { id: "s_bushN1", x: -6.4, z: -5.4, w: 0.9, d: 0.9, passable: true,
    build: () => bush(0, 0, 0.4, C.sea, C.mint) },
  { id: "s_bushN2", x: 5.7, z: -5.6, w: 0.9, d: 0.9, passable: true,
    build: () => bush(0, 0, 0.38, C.sea, C.mint) }
];

const obstacles = props.filter((p) => !p.passable).map((p) => ({ x: p.x, z: p.z, w: p.w, d: p.d }));
// 房子四周的院墙不收进障碍：walk 已经把主角关在门前场院里，翻墙没有意义

// 两个人：王彩凤坐长凳，路口一个背对镜头的人
const characters = [
  { id: "wang_caifeng", label: "王彩凤", name: "王彩凤", role: "小卖部店主",
    x: 3.7, z: 2.5, y: -0.01, facing: 0, pose: "sit",
    scale: 0.92, color: C.peach, pants: C.navy, hair: "#3a2c22" },
  { id: "amb_villager", label: "过路的村民", name: "过路的村民", role: "路过村民",
    x: 1.6, z: 6.3, facing: -2.5, pose: "stand",
    scale: 0.95, color: C.blue, pants: C.dark, hair: "#2e251e", ambient: true }
];

let scene;
try {
  scene = createScene({
    mount: document.getElementById("stage"),
    room: null,
    props,
    obstacles,
    characters,
    // 门前一盏暖光：照门框、门槛和地垫，让门里的黄灯管"溢"出来一点；
    // 不是把整个门洞打亮——内衬仍然要比门外暗一档。
    lamps: [
      { color: C.yellow, intensity: 1.2, distance: 2.2, x: -0.95, y: 1.25, z: 2.28 },
      { color: C.yellow, intensity: 1.8, distance: 2.6, x: 0.55, y: 2.15, z: 2.88 }
    ],
    siteColor: C.sand,
    baseColor: C.cream,
    baseSideColor: C.navy,
    terrainSideColor: C.wood,
    skyTop: C.glass, skyMid: C.white, skyBottom: C.cream,
    fogDensity: 0.0065,
    light: { sun: C.yellow, sunI: 2.55, fill: C.blue, fillI: 0.95, hemi: 0.76,
      hemiSky: C.white, hemiGround: C.sand, bounce: C.peach, bounceI: 0.32, exposure: 0.94 },
    actor: { x: -3.2, z: 5.15 },
    camYaw: 0.4, camPitch: 0.58, camDist: 13.5, camFocus: [0.45, 1.0, 2.1],
    walk: { x0: -6.65, x1: 6.65, z0: 1.62, z1: 7.0 },
    onSpot: (p) => { (window.__events = window.__events || []).push(["spot", p.id]); },
    onPerson: (p) => { (window.__events = window.__events || []).push(["person", p.id]); },
    onArrived: (p) => { (window.__events = window.__events || []).push(["arrived", +p.x.toFixed(2), +p.z.toFixed(2)]); },
    onSeat: (p) => { (window.__events = window.__events || []).push(["seat", p.id]); },
    // ---- 基础动效：10 条 2% 量级的循环
    onFrame: (t, dt) => {
      // 1. 冰柜绿色指示灯呼吸 + 压缩机带来的极细震动
      if (A.led) { A.led.emissiveIntensity = 1.05 + Math.sin(t * 2.1) * 0.18; }
      if (A.lid) {
        A.lid.position.y = 0.985 + Math.sin(t * 11.0) * 0.0015;
        A.lid.material.opacity = 0.4 + Math.sin(t * 8.5) * 0.008;
      }
      // 2. 遮阳伞布掀角 0.02 rad
      if (A.parasolFlap) {
        A.parasolFlap.rotation.x = A.parasolBase + Math.max(0, Math.sin(t * 0.85)) * 0.02;
      }
      if (A.parasolCanopy) { A.parasolCanopy.rotation.y = Math.sin(t * 0.6) * 0.004; }
      // 3. 塑料门帘一片片错开
      for (const c of A.curtains) {
        c.g.rotation.x = Math.sin(t * 1.5 + c.ph) * 0.03;
        c.g.rotation.z = Math.cos(t * 1.1 + c.ph * 1.3) * 0.028;
      }
      // 4. 歪脖子树树冠四团轻晃
      for (let i = 0; i < A.leaves.length; i++) {
        const m = A.leaves[i];
        m.position.x = m.userData.bx + Math.sin(t * 0.8 + i * 1.7) * 0.018;
        m.position.z = m.userData.bz + Math.cos(t * 0.65 + i * 2.1) * 0.014;
        m.rotation.z = Math.sin(t * 0.9 + i) * 0.007;
      }
      // 5. 王彩凤择菜的手：每隔几秒抬一下，幅度很小
      if (A.hand) {
        const lift = Math.pow(Math.max(0, Math.sin(t * 1.55)), 7);
        A.hand.position.y = A.handBase.y + lift * 0.024;
        A.hand.position.z = A.handBase.z - lift * 0.016;
        A.hand.rotation.z = -lift * 0.1;
      }
      // 6. 门口地垫的角被风掀起
      if (A.matCorner) {
        A.matCorner.rotation.x = A.matBase + Math.max(0, Math.sin(t * 0.95)) * 0.022;
        A.matCorner.rotation.z = Math.sin(t * 0.6) * 0.012;
      }
      // 7. 招牌灯箱微闪 1.8%
      if (A.signGlow) {
        A.signGlow.emissiveIntensity = 1.5 * (1 + Math.sin(t * 2.7) * 0.018);
      }
      // 8. 屋檐下的燕子：大部分时间停在窝里，偶尔飞出去绕一圈
      if (A.swallow) {
        const u = (t % 14) / 14;
        const flying = u < 0.34;
        if (flying) {
          const p = u / 0.34;
          const a = p * Math.PI * 2;
          A.swallow.position.set(
            2.35 + Math.sin(a) * 1.35,
            3.1 + Math.sin(p * Math.PI) * 0.75,
            1.88 + Math.sin(a * 0.5) * 2.3 + (1 - Math.cos(p * Math.PI)) * 0.7
          );
          A.swallow.rotation.y = Math.cos(a) * 0.9;
          A.swallow.rotation.z = Math.sin(a) * 0.15;
          for (const w of A.wings) {
            w.g.rotation.z = w.s * (0.25 + Math.sin(t * 19 + w.s) * 0.55);
          }
        } else {
          A.swallow.position.copy(A.swallowHome);
          A.swallow.rotation.set(0, 0, 0);
          for (const w of A.wings) { w.g.rotation.z = w.s * 0.08; }
        }
      }
      // 9. 雨棚下的挂灯轻摆
      if (A.bulb) {
        A.bulb.rotation.z = Math.sin(t * 1.2) * 0.018;
        A.bulb.rotation.x = Math.cos(t * 0.9) * 0.012;
      }
      // 10. 后院的晾衣绳：每件衣服的摆幅 0.02 rad
      for (let i = 0; i < A.clothes.length; i++) {
        const cg = A.clothes[i];
        cg.rotation.x = Math.sin(t * 0.9 + i * 1.4) * 0.018;
        cg.rotation.z = Math.cos(t * 0.7 + i) * 0.012;
      }
      // 边上那张旧告示的纸角
      if (A.flyer) { A.flyer.rotation.x = A.flyerBase + Math.sin(t * 1.9 + 0.6) * 0.02; }
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
