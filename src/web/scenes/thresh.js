// S8 · 村口晒谷场（上午 11:00）—— 张守义的体检单
// -----------------------------------------------------------------------------
// 按 docs/场景与人物建模提示词.md v5 §3 S8 重做（质量第一）。
// 这一场的判据只有一条：**空得好看**。一大片晒得发白的水泥场，四周一圈 0.24 高的
// 矮水泥沿把"空"框住，东北角一棵老槐树和树下那一小摊，其余全是留白——
// 但留白里要有分格线、有斜下来的裂缝、有扫帚扫过的浅色区、有影子、有麻雀。
//
//   ① 色彩：只用 kit 的 PAL（本文件零十六进制字面量）。水泥暖灰 sand、树冠暗绿 grass、
//      诊箱军绿 grass、收音机黑 dark，加 cream（晒白的那片 / 沿顶）、soil（土沿 / 树皮）、
//      road（铁件 / 竿）、white（纸）、tile（木 / 深色结构）、yellow（指示灯 / 谷粒）。
//   ② 零噪点：没有一张 canvas 贴图。分格线、裂缝、晒谷痕、树影、扫痕全是几何贴片。
//   ③ 描边：大件由 kit.b 自动加（最大边 > 0.55），小件不加。
//   ④ 四格：西北 木耙 + 簸箕两只 + 墙角草 / 东北 老槐树 + 马扎 + 打开的药箱 + 收音机
//            / 西南 通知栏 + 竹扫帚 + 矮沿 / 东南 晒过谷的浅色区 + 半袋谷子 + 三只麻雀。
//   ⑤ 视觉中心：树下打开的出诊药箱；次中心：南侧通知栏。
//   ⑥ onFrame 12 条 2% 量级循环：树冠风动 / 冠缘碎叶 / 树影缓移 / 麻雀跳啄 /
//      箱盖被风掀 / 天线轻晃 / 通知栏纸角一掀一落 / 树干上的小黑板轻摆 /
//      指示灯呼吸 / 裂缝里的五簇草 / 落叶被风推 / 竹扫帚的梢。
// -----------------------------------------------------------------------------
import * as THREE from "./vendor/three.module.min.js";
import { PAL as C, M, b, cy, ball, ground } from "./kit.js";
import { createScene } from "./scene3d.js";

window.__err = "";
window.addEventListener("error", (e) => {
  window.__err = (e.message || "error") + " @ " + (e.filename || "") + ":" + (e.lineno || 0);
});

// ---------------------------------------------------------------- 动画句柄
// 所有会动的部件在这里登记，onFrame 统一驱动；幅度一律 2% 量级。
const A = {
  canopy: null, leaf: [], shade: null, bird: [], lid: null, ant: null,
  corner: null, board: null, grass: [], leaves: [], broomTip: null, led: null
};

// ---------------------------------------------------------------- 小工具
// 确定性抖动：不用随机数，也不让每片叶子落在同一个角度上
const jit = (i) => (Math.sin(i * 2.399) + 1) / 2;

// 贴地薄片：不写深度、纯色，靠不透明度分档（分格线 / 裂缝 / 树影 / 扫痕全用它）
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

// 沿折线铺一条"带"：裂缝、扫痕都用它。w0→w1 收尖，像真的裂开。
function strip(pts, w0, w1, color, y, op) {
  const g = new THREE.Group();
  const n = Math.max(1, pts.length - 1);
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const w = w0 + (w1 - w0) * (i / n);
    g.add(flat(w, len + 0.03, color, (x0 + x1) / 2, y, (z0 + z1) / 2, op, Math.atan2(dx, dz)));
  }
  return g;
}

// 不规则圆斑：晒白的谷痕、树影、水泥的抹痕（比矩形贴片耐看，且不是噪点）
function blobShape(rx, rz, ph) {
  const s = new THREE.Shape();
  const N = 26;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = 1 + 0.055 * Math.sin(a * 3 + ph) + 0.035 * Math.sin(a * 5 + ph * 2.3);
    const x = Math.cos(a) * rx * r, y = Math.sin(a) * rz * r;
    if (i) { s.lineTo(x, y); } else { s.moveTo(x, y); }
  }
  return s;
}
function blob(rx, rz, color, x, y, z, op, ph = 0) {
  const m = new THREE.Mesh(new THREE.ShapeGeometry(blobShape(rx, rz, ph)),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide
    }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

// 一截木头：从 a 点长到 b 点，r1→r2 收细。树干、枝、根、帚柄全靠它。
function limb(ax, ay, az, bx, by, bz, r1, r2, color, seg = 7) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  const g = new THREE.Group();
  g.add(cy(r2, r1, len, color, 0, len / 2, 0, seg));
  g.position.set(ax, ay, az);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(dx, dy, dz).normalize());
  return g;
}

// 一簇草：九片叶子从一小撮土里往外倒，比一蓬球像草，也比放射状的"蜘蛛"收得住
function tuft(n = 9, h = 0.22, r = 0.045) {
  const g = new THREE.Group();
  g.add(cy(0.048, 0.056, 0.018, C.tile, 0, 0.009, 0, 6));
  for (let i = 0; i < n; i++) {
    const a = i * 2.399;
    const bh = h * (0.68 + jit(i) * 0.48);
    const rr = r * (0.35 + jit(i + 5) * 0.75);
    const bl = b(0.011, bh, 0.02, C.grass,
      Math.cos(a) * rr, bh * 0.46, Math.sin(a) * rr, { outline: false });
    bl.rotation.z = -Math.cos(a) * 0.30;
    bl.rotation.x = Math.sin(a) * 0.30;
    g.add(bl);
  }
  return g;
}

// 接触阴影：物件脚下一小片很淡的暗斑。缺了它，所有东西都像浮在水泥上。
function contactShadows() {
  const g = new THREE.Group();
  const spots = [
    [0.44, 0.34, 2.26, -2.14], [0.24, 0.18, 1.92, -3.42], [0.38, 0.30, 2.90, -2.90],
    [0.32, 0.31, 3.52, -2.28], [0.20, 0.20, 1.98, -1.86], [0.34, 0.34, -5.92, -4.42],
    [0.32, 0.32, -5.56, -3.78], [0.32, 0.30, -6.42, -3.95], [0.40, 0.34, 6.78, 1.86],
    [0.34, 0.34, -2.62, 4.66], [0.22, 0.16, -6.55, 5.18], [1.32, 0.42, -3.62, 4.72],
    // 三堆谷的脚下：没有这一圈，锥体会被看成平摊在地上的黄饼
    [0.50, 0.46, 2.05, 2.01], [0.40, 0.36, 2.92, 1.83], [0.30, 0.28, 1.06, 2.19]
  ];
  for (let i = 0; i < spots.length; i++) {
    const [rx, rz, x, z] = spots[i];
    g.add(blob(rx, rz, C.tile, x, 0.019, z, 0.10, i * 0.9));
  }
  return g;
}

// ---------------------------------------------------------------- 地面：分格线 / 裂缝 / 晒痕
// 15×12 的水泥场被分格线切成 5×4 块，这是"尺度"的唯一来源。
// 线不做等粗等深：有的高一档、有的缺一段，才像一块一块浇出来的。
function joints() {
  const g = new THREE.Group();
  const X = [-4.5, -1.5, 1.5, 4.5];
  const Z = [-3.0, 0, 3.0];
  for (let i = 0; i < X.length; i++) {
    const x = X[i], op = [0.13, 0.09, 0.11, 0.08][i];
    g.add(flat(0.05, 11.9, C.tile, x, 0.020, 0, op));
    g.add(flat(0.022, 11.9, C.cream, x + 0.036, 0.0205, 0, 0.09));   // 缝的一侧被磨亮
  }
  for (let i = 0; i < Z.length; i++) {
    const z = Z[i], op = [0.10, 0.14, 0.08][i];
    g.add(flat(14.9, 0.05, C.tile, 0, 0.020, z, op));
    g.add(flat(14.9, 0.022, C.cream, 0, 0.0205, z + 0.036, 0.08));
  }
  // 抹痕：三块极淡的大斑，破掉"一整块色板"的平
  g.add(blob(3.4, 2.1, C.soil, -3.6, 0.018, -2.4, 0.05, 0.4));
  g.add(blob(2.6, 1.7, C.soil, 3.2, 0.018, 3.4, 0.04, 1.7));
  g.add(blob(2.1, 1.5, C.cream, -1.4, 0.018, 4.3, 0.06, 2.9));
  return g;
}

// 裂缝：从北边的沿根斜下来，越往南越细，边上一条磨亮的白边
function crackLines() {
  const g = new THREE.Group();
  const p = [
    [-2.55, -5.62], [-2.77, -4.72], [-2.45, -3.86], [-2.69, -2.98],
    [-2.37, -2.12], [-2.51, -1.22], [-2.21, -0.36], [-2.37, 0.52], [-2.07, 1.36]
  ];
  g.add(strip(p, 0.055, 0.014, C.tile, 0.024, 0.5));
  // 两条分叉
  g.add(strip([[-2.69, -2.98], [-3.21, -2.62], [-3.59, -2.02]], 0.026, 0.008, C.tile, 0.024, 0.36));
  g.add(strip([[-2.37, -2.12], [-1.87, -1.86], [-1.51, -1.42]], 0.022, 0.007, C.tile, 0.024, 0.32));
  // 裂缝里长出的五簇草
  const spots = [[-2.65, -4.36], [-2.53, -2.62], [-2.33, -0.74], [-2.41, 0.34], [-2.15, 1.28]];
  for (let i = 0; i < spots.length; i++) {
    const t = tuft(6 + (i % 2), 0.15 + (i % 3) * 0.045, 0.04);
    t.position.set(spots[i][0], 0.016, spots[i][1]);
    t.rotation.y = i * 1.1;
    g.add(t);
    A.grass.push({ o: t, ph: i * 1.3 });
  }
  return g;
}

// 今天晒的谷子：八道耙出来的谷垄 + 三堆扫拢的谷堆。
// 谷子必须有"堆起来"的体积——一片平贴的浅色块骗不过眼睛。
// 谷垄是半埋进水泥里的圆柱（拔起来有圆背），谷堆是带平顶的锥（摊晒后都是平的）。
function grainField() {
  const g = new THREE.Group();
  // 1) 摊开的谷层：晒谷是"摊成一床"的，不是一摊水——边缘走直线、四角倒圆，
  //    挤出 5 厘米厚，侧面看得见厚度，边上才会在水泥上落一条影子。
  const hw = 2.62, hd = 1.58, cr = 0.32;
  const s = new THREE.Shape();
  s.moveTo(-hw + cr, -hd);
  s.lineTo(-0.85, -hd + 0.04); s.lineTo(0.9, -hd - 0.02); s.lineTo(hw - cr, -hd);
  s.quadraticCurveTo(hw, -hd, hw, -hd + cr);
  s.lineTo(hw, -0.5); s.lineTo(hw - 0.04, 0.62); s.lineTo(hw, hd - cr);
  s.quadraticCurveTo(hw, hd, hw - cr, hd);
  s.lineTo(0.72, hd - 0.03); s.lineTo(-1.1, hd + 0.02); s.lineTo(-hw + cr, hd);
  s.quadraticCurveTo(-hw, hd, -hw, hd - cr);
  s.lineTo(-hw + 0.03, 0.4); s.lineTo(-hw, -hd + cr);
  s.quadraticCurveTo(-hw, -hd, -hw + cr, -hd);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: false, curveSegments: 4 });
  geo.rotateX(-Math.PI / 2);
  const carpet = new THREE.Mesh(geo, M(C.yellow));
  carpet.position.set(0, 0.012, 0);
  carpet.castShadow = true;
  carpet.receiveShadow = true;
  g.add(carpet);
  // 2) 十一道耙出来的谷垄：半埋在谷层里的细圆柱，拔起来有圆背，两头收尖。
  //    间距、长短都错开一点——等距等长的话，一眼就是一块搓衣板。
  for (let i = 0; i < 11; i++) {
    const z = -1.42 + i * 0.30 + Math.sin(i * 2.1) * 0.026;
    const wob = Math.sin(i * 1.7) * 0.04;
    const x0 = -2.24 + (i % 3) * 0.14, x1 = 2.24 - ((i * 3) % 4) * 0.18;
    const xm = x0 + (x1 - x0) * (0.42 + 0.14 * Math.sin(i * 1.3));
    g.add(limb(x0, 0.050, z + wob, xm, 0.086, z, 0.016, 0.070, C.yellow, 6));
    g.add(limb(xm, 0.086, z, x1, 0.050, z - wob * 0.6, 0.070, 0.015, C.yellow, 6));
  }
  // 3) 垄沟里压暗的一条：不加这条，十一道圆背会连成一整块黄板；
  //    颜色必须是深的（沟里是阴影），用 sand 会在黄底上拉出一道道白印子。
  for (let i = 0; i < 10; i++) {
    const z = -1.27 + i * 0.30 + Math.sin(i * 2.1) * 0.026;
    g.add(flat(4.2 - (i % 3) * 0.34, 0.06, C.tile, 0.05 * Math.sin(i), 0.065, z, 0.13));
  }
  // 4) 三堆扫拢的谷堆：从谷床边上扫出来、等着装袋的三堆，锥要够陡才有"堆"的样子
  const piles = [[1.15, 2.16, 0.42, 0.44], [2.02, 1.98, 0.32, 0.33], [0.16, 2.34, 0.24, 0.24]];
  for (let i = 0; i < piles.length; i++) {
    const px = piles[i][0], pz = piles[i][1], pr = piles[i][2], ph = piles[i][3];
    const cone = cy(pr * 0.22, pr, ph, C.yellow, px, ph * 0.5, pz, 18);
    cone.scale.set(1.06 - i * 0.03, 1, 0.94 + i * 0.03);       // 不许是正圆：扫出来的堆没有正圆的
    cone.rotation.y = 0.7 + i * 1.3;
    g.add(cone);
    for (let k = 0; k < 6; k++) {                                              // 堆顶上散着的几粒
      const a = k * 2.399 + i * 1.1;
      g.add(flat(0.05, 0.03, C.cream, px + Math.cos(a) * pr * 0.24,
        ph + 0.004, pz + Math.sin(a) * pr * 0.24, 0.9, a));
    }
    for (let k = 0; k < 10; k++) {                                             // 堆脚散落的谷粒
      const a = k * 2.399 + i * 1.7;
      g.add(flat(0.055, 0.032, C.yellow, px + Math.cos(a) * (pr + 0.09),
        0.016, pz + Math.sin(a) * (pr + 0.09), 0.85, a));
    }
  }
  // 5) 谷层边上还没扫进去的几粒
  for (let i = 0; i < 20; i++) {
    const a = i * 2.399;
    const rr = 0.94 + jit(i) * 0.14;
    g.add(flat(0.05, 0.028, i % 3 ? C.yellow : C.sand,
      Math.cos(a) * (hw + 0.22) * rr, 0.018, Math.sin(a) * (hd + 0.22) * rr, 0.8, a));
  }
  return g;
}

// 树影：一层比真阴影更大更淡的软斑，跟着风极缓地挪一点（"树影缓移"）
// 只做在真影子里"多出来"的那一圈，不另起一摊——否则会像地上有一片水。
function treeShade() {
  const g = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const a = i * 1.9 + 0.4;
    const r = 0.35 + (i % 4) * 0.52;
    const rx = 0.62 + (i % 3) * 0.34;
    g.add(blob(rx, rx * 0.80, C.tile,
      Math.cos(a) * r, 0.022 + i * 0.0004, Math.sin(a) * r * 0.8,
      0.030 + (i % 3) * 0.010, i * 0.7));
  }
  A.shade = g;
  return g;
}

// ---------------------------------------------------------------- 老槐树
function locustTree() {
  const g = new THREE.Group();

  // 根盘：一圈被踩实的土 + 五条露出来的根
  g.add(blob(1.05, 0.92, C.tile, 0.05, 0.014, -0.05, 0.18, 1.1));
  g.add(blob(0.72, 0.62, C.soil, 0.0, 0.018, 0.0, 0.35, 2.4));
  g.add(cy(0.30, 0.52, 0.24, C.tile, 0, 0.12, 0, 12));            // 根颈
  g.add(cy(0.27, 0.34, 0.22, C.tile, 0, 0.33, 0, 12));
  for (let i = 0; i < 5; i++) {
    const a = [0.35, 1.62, 2.75, 4.05, 5.25][i];
    const len = 0.78 + (i % 3) * 0.16;
    g.add(limb(Math.cos(a) * 0.26, 0.14, Math.sin(a) * 0.26,
      Math.cos(a) * len, 0.012, Math.sin(a) * len,
      0.10 - (i % 2) * 0.015, 0.028, C.soil, 6));
  }

  // 主干：两段带一点点弯，锥度收得狠，老树才有"脖子"
  g.add(limb(0, 0.06, 0, 0.10, 2.24, 0.05, 0.30, 0.205, C.soil, 10));
  g.add(limb(0.10, 2.24, 0.05, 0.18, 3.16, 0.02, 0.205, 0.145, C.soil, 10));

  // 树皮的纵向裂：几片深色的窄板贴着干走（跟着主干的轴线与收细，不然会飘在半空）
  const axisX = (y) => (y <= 2.24
    ? 0.10 * (y / 2.24)
    : 0.10 + 0.08 * ((y - 2.24) / 0.92));
  const axisZ = (y) => (y <= 2.24
    ? 0.05 * (y / 2.24)
    : 0.05 - 0.03 * ((y - 2.24) / 0.92));
  const trunkR = (y) => (y <= 2.24
    ? 0.30 + (0.205 - 0.30) * (y / 2.24)
    : 0.205 + (0.145 - 0.205) * Math.min(1, (y - 2.24) / 0.92));
  for (let i = 0; i < 6; i++) {
    const a = i * 1.05 + 0.3;
    const y = 0.62 + (i % 4) * 0.46;
    const rr = trunkR(y) - 0.006;
    const pl = b(0.05, 0.40 + (i % 3) * 0.14, 0.02, C.tile,
      axisX(y) + Math.cos(a) * rr, y, axisZ(y) + Math.sin(a) * rr, { outline: false });
    pl.rotation.y = -a + Math.PI / 2;
    pl.rotation.z = (i % 2 ? 1 : -1) * 0.04;
    g.add(pl);
  }
  // 一个树疤
  const knot = cy(0.085, 0.085, 0.03, C.tile, axisX(1.15) + 0.20, 1.15, axisZ(1.15) + 0.12, 10);
  knot.rotation.x = Math.PI / 2;
  knot.rotation.z = 0.5;
  g.add(knot);

  // 四根主枝 + 八根次枝
  const tips = [
    [1.92, 4.02, -0.62], [-1.42, 4.18, -0.78], [0.62, 3.92, 1.82], [-0.42, 4.38, 0.58]
  ];
  for (let i = 0; i < tips.length; i++) {
    const t = tips[i];
    g.add(limb(0.18, 3.16, 0.02, t[0], t[1], t[2], 0.135 - i * 0.012, 0.052, C.soil, 7));
    for (let k = 0; k < 2; k++) {
      const s = k ? 1 : -1;
      const ex = t[0] + s * (0.42 + i * 0.05), ey = t[1] + 0.52 + k * 0.16;
      const ez = t[2] + (k ? 0.5 : -0.36);
      g.add(limb(t[0], t[1], t[2], ex, ey, ez, 0.05, 0.022, C.soil, 5));
    }
  }

  // 树冠：三层。上层晒着、中层撑开、下层压暗——一团球是长不出"树"的。
  // 团子偏小、数量偏多：三渲二的大球在大光圈里会露出多边形的棱，小团叠起来才有叶簇的碎。
  const canopy = new THREE.Group();
  canopy.position.set(0.12, 4.92, 0.06);
  for (let i = 0; i < 16; i++) {                                   // 上层（受光）
    const a = i * 2.399, r = 0.60 + (i % 4) * 0.38;
    const bl = ball(0.38 + (i % 3) * 0.07, C.grass,
      Math.cos(a) * r, 0.46 + (i % 3) * 0.19, Math.sin(a) * r * 0.86, 8);
    bl.scale.set(1.20, 0.66, 1.18);
    canopy.add(bl);
  }
  for (let i = 0; i < 20; i++) {                                   // 中层（撑开）
    const a = i * 2.399 + 0.9, r = 1.02 + (i % 5) * 0.34;
    const bl = ball(0.40 + (i % 4) * 0.06, C.grass,
      Math.cos(a) * r, 0.06 + (i % 3) * 0.15, Math.sin(a) * r * 0.86, 8);
    bl.scale.set(1.22, 0.64, 1.18);
    canopy.add(bl);
  }
  for (let i = 0; i < 12; i++) {                                   // 下层（暗）
    const a = i * 2.399 + 2.1, r = 0.60 + (i % 4) * 0.34;
    const bl = ball(0.34 + (i % 3) * 0.05, C.tile,
      Math.cos(a) * r, -0.40 - (i % 2) * 0.10, Math.sin(a) * r * 0.9, 8);
    bl.scale.set(1.16, 0.56, 1.12);
    canopy.add(bl);
  }
  // 树冠边上的一百片碎叶：破掉"球"的轮廓，风一起最先动的也是它们
  for (let i = 0; i < 110; i++) {
    const a = i * 2.399;
    const r = 1.30 + jit(i) * 1.16;
    const y = 0.44 - jit(i + 3) * 1.02;
    const lf = ball(0.072 + jit(i + 11) * 0.045, i % 4 ? C.grass : C.tile,
      Math.cos(a) * r, y, Math.sin(a) * r * 0.86, 6);
    lf.scale.set(1.35, 0.44, 1.0);
    lf.rotation.y = a;
    canopy.add(lf);
    if (i % 11 === 0) { A.leaf.push({ o: lf, x: lf.position.x, z: lf.position.z, ph: i }); }
  }
  g.add(canopy);
  A.canopy = canopy;
  return g;
}

// ---------------------------------------------------------------- 树下那一摊
function stool() {                                  // 马扎：帆布面 0.40 高
  const g = new THREE.Group();
  g.add(b(0.46, 0.022, 0.33, C.cream, 0, 0.40, 0));          // 帆布面
  g.add(b(0.47, 0.016, 0.30, C.sand, 0, 0.392, 0));          // 布面下的衬
  for (const sx of [-1, 1]) {                                 // 两根横档
    g.add(b(0.035, 0.035, 0.40, C.wood, sx * 0.215, 0.40, 0));
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {       // 四根斜腿
    const leg = b(0.032, 0.44, 0.032, C.wood, sx * 0.20, 0.20, sz * 0.155);
    leg.rotation.x = sz * 0.10;
    leg.rotation.z = -sx * 0.10;
    g.add(leg);
  }
  g.add(b(0.40, 0.026, 0.026, C.wood, 0, 0.16, 0));           // 下横撑
  g.add(b(0.026, 0.026, 0.30, C.wood, 0, 0.115, 0));
  // 帆布上的两道坐痕
  for (let i = 0; i < 2; i++) {
    g.add(b(0.40, 0.004, 0.02, C.sand, 0, 0.412, -0.06 + i * 0.12, { outline: false }));
  }
  return g;
}

function kitOpen() {                                // 打开的出诊药箱（f_e07 的物证）
  const g = new THREE.Group();
  g.add(b(0.66, 0.22, 0.44, C.grass, 0, 0.11, 0));                 // 箱体（军绿）
  g.add(b(0.68, 0.03, 0.46, C.tile, 0, 0.235, 0));                 // 箱口压边
  g.add(b(0.60, 0.02, 0.38, C.cream, 0, 0.238, 0));                // 内衬布
  g.add(b(0.66, 0.05, 0.03, C.tile, 0, 0.10, 0.225));              // 前面的搭扣带
  g.add(b(0.07, 0.05, 0.012, C.dark, 0, 0.10, 0.238));             // 锁扣

  // 盖：铰在箱口后沿，向后掀开 71°，风一来还会再抬一点
  const hinge = new THREE.Group();
  hinge.position.set(0, 0.25, -0.215);
  hinge.add(b(0.66, 0.05, 0.44, C.grass, 0, 0.012, -0.22));
  hinge.add(b(0.60, 0.028, 0.38, C.tile, 0, 0.042, -0.22));         // 盖内衬
  hinge.add(b(0.56, 0.012, 0.34, C.sand, 0, 0.056, -0.22));         // 盖里夹着的一张处方
  for (let i = 0; i < 3; i++) {
    hinge.add(b(0.36 - i * 0.05, 0.004, 0.012, C.tile, -0.06, 0.063,
      -0.12 - i * 0.06, { outline: false }));
  }
  hinge.rotation.x = -1.24;
  g.add(hinge);
  A.lid = hinge;

  // 血压计：盒 + 表盘 + 袖带
  g.add(b(0.24, 0.055, 0.17, C.white, -0.15, 0.275, 0.03));
  g.add(b(0.24, 0.008, 0.02, C.tile, -0.15, 0.30, 0.115, { outline: false }));
  g.add(cy(0.05, 0.05, 0.022, C.white, -0.15, 0.318, -0.02, 14));   // 表盘
  const needle = b(0.006, 0.032, 0.004, C.dark, -0.15, 0.332, -0.002, { outline: false });
  needle.rotation.z = -0.5;
  g.add(needle);
  g.add(b(0.17, 0.045, 0.10, C.glass, -0.02, 0.272, 0.10));        // 袖带
  const tube = cy(0.009, 0.009, 0.16, C.dark, -0.09, 0.29, 0.13, 5);
  tube.rotation.z = 1.15;
  g.add(tube);

  // 听诊器：一段黑胶管 + 一个胸件
  g.add(limb(0.14, 0.30, 0.02, 0.24, 0.29, 0.09, 0.009, 0.009, C.dark, 5));
  g.add(limb(0.24, 0.29, 0.09, 0.20, 0.285, -0.05, 0.009, 0.009, C.dark, 5));
  g.add(cy(0.035, 0.035, 0.012, C.road, 0.20, 0.29, -0.06, 12));

  // 药瓶两只（无字的棕色小瓶，不写药名）
  g.add(cy(0.036, 0.036, 0.11, C.glass, 0.10, 0.30, -0.11, 10));
  g.add(cy(0.038, 0.038, 0.016, C.tile, 0.10, 0.362, -0.11, 10));
  g.add(cy(0.028, 0.028, 0.085, C.cream, 0.17, 0.288, -0.13, 8));
  g.add(cy(0.030, 0.030, 0.014, C.grass, 0.17, 0.336, -0.13, 8));
  return g;
}

function radioSet() {                               // 收音机：戏曲从这只小喇叭里出来
  const g = new THREE.Group();
  g.add(b(0.30, 0.17, 0.13, C.dark, 0, 0.085, 0));
  g.add(b(0.31, 0.018, 0.14, C.tile, 0, 0.178, 0));                 // 顶盖
  g.add(b(0.31, 0.022, 0.14, C.tile, 0, 0.011, 0));                 // 底座
  for (let i = 0; i < 7; i++) {                                      // 喇叭格栅
    g.add(b(0.13, 0.009, 0.005, C.tile, -0.055, 0.042 + i * 0.019, 0.067, { outline: false }));
  }
  g.add(b(0.02, 0.12, 0.006, C.tile, -0.055, 0.10, 0.069, { outline: false }));
  g.add(b(0.10, 0.055, 0.006, C.cream, 0.082, 0.118, 0.067));        // 调谐窗
  for (let i = 0; i < 4; i++) {
    g.add(b(0.006, 0.03, 0.003, C.tile, 0.045 + i * 0.026, 0.118, 0.071, { outline: false }));
  }
  g.add(b(0.008, 0.04, 0.004, C.coral, 0.062, 0.118, 0.072, { outline: false }));
  g.add(cy(0.024, 0.024, 0.022, C.road, 0.082, 0.048, 0.070, 10));   // 旋钮
  g.add(cy(0.024, 0.024, 0.022, C.road, 0.082, 0.098, 0.070, 10));
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.012, 0.005),
    M(C.yellow, { emissive: C.yellow, emissiveIntensity: 1.2 }));
  led.position.set(-0.125, 0.152, 0.069);
  g.add(led);
  A.led = led;

  // 拉杆天线：抽出一半，两节
  const ant = new THREE.Group();
  ant.position.set(0.115, 0.185, -0.02);
  ant.add(cy(0.0065, 0.0055, 0.30, C.road, 0, 0.15, 0, 5));
  ant.add(cy(0.0042, 0.0038, 0.28, C.road, 0, 0.43, 0, 5));
  ant.add(cy(0.008, 0.008, 0.022, C.tile, 0, 0.005, 0, 8));
  ant.rotation.z = -0.20;
  ant.rotation.x = 0.10;
  g.add(ant);
  A.ant = ant;

  // 提手
  g.add(limb(-0.13, 0.19, 0, -0.10, 0.235, 0, 0.006, 0.006, C.tile, 4));
  g.add(limb(0.13, 0.19, 0, 0.10, 0.235, 0, 0.006, 0.006, C.tile, 4));
  g.add(limb(-0.10, 0.235, 0, 0.10, 0.235, 0, 0.008, 0.008, C.wood, 4));
  return g;
}

function treeBoard() {                              // 树干上挂的小黑板（abstract 两行字）
  const g = new THREE.Group();
  g.add(b(0.50, 0.36, 0.035, C.wood, 0, 0, 0));
  g.add(b(0.43, 0.29, 0.02, C.dark, 0, 0, 0.026));
  g.add(b(0.32, 0.018, 0.006, C.cream, -0.02, 0.075, 0.038, { outline: false }));
  g.add(b(0.24, 0.014, 0.006, C.cream, -0.05, 0.028, 0.038, { outline: false }));
  g.add(b(0.28, 0.014, 0.006, C.cream, -0.03, -0.018, 0.038, { outline: false }));
  g.add(b(0.10, 0.03, 0.006, C.cream, 0.14, -0.10, 0.038, { outline: false }));  // 一行短短的签名
  g.add(cy(0.005, 0.005, 0.20, C.road, 0, 0.27, 0.01, 4));                        // 挂绳
  g.add(cy(0.012, 0.012, 0.012, C.road, 0, 0.37, 0.01, 6));                       // 钉子
  return g;
}

function strawHat() {                               // 草帽（扣在场边，没挂在树上）
  const g = new THREE.Group();
  g.add(cy(0.27, 0.27, 0.018, C.sand, 0, 0.012, 0, 24));
  g.add(cy(0.155, 0.155, 0.012, C.cream, 0, 0.026, 0, 20));
  g.add(cy(0.105, 0.145, 0.105, C.sand, 0, 0.078, 0, 18));
  g.add(cy(0.148, 0.148, 0.026, C.wood, 0, 0.036, 0, 18));
  g.add(cy(0.10, 0.10, 0.012, C.cream, 0, 0.128, 0, 16));
  g.rotation.z = 0.06;
  return g;
}

function enamelCup() {                              // 搪瓷缸
  const g = new THREE.Group();
  g.add(cy(0.062, 0.052, 0.125, C.white, 0, 0.0625, 0, 14));
  g.add(cy(0.064, 0.064, 0.012, C.blue, 0, 0.129, 0, 14));
  g.add(cy(0.055, 0.055, 0.006, C.dark, 0, 0.1265, 0, 14));        // 缸里剩下的茶底
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.008, 6, 10), M(C.white));
  handle.position.set(0.066, 0.075, 0);
  g.add(handle);
  return g;
}

function sparrow() {
  const g = new THREE.Group();
  const body = ball(0.098, C.soil, 0, 0.115, 0, 9);
  body.scale.set(0.90, 0.84, 1.30);
  g.add(body);
  const belly = ball(0.072, C.sand, 0, 0.095, 0.03, 8);
  belly.scale.set(0.88, 0.70, 1.05);
  g.add(belly);
  const head = new THREE.Group();                                   // 头单独一组，方便啄
  head.position.set(0, 0.155, 0.075);
  head.add(ball(0.068, C.soil, 0, 0.01, 0, 9));
  head.add(ball(0.05, C.sand, 0, -0.012, 0.024, 8));
  const beak = cy(0.006, 0.014, 0.045, C.tile, 0, -0.002, 0.072, 5);
  beak.rotation.x = Math.PI / 2;
  head.add(beak);
  for (const sx of [-1, 1]) {
    head.add(ball(0.012, C.ink, sx * 0.045, 0.03, 0.028, 6));
  }
  g.add(head);
  for (const sx of [-1, 1]) {                                        // 收起来的翅
    const w = ball(0.055, C.tile, sx * 0.062, 0.135, -0.02, 7);
    w.scale.set(0.55, 0.85, 1.30);
    g.add(w);
  }
  const tail = b(0.055, 0.014, 0.14, C.tile, 0, 0.115, -0.155);
  tail.rotation.x = 0.28;
  g.add(tail);
  for (const sx of [-1, 1]) {                                        // 两条细腿
    g.add(cy(0.006, 0.006, 0.075, C.tile, sx * 0.028, 0.038, 0.02, 4));
  }
  g.userData.head = head;
  return g;
}

// 麻雀：每只在场上都有自己的周期（跳两步、啄一下、抬头），谁也不跟谁同步
function birdProp(i) {
  const g = sparrow();
  const yaw = [0.6, 2.2, -1.1][i];
  g.rotation.y = yaw;
  A.bird.push({ o: g, head: g.userData.head, ph: [0.3, 2.4, 4.1][i],
    per: [4.6, 5.7, 5.1][i], baseYaw: yaw });
  return g;
}

function rake() {                                   // 木耙：五齿
  const g = new THREE.Group();
  g.add(cy(0.028, 0.032, 1.55, C.wood, 0, 0.78, 0, 7));
  g.add(b(0.52, 0.055, 0.06, C.wood, 0, 0.06, 0));
  for (let i = 0; i < 5; i++) {
    const t = cy(0.014, 0.020, 0.17, C.wood, -0.20 + i * 0.10, 0.02, 0.005, 5);
    t.rotation.x = 0.16;
    g.add(t);
  }
  g.add(b(0.1, 0.05, 0.03, C.tile, 0, 0.09, 0.02));                 // 耙头的藤箍
  g.rotation.z = 0.26;
  g.rotation.x = -0.05;
  return g;
}

function winnowBasket() {                           // 簸箕：浅口、放射状竹篾
  const g = new THREE.Group();
  g.add(cy(0.29, 0.23, 0.085, C.wood, 0, 0.043, 0, 16));
  g.add(cy(0.255, 0.255, 0.012, C.sand, 0, 0.086, 0, 16));
  g.add(cy(0.30, 0.30, 0.018, C.tile, 0, 0.088, 0, 16));
  for (let i = 0; i < 12; i++) {                                     // 篾条
    const a = i * 0.524;
    const s = b(0.012, 0.012, 0.25, i % 2 ? C.sand : C.soil,
      Math.cos(a) * 0.15, 0.092, Math.sin(a) * 0.15);
    s.rotation.y = -a + Math.PI / 2;
    g.add(s);
  }
  g.add(cy(0.055, 0.055, 0.02, C.tile, 0, 0.098, 0, 10));            // 中间那撮谷壳
  return g;
}

function grainSack() {                              // 半袋谷子，靠在矮沿上
  const g = new THREE.Group();
  const body = ball(0.26, C.sand, 0, 0.22, 0, 12);
  body.scale.set(1.04, 1.10, 0.92);
  g.add(body);
  // 三道竖褶：一光滑的蛋形撑不起"布"这件事
  for (let i = 0; i < 3; i++) {
    const a = 0.55 + i * 1.95;
    const cr = b(0.018, 0.30, 0.026, C.soil,
      Math.cos(a) * 0.245, 0.20, Math.sin(a) * 0.215, { outline: false });
    cr.rotation.y = -a;
    cr.rotation.z = 0.05;
    g.add(cr);
  }
  // 翻下来的袋口：三层，最上面露出一点谷
  g.add(cy(0.155, 0.205, 0.10, C.sand, 0, 0.40, 0.01, 14));
  g.add(cy(0.15, 0.17, 0.045, C.cream, 0, 0.46, 0.01, 14));          // 翻边
  g.add(cy(0.10, 0.115, 0.05, C.soil, 0, 0.455, 0.01, 12));          // 袋口里的谷
  g.add(cy(0.078, 0.078, 0.026, C.tile, 0.02, 0.44, -0.10, 10));     // 系口的绳
  g.add(limb(0.02, 0.44, -0.10, 0.14, 0.30, -0.20, 0.008, 0.006, C.tile, 4));
  // 袋口漏出来的几粒
  for (let i = 0; i < 12; i++) {
    const a = i * 2.399;
    g.add(flat(0.045, 0.028, C.yellow, Math.cos(a) * 0.09, 0.006,
      0.22 + Math.sin(a) * 0.06, 0.8, a));
  }
  g.rotation.z = -0.05;
  return g;
}

function bambooBroom() {                            // 大竹扫帚：场子是被它扫空的
  const g = new THREE.Group();
  // 柄斜着靠在场沿上：不从整组绕原点转，否则竹梢会一头扎进地里
  const ax = 0.02, az = 0.0;                        // 根（贴地）
  const tx = 0.46, tz = 0.12;                       // 柄梢
  g.add(limb(ax, 0.02, az, tx, 1.54, tz, 0.030, 0.023, C.wood, 6));
  const k = 0.34;                                   // 捆扎点在柄长的三成处
  const bx = ax + (tx - ax) * k, bz = az + (tz - az) * k, by = 0.02 + 1.52 * k;
  g.add(cy(0.052, 0.046, 0.15, C.tile, bx, by, bz, 8));               // 捆扎
  g.add(cy(0.044, 0.044, 0.022, C.soil, bx, by + 0.06, bz, 8));       // 上箍
  const tipGrp = new THREE.Group();
  for (let i = 0; i < 17; i++) {                                      // 十七根竹梢，落地铺开
    const a = i * 2.399;
    const rr = 0.24 + jit(i) * 0.20;
    tipGrp.add(limb(bx + Math.cos(a) * 0.035, by - 0.055, bz + Math.sin(a) * 0.035,
      bx + Math.cos(a) * rr, 0.006, bz + Math.sin(a) * rr * 0.85,
      0.012, 0.005, i % 3 ? C.sand : C.soil, 4));
  }
  g.add(tipGrp);
  A.broomTip = tipGrp;
  return g;
}

function noticeBoard(w) {                           // 通知栏 2.6×1.0：三张纸，一张掀角
  const g = new THREE.Group();
  const H = 1.42;
  for (const sx of [-1, 1]) {                                       // 两根立杆 + 混凝土墩
    g.add(b(0.09, 1.96, 0.09, C.road, sx * (w / 2 - 0.14), 0.98, 0));
    g.add(b(0.22, 0.10, 0.22, C.tile, sx * (w / 2 - 0.14), 0.05, 0));
  }
  g.add(b(w, 1.08, 0.07, C.wood, 0, H, 0));                          // 外框
  g.add(b(w - 0.10, 0.98, 0.035, C.cream, 0, H, 0.028));             // 背板
  g.add(b(w - 0.10, 0.13, 0.018, C.blue, 0, H + 0.42, 0.05));        // 顶上一条蓝标带
  for (let i = 0; i < 3; i++) {                                       // 标带上的抽象字块
    g.add(b(0.16 - i * 0.03, 0.032, 0.008, C.cream,
      -0.30 + i * 0.30, H + 0.42, 0.062, { outline: false }));
  }
  g.add(b(w + 0.06, 0.05, 0.13, C.wood, 0, H - 0.545, 0.03));        // 下沿的一道托条
  // 背面：两根横撑 + 一道斜撑。转过去看时才不是一块光板。
  for (const sy of [-0.34, 0.34]) {
    g.add(b(w - 0.06, 0.07, 0.05, C.wood, 0, H + sy, -0.055));
  }
  const brace = b(1.30, 0.06, 0.04, C.soil, 0, H, -0.062);
  brace.rotation.z = 0.62;
  g.add(brace);

  // 前两张纸：完整的一张，规规矩矩
  for (let i = 0; i < 2; i++) {
    const px = -0.84 + i * 0.84, py = H - 0.03, pz = 0.052 + i * 0.002;
    const pw = 0.66, ph = 0.70;
    g.add(b(pw, ph, 0.006, i === 1 ? C.white : C.cream, px, py, pz));
    const lines = 7 + (i % 2);
    for (let k = 0; k < lines; k++) {
      const lw = (k === 0 ? 0.34 : 0.46 - (k % 3) * 0.05);
      g.add(b(lw, k === 0 ? 0.022 : 0.011, 0.003, k === 0 ? C.ink : C.tile,
        px - pw / 2 + 0.07 + lw / 2, py + ph / 2 - 0.11 - k * 0.062, pz + 0.004, { outline: false }));
    }
    for (const sx of [-1, 1]) {                                       // 两颗图钉
      g.add(cy(0.012, 0.012, 0.008, C.road,
        px + sx * (pw / 2 - 0.05), py + ph / 2 - 0.035, pz + 0.006, 6));
    }
    if (i === 0) {                                                    // 第一张的边角有点翘
      const wp = b(0.16, 0.10, 0.004, C.cream, px - 0.30, py + 0.30, pz + 0.008);
      wp.rotation.z = 0.22;
      g.add(wp);
    }
  }

  // 第三张：右下角缺一块 —— 缺的那块单独铰在竖边上，风一过就掀起来（⑦）
  const px3 = 0.84, py3 = H - 0.03, pz3 = 0.056, cut = 0.20;
  const paper3 = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape([
    new THREE.Vector2(-0.33, -0.34), new THREE.Vector2(0.13, -0.34),
    new THREE.Vector2(0.33, -0.14), new THREE.Vector2(0.33, 0.34),
    new THREE.Vector2(-0.33, 0.34)
  ])), M(C.white, { side: THREE.DoubleSide }));
  paper3.position.set(px3, py3, pz3);
  g.add(paper3);
  for (let k = 0; k < 8; k++) {
    const lw = (k === 0 ? 0.36 : 0.48 - (k % 3) * 0.06);
    g.add(b(lw, k === 0 ? 0.022 : 0.011, 0.003, k === 0 ? C.ink : C.tile,
      px3 - 0.33 + 0.06 + lw / 2, py3 + 0.34 - 0.10 - k * 0.062, pz3 + 0.004, { outline: false }));
  }
  for (const sx of [-1, 1]) {
    g.add(cy(0.012, 0.012, 0.008, C.road, px3 + sx * 0.28, py3 + 0.305, pz3 + 0.006, 6));
  }
  const hinge = new THREE.Group();
  hinge.position.set(px3 + 0.13, py3 - 0.34, pz3 + 0.003);
  const flap = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape([
    new THREE.Vector2(0, 0), new THREE.Vector2(cut, 0), new THREE.Vector2(cut, cut)
  ])), M(C.white, { side: THREE.DoubleSide }));
  hinge.add(flap);
  hinge.add(b(cut, 0.004, 0.002, C.tile, cut / 2, 0.008, 0.002, { outline: false }));
  g.add(hinge);
  A.corner = hinge;

  // 一张被撕掉一半的旧告示（只剩上沿）
  const torn = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape([
    new THREE.Vector2(-0.16, 0), new THREE.Vector2(0.16, 0),
    new THREE.Vector2(0.12, -0.12), new THREE.Vector2(0.02, -0.07),
    new THREE.Vector2(-0.06, -0.13), new THREE.Vector2(-0.16, -0.09)
  ])), M(C.cream, { side: THREE.DoubleSide }));
  torn.position.set(-1.02, H - 0.40, 0.056);
  g.add(torn);
  return g;
}

function brokenChunk() {                            // 沿上崩下来的一块
  const g = new THREE.Group();
  const c = b(0.26, 0.13, 0.17, C.soil, 0, 0.065, 0);
  c.rotation.set(0.16, 0.5, 0.10);
  g.add(c);
  const c2 = b(0.14, 0.07, 0.11, C.tile, 0.17, 0.04, 0.10);
  c2.rotation.set(-0.1, 0.9, 0.2);
  g.add(c2);
  return g;
}

// ---------------------------------------------------------------- 场沿（四周 0.24 高的矮水泥沿）
// 一段沿 = 沿身 + 顶面压光 + 两侧一道亮边 + 几道浇筑缝。少了后面两样，沿就是一条白胶带。
function curbRun(w, d, along) {
  const g = new THREE.Group();
  g.add(b(w, 0.215, d, C.soil, 0, 0.1075, 0));
  g.add(b(w + 0.015, 0.025, d + 0.015, C.cream, 0, 0.2275, 0));      // 顶面被晒白
  if (along === "x") {
    for (const sz of [-1, 1]) {                                       // 两侧压出的一道亮线
      g.add(b(w, 0.016, 0.012, C.cream, 0, 0.198, sz * (d / 2 - 0.004), { outline: false }));
    }
    for (let i = 0; i < 6; i++) {                                     // 浇筑缝
      g.add(b(0.016, 0.20, d + 0.004, C.tile,
        -w / 2 + 0.9 + i * (w - 1.8) / 5, 0.105, 0, { outline: false }));
    }
  } else {
    for (const sx of [-1, 1]) {
      g.add(b(0.012, 0.016, d, C.cream, sx * (w / 2 - 0.004), 0.198, 0, { outline: false }));
    }
    for (let i = 0; i < 5; i++) {
      g.add(b(w + 0.004, 0.20, 0.016, C.tile,
        0, 0.105, -d / 2 + 0.9 + i * (d - 1.8) / 4, { outline: false }));
    }
  }
  return g;
}

// ---------------------------------------------------------------- 场景装配
// 场是 15×12 的水泥地，沿的内沿在 ±7.14 / ±5.64，外沿与场地边缘齐平。

const props = [
  // ---- 地面
  { id: "g_yard", x: 0, z: 0, w: 15.0, d: 12.0, passable: true,
    build: () => ground(15.0, 12.0, 0, 0, null, C.sand, 0.012) },

  // ---- 空场的三样"骨"：分格线、裂缝、晒过谷的浅色区
  { id: "s_joint", x: 0, z: 0, w: 0.1, d: 0.1, passable: true, build: joints },
  { id: "s_crack", x: 0, z: -2.0, w: 0.1, d: 0.1, passable: true, build: crackLines },
  { id: "s_grain", x: 0.90, z: -0.15, w: 0.1, d: 0.1, passable: true, build: grainField },
  { id: "s_shade", x: 4.9, z: -2.7, w: 0.1, d: 0.1, passable: true, build: treeShade },
  { id: "s_contact", x: 0, z: 0, w: 0.1, d: 0.1, passable: true, build: contactShadows },

  // ---- 四周的矮水泥沿：把"空"框住
  { id: "s_curbN", x: 0, z: -5.82, w: 15.04, d: 0.36, build: () => curbRun(15.04, 0.36, "x") },
  { id: "s_curbS", x: 0, z: 5.82, w: 15.04, d: 0.36, build: () => curbRun(15.04, 0.36, "x") },
  { id: "s_curbE", x: 7.32, z: 0, w: 0.36, d: 12.0, build: () => curbRun(0.36, 12.0, "z") },
  { id: "s_curbW", x: -7.32, z: 0, w: 0.36, d: 12.0, build: () => curbRun(0.36, 12.0, "z") },
  { id: "s_chunk", x: -6.55, z: 5.18, w: 0.3, d: 0.2, passable: true, build: brokenChunk },

  // ---- 东北角：老槐树 + 树下那一摊（视觉中心）
  { id: "s_tree", x: 4.5, z: -3.4, w: 1.1, d: 1.1, build: locustTree },
  { id: "s_stool", x: 2.9, z: -2.9, w: 0.6, d: 0.5, rot: 4.2, build: stool },
  { id: "s_kit", x: 2.26, z: -2.14, w: 0.78, d: 0.58, rot: 0.42, build: kitOpen,
    interact: { x: 1.42, z: -1.42 } },
  { id: "s_radio", x: 1.92, z: -3.42, w: 0.36, d: 0.24, rot: -0.35, build: radioSet },
  { id: "s_boardT", x: 4.62, z: -3.02, w: 0.5, d: 0.2, rot: 0.62, build: () => {
      const g = treeBoard();
      g.position.set(0, 1.42, 0);
      A.board = g;
      return g; } },
  { id: "s_hat", x: 3.52, z: -2.28, w: 0.54, d: 0.54, passable: true, rot: 0.8, build: strawHat },
  { id: "s_cup8", x: 1.98, z: -1.86, w: 0.16, d: 0.16, passable: true, build: enamelCup },
  { id: "s_leaves", x: 3.5, z: -2.5, w: 0.1, d: 0.1, passable: true, build: () => {
      const g = new THREE.Group();
      for (let i = 0; i < 9; i++) {
        const a = i * 2.399;
        const r = 0.5 + jit(i) * 1.15;
        const lf = b(0.10, 0.004, 0.055, i % 3 ? C.soil : C.tile,
          Math.cos(a) * r, 0.03 + i * 0.0006, Math.sin(a) * r * 0.9, { outline: false });
        lf.rotation.y = a * 1.7;
        g.add(lf);
        if (i % 3 === 0) { A.leaves.push({ o: lf, x: lf.position.x, z: lf.position.z, ph: i }); }
      }
      return g;
    } },

  // ---- 西北：木耙 + 簸箕两只 + 场角的草
  { id: "s_rake", x: -6.42, z: -3.95, w: 0.62, d: 0.5, rot: 0.55, build: rake },
  { id: "s_winnow1", x: -5.92, z: -4.42, w: 0.62, d: 0.62, passable: true, rot: 0.4,
    build: winnowBasket },
  { id: "s_winnow2", x: -5.56, z: -3.78, w: 0.62, d: 0.62, passable: true, rot: -0.9, build: () => {
      const g = winnowBasket();
      g.rotation.z = 0.10;
      g.position.y = 0.02;
      return g; } },
  { id: "s_weedA", x: -6.94, z: -5.42, w: 0.3, d: 0.3, passable: true, build: () => {
      const g = new THREE.Group();
      g.add(tuft(8, 0.34, 0.06));
      g.add(tuft(6, 0.24, 0.05));
      return g; } },

  // ---- 西南：通知栏（次中心）+ 竹扫帚 + 场角的草
  { id: "s_notice", x: -3.62, z: 4.72, w: 2.7, d: 0.45, rot: 0.42, build: () => noticeBoard(2.6),
    interact: { x: -3.3, z: 3.85 } },
  { id: "s_broom", x: -2.62, z: 4.66, w: 0.5, d: 0.5, rot: 3.0, build: bambooBroom },
  { id: "s_weedB", x: -6.92, z: 5.44, w: 0.3, d: 0.3, passable: true, build: () => {
      const g = new THREE.Group();
      g.add(tuft(7, 0.30, 0.055));
      return g; } },

  // ---- 东南：半袋谷子靠在沿边（刻意留白，只给一点点"人刚走"的痕）
  { id: "s_sack", x: 6.78, z: 1.86, w: 0.62, d: 0.56, rot: 0.5, build: grainSack },
  { id: "s_weedC", x: 6.92, z: 5.46, w: 0.3, d: 0.3, passable: true, build: () => {
      const g = new THREE.Group();
      g.add(tuft(9, 0.36, 0.06));
      g.add(tuft(5, 0.22, 0.05));
      return g; } },

  // ---- 三只麻雀（两只在谷堆边啄谷，一只在空场上跳——"空"里唯一的活物）
  { id: "s_bird1", x: 1.74, z: 1.94, w: 0.2, d: 0.2, passable: true, build: () => birdProp(0) },
  { id: "s_bird2", x: 2.58, z: 1.62, w: 0.2, d: 0.2, passable: true, build: () => birdProp(1) },
  { id: "s_bird3", x: -2.24, z: 0.62, w: 0.2, d: 0.2, passable: true, build: () => birdProp(2) }
];

const obstacles = props.filter((p) => !p.passable).map((p) => ({ x: p.x, z: p.z, w: p.w, d: p.d }));
// 树干：树冠压在头上，人不能从树干里穿过去
obstacles.push({ x: 4.5, z: -3.4, w: 1.0, d: 1.0 });

// 关键人物：孙大夫，60 岁，白发，坐在马扎上听收音机，背对镜头（只留背影）
const characters = [
  { id: "sun", label: "孙大夫", name: "孙大夫", role: "村医",
    x: 2.9, z: -2.9, y: -0.2, facing: 4.2, pose: "sit",
    color: C.road, pants: C.dark, hair: C.cream }
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
    // 底座三层出边：模型是"浮"在一片干净的环境里，地面之外不再铺 2000² 的外景面——
    // 俯角压到 0.54 时那张外景面会占掉画面上缘四分之一，把"空"糊成一片土黄。
    // 场外的土沿压成深一档的 tile：亮的水泥场因此被一圈暗边框住，"空"才立得住。
    baseColor: C.cream, baseSideColor: C.navy, siteColor: C.tile,
    terrainSideColor: C.tile,
    // 上午十一点：天顶淡青、地平线热白
    skyTop: C.blue, skyMid: C.glass, skyBottom: C.cream,
    // 正午的光比要硬：半球光一高，影子就没了，空地就成了一块亮板。
    // 半球光的天空色用 white 而不是 glass：青色的环境光乘上暖灰的水泥会发绿，
    // 影子看上去像长了一层苔。
    light: { sun: C.cream, sunI: 2.5, fill: C.blue, fillI: 0.30, hemi: 0.56,
             hemiSky: C.white, hemiGround: C.sand, exposure: 0.80 },
    fogDensity: 0.0062,
    actor: { x: 0.2, z: 2.6 },
    // 俯角必须压到 0.54：再高一点，这块空地就成了一张平面图
    camYaw: 0.5, camPitch: 0.54, camDist: 15, camFocus: [0.4, 1.0, 0],
    walk: { x0: -6.95, x1: 6.95, z0: -5.45, z1: 5.45 },
    onSpot: (p) => { (window.__events = window.__events || []).push(["spot", p.id]); },
    onPerson: (p) => { (window.__events = window.__events || []).push(["person", p.id]); },
    onArrived: (p) => { (window.__events = window.__events || []).push(["arrived", +p.x.toFixed(2), +p.z.toFixed(2)]); },
    onSeat: (p) => { (window.__events = window.__events || []).push(["seat", p.id]); },

    // ---- 基础动效：12 条，幅度全部 2% 量级
    onFrame: (t) => {
      // ① 树冠被风吹动：整团摆 0.02 弧度，两个轴不同相，才不会像在点头
      if (A.canopy) {
        A.canopy.rotation.z = Math.sin(t * 0.55) * 0.020;
        A.canopy.rotation.x = Math.sin(t * 0.41 + 1.1) * 0.012;
        A.canopy.position.y = 4.92 + Math.sin(t * 0.33) * 0.012;
      }
      // ② 树冠边缘的碎叶：各自错相，幅度 0.025
      for (const lf of A.leaf) {
        lf.o.position.x = lf.x + Math.sin(t * 1.15 + lf.ph) * 0.025;
        lf.o.position.z = lf.z + Math.cos(t * 0.95 + lf.ph) * 0.022;
      }
      // ③ 树影缓移：一层比真影子更淡更软的暗斑，像云在走
      if (A.shade) {
        A.shade.position.x = Math.sin(t * 0.052) * 0.075;
        A.shade.position.z = Math.sin(t * 0.043 + 1.2) * 0.06;
        const k = 1 + Math.sin(t * 0.07 + 0.5) * 0.02;
        A.shade.scale.set(k, 1, k);
      }
      // ④ 麻雀：跳两步、啄一下、抬头。三只各自一个周期，谁也不跟谁同步
      for (const bd of A.bird) {
        const q = ((t + bd.ph) % bd.per) / bd.per;
        const hop = q < 0.5 ? Math.abs(Math.sin(q * Math.PI * 4)) * 0.035 : 0;
        bd.o.position.y = hop;
        const peck = q > 0.55 && q < 0.85 ? Math.sin((q - 0.55) / 0.3 * Math.PI) : 0;
        bd.head.rotation.x = peck * 0.95;
        bd.o.rotation.y = bd.baseYaw + Math.sin(t * 0.5 + bd.ph) * 0.06;
      }
      // ⑤ 药箱盖被风掀动一下又落回去：常驻 0.012，阵风时多抬 0.05
      if (A.lid) {
        const gust = Math.pow(Math.max(0, Math.sin(t * 0.21 + 0.6)), 6);
        A.lid.rotation.x = -1.24 - Math.sin(t * 0.62) * 0.012 - gust * 0.05;
      }
      // ⑥ 收音机天线轻晃：两节不同相，一直很轻
      if (A.ant) {
        A.ant.rotation.z = -0.20 + Math.sin(t * 0.73) * 0.020;
        A.ant.rotation.x = 0.10 + Math.sin(t * 0.51 + 1.4) * 0.014;
      }
      // ⑦ 通知栏上那张纸的角一直在一掀一落（3.6 秒一个来回，抬起快、落下慢）
      if (A.corner) {
        const q = (t % 3.6) / 3.6;
        const lift = q < 0.22 ? Math.sin(q / 0.22 * Math.PI * 0.5)
          : (q < 0.55 ? 1 - (q - 0.22) / 0.33 * 0.75 : 0.25 * Math.max(0, 1 - (q - 0.55) / 0.45));
        A.corner.rotation.y = -lift * 0.85;
        A.corner.rotation.z = lift * 0.10;
      }
      // ⑧ 树干上那块小黑板轻摆 0.015
      if (A.board) {
        A.board.rotation.z = Math.sin(t * 0.61) * 0.015;
        A.board.rotation.x = Math.sin(t * 0.44 + 0.8) * 0.010;
      }
      // ⑨ 收音机的指示灯呼吸 2%
      if (A.led) { A.led.material.emissiveIntensity = 1.0 + Math.sin(t * 1.7) * 0.02; }
      // ⑩ 裂缝里的五簇草：各自 0.02 弧度，风从东南来
      for (let i = 0; i < A.grass.length; i++) {
        const gr = A.grass[i];
        gr.o.rotation.z = Math.sin(t * 0.9 + gr.ph) * 0.020;
        gr.o.rotation.x = Math.sin(t * 0.72 + gr.ph * 1.7) * 0.014;
      }
      // ⑪ 地上三片落叶被风推着挪 2 厘米，边挪边转
      for (const lf of A.leaves) {
        lf.o.position.x = lf.x + Math.sin(t * 0.28 + lf.ph) * 0.02;
        lf.o.position.z = lf.z + Math.cos(t * 0.23 + lf.ph) * 0.02;
        lf.o.rotation.y += 0.0004;
      }
      // ⑫ 竹扫帚的竹梢轻颤（它靠在沿上，只有梢子动）
      if (A.broomTip) {
        A.broomTip.rotation.x = Math.sin(t * 0.47) * 0.018;
        A.broomTip.rotation.z = Math.cos(t * 0.39 + 0.7) * 0.014;
      }
    }
  });
} catch (err) {
  window.__err = String((err && err.stack) || err);
}

// 太阳压到 11 点的角度：几乎正当头、略偏东南。影子短，但足够把树和通知栏压在地上。
// （主光位置在 scene3d 里是给室内写的通用值，室外这一场要单独校一次。）
if (scene && window.__dbg && window.__dbg.sun) {
  window.__dbg.sun.position.set(2.6, 16.2, 3.0);
  window.__dbg.sun.shadow.bias = -0.0004;
  window.__dbg.sun.updateMatrixWorld();
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
