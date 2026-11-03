// S0 · 派出所值班室（3D 场景数据）
// -----------------------------------------------------------------------------
// 密度按 docs/场景与人物建模提示词.md §1.3：室内 ≥45 件，六层都要有东西。
// 场景只放"东西"，不放文案；点击事件靠 id 与案子里的 spots 对齐。
// -----------------------------------------------------------------------------
import * as THREE from "./vendor/three.module.min.js";
import { createScene } from "./scene3d.js";

// 出错时把信息留在 window 上，页面本身不显示任何 UI（探针靠它定位）
window.__err = "";
window.addEventListener("error", (e) => {
  window.__err = (e.message || "error") + " @ " + (e.filename || "") + ":" + (e.lineno || 0);
});

const M = (color, opts) => new THREE.MeshToonMaterial({ color, ...(opts || {}) });

// 零件工厂：单位 = 世界单位（1 ≈ 0.5m）
function b(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function cy(r1, r2, h, color, x = 0, y = 0, z = 0, seg = 14) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), M(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function ball(r, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), M(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}
// 贴墙竖板（画、牌、公示栏）
function panel(w, h, color, x, y, z, ry = 0) {
  const m = b(w, h, 0.05, color, x, y, z);
  m.rotation.y = ry;
  return m;
}
// 墙上的画：底板 + 几道抽象色块
function poster(w, h, base, ink, x, y, z, ry = 0) {
  const g = new THREE.Group();
  g.add(b(w + 0.06, h + 0.06, 0.04, "#8f9aa3", 0, 0, -0.01));   // 边框，压出层次
  g.add(b(w, h, 0.06, base, 0, 0, 0));
  g.add(b(w * 0.62, h * 0.12, 0.02, ink, -w * 0.05, h * 0.22, 0.04));
  g.add(b(w * 0.7, h * 0.06, 0.02, ink, -w * 0.02, h * 0.02, 0.04));
  g.add(b(w * 0.45, h * 0.06, 0.02, ink, -w * 0.12, -h * 0.16, 0.04));
  g.position.set(x, y, z);
  g.rotation.y = ry;
  return g;
}

// ---------------------------------------------------------------- 家具与陈设
function dutyDesk() {
  const g = new THREE.Group();
  g.add(b(4.6, 0.1, 1.5, "#c8c2b8", 0, 0.78, 0));            // 台面
  g.add(b(4.36, 0.7, 1.3, "#8f9aa3", 0, 0.4, 0));             // 柜体
  g.add(b(4.5, 0.05, 1.42, "#d7d2c8", 0, 0.73, 0));           // 台沿
  // 台面小物
  g.add(b(0.95, 0.62, 0.07, "#2f3946", 0.6, 1.15, -0.16));    // 显示器
  const scr = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.5, 0.02),
    M("#3d5566", { emissive: "#6f9fc4", emissiveIntensity: 0.5 })
  );
  scr.position.set(0.6, 1.16, -0.12);
  g.add(scr);
  g.add(b(0.16, 0.3, 0.16, "#6b7480", 0.6, 0.95, -0.16));     // 支架
  g.add(b(0.62, 0.03, 0.24, "#3f4a56", 0.6, 0.82, 0.18));     // 键盘
  g.add(b(0.4, 0.1, 0.3, "#3f4a56", 0.02, 0.85, -0.1));       // 座机
  g.add(b(0.12, 0.05, 0.26, "#2b323a", 0.02, 0.92, -0.1));
  g.add(b(0.34, 0.07, 0.09, "#4b5563", 0.02, 0.93, -0.2));    // 听筒（离座）
  g.add(b(0.3, 0.09, 0.22, "#2b323a", 0.52, 0.86, -0.5));     // 对讲机座
  g.add(b(0.07, 0.24, 0.06, "#3f4a56", 0.46, 1.0, -0.5));
  g.add(b(0.07, 0.24, 0.06, "#3f4a56", 0.58, 1.0, -0.5));
  g.add(b(0.5, 0.03, 0.36, "#fbfaf7", -1.15, 0.85, 0.05));    // 登记簿
  g.add(b(0.46, 0.02, 0.3, "#f2efe8", -1.12, 0.87, 0.02));
  g.add(b(0.09, 0.12, 0.09, "#5b6672", -0.72, 0.9, 0.16));    // 笔筒
  for (let i = 0; i < 3; i++) {
    g.add(cy(0.012, 0.012, 0.2, i % 2 ? "#2f4a6d" : "#b42318", -0.72 + (i - 1) * 0.02, 1.03, 0.16, 8));
  }
  g.add(b(0.14, 0.05, 0.14, "#8a3b30", -1.5, 0.86, 0.2));     // 印泥
  g.add(b(0.2, 0.06, 0.16, "#3f4a56", -1.72, 0.86, 0.1));     // 老花镜
  g.add(b(0.16, 0.02, 0.22, "#fdf3e3", -0.95, 0.83, -0.42));  // 便签本
  g.add(cy(0.05, 0.05, 0.06, "#8f9aa3", -0.55, 0.84, -0.5, 10)); // 胶带座
  for (let i = 0; i < 5; i++) {                                // 纸杯叠
    g.add(cy(0.045, 0.035, 0.09, "#f7f4ee", 1.55, 0.85 + i * 0.02, 0.28, 10));
  }
  g.add(cy(0.05, 0.04, 0.12, "#dce6ea", 1.85, 0.86, 0.22, 12)); // 半杯水
  g.add(cy(0.012, 0.012, 0.34, "#4b5563", 2.05, 0.96, -0.4, 8)); // 台灯杆
  g.add(cy(0.12, 0.05, 0.1, "#e8dfc8", 2.05, 1.16, -0.4, 12));
  g.add(b(0.3, 0.12, 0.05, "#2f4a6d", 1.4, 0.86, -0.55));      // 便民服务牌
  return g;
}

function swivelChair() {
  const g = new THREE.Group();
  g.add(b(0.62, 0.1, 0.6, "#5b6672", 0, 0.5, 0));
  g.add(b(0.62, 0.62, 0.08, "#5b6672", 0, 0.8, -0.27));
  g.add(cy(0.05, 0.05, 0.5, "#3f4a56", 0, 0.25, 0));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leg = b(0.3, 0.05, 0.07, "#3f4a56", Math.cos(a) * 0.15, 0.04, Math.sin(a) * 0.15);
    leg.rotation.y = -a;
    g.add(leg);
  }
  g.add(b(0.5, 0.4, 0.1, "#2f4a6d", 0, 0.85, -0.36));   // 椅背搭件外套
  return g;
}

function longBench(w) {
  const g = new THREE.Group();
  g.add(b(w, 0.09, 0.5, "#b98b5e", 0, 0.45, 0));
  for (const s of [-1, 1]) {
    g.add(b(0.1, 0.45, 0.45, "#8f7a5e", s * (w / 2 - 0.15), 0.22, 0));
  }
  return g;
}

function waitingChairs() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    g.add(b(0.5, 0.08, 0.48, "#5b6672", i * 0.55 - 0.55, 0.45, 0));
    g.add(b(0.5, 0.5, 0.07, "#5b6672", i * 0.55 - 0.55, 0.72, -0.22));
    g.add(b(0.06, 0.45, 0.4, "#8f9aa3", i * 0.55 - 0.55, 0.22, 0));
  }
  g.add(b(1.75, 0.06, 0.5, "#8f9aa3", 0, 0.42, 0));
  return g;
}

function cabinet() {
  const g = new THREE.Group();
  g.add(b(1.05, 1.85, 0.58, "#cfd6de", 0, 0.93, 0));
  for (let i = 0; i < 3; i++) {
    g.add(b(0.96, 0.5, 0.03, "#dde3ea", 0, 0.35 + i * 0.56, 0.3));
    g.add(b(0.18, 0.04, 0.04, "#6b7480", 0, 0.35 + i * 0.56, 0.33));
    g.add(b(0.14, 0.06, 0.005, "#fbfaf7", 0.22, 0.55 + i * 0.56, 0.32));
  }
  return g;
}

function waterCooler() {
  const g = new THREE.Group();
  g.add(b(0.55, 0.95, 0.5, "#eef1f4", 0, 0.48, 0));
  g.add(cy(0.19, 0.19, 0.44, "#cbe3f2", 0, 1.16, 0, 16));
  g.add(b(0.52, 0.1, 0.46, "#dfe4e9", 0, 1.0, 0));
  g.add(b(0.3, 0.04, 0.3, "#b9c1cb", 0, 0.14, 0.26));
  g.add(cy(0.02, 0.02, 0.06, "#3b82f6", -0.09, 1.0, 0.24, 8));
  g.add(cy(0.02, 0.02, 0.06, "#ef4444", 0.06, 1.0, 0.24, 8));
  return g;
}

function fan() {
  const g = new THREE.Group();
  g.add(cy(0.06, 0.06, 1.25, "#8f9aa3", 0, 0.62, 0));
  g.add(cy(0.28, 0.28, 0.05, "#8f9aa3", 0, 0.02, 0, 16));
  g.add(cy(0.05, 0.05, 0.06, "#5b6672", 0, 1.28, 0, 10));
  const head = new THREE.Group();
  head.position.set(0, 1.34, 0);
  head.add(cy(0.26, 0.26, 0.06, "#cfd6de", 0, 0, 0, 18));
  for (let i = 0; i < 3; i++) {
    const blade = b(0.18, 0.02, 0.4, "#e8eef2", 0, 0, 0.16);
    blade.rotation.y = (i / 3) * Math.PI * 2;
    head.add(blade);
  }
  g.add(head);
  return g;
}

function trashPair() {
  const g = new THREE.Group();
  g.add(b(0.26, 0.78, 0.4, "#6b7480", -0.15, 0.39, 0));
  g.add(b(0.26, 0.78, 0.4, "#4a7fa5", 0.15, 0.39, 0));
  g.add(b(0.28, 0.05, 0.42, "#8f9aa3", -0.15, 0.8, 0));
  g.add(b(0.28, 0.05, 0.42, "#5a8fb5", 0.15, 0.8, 0));
  return g;
}

function umbrellaStand() {
  const g = new THREE.Group();
  g.add(cy(0.18, 0.16, 0.5, "#7d8792", 0, 0.25, 0, 14));
  const cols = ["#2f4a6d", "#8a3b30", "#3f4a56"];
  for (let i = 0; i < 3; i++) {
    const u = cy(0.035, 0.03, 0.85, cols[i], -0.07 + i * 0.07, 0.5, (i - 1) * 0.05, 8);
    u.rotation.z = 0.08 * (i - 1);
    g.add(u);
  }
  return g;
}

function parcelStack() {
  const g = new THREE.Group();
  g.add(b(0.62, 0.45, 0.5, "#c8a97a", 0, 0.22, 0));
  g.add(b(0.5, 0.4, 0.44, "#d3b98f", 0.05, 0.65, 0.02));
  g.add(b(0.4, 0.3, 0.36, "#bfa071", -0.06, 0.98, -0.03));
  g.add(b(0.58, 0.02, 0.02, "#e8dcc4", 0, 0.45, 0.25));
  return g;
}

function lostAndFound() {
  const g = new THREE.Group();
  g.add(b(1.0, 1.7, 0.32, "#b9b4ac", 0, 0.85, 0));
  g.add(b(0.9, 0.06, 0.3, "#a8a29a", 0, 1.2, 0));
  g.add(b(0.9, 0.06, 0.3, "#a8a29a", 0, 0.7, 0));
  g.add(b(0.14, 0.1, 0.03, "#e3c98d", -0.25, 1.45, 0.18));
  g.add(cy(0.02, 0.06, 0.42, "#2f4a6d", 0.22, 1.0, 0.18, 8));
  return g;
}

function radiator() {
  const g = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    g.add(b(0.07, 0.55, 0.1, "#dfe3e8", i * 0.1 - 0.4, 0.28, 0));
  }
  g.add(b(0.95, 0.05, 0.12, "#c7ccd3", 0, 0.56, 0));
  return g;
}

function plant() {
  const g = new THREE.Group();
  g.add(cy(0.16, 0.13, 0.22, "#b98b5e", 0, 0.11, 0, 12));
  g.add(ball(0.2, "#5b8c63", -0.05, 0.34, 0.02));
  g.add(ball(0.17, "#3f6a47", 0.08, 0.3, -0.04));
  g.add(ball(0.13, "#6f9e76", 0.0, 0.44, 0.03));
  return g;
}

function ceilingLight() {
  const g = new THREE.Group();
  g.add(b(1.4, 0.1, 0.34, "#e4e9ee", 0, 2.88, 0));          // 灯具底座，紧贴吊顶
  const glow = new THREE.Mesh(
    new THREE.BoxGeometry(1.3, 0.03, 0.26),
    M("#fff6e0", { emissive: "#ffdca8", emissiveIntensity: 1.6 })
  );
  glow.position.set(0, 2.82, 0);
  g.add(glow);
  return g;
}

// ---------------------------------------------------------------- 场景
const room = { x0: -8, x1: 8, z0: -6.5, z1: 6.5, h: 3.2 };

const props = [
  { id: "s_desk", x: 0.8, z: -1.6, w: 4.6, d: 1.5, interact: { x: 2.2, z: 0.3 }, build: dutyDesk },
  { id: "s_desk2", x: -2.0, z: -0.6, w: 1.5, d: 2.6, build: () => {
      const g = new THREE.Group();
      g.add(b(1.5, 0.1, 2.6, "#c8c2b8", 0, 0.78, 0));
      g.add(b(1.36, 0.7, 2.44, "#8f9aa3", 0, 0.4, 0));
      g.add(b(0.34, 0.14, 0.26, "#2b323a", 0, 0.86, -0.8));
      return g;
    } },
  { id: "s_phone", x: 0.6, z: -1.75, w: 0.4, d: 0.3, interact: { x: 0.02, z: 0.1 }, build: () => {
      const g = new THREE.Group();
      g.add(b(0.4, 0.1, 0.3, "#3f4a56", 0, 0.85, 0));
      g.add(b(0.34, 0.07, 0.09, "#4b5563", 0, 0.93, -0.2));
      return g;
    } },
  { id: "s_chair", x: 0.8, z: -2.95, w: 0.7, d: 0.7, seat: true, facing: Math.PI, interact: { x: 2.2, z: -4.3 },
    build: swivelChair },
  { id: "s_bench", x: 0.8, z: 0.9, w: 1.8, d: 0.5, seat: true, facing: 0.2, interact: { x: 1.6, z: 2.85 },
    build: () => longBench(1.8) },
  { id: "s_wait", x: -6.4, z: 2.6, w: 1.8, d: 0.5, seat: true, facing: 0.1, interact: { x: -4.6, z: 3.2 },
    build: waitingChairs },
  { id: "s_cab1", x: -6.6, z: -5.9, w: 1.05, d: 0.58, build: cabinet },
  { id: "s_cab2", x: -5.5, z: -5.9, w: 1.05, d: 0.58, build: cabinet },
  { id: "s_water", x: 5.9, z: -5.9, w: 0.55, d: 0.5, build: waterCooler },
  { id: "s_fan", x: -6.2, z: 1.4, w: 0.6, d: 0.6, build: fan },
  { id: "s_bin", x: -7.0, z: 4.9, w: 0.6, d: 0.45, build: trashPair },
  { id: "s_umbrella", x: -6.9, z: 5.9, w: 0.4, d: 0.4, build: umbrellaStand },
  { id: "s_parcel", x: 7.0, z: 4.4, w: 0.7, d: 0.55, build: parcelStack },
  { id: "s_lost", x: 7.4, z: -3.4, w: 1.0, d: 0.32, build: lostAndFound },
  { id: "s_mat", x: 0.2, z: 4.9, w: 1.6, d: 0.9, passable: true,
    build: () => b(1.6, 0.03, 0.9, "#b8b2a6", 0, 0.015, 0) },
  { id: "s_radiator", x: -3.0, z: -6.3, w: 0.95, d: 0.14, passable: true, build: radiator },
  { id: "s_plantA", x: 6.8, z: -5.6, w: 0.4, d: 0.4, build: plant },
  { id: "s_plantB", x: -6.9, z: 5.4, w: 0.4, d: 0.4, build: plant },
  { id: "s_mop", x: 7.4, z: 5.6, w: 0.3, d: 0.3, build: () => {
      const g = new THREE.Group();
      g.add(cy(0.16, 0.14, 0.3, "#8f9aa3", 0, 0.15, 0, 12));
      g.add(cy(0.02, 0.02, 1.1, "#b98b5e", 0.02, 0.8, 0, 8));
      return g;
    } },

  // 墙面
  { id: "s_board", x: -7.86, z: 2.6, w: 0.1, d: 2.4, interact: { x: -5.6, z: -1.0 }, build: () => {
      const g = new THREE.Group();
      g.add(panel(2.4, 1.3, "#f2f1ec", 0, 1.75, 0, Math.PI / 2));
      g.add(panel(2.4, 0.16, "#2f4a6d", 0, 2.35, 0, Math.PI / 2));
      const cols = ["#ffffff", "#fdf3e3", "#eef4ff", "#fff6ea"];
      for (let i = 0; i < 4; i++) {
        const p = b(0.52, 0.34, 0.03, cols[i], 0.07, 1.95 - Math.floor(i / 2) * 0.5, -0.56 + (i % 2) * 0.58);
        p.rotation.y = Math.PI / 2;
        g.add(p);
      }
      for (let i = 0; i < 6; i++) {
        g.add(ball(0.02, "#b42318", 0.1, 2.02 - i * 0.12, -0.5 + (i % 2) * 1.0));
      }
      return g;
    } },
  { id: "s_roster", x: -7.87, z: 0.9, w: 0.1, d: 1.1, build: () => {
      const g = new THREE.Group();
      g.add(panel(1.1, 0.85, "#fbfaf7", 0, 1.7, 0, Math.PI / 2));
      g.add(panel(1.1, 0.08, "#8a3b30", 0, 2.1, 0, Math.PI / 2));
      for (let r = 0; r < 3; r++) {
        g.add(panel(0.95, 0.02, "#c9c4ba", 0.03, 1.5 + r * 0.18, 0, Math.PI / 2));
      }
      return g;
    } },
  { id: "s_clock", x: 1.0, z: -6.3, w: 0.4, d: 0.1, build: () => {
      const g = new THREE.Group();
      const face = cy(0.22, 0.22, 0.06, "#f7f5ef", 0, 2.2, 0, 20);
      face.rotation.x = Math.PI / 2;
      g.add(face);
      g.add(b(0.02, 0.14, 0.02, "#2b3138", 0, 2.26, 0.04));
      const mn = b(0.02, 0.18, 0.02, "#2b3138", 0.07, 2.2, 0.04);
      mn.rotation.z = -0.6;
      g.add(mn);
      return g;
    } },
  { id: "s_whiteboard", x: -1.2, z: -6.3, w: 1.8, d: 0.08, build: () => {
      const g = new THREE.Group();
      g.add(panel(1.9, 1.1, "#9aa3ad", 0, 1.85, -0.03));
      g.add(panel(1.8, 1.0, "#f7f7f4", 0, 1.85, 0.01));
      g.add(panel(1.82, 0.06, "#8f9aa3", 0, 1.33, 0));
      for (let i = 0; i < 4; i++) {
        g.add(b(0.9 - i * 0.12, 0.03, 0.01, "#3f4a56", -0.3, 2.12 - i * 0.16, 0.04));
      }
      g.add(b(0.12, 0.03, 0.02, "#b42318", -0.5, 1.7, 0.04));
      g.add(b(0.10, 0.03, 0.02, "#2f4a6d", -0.2, 1.6, 0.04));
      return g;
    } },
  { id: "s_posterA", x: 3.2, z: -6.3, w: 0.7, d: 0.06, build: () => poster(0.9, 1.2, "#f6e3bd", "#3f6a47", 0, 1.85, 0) },
  { id: "s_posterB", x: 4.3, z: -6.44, w: 0.7, d: 0.06, build: () => poster(0.9, 1.2, "#cfe0f2", "#2f4a6d", 0, 1.85, 0) },
  { id: "s_calendar", x: 4.4, z: -6.3, w: 0.5, d: 0.05, build: () => poster(0.5, 0.62, "#f2ded8", "#8a3b30", 0, 1.95, 0) },
  { id: "s_box", x: 7.86, z: -2.2, w: 0.1, d: 0.6, build: () => {
      const g = new THREE.Group();
      g.add(panel(0.6, 0.8, "#dfe3e8", 0, 2.3, 0, Math.PI / 2));
      g.add(panel(0.5, 0.05, "#8f9aa3", 0.03, 2.0, 0, Math.PI / 2));
      return g;
    } },
  { id: "s_extinguisher", x: 7.5, z: 3.4, w: 0.26, d: 0.26, build: () => {
      const g = new THREE.Group();
      g.add(cy(0.12, 0.12, 0.5, "#b42318", 0, 0.28, 0, 14));
      g.add(cy(0.04, 0.04, 0.1, "#2b3138", 0, 0.58, 0, 10));
      g.add(b(0.26, 0.05, 0.26, "#8f9aa3", 0, 0.03, 0));
      return g;
    } },
  { id: "s_window", x: -7.86, z: -2.6, w: 0.1, d: 1.6, build: () => {
      const g = new THREE.Group();
      g.add(panel(1.6, 1.2, "#d6e4ee", 0, 1.9, 0, Math.PI / 2));
      g.add(panel(1.7, 0.08, "#b9c1cb", 0, 2.52, 0, Math.PI / 2));
      g.add(panel(1.7, 0.08, "#b9c1cb", 0, 1.28, 0, Math.PI / 2));
      return g;
    } },
  { id: "s_door", x: 7.86, z: 1.2, w: 0.1, d: 1.1, interact: { x: 5.7, z: 1.2 }, build: () => {
      const g = new THREE.Group();
      g.add(b(0.1, 2.2, 1.1, "#a88a68", 0, 1.1, 0));
      g.add(b(0.06, 0.5, 0.85, "#b99a76", 0, 1.6, 0));
      g.add(b(0.06, 0.6, 0.85, "#b99a76", 0, 0.75, 0));
      g.add(ball(0.045, "#e3c98d", -0.07, 1.05, 0.36));
      return g;
    } },
  // 吊顶：沿三面墙一圈 1.2 宽的顶带，灯嵌在里面 —— 单独悬一块灯板会显得"浮着"
  { id: "s_ceilBack", x: 0, z: -5.95, w: 15.8, d: 0.78, passable: true,
    build: () => b(15.8, 0.12, 0.78, "#efeade", 0, 3.06, 0) },
  { id: "s_ceilL", x: -7.55, z: 0, w: 0.78, d: 12.64, passable: true,
    build: () => b(0.78, 0.12, 12.64, "#efeade", 0, 3.06, 0) },
  { id: "s_ceilR", x: 7.55, z: 0, w: 0.78, d: 12.64, passable: true,
    build: () => b(0.78, 0.12, 12.64, "#efeade", 0, 3.06, 0) },
  { id: "s_lampA", x: -2.6, z: -5.95, w: 1.4, d: 0.3, passable: true, build: ceilingLight },
  { id: "s_lampB", x: 2.6, z: -5.95, w: 1.4, d: 0.3, passable: true, build: ceilingLight },
  { id: "s_lampC", x: -7.55, z: 2.4, w: 0.3, d: 1.4, passable: true, build: ceilingLight },
  { id: "s_lampD", x: 7.55, z: -1.6, w: 0.3, d: 1.4, passable: true, build: ceilingLight },

  // 前景遮挡：门口矮柜 + 一株高绿植（比孤立柱子自然，也符合"靠墙"原则）
  { id: "s_lowCab", x: 5.6, z: 5.6, w: 1.4, d: 0.5, build: () => {
      const g = new THREE.Group();
      g.add(b(1.4, 0.06, 0.5, "#c9a17a", 0, 0.55, 0));
      g.add(b(1.34, 0.5, 0.46, "#b08a63", 0, 0.28, 0));
      g.add(b(0.03, 0.16, 0.02, "#6b4f3a", 0, 0.3, 0.24));
      g.add(b(0.22, 0.16, 0.02, "#6b4f3a", 0, 0.3, 0.24));
      g.add(b(0.22, 0.16, 0.02, "#6b4f3a", 0.05, 0.3, 0.24));
      g.add(cy(0.09, 0.09, 0.18, "#dfe6ea", 0, 0.68, 0.1, 12));   // 花瓶
      g.add(ball(0.07, "#d0605c", 0, 0.8, 0.1));
      return g;
    } },
  { id: "s_tallPlant", x: 6.6, z: 6.2, w: 0.5, d: 0.5, build: () => {
      const g = new THREE.Group();
      g.add(cy(0.22, 0.18, 0.5, "#b98b5e", 0, 0.25, 0, 12));
      g.add(cy(0.03, 0.03, 1.1, "#6b8e5e", 0, 0.9, 0, 8));
      g.add(ball(0.34, "#4f7a52", -0.12, 1.35, 0.05));
      g.add(ball(0.28, "#5f8c60", 0.16, 1.5, -0.06));
      g.add(ball(0.2, "#6f9e76", 0.02, 1.66, 0.08));
      return g;
    } },

  // 软隔断：用绿植箱 + 等候小桌把"门厅 / 等候 / 受理"分成三块，
  // 中央空区因此有了边界，不再是"一个大空场"
  { id: "s_divider", x: -1.9, z: 3.4, w: 2.2, d: 0.55, build: () => {
      const g = new THREE.Group();
      g.add(b(2.2, 0.42, 0.55, "#cfc7b8", 0, 0.21, 0));
      g.add(b(2.2, 0.06, 0.6, "#b98b5e", 0, 0.45, 0));
      for (let i = 0; i < 3; i++) {
        g.add(cy(0.14, 0.12, 0.22, "#8a6240", -0.66 + i * 0.66, 0.6, 0, 10));
        g.add(ball(0.17, i % 2 ? "#5b8c63" : "#4f7a52", -0.66 + i * 0.66, 0.82, 0));
      }
      return g;
    } },
  { id: "s_round", x: -3.4, z: 2.9, w: 0.9, d: 0.9, seat: true, facing: 0.3,
    interact: { x: -3.4, z: 3.55 }, build: () => {
      const g = new THREE.Group();
      g.add(cy(0.42, 0.42, 0.05, "#c9a17a", 0, 0.52, 0, 20));
      g.add(cy(0.05, 0.05, 0.5, "#8f7a5e", 0, 0.26, 0, 10));
      g.add(cy(0.24, 0.24, 0.04, "#8f7a5e", 0, 0.02, 0, 16));
      for (const sx of [-1, 1]) {
        g.add(b(0.34, 0.05, 0.3, "#9cc5b4", sx * 0.62, 0.26, 0.1));
        g.add(b(0.34, 0.24, 0.05, "#9cc5b4", sx * 0.62, 0.38, -0.04));
        g.add(b(0.05, 0.26, 0.3, "#8f9aa3", sx * 0.62, 0.13, 0.1));
      }
      g.add(b(0.3, 0.02, 0.22, "#eef4ff", 0, 0.56, 0.06));
      return g;
    } },
  { id: "s_guide", x: 0.8, z: 6.2, w: 0.5, d: 0.3, build: () => {
      const g = new THREE.Group();
      g.add(cy(0.035, 0.035, 1.3, "#8f9aa3", 0, 0.65, 0, 10));
      g.add(b(0.6, 0.9, 0.04, "#2f4a6d", 0, 1.1, 0));
      g.add(b(0.42, 0.06, 0.02, "#f5efe3", 0, 1.32, 0.03));
      g.add(b(0.36, 0.04, 0.02, "#cfe0f2", 0, 1.18, 0.03));
      g.add(b(0.3, 0.04, 0.02, "#f6e3bd", 0, 1.08, 0.03));
      g.add(cy(0.2, 0.2, 0.04, "#8f9aa3", 0, 0.02, 0, 14));
      return g;
    } },

  // 地面小物
  // 房间中部：取号机 + 一米线（派出所的典型陈设，也把空地填起来）
  { id: "s_kiosk", x: -2.6, z: 3.2, w: 0.5, d: 0.4, build: () => {
      const g = new THREE.Group();
      g.add(b(0.5, 0.12, 0.4, "#8f9aa3", 0, 0.06, 0));
      g.add(cy(0.06, 0.06, 1.1, "#b9c1cb", 0, 0.62, 0, 10));
      g.add(b(0.34, 0.26, 0.14, "#2f3946", 0, 1.24, 0));
      g.add(b(0.2, 0.03, 0.02, "#7ac47f", 0, 1.18, 0.08));
      return g;
    } },
  { id: "s_line1", x: -1.9, z: 0.2, w: 0.08, d: 0.08, passable: true, build: () => {
      const g = new THREE.Group();
      g.add(cy(0.04, 0.05, 0.95, "#8f9aa3", 0, 0.48, 0, 10));
      g.add(cy(0.07, 0.07, 0.05, "#5b6672", 0, 0.02, 0, 10));
      g.add(cy(0.05, 0.03, 0.08, "#5b6672", 0, 0.98, 0, 10));
      return g;
    } },
  { id: "s_line2", x: 3.0, z: 0.2, w: 0.08, d: 0.08, passable: true, build: () => {
      const g = new THREE.Group();
      g.add(cy(0.04, 0.05, 0.95, "#8f9aa3", 0, 0.48, 0, 10));
      g.add(cy(0.07, 0.07, 0.05, "#5b6672", 0, 0.02, 0, 10));
      g.add(cy(0.05, 0.03, 0.08, "#5b6672", 0, 0.98, 0, 10));
      return g;
    } },
  { id: "s_line3", x: 0.4, z: 0.2, w: 4.2, d: 0.03, passable: true,
    build: () => b(4.2, 0.012, 0.02, "#4b5563", 0.4, 0.72, 0) },

  // 报刊架（靠左墙）、X 展架（取号机旁）、儿童等候角（左侧空地）
  { id: "s_rack", x: -6.4, z: 0.9, w: 0.7, d: 0.4, build: () => {
      const g = new THREE.Group();
      g.add(b(0.7, 0.05, 0.4, "#8f7a5e", 0, 0.02, 0));
      for (let i = 0; i < 3; i++) {
        const shelf = b(0.66, 0.04, 0.3, "#b98b5e", 0, 0.42 + i * 0.34, 0);
        shelf.rotation.x = -0.18;
        g.add(shelf);
        for (let k = 0; k < 3; k++) {
          const mg = b(0.16, 0.22, 0.02, ["#eef4ff", "#fdf3e3", "#f2efe8"][k], -0.2 + k * 0.2, 0.56 + i * 0.34, 0.06);
          mg.rotation.x = -0.18;
          g.add(mg);
        }
      }
      return g;
    } },
  { id: "s_kidTable", x: -4.6, z: 5.2, w: 0.8, d: 0.5, build: () => {
      const g = new THREE.Group();
      g.add(b(0.8, 0.06, 0.5, "#c9a17a", 0, 0.42, 0));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        g.add(b(0.06, 0.42, 0.06, "#8f7a5e", sx * 0.33, 0.21, sz * 0.18));
      }
      g.add(b(0.22, 0.02, 0.16, "#eef4ff", -0.12, 0.46, 0.02));  // 一本画册
      g.add(b(0.1, 0.06, 0.1, "#d0605c", 0.16, 0.48, -0.06));    // 一个小玩具
      for (const sx of [-1, 1]) {
        g.add(b(0.26, 0.05, 0.26, "#9cc5b4", sx * 0.62, 0.26, 0.05));
        g.add(b(0.26, 0.22, 0.05, "#9cc5b4", sx * 0.62, 0.38, -0.08));
      }
      return g;
    } },

  { id: "s_paper1", x: -1.8, z: 3.1, w: 0.2, d: 0.2, passable: true,
    build: () => b(0.18, 0.004, 0.14, "#fbfaf7", 0, 0.012, 0) },
  { id: "s_paper2", x: 4.4, z: 1.6, w: 0.2, d: 0.2, passable: true,
    build: () => b(0.14, 0.004, 0.18, "#f2efe8", 0, 0.012, 0) },
  { id: "s_cable", x: -6.2, z: -4.4, w: 1.6, d: 0.06, passable: true,
    build: () => b(1.6, 0.02, 0.05, "#2b3138", 0, 0.02, 0) }
];

const obstacles = props.filter((p) => !p.passable).map((p) => ({ x: p.x, z: p.z, w: p.w, d: p.d }));
obstacles.push({ x: 0, z: -6.5, w: 16, d: 0.4 });
obstacles.push({ x: -8, z: 0, w: 0.4, d: 13 });
obstacles.push({ x: 8, z: 0, w: 0.4, d: 13 });

// 氛围人物：不交互，只让屋子像"有人"
const characters = [
  { id: "amb_wait", label: "等人的老太太", x: -6.4, z: 2.25, facing: 1.5, pose: "sit",
    scale: 0.94, color: "#a89c86", pants: "#5c574d", hair: "#e6e0d4", ambient: true },
  { id: "amb_caller", label: "打电话的年轻人", x: 6.4, z: 2.4, facing: -1.6, pose: "stand",
    color: "#6b7684", pants: "#3b4552", ambient: true }
];

let scene;
try {
scene = createScene({
  mount: document.getElementById("stage"),
  room,
  props,
  obstacles,
  characters,
  lamps: [
    { x: -2.5, z: -3.2, intensity: 1.8 },
    { x: 2.5, z: -3.2, intensity: 1.8 },
    { x: 0.0, z: 2.4, intensity: 1.5 }
  ],
  actor: { x: 0.8, z: 4.6 },
  onSpot: (p) => { (window.__events = window.__events || []).push(["spot", p.id]); },
  onPerson: (p) => { (window.__events = window.__events || []).push(["person", p.id]); },
  onArrived: (p) => { (window.__events = window.__events || []).push(["arrived", +p.x.toFixed(2), +p.z.toFixed(2)]); },
  onSeat: (p) => { (window.__events = window.__events || []).push(["seat", p.id]); }
});
} catch (err) {
  window.__err = String((err && err.stack) || err);
}

window.__mini = scene;

window.addEventListener("message", (ev) => {
  const d = ev.data || {};
  if (d.type === "actor:move" && d.payload) { scene.walkTo(d.payload.x, d.payload.z); }
  if (d.type === "actor:teleport" && d.payload) { scene.setActor(d.payload.x, d.payload.z); }
  if (d.type === "spot:goto" && d.payload) { scene.goToProp(d.payload.id); }
});

if (window.parent !== window) {
  window.parent.postMessage({ source: "mini3d", type: "scene:ready", payload: {} }, "*");
}
