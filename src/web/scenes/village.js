// S6 · 村部 · 村委会（上午 11:00）—— 档案与资金，真相的库房
// -----------------------------------------------------------------------------
// 按 docs/场景与人物建模提示词.md v5 §1 + §3 S6 重做（质量第一）。
// 七段结构一一对应：画面风格 / 底座与构图 / 时间与氛围 / 建筑 / 陈设 / 动效 / 避免。
//
//   ① 颜色只从 kit.PAL 取；深一档/浅一档一律 shade(PAL.x, k) 派生，不新增色号；
//   ② 大件描边由 kit.b 自动加（最大边 > 0.55），小件不加；
//   ③ 零噪点贴图：这张文件里没有一张 CanvasTexture，水泥地分格靠 scene3d 的纯色地砖；
//   ④ 四格分区：
//        西北 —— 铁皮档案柜 ×3（一整排，抽屉带标签条/锁孔/拉手）+ 柜顶纸箱 + 档案室门
//        东北 —— 后墙右段：规划图（三主干线/四标段块/一处红标）+ 公示栏 + 旧笔录框 + 挂钟/日历
//        西南 —— 文件推车 + 一摞纸箱 + 饮水机（左墙）+ 长条凳（供来人坐）
//        东南 —— 4.2 米长桌 + 会计位（钱春香）+ 侧柜抽屉没关严（红头文件）+ 侧门与门垫
//   ⑤ 视觉中心：长桌桌面摊开的村账册（算盘、计算器**并排**在同一行）；
//      次中心：后墙规划图上那处红标（"只差两米"）。
//   ⑥ 规划图 / 公示栏 / 旧笔录框**全部挂后墙**——侧墙是掠射角，挂上去等于没挂。
//   ⑦ onFrame 11 条 2% 量级循环：窗帘 / 窗光缓移 / 桌面光斑呼吸 / 账册页角 /
//      公示栏纸角 / 门帘被穿堂风错开 / 门缝那条光偶尔变暗 / 筒灯 1.8% /
//      挂钟秒针 / 饮水机气泡 / 算盘一颗珠子被碰。
// -----------------------------------------------------------------------------
import * as THREE from "./vendor/three.module.min.js";
import { PAL as C, M, shade, b, cy, ball } from "./kit.js";
import { createScene } from "./scene3d.js";

window.__err = "";
window.addEventListener("error", (e) => {
  window.__err = (e.message || "error") + " @ " + (e.filename || "") + ":" + (e.lineno || 0);
});

// ---------------------------------------------------------------- 派生色
// 只用 PAL 里的色相，明度靠乘法派生（和 court.js 的树是同一套做法）
const tone = (c, k) => shade(c, k);
const IRON = C.road;                       // 铁皮柜：发灰的蓝
const IRON_D = tone(C.road, 0.82);
const IRON_L = tone(C.road, 1.16);
const WD = C.wood;                         // 木
const WD_M = tone(C.wood, 0.9);
const WD_D = tone(C.wood, 0.74);           // 深木：桌腿 / 算盘框 / 椅
const PAPER = C.cream;                     // 账册的纸（泛黄）
const PAPER_D = tone(C.cream, 0.93);       // 更旧的纸
const PAPER_W = C.white;
const DARK = C.dark;

// ---------------------------------------------------------------- 动画句柄
// 所有会动的部件在这里登记，onFrame 统一驱动；幅度一律 2% 量级。
const A = {
  lamp: [], curtain: [], strips: [], bubbles: [], pages: [], paper: null,
  doorLight: null, sunFloor: null, sunDesk: null, sec: null, bead: null, wallGlow: null
};

// ---------------------------------------------------------------- 小工具
// 贴地的薄片：不写深度，只叠颜色（光斑、磨痕、水渍）
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

// 平放的一张纸（0.004 厚；最小边 < 0.055 时 kit.b 自动走直角盒，不浪费圆角）
function sheet(w, d, color, x, y, z, ry = 0) {
  const m = b(w, 0.004, d, color, x, y, z);
  m.rotation.y = ry;
  return m;
}

// 一行"手写"：n 段不等长的短线。用 sin 而不是 random —— 每次刷新都长一样，
// 截图之间才可比；「乱码文字」也一并避免了。
function handLine(g, x0, y, z, len, n, color, th = 0.004, dh = 0.014) {
  const step = len / n;
  for (let i = 0; i < n; i++) {
    const k = 0.45 + 0.42 * Math.abs(Math.sin(i * 2.37 + len * 11.3));
    g.add(b(step * k, th, dh, color, x0 + step * (i + 0.5), y, z));
  }
}

// 挂墙板：外框 + 面板，两层错开 0.02 制造"有厚度"的那道阴影线
function wallBoard(w, h, face = PAPER, frame = IRON_D) {
  const g = new THREE.Group();
  g.add(b(w + 0.09, h + 0.09, 0.045, frame, 0, 0, 0));
  g.add(b(w, h, 0.05, face, 0, 0, 0.022));
  return g;
}

// 布、纸这类软东西不要描边：一加，门帘就变成一排木板（布没有硬边）
function noEdge(mesh) {
  for (const c of mesh.children.slice()) { if (c.isLineSegments) { mesh.remove(c); } }
  return mesh;
}

// 玻璃：真的透、真的有一点反光（§2 第 6 条）。
// 公示栏那块玻璃用近白而不是 C.glass —— 淡青会把里面三张纸整体染绿，
// 而"三张彩色纸"是这一场仅有的三处亮色之一，不能被玻璃糊掉。
function glassMat(op = 0.2, color = C.glass) {
  return new THREE.MeshPhysicalMaterial({
    color, transparent: true, opacity: op, roughness: 0.14,
    metalness: 0, depthWrite: false, side: THREE.DoubleSide
  });
}

// ---------------------------------------------------------------- 灯
// 线灯：挂在线槽带下面。室内没有顶板，直接挂一盏"看得见"的灯是唯一的办法。
function linearLight(len) {
  const g = new THREE.Group();
  g.add(b(len, 0.055, 0.16, C.white, 0, 2.815, 0));
  g.add(b(len - 0.06, 0.02, 0.12, C.cream, 0, 2.782, 0));
  const glow = new THREE.Mesh(new THREE.BoxGeometry(len - 0.12, 0.014, 0.09),
    M(C.yellow, { emissive: C.yellow, emissiveIntensity: 1.15 }));
  glow.position.set(0, 2.768, 0);
  g.add(glow);
  A.lamp.push({ m: glow, base: 1.15 });
  for (const sx of [-1, 1]) {
    g.add(cy(0.01, 0.01, 0.1, C.road, sx * (len / 2 - 0.12), 2.868, 0, 6));
  }
  return g;
}

// ---------------------------------------------------------------- 铁皮档案柜
// 抽屉面 / 缝 / 手写标签条 / 拉手 / 锁孔 —— 五件套，一个抽屉一组
function ironCabinet() {
  const g = new THREE.Group();
  g.add(b(1.15, 1.78, 0.56, IRON, 0, 0.89, 0));                    // 柜体
  g.add(b(1.2, 0.055, 0.6, tone(C.navy, 1.04), 0, 1.792, 0));      // 顶板
  g.add(b(1.12, 0.08, 0.54, IRON_D, 0, 0.04, 0));                   // 底座
  for (let r = 0; r < 4; r++) {
    const y = 1.53 - r * 0.355;
    g.add(b(1.02, 0.31, 0.04, IRON_L, 0, y, 0.29));                  // 抽屉面
    g.add(b(1.02, 0.014, 0.05, IRON_D, 0, y - 0.162, 0.288));        // 抽屉缝
    g.add(b(0.3, 0.042, 0.014, C.cream, -0.28, y + 0.072, 0.314));   // 手写标签条
    g.add(b(0.21, 0.008, 0.008, C.ink, -0.3, y + 0.083, 0.323));     // 标签上的"字"
    g.add(b(0.13, 0.007, 0.008, IRON_D, -0.33, y + 0.062, 0.323));
    g.add(b(0.22, 0.028, 0.032, C.navy, 0.28, y, 0.316));            // 拉手
    const lock = cy(0.013, 0.013, 0.012, C.ink, 0.37, y - 0.088, 0.316, 8);
    lock.rotation.x = Math.PI / 2;
    g.add(lock);
  }
  for (let i = 0; i < 3; i++) {                                      // 侧板三道通风孔
    g.add(b(0.02, 0.02, 0.3, IRON_D, -0.585, 0.7 + i * 0.16, 0));
  }
  g.add(b(0.86, 0.09, 0.006, C.cream, 0, 1.86, 0.301));              // 柜顶沿的编号条
  return g;
}

// 柜顶：四摞档案盒（错缝、贴年份条）
function cabTopA() {
  const g = new THREE.Group();
  for (let s = 0; s < 4; s++) {
    const x = -0.4 + s * 0.27;
    const n = 3 + (s % 2);
    for (let i = 0; i < n; i++) {
      const bx = b(0.26, 0.1, 0.34, i % 2 ? C.sand : C.cream, x, 1.87 + i * 0.102, 0);
      bx.rotation.y = (s - 1.5) * 0.018;
      g.add(bx);
      g.add(b(0.26, 0.008, 0.022, C.road, x, 1.9 + i * 0.102, 0.172));  // 年份红标（墨线）
    }
  }
  return g;
}

// 柜顶：一只开了盖的纸箱 + 一个塑料文件筐 + 两本立着的档案盒
function cabTopB() {
  const g = new THREE.Group();
  g.add(b(0.48, 0.3, 0.36, C.sand, -0.2, 1.97, 0));                    // 纸箱
  g.add(b(0.48, 0.02, 0.36, C.cream, -0.2, 1.97, 0));                  // 箱面胶带
  g.add(b(0.1, 0.22, 0.02, C.sand, -0.44, 2.13, 0.18));                // 掀开的盖（左）
  g.add(b(0.1, 0.2, 0.02, C.sand, 0.04, 2.12, 0.18));                  // 掀开的盖（右）
  g.add(b(0.34, 0.16, 0.26, PAPER_D, -0.2, 2.15, 0));                  // 箱里露出的纸
  g.add(b(0.3, 0.008, 0.02, C.ink, -0.2, 2.23, 0.08));
  // 塑料文件筐
  const bk = new THREE.Group();
  bk.position.set(0.36, 1.86, 0);
  bk.add(b(0.32, 0.02, 0.26, C.blue, 0, 0.01, 0));
  for (const sx of [-1, 1]) { bk.add(b(0.02, 0.2, 0.26, C.blue, sx * 0.15, 0.11, 0)); }
  for (const sz of [-1, 1]) { bk.add(b(0.32, 0.2, 0.02, C.blue, 0, 0.11, sz * 0.12)); }
  for (let i = 0; i < 5; i++) {                                        // 筐里歪着的五个文件夹
    const f = b(0.3, 0.19, 0.03, i % 2 ? C.cream : C.sand, 0, 0.12, -0.09 + i * 0.045);
    f.rotation.z = (i - 2) * 0.04;
    bk.add(f);
  }
  g.add(bk);
  return g;
}

// ---------------------------------------------------------------- 档案室（门帘被拨开一半）
// 不挖墙：靠"门套 → 门洞内壁（暗）→ 暗底 + 两排架子剪影"三层造进深，
// 门帘挂在门洞前 10 厘米的杆上，右边拨开一道 0.3 宽的口子，露出里面那一格。
function archiveDoor() {
  const g = new THREE.Group();
  // 门套：一圈贴墙的板 + 一圈内套。门洞内壁必须是**四块**，
  // 中间留空才有"走进去"的那一格（原来那块整板把门洞堵死了，看着像蓝柜门）。
  g.add(b(1.48, 2.5, 0.035, PAPER_D, 0, 1.25, -0.042));
  g.add(b(1.4, 2.44, 0.05, tone(C.cream, 0.95), 0, 1.22, -0.012));
  const JZ = 0.15;                                                       // 门洞进深
  for (const sx of [-1, 1]) {
    g.add(b(0.11, 2.3, JZ, tone(C.road, 0.94), sx * 0.645, 1.16, JZ / 2 + 0.01));
  }
  g.add(b(1.4, 0.11, JZ, tone(C.road, 0.94), 0, 2.25, JZ / 2 + 0.01));   // 上槛
  g.add(b(1.4, 0.045, JZ, tone(C.road, 1.02), 0, 0.022, JZ / 2 + 0.01)); // 门槛
  // 里屋：暗底 + 地面 + 两排架子（只作剪影，但**不能是黑洞**——架上的卷宗要看得见）
  g.add(b(1.18, 2.24, 0.03, tone(C.road, 0.78), 0, 1.14, -0.005));
  g.add(b(1.18, 0.012, 0.16, tone(C.road, 0.96), 0, 0.03, 0.06));
  for (const sy of [0.86, 1.56]) {
    g.add(b(1.12, 0.03, 0.16, tone(C.road, 1.14), 0, sy, 0.05));
    for (let i = 0; i < 7; i++) {
      g.add(b(0.1, 0.16, 0.12, i % 2 ? tone(C.road, 1.22) : tone(C.sand, 0.84),
        -0.44 + i * 0.146, sy + 0.095, 0.05));
    }
  }
  for (let i = 0; i < 5; i++) {                                          // 斜靠在架子边的两摞卷宗
    g.add(b(0.22, 0.03, 0.14, i % 2 ? tone(C.cream, 0.82) : tone(C.sand, 0.88),
      0.36, 0.3 + i * 0.032, 0.07));
  }
  // 里屋那只 40 瓦灯泡：只有一小片暖，不是一块发光板
  g.add(b(0.3, 0.05, 0.05, tone(C.yellow, 0.82), 0.24, 2.06, 0.06));
  const bulb = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.3),
    M(C.yellow, { emissive: C.yellow, emissiveIntensity: 0.5 }));
  bulb.position.set(0.24, 1.3, 0.1);
  g.add(bulb);
  A.archLamp = bulb;
  // 门帘杆 + 五片门帘：左边四片被拨到一边挤在一起，右边留一大片口子，只挂一片
  const rod = cy(0.014, 0.014, 1.34, IRON_D, 0, 2.18, 0.2, 6);
  rod.rotation.z = Math.PI / 2;
  g.add(rod);
  for (const sx of [-1, 1]) g.add(b(0.055, 0.1, 0.075, IRON_D, sx * 0.67, 2.18, 0.2));
  g.add(b(1.24, 0.06, 0.03, tone(C.sand, 0.9), -0.02, 2.14, 0.2));       // 帘头（一道横的布边）
  const strips = [
    { x: -0.52, rz: 0.004, pull: 0 },
    { x: -0.4, rz: 0.008, pull: 0 },
    { x: -0.28, rz: 0.012, pull: 0 },
    { x: -0.16, rz: 0.02, pull: 0.004 },        // 这四片挤在左边，就是"被拨开"的那一半
    { x: 0.5, rz: 0.1, pull: 0.01 }             // 右边单独一片，垂下来 → 中间露出档案室
  ];
  for (let i = 0; i < strips.length; i++) {
    const s = strips[i];
    const piv = new THREE.Group();
    piv.position.set(s.x + s.pull, 2.14, 0.19);                        // 绕杆的铰点
    // 不加描边：一加，门帘就变成一排木板（布没有硬边）
    const cloth = noEdge(b(0.22, 1.92, 0.022, i % 2 ? C.sand : tone(C.sand, 0.93), 0, -0.96, 0));
    piv.add(cloth);
    for (let k = 0; k < 3; k++) {                                      // 布纹：三道竖折
      piv.add(noEdge(b(0.006, 1.9, 0.026, i % 2 ? tone(C.sand, 0.93) : tone(C.sand, 0.86),
        -0.066 + k * 0.066, -0.96, 0.004)));
    }
    piv.add(noEdge(b(0.22, 0.05, 0.026, tone(C.sand, 0.84), 0, -1.9, 0))); // 下摆压边
    if (i === 4) { piv.add(noEdge(b(0.03, 1.9, 0.024, C.peach, 0.09, -0.96, 0.002))); }
    piv.rotation.z = s.rz;
    g.add(piv);
    A.strips.push({ o: piv, rz: s.rz, ph: i * 0.9 });
  }
  // 进门那道水泥坎：门帘下面才不是悬空的
  g.add(b(1.22, 0.035, 0.18, tone(C.road, 1.05), 0, 0.018, 0.14));
  g.add(b(1.26, 0.012, 0.2, C.road, 0, 0.04, 0.14));
  return g;
}

// ---------------------------------------------------------------- 后墙：规划图
// 三条主干线 + 四个标段块 + 一处红标；红标画在"断口"上——二期就差这两米
function planBoard() {
  const W = 2.2, H = 1.4;
  const g = wallBoard(W, H, PAPER_D, IRON_D);        // 泛黄的底图，不是一张白纸
  const Z = 0.052;
  // 底图网格：6 竖 4 横，铅笔灰
  for (let i = 1; i < 7; i++) {
    g.add(b(0.006, H - 0.1, 0.006, tone(C.road, 1.28), -W / 2 + i * W / 7, 0, Z));
  }
  for (let i = 1; i < 4; i++) {
    g.add(b(W - 0.1, 0.006, 0.006, tone(C.road, 1.28), 0, -H / 2 + i * H / 4, Z));
  }
  // 村组：五个小方块（三个在主干线交叉口）
  const nodes = [[-0.86, 0.3], [-0.32, 0.3], [0.22, 0.3], [-0.32, -0.02], [0.62, -0.02]];
  for (const [nx, ny] of nodes) {
    g.add(b(0.075, 0.075, 0.01, PAPER, nx, ny, Z + 0.006));
    g.add(b(0.085, 0.006, 0.01, C.ink, nx, ny + 0.04, Z + 0.008));
    g.add(b(0.006, 0.085, 0.01, C.ink, nx - 0.04, ny, Z + 0.008));
  }
  // 三条主干线：横一（土路）、横二（水泥路）、竖一（穿村路）
  g.add(b(1.62, 0.11, 0.012, C.sand, -0.28, 0.3, Z + 0.004));
  g.add(b(1.5, 0.012, 0.012, C.ink, -0.34, 0.3, Z + 0.012));
  g.add(b(1.94, 0.085, 0.012, tone(C.road, 1.16), 0.03, -0.02, Z + 0.004));
  g.add(b(1.8, 0.01, 0.012, tone(C.cream, 0.98), 0.03, -0.02, Z + 0.012));
  g.add(b(0.085, 1.28, 0.012, tone(C.road, 1.16), -0.32, 0.04, Z + 0.004));
  g.add(b(0.01, 1.24, 0.012, tone(C.cream, 0.98), -0.32, 0.04, Z + 0.012));
  // 横一在 x = 0.58 断了：断口右边还有一小截"已修好"的路
  g.add(b(0.2, 0.11, 0.012, C.sand, 0.69, 0.3, Z + 0.004));
  g.add(b(0.2, 0.012, 0.012, C.ink, 0.69, 0.3, Z + 0.012));
  // ★ 一处红标：红圈 + 红杠，正压在断口上
  g.add(b(0.085, 0.3, 0.014, tone(C.coral, 0.92), 0.57, 0.3, Z + 0.016));
  const ring = cy(0.062, 0.062, 0.012, C.coral, 0.57, 0.3, Z + 0.02, 20);
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  const ringIn = cy(0.042, 0.042, 0.014, PAPER_D, 0.57, 0.3, Z + 0.026, 20);
  ringIn.rotation.x = Math.PI / 2;
  g.add(ringIn);
  g.add(b(0.05, 0.13, 0.014, C.coral, 0.66, 0.16, Z + 0.016));         // 引线
  g.add(b(0.09, 0.03, 0.014, C.coral, 0.74, 0.11, Z + 0.016));
  // 四个标段块：一排，土黄与灰蓝交替，第四块（二期）带一道缺口
  for (let i = 0; i < 4; i++) {
    const x = -0.37 + i * 0.41;
    g.add(b(0.36, 0.17, 0.012, i % 2 ? tone(C.road, 1.18) : tone(C.sand, 1.04), x, -0.46, Z + 0.006));
    g.add(b(0.36, 0.006, 0.014, C.ink, x, -0.38, Z + 0.01));
    g.add(b(0.006, 0.17, 0.014, C.ink, x - 0.18, -0.46, Z + 0.01));
    handLine(g, x - 0.13, -0.42, Z + 0.012, 0.26, 2, tone(C.ink, 1.3), 0.003, 0.05);
    if (i === 3) {
      g.add(b(0.06, 0.17, 0.016, PAPER_D, x + 0.14, -0.46, Z + 0.012)); // 缺口 = 没修完
    }
  }
  // 图签栏（右下）+ 比例尺（左下）+ 指北针（左上）
  g.add(b(0.62, 0.16, 0.012, PAPER, 0.72, -0.63, Z + 0.006));
  for (let i = 0; i < 3; i++) g.add(b(0.54 - i * 0.1, 0.008, 0.014, C.ink, 0.72, -0.585 - i * 0.045, Z + 0.012));
  for (let i = 0; i < 3; i++) g.add(b(0.11, 0.022, 0.012, i % 2 ? C.ink : PAPER, -0.95 + i * 0.11, -0.64, Z + 0.01));
  const rose = cy(0.075, 0.075, 0.012, C.ink, -0.95, 0.55, Z + 0.008, 18);
  rose.rotation.x = Math.PI / 2;
  g.add(rose);
  g.add(b(0.014, 0.045, 0.014, C.coral, -0.95, 0.575, Z + 0.014));      // 指北针的红箭头
  g.add(b(0.014, 0.04, 0.014, PAPER, -0.95, 0.525, Z + 0.014));
  // 四角螺钉
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const s = cy(0.018, 0.018, 0.012, IRON_D, sx * (W / 2 - 0.02), sy * (H / 2 - 0.02), Z + 0.004, 8);
      s.rotation.x = Math.PI / 2;
      g.add(s);
    }
  }
  return g;
}

// ---------------------------------------------------------------- 后墙：公示栏
function noticeBoard() {
  const W = 1.2, H = 0.92;
  const g = new THREE.Group();
  g.add(b(W + 0.08, H + 0.08, 0.05, WD_M, 0, 0, 0));                 // 木框
  g.add(b(W, H, 0.04, PAPER_D, 0, 0, 0.022));                        // 软木板
  g.add(b(0.52, 0.055, 0.012, C.ink, -0.3, 0.38, 0.046));            // 标题条
  handLine(g, -0.6, 0.3, 0.046, 0.94, 2, tone(C.ink, 1.25), 0.006, 0.012);
  // 三张纸：白的（正文）/ 薄荷（表格）/ 蜜桃（通知）
  const pA = new THREE.Group();
  pA.position.set(-0.31, 0.06, 0.048); pA.rotation.z = 0.03;
  pA.add(b(0.42, 0.42, 0.008, PAPER_W, 0, 0, 0));
  for (let i = 0; i < 5; i++) handLine(pA, -0.16, 0.13 - i * 0.065, 0.007, 0.32, 3,
    i === 0 ? C.ink : tone(C.road, 1.05), 0.004, 0.012);
  g.add(pA);
  const pB = new THREE.Group();
  pB.position.set(0.11, 0.02, 0.05); pB.rotation.z = -0.02;
  pB.add(b(0.34, 0.44, 0.008, C.mint, 0, 0, 0));
  for (let i = 0; i < 6; i++) {
    pB.add(b(0.3, 0.005, 0.008, tone(C.ink, 1.2), 0, 0.16 - i * 0.055, 0.007));
    pB.add(b(0.1, 0.03, 0.008, PAPER_W, 0.02 + (i % 3) * 0.03, 0.135 - i * 0.055, 0.009));
  }
  g.add(pB);
  const pC = new THREE.Group();                                      // 会动的那个角
  pC.position.set(0.35, 0.12, 0.052);
  pC.add(b(0.3, 0.36, 0.008, C.peach, 0, 0, 0));
  pC.add(b(0.22, 0.05, 0.008, C.white, -0.02, 0.12, 0.007));
  for (let i = 0; i < 4; i++) handLine(pC, -0.11, 0.03 - i * 0.07, 0.007, 0.2, 3, C.ink, 0.004, 0.01);
  const curl = new THREE.Group();                                     // 掀起来的右下角
  curl.position.set(0.15, -0.18, 0.006);
  curl.add(b(0.1, 0.1, 0.006, C.peach, -0.05, 0.05, 0));
  curl.add(b(0.09, 0.09, 0.005, PAPER_D, -0.052, 0.052, 0.004));
  pC.add(curl);
  A.paper = curl;
  g.add(pC);
  // 三枚图钉
  for (const [px, py] of [[-0.31, 0.27], [0.11, 0.24], [0.35, 0.3]]) {
    const pin = cy(0.014, 0.014, 0.018, C.coral, px, py, 0.058, 8);
    pin.rotation.x = Math.PI / 2;
    g.add(pin);
  }
  // 玻璃门（左侧合页 + 右下角小锁）
  const gl = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.04, H - 0.04), glassMat(0.13, C.white));
  gl.position.set(0, 0, 0.072);
  g.add(gl);
  for (const hy of [-0.36, 0.3]) g.add(b(0.05, 0.14, 0.03, IRON_D, -0.6, hy, 0.07));
  g.add(b(0.1, 0.09, 0.03, tone(C.yellow, 0.9), 0.53, -0.37, 0.08));  // 锁体
  g.add(cy(0.03, 0.03, 0.012, C.yellow, 0.53, -0.33, 0.09, 10));      // 锁芯
  g.add(b(0.06, 0.03, 0.02, IRON_D, 0.53, -0.42, 0.075));             // 锁扣
  return g;
}

// ---------------------------------------------------------------- 后墙：旧调解笔录复印框
function recordFrame() {
  const W = 1.0, H = 0.78;
  const g = new THREE.Group();
  g.add(b(W + 0.07, H + 0.07, 0.045, WD_D, 0, 0, 0));
  g.add(b(W, H, 0.04, PAPER_D, 0, 0, 0.02));
  g.add(b(W - 0.06, H - 0.06, 0.004, PAPER, 0, 0, 0.042));            // 泛黄的纸
  // 标题：三段居中的粗线（"调解笔录"四个字的抽象）
  for (let i = 0; i < 4; i++) {
    g.add(b(0.075, 0.028, 0.008, C.ink, -0.15 + i * 0.1, 0.28, 0.046));
  }
  g.add(b(0.7, 0.006, 0.008, tone(C.ink, 1.2), 0, 0.235, 0.046));
  // 七行正文（每行四段）
  for (let i = 0; i < 7; i++) {
    handLine(g, -0.34, 0.16 - i * 0.068, 0.047, 0.66 - (i % 3) * 0.16, 4, tone(C.ink, 1.15), 0.004, 0.012);
  }
  // 落款 + 两个签名
  g.add(b(0.2, 0.005, 0.008, C.ink, 0.22, -0.28, 0.047));
  g.add(b(0.12, 0.006, 0.008, C.ink, 0.25, -0.33, 0.047));
  // 骑缝红章（复印出来的那种淡红）
  const seal = cy(0.062, 0.062, 0.004, C.coral, 0.28, -0.2, 0.05, 22);
  seal.rotation.x = Math.PI / 2;
  g.add(seal);
  const hole = cy(0.048, 0.048, 0.005, PAPER, 0.28, -0.2, 0.053, 22);
  hole.rotation.x = Math.PI / 2;
  g.add(hole);
  g.add(b(0.01, 0.09, 0.005, C.coral, 0.28, -0.2, 0.054));
  // 一道折痕 + 一枚图钉
  g.add(b(0.003, H - 0.1, 0.005, tone(C.ink, 1.6), -0.05, 0, 0.045));
  const pin = cy(0.016, 0.016, 0.02, C.navy, 0, 0.36, 0.052, 8);
  pin.rotation.x = Math.PI / 2;
  g.add(pin);
  return g;
}

// ---------------------------------------------------------------- 后墙小件
function wallClock() {
  const g = new THREE.Group();
  const rim = cy(0.2, 0.2, 0.05, C.blue, 0, 0, 0, 24);
  rim.rotation.x = Math.PI / 2;
  g.add(rim);
  const dial = cy(0.172, 0.172, 0.014, C.white, 0, 0, 0.03, 24);
  dial.rotation.x = Math.PI / 2;
  g.add(dial);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.add(b(0.011, i % 3 ? 0.02 : 0.036, 0.008, C.ink,
      Math.cos(a) * 0.135, Math.sin(a) * 0.135, 0.04));
  }
  const mh = new THREE.Group();
  mh.add(b(0.014, 0.12, 0.007, C.ink, 0, 0.06, 0.048));
  const sh = new THREE.Group();
  sh.add(b(0.007, 0.145, 0.006, C.coral, 0, 0.072, 0.055));
  mh.rotation.z = -0.9;
  g.add(mh, sh);
  A.sec = sh;
  g.add(cy(0.016, 0.016, 0.02, C.coral, 0, 0, 0.056, 10));
  return g;
}

function wallCalendar() {
  const g = new THREE.Group();
  g.add(b(0.44, 0.6, 0.03, PAPER_W, 0, 0, 0));
  g.add(b(0.44, 0.13, 0.034, C.coral, 0, 0.235, 0.002));               // 红头
  handLine(g, -0.16, 0.245, 0.02, 0.32, 2, C.white, 0.008, 0.03);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) {
      g.add(b(0.062, 0.006, 0.01, tone(C.road, 1.1), -0.16 + c * 0.08, 0.14 - r * 0.1, 0.02));
    }
    g.add(b(0.4, 0.004, 0.01, tone(C.ink, 1.6), 0, 0.1 - r * 0.1, 0.02));
  }
  g.add(b(0.05, 0.05, 0.012, C.coral, 0.1, 0.04, 0.022));               // 圈出来的一天
  const nail = cy(0.012, 0.012, 0.016, IRON_D, 0, 0.28, 0.02, 8);       // 一颗钉
  nail.rotation.x = Math.PI / 2;
  g.add(nail);
  return g;
}

// 线槽：后墙一条，一路下到电箱 —— 公家的屋子是明装的
function conduit() {
  const g = new THREE.Group();
  g.add(b(8.6, 0.05, 0.03, tone(C.cream, 0.97), 0, 0, 0));
  for (let i = 0; i < 5; i++) g.add(b(0.04, 0.07, 0.045, C.road, -4.0 + i * 2.0, 0, 0));
  return g;
}

// ---------------------------------------------------------------- 左墙：窗
// 上午十一点的光从这扇窗进来：窗芯是亮的，窗台是浅的，窗帘是布的
function windowWall() {
  const g = new THREE.Group();
  g.add(b(2.44, 1.66, 0.1, C.cream, 0, 1.82, 0));                     // 窗套
  g.add(b(2.26, 1.5, 0.05, PAPER_D, 0, 1.82, 0.035));                 // 窗洞底
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.44),
    M(C.white, { emissive: C.cream, emissiveIntensity: 1.2 }));
  pane.position.set(0, 1.82, 0.062);
  g.add(pane);
  // 窗外的两笔：院墙的墙头 + 两团树冠。没有它们，窗就是一格白灯箱。
  // 关键：外面的东西要跟着一起"晒到太阳"（给一点自发光），否则会在亮窗上变成两块黑补丁。
  g.add(b(2.2, 0.5, 0.006, tone(C.sand, 0.94), 0, 1.35, 0.066,
    { emissive: C.sand, emissiveIntensity: 0.5 }));
  g.add(b(2.2, 0.06, 0.008, tone(C.sand, 0.72), 0, 1.63, 0.067,
    { emissive: C.sand, emissiveIntensity: 0.42 }));
  const outLeaf = M(tone(C.grass, 1.1), { emissive: C.grass, emissiveIntensity: 0.4 });
  for (const [tx, ty, tr] of [[-0.72, 2.0, 0.24], [0.6, 2.08, 0.18]]) {
    const tree = new THREE.Mesh(new THREE.SphereGeometry(tr, 10, 8), outLeaf);
    tree.position.set(tx, ty, 0.066);
    tree.scale.set(1, 0.66, 0.035);
    g.add(tree);
  }
  for (let i = 0; i < 4; i++) {                                       // 四格窗棂
    const v = b(0.05, 1.44, 0.06, C.cream, -0.55 + i * 0.367, 1.82, 0.08);
    g.add(v);
  }
  g.add(b(2.2, 0.05, 0.06, C.cream, 0, 1.82, 0.08));
  g.add(b(2.36, 0.1, 0.16, C.white, 0, 2.66, 0.06));                  // 窗楣
  // 窗台 + 窗台上的东西
  g.add(b(2.5, 0.07, 0.26, C.white, 0, 1.03, 0.1));
  g.add(b(2.44, 0.03, 0.3, C.cream, 0, 0.99, 0.12));
  const pot = (x, r, h) => {
    const p = new THREE.Group();
    p.position.set(x, 1.065, 0.12);
    p.add(cy(r, r * 0.86, h, tone(C.brick, 0.95), 0, h / 2, 0, 12));
    p.add(cy(r * 1.06, r * 1.06, 0.02, tone(C.brick, 1.1), 0, h - 0.01, 0, 12));
    p.add(cy(r * 0.92, r * 0.92, 0.012, tone(C.soil, 0.8), 0, h - 0.022, 0, 12));
    return p;
  };
  const c1 = pot(-0.86, 0.075, 0.12);                                  // 仙人掌两盆
  c1.add(cy(0.045, 0.05, 0.2, tone(C.mint, 0.9), 0, 0.2, 0, 8));
  c1.add(cy(0.026, 0.03, 0.11, tone(C.mint, 0.86), 0.04, 0.23, 0, 7));
  c1.add(b(0.02, 0.06, 0.02, tone(C.mint, 1.05), -0.05, 0.3, 0));
  const c2 = pot(-0.62, 0.055, 0.09);
  c2.add(ball(0.055, tone(C.mint, 0.95), 0, 0.115, 0, 10));
  c2.add(ball(0.035, tone(C.mint, 1.05), 0.03, 0.155, 0.01, 8));
  g.add(c1, c2);
  // 一摞旧报纸 + 一只空搪瓷杯
  for (let i = 0; i < 5; i++) {
    const np = b(0.36, 0.008, 0.26, i % 2 ? PAPER_D : PAPER, 0.45, 1.075 + i * 0.008, 0.12);
    np.rotation.y = (i % 3 - 1) * 0.03;
    g.add(np);
  }
  g.add(cy(0.06, 0.052, 0.11, C.white, 0.92, 1.12, 0.1, 12));
  g.add(cy(0.062, 0.062, 0.01, C.ink, 0.92, 1.18, 0.1, 12));
  // 窗帘杆 + 两片布帘（会被风带起一角）
  const rod = cy(0.015, 0.015, 3.0, IRON_D, 0, 2.72, 0.2, 8);
  rod.rotation.z = Math.PI / 2;
  g.add(rod);
  for (const sx of [-1, 1]) g.add(ball(0.032, IRON_D, sx * 1.5, 2.72, 0.2, 8));
  for (let i = 0; i < 2; i++) {
    const piv = new THREE.Group();
    piv.position.set(i ? 1.24 : -1.24, 2.7, 0.18);
    for (let k = 0; k < 3; k++) {
      const cloth = b(0.13, 1.62 - k * 0.04, 0.03, k === 1 ? C.cream : C.sand,
        (k - 1) * 0.11, -0.82, k * 0.012);
      cloth.rotation.z = (k - 1) * 0.03;
      piv.add(cloth);
    }
    piv.rotation.z = (i ? -1 : 1) * 0.02;
    g.add(piv);
    A.curtain.push(piv);
  }
  return g;
}

// ---------------------------------------------------------------- 饮水机
function waterCooler() {
  const g = new THREE.Group();
  g.add(b(0.42, 0.02, 0.4, IRON_D, 0, 0.012, 0));
  g.add(b(0.4, 0.88, 0.38, C.white, 0, 0.46, 0));                     // 机身
  g.add(b(0.44, 0.05, 0.42, C.blue, 0, 0.925, 0));                    // 台面
  g.add(b(0.36, 0.05, 0.06, C.glass, 0, 0.87, 0.19));                 // 接水格
  g.add(b(0.32, 0.02, 0.16, IRON_D, 0, 0.845, 0.16));                 // 接水盘
  const bottle = cy(0.17, 0.17, 0.44, C.glass, 0, 1.21, 0, 16);
  bottle.material.transparent = true;
  bottle.material.opacity = 0.55;
  g.add(bottle);
  g.add(cy(0.158, 0.158, 0.22, tone(C.blue, 0.98), 0, 1.1, 0, 16));   // 半桶水
  for (const sx of [-1, 1]) {                                          // 两个龙头
    g.add(cy(0.022, 0.022, 0.07, C.blue, sx * 0.08, 0.83, 0.21, 8));
    g.add(b(0.045, 0.02, 0.05, IRON_D, sx * 0.08, 0.865, 0.2));
  }
  for (let i = 0; i < 3; i++) {                                        // 桶里的小气泡
    const bub = ball(0.013, C.white, 0.04 - i * 0.035, 1.02 + i * 0.05, 0.02, 6);
    bub.material.transparent = true;
    bub.material.opacity = 0.7;
    g.add(bub);
    A.bubbles.push({ o: bub, x: 0.04 - i * 0.035, z: 0.02, ph: i * 0.33 });
  }
  // 旁边地上一只暖瓶（红壳）+ 一叠备用纸杯
  const th = new THREE.Group();
  th.position.set(0.42, 0, -0.04);
  th.add(cy(0.085, 0.085, 0.4, C.coral, 0, 0.2, 0, 14));
  th.add(cy(0.07, 0.05, 0.06, C.dark, 0, 0.43, 0, 12));
  th.add(b(0.02, 0.16, 0.06, C.dark, 0.085, 0.28, 0));                // 提手
  th.add(cy(0.09, 0.09, 0.02, tone(C.coral, 0.86), 0, 0.02, 0, 14));
  g.add(th);
  for (let i = 0; i < 4; i++) {
    g.add(cy(0.042, 0.033, 0.095, C.white, -0.02, 0.955 + i * 0.03, -0.1, 10));
  }
  return g;
}

// ---------------------------------------------------------------- 长桌（视觉中心）
function longDesk() {
  const g = new THREE.Group();
  const TOP = 0.78;
  g.add(b(4.2, 0.09, 1.5, tone(WD, 0.94), 0, TOP - 0.045, 0));          // 桌面（深木色）
  g.add(b(4.28, 0.03, 1.56, tone(WD, 0.8), 0, TOP - 0.098, 0));         // 台沿
  g.add(b(3.94, 0.14, 1.3, WD_D, 0, TOP - 0.165, 0));                   // 桌裙
  for (const sz of [-1, 1]) {
    g.add(b(0.14, 0.62, 0.14, WD_D, -1.96, 0.31, sz * 0.62));           // 左端两条腿
    g.add(b(0.19, 0.02, 0.19, tone(C.dark, 1.1), -1.96, 0.01, sz * 0.62));
  }
  g.add(b(3.78, 0.07, 0.07, WD_D, 0, 0.15, 0.62));                      // 横撑
  g.add(b(3.78, 0.07, 0.07, WD_D, 0, 0.15, -0.62));
  // 挡板（面向来访者的一面）+ 上面贴的一张手写便条
  g.add(b(3.6, 0.52, 0.055, tone(WD, 0.84), -0.1, 0.33, 0.66));
  const note = b(0.3, 0.22, 0.006, PAPER_D, 1.2, 0.42, 0.692);
  note.rotation.z = 0.02;
  g.add(note);
  handLine(g, 1.12, 0.47, 0.697, 0.24, 2, C.ink, 0.004, 0.012);
  handLine(g, 1.12, 0.41, 0.697, 0.18, 2, tone(C.ink, 1.3), 0.004, 0.012);
  for (const sx of [-0.14, 0.14]) g.add(b(0.02, 0.02, 0.01, C.coral, 1.2 + sx, 0.5, 0.695));

  // 右侧抽屉柜（面向过道一侧），最上一格没关严，红头文件露出一角
  const ped = new THREE.Group();
  ped.position.set(1.76, 0, 0);
  ped.add(b(0.54, 0.7, 0.74, tone(WD, 0.8), 0, 0.35, 0));
  for (let k = 0; k < 3; k++) {
    const y = 0.57 - k * 0.2;
    const face = b(0.035, 0.17, 0.66, tone(WD, 0.9), 0.27, y, 0);
    g.add(face);
    ped.add(b(0.02, 0.03, 0.17, C.yellow, 0.292, y, 0));
    ped.add(b(0.012, 0.08, 0.11, tone(C.cream, 0.96), 0.292, y - 0.03, 0.18));
    ped.add(b(0.012, 0.03, 0.03, C.ink, 0.292, y - 0.05, 0.18));
  }
  g.add(ped);
  // 最上一格拉出来 5 厘米：红头文件的一角
  const openDrawer = new THREE.Group();
  openDrawer.position.set(1.96, 0.57, 0);
  openDrawer.add(b(0.16, 0.15, 0.62, tone(WD, 0.7), 0.08, 0, 0));
  openDrawer.add(b(0.03, 0.17, 0.66, tone(WD, 0.9), 0.17, 0.005, 0));
  const doc = b(0.3, 0.008, 0.42, PAPER_W, 0.26, 0.055, 0.02);
  doc.rotation.z = 0.06;
  openDrawer.add(doc);
  openDrawer.add(b(0.28, 0.01, 0.05, C.coral, 0.27, 0.062, -0.16));      // 红头
  openDrawer.add(b(0.02, 0.03, 0.16, C.yellow, 0.185, 0, 0.02));
  g.add(openDrawer);

  // ---- 桌面陈设：账册 / 算盘 / 计算器 一行并排，从桌面左端往右
  const Y = TOP;
  // 墨绿桌垫：把这三件书证框成一组（也是桌面唯一的深色块）
  g.add(b(1.9, 0.008, 0.86, tone(C.mint, 0.5), -0.55, Y + 0.004, 0.08));
  g.add(b(1.94, 0.006, 0.9, tone(C.mint, 0.62), -0.55, Y + 0.001, 0.08));
  const L = ledger();
  L.position.set(-1.04, Y + 0.008, -0.06);
  g.add(L);
  const AB = abacus();
  AB.position.set(-0.22, Y + 0.008, 0.14);
  AB.rotation.y = 0.02;
  g.add(AB);
  const CA = calculator();
  CA.position.set(0.17, Y + 0.008, 0.13);
  CA.rotation.y = -0.04;
  g.add(CA);

  // 搪瓷缸（会计那只，掉了瓷）
  const mug = new THREE.Group();
  mug.position.set(0.6, Y, -0.25);
  mug.add(cy(0.075, 0.068, 0.15, C.white, 0, 0.075, 0, 14));
  mug.add(cy(0.077, 0.077, 0.014, C.ink, 0, 0.15, 0, 14));
  mug.add(b(0.03, 0.05, 0.03, C.white, 0.082, 0.09, 0));
  mug.add(b(0.02, 0.02, 0.02, C.dark, -0.05, 0.02, 0.06));             // 掉瓷的一块
  g.add(mug);

  // 印台 + 印章
  g.add(b(0.17, 0.035, 0.13, C.dark, 0.6, Y + 0.018, 0.4));
  g.add(b(0.14, 0.012, 0.1, C.coral, 0.6, Y + 0.04, 0.4));
  const stamp = cy(0.024, 0.024, 0.08, WD_D, 0.79, Y + 0.04, 0.4, 10);
  g.add(stamp);
  g.add(cy(0.03, 0.03, 0.02, WD_M, 0.79, Y + 0.09, 0.4, 10));

  // 一叠凭证（露出一张的边）
  const vouch = new THREE.Group();
  vouch.position.set(1.04, Y, -0.12);
  vouch.rotation.y = 0.12;
  for (let i = 0; i < 7; i++) {
    vouch.add(sheet(0.3, 0.42, i % 2 ? PAPER_W : PAPER_D,
      (i % 3 - 1) * 0.005, 0.003 + i * 0.0035, (i % 2) * 0.006, (i % 3 - 1) * 0.012));
  }
  vouch.add(b(0.12, 0.02, 0.05, IRON_D, -0.02, 0.032, 0.02));          // 长尾夹
  g.add(vouch);

  // 老花镜（镜片两圈 + 两条腿）
  const gl = new THREE.Group();
  gl.position.set(-1.52, Y, 0.32);
  gl.rotation.y = 0.3;
  for (const sx of [-1, 1]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.005, 6, 14), M(C.ink));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(sx * 0.042, 0.006, 0);
    gl.add(ring);
    const leg = b(0.006, 0.004, 0.11, C.ink, sx * 0.075, 0.006, -0.06);
    leg.rotation.y = sx * 0.18;
    gl.add(leg);
  }
  gl.add(b(0.03, 0.004, 0.006, C.ink, 0, 0.006, 0));
  g.add(gl);

  // 笔筒 + 四支笔
  g.add(cy(0.05, 0.045, 0.12, WD_D, 0.9, Y + 0.06, 0.46, 12));
  const pens = [[C.ink, 0.02, 0.05, 0.12], [C.coral, -0.03, 0.02, 0.15],
                [C.navy, 0.01, -0.04, 0.1], [C.yellow, -0.02, -0.02, 0.13]];
  for (const [col, px, pz, ph] of pens) {
    const p = cy(0.008, 0.008, ph, col, 0.9 + px, Y + 0.11 + ph * 0.3, 0.46 + pz, 5);
    p.rotation.z = px * 3;
    p.rotation.x = -pz * 3;
    g.add(p);
  }

  // 一支红铅笔横在账册上 + 一块橡皮
  const pencil = cy(0.008, 0.008, 0.2, C.coral, -0.86, Y + 0.03, 0.16, 5);
  pencil.rotation.z = Math.PI / 2;
  pencil.rotation.y = 0.16;
  g.add(pencil);
  g.add(b(0.06, 0.022, 0.035, tone(C.sand, 1.05), -1.36, Y + 0.012, 0.12));

  // 给来打证明的人准备的一张空白介绍信 + 一支笔
  const blank = sheet(0.26, 0.36, PAPER_W, 0.36, Y + 0.004, 0.52, -0.06);
  g.add(blank);
  for (let i = 0; i < 4; i++) {
    g.add(b(0.2 - (i % 2) * 0.05, 0.003, 0.008, tone(C.road, 1.15), 0.36, Y + 0.007, 0.62 - i * 0.06));
  }
  const pen2 = cy(0.008, 0.008, 0.18, C.navy, 0.6, Y + 0.012, 0.5, 5);
  pen2.rotation.z = Math.PI / 2;
  pen2.rotation.y = -0.5;
  g.add(pen2);

  // 桌面左侧那一片窗光（照亮半个桌面）
  const washGeo = new THREE.PlaneGeometry(1.8, 1.2);
  washGeo.rotateX(-Math.PI / 2);
  const wash = new THREE.Mesh(washGeo, new THREE.MeshBasicMaterial({
    color: C.yellow, transparent: true, opacity: 0.14, depthWrite: false
  }));
  wash.position.set(-1.3, Y + 0.002, 0.02);
  wash.rotation.y = -0.2;
  g.add(wash);
  A.sunDesk = wash;
  return g;
}

// ★ 翻开的村账册：摊到中缝，页边卷
function ledger() {
  const g = new THREE.Group();
  const W = 0.78, D = 0.54;
  g.add(b(W + 0.02, 0.012, D + 0.02, tone(C.ink, 1.08), 0, 0.008, 0));  // 硬壳封底
  g.add(b(W + 0.012, 0.004, 0.03, C.ink, 0, 0.016, D / 2 + 0.002));     // 书脊压条
  for (const s of [-1, 1]) {
    const pg = b(W / 2 - 0.012, 0.016, D, PAPER, s * (W / 4 + 0.003), 0.024, 0);
    pg.rotation.z = -s * 0.014;
    g.add(pg);
    for (let k = 0; k < 3; k++) {                                       // 页边三层
      g.add(b(0.014, 0.003, D - 0.012, k % 2 ? PAPER_D : PAPER,
        s * (W / 2 - 0.005), 0.019 + k * 0.0045, 0));
    }
    // 六行账目 + 金额列
    for (let i = 0; i < 6; i++) {
      const z = -D / 2 + 0.075 + i * 0.07;
      g.add(b(W / 2 - 0.07, 0.0025, 0.005, tone(C.glass, 0.9), s * W / 4, 0.033, z));
      const n = 2 + ((i + (s > 0 ? 1 : 0)) % 3);
      for (let k = 0; k < n; k++) {
        g.add(b(0.035 + (k % 2) * 0.02, 0.002, 0.009, tone(C.ink, 1.15),
          s * (W / 4 + 0.1) - s * k * 0.085, 0.0345, z + 0.012));
      }
    }
    g.add(b(0.006, 0.0025, D - 0.04, tone(C.glass, 0.84), s * (W / 4 + 0.045), 0.033, 0));
    // 左页上压着一枚淡红章
    if (s < 0) {
      const seal = cy(0.04, 0.04, 0.003, C.coral, -0.2, 0.035, -0.16, 16);
      seal.rotation.x = Math.PI / 2;
      g.add(seal);
      const hole = cy(0.028, 0.028, 0.004, PAPER, -0.2, 0.036, -0.16, 16);
      hole.rotation.x = Math.PI / 2;
      g.add(hole);
    }
  }
  g.add(b(0.018, 0.016, D, tone(C.ink, 1.2), 0, 0.024, 0));             // 中缝
  // 右页近处的页角：会轻轻起伏的那一片
  const corner = new THREE.Group();
  corner.position.set(W / 2 - 0.03, 0.032, D / 2 - 0.02);
  corner.add(b(0.11, 0.003, 0.11, PAPER, -0.055, 0.002, -0.055));
  corner.add(b(0.1, 0.002, 0.09, PAPER_D, -0.05, -0.001, -0.05));
  A.pages.push(corner);
  g.add(corner);
  // 一条书签带从页缝里垂出来
  const bm = b(0.03, 0.004, 0.12, C.coral, 0.06, 0.02, D / 2 - 0.02);
  bm.rotation.x = 0.06;
  g.add(bm);
  return g;
}

// 算盘：九档，每档三珠（上一珠、下两珠）
function abacus() {
  const g = new THREE.Group();
  const W = 0.58, D = 0.25;
  g.add(b(W, 0.03, 0.04, WD_D, 0, 0.015, -D / 2 + 0.02));
  g.add(b(W, 0.03, 0.04, WD_D, 0, 0.015, D / 2 - 0.02));
  g.add(b(0.04, 0.03, D, WD_D, -W / 2 + 0.02, 0.015, 0));
  g.add(b(0.04, 0.03, D, WD_D, W / 2 - 0.02, 0.015, 0));
  g.add(b(W - 0.06, 0.018, 0.032, WD_D, 0, 0.02, 0));                   // 横梁
  const beadMat = M(tone(C.wood, 0.6));
  for (let i = 0; i < 9; i++) {
    const x = -0.24 + i * 0.06;
    const rod = cy(0.005, 0.005, D - 0.06, C.yellow, x, 0.03, 0, 5);
    rod.rotation.x = Math.PI / 2;
    g.add(rod);
    // 梁下两珠（位置高低不同：拨过的算盘不整齐）
    for (let k = 0; k < 2; k++) {
      const y = 0.032;
      const bd = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.022, 0.028), beadMat);
      bd.position.set(x, y, 0.045 + k * 0.036 + (i % 3) * 0.004);
      bd.castShadow = true;
      g.add(bd);
      if (i === 4 && k === 1) { A.bead = bd; A.beadX = 0.045 + 0.036; }
    }
    // 梁上一珠
    const up = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.022, 0.028), beadMat);
    up.position.set(x, 0.032, -0.055 - (i % 2) * 0.008);
    up.castShadow = true;
    g.add(up);
  }
  return g;
}

// 计算器：跟算盘并排，一旧一新
function calculator() {
  const g = new THREE.Group();
  g.add(b(0.24, 0.032, 0.3, DARK, 0, 0.016, 0));
  g.add(b(0.23, 0.008, 0.29, tone(C.dark, 1.12), 0, 0.03, 0));
  g.add(b(0.17, 0.006, 0.075, tone(C.mint, 0.86), 0, 0.033, -0.1));      // 显示屏
  for (let i = 0; i < 3; i++) {
    g.add(b(0.05 - i * 0.012, 0.004, 0.012, tone(C.ink, 1.1), 0.04 - i * 0.01, 0.036, -0.1));
  }
  g.add(b(0.06, 0.004, 0.012, tone(C.road, 0.9), -0.06, 0.036, -0.115)); // 太阳能条
  for (let r = 0; r < 4; r++) {                                          // 4×4 键
    for (let c = 0; c < 4; c++) {
      const isOn = r === 0 && c === 3;
      g.add(b(0.042, 0.008, 0.032, isOn ? C.coral : (r < 3 ? tone(C.cream, 0.98) : C.road),
        -0.078 + c * 0.052, 0.033, -0.04 + r * 0.045));
    }
  }
  return g;
}

// 会计椅（钱春香坐的那把）
function officeChair() {
  const g = new THREE.Group();
  g.add(b(0.5, 0.06, 0.46, WD_M, 0, 0.44, 0));                          // 座面板
  g.add(b(0.46, 0.03, 0.42, C.dark, 0, 0.475, 0));                      // 坐垫
  // 靠背压低一档：靠背太高，钱春香在桌后就只剩一个头，读不出"人在翻账册"
  g.add(b(0.5, 0.3, 0.06, WD_M, 0, 0.62, -0.21));                       // 靠背
  g.add(b(0.4, 0.09, 0.055, WD_D, 0, 0.79, -0.2));                      // 靠背上沿
  g.add(b(0.42, 0.06, 0.03, tone(C.dark, 1.1), 0, 0.56, -0.185));       // 靠垫
  for (const sx of [-1, 1]) {
    g.add(b(0.055, 0.44, 0.055, WD_D, sx * 0.2, 0.22, -0.18));           // 后腿（撑到靠背）
    g.add(b(0.055, 0.42, 0.055, WD_D, sx * 0.2, 0.21, 0.17));
  }
  g.add(b(0.34, 0.04, 0.04, WD_D, 0, 0.1, 0));
  g.add(b(0.34, 0.04, 0.04, WD_D, 0, 0.1, 0.17));
  return g;
}

// ---------------------------------------------------------------- 西南：文件推车 + 纸箱 + 长凳
function fileCart() {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(b(0.05, 0.92, 0.05, IRON, sx * 0.29, 0.46, sz * 0.4));        // 四根立柱
    const w = cy(0.055, 0.055, 0.04, C.dark, sx * 0.29, 0.055, sz * 0.4, 10);
    w.rotation.x = Math.PI / 2;
    g.add(w);                                                           // 四个轮子
  }
  for (const sy of [0.32, 0.72]) {
    g.add(b(0.62, 0.035, 0.84, IRON_L, 0, sy, 0));                      // 两层台板
    g.add(b(0.62, 0.05, 0.05, IRON, 0, sy + 0.04, 0.42));               // 前后挡边
    g.add(b(0.62, 0.05, 0.05, IRON, 0, sy + 0.04, -0.42));
  }
  g.add(b(0.6, 0.05, 0.04, IRON, 0, 0.96, 0.4));                        // 推手
  g.add(b(0.6, 0.05, 0.04, IRON, 0, 0.96, -0.4));
  // 上层：八摞文件夹
  for (let i = 0; i < 8; i++) {
    const f = b(0.09, 0.24, 0.3, i % 3 === 0 ? C.mint : (i % 3 === 1 ? C.cream : C.sand),
      -0.26 + i * 0.075, 0.86, -0.16 + (i % 2) * 0.06);
    f.rotation.z = (i - 3.5) * 0.02;
    g.add(f);
    g.add(b(0.008, 0.02, 0.2, C.ink, -0.26 + i * 0.075, 0.97, -0.16 + (i % 2) * 0.06));
  }
  // 下层：两只纸箱 + 一卷胶带
  g.add(b(0.3, 0.26, 0.36, C.sand, -0.14, 0.47, 0.05));
  g.add(b(0.3, 0.02, 0.36, C.cream, -0.14, 0.47, 0.05));
  g.add(b(0.24, 0.2, 0.3, tone(C.sand, 0.92), 0.16, 0.42, -0.12));
  g.add(cy(0.06, 0.06, 0.02, tone(C.road, 1.15), 0.16, 0.53, -0.12, 12));
  return g;
}

function cartons() {
  const g = new THREE.Group();
  g.add(b(0.64, 0.46, 0.5, C.sand, 0, 0.23, 0));                        // 底箱
  g.add(b(0.64, 0.03, 0.14, C.cream, 0, 0.47, 0.02));                   // 封箱胶带
  g.add(b(0.04, 0.03, 0.5, C.cream, -0.24, 0.465, 0));
  g.add(b(0.2, 0.14, 0.008, PAPER_W, -0.1, 0.28, 0.252));               // 贴的单子
  g.add(b(0.16, 0.02, 0.01, C.ink, -0.1, 0.31, 0.257));
  g.add(b(0.1, 0.016, 0.01, tone(C.ink, 1.3), -0.1, 0.27, 0.257));
  const top = new THREE.Group();
  top.position.set(0.06, 0.46, 0.02);
  top.rotation.y = 0.1;
  top.add(b(0.5, 0.38, 0.44, C.sand, 0, 0.19, 0));                      // 上箱（开了盖）
  top.add(b(0.5, 0.02, 0.06, C.cream, 0, 0.38, 0.2));
  top.add(b(0.24, 0.1, 0.02, C.sand, -0.2, 0.44, 0.2));                 // 掀起的盖
  top.add(b(0.24, 0.1, 0.02, C.sand, 0.2, 0.44, 0.2));
  top.add(b(0.36, 0.14, 0.3, PAPER_D, 0, 0.32, 0));                     // 箱里的纸
  for (let i = 0; i < 3; i++) top.add(b(0.32, 0.008, 0.02, C.ink, 0, 0.36 + i * 0.015, 0.05));
  g.add(top);
  return g;
}

// 长条凳：来人在桌前排的队就是坐在它上面（也给画面下缘垫一层前景）
function bench() {
  const g = new THREE.Group();
  g.add(b(1.9, 0.075, 0.36, WD, 0, 0.4, 0));                            // 座面
  g.add(b(1.82, 0.06, 0.06, WD_D, 0, 0.33, 0.12));                      // 前后撑
  g.add(b(1.82, 0.06, 0.06, WD_D, 0, 0.33, -0.12));
  for (const sx of [-1, 1]) {
    g.add(b(0.075, 0.38, 0.34, WD_D, sx * 0.86, 0.2, 0));
    g.add(b(0.09, 0.03, 0.4, WD_D, sx * 0.86, 0.015, 0));
  }
  // 凳上：一张填了一半的表 + 一支笔 + 一只保温杯
  const form = sheet(0.26, 0.34, PAPER_W, -0.5, 0.44, 0.02, 0.12);
  g.add(form);
  for (let i = 0; i < 5; i++) {
    g.add(b(0.18 - (i % 2) * 0.04, 0.003, 0.008, tone(C.road, 1.1), -0.5, 0.444, 0.12 - i * 0.05));
  }
  const pen = cy(0.007, 0.007, 0.16, C.ink, -0.22, 0.45, 0.06, 5);
  pen.rotation.z = Math.PI / 2;
  pen.rotation.y = 0.7;
  g.add(pen);
  const cup = cy(0.05, 0.045, 0.16, tone(C.sea, 0.95), 0.42, 0.52, 0, 12);
  g.add(cup);
  g.add(cy(0.05, 0.05, 0.02, C.cream, 0.42, 0.6, 0, 12));
  return g;
}

function stool() {
  const g = new THREE.Group();
  g.add(b(0.34, 0.05, 0.32, C.blue, 0, 0.4, 0));                        // 凳面
  g.add(b(0.32, 0.02, 0.3, tone(C.blue, 1.12), 0, 0.43, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = b(0.045, 0.4, 0.045, C.blue, sx * 0.135, 0.2, sz * 0.12);
    leg.rotation.z = -sx * 0.05;
    leg.rotation.x = sz * 0.05;
    g.add(leg);
  }
  g.add(b(0.28, 0.03, 0.03, C.blue, 0, 0.12, 0.12));
  g.add(b(0.28, 0.03, 0.03, C.blue, 0, 0.12, -0.12));
  return g;
}

// ---------------------------------------------------------------- 东南：侧门 + 门垫 + 拖把 + 纸篓 + 暖炉
function sideDoor() {
  const g = new THREE.Group();
  g.add(b(1.3, 2.36, 0.13, C.cream, 0, 1.18, 0));                       // 门套
  g.add(b(1.06, 2.18, 0.06, WD_M, 0, 1.1, 0.06));                       // 门扇
  g.add(b(0.86, 0.72, 0.03, WD_D, 0, 1.62, 0.095));                     // 上凹板
  g.add(b(0.74, 0.6, 0.014, WD_M, 0, 1.62, 0.103));
  g.add(b(0.86, 0.56, 0.03, WD_D, 0, 0.62, 0.095));                     // 下凹板
  g.add(b(0.74, 0.46, 0.014, WD_M, 0, 0.62, 0.103));
  g.add(b(0.3, 0.12, 0.016, C.navy, 0, 1.9, 0.1));                      // 门牌（无字）
  g.add(b(0.22, 0.03, 0.012, C.cream, 0, 1.9, 0.11));
  const knob = cy(0.032, 0.032, 0.03, C.yellow, 0.4, 1.04, 0.1, 10);
  knob.rotation.x = Math.PI / 2;
  g.add(knob);
  g.add(b(0.026, 0.024, 0.13, C.yellow, 0.4, 1.04, 0.16));              // 拉手
  // 门缝底下那条光：走廊里的灯，偶尔被走过的人挡住
  const crack = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.035),
    M(C.yellow, { emissive: C.yellow, emissiveIntensity: 0.8, transparent: true, opacity: 0.75 }));
  crack.position.set(0, 0.03, 0.1);
  g.add(crack);
  A.doorLight = crack;
  // 门后挂钩：一顶草帽 + 一条搭着的毛巾（挂在门框外那面墙上）
  g.add(cy(0.014, 0.014, 0.12, IRON_D, -0.97, 1.72, 0.13, 6));
  const hat = new THREE.Group();
  hat.position.set(-0.97, 1.58, 0.16);
  const brim = cy(0.2, 0.2, 0.018, tone(C.sand, 0.94), 0, 0, 0, 18);
  brim.rotation.x = Math.PI / 2;
  hat.add(brim);
  const crown = cy(0.1, 0.115, 0.1, C.sand, 0, 0, 0.05, 14);
  crown.rotation.x = Math.PI / 2;
  hat.add(crown);
  const band = cy(0.118, 0.118, 0.022, tone(C.sand, 0.8), 0, 0, 0.012, 14);
  band.rotation.x = Math.PI / 2;
  hat.add(band);
  hat.rotation.z = 0.06;
  g.add(hat);
  const towel = new THREE.Group();
  towel.position.set(-1.3, 1.62, 0.14);
  towel.add(b(0.3, 0.014, 0.014, IRON_D, 0, 0.16, 0));                 // 毛巾杆
  for (let i = 0; i < 3; i++) {
    const cloth = b(0.16, 0.4, 0.02, i === 1 ? C.white : tone(C.white, 0.96), -0.06 + i * 0.075, -0.08, 0.01);
    cloth.rotation.z = (i - 1) * 0.02;
    towel.add(cloth);
  }
  towel.add(b(0.2, 0.03, 0.024, C.blue, 0, -0.24, 0.012));             // 毛巾上的蓝边
  g.add(towel);
  return g;
}

function doorMat() {
  const g = new THREE.Group();
  g.add(b(1.0, 0.022, 0.66, tone(C.dark, 1.1), 0, 0.011, 0));
  g.add(b(0.9, 0.006, 0.56, C.road, 0, 0.024, 0));
  for (let i = 0; i < 4; i++) g.add(b(0.72, 0.004, 0.04, tone(C.road, 1.2), 0, 0.028, -0.18 + i * 0.12));
  return g;
}

function mopBucket() {
  const g = new THREE.Group();
  g.add(cy(0.19, 0.16, 0.3, C.blue, 0, 0.15, 0, 14));
  g.add(cy(0.2, 0.2, 0.03, tone(C.dark, 1.1), 0, 0.3, 0, 14));
  g.add(cy(0.16, 0.16, 0.02, tone(C.glass, 0.95), 0, 0.31, 0, 14));      // 桶里的水
  const pole = cy(0.024, 0.024, 1.22, WD, 0.1, 0.72, 0.02, 6);
  pole.rotation.z = -0.06;
  g.add(pole);
  for (let i = 0; i < 5; i++) {
    const s = b(0.03, 0.2, 0.03, C.cream, 0.15 + (i % 3) * 0.03, 0.16, -0.03 + i * 0.02);
    s.rotation.z = 0.16;
    g.add(s);
  }
  return g;
}

function wasteBin() {
  const g = new THREE.Group();
  g.add(cy(0.17, 0.14, 0.42, tone(C.road, 0.95), 0, 0.21, 0, 14));
  g.add(cy(0.18, 0.18, 0.035, tone(C.dark, 1.15), 0, 0.43, 0, 14));
  g.add(b(0.14, 0.07, 0.02, C.cream, 0, 0.4, 0.15));                     // 露出来的纸
  g.add(b(0.1, 0.05, 0.012, PAPER_D, 0.02, 0.35, 0.16));
  const crumple = ball(0.05, PAPER_D, -0.08, 0.46, 0.02, 6);             // 一团没扔准的纸
  crumple.scale.set(1, 0.8, 1);
  g.add(crumple);
  return g;
}

function heater() {                                                      // 桌脚的小暖炉
  const g = new THREE.Group();
  g.add(b(0.3, 0.26, 0.26, tone(C.brick, 0.94), 0, 0.13, 0));
  g.add(b(0.26, 0.18, 0.02, tone(C.ink, 1.1), 0, 0.13, 0.135));
  for (let i = 0; i < 3; i++) g.add(b(0.22, 0.012, 0.015, C.ink, 0, 0.07 + i * 0.055, 0.14));
  g.add(b(0.26, 0.02, 0.24, tone(C.dark, 1.2), 0, 0.27, 0));
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.1),
    M(C.yellow, { emissive: C.yellow, emissiveIntensity: 0.55, transparent: true, opacity: 0.5 }));
  glow.position.set(0, 0.09, 0.148);
  g.add(glow);
  g.add(b(0.04, 0.06, 0.02, C.dark, 0, 0.16, -0.14));                    // 电源线插座
  return g;
}

// ---------------------------------------------------------------- 光：窗投在地上的那一格
function sunPatch() {
  const g = new THREE.Group();
  // 四条窗格光带，斜着铺进屋里（长轴顺着光的方向：+x / -z）
  for (let i = 0; i < 4; i++) {
    const geo = new THREE.PlaneGeometry(0.34, 1.62);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: i % 2 ? C.cream : C.yellow, transparent: true,
      opacity: i % 2 ? 0.30 : 0.2, depthWrite: false
    }));
    m.position.set(-5.5 + i * 0.34, 0.026, 0.66 - i * 0.44);
    m.rotation.y = -0.62;
    g.add(m);
  }
  // 一圈更淡的外溢
  const haloGeo = new THREE.PlaneGeometry(2.6, 3.4);
  haloGeo.rotateX(-Math.PI / 2);
  const halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({
    color: C.yellow, transparent: true, opacity: 0.07, depthWrite: false
  }));
  halo.position.set(-4.9, 0.024, 0.2);
  halo.rotation.y = -0.5;
  g.add(halo);
  A.sunFloor = g;
  return g;
}

// ---------------------------------------------------------------- 场景装配
// 房间 12.4 × 7.1：再深一档，前场就会空出一大块水泥地——那是最容易"没安排"的地方。
const room = { x0: -6.2, x1: 6.2, z0: -4.2, z1: 2.9, h: 3.0 };

const props = [
  // ---- 吊顶：一圈线槽带 + 四盏线灯（背光面有灯，屋子才不是纸盒子）
  { id: "s_soffitB", x: 0, z: -3.82, w: 12.3, d: 0.76, passable: true,
    build: () => { const m = b(12.3, 0.12, 0.76, C.cream, 0, 2.94, 0); m.castShadow = false; return m; } },
  { id: "s_soffitL", x: -5.82, z: -0.65, w: 0.76, d: 7.0, passable: true,
    build: () => { const m = b(0.76, 0.12, 7.0, C.cream, 0, 2.94, 0); m.castShadow = false; return m; } },
  { id: "s_soffitR", x: 5.82, z: -0.65, w: 0.76, d: 7.0, passable: true,
    build: () => { const m = b(0.76, 0.12, 7.0, C.cream, 0, 2.94, 0); m.castShadow = false; return m; } },
  { id: "s_lampA", x: -3.2, z: -3.82, w: 1.2, d: 0.16, passable: true,
    build: () => linearLight(1.2) },
  { id: "s_lampB", x: 1.6, z: -3.82, w: 1.2, d: 0.16, passable: true,
    build: () => linearLight(1.2) },
  { id: "s_lampC", x: -5.82, z: 1.0, w: 0.16, d: 1.2, passable: true,
    build: () => { const g = linearLight(1.2); g.rotation.y = Math.PI / 2; return g; } },
  { id: "s_lampD", x: 5.82, z: -1.3, w: 0.16, d: 1.2, passable: true,
    build: () => { const g = linearLight(1.2); g.rotation.y = Math.PI / 2; return g; } },

  // ---- 地面：冷调罩面 + 门口的磨痕 + 饮水机前的水渍
  { id: "s_floorTone", x: 0, z: 0, w: 0.1, d: 0.1, passable: true,
    build: () => flat(11.8, 6.8, C.glass, 0, 0.015, -0.6, 0.12) },
  { id: "s_wearA", x: 3.2, z: 1.1, w: 0.1, d: 0.1, passable: true,
    build: () => flat(0.55, 2.8, tone(C.road, 1.15), 0, 0.019, 0, 0.09, 2.28) },
  { id: "s_wearB", x: -5.1, z: -2.4, w: 0.1, d: 0.1, passable: true,
    build: () => flat(1.0, 0.8, tone(C.glass, 0.95), 0, 0.021, 0, 0.22) },
  { id: "s_sun", x: 0, z: 0, w: 0.1, d: 0.1, passable: true, build: sunPatch },

  // ---- 西北：铁皮档案柜一整排（三台）+ 柜顶纸箱 + 档案室门
  { id: "s_cab1", x: -5.5, z: -3.92, w: 1.15, d: 0.56, build: ironCabinet,
    interact: { x: -5.5, z: -3.0 } },
  { id: "s_cab2", x: -4.32, z: -3.92, w: 1.15, d: 0.56, build: ironCabinet },
  { id: "s_cab3", x: -3.14, z: -3.92, w: 1.15, d: 0.56, build: ironCabinet },
  { id: "s_cabTopA", x: -5.5, z: -3.92, w: 1.2, d: 0.6, passable: true, build: cabTopA },
  { id: "s_cabTopB", x: -3.14, z: -3.92, w: 1.2, d: 0.6, passable: true, build: cabTopB },
  { id: "s_archDoor", x: -1.8, z: -4.14, w: 1.38, d: 0.16, passable: true, build: archiveDoor,
    interact: { x: -1.8, z: -3.2 } },

  // ---- 东北 / 后墙：规划图（次中心）+ 公示栏 + 旧笔录框 + 挂钟 + 日历
  { id: "s_plan", x: 0.12, z: -4.17, w: 2.2, d: 0.08, passable: true,
    build: () => { const g = planBoard(); g.position.set(0, 1.98, 0); return g; },
    interact: { x: 0.12, z: -3.3 } },
  { id: "s_notice", x: 2.02, z: -4.17, w: 1.28, d: 0.08, passable: true,
    build: () => { const g = noticeBoard(); g.position.set(0, 1.96, 0); return g; },
    interact: { x: 2.02, z: -3.4 } },
  { id: "s_oldrec", x: 3.3, z: -4.17, w: 1.0, d: 0.08, passable: true,
    build: () => { const g = recordFrame(); g.position.set(0, 1.94, 0); return g; },
    interact: { x: 3.3, z: -3.4 } },
  { id: "s_clock", x: 4.24, z: -4.17, w: 0.42, d: 0.08, passable: true,
    build: () => { const g = wallClock(); g.position.set(0, 2.34, 0); return g; } },
  { id: "s_calendar", x: 4.86, z: -4.17, w: 0.46, d: 0.06, passable: true,
    build: () => { const g = wallCalendar(); g.position.set(0, 1.94, 0); return g; } },
  { id: "s_power", x: 5.6, z: -4.18, w: 0.4, d: 0.1, passable: true,
    build: () => {
      const g = new THREE.Group();                                     // 明装电箱
      g.add(b(0.38, 0.52, 0.12, tone(C.road, 1.02), 0, 2.0, 0.05));
      g.add(b(0.32, 0.44, 0.02, tone(C.road, 0.86), 0, 2.0, 0.11));
      for (let i = 0; i < 3; i++) {
        g.add(b(0.24, 0.05, 0.03, C.cream, 0, 2.14 - i * 0.13, 0.12));
        g.add(b(0.06, 0.03, 0.02, C.ink, 0.06, 2.14 - i * 0.13, 0.135));
      }
      g.add(b(0.05, 0.16, 0.03, tone(C.road, 0.8), -0.14, 1.82, 0.12));
      return g;
    } },
  { id: "s_conduit", x: 2.3, z: -4.18, w: 7.7, d: 0.06, passable: true,
    build: () => { const g = conduit(); g.position.set(0, 2.66, 0); return g; } },
  { id: "s_switch", x: -1.0, z: -4.19, w: 0.12, d: 0.04, passable: true,
    build: () => {
      const g = new THREE.Group();
      g.add(b(0.11, 0.14, 0.02, C.cream, 0, 1.42, 0));
      g.add(b(0.05, 0.07, 0.014, tone(C.cream, 0.9), 0, 1.42, 0.017));
      return g;
    } },

  // ---- 左墙：窗（上午的光从这里进来）+ 饮水机
  { id: "s_window", x: -6.18, z: 0.55, w: 0.16, d: 2.6, passable: true, rot: Math.PI / 2,
    build: windowWall, interact: { x: -5.2, z: 0.55 } },
  { id: "s_water", x: -5.96, z: -2.9, w: 0.44, d: 0.44, build: waterCooler, rot: Math.PI / 2,
    interact: { x: -5.1, z: -2.9 } },

  // ---- 长桌（视觉中心）+ 会计椅 + 支书笔记
  { id: "s_desk", x: 0.1, z: -1.35, w: 4.2, d: 1.5, build: longDesk,
    interact: { x: 1.6, z: 0.2 } },
  { id: "s_chair", x: -0.8, z: -2.52, w: 0.52, d: 0.5, rot: 0.05, seat: true, facing: 0.05,
    build: officeChair, interact: { x: -0.8, z: -3.05 } },
  { id: "s_notes", x: 1.62, z: -1.2, w: 0.4, d: 0.3, passable: true,
    build: () => {
      const g = new THREE.Group();                                        // 摊开的硬壳笔记（f_e16）
      g.add(b(0.36, 0.016, 0.26, tone(C.ink, 1.15), 0, 0.79, 0));
      g.add(b(0.34, 0.008, 0.24, PAPER, 0, 0.798, 0));
      g.add(b(0.006, 0.01, 0.24, tone(C.ink, 1.2), 0, 0.8, 0));
      for (let i = 0; i < 3; i++) {
        g.add(b(0.14, 0.003, 0.008, tone(C.ink, 1.1), -0.08, 0.804, -0.06 + i * 0.05));
        g.add(b(0.12, 0.003, 0.008, tone(C.ink, 1.2), 0.08, 0.804, -0.06 + i * 0.05));
      }
      const pen = cy(0.008, 0.008, 0.17, C.ink, 0.08, 0.812, 0.1, 5);
      pen.rotation.z = Math.PI / 2;
      pen.rotation.y = 0.3;
      g.add(pen);
      return g;
    }, interact: { x: 1.62, z: -0.35 } },

  // ---- 西南：文件推车（停在窗下）+ 一摞纸箱 + 长条凳 + 一张塑料凳
  { id: "s_cart", x: -5.4, z: 0.55, w: 0.66, d: 0.9, build: fileCart,
    interact: { x: -4.45, z: 0.55 } },
  { id: "s_boxes", x: -5.78, z: 2.52, w: 0.7, d: 0.56, build: cartons },
  { id: "s_bench", x: -1.85, z: 1.72, w: 1.9, d: 0.4, rot: 0.04, seat: true, facing: 0.04,
    build: bench, interact: { x: -1.85, z: 2.42 } },
  { id: "s_stoolA", x: -3.55, z: 1.55, w: 0.36, d: 0.34, build: stool, rot: 0.3 },

  // ---- 东南：侧门 + 门垫 + 拖把 + 纸篓 + 暖炉 + 门前那张凳子
  { id: "s_door", x: 6.17, z: 1.25, w: 0.16, d: 1.32, passable: true, rot: -Math.PI / 2,
    build: sideDoor, interact: { x: 5.2, z: 1.25 } },
  { id: "s_mat", x: 5.25, z: 1.25, w: 0.7, d: 1.0, passable: true, build: doorMat },
  { id: "s_mop", x: 5.6, z: 2.45, w: 0.42, d: 0.42, passable: true, build: mopBucket },
  { id: "s_bin", x: 2.52, z: -0.62, w: 0.36, d: 0.36, build: wasteBin },
  { id: "s_heater", x: -2.6, z: -1.05, w: 0.32, d: 0.28, build: heater },
  { id: "s_stoolB", x: 1.92, z: 0.12, w: 0.36, d: 0.34, rot: -0.22, build: stool }
];

// 碰撞：家具进网格，人物半径由运行时膨胀
const obstacles = props.filter((p) => !p.passable).map((p) => ({ x: p.x, z: p.z, w: p.w, d: p.d }));
obstacles.push({ x: 0, z: room.z0, w: 12.6, d: 0.4 });
obstacles.push({ x: room.x0, z: -0.65, w: 0.4, d: 7.1 });
obstacles.push({ x: room.x1, z: -0.65, w: 0.4, d: 7.1 });

// 人物：钱春香（村会计，坐桌后翻账册）/ 周建国（副主任，站桌侧）/ 来打证明的村民
const characters = [
  { id: "qian", label: "钱春香", name: "钱春香", role: "村会计",
    x: -0.8, z: -2.5, y: -0.09, facing: 0.05, pose: "sit",
    color: tone(C.brick, 0.84), pants: DARK, hair: "#3a2c22", scale: 0.98 },
  { id: "zhou_shuji", label: "周建国", name: "周建国", role: "村委会副主任",
    x: 3.0, z: -2.2, facing: -0.4, pose: "stand",
    color: C.white, pants: C.navy, hair: "#2e251e", scale: 1.0 },
  { id: "amb_villager", label: "", name: "来开证明的村民", role: "办事村民",
    x: 4.9, z: 1.5, facing: -2.35, pose: "stand",
    color: C.road, pants: tone(C.dark, 1.1), hair: "#3a2c22", ambient: true, scale: 0.95 }
];

let scene;
try {
  scene = createScene({
    mount: document.getElementById("stage"),
    room,
    props,
    obstacles,
    characters,
    lamps: [],
    // 底座与房间：奶油白墙（刷过很多遍、泛黄）、沙色台阶、深蓝台身
    baseColor: C.cream, baseSideColor: C.navy, siteColor: C.sand,
    terrainSideColor: C.road,
    wallColor: C.cream, wallOutColor: C.sand, wallCapColor: C.road, skirtColor: C.white,
    floorColor: tone(C.cream, 0.9),                                  // 水泥地：泛一点黄的白
    skyTop: C.glass, skyMid: C.white, skyBottom: C.cream,
    // 上午十一点：暖主光从左侧窗斜进来，冷补光兜住背光面
    light: { sun: C.cream, sunI: 2.3, fill: C.blue, fillI: 1.0, hemi: 0.72,
             hemiSky: C.glass, hemiGround: C.sand, exposure: 0.98 },
    actor: { x: 0.6, z: 2.2 },
    camYaw: 0.36, camPitch: 0.6, camDist: 15, camFocus: [0, 1.0, -0.4],
    walk: { x0: -5.6, x1: 5.6, z0: -3.6, z1: 2.62 },
    onSpot: (p) => { (window.__events = window.__events || []).push(["spot", p.id]); },
    onPerson: (p) => { (window.__events = window.__events || []).push(["person", p.id]); },
    onArrived: (p) => { (window.__events = window.__events || []).push(["arrived", +p.x.toFixed(2), +p.z.toFixed(2)]); },
    onSeat: (p) => { (window.__events = window.__events || []).push(["seat", p.id]); },
    // ---- 基础动效：11 条，幅度全部 2% 量级
    onFrame: (t) => {
      // ① 窗帘被风带起一角又落下（0.02 弧度，两片不同相）
      A.curtain.forEach((c, i) => {
        const gust = 0.5 + 0.5 * Math.sin(t * 0.19 + i * 1.7);
        c.rotation.z = Math.sin(t * 0.74 + i * 2.1) * 0.02 * gust;
        c.rotation.x = Math.sin(t * 0.53 + i) * 0.012;
      });
      // ② 窗投在地上的光格随日照极缓移动（20 秒一指宽）
      if (A.sunFloor) {
        A.sunFloor.position.x = Math.sin(t * 0.052) * 0.05;
        A.sunFloor.position.z = Math.sin(t * 0.039 + 1.2) * 0.03;
      }
      // ③ 桌面那一片窗光极缓地明暗（1.8%）
      if (A.sunDesk) {
        A.sunDesk.material.opacity = 0.14 * (1 + Math.sin(t * 0.31) * 0.1);
        A.sunDesk.scale.set(1 + Math.sin(t * 0.21) * 0.02, 1, 1 + Math.cos(t * 0.17) * 0.02);
      }
      // ④ 账册最上面那页的页角轻微起伏（1 厘米）
      A.pages.forEach((p, i) => {
        p.rotation.x = -Math.abs(Math.sin(t * 0.62 + i)) * 0.055;
        p.rotation.z = Math.sin(t * 0.44 + i) * 0.02;
      });
      // ⑤ 公示栏里那张纸的角一掀一落
      if (A.paper) { A.paper.rotation.z = Math.sin(t * 0.83) * 0.05; A.paper.rotation.x = Math.sin(t * 0.61) * 0.03; }
      // ⑥ 档案室门帘被穿堂风掀起一半，又慢慢落回去（每片错开）
      A.strips.forEach((s, i) => {
        const g = 0.5 + 0.5 * Math.sin(t * 0.27 + i * 0.7);
        s.o.rotation.z = s.rz + Math.sin(t * 0.9 + s.ph) * 0.018 * g;
        s.o.rotation.x = Math.sin(t * 1.05 + s.ph * 1.3) * 0.03 * g;
      });
      // ⑦ 门缝那条光偶尔变暗，像走廊上有人走过（1.8%）；档案室里那盏灯也只是一点点起伏
      if (A.doorLight) {
        const dim = 1 - 0.02 * (0.5 + 0.5 * Math.sin(t * 0.33));
        A.doorLight.material.emissiveIntensity = 0.9 * dim;
        A.doorLight.material.opacity = 0.78 * dim;
      }
      if (A.archLamp) {
        A.archLamp.material.emissiveIntensity = 0.55 * (1 + Math.sin(t * 0.44 + 1.1) * 0.018);
      }
      // ⑧ 吊顶线灯极缓地呼吸（1.8%，公家的灯不该闪）
      for (const l of A.lamp) {
        l.m.material.emissiveIntensity = l.base * (1 + Math.sin(t * 1.6) * 0.018);
      }
      // ⑨ 挂钟秒针一格一格走
      if (A.sec) { A.sec.rotation.z = -Math.floor(t * 1) * (Math.PI * 2 / 60); }
      // ⑩ 饮水机桶里偶尔冒起一串小气泡
      for (const bp of A.bubbles) {
        const q = (t * 0.15 + bp.ph) % 1;
        bp.o.position.y = 0.94 + q * 0.22;
        bp.o.position.x = bp.x + Math.sin(q * 6) * 0.012;
        bp.o.material.opacity = 0.7 * Math.sin(q * Math.PI);
      }
      // ⑪ 算盘上有一颗珠子被人碰了一下（2% 幅度的位移）
      if (A.bead) { A.bead.position.z = A.beadX + Math.sin(t * 0.9) * 0.004; }
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
