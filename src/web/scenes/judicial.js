// S9 · 镇司法所（下午 14:00）——「依法转办」的落点
// -----------------------------------------------------------------------------
// 按 docs/场景与人物建模提示词.md v5 §1 + §3 S9 重做（2026-11-04，质量第一）。
// 七段结构一一对应：画面风格 / 底座与构图 / 时间与氛围 / 外观 / 陈设 / 基础动效 / 避免。
//   ① 颜色只走 kit 的 PAL（C.*），本文件里没有任何一个色板外的十六进制值；
//   ② 大件描边由 kit.b 自动加（最大边 > 0.55），小件走直角盒，不浪费面；
//   ③ 零噪点：地面、墙面、柜面、桌面全是纯色 + 几何分格，没有一张 canvas 噪点贴图；
//   ④ 四格分区：西北 卷宗柜×2 + 后门 + 意见箱 / 东北 两张办公桌 + 复印机 /
//                西南 等候长椅×2 + 茶几 + 报刊架 / 东南 玻璃柜台 + 取号机 + 饮水机；
//   ⑤ 视觉中心：5.6 米柜台 + 三片 1.6×1.0 玻璃隔断（中间 1.9 米传话口 + 文件槽）；
//      次中心：后墙的抽象标识牌与调解流程图 —— 侧墙是掠射角，挂了等于没挂，所以都挂后墙；
//   ⑥ onFrame 里 10 条 2% 量级循环动效：小风扇 4 秒一圈 / 玻璃反光缓移 / 饮水机加热灯明暗 /
//      卷宗室灯 9 秒一次渐变 / 纸角被风掀起 / 筒灯稳定不闪 / 屏幕呼吸 / 绿萝 / 电话灯 / 复印机灯。
// -----------------------------------------------------------------------------
import * as THREE from "./vendor/three.module.min.js";
import { PAL as C, M, b, cy, ball } from "./kit.js";
import { createScene } from "./scene3d.js";

window.__err = "";
window.addEventListener("error", (e) => {
  window.__err = (e.message || "error") + " @ " + (e.filename || "") + ":" + (e.lineno || 0);
});

// ---------------------------------------------------------------- 动画句柄
// 所有会动的部件在这里登记，onFrame 统一驱动；幅度一律 2% 量级。
const A = {
  fan: null,            // 小风扇叶轮
  refl: [],             // 玻璃上的反光片（每片记基准位置与基准透明度）
  heat: null,           // 饮水机加热灯
  roomLamp: [],         // 卷宗室透出来的灯
  spill: null,          // 门口地上那摊光
  paper: null,          // 被风扇掀起一角的纸
  lamp: [],             // 筒灯发光面
  screen: null,         // 电脑屏
  vines: [],            // 绿萝垂枝
  led: [],              // 电话 / 复印机指示灯
  bubbles: [],          // 饮水机桶里的小气泡
};

// ---------------------------------------------------------------- 纸、片、玻璃
// 贴地/贴墙薄片（磨痕、光斑）：不写深度，纯色
function flat(w, d, color, x, y, z, op, ry = 0) {
  const geo = new THREE.PlaneGeometry(w, d);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color, transparent: op < 1, opacity: op, depthWrite: false
  }));
  m.position.set(x, y, z);
  m.rotation.y = ry;
  return m;
}
// 玻璃：真的透、真的有反光。MeshPhysicalMaterial + 低透明 + 不投影。
function glassPane(w, h, x, y, z, op = 0.26) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshPhysicalMaterial({
    color: C.glass, transparent: true, opacity: op, roughness: 0.05, metalness: 0.02,
    clearcoat: 1, clearcoatRoughness: 0.06, side: THREE.DoubleSide, depthWrite: false
  }));
  m.position.set(x, y, z);
  return m;
}
// 铝框：四根 0.035 见方的压条，把一片玻璃"装"进隔断里
function paneFrame(g, cx, cy, cz, color) {
  g.add(b(1.66, 0.035, 0.055, color, cx, cy + 0.5, cz));
  g.add(b(1.66, 0.035, 0.055, color, cx, cy - 0.5, cz));
  g.add(b(0.035, 1.03, 0.055, color, cx - 0.81, cy, cz));
  g.add(b(0.035, 1.03, 0.055, color, cx + 0.81, cy, cz));
}
// 反光：一条软的白，斜着压在玻璃上。幅度只有 0.05 单位，靠透明度变化被看见。
function reflBand(w, h, x, y, z, op, rot) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
    color: C.white, transparent: true, opacity: op, depthWrite: false
  }));
  m.position.set(x, y, z);
  m.rotation.z = rot;
  m.renderOrder = 3;
  A.refl.push({ m, x0: x, op, ph: A.refl.length * 1.37 });
  return m;
}
// ---------------------------------------------------------------- 灯
// 筒灯：吊顶带下一排。正式场所的灯是稳的，只给 0.6% 的呼吸，镜头里看不出闪。
function downlightRow(n, gap) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * gap;
    g.add(cy(0.2, 0.2, 0.055, C.white, x, 2.875, 0, 18));           // 灯杯外圈
    g.add(cy(0.168, 0.168, 0.03, C.sand, x, 2.848, 0, 18));         // 反光碗
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.128, 0.128, 0.016, 18),
      M(C.cream, { emissive: C.yellow, emissiveIntensity: 1.15 }));
    glow.position.set(x, 2.83, 0);
    g.add(glow);
    A.lamp.push({ m: glow, base: 1.15 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.196, 0.008, 5, 20), M(C.white));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, 2.852, 0);
    g.add(ring);
  }
  return g;
}

// ---------------------------------------------------------------- 柜台（视觉中心）
// 5.6 米柜体 + 5.7 米台面；三片 1.6×1.0 玻璃：左右两片固定，中间那片推到右边停着，
// 留出 1.9 米宽的传话口 —— 开口下沿一块 0.1 米高的横板，旁边一个文件槽。
function counterDesk() {
  const g = new THREE.Group();

  // ---- 柜体：踢脚内收、前面板分四格、一道腰线
  g.add(b(5.46, 0.09, 0.6, C.dark, 0, 0.045, 0));                    // 踢脚
  g.add(b(5.6, 0.86, 0.66, C.wood, 0, 0.5, 0));                       // 柜体
  for (let i = 0; i < 4; i++) {                                        // 前面板四格：板面凸出，缝才是凹的
    g.add(b(1.34, 0.74, 0.02, C.wood, -2.1 + i * 1.4, 0.5, 0.34));
    g.add(b(1.3, 0.028, 0.006, C.sand, -2.1 + i * 1.4, 0.785, 0.353)); // 每格上沿一道亮口
  }
  g.add(b(5.56, 0.03, 0.014, C.sand, 0, 0.83, 0.349));                 // 腰线
  g.add(b(5.7, 0.07, 0.8, C.wood, 0, 0.985, 0));                       // 台面（上表面 1.02）
  g.add(b(5.74, 0.045, 0.04, C.sand, 0, 0.985, 0.4));                  // 台面前沿压条
  g.add(b(5.66, 0.02, 0.02, C.tile, 0, 0.945, 0.408));                 // 台面下暗缝
  g.add(b(5.6, 0.1, 0.04, C.wood, 0, 1.07, -0.39));                    // 内侧挡板
  // 内侧（Staff 侧）三只抽屉：从 110° 看得到柜台背面，不能是一整块空板
  for (let i = 0; i < 3; i++) {
    const x = -1.8 + i * 1.8;
    g.add(b(1.5, 0.23, 0.02, C.wood, x, 0.72, -0.34));
    g.add(b(1.44, 0.19, 0.012, C.sand, x, 0.72, -0.35));
    g.add(b(0.26, 0.022, 0.03, C.road, x, 0.76, -0.362));
    g.add(b(1.5, 0.32, 0.02, C.wood, x, 0.34, -0.34));                  // 下面一格柜门
    g.add(b(1.44, 0.26, 0.012, C.sand, x, 0.34, -0.35));
  }

  // ---- 传话口：两根立柱夹出 1.9 米开口，开口下沿一块 0.1 米高的横板
  for (const sx of [-1, 1]) {
    g.add(b(0.12, 1.08, 0.1, C.blue, sx * 0.95, 1.56, -0.06));         // 立柱 1.02 → 2.10
    g.add(b(0.16, 0.05, 0.14, C.blue, sx * 0.95, 1.045, -0.06));       // 柱脚
    g.add(b(0.16, 0.04, 0.14, C.blue, sx * 0.95, 2.075, -0.06));       // 柱头
  }
  g.add(b(1.9, 0.1, 0.2, C.wood, 0, 1.07, 0.06));                      // 传话口横板（1.02 → 1.12）
  g.add(b(1.92, 0.018, 0.21, C.sand, 0, 1.129, 0.06));                 // 横板压边
  g.add(b(1.86, 0.016, 0.02, C.tile, 0, 1.019, 0.152));                // 横板根部暗缝
  // 横板上正递进来的一份材料：纸角翘着，盖了受理章，旁边压着回形针
  const pass = new THREE.Group();
  pass.position.set(0.3, 1.141, 0.06);
  const p1 = b(0.3, 0.004, 0.2, C.white, 0, 0, 0);
  p1.rotation.y = 0.06;
  pass.add(p1);
  for (let i = 0; i < 4; i++) pass.add(b(0.2, 0.002, 0.006, C.road, -0.02, 0.003, -0.05 + i * 0.035));
  pass.add(b(0.06, 0.002, 0.06, C.coral, 0.08, 0.003, 0.05));
  const p2 = b(0.26, 0.004, 0.18, C.cream, 0.01, 0.006, 0.012);
  p2.rotation.y = -0.1; p2.rotation.x = 0.05;
  pass.add(p2);
  g.add(pass);
  g.add(b(0.05, 0.012, 0.02, C.road, -0.06, 1.145, 0.1));              // 回形针

  // ---- 上横杆：5.56 长，压住三片玻璃；顶面一道亮边
  g.add(b(5.56, 0.1, 0.13, C.blue, 0, 2.155, -0.06));
  g.add(b(5.6, 0.03, 0.15, C.white, 0, 2.212, -0.06));
  for (const sx of [-1, 1]) g.add(b(0.1, 0.14, 0.15, C.blue, sx * 2.83, 2.155, -0.06));

  // ---- 三片玻璃：左右固定，第三片是活动扇，推到右边停着
  g.add(glassPane(1.6, 1.0, -1.95, 1.56, -0.06));
  g.add(glassPane(1.6, 1.0, 1.95, 1.56, -0.06));
  g.add(glassPane(1.6, 1.0, 1.95, 1.56, -0.19, 0.36));
  paneFrame(g, -1.95, 1.56, -0.06, C.blue);
  paneFrame(g, 1.95, 1.56, -0.06, C.blue);
  paneFrame(g, 1.95, 1.56, -0.19, C.road);                            // 活动扇的框深一号
  g.add(b(0.05, 0.3, 0.05, C.road, 1.15, 1.5, -0.17));                // 活动扇手柄
  g.add(b(0.11, 0.04, 0.06, C.road, 1.17, 1.62, -0.17));
  for (const sx of [1.25, 2.62]) {                                    // 上轨吊轮
    g.add(b(0.1, 0.035, 0.09, C.road, sx, 2.085, -0.19));
    g.add(cy(0.026, 0.026, 0.03, C.dark, sx, 2.06, -0.19, 10));
  }
  g.add(b(5.4, 0.02, 0.02, C.tile, 0, 2.098, -0.19));                  // 轨道槽

  // ---- 玻璃的"存在感"：上口一道磨砂带 + 下口一道亮边（不然玻璃就只剩框）
  for (const cx of [-1.95, 1.95]) {
    const band = new THREE.Mesh(new THREE.PlaneGeometry(1.56, 0.2), new THREE.MeshBasicMaterial({
      color: C.white, transparent: true, opacity: 0.13, depthWrite: false
    }));
    band.position.set(cx, 1.94, -0.048);
    g.add(band);
    g.add(b(1.56, 0.022, 0.012, C.white, cx, 2.052, -0.05));           // 上口亮边
    g.add(b(1.56, 0.016, 0.012, C.white, cx, 1.072, -0.05));           // 下口亮边
  }

  // ---- 反光：一处是窗、一处是灯管，都是斜的、都很软
  g.add(reflBand(0.46, 0.78, -2.08, 1.56, -0.045, 0.15, 0.38));
  g.add(reflBand(0.1, 0.86, -1.6, 1.58, -0.045, 0.22, 0.36));
  g.add(reflBand(0.36, 0.7, 1.72, 1.55, -0.045, 0.12, 0.4));
  g.add(reflBand(0.09, 0.82, 1.34, 1.6, -0.182, 0.18, 0.34));         // 活动扇上的一道

  // ---- 台面：登记簿 / 印台 / 电话 / 纸杯 / 卷宗 / 订书机 / 小风扇
  const reg = new THREE.Group();                                       // 受理登记簿（摊开）
  reg.position.set(-2.52, 1.02, 0.02);
  reg.add(b(0.5, 0.014, 0.34, C.road, 0, 0.007, 0));
  const pgL = b(0.23, 0.004, 0.31, C.white, -0.115, 0.016, 0);
  const pgR = b(0.23, 0.004, 0.31, C.cream, 0.115, 0.016, 0);
  pgL.rotation.z = 0.02; pgR.rotation.z = -0.02;
  reg.add(pgL, pgR);
  for (let i = 0; i < 5; i++) {
    reg.add(b(0.17, 0.002, 0.006, C.road, -0.12, 0.019, -0.09 + i * 0.045));
    reg.add(b(0.15, 0.002, 0.006, C.road, 0.12, 0.019, -0.09 + i * 0.045));
  }
  reg.add(b(0.03, 0.002, 0.1, C.coral, 0.02, 0.02, 0.1));               // 书签
  const pen = cy(0.011, 0.011, 0.17, C.ink, 0.06, 0.026, 0.08, 6);
  pen.rotation.z = Math.PI / 2; pen.rotation.y = 0.6;
  reg.add(pen);
  g.add(reg);

  const pad = new THREE.Group();                                       // 印台（盒盖斜靠在后面）
  pad.position.set(-1.82, 1.02, 0.08);
  pad.add(b(0.15, 0.03, 0.15, C.road, 0, 0.015, 0));
  pad.add(b(0.11, 0.008, 0.11, C.coral, 0, 0.032, 0));
  const lid = b(0.15, 0.012, 0.15, C.dark, 0, 0.05, -0.15);
  lid.rotation.x = 0.5;
  pad.add(lid);
  g.add(pad);

  const phone = new THREE.Group();                                     // 电话机
  phone.position.set(-0.52, 1.02, -0.14);
  phone.add(b(0.24, 0.055, 0.2, C.dark, 0, 0.027, 0));
  phone.add(b(0.05, 0.04, 0.19, C.ink, -0.09, 0.075, 0));              // 听筒
  phone.add(b(0.2, 0.03, 0.05, C.ink, 0, 0.07, -0.06));
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      phone.add(b(0.022, 0.008, 0.016, C.road, -0.03 + c * 0.03, 0.058, 0.0 + r * 0.025));
    }
  }
  const pled = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, 0.01),
    M(C.mint, { emissive: C.mint, emissiveIntensity: 1.1 }));
  pled.position.set(0.09, 0.062, 0.06);
  phone.add(pled);
  A.led.push({ m: pled, base: 1.1, ph: 0.4 });
  phone.add(b(0.1, 0.006, 0.02, C.cream, 0.0, 0.057, 0.07));           // 来电显示条
  g.add(phone);

  for (let i = 0; i < 2; i++) {                                        // 两只纸杯
    const y = 1.02;
    g.add(cy(0.042, 0.032, 0.09, C.white, 0.52 + i * 0.16, y + 0.045, 0.1 - i * 0.06, 12));
    g.add(cy(0.044, 0.044, 0.008, C.cream, 0.52 + i * 0.16, y + 0.09, 0.1 - i * 0.06, 12));
  }

  const files = new THREE.Group();                                     // 一摞卷宗（三本，标签错开）
  files.position.set(2.42, 1.02, 0);
  for (let i = 0; i < 3; i++) {
    files.add(b(0.36, 0.03, 0.26, i % 2 ? C.sand : C.cream, 0, 0.015 + i * 0.03, 0));
    files.add(b(0.14, 0.02, 0.008, C.coral, -0.1 + i * 0.02, 0.017 + i * 0.03, 0.131));
  }
  files.add(b(0.05, 0.012, 0.03, C.road, 0.12, 0.1, 0.11));            // 压在上面的回形针
  g.add(files);

  g.add(b(0.16, 0.05, 0.07, C.dark, 1.9, 1.045, 0.02));                // 订书机
  g.add(b(0.1, 0.012, 0.05, C.road, 1.9, 1.075, 0.02));

  // ---- 文件槽：不锈钢托盘 + 一道缝，里面插着两张待受理的材料
  const slot = new THREE.Group();
  slot.position.set(1.18, 1.02, 0.02);
  slot.add(b(0.5, 0.02, 0.26, C.road, 0, 0.01, 0));
  slot.add(b(0.46, 0.012, 0.05, C.dark, 0, 0.028, 0.0));
  slot.add(b(0.46, 0.02, 0.03, C.road, 0, 0.035, -0.1));
  const s1 = b(0.34, 0.004, 0.2, C.white, 0.0, 0.05, 0.01);
  s1.rotation.x = -0.12;
  const s2 = b(0.3, 0.004, 0.18, C.cream, 0.02, 0.068, -0.02);
  s2.rotation.x = -0.18; s2.rotation.z = 0.04;
  slot.add(s1, s2);
  for (let i = 0; i < 4; i++) slot.add(b(0.2, 0.002, 0.008, C.road, 0, 0.073, -0.05 + i * 0.035));
  g.add(slot);

  // ---- 小风扇：台面上唯一"自己会动"的东西，4 秒一圈
  const fan = new THREE.Group();
  fan.position.set(-2.38, 1.02, -0.2);
  fan.add(cy(0.1, 0.08, 0.03, C.road, 0, 0.015, 0, 14));               // 底盘
  fan.add(cy(0.022, 0.022, 0.2, C.road, 0, 0.13, 0, 8));               // 立杆
  const head = new THREE.Group();
  head.position.set(0, 0.28, 0);
  head.rotation.y = -Math.PI / 2;                                      // 扇面朝 +x
  const cage = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.008, 5, 22), M(C.road));
  cage.position.z = 0.05;
  head.add(cage);
  const cage2 = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.006, 5, 22), M(C.road));
  cage2.position.z = 0.015;
  head.add(cage2);
  for (let i = 0; i < 4; i++) {                                        // 网罩辐条
    const sp = b(0.008, 0.31, 0.006, C.road, 0, 0, 0.04);
    sp.rotation.z = i * Math.PI / 4;
    head.add(sp);
  }
  head.add(cy(0.045, 0.04, 0.06, C.white, 0, 0, 0.02, 12));            // 电机壳
  const spin = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const bl = b(0.13, 0.075, 0.008, C.blue, 0, 0, 0.042);
    bl.position.set(Math.cos(i * 2.094) * 0.075, Math.sin(i * 2.094) * 0.075, 0.042);
    bl.rotation.z = i * 2.094;
    spin.add(bl);
  }
  spin.add(cy(0.032, 0.032, 0.016, C.white, 0, 0, 0.05, 12));
  head.add(spin);
  fan.add(head);
  g.add(fan);
  A.fan = spin;

  // ---- 被风扇吹着的那张纸：一角掀起 0.02 弧度
  const loose = new THREE.Group();
  loose.position.set(-1.5, 1.026, 0.04);
  loose.add(b(0.3, 0.004, 0.22, C.white, 0, 0, 0));
  for (let i = 0; i < 5; i++) loose.add(b(0.2, 0.002, 0.006, C.road, 0, 0.003, -0.07 + i * 0.035));
  loose.add(b(0.05, 0.002, 0.05, C.coral, 0.09, 0.003, 0.06));          // 受理章
  g.add(loose);
  A.paper = loose;

  return g;
}

// ---------------------------------------------------------------- 办公桌
function officeDesk(withPC) {
  const g = new THREE.Group();
  g.add(b(1.9, 0.06, 1.0, C.wood, 0, 0.73, 0));                        // 桌面（上表面 0.76）
  g.add(b(1.94, 0.03, 1.04, C.sand, 0, 0.697, 0));                      // 台沿
  for (const sx of [-1, 1]) g.add(b(0.05, 0.7, 0.94, C.wood, sx * 0.92, 0.36, 0));
  g.add(b(1.8, 0.3, 0.04, C.wood, 0, 0.55, -0.46));                     // 背板

  // 右侧抽屉柜：三抽 + 拉手 + 锁孔
  g.add(b(0.46, 0.66, 0.9, C.wood, 0.62, 0.34, 0));
  for (let i = 0; i < 3; i++) {
    const y = 0.57 - i * 0.2;
    g.add(b(0.4, 0.17, 0.02, C.sand, 0.62, y, 0.462));
    g.add(b(0.16, 0.022, 0.03, C.road, 0.62, y, 0.48));
    const lock = cy(0.014, 0.014, 0.012, C.dark, 0.62, y - 0.055, 0.472, 6);
    lock.rotation.x = Math.PI / 2;
    g.add(lock);
  }

  // 桌面：键盘、鼠标
  g.add(b(0.44, 0.022, 0.15, C.white, -0.3, 0.771, 0.24));
  for (let i = 0; i < 3; i++) g.add(b(0.4, 0.004, 0.012, C.road, -0.3, 0.783, 0.2 + i * 0.035));
  g.add(b(0.06, 0.02, 0.1, C.white, 0.02, 0.77, 0.26));

  if (withPC) {
    // 显示器：屏面朝 +z（镜头这一侧），屏上三道极简 UI 线
    g.add(b(0.26, 0.02, 0.18, C.dark, -0.12, 0.772, -0.3));
    g.add(b(0.05, 0.22, 0.05, C.dark, -0.12, 0.88, -0.3));
    g.add(b(0.66, 0.42, 0.035, C.dark, -0.12, 1.14, -0.3));
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.36),
      M(C.dark, { emissive: C.blue, emissiveIntensity: 0.85 }));
    scr.position.set(-0.12, 1.14, -0.28);
    g.add(scr);
    A.screen = scr;
    for (let i = 0; i < 3; i++) g.add(b(0.34 - i * 0.06, 0.014, 0.004, C.white, -0.2, 1.24 - i * 0.05, -0.276));
    g.add(b(0.12, 0.1, 0.004, C.yellow, 0.2, 1.24, -0.276));            // 屏框上的便利贴
    // 文件盒 + 笔筒
    g.add(b(0.22, 0.28, 0.09, C.blue, -0.82, 0.9, -0.32));
    g.add(b(0.19, 0.04, 0.012, C.white, -0.82, 0.98, -0.27));
    g.add(b(0.19, 0.04, 0.012, C.white, -0.82, 0.9, -0.27));
    g.add(cy(0.05, 0.045, 0.11, C.road, 0.78, 0.815, -0.32, 12));
    for (let i = 0; i < 3; i++) {
      const p2 = cy(0.008, 0.008, 0.17, [C.ink, C.coral, C.navy][i], 0.77 + i * 0.02, 0.9, -0.32, 6);
      p2.rotation.z = 0.1 - i * 0.1;
      g.add(p2);
    }
  } else {
    // 没电脑的那张：三层文件盘 + 一盆小绿植 + 一摞待盖章的材料
    g.add(b(0.34, 0.06, 0.26, C.blue, -0.3, 0.79, -0.24));
    g.add(b(0.3, 0.02, 0.24, C.white, -0.3, 0.815, -0.24));
    g.add(b(0.3, 0.06, 0.24, C.road, -0.3, 0.85, -0.24));
    g.add(b(0.28, 0.02, 0.22, C.cream, -0.3, 0.885, -0.24));
    g.add(cy(0.075, 0.065, 0.12, C.wood, 0.74, 0.82, -0.26, 12));
    for (let i = 0; i < 5; i++) {
      const a = i * 1.26;
      const lf = ball(0.07, i % 2 ? C.mint : C.sea,
        0.74 + Math.cos(a) * 0.08, 0.93 + (i % 3) * 0.03, -0.26 + Math.sin(a) * 0.07, 7);
      lf.scale.set(1.3, 0.4, 1);
      g.add(lf);
    }
    g.add(b(0.3, 0.05, 0.22, C.white, 0.3, 0.79, 0.2));
    for (let i = 0; i < 2; i++) g.add(b(0.2, 0.008, 0.008, C.road, 0.3, 0.818, 0.16 + i * 0.04));
    g.add(b(0.07, 0.008, 0.07, C.coral, 0.34, 0.821, 0.22));
  }

  // 台历（斜立）+ 电话 + 卷宗 + 纸杯 + 桌牌
  const cal = new THREE.Group();
  cal.position.set(0.58, 0.76, 0.1);
  cal.rotation.x = -0.18;
  cal.add(b(0.26, 0.02, 0.2, C.white, 0, 0.02, 0));
  cal.add(b(0.26, 0.05, 0.012, C.coral, 0, 0.06, -0.09));
  for (let i = 0; i < 3; i++) cal.add(b(0.18 - i * 0.04, 0.006, 0.008, C.road, -0.02, 0.04 - i * 0.03, 0.02 + i * 0.03));
  g.add(cal);

  g.add(b(0.22, 0.05, 0.18, C.dark, -0.66, 0.785, 0.3));
  g.add(b(0.05, 0.035, 0.17, C.ink, -0.75, 0.83, 0.3));
  g.add(b(0.32, 0.06, 0.24, C.sand, 0.24, 0.79, -0.02));
  g.add(b(0.12, 0.02, 0.008, C.coral, 0.24, 0.822, 0.1));
  g.add(cy(0.038, 0.03, 0.09, C.white, 0.44, 0.805, 0.32, 12));
  const card = b(0.22, 0.09, 0.008, C.white, -0.34, 0.81, 0.34);
  card.rotation.x = -0.2;
  g.add(card);
  g.add(b(0.14, 0.014, 0.004, C.road, -0.34, 0.82, 0.345));
  return g;
}

function swivelChair() {
  const g = new THREE.Group();
  g.add(cy(0.24, 0.28, 0.04, C.road, 0, 0.03, 0, 16));                  // 五星脚
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5;
    const leg = b(0.44, 0.035, 0.06, C.road, Math.cos(a) * 0.22, 0.045, Math.sin(a) * 0.22);
    leg.rotation.y = -a;
    g.add(leg);
    g.add(cy(0.028, 0.028, 0.03, C.dark, Math.cos(a) * 0.4, 0.028, Math.sin(a) * 0.4, 8));
  }
  g.add(cy(0.045, 0.045, 0.3, C.dark, 0, 0.2, 0, 10));                  // 气压杆
  g.add(b(0.5, 0.09, 0.48, C.navy, 0, 0.4, 0));                         // 座（上表面 0.445）
  g.add(b(0.46, 0.02, 0.44, C.blue, 0, 0.45, -0.01));
  g.add(b(0.5, 0.5, 0.07, C.navy, 0, 0.7, -0.23));                      // 靠背
  g.add(b(0.44, 0.04, 0.06, C.blue, 0, 0.6, -0.24));
  for (const sx of [-1, 1]) {                                           // 扶手
    g.add(b(0.05, 0.05, 0.3, C.road, sx * 0.28, 0.5, 0.02));
    g.add(b(0.08, 0.04, 0.12, C.dark, sx * 0.28, 0.55, 0.1));
  }
  return g;
}

// ---------------------------------------------------------------- 卷宗柜
function fileCabinet() {
  const g = new THREE.Group();
  g.add(b(1.0, 1.55, 0.5, C.road, 0, 0.8, 0));                          // 柜体
  g.add(b(1.04, 0.05, 0.54, C.dark, 0, 1.6, 0));                        // 顶板
  g.add(b(0.94, 0.06, 0.46, C.dark, 0, 0.05, 0));                       // 底座
  for (let r = 0; r < 4; r++) {
    const y = 1.36 - r * 0.31;
    g.add(b(0.92, 0.27, 0.03, C.blue, 0, y, 0.26));                     // 抽屉面
    g.add(b(0.86, 0.22, 0.012, C.blue, 0, y, 0.276));                   // 抽屉里板（一道浅槽）
    g.add(b(0.22, 0.028, 0.03, C.dark, 0, y + 0.04, 0.285));            // 拉手
    g.add(b(0.2, 0.05, 0.01, C.white, -0.26, y + 0.09, 0.278));         // 手写标签条
    g.add(b(0.12, 0.006, 0.008, C.road, -0.26, y + 0.09, 0.284));
    const lock = cy(0.016, 0.016, 0.014, C.dark, 0.34, y, 0.284, 8);
    lock.rotation.x = Math.PI / 2;
    g.add(lock);
    g.add(b(0.02, 0.03, 0.006, C.tile, 0.34, y - 0.05, 0.28));          // 锁孔槽
  }
  return g;
}

// 柜顶：往年卷宗一摞摞，年份标签用红条
function cabinetTop(seed) {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const h = 0.1 + (i % 2) * 0.03;
    g.add(b(0.42, h, 0.3, i % 2 ? C.sand : C.cream, -0.28 + seed * 0.05, 1.63 + i * 0.12, -0.02));
    g.add(b(0.16, 0.035, 0.008, C.coral, -0.32 + seed * 0.05, 1.64 + i * 0.12, 0.13));
  }
  g.add(b(0.3, 0.22, 0.24, C.blue, 0.24, 1.73, 0.02));                  // 立着的一只档案盒
  g.add(b(0.2, 0.03, 0.008, C.white, 0.24, 1.79, 0.145));
  g.add(b(0.26, 0.06, 0.2, C.road, 0.02, 1.66, 0.12));                  // 一叠待归档
  return g;
}

// 墙上隔板：六只档案盒 + 一摞横放的卷宗
function wallShelf() {
  const g = new THREE.Group();
  g.add(b(2.2, 0.04, 0.16, C.wood, 0, 0, 0));
  g.add(b(2.24, 0.03, 0.18, C.sand, 0, 0.03, 0));
  for (const sx of [-1, 1]) g.add(b(0.05, 0.12, 0.14, C.road, sx * 0.85, -0.07, 0));  // 托架
  for (let i = 0; i < 6; i++) {
    const c = [C.cream, C.sand, C.blue, C.cream, C.sand, C.blue][i];
    g.add(b(0.1, 0.28, 0.12, c, -0.85 + i * 0.15, 0.16, 0));
    g.add(b(0.07, 0.03, 0.008, C.white, -0.85 + i * 0.15, 0.24, 0.062));
  }
  for (let i = 0; i < 3; i++) {
    g.add(b(0.34, 0.05, 0.12, i % 2 ? C.sand : C.cream, 0.66, 0.05 + i * 0.055, 0));
  }
  return g;
}

// ---------------------------------------------------------------- 后墙三块
// 标识牌：只有抽象圆形 + 两道横杠。无国徽、无真实机构名、无字。
function emblemBoard(w, h) {
  const g = new THREE.Group();
  g.add(b(w + 0.09, h + 0.09, 0.05, C.blue, 0, 0, 0));                  // 外框
  g.add(b(w, h, 0.05, C.white, 0, 0, 0.028));                           // 面板
  // 内框线（四根细条，仍是"装裱"层次，不是徽标）
  g.add(b(w - 0.09, 0.008, 0.004, C.glass, 0, h / 2 - 0.045, 0.056));
  g.add(b(w - 0.09, 0.008, 0.004, C.glass, 0, -h / 2 + 0.045, 0.056));
  g.add(b(0.008, h - 0.09, 0.004, C.glass, -w / 2 + 0.045, 0, 0.056));
  g.add(b(0.008, h - 0.09, 0.004, C.glass, w / 2 - 0.045, 0, 0.056));
  // 圆：一个直径 0.36 的实心圆 + 一圈 0.008 宽的细环
  const disc = cy(0.18, 0.18, 0.014, C.navy, 0, h * 0.17, 0.062, 26);
  disc.rotation.x = Math.PI / 2;
  g.add(disc);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.232, 0.009, 6, 30), M(C.blue));
  ring.position.set(0, h * 0.17, 0.062);
  g.add(ring);
  // 两道横杠：长短差 0.18，位置对得齐，像"机构名"的位置但不给字
  g.add(b(w * 0.6, 0.06, 0.008, C.ink, 0, -h * 0.09, 0.06));
  g.add(b(w * 0.42, 0.045, 0.008, C.ink, 0, -h * 0.27, 0.06));
  // 面板上的一道斜光
  const sheen = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 1.1), new THREE.MeshBasicMaterial({
    color: C.white, transparent: true, opacity: 0.1, depthWrite: false
  }));
  sheen.position.set(-w * 0.18, 0, 0.058);
  sheen.rotation.z = 0.36;
  g.add(sheen);
  return g;
}

// 调解流程图：四步方块串联 + 箭头 + 三行说明，全是抽象块，一个字都没有
function flowBoard(w, h) {
  const g = new THREE.Group();
  g.add(b(w + 0.09, h + 0.09, 0.05, C.blue, 0, 0, 0));
  g.add(b(w, h, 0.05, C.white, 0, 0, 0.028));
  g.add(b(w * 0.62, 0.075, 0.012, C.ink, 0, h * 0.34, 0.058));          // 标题条
  g.add(b(w * 0.2, 0.022, 0.01, C.blue, 0, h * 0.22, 0.058));           // 副标
  for (let i = 0; i < 4; i++) {
    const x = -0.45 + i * 0.3;
    const sq = b(0.21, 0.21, 0.014, i === 0 ? C.coral : C.blue, x, h * 0.06, 0.058);
    g.add(sq);
    const num = cy(0.055, 0.055, 0.016, C.white, x, h * 0.06, 0.07, 14);
    num.rotation.x = Math.PI / 2;
    g.add(num);
    g.add(b(0.17, 0.02, 0.012, C.ink, x, h * 0.06 - 0.155, 0.058));
    if (i < 3) {
      g.add(b(0.05, 0.024, 0.012, C.ink, x + 0.145, h * 0.06, 0.058));   // 箭头杆
      const tip = b(0.045, 0.045, 0.012, C.ink, x + 0.178, h * 0.06, 0.058);
      tip.rotation.z = Math.PI / 4;
      g.add(tip);
    }
  }
  g.add(b(w * 0.9, 0.016, 0.008, C.glass, 0, -h * 0.06, 0.058));        // 分隔线
  for (let i = 0; i < 3; i++) {                                         // 三行说明，长短递减
    g.add(b(w * (0.72 - i * 0.12), 0.022, 0.01, C.road, -w * 0.04, -h * 0.16 - i * 0.075, 0.058));
    g.add(b(0.05, 0.022, 0.01, C.coral, -w * 0.44, -h * 0.16 - i * 0.075, 0.058));
  }
  return g;
}

// 「和为贵」字幅：书法只给抽象笔痕，不给真字。上下木轴要出边，才像"挂着的卷轴"
function mottoScroll() {
  const g = new THREE.Group();
  for (const sy of [-1, 1]) {
    const rod = cy(0.03, 0.03, 0.9, C.wood, 0, sy * 0.66, 0.04, 10);
    rod.rotation.z = Math.PI / 2;
    g.add(rod);
    g.add(ball(0.045, C.wood, -0.45, sy * 0.66, 0.04, 8));
    g.add(ball(0.045, C.wood, 0.45, sy * 0.66, 0.04, 8));
  }
  g.add(b(0.72, 1.2, 0.02, C.cream, 0, 0, 0.022));                       // 纸面
  g.add(b(0.66, 1.14, 0.012, C.white, 0, 0, 0.034));                     // 内芯
  g.add(b(0.66, 0.008, 0.004, C.sand, 0, 0.5, 0.041));                   // 上装裱线
  g.add(b(0.66, 0.008, 0.004, C.sand, 0, -0.5, 0.041));                  // 下装裱线
  // 三行笔痕：同一组笔画重复三次、各自错一点，远看就是三个字的节奏
  const rows = [0.4, 0.02, -0.36];
  const marks = [
    [-0.08, 0.1, 0.22, 0.032], [0.02, 0.04, 0.18, 0.028], [-0.1, -0.02, 0.26, 0.026],
    [0.07, -0.06, 0.14, 0.03], [-0.02, 0.02, 0.03, 0.14], [0.11, 0.0, 0.028, 0.1],
    [-0.13, -0.1, 0.1, 0.05], [0.06, -0.14, 0.16, 0.024]
  ];
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < marks.length; i++) {
      const mx = (r * 7 + i * 3) % 5;
      const dy = (mx - 2) * 0.008;
      const [dx, yy, w, hh] = marks[i];
      g.add(b(w, hh, 0.006, C.ink, dx + dy * 0.4, rows[r] + yy, 0.044 + (i % 2) * 0.001));
    }
  }
  g.add(b(0.085, 0.085, 0.005, C.coral, 0.2, -0.52, 0.045));             // 朱印
  g.add(b(0.045, 0.045, 0.004, C.cream, 0.2, -0.52, 0.048));
  g.add(b(0.34, 0.006, 0.004, C.glass, -0.04, 0.56, 0.045));             // 纸面一道淡光
  g.add(cy(0.006, 0.006, 0.14, C.road, 0, 0.82, 0.03, 4));               // 挂绳
  g.add(cy(0.014, 0.014, 0.012, C.road, 0, 0.89, 0.03, 6));              // 钉子
  return g;
}

// 挂钟：指针停在 14:00 —— 这场的时间就写在这一只钟上
function wallClock() {
  const g = new THREE.Group();
  const rim = cy(0.26, 0.26, 0.05, C.blue, 0, 0, 0, 24);
  rim.rotation.x = Math.PI / 2;
  g.add(rim);
  const face = cy(0.232, 0.232, 0.02, C.white, 0, 0, 0.03, 24);
  face.rotation.x = Math.PI / 2;
  g.add(face);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.add(b(0.012, i % 3 ? 0.026 : 0.044, 0.008, C.road,
      Math.cos(a) * 0.185, Math.sin(a) * 0.185, 0.043));
  }
  const hourGeo = new THREE.BoxGeometry(0.024, 0.13, 0.006);
  hourGeo.translate(0, 0.05, 0);                                        // 轴心在钟心
  const hour = new THREE.Mesh(hourGeo, M(C.ink));
  hour.position.set(0, 0, 0.046);
  hour.rotation.z = -Math.PI / 3;                                       // 停在 2 点
  g.add(hour);
  const minGeo = new THREE.BoxGeometry(0.016, 0.185, 0.006);
  minGeo.translate(0, 0.085, 0);
  const min = new THREE.Mesh(minGeo, M(C.ink));
  min.position.set(0, 0, 0.049);
  g.add(min);
  g.add(cy(0.016, 0.016, 0.012, C.coral, 0, 0, 0.052, 10));             // 轴心
  return g;
}

// ---------------------------------------------------------------- 门 / 窗
// 通卷宗室的门：虚掩，门缝里透出一条灯 —— 9 秒一次渐变，像有人在里面翻卷宗。
// 门套必须是"三根框围出一个洞"，不能是一块实心板：实心板会把洞和灯一起挡住。
function doorToFileRoom() {
  const g = new THREE.Group();
  g.add(b(0.16, 2.44, 0.18, C.cream, -0.6, 1.22, 0.02));                // 左立框
  g.add(b(0.16, 2.44, 0.18, C.cream, 0.6, 1.22, 0.02));                 // 右立框
  g.add(b(1.36, 0.22, 0.18, C.cream, 0, 2.33, 0.02));                   // 上框
  g.add(b(1.2, 0.06, 0.2, C.sand, 0, 2.455, 0.02));                     // 框顶压条

  // 洞里：暗底 + 藏在暗处的灯 + 地上的一摞卷宗（只在这个洞里露出来）
  g.add(b(1.04, 2.24, 0.02, C.dark, 0, 1.12, -0.055));
  g.add(b(1.04, 0.04, 0.03, C.tile, 0, 0.025, -0.045));
  g.add(b(1.04, 0.16, 0.02, C.tile, 0, 0.14, -0.048));
  for (let i = 0; i < 3; i++) {
    g.add(b(0.48, 0.075, 0.05, i % 2 ? C.road : C.tile, -0.12, 0.075 + i * 0.08, -0.04));
    g.add(b(0.14, 0.024, 0.006, C.coral, -0.16, 0.08 + i * 0.08, -0.012));
  }
  g.add(b(0.3, 0.42, 0.06, C.tile, 0.28, 0.42, -0.038));                 // 靠墙立着的档案盒
  const lampBar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.07, 0.02),
    M(C.cream, { emissive: C.yellow, emissiveIntensity: 1.1 }));
  lampBar.position.set(0, 2.06, -0.03);
  g.add(lampBar);
  A.roomLamp.push({ m: lampBar, base: 1.15 });
  const sliver = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.9, 0.02),
    M(C.cream, { emissive: C.yellow, emissiveIntensity: 1.0 }));
  sliver.position.set(0.48, 1.05, -0.028);
  g.add(sliver);
  A.roomLamp.push({ m: sliver, base: 0.95 });

  // 门扇：挂在左门框上，开 77°（几乎立起来），虚掩着没关严。
  // 注意旋转方向：+Y 旋转会把 +x 甩向 -z，所以这里必须是负角，门才是往屋里开的。
  const leaf = new THREE.Group();
  leaf.position.set(-0.54, 0, 0.115);
  leaf.rotation.y = -1.35;
  leaf.add(b(1.04, 2.2, 0.05, C.wood, 0.52, 1.1, 0));
  leaf.add(b(0.82, 0.74, 0.03, C.sand, 0.52, 1.64, 0.035));              // 上凹板
  leaf.add(b(0.82, 0.52, 0.03, C.sand, 0.52, 0.62, 0.035));              // 下凹板
  leaf.add(b(0.76, 0.68, 0.014, C.wood, 0.52, 1.64, 0.048));
  leaf.add(b(0.76, 0.46, 0.014, C.wood, 0.52, 0.62, 0.048));
  leaf.add(cy(0.035, 0.035, 0.03, C.yellow, 0.92, 1.02, 0.05, 10));      // 锁座
  leaf.add(b(0.03, 0.025, 0.14, C.yellow, 0.92, 1.02, 0.11));            // 把手
  leaf.add(b(0.3, 0.1, 0.012, C.navy, 0.52, 1.9, 0.048));                // 无字门牌
  leaf.add(b(0.22, 0.022, 0.008, C.cream, 0.52, 1.905, 0.056));
  g.add(leaf);

  // 门口地上那摊光：跟着门里的灯一起亮起来
  const spill = flat(1.4, 1.7, C.yellow, 0.35, 0.022, 1.0, 0.1);
  g.add(spill);
  A.spill = spill;
  return g;
}

// 左墙高处的一扇磨砂窗：给隔断上的"窗反光"一个来处，也给房间一点冷
function highWindow() {
  const g = new THREE.Group();
  g.add(b(1.7, 1.06, 0.08, C.cream, 0, 0, 0));                          // 窗套
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.56, 0.9),
    M(C.cream, { emissive: C.white, emissiveIntensity: 0.55 }));
  pane.position.set(0, 0, 0.05);
  g.add(pane);
  for (let i = 0; i < 2; i++) g.add(b(0.035, 0.9, 0.05, C.white, -0.26 + i * 0.52, 0, 0.06));  // 竖梃
  g.add(b(1.56, 0.035, 0.05, C.white, 0, 0.06, 0.06));                  // 横梃
  g.add(b(1.82, 0.05, 0.14, C.white, 0, -0.5, 0.06));                   // 窗台
  g.add(b(1.6, 0.02, 0.1, C.glass, 0, -0.462, 0.06));                   // 台面上的一道冷光
  return g;
}

function acVent() {
  const g = new THREE.Group();
  g.add(b(1.0, 0.32, 0.24, C.white, 0, 0, 0));                          // 机身
  g.add(b(0.92, 0.1, 0.03, C.glass, 0, -0.09, 0.125));                  // 出风口
  for (let i = 0; i < 5; i++) g.add(b(0.8, 0.008, 0.02, C.cream, 0, -0.115 + i * 0.014, 0.14));
  g.add(b(0.9, 0.03, 0.02, C.road, 0, 0.11, 0.125));                    // 上沿压条
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.014, 0.01),
    M(C.mint, { emissive: C.mint, emissiveIntensity: 1.0 }));
  led.position.set(0.4, -0.02, 0.13);
  g.add(led);
  g.add(b(0.06, 0.06, 0.02, C.road, 0.4, 0.04, 0.125));                 // 显示窗
  return g;
}

// ---------------------------------------------------------------- 等候区
function waitingBench(len) {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {                                         // 三条座板
    g.add(b(len, 0.05, 0.13, C.wood, 0, 0.445, -0.16 + i * 0.145));
  }
  g.add(b(len - 0.1, 0.05, 0.42, C.road, 0, 0.4, 0.005));               // 座下横梁
  for (const sx of [-1, 1]) {
    g.add(b(0.07, 0.42, 0.1, C.road, sx * (len / 2 - 0.08), 0.22, 0.16));
    g.add(b(0.07, 0.6, 0.1, C.road, sx * (len / 2 - 0.08), 0.62, -0.2));
    g.add(b(0.09, 0.05, 0.48, C.road, sx * (len / 2 - 0.08), 0.465, 0.0));  // 侧扶手座
    g.add(b(0.06, 0.045, 0.4, C.wood, sx * (len / 2 - 0.08), 0.5, 0.0));    // 木扶手
  }
  for (let i = 0; i < 2; i++) {                                         // 靠背两片
    const slat = b(len, 0.12, 0.05, C.wood, 0, 0.66 + i * 0.17, -0.21 - i * 0.01);
    slat.rotation.x = -0.09;
    g.add(slat);
  }
  g.add(b(len, 0.03, 0.05, C.road, 0, 0.6, -0.19));                     // 靠背下压条
  return g;
}

function teaTable() {
  const g = new THREE.Group();
  g.add(cy(0.34, 0.34, 0.045, C.wood, 0, 0.44, 0, 20));
  g.add(cy(0.345, 0.345, 0.012, C.sand, 0, 0.465, 0, 20));              // 一圈压边
  g.add(cy(0.05, 0.05, 0.4, C.road, 0, 0.22, 0, 8));
  g.add(cy(0.22, 0.24, 0.04, C.road, 0, 0.022, 0, 14));
  const s1 = b(0.3, 0.01, 0.22, C.white, -0.05, 0.475, 0.03);
  s1.rotation.y = 0.2;
  const s2 = b(0.28, 0.008, 0.2, C.cream, 0.05, 0.484, -0.06);
  s2.rotation.y = -0.16;
  g.add(s1, s2);
  g.add(b(0.22, 0.004, 0.01, C.ink, -0.04, 0.482, 0.03));               // 宣传单上的两行
  g.add(b(0.15, 0.004, 0.01, C.road, 0.0, 0.489, 0.08));
  g.add(b(0.18, 0.08, 0.11, C.white, 0.18, 0.5, 0.12));                 // 纸巾盒
  g.add(b(0.06, 0.025, 0.05, C.cream, 0.18, 0.545, 0.12));
  g.add(cy(0.04, 0.03, 0.09, C.white, -0.19, 0.49, -0.12, 12));         // 一只纸杯
  return g;
}

// 报刊架：三本旧杂志斜插在横杆上
function magazineRack() {
  const g = new THREE.Group();
  g.add(b(0.72, 0.05, 0.12, C.wood, 0, -0.16, 0));                      // 底杆
  g.add(b(0.72, 0.05, 0.12, C.wood, 0, 0.2, 0));                        // 顶杆
  for (const sx of [-1, 1]) g.add(b(0.05, 0.44, 0.1, C.wood, sx * 0.32, 0.02, 0));
  const mags = [C.blue, C.cream, C.sand];
  for (let i = 0; i < 3; i++) {
    const m2 = b(0.5, 0.3, 0.02, mags[i], -0.16 + i * 0.17, 0.02 + i * 0.02, 0.07);
    m2.rotation.x = -0.14;
    m2.rotation.y = 0.05 - i * 0.05;
    g.add(m2);
    g.add(b(0.3, 0.03, 0.008, C.road, -0.16 + i * 0.17, 0.12 + i * 0.02, 0.082));
  }
  return g;
}

// ---------------------------------------------------------------- 东北 / 角落
function waterCooler() {
  const g = new THREE.Group();
  g.add(b(0.4, 0.03, 0.4, C.road, 0, 0.015, 0));                        // 底盘
  g.add(b(0.38, 0.86, 0.38, C.white, 0, 0.46, 0));                      // 机身
  g.add(b(0.42, 0.05, 0.42, C.blue, 0, 0.925, 0));                      // 台面
  g.add(b(0.32, 0.22, 0.05, C.glass, 0, 0.82, 0.195));                  // 接水格
  g.add(b(0.28, 0.02, 0.16, C.road, 0, 0.735, 0.17));                   // 接水盘
  for (let i = 0; i < 4; i++) g.add(b(0.24, 0.006, 0.02, C.tile, 0, 0.745, 0.12 + i * 0.03));
  for (const sx of [-1, 1]) {                                           // 两个龙头
    g.add(cy(0.02, 0.02, 0.08, C.blue, sx * 0.075, 0.79, 0.21, 8));
    g.add(b(0.04, 0.02, 0.05, C.dark, sx * 0.075, 0.83, 0.2));
  }
  const bottle = cy(0.165, 0.165, 0.44, C.glass, 0, 1.19, 0, 16);       // 水桶
  g.add(bottle);
  g.add(cy(0.155, 0.155, 0.2, C.blue, 0, 1.07, 0, 16));                 // 半桶水
  g.add(cy(0.17, 0.17, 0.02, C.white, 0, 1.415, 0, 16));                // 桶盖
  // 加热灯（红黄）一明一暗 + 电源灯（薄荷）常亮
  const heat = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.012, 10),
    M(C.yellow, { emissive: C.yellow, emissiveIntensity: 1.0 }));
  heat.rotation.x = Math.PI / 2;
  heat.position.set(0.12, 0.9, 0.2);
  g.add(heat);
  A.heat = heat;
  const power = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.012, 10),
    M(C.mint, { emissive: C.mint, emissiveIntensity: 1.0 }));
  power.rotation.x = Math.PI / 2;
  power.position.set(-0.12, 0.9, 0.2);
  g.add(power);
  g.add(b(0.3, 0.08, 0.01, C.cream, 0, 0.62, 0.196));                   // 一块无字铭牌
  g.add(b(0.2, 0.02, 0.006, C.road, 0, 0.63, 0.202));
  for (let i = 0; i < 3; i++) {                                         // 桶里的小气泡
    const bub = ball(0.012, C.white, 0.04 - i * 0.03, 1.08 + i * 0.06, 0.03, 6);
    bub.material.transparent = true;
    bub.material.opacity = 0.7;
    g.add(bub);
    A.bubbles.push({ o: bub, x: 0.04 - i * 0.03, z: 0.03, ph: i * 0.33 });
  }
  return g;
}

// 茶水台：电水壶 + 暖瓶 + 一托盘纸杯 + 茶叶罐
function teaStation() {
  const g = new THREE.Group();
  g.add(b(0.5, 0.72, 1.2, C.wood, 0, 0.38, 0));                         // 柜体
  g.add(b(0.56, 0.05, 1.26, C.wood, 0, 0.765, 0));                      // 台面
  for (const sz of [-1, 1]) {
    g.add(b(0.02, 0.52, 0.52, C.sand, 0.26, 0.38, sz * 0.3));           // 柜门
    g.add(b(0.025, 0.09, 0.025, C.road, 0.272, 0.5, sz * 0.09));        // 拉手
    g.add(b(0.44, 0.05, 0.04, C.road, 0, 0.03, sz * 0.52));             // 柜脚
  }
  const tray = new THREE.Group();                                       // 托盘 + 四只纸杯
  tray.position.set(0.0, 0.79, 0.3);
  tray.add(b(0.34, 0.02, 0.46, C.blue, 0, 0.01, 0));
  for (let i = 0; i < 4; i++) {
    tray.add(cy(0.042, 0.032, 0.09, C.white, -0.09 + (i % 2) * 0.16, 0.06, -0.11 + Math.floor(i / 2) * 0.22, 12));
  }
  g.add(tray);
  g.add(cy(0.1, 0.09, 0.24, C.white, 0.0, 0.925, -0.3, 16));            // 电水壶
  g.add(cy(0.1, 0.1, 0.03, C.road, 0.0, 1.05, -0.3, 16));
  const spout = cy(0.02, 0.014, 0.2, C.white, -0.12, 0.97, -0.3, 6);
  spout.rotation.z = 0.7;
  g.add(spout);
  g.add(b(0.04, 0.1, 0.03, C.road, 0.05, 0.9, -0.42));                  // 壶把
  g.add(cy(0.08, 0.08, 0.36, C.peach, 0.06, 0.99, -0.06, 14));          // 暖瓶
  g.add(cy(0.065, 0.045, 0.06, C.dark, 0.06, 1.2, -0.06, 12));
  g.add(cy(0.05, 0.05, 0.14, C.mint, 0.16, 0.86, 0.56, 12));            // 茶叶罐
  g.add(cy(0.052, 0.052, 0.02, C.wood, 0.16, 0.94, 0.56, 12));
  return g;
}

function copier() {
  const g = new THREE.Group();
  g.add(b(0.66, 0.5, 0.58, C.white, 0, 0.28, 0));                       // 下半身
  g.add(b(0.62, 0.3, 0.54, C.white, 0, 0.68, 0));                       // 上半身
  g.add(b(0.56, 0.03, 0.48, C.glass, 0, 0.845, -0.02));                 // 稿台玻璃
  g.add(b(0.6, 0.03, 0.5, C.road, 0, 0.87, -0.02));                     // 盖子
  g.add(b(0.42, 0.02, 0.3, C.road, 0, 0.62, 0.26));                     // 出纸托盘
  g.add(b(0.38, 0.008, 0.24, C.white, 0.02, 0.635, 0.25));              // 出来的一张
  g.add(b(0.2, 0.12, 0.02, C.dark, -0.16, 0.76, 0.272));                // 操作面板
  g.add(b(0.15, 0.05, 0.006, C.glass, -0.16, 0.78, 0.284));
  const cled = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, 0.008),
    M(C.mint, { emissive: C.mint, emissiveIntensity: 1.0 }));
  cled.position.set(-0.05, 0.735, 0.284);
  g.add(cled);
  A.led.push({ m: cled, base: 1.0, ph: 2.1 });
  g.add(b(0.014, 0.012, 0.008, C.coral, -0.02, 0.735, 0.284));
  g.add(b(0.2, 0.32, 0.4, C.road, 0.42, 0.26, 0));                      // 侧托盘
  for (let i = 0; i < 4; i++) g.add(b(0.28, 0.03, 0.3, i % 2 ? C.white : C.cream, 0.42, 0.44 + i * 0.03, 0));
  g.add(b(0.5, 0.14, 0.4, C.sand, 0, 0.09, 0.26));                      // 纸盒
  return g;
}

// 取号机：办事的人先按一下这里
function ticketMachine() {
  const g = new THREE.Group();
  g.add(b(0.46, 0.05, 0.36, C.road, 0, 0.025, 0));                      // 底座
  g.add(b(0.42, 0.92, 0.3, C.cream, 0, 0.52, 0));                       // 机身
  g.add(b(0.44, 0.05, 0.34, C.blue, 0, 1.0, 0));                        // 顶盖
  g.add(b(0.3, 0.22, 0.03, C.dark, 0, 1.15, 0.145));                    // 屏框
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.15),
    M(C.dark, { emissive: C.blue, emissiveIntensity: 1.1 }));
  scr.position.set(0, 1.15, 0.163);
  g.add(scr);
  for (let i = 0; i < 3; i++) g.add(b(0.14 - i * 0.03, 0.012, 0.004, C.white, -0.03, 1.19 - i * 0.035, 0.166));
  g.add(b(0.2, 0.022, 0.02, C.dark, 0, 1.03, 0.152));                   // 出票口
  const tk = b(0.07, 0.1, 0.004, C.white, 0.02, 1.075, 0.155);
  tk.rotation.x = -0.2;
  g.add(tk);
  const btn = cy(0.036, 0.036, 0.02, C.coral, 0, 0.94, 0.152, 14);
  btn.rotation.x = Math.PI / 2;
  g.add(btn);
  for (let i = 0; i < 3; i++) g.add(cy(0.008, 0.008, 0.008, C.mint, -0.09 + i * 0.05, 0.86, 0.152, 6));
  g.add(b(0.3, 0.12, 0.01, C.blue, 0, 0.72, 0.152));                    // 流程小贴纸
  for (let i = 0; i < 3; i++) g.add(b(0.2 - i * 0.04, 0.01, 0.004, C.white, -0.03, 0.75 - i * 0.03, 0.158));
  return g;
}

function posterStand() {
  const g = new THREE.Group();
  g.add(b(0.46, 0.05, 0.32, C.dark, 0, 0.028, 0));
  g.add(b(0.4, 0.04, 0.26, C.road, 0, 0.06, 0));
  g.add(cy(0.024, 0.024, 1.0, C.road, 0, 0.56, 0, 8));
  g.add(b(0.54, 0.78, 0.045, C.navy, 0, 1.36, 0));                      // 牌框
  for (const sz of [-1, 1]) {                                           // 正反两面都是白面
    g.add(b(0.46, 0.7, 0.02, C.white, 0, 1.36, sz * 0.028));
  }
  g.add(b(0.3, 0.045, 0.012, C.coral, -0.03, 1.62, 0.05));              // 标题条
  for (let i = 0; i < 4; i++) {
    g.add(b(0.36 - (i % 2) * 0.08, 0.022, 0.012, C.ink, -0.01, 1.5 - i * 0.085, 0.05));
  }
  g.add(b(0.17, 0.09, 0.012, C.glass, 0.08, 1.11, 0.05));               // 一张小图
  g.add(b(0.2, 0.02, 0.012, C.road, -0.1, 1.11, 0.05));
  const tip = b(0.44, 0.03, 0.05, C.road, 0, 0.97, 0);                  // 下横撑
  g.add(tip);
  return g;
}

function wasteBin() {
  const g = new THREE.Group();
  g.add(cy(0.17, 0.14, 0.42, C.road, 0, 0.21, 0, 14));
  g.add(cy(0.18, 0.18, 0.035, C.dark, 0, 0.435, 0, 14));
  g.add(cy(0.155, 0.155, 0.02, C.dark, 0, 0.44, 0, 14));
  g.add(b(0.14, 0.06, 0.02, C.white, 0.02, 0.4, 0.155));                // 露出来的垃圾袋
  g.add(b(0.09, 0.03, 0.012, C.ink, 0.03, 0.34, 0.15));
  return g;
}

function extinguisher() {
  const g = new THREE.Group();
  g.add(cy(0.11, 0.11, 0.42, C.coral, 0, 0.33, 0, 14));
  g.add(cy(0.095, 0.095, 0.03, C.coral, 0, 0.55, 0, 14));
  g.add(cy(0.032, 0.032, 0.1, C.dark, 0, 0.61, 0, 8));
  g.add(b(0.13, 0.032, 0.05, C.dark, 0, 0.665, 0));
  g.add(cy(0.018, 0.018, 0.05, C.ink, 0.085, 0.6, 0, 6));               // 压力表
  const hose = cy(0.013, 0.013, 0.32, C.ink, 0.1, 0.48, 0.02, 6);
  hose.rotation.z = 0.55;
  g.add(hose);
  g.add(b(0.24, 0.03, 0.24, C.road, 0, 0.015, 0));
  g.add(b(0.15, 0.1, 0.008, C.white, 0, 0.35, 0.112));
  g.add(b(0.1, 0.02, 0.004, C.coral, 0, 0.37, 0.118));
  return g;
}

// 落地绿植：盆 + 七根枝 + 每枝三片压扁的叶（叶要小、要深，才能压住画面）
function floorPlant() {
  const g = new THREE.Group();
  g.add(cy(0.25, 0.19, 0.42, C.wood, 0, 0.21, 0, 16));
  g.add(cy(0.265, 0.265, 0.05, C.sand, 0, 0.435, 0, 16));
  g.add(cy(0.215, 0.215, 0.02, C.soil, 0, 0.432, 0, 16));
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9;
    const h = 0.52 + (i % 4) * 0.12;
    const rad = 0.055 + (i % 3) * 0.025;
    const stem = cy(0.011, 0.008, h, C.sea, Math.cos(a) * rad, 0.43 + h / 2, Math.sin(a) * rad, 5);
    stem.rotation.z = Math.cos(a) * 0.12;
    stem.rotation.x = -Math.sin(a) * 0.12;
    g.add(stem);
    A.vines.push({ m: stem, base: Math.cos(a) * 0.12, ph: i * 0.9 });
    for (let k = 0; k < 3; k++) {
      const y = 0.43 + h * (0.44 + k * 0.24);
      const rr = rad + 0.1 + k * 0.05;
      const leaf = ball(0.105, [C.sea, C.grass, C.mint][(i + k) % 3],
        Math.cos(a) * rr, y, Math.sin(a) * rr, 8);
      leaf.scale.set(1.5, 0.3, 0.95);
      leaf.rotation.y = -a;
      g.add(leaf);
    }
  }
  const top = ball(0.1, C.sea, 0, 0.43 + 0.95, 0, 8);                    // 顶上一片
  top.scale.set(1.2, 0.4, 1.2);
  g.add(top);
  return g;
}

// 文件推车：两层 + 四轮 + 一摞待归档
function fileCart() {
  const g = new THREE.Group();
  for (const sy of [0.16, 0.52]) {
    g.add(b(0.6, 0.03, 0.46, C.road, 0, sy, 0));
    g.add(b(0.58, 0.06, 0.44, C.sand, 0, sy + 0.05, 0));
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const post = cy(0.017, 0.017, 0.6, C.road, sx * 0.27, 0.3, sz * 0.2, 6);
    g.add(post);
    g.add(cy(0.03, 0.03, 0.03, C.dark, sx * 0.27, 0.03, sz * 0.2, 8));
  }
  const bar = cy(0.017, 0.017, 0.6, C.road, 0, 0.68, 0.22, 6);
  bar.rotation.z = Math.PI / 2;
  g.add(bar);
  for (let i = 0; i < 3; i++) {
    g.add(b(0.5, 0.08, 0.36, i % 2 ? C.cream : C.sand, 0, 0.24 + i * 0.085, 0));
    g.add(b(0.16, 0.03, 0.008, C.coral, -0.12, 0.25 + i * 0.085, 0.185));
  }
  g.add(b(0.46, 0.14, 0.34, C.blue, 0, 0.62, 0));
  g.add(b(0.3, 0.03, 0.008, C.white, 0, 0.67, 0.175));
  return g;
}

// 保险柜：印章与在办卷宗都锁在这里
function safeBox() {
  const g = new THREE.Group();
  g.add(b(0.62, 0.6, 0.52, C.road, 0, 0.31, 0));
  g.add(b(0.58, 0.52, 0.02, C.blue, 0, 0.32, 0.265));                   // 门板
  g.add(b(0.54, 0.46, 0.012, C.road, 0, 0.32, 0.276));                  // 门内凹
  const dial = cy(0.07, 0.07, 0.03, C.dark, -0.12, 0.36, 0.285, 16);    // 密码盘
  dial.rotation.x = Math.PI / 2;
  g.add(dial);
  g.add(cy(0.055, 0.055, 0.01, C.sand, -0.12, 0.36, 0.3, 16));
  const handle = b(0.03, 0.03, 0.12, C.dark, 0.14, 0.36, 0.32);         // 把手
  g.add(handle);
  g.add(b(0.06, 0.2, 0.04, C.dark, 0.14, 0.3, 0.3));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(b(0.07, 0.05, 0.07, C.dark, sx * 0.26, 0.025, sz * 0.21));
  }
  return g;
}

function mailbox() {
  const g = new THREE.Group();
  g.add(b(0.4, 0.46, 0.14, C.cream, 0, 0, 0.07));                       // 箱体
  g.add(b(0.44, 0.04, 0.16, C.road, 0, 0.25, 0.07));                    // 顶盖
  g.add(b(0.26, 0.04, 0.02, C.ink, 0, 0.1, 0.155));                     // 投递口
  g.add(b(0.3, 0.12, 0.015, C.navy, 0, -0.08, 0.155));                  // 标签
  g.add(b(0.22, 0.026, 0.012, C.cream, 0, -0.07, 0.165));
  g.add(b(0.06, 0.05, 0.03, C.yellow, 0.14, -0.19, 0.15));              // 锁扣
  return g;
}

function doorMat() {
  const g = new THREE.Group();
  g.add(b(1.5, 0.022, 0.9, C.dark, 0, 0.011, 0));
  g.add(b(1.4, 0.008, 0.8, C.road, 0, 0.024, 0));
  g.add(b(0.72, 0.005, 0.06, C.cream, 0, 0.029, 0.04));
  g.add(b(0.72, 0.005, 0.06, C.cream, 0, 0.029, -0.04));
  return g;
}

// 填单台：站着写材料的台子，台面 1.02，配一摞空白表格和一支带链的笔
function formTable() {
  const g = new THREE.Group();
  g.add(b(1.24, 0.05, 0.56, C.wood, 0, 1.0, 0));                        // 台面
  g.add(b(1.28, 0.03, 0.6, C.sand, 0, 0.972, 0));                       // 台沿
  for (const sx of [-1, 1]) {                                           // 两侧板
    g.add(b(0.05, 0.96, 0.5, C.wood, sx * 0.58, 0.49, 0));
    g.add(b(0.07, 0.04, 0.54, C.dark, sx * 0.58, 0.02, 0));
  }
  g.add(b(1.06, 0.5, 0.04, C.tile, 0, 0.62, 0));                        // 中间挡板
  g.add(b(0.9, 0.06, 0.5, C.road, 0, 0.3, 0));                          // 下层隔板
  for (let i = 0; i < 3; i++) {                                         // 隔板上的空白表格
    g.add(b(0.4, 0.02, 0.28, C.white, -0.2, 0.34 + i * 0.022, 0));
  }
  // 台面：一摞表格 + 亚克力提示牌 + 带链的笔
  g.add(b(0.4, 0.035, 0.28, C.white, -0.3, 1.04, 0));
  g.add(b(0.36, 0.006, 0.24, C.cream, -0.3, 1.06, 0));
  for (let i = 0; i < 3; i++) g.add(b(0.26, 0.002, 0.008, C.road, -0.3, 1.064, -0.06 + i * 0.05));
  const holder = b(0.2, 0.26, 0.02, C.blue, 0.34, 1.15, -0.12);         // 立牌
  holder.rotation.x = -0.18;
  g.add(holder);
  g.add(b(0.16, 0.2, 0.006, C.white, 0.34, 1.15, -0.105));
  g.add(b(0.1, 0.02, 0.004, C.coral, 0.34, 1.21, -0.1));
  for (let i = 0; i < 2; i++) g.add(b(0.1, 0.008, 0.004, C.road, 0.34, 1.16 - i * 0.03, -0.1));
  const pen = cy(0.009, 0.009, 0.16, C.ink, 0.16, 1.03, 0.12, 6);       // 笔
  pen.rotation.z = Math.PI / 2; pen.rotation.y = 0.4;
  g.add(pen);
  const chain = cy(0.004, 0.004, 0.14, C.road, 0.24, 1.03, 0.14, 4);    // 笔链
  chain.rotation.z = Math.PI / 2;
  g.add(chain);
  return g;
}

// ---------------------------------------------------------------- 场景装配
const room = { x0: -6.1, x1: 6.1, z0: -4.4, z1: 4.4, h: 3.0 };

const props = [
  // ---- 吊顶带：三面一圈，筒灯全亮（正式场所的光是稳的，不闪）
  { id: "s_soffitB", x: 0, z: -4.06, w: 11.9, d: 0.78, passable: true,
    build: () => b(11.9, 0.12, 0.78, C.cream, 0, 2.94, 0) },
  { id: "s_soffitL", x: -5.71, z: 0, w: 0.78, d: 8.7, passable: true,
    build: () => b(0.78, 0.12, 8.7, C.cream, 0, 2.94, 0) },
  { id: "s_soffitR", x: 5.71, z: 0, w: 0.78, d: 8.7, passable: true,
    build: () => b(0.78, 0.12, 8.7, C.cream, 0, 2.94, 0) },
  { id: "s_dlB1", x: -2.9, z: -4.06, w: 1.9, d: 0.32, passable: true,
    build: () => downlightRow(2, 1.5) },
  { id: "s_dlB2", x: 2.9, z: -4.06, w: 1.9, d: 0.32, passable: true,
    build: () => downlightRow(2, 1.5) },
  { id: "s_dlL1", x: -5.71, z: -1.75, w: 0.32, d: 1.9, passable: true,
    build: () => { const g = downlightRow(2, 1.5); g.rotation.y = Math.PI / 2; return g; } },
  { id: "s_dlL2", x: -5.71, z: 1.75, w: 0.32, d: 1.9, passable: true,
    build: () => { const g = downlightRow(2, 1.5); g.rotation.y = Math.PI / 2; return g; } },
  { id: "s_dlR1", x: 5.71, z: -1.75, w: 0.32, d: 1.9, passable: true,
    build: () => { const g = downlightRow(2, 1.5); g.rotation.y = Math.PI / 2; return g; } },
  { id: "s_dlR2", x: 5.71, z: 1.75, w: 0.32, d: 1.9, passable: true,
    build: () => { const g = downlightRow(2, 1.5); g.rotation.y = Math.PI / 2; return g; } },

  // ---- 地面：一层很淡的冷调罩面（浅灰地砖）+ 门口到柜台的一段磨痕
  { id: "s_floorTone", x: 0, z: 0, w: 0.1, d: 0.1, passable: true,
    build: () => {
      const g = new THREE.Group();
      g.add(flat(11.9, 8.7, C.glass, 0, 0.016, 0, 0.22));
      g.add(flat(11.9, 8.7, C.road, 0, 0.019, 0, 0.075));
      return g;
    } },
  // 靠墙一圈稍稍深一点的砖带：地面因此有"边"，墙根也不会浮在浅色里
  { id: "s_floorEdge", x: 0, z: 0, w: 0.1, d: 0.1, passable: true,
    build: () => {
      const g = new THREE.Group();
      g.add(flat(11.6, 0.42, C.road, 0, 0.022, -4.12, 0.13));
      g.add(flat(0.42, 8.4, C.road, -5.82, 0.022, 0, 0.13));
      g.add(flat(0.42, 8.4, C.road, 5.82, 0.022, 0, 0.13));
      return g;
    } },
  { id: "s_wear", x: 0, z: 2.5, w: 0.1, d: 0.1, passable: true,
    build: () => flat(1.7, 2.4, C.road, 0, 0.021, 0, 0.07) },

  // ---- 西北：卷宗柜 ×2 + 柜顶年份卷宗 + 墙上隔板 + 后门
  { id: "s_cab1", x: -5.35, z: -4.06, w: 1.04, d: 0.54, build: fileCabinet,
    interact: { x: -3.4, z: 1.3 } },
  { id: "s_cab2", x: -4.15, z: -4.06, w: 1.04, d: 0.54, build: fileCabinet },
  { id: "s_cabTop1", x: -5.35, z: -4.06, w: 0.9, d: 0.4, passable: true,
    build: () => cabinetTop(0) },
  { id: "s_cabTop2", x: -4.15, z: -4.06, w: 0.9, d: 0.4, passable: true,
    build: () => cabinetTop(1) },
  { id: "s_shelf", x: -4.75, z: -4.33, w: 2.24, d: 0.18, passable: true,
    build: () => { const g = wallShelf(); g.position.set(0, 2.3, 0); return g; } },
  { id: "s_door", x: -5.96, z: -3.2, w: 0.14, d: 1.36, rot: Math.PI / 2,
    build: doorToFileRoom, interact: { x: -4.2, z: -2.4 } },
  { id: "s_mailbox", x: -5.92, z: -1.75, w: 0.16, d: 0.46, rot: Math.PI / 2,
    build: () => { const g = mailbox(); g.position.set(0, 1.45, 0); return g; } },
  { id: "s_plant1", x: -5.5, z: -0.55, w: 0.56, d: 0.56, build: floorPlant },
  { id: "s_cart", x: -3.55, z: -2.3, w: 0.62, d: 0.5, build: fileCart },
  { id: "s_safe", x: -2.2, z: -3.82, w: 0.64, d: 0.56, build: safeBox },

  // ---- 后墙：抽象标识牌 + 调解流程图 + 「和为贵」字幅 + 挂钟（都挂正对相机的那个面）
  { id: "s_emblem", x: -2.7, z: -4.36, w: 1.5, d: 0.06,
    build: () => { const g = emblemBoard(1.5, 0.9); g.position.set(0, 2.04, 0); return g; },
    interact: { x: -2.4, z: 1.25 } },
  { id: "s_flow", x: 0.3, z: -4.36, w: 1.56, d: 0.06,
    build: () => { const g = flowBoard(1.56, 1.06); g.position.set(0, 2.04, 0); return g; },
    interact: { x: 0.3, z: 1.25 } },
  { id: "s_motto", x: 3.0, z: -4.37, w: 0.72, d: 0.05,
    build: () => { const g = mottoScroll(); g.position.set(0, 1.95, 0); return g; } },
  { id: "s_clock", x: 4.85, z: -4.36, w: 0.52, d: 0.1,
    build: () => { const g = wallClock(); g.position.set(0, 2.5, 0.03); return g; } },
  { id: "s_ext", x: 5.7, z: -3.95, w: 0.26, d: 0.26, build: extinguisher },

  // ---- 左墙：高处磨砂窗 + 等候长椅 ×2 + 茶几 + 报刊架 + 垃圾桶
  { id: "s_window", x: -5.95, z: 0.55, w: 0.12, d: 1.82, rot: Math.PI / 2,
    build: () => { const g = highWindow(); g.position.set(0, 2.35, 0); return g; } },
  { id: "s_bench1", x: -5.35, z: 1.1, w: 0.5, d: 2.0, rot: Math.PI / 2, seat: true, facing: Math.PI / 2,
    build: () => waitingBench(2.0), interact: { x: -4.1, z: 1.1 } },
  { id: "s_bench2", x: -5.35, z: 3.3, w: 0.5, d: 2.0, rot: Math.PI / 2, seat: true, facing: Math.PI / 2,
    build: () => waitingBench(2.0), interact: { x: -4.1, z: 3.3 } },
  { id: "s_teaTable", x: -4.55, z: 2.25, w: 0.7, d: 0.7, build: teaTable,
    interact: { x: -4.55, z: 1.35 } },
  { id: "s_rack", x: -5.86, z: 2.2, w: 0.14, d: 0.8, rot: Math.PI / 2,
    build: () => { const g = magazineRack(); g.position.set(0, 1.2, 0); return g; } },
  { id: "s_bin", x: -5.6, z: 4.05, w: 0.38, d: 0.38, build: wasteBin },

  // ---- 右墙：空调风口 + 复印机 + 饮水机 + 茶水台 + 落地绿植
  { id: "s_ac", x: 5.9, z: -3.4, w: 0.26, d: 1.04, rot: -Math.PI / 2,
    build: () => { const g = acVent(); g.position.set(0, 2.5, 0); return g; } },
  { id: "s_copier", x: 5.4, z: -1.5, w: 0.66, d: 0.6, build: copier },
  { id: "s_water", x: 5.48, z: 0.55, w: 0.44, d: 0.44, rot: -Math.PI / 2, build: waterCooler,
    interact: { x: 4.7, z: 0.55 } },
  { id: "s_tea2", x: 5.45, z: 2.05, w: 0.56, d: 1.26, rot: -Math.PI / 2, build: teaStation },
  { id: "s_plant2", x: 5.32, z: 3.75, w: 0.58, d: 0.58, build: floorPlant },

  // ---- 东南：取号机 + 立式宣传架 + 门口地垫
  { id: "s_ticket", x: 3.3, z: 2.4, w: 0.48, d: 0.4, build: ticketMachine,
    interact: { x: 3.3, z: 3.15 } },
  { id: "s_form", x: -1.7, z: 2.6, w: 1.28, d: 0.6, rot: 0.06, build: formTable,
    interact: { x: -1.7, z: 3.5 } },
  { id: "s_stand", x: 2.55, z: 3.55, w: 0.66, d: 0.46, rot: 0.16, build: posterStand,
    interact: { x: 2.55, z: 2.8 } },
  { id: "s_mat", x: 0.2, z: 3.95, w: 1.5, d: 0.9, passable: true, build: doorMat },

  // ---- 柜台（视觉中心）
  { id: "s_counter", x: 0, z: 0.15, w: 5.7, d: 0.8, build: counterDesk,
    interact: { x: 0, z: 1.35 } },

  // ---- 柜台后：两张办公桌 + 两把转椅
  { id: "s_desk1", x: 1.1, z: -2.65, w: 1.9, d: 1.0, build: () => officeDesk(true),
    interact: { x: 1.1, z: 1.35 } },
  { id: "s_desk2", x: 3.55, z: -2.65, w: 1.9, d: 1.0, build: () => officeDesk(false) },
  { id: "s_chairA", x: 1.1, z: -1.78, w: 0.56, d: 0.56, rot: Math.PI, seat: true, facing: Math.PI,
    build: swivelChair },
  { id: "s_chairB", x: 3.55, z: -1.78, w: 0.56, d: 0.56, rot: Math.PI, seat: true, facing: Math.PI,
    build: swivelChair },
];

// 碰撞：家具进网格，人物半径 0.34 由运行时膨胀
const obstacles = props.filter((p) => !p.passable).map((p) => ({ x: p.x, z: p.z, w: p.w, d: p.d }));
obstacles.push({ x: 0, z: room.z0, w: 12.2, d: 0.4 });
obstacles.push({ x: room.x0, z: 0, w: 0.4, d: 8.9 });
obstacles.push({ x: room.x1, z: 0, w: 0.4, d: 8.9 });

// 司法所干事（女 30，制服马甲无字）：站在传话口后面整理卷宗
const characters = [
  { id: "staff", label: "司法所干事", name: "司法所干事", role: "司法所工作人员",
    x: -0.55, z: -1.2, facing: 0.09, pose: "stand",
    color: C.navy, pants: C.dark, hair: "#3a2c22" }
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
    // 底座与房间：奶油白墙、沙色地台、深蓝台身；地面是一层很淡的冷调（浅灰地砖）
    baseColor: C.cream, baseSideColor: C.navy, siteColor: C.sand,
    terrainSideColor: C.road,
    wallColor: C.cream, wallOutColor: C.sand, wallCapColor: C.road, skirtColor: C.glass,
    floorColor: C.white,
    skyTop: C.glass, skyMid: C.white, skyBottom: C.cream,
    fogDensity: 0.0045,
    // 下午两点：室内筒灯全亮、光比很平（正式场所不玩光影）
    light: { sun: C.cream, sunI: 2.05, fill: C.blue, fillI: 0.92, hemi: 0.95,
             hemiSky: C.white, hemiGround: C.sand, exposure: 0.94 },
    actor: { x: 0.5, z: 3.2 },
    camYaw: 0.35, camPitch: 0.58, camDist: 14.5, camFocus: [0, 1.0, 0.2],
    walk: { x0: -5.6, x1: 5.6, z0: -3.9, z1: 4.1 },
    onSpot: (p) => { (window.__events = window.__events || []).push(["spot", p.id]); },
    onPerson: (p) => { (window.__events = window.__events || []).push(["person", p.id]); },
    onArrived: (p) => { (window.__events = window.__events || []).push(["arrived", +p.x.toFixed(2), +p.z.toFixed(2)]); },
    onSeat: (p) => { (window.__events = window.__events || []).push(["seat", p.id]); },
    // ---- 基础动效：10 条，幅度全部 2% 量级
    onFrame: (t) => {
      // ① 小风扇：4 秒一圈（转速 = 2π/4），慢到能看见每一片叶子
      if (A.fan) { A.fan.rotation.z = -t * (Math.PI * 2 / 4); }
      // ② 玻璃隔断上的两处反光随日照极缓移动（±0.05 单位，透明度 ±12%）
      for (const r of A.refl) {
        r.m.position.x = r.x0 + Math.sin(t * 0.23 + r.ph) * 0.05;
        r.m.material.opacity = r.op * (1 + Math.sin(t * 0.31 + r.ph) * 0.12);
      }
      // ③ 饮水机的加热灯一明一暗（烧水的节奏）
      if (A.heat) {
        A.heat.material.emissiveIntensity = 1.0 + Math.sin(t * 0.9) * 0.45;
      }
      // ④ 卷宗室的灯：9 秒一次，亮—停—灭，全是渐变（有人在里面翻卷宗）
      const q = (t % 9) / 9;
      const k = q < 0.18 ? q / 0.18 : (q < 0.62 ? 1 : Math.max(0, 1 - (q - 0.62) / 0.38));
      for (const l of A.roomLamp) { l.m.material.emissiveIntensity = 0.32 + l.base * k; }
      if (A.spill) { A.spill.material.opacity = 0.03 + 0.17 * k; }
      // ⑤ 台面上那张纸被风扇掀角：只掀 0.02 弧度，边掀边落
      if (A.paper) {
        A.paper.rotation.z = 0.01 + Math.sin(t * 2.4) * 0.02;
        A.paper.rotation.x = Math.sin(t * 1.7 + 0.8) * 0.008;
      }
      // ⑥ 筒灯：稳定不闪。只给 0.6% 的呼吸，肉眼看是"一直亮着"
      for (let i = 0; i < A.lamp.length; i++) {
        A.lamp[i].m.material.emissiveIntensity = A.lamp[i].base * (1 + Math.sin(t * 0.8 + i * 1.7) * 0.006);
      }
      // ⑦ 电脑屏的亮度呼吸 1.5%
      if (A.screen) { A.screen.material.emissiveIntensity = 0.85 * (1 + Math.sin(t * 1.1) * 0.015); }
      // ⑧ 绿植的枝被空调风吹得晃 0.02 弧度
      for (let i = 0; i < A.vines.length; i++) {
        A.vines[i].m.rotation.z = A.vines[i].base + Math.sin(t * 0.75 + A.vines[i].ph) * 0.02;
      }
      // ⑨ 电话与复印机的指示灯：呼吸 3%（不是闪，是"在待机"）
      for (const l of A.led) {
        l.m.material.emissiveIntensity = l.base * (1 + Math.sin(t * 1.35 + l.ph) * 0.03);
      }
      // ⑩ 饮水机桶里偶尔冒起一串小气泡（烧水的咕嘟声，只有这一处是"活"的）
      for (const bp of A.bubbles) {
        const qq = (t * 0.16 + bp.ph) % 1;
        bp.o.position.y = 1.0 + qq * 0.3;
        bp.o.position.x = bp.x + Math.sin(qq * 6) * 0.012;
        bp.o.material.opacity = 0.7 * Math.sin(qq * Math.PI);
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
