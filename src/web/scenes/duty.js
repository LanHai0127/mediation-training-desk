// S0 · 派出所值班室（上午 09:10）
// -----------------------------------------------------------------------------
// 按 docs/场景与人物建模提示词.md v5 §3 S0 重做（2026-11-04，质量第一）。
// 七个段落一一对应：画面风格 / 底座与构图 / 时间与氛围 / 外观 / 陈设 / 基础动效 / 避免。
//   ① 只用 PAL 那 15 个颜色；
//   ② 大件自动描边（kit.b 里已经做了）；
//   ③ 没有一张噪点贴图，全部纯色 + 几何分格；
//   ④ 四格分区：西北文件柜+白板 / 东北门+消防柜 / 西南等候区 / 东南 L 形值班台；
//   ⑤ onFrame 里挂 8 条 2% 量级的循环动效。
// -----------------------------------------------------------------------------
import * as THREE from "./vendor/three.module.min.js";
import { PAL as C, M, b, cy, ball, decal } from "./kit.js";
import { createScene } from "./scene3d.js";

window.__err = "";
window.addEventListener("error", (e) => {
  window.__err = (e.message || "error") + " @ " + (e.filename || "") + ":" + (e.lineno || 0);
});

// ---------------------------------------------------------------- 动画句柄
// 每个 build 里把要动的部件挂到这里，onFrame 统一驱动（幅度全部 2% 量级）
const A = {
  clockHand: null, screenDot: null, radioLED: null,
  matCorner: null, lampGlow: [], bubbles: [], magazine: null, windowLight: null
};

// ---------------------------------------------------------------- 零件工厂
// 圆管折线（电话线、晾衣绳、电线）：比一节一节的圆柱自然
function tube(pts, r, color) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, r, 5, false), M(color));
  m.castShadow = true;
  return m;
}
// 贴墙薄板（白板、公示栏、流程牌）：板 + 边框 + 一层很淡的投影
function panel(w, h, color, x, y, z, ry = 0, frame = C.blue) {
  const g = new THREE.Group();
  g.add(b(w + 0.06, h + 0.06, 0.03, frame, 0, 0, -0.01));
  g.add(b(w, h, 0.04, color, 0, 0, 0.02));
  g.rotation.y = ry;
  g.position.set(x, y, z);
  return g;
}
// 纸：极薄的一片，微微翘边
function paper(w, d, color, x, y, z, ry = 0) {
  const m = b(w, 0.004, d, color, x, y, z);
  m.rotation.y = ry;
  return m;
}

// ---------------------------------------------------------------- 值班台
// L 形：主台沿 x 轴，回台在左端向 +z 伸出去——人在 L 的凹口里办公，
// 办事的人站在回台前面，正好隔着桌角说话。
function dutyDesk() {
  const g = new THREE.Group();

  // ---- 台体
  g.add(b(4.4, 0.1, 1.5, C.wood, 0, 0.78, 0));                 // 主台面
  g.add(b(4.46, 0.06, 1.44, C.navy, 0, 0.745, 0));             // 台沿（警蓝）
  g.add(b(4.24, 0.68, 1.36, "#6b6357", 0, 0.4, 0));            // 柜体
  for (let i = 0; i < 4; i++) {                                 // 台下四格抽屉
    g.add(b(0.94, 0.28, 0.04, "#dcd6c6", -1.5 + i * 1.0, 0.5, 0.69));
    g.add(b(0.26, 0.028, 0.02, "#6b6357", -1.5 + i * 1.0, 0.42, 0.72));
  }
  g.add(b(1.5, 0.1, 2.6, C.wood, -2.45, 0.782, 1.15));         // 回台面（抬高 2mm，避开主台接缝）
  g.add(b(1.44, 0.06, 2.54, C.navy, -2.45, 0.747, 1.15));
  g.add(b(1.36, 0.68, 2.44, "#6b6357", -2.45, 0.4, 1.15));

  // ---- 组 1：显示器 + 键盘 + 鼠标（正对门口，人的目光方向）
  g.add(b(0.98, 0.62, 0.07, C.dark, 0.95, 1.09, -0.28));
  const scr = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.48, 0.02),
    M("#6b6357", { emissive: C.blue, emissiveIntensity: 0.16 }));
  scr.position.set(0.95, 1.1, -0.23);
  g.add(scr);
  for (let i = 0; i < 3; i++) {                                 // 屏上三行警情（第一条红）
    g.add(b(0.58 - i * 0.09, 0.026, 0.006, i === 0 ? C.coral : C.glass,
      0.9, 1.2 - i * 0.085, -0.215));
  }
  const dot = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.028, 0.006),
    M(C.mint, { emissive: C.mint, emissiveIntensity: 1.2 }));
  dot.position.set(1.24, 0.97, -0.215);
  g.add(dot);
  A.screenDot = dot;
  // 支架原来和屏幕背面同 z，插进屏里；往后退 5cm 落到屏后
  g.add(b(0.14, 0.26, 0.14, C.dark, 0.95, 0.9, -0.33));
  g.add(b(0.66, 0.03, 0.24, C.dark, 0.95, 0.845, 0.02));
  g.add(b(0.3, 0.008, 0.22, C.blue, 0.95, 0.834, -0.2));

  // ---- 组 2：座机（听筒离座、电话线绕一圈）
  g.add(b(0.4, 0.09, 0.28, C.dark, -0.55, 0.875, -0.06));
  g.add(b(0.32, 0.04, 0.18, C.blue, -0.55, 0.93, -0.08));
  for (let i = 0; i < 6; i++) {
    g.add(b(0.032, 0.006, 0.026, C.cream, -0.65 + (i % 3) * 0.055, 0.953, -0.12 + Math.floor(i / 3) * 0.055));
  }
  g.add(b(0.11, 0.05, 0.24, C.ink, -0.78, 0.855, 0.12));         // 听筒搁在台面上（原来悬空 3cm）
  g.add(tube([[-0.55, 0.87, -0.2], [-0.72, 0.86, -0.16], [-0.8, 0.87, 0.06],
              [-0.76, 0.88, 0.14]], 0.011, C.ink));

  // ---- 组 3：对讲机充电座两台（一台在充）
  for (let i = 0; i < 2; i++) {
    g.add(b(0.32, 0.06, 0.2, C.dark, -0.1 + i * 0.4, 0.86, -0.52));
    g.add(b(0.075, 0.22, 0.06, C.ink, -0.16 + i * 0.4, 1.0, -0.52));
    g.add(b(0.075, 0.22, 0.06, C.ink, -0.03 + i * 0.4, 1.0, -0.52));
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.018, 0.01),
      M(C.mint, { emissive: C.mint, emissiveIntensity: i ? 1.4 : 0.15 }));
    led.position.set(-0.1 + i * 0.4, 0.88, -0.41);
    g.add(led);
    if (i === 1) { A.radioLED = led; }
  }

  // ---- 组 4：登记簿 / 笔筒 / 印泥 / 老花镜 / 便签 / 胶带
  g.add(paper(0.52, 0.38, C.white, -1.55, 0.832, 0.02, 0.05));
  g.add(b(0.5, 0.008, 0.36, "#6b6357", -1.54, 0.838, 0.02));
  for (let i = 0; i < 4; i++) {
    g.add(b(0.34 - (i % 2) * 0.06, 0.004, 0.016, C.ink, -1.55, 0.844, -0.12 + i * 0.06));
  }
  g.add(b(0.085, 0.13, 0.085, C.dark, -1.95, 0.895, 0.3));
  for (let i = 0; i < 3; i++) {
    g.add(cy(0.011, 0.011, 0.22, i % 2 ? C.navy : C.coral, -1.97 + i * 0.02, 1.015, 0.3, 6));
  }
  g.add(b(0.14, 0.045, 0.14, C.coral, -1.2, 0.8525, 0.36));
  g.add(b(0.2, 0.045, 0.15, C.dark, -0.9, 0.8525, 0.42));

  // ---- 组 5：台灯（在回台上，灯罩朝下照登记簿）
  g.add(cy(0.1, 0.1, 0.02, C.dark, -2.45, 0.84, 2.0, 12));
  g.add(cy(0.011, 0.011, 0.42, C.dark, -2.45, 1.05, 2.0, 8));
  g.add(cy(0.12, 0.06, 0.1, C.cream, -2.45, 1.28, 1.86, 12));
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.085, 14),
    M(C.yellow, { emissive: C.yellow, emissiveIntensity: 1.1, side: THREE.DoubleSide }));
  glow.rotation.x = Math.PI / 2;
  glow.position.set(-2.45, 1.235, 1.86);
  g.add(glow);
  A.lampGlow.push(glow);

  // ---- 组 6：回台面上的便民区（纸杯叠、半杯水、证物袋、联系卡座）
  for (let i = 0; i < 5; i++) {
    g.add(cy(0.042, 0.032, 0.085, C.white, -2.9, 0.8725 + i * 0.017, 0.4, 10));
  }
  g.add(cy(0.048, 0.038, 0.115, C.glass, -2.9, 0.8875, 0.02, 12));
  g.add(b(0.16, 0.1, 0.1, C.glass, -2.05, 0.88, 0.5));           // 证物袋
  g.add(b(0.13, 0.08, 0.015, C.white, -2.05, 0.88, 0.56));
  g.add(b(0.28, 0.1, 0.04, C.navy, -2.0, 0.88, 1.5));            // 警民联系卡座
  g.add(b(0.22, 0.07, 0.01, C.cream, -2.0, 0.885, 1.53));

  return g;
}

// ---------------------------------------------------------------- 家具
function swivelChair() {
  const g = new THREE.Group();
  g.add(b(0.62, 0.1, 0.6, C.dark, 0, 0.5, 0));
  g.add(b(0.62, 0.62, 0.08, C.dark, 0, 0.8, -0.27));
  g.add(cy(0.05, 0.05, 0.5, C.ink, 0, 0.25, 0, 8));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leg = b(0.3, 0.05, 0.07, C.ink, Math.cos(a) * 0.15, 0.04, Math.sin(a) * 0.15);
    leg.rotation.y = -a;
    g.add(leg);
  }
  g.add(b(0.5, 0.4, 0.1, C.navy, 0, 0.85, -0.36));              // 椅背搭件外套
  return g;
}

function waitingChairs() {                                       // 三连等候椅
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const x = i * 0.58 - 0.58;
    // 座面顶 0.445 = 人物髋线：原来 0.49 的座面会把人陷进坐垫 4cm。
    g.add(b(0.52, 0.08, 0.48, C.navy, x, 0.405, 0));
    g.add(b(0.52, 0.48, 0.07, C.navy, x, 0.685, -0.22));
  }
  // 扶手只留两头：中间两把椅子之间没有扶手，坐中间的人胳膊才不会插进扶手。
  // （amb_wait 正坐中间那把，原来三条扶手会把她的两条小臂各切进去一截。）
  for (const ax of [-0.86, 0.86]) {
    g.add(b(0.06, 0.375, 0.4, C.blue, ax, 0.1875, 0));
  }
  g.add(b(1.86, 0.06, 0.5, C.blue, 0, 0.355, 0));                 // 横撑
  g.add(b(0.08, 0.36, 0.44, C.blue, -0.94, 0.18, 0));
  g.add(b(0.08, 0.36, 0.44, C.blue, 0.94, 0.18, 0));
  return g;
}

function singleChair() {
  const g = new THREE.Group();
  g.add(b(0.5, 0.08, 0.48, C.blue, 0, 0.44, 0));
  g.add(b(0.5, 0.46, 0.07, C.blue, 0, 0.7, -0.2));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(b(0.05, 0.42, 0.05, C.dark, sx * 0.2, 0.21, sz * 0.18));
  }
  return g;
}

function roundTable() {
  const g = new THREE.Group();
  g.add(cy(0.42, 0.42, 0.05, C.wood, 0, 0.52, 0, 20));
  g.add(cy(0.05, 0.05, 0.5, C.navy, 0, 0.26, 0, 10));
  g.add(cy(0.24, 0.24, 0.04, C.dark, 0, 0.02, 0, 16));
  g.add(paper(0.3, 0.22, C.white, 0.04, 0.55, 0.04, 0.3));        // 摊开的报纸
  g.add(paper(0.26, 0.2, "#6b6357", -0.06, 0.558, 0.12, -0.2));   // 折起来的一张
  return g;
}

function cabinet() {                                              // 铁皮文件柜
  const g = new THREE.Group();
  g.add(b(1.05, 1.55, 0.55, C.blue, 0, 0.78, 0));
  for (let r = 0; r < 4; r++) {
    g.add(b(0.94, 0.3, 0.06, "#6b6357", 0, 0.28 + r * 0.36, 0.29));
    g.add(b(0.3, 0.05, 0.02, C.white, 0, 0.36 + r * 0.36, 0.33));   // 手写标签条
    g.add(b(0.12, 0.03, 0.04, C.dark, 0, 0.2 + r * 0.36, 0.33));
  }
  g.add(b(1.1, 0.06, 0.6, C.navy, 0, 1.56, 0));
  return g;
}

function magazineRack() {                                         // 报刊架
  const g = new THREE.Group();
  for (let r = 0; r < 3; r++) {
    const y = 0.28 + r * 0.34;
    g.add(b(0.9, 0.04, 0.34, C.wood, 0, y, 0));
    const mg = b(0.24, 0.3, 0.03, [C.cream, C.mint, C.peach][r], -0.2 + (r % 2) * 0.3, y + 0.17, 0.05);
    mg.rotation.x = -0.18;
    g.add(mg);
    g.add(b(0.22, 0.28, 0.025, C.white, -0.2 + (r % 2) * 0.3, y + 0.16, 0.07));
    if (r === 2) { mg.rotation.z = 0.02; A.magazine = mg; }
  }
  for (const sx of [-1, 1]) { g.add(b(0.06, 1.2, 0.36, C.wood, sx * 0.46, 0.6, 0)); }
  return g;
}

function umbrellaStand() {
  const g = new THREE.Group();
  g.add(cy(0.18, 0.15, 0.44, C.blue, 0, 0.22, 0, 12));
  const umb = [[C.navy, 0.06, 0.9], [C.dark, -0.04, 0.8], [C.coral, 0.02, 0.7]];
  for (const [col, dx, h] of umb) {
    const u = cy(0.028, 0.028, h, col, dx, 0.55, -dx, 6);
    u.rotation.z = dx * 0.6;
    g.add(u);
  }
  return g;
}

function waterCooler() {
  const g = new THREE.Group();
  g.add(b(0.42, 0.9, 0.42, C.white, 0, 0.45, 0));
  g.add(cy(0.19, 0.19, 0.42, C.glass, 0, 1.1, 0, 12));            // 水桶（半满）
  g.add(cy(0.05, 0.05, 0.1, C.dark, 0.12, 0.62, 0.24, 6));        // 龙头
  g.add(b(0.3, 0.03, 0.2, C.blue, 0, 0.24, 0.2));                 // 接水盘
  for (let i = 0; i < 3; i++) {                                    // 桶里的小气泡
    const bub = ball(0.018, C.white, 0.04 - i * 0.03, 0.95 + i * 0.05, 0.03, 6);
    bub.material.transparent = true;
    bub.material.opacity = 0.7;
    g.add(bub);
    A.bubbles.push({ o: bub, base: 0.95 + i * 0.05 });
  }
  return g;
}

function pothos(scale = 1) {                                      // 绿萝（带垂下的枝）
  const g = new THREE.Group();
  g.add(cy(0.16 * scale, 0.13 * scale, 0.18 * scale, C.cream, 0, 0.09 * scale, 0, 10));
  for (let i = 0; i < 5; i++) {
    const a = i * 1.4;
    g.add(ball(0.12 * scale, i % 2 ? C.mint : "#8cc6a4",
      Math.cos(a) * 0.1 * scale, (0.2 + (i % 3) * 0.05) * scale, Math.sin(a) * 0.08 * scale, 8));
  }
  const vine = cy(0.008, 0.008, 0.5 * scale, C.mint, 0.16 * scale, 0.05 * scale, 0, 4);
  vine.rotation.z = 1.2;
  g.add(vine);
  return g;
}

// ---------------------------------------------------------------- 场景
const room = { x0: -5.5, x1: 5.5, z0: -4.2, z1: 4.2, h: 3.0 };

const props = [
  // ---- 吊顶带（贴死墙内表面）+ 四盏灯
  // 后墙那条收短到 9.4：原来 10.8 会和左右两条在墙角叠出共面（深度打架/一条亮缝），
  // 现在三条各自收口，墙角留 2cm 的缝，看不出补丁。
  { id: "s_ceilBack", x: 0, z: -3.81, w: 9.4, d: 0.78, passable: true,
    build: () => b(9.4, 0.11, 0.78, C.cream, 0, 2.87, 0) },
  { id: "s_ceilL", x: -5.11, z: 0, w: 0.78, d: 7.6, passable: true,
    build: () => b(0.78, 0.11, 7.6, C.cream, 0, 2.87, 0) },
  { id: "s_ceilR", x: 5.11, z: 0, w: 0.78, d: 7.6, passable: true,
    build: () => b(0.78, 0.11, 7.6, C.cream, 0, 2.87, 0) },
  { id: "s_lampA", x: -2.3, z: -3.76, w: 1.3, d: 0.3, passable: true, build: ceilingLight },
  { id: "s_lampB", x: 2.3, z: -3.76, w: 1.3, d: 0.3, passable: true, build: ceilingLight },
  { id: "s_lampC", x: -5.06, z: 1.9, w: 0.3, d: 1.3, passable: true, rot: Math.PI / 2,
    build: ceilingLight },
  { id: "s_lampD", x: 5.06, z: -1.4, w: 0.3, d: 1.3, passable: true, rot: Math.PI / 2,
    build: ceilingLight },

  // ---- 西北：文件柜 ×2 + 白板 + 柜顶绿萝
  { id: "s_cab1", x: -3.9, z: -3.92, w: 1.05, d: 0.55, build: cabinet },
  { id: "s_cab2", x: -2.75, z: -3.92, w: 1.05, d: 0.55, build: cabinet },
  { id: "s_cabPlant", x: -3.9, z: -3.92, w: 0.4, d: 0.4, passable: true,
    build: () => { const p = pothos(0.8); p.position.set(0, 1.59, 0); return p; } },
  { id: "s_board", x: -1.1, z: -4.12, w: 1.6, d: 0.05,
    build: () => {
      const g = panel(1.6, 1.1, C.white, 0, 1.95, 0, 0, C.blue);
      for (let i = 0; i < 3; i++) {                                    // 今日警情三行（相对面板）
        g.add(b(1.1 - i * 0.12, 0.04, 0.01, i === 0 ? C.coral : C.ink, -0.18, 0.3 - i * 0.16, 0.05));
      }
      g.add(cy(0.02, 0.02, 0.16, C.coral, 0.68, 0.34, 0.04, 6));        // 红笔吸在角落
      return g;
    }, interact: { x: -2.4, z: -2.8 } },

  // ---- 后墙：磨砂窗 + 暖气片 + 挂钟
  { id: "s_window", x: 1.9, z: -4.12, w: 1.6, d: 0.08,
    build: () => {
      const g = new THREE.Group();
      g.add(b(1.74, 1.34, 0.06, C.cream, 0, 1.85, 0));                 // 窗套
      const glass = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 0.02),
        new THREE.MeshToonMaterial({ color: C.glass, transparent: true, opacity: 0.42 }));
      glass.position.set(0, 1.85, 0.01);
      g.add(glass);
      g.add(b(1.7, 0.06, 0.12, C.blue, 0, 1.22, 0.04));                // 窗台
      A.windowLight = glass;
      return g;
    }, interact: { x: 1.9, z: -3.2 } },
  // 暖气片贴墙：后墙内表面在 z=-4.2，原来 -4.06 时翼片背面离墙 9cm。
  // 注意方向：往房间外（更负的 z）才是贴墙，-3.99 会把它推到离墙 16cm。
  { id: "s_radiator", x: 4.2, z: -4.13, w: 1.2, d: 0.14,
    build: () => {
      const g = new THREE.Group();
      for (let i = 0; i < 9; i++) {
        g.add(b(0.07, 0.5, 0.1, C.cream, -0.5 + i * 0.125, 0.35, 0));
      }
      g.add(b(1.2, 0.06, 0.12, C.cream, 0, 0.62, 0));
      return g;
    } },
  { id: "s_clock", x: 0.2, z: -4.13, w: 0.34, d: 0.06,
    build: () => {
      const g = new THREE.Group();
      g.add(cy(0.17, 0.17, 0.05, C.white, 0, 2.15, 0, 22));
      g.add(cy(0.14, 0.14, 0.02, "#6b6357", 0.02, 2.15, 0.02, 22));
      g.add(b(0.012, 0.09, 0.012, C.ink, 0, 2.19, 0.04));               // 分针
      const sec = b(0.008, 0.11, 0.008, C.coral, 0, 2.19, 0.045);        // 秒针
      g.add(sec);
      A.clockHand = sec;
      return g;
    } },

  // ---- 东北：门 + 消防柜 + 电箱
  { id: "s_door", x: 5.42, z: 1.0, w: 0.1, d: 1.0,
    build: () => {
      const g = new THREE.Group();
      g.add(b(0.1, 2.15, 1.0, C.wood, 0, 1.08, 0));
      g.add(b(0.06, 0.6, 0.8, "#6b6357", 0, 1.6, 0));
      g.add(b(0.06, 0.5, 0.8, "#6b6357", 0, 0.62, 0));
      g.add(ball(0.045, C.yellow, -0.07, 1.02, 0.34));                  // 门把手
      // 挂在门上的外套：原来是 0.12×0.42 的深盒子，等于从门面伸出一块 42cm 的板，
      // 从侧面看就是两片悬空黑板。改成薄片贴住门面（0.04 厚），再加一个小挂钩。
      g.add(b(0.04, 0.72, 0.46, C.navy, -0.07, 1.55, 0.28));             // 外套
      g.add(b(0.035, 0.26, 0.3, C.ink, -0.07, 1.02, 0.3));               // 外套下摆的阴影/口袋
      g.add(b(0.03, 0.03, 0.22, C.dark, -0.055, 1.93, 0.28));            // 挂钩横杆
      g.add(b(0.16, 0.06, 0.02, C.navy, -0.06, 1.5, 0.5));               // 无字警蓝门牌
      return g;
    }, interact: { x: 4.3, z: 1.0 } },
  { id: "s_fire", x: 5.43, z: -2.0, w: 0.12, d: 0.9,
    build: () => {
      const g = new THREE.Group();
      g.add(b(0.14, 1.1, 0.9, C.cream, 0, 1.5, 0));                     // 消防柜
      g.add(b(0.06, 0.9, 0.72, C.coral, -0.06, 1.5, 0));                // 红漆门
      g.add(b(0.03, 0.05, 0.2, C.white, -0.1, 1.5, 0.2));               // 拉手
      g.add(cy(0.1, 0.1, 0.4, C.coral, -0.3, 0.24, 0, 10));             // 灭火器
      g.add(cy(0.035, 0.035, 0.09, C.dark, -0.3, 0.48, 0, 8));
      return g;
    } },
  { id: "s_ebox", x: 5.46, z: 3.0, w: 0.06, d: 0.5,
    build: () => b(0.06, 0.6, 0.5, C.cream, 0, 1.8, 0) },

  // ---- 左墙：公示栏 + 值班表 + 日历
  { id: "s_notice", x: -5.44, z: 0.4, w: 0.06, d: 1.4,
    build: () => {
      const g = panel(1.4, 0.95, C.white, 0, 1.9, 0, 0, C.blue);
      g.rotation.y = Math.PI / 2;
      const cols = [C.yellow, C.mint, C.peach, C.blue, C.cream];
      for (let i = 0; i < 5; i++) {                                     // 五张四色便签
        g.add(b(0.2, 0.18, 0.01, cols[i], -0.4 + (i % 3) * 0.4, 0.14 - Math.floor(i / 3) * 0.28, 0.06));
        g.add(ball(0.012, C.coral, -0.4 + (i % 3) * 0.4, 0.2 - Math.floor(i / 3) * 0.28, 0.07, 6));
      }
      return g;
    }, interact: { x: -4.3, z: 0.4 } },
  { id: "s_roster", x: -5.44, z: -1.2, w: 0.06, d: 1.0,
    build: () => { const g = panel(1.0, 0.7, "#6b6357", 0, 1.9, 0, 0, C.blue); g.rotation.y = Math.PI / 2;
      for (let i = 0; i < 5; i++) g.add(b(0.7, 0.02, 0.01, C.ink, 0, 0.2 - i * 0.1, 0.06));
      return g; } },
  { id: "s_calendar", x: -5.44, z: -2.4, w: 0.06, d: 0.5,
    build: () => { const g = panel(0.5, 0.62, C.peach, 0, 1.95, 0, 0, C.blue); g.rotation.y = Math.PI / 2;
      g.add(b(0.3, 0.04, 0.01, C.coral, 0, 0.2, 0.06)); return g; } },

  // ---- 西南：等候区
  { id: "s_bench", x: -4.75, z: 1.3, w: 0.5, d: 1.9, seat: true, facing: Math.PI / 2, rot: Math.PI / 2,
    interact: { x: -3.6, z: 1.3 }, build: waitingChairs },
  { id: "s_round", x: -3.3, z: 2.2, w: 0.9, d: 0.9, seat: true, facing: 0.4,
    interact: { x: -3.3, z: 2.9 }, build: roundTable },
  { id: "s_rack", x: -4.9, z: 3.2, w: 0.9, d: 0.36, build: magazineRack },
  { id: "s_umbrella", x: 4.9, z: -0.3, w: 0.4, d: 0.4, build: umbrellaStand },
  { id: "s_lost", x: -5.2, z: 2.7, w: 0.5, d: 0.3, passable: true,
    build: () => {
      const g = new THREE.Group();                                      // 失物招领架
      g.add(b(0.5, 0.06, 0.26, C.wood, 0, 1.6, 0));
      for (let i = 0; i < 3; i++) {                                     // 三把钥匙
        g.add(cy(0.01, 0.01, 0.14, C.blue, -0.15 + i * 0.14, 1.5, 0.02, 5));
        g.add(b(0.05, 0.06, 0.01, C.blue, -0.15 + i * 0.14, 1.42, 0.02));
      }
      const um = cy(0.02, 0.02, 0.34, C.dark, 0.16, 1.42, 0.04, 6);     // 一把折叠伞
      um.rotation.z = 0.1;
      g.add(um);
      return g;
    } },

  // ---- 通道：取号机 + 一米线 + 地垫
  { id: "s_kiosk", x: -0.5, z: 3.1, w: 0.5, d: 0.42, build: () => {
      const g = new THREE.Group();
      g.add(b(0.5, 0.12, 0.42, C.dark, 0, 0.06, 0));
      g.add(cy(0.06, 0.06, 1.1, C.blue, 0, 0.62, 0, 10));
      g.add(b(0.34, 0.28, 0.16, C.dark, 0, 1.24, 0));
      g.add(b(0.22, 0.16, 0.02, C.cream, 0, 1.26, 0.09));               // 屏幕
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.01),
        M(C.mint, { emissive: C.mint, emissiveIntensity: 1.3 }));
      led.position.set(0, 1.14, 0.09);
      g.add(led);
      return g;
    }, interact: { x: -0.5, z: 2.2 } },
  { id: "s_line1", x: -1.8, z: 1.8, w: 0.1, d: 0.1, passable: true, build: stanchion },
  { id: "s_line2", x: 1.2, z: 1.8, w: 0.1, d: 0.1, passable: true, build: stanchion },
  { id: "s_belt", x: -0.3, z: 1.8, w: 3.0, d: 0.06, passable: true,
    build: () => b(3.0, 0.04, 0.03, C.coral, 0, 0.86, 0) },
  { id: "s_mat", x: 2.3, z: 3.6, w: 1.4, d: 0.9, passable: true,
    build: () => {
      const m = new THREE.Group();
      m.add(b(1.4, 0.03, 0.9, C.dark, 0, 0.015, 0));
      const corner = b(0.42, 0.02, 0.3, C.ink, 0.5, 0.04, 0.32);
      corner.rotation.y = 0.02;
      m.add(corner);
      A.matCorner = corner;
      return m;
    } },

  // ---- 角落：饮水机、垃圾桶、拖把、绿萝
  { id: "s_water", x: 4.8, z: 3.3, w: 0.45, d: 0.45, build: waterCooler },
  { id: "s_bin", x: 4.0, z: 3.7, w: 0.5, d: 0.34, build: () => {
      const g = new THREE.Group();
      for (const [i, col] of [[0, C.blue], [1, C.mint]]) {
        g.add(cy(0.19, 0.17, 0.5, col, (i - 0.5) * 0.44, 0.25, 0, 12));
        g.add(cy(0.2, 0.2, 0.04, C.dark, (i - 0.5) * 0.44, 0.52, 0, 12));
      }
      return g;
    } },
  { id: "s_mop", x: 5.2, z: 3.8, w: 0.3, d: 0.3, passable: true, build: () => {
      const g = new THREE.Group();
      g.add(cy(0.16, 0.14, 0.3, C.blue, 0, 0.15, 0, 10));
      g.add(cy(0.03, 0.03, 1.3, C.wood, 0.04, 0.9, 0, 6));
      return g;
    } },
  { id: "s_plant", x: 3.3, z: 3.5, w: 0.5, d: 0.5, build: () => { const p = pothos(1.6); return p; } },

  // ---- 右下：立式公告牌 + 落地衣架（把台与墙之间那片填上）
  { id: "s_stand", x: 3.3, z: 0.9, w: 0.6, d: 0.4, build: () => {
      const g = new THREE.Group();
      g.add(b(0.52, 0.04, 0.34, C.dark, 0, 0.02, 0));
      g.add(cy(0.025, 0.025, 1.5, C.blue, 0, 0.76, 0, 8));
      g.add(b(0.6, 0.84, 0.05, C.navy, 0, 1.5, 0));
      g.add(b(0.5, 0.66, 0.03, C.cream, 0, 1.52, 0.03));
      for (let i = 0; i < 3; i++) {
        g.add(b(0.36 - i * 0.05, 0.03, 0.01, i === 0 ? C.coral : C.ink, 0, 1.74 - i * 0.14, 0.06));
      }
      return g;
    }, interact: { x: 3.3, z: 1.7 } },
  { id: "s_coatrack", x: 4.3, z: 2.4, w: 0.4, d: 0.4, build: () => {
      const g = new THREE.Group();
      g.add(cy(0.03, 0.03, 1.7, C.dark, 0, 0.85, 0, 8));
      g.add(cy(0.22, 0.05, 0.08, C.dark, 0, 0.04, 0, 10));
      for (const a of [-0.5, 0.5]) {
        const hook = b(0.26, 0.03, 0.03, C.dark, Math.sin(a) * 0.13, 1.66, Math.cos(a) * 0.05);
        g.add(hook);
      }
      g.add(b(0.16, 0.62, 0.3, C.navy, 0.14, 1.3, 0));                 // 挂着的制服
      return g;
    }, interact: { x: 4.3, z: 3.1 } },

  // ---- 东南：L 形值班台 + 转椅（视觉中心）
  { id: "s_desk", x: 0.7, z: -1.2, w: 4.4, d: 2.2, build: () => {
      const g = new THREE.Group();
      g.add(dutyDesk());
      const ch = swivelChair();
      ch.position.set(0.95, 0, -1.45);
      g.add(ch);
      return g;
    }, interact: { x: 0.5, z: 0.5 } },
];


function stanchion() {                                            // 一米线立柱
  const g = new THREE.Group();
  g.add(cy(0.04, 0.05, 0.95, C.blue, 0, 0.48, 0, 10));
  g.add(cy(0.075, 0.075, 0.04, C.dark, 0, 0.02, 0, 10));
  g.add(cy(0.055, 0.03, 0.08, C.dark, 0, 0.98, 0, 10));
  return g;
}

function ceilingLight() {
  const g = new THREE.Group();
  g.add(b(1.3, 0.1, 0.32, "#6b6357", 0, 2.8, 0));
  const glow = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.03, 0.24),
    M(C.yellow, { emissive: C.yellow, emissiveIntensity: 1.2 }));
  glow.position.set(0, 2.74, 0);
  g.add(glow);
  A.lampGlow.push(glow);
  return g;
}

const obstacles = props.filter((p) => !p.passable).map((p) => ({ x: p.x, z: p.z, w: p.w, d: p.d }));
obstacles.push({ x: 0, z: room.z0, w: 11.2, d: 0.4 });
obstacles.push({ x: room.x0, z: 0, w: 0.4, d: 8.5 });
obstacles.push({ x: room.x1, z: 0, w: 0.4, d: 8.5 });

// 两个人：一个在等号，一个在门口打电话（都只有背影）
// 场景 id 是 amb_*（布景用），personId 才是"可点的人"：不是本案当事人，
// 所以用 npc_ 前缀，宿主 pickTargetAt 认 personId 就能把点击接住（不会开出本案问话面板）。
const characters = [
  { id: "amb_wait", personId: "npc_old_lady", label: "等人的老太太",
    name: "等人的老太太", role: "候诊群众",
    x: -4.75, z: 1.3, y: -0.125, facing: Math.PI / 2, pose: "sit",
    scale: 0.94, color: C.peach, pants: "#6b6357", hair: "#b9b2a6", ambient: true },
  { id: "amb_caller", personId: "npc_young_man", label: "打电话的年轻人",
    name: "打电话的年轻人", role: "办事群众",
    x: 4.4, z: 1.4, facing: -2.0, pose: "stand", hair: "#2f2620",
    color: C.blue, pants: C.dark, ambient: true },
     { id: "p_a", personId: "p_a", label: "王小雨", name: "王小雨", role: "小区物业值班员",
       x: 3.05, z: 2.35, y: 0, facing: -Math.PI * 0.72, pose: "stand",
       scale: 0.93, color: C.blue, pants: C.dark, hair: "#2f2620" },
     { id: "p_b", personId: "p_b", label: "刘师傅", name: "刘师傅", role: "车主 · 3 号楼住户",
       x: 4.25, z: 3.75, y: 0, facing: -Math.PI * 0.55, pose: "stand",
       scale: 0.97, color: C.wood, pants: C.dark, hair: "#3a3129" }
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
    siteColor: "#6b6357",
    skyTop: "#6b6357", skyMid: "#6b6357", skyBottom: "#6b6357",
    light: { sun: "#6b6357", sunI: 2.3, fill: "#6b6357", fillI: 1.05, hemi: 0.78 },
    actor: { x: 0.9, z: 2.6 },
    camYaw: 0.28, camPitch: 0.58, camDist: 13, camFocus: [0, 1.0, -0.1],
    walk: { x0: -5.0, x1: 5.0, z0: -3.6, z1: 3.7 },
    onSpot: (p) => { (window.__events = window.__events || []).push(["spot", p.id]); },
    onPerson: (p) => { (window.__events = window.__events || []).push(["person", p.id]); },
    onArrived: (p) => { (window.__events = window.__events || []).push(["arrived", +p.x.toFixed(2), +p.z.toFixed(2)]); },
    onSeat: (p) => { (window.__events = window.__events || []).push(["seat", p.id]); },
    // ---- 基础动效：8 条 2% 量级的循环
    onFrame: (t) => {
      if (A.clockHand) { A.clockHand.rotation.z = -t * (Math.PI * 2 / 60); }
      if (A.screenDot) {
        A.screenDot.material.emissiveIntensity = 0.5 + 0.5 * (0.5 + 0.5 * Math.sin(t * 3.14));
      }
      if (A.radioLED) { A.radioLED.material.emissiveIntensity = 0.8 + 0.35 * Math.sin(t * 2.2); }
      if (A.matCorner) { A.matCorner.rotation.x = Math.sin(t * 0.9) * 0.018; }
      for (const g of A.lampGlow) { g.material.emissiveIntensity = 1.2 * (1 + Math.sin(t * 1.7) * 0.018); }
      for (const bp of A.bubbles) {
        const q = (t * 0.28 + bp.base) % 1;
        bp.o.position.y = 0.86 + q * 0.3;
        bp.o.material.opacity = 0.7 * Math.sin(q * Math.PI);
      }
      if (A.magazine) { A.magazine.rotation.x = -0.18 + Math.sin(t * 1.1) * 0.02; }
      if (A.windowLight) { A.windowLight.material.opacity = 0.42 + Math.sin(t * 0.6) * 0.03; }
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
