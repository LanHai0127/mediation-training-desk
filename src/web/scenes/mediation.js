// S1 · 派出所调解室（下午 15:20）—— 两案共用的终点
// -----------------------------------------------------------------------------
// 按 docs/场景与人物建模提示词.md v5 §3 S1 重做（2026-11-04，质量第一）。
// 七段结构一一对应：画面风格 / 底座与构图 / 时间与氛围 / 外观 / 陈设 / 基础动效 / 避免。
//   ① 颜色只用 kit 的 PAL 那 15 个，本文件里没有任何一个十六进制色值；
//   ② 大件描边由 kit.b 自动加（最大边 > 0.55）；
//   ③ 没有一张噪点贴图：地面、墙面、桌面、柜面全部纯色 + 几何分格；
//   ④ 四格分区：西北档案柜×2+饮水机 / 东北百叶窗+绿萝挂篮+吸音板 /
//                西南等候长椅+折叠椅×3+灭火器+雨伞架 / 东南调解桌+记录椅+门；
//   ⑤ 视觉中心 3.4×1.4 调解桌，次中心后墙百叶窗 + 地上 9 条暖光；
//   ⑥ onFrame 里 10 条 2% 量级的循环动效（光条缓移 / 纱帘 / 秒针 / 水面 /
//      纸角 / 外套 / 吊灯呼吸 / 气泡 / 绿萝 / 计时器）。
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
  sec: null, minute: null,
  curtain: [], stripes: null, water: null, paperCorner: null, coat: null,
  lamp: [], bubbles: [], vines: [], led: null
};

// ---------------------------------------------------------------- 纸、板
// 纸：0.004 厚的一片（b 里 min < 0.055 会自动走直角盒，不浪费圆角）
function paper(w, d, color, x, y, z, ry = 0) {
  const m = b(w, 0.004, d, color, x, y, z);
  m.rotation.y = ry;
  return m;
}
// 挂墙板：外框 + 面板，两层错开 0.02 制造"有厚度"的阴影线
function wallBoard(w, h, face, frame) {
  const g = new THREE.Group();
  g.add(b(w + 0.08, h + 0.08, 0.04, frame, 0, 0, 0));
  g.add(b(w, h, 0.05, face, 0, 0, 0.022));
  return g;
}
// 贴地薄片（磨痕、投影、光斑）：不写深度，纯色
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

// ---------------------------------------------------------------- 灯
// 线灯：吊在吊顶带下面（室内没有顶板，直接挂一盏"看得见"的灯是唯一的办法）
function linearLight(len) {
  const g = new THREE.Group();
  g.add(b(len, 0.06, 0.17, C.white, 0, 2.795, 0));
  g.add(b(len - 0.08, 0.022, 0.13, C.cream, 0, 2.758, 0));
  const glow = new THREE.Mesh(new THREE.BoxGeometry(len - 0.14, 0.016, 0.1),
    M(C.yellow, { emissive: C.yellow, emissiveIntensity: 1.25 }));
  glow.position.set(0, 2.742, 0);
  g.add(glow);
  A.lamp.push({ m: glow, base: 1.25 });
  for (const sx of [-1, 1]) {
    g.add(cy(0.012, 0.012, 0.1, C.road, sx * (len / 2 - 0.15), 2.845, 0, 6));
  }
  return g;
}

// ---------------------------------------------------------------- 柜、饮水机
function cabinet() {                                   // 铁皮档案柜：四抽 + 标签条
  const g = new THREE.Group();
  g.add(b(1.0, 1.5, 0.52, C.road, 0, 0.79, 0));
  g.add(b(1.05, 0.05, 0.57, C.dark, 0, 1.555, 0));      // 顶板
  g.add(b(0.96, 0.07, 0.48, C.dark, 0, 0.035, 0));      // 底座
  for (let r = 0; r < 4; r++) {
    const y = 1.29 - r * 0.315;
    g.add(b(0.9, 0.275, 0.05, C.blue, 0, y, 0.265));             // 抽屉面
    g.add(b(0.9, 0.02, 0.06, C.ink, 0, y - 0.15, 0.262));        // 抽屉缝
    g.add(b(0.26, 0.048, 0.02, C.white, -0.26, y + 0.06, 0.292)); // 手写标签条
    g.add(b(0.2, 0.026, 0.022, C.dark, 0.25, y, 0.298));          // 拉手
  }
  return g;
}

function waterCooler() {
  const g = new THREE.Group();
  g.add(b(0.4, 0.02, 0.4, C.road, 0, 0.012, 0));
  g.add(b(0.38, 0.88, 0.38, C.white, 0, 0.46, 0));
  g.add(b(0.42, 0.05, 0.42, C.blue, 0, 0.925, 0));               // 台面
  g.add(b(0.34, 0.05, 0.06, C.glass, 0, 0.87, 0.19));            // 接水格
  g.add(b(0.3, 0.02, 0.16, C.road, 0, 0.845, 0.16));             // 接水盘
  const bottle = cy(0.165, 0.165, 0.44, C.glass, 0, 1.2, 0, 16); // 水桶（半满）
  g.add(bottle);
  g.add(cy(0.155, 0.155, 0.2, C.blue, 0, 1.09, 0, 16));          // 桶里半桶水
  for (const sx of [-1, 1]) {                                    // 两个龙头
    g.add(cy(0.022, 0.022, 0.07, C.blue, sx * 0.08, 0.83, 0.21, 8));
    g.add(b(0.04, 0.02, 0.05, C.dark, sx * 0.08, 0.865, 0.2));
  }
  for (let i = 0; i < 3; i++) {                                  // 桶里的小气泡
    const bub = ball(0.014, C.white, 0.04 - i * 0.035, 1.0 + i * 0.06, 0.03, 6);
    bub.material.transparent = true;
    bub.material.opacity = 0.75;
    g.add(bub);
    A.bubbles.push({ o: bub, x: 0.04 - i * 0.035, z: 0.03, ph: i * 0.33 });
  }
  return g;
}

// ---------------------------------------------------------------- 窗
// 百叶窗 2.6×1.5：亮窗芯 + 13 片斜百叶 + 帘头 + 拉绳 + 木窗台 + 5 只纸杯
function windowWall() {
  const g = new THREE.Group();
  g.add(b(2.72, 1.62, 0.08, C.cream, 0, 1.8, 0));                 // 窗套
  g.add(b(2.56, 1.46, 0.04, C.sand, 0, 1.8, 0.03));               // 窗洞底
  // 窗芯是暖的：百叶缝里透出来的必须是"下午三点二十"的黄，不是白
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.4),
    M(C.yellow, { emissive: C.yellow, emissiveIntensity: 1.5 }));
  pane.position.set(0, 1.8, 0.055);
  g.add(pane);
  for (let i = 0; i < 12; i++) {                                  // 百叶
    const slat = b(2.52, 0.062, 0.03, C.sand, 0, 1.1 + i * 0.122, 0.085);
    slat.rotation.x = -0.52;
    g.add(slat);
  }
  g.add(b(2.56, 0.11, 0.1, C.cream, 0, 2.56, 0.075));             // 帘头
  g.add(b(2.56, 0.06, 0.07, C.cream, 0, 1.14, 0.09));             // 下轨
  g.add(cy(0.008, 0.008, 1.3, C.road, 2.36, 1.8, 0.12, 4));       // 拉绳
  g.add(b(2.86, 0.06, 0.2, C.white, 0, 1.02, 0.07));              // 窗台
  g.add(b(2.86, 0.03, 0.24, C.cream, 0, 0.985, 0.09));
  for (let i = 0; i < 5; i++) {                                   // 窗台上一排纸杯
    const x = -0.86 + i * 0.43;
    g.add(cy(0.042, 0.032, 0.09, C.white, x, 1.095, 0.07, 10));
    g.add(cy(0.044, 0.044, 0.01, C.cream, x, 1.14, 0.07, 10));
  }
  const rod = cy(0.016, 0.016, 2.98, C.road, 0, 2.7, 0.16, 8);   // 窗帘杆
  rod.rotation.z = Math.PI / 2;
  g.add(rod);
  return g;
}

// 纱帘：一片半透的布，绕杆摆
function sheerCurtain(w, h) {
  const g = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.62, h),
      M(C.white, { transparent: true, opacity: 0.34, side: THREE.DoubleSide }));
    cloth.position.set((i - 0.5) * w * 0.28, -h / 2, i * 0.012);
    cloth.rotation.y = i ? 0.08 : -0.06;
    g.add(cloth);
  }
  g.add(cy(0.006, 0.006, 0.02, C.road, 0, -0.01, 0, 5));           // 挂环
  A.curtain.push(g);
  return g;
}

// ---------------------------------------------------------------- 墙面小件
function acoustic(w, h) {                                // 吸音板：2×2 四块布面方板
  const g = new THREE.Group();
  const cw = w / 2 - 0.012, ch = h / 2 - 0.012;
  g.add(b(w + 0.04, h + 0.04, 0.04, C.road, 0, 0, 0));   // 一圈窄边
  for (let i = 0; i < 4; i++) {
    const x = (i % 2 ? 1 : -1) * (w / 4);
    const y = (i < 2 ? 1 : -1) * (h / 4);
    g.add(b(cw, ch, 0.06, C.cream, x, y, 0.012));
    g.add(b(cw - 0.03, ch - 0.03, 0.02, C.sand, x, y, 0.03));
    for (let k = 0; k < 3; k++) {                         // 布面上的三道细槽
      g.add(b(cw - 0.06, 0.008, 0.012, C.white, x, y + 0.16 - k * 0.16, 0.048));
    }
  }
  return g;
}

function hangPlant() {                                   // 绿萝挂篮（吊在吊顶带下面）
  const g = new THREE.Group();
  for (const sx of [-0.13, 0.13]) {                      // 两根吊绳通到吊顶带底面 2.88
    g.add(cy(0.006, 0.006, 0.46, C.road, sx, 2.65, 0, 4));
  }
  g.add(cy(0.15, 0.11, 0.15, C.wood, 0, 2.36, 0, 12));   // 吊盆
  g.add(cy(0.155, 0.155, 0.022, C.sand, 0, 2.29, 0, 12)); // 盆沿
  for (let i = 0; i < 7; i++) {                          // 叶丛
    const a = i * 0.9;
    const leaf = ball(0.082, i % 2 ? C.mint : C.sea,
      Math.cos(a) * 0.12, 2.42 + (i % 3) * 0.025, Math.sin(a) * 0.09, 8);
    leaf.scale.set(1, 0.5, 1.25);
    g.add(leaf);
  }
  for (let i = 0; i < 3; i++) {                          // 垂下来的枝：粗一点、带三片小叶
    const a = -1.1 + i * 1.1;
    const x0 = Math.cos(a) * 0.13, z0 = Math.sin(a) * 0.08;
    const v = cy(0.012, 0.009, 0.42, C.sea, x0, 2.08, z0, 5);
    v.rotation.z = Math.cos(a) * 0.08;
    v.rotation.x = -Math.sin(a) * 0.08;
    g.add(v);
    for (let k = 0; k < 3; k++) {
      const lf = ball(0.045, k % 2 ? C.mint : C.sea,
        x0 + Math.cos(a) * 0.035, 2.23 - k * 0.14, z0, 6);
      lf.scale.set(1.5, 0.5, 1);
      g.add(lf);
    }
    A.vines.push(v);
  }
  return g;
}

function banner() {                                      // 锦旗：抽象面料，无真实单位
  const g = new THREE.Group();
  g.add(cy(0.018, 0.018, 0.9, C.wood, 0, 2.58, 0, 8));
  g.children[0].rotation.z = Math.PI / 2;
  for (const sx of [-1, 1]) { g.add(ball(0.032, C.wood, sx * 0.46, 2.58, 0, 8)); }
  g.add(b(0.86, 0.98, 0.022, C.coral, 0, 2.06, 0.03));   // 旗面
  for (const sx of [-1, 1]) {                            // 两侧金边
    g.add(b(0.024, 0.98, 0.026, C.yellow, sx * 0.42, 2.06, 0.036));
  }
  g.add(b(0.86, 0.024, 0.026, C.yellow, 0, 2.545, 0.036));
  for (let i = 0; i < 4; i++) {                          // 四道抽象"字"痕
    const y = 2.34 - i * 0.19;
    g.add(b(0.3, 0.016, 0.012, C.yellow, -0.02, y, 0.046));
    g.add(b(0.11, 0.016, 0.012, C.yellow, 0.14, y - 0.045, 0.046));
    g.add(b(0.05, 0.05, 0.012, C.yellow, -0.14, y - 0.02, 0.046));
  }
  for (let i = 0; i < 7; i++) {                          // 底穗
    g.add(cy(0.006, 0.006, 0.11, C.yellow, -0.36 + i * 0.12, 1.53, 0.036, 4));
  }
  g.add(cy(0.006, 0.006, 0.26, C.road, 0, 2.73, 0.02, 4)); // 挂绳
  return g;
}

function flowBoard() {                                   // 流程牌：四步抽象箭头
  const g = wallBoard(1.32, 1.02, C.white, C.blue);
  g.add(b(0.82, 0.075, 0.014, C.ink, 0, 0.36, 0.058));   // 标题条
  for (let i = 0; i < 4; i++) {
    const x = -0.45 + i * 0.3;
    g.add(b(0.2, 0.2, 0.014, i === 0 ? C.coral : C.blue, x, 0.05, 0.058));
    const num = cy(0.055, 0.055, 0.016, C.white, x, 0.05, 0.072, 12);
    num.rotation.x = Math.PI / 2;
    g.add(num);
    g.add(b(0.2, 0.03, 0.014, C.ink, x, -0.13, 0.058));
    g.add(b(0.14, 0.022, 0.014, C.road, x, -0.2, 0.058));
    if (i < 3) {                                          // 箭头
      g.add(b(0.06, 0.028, 0.014, C.ink, x + 0.15, 0.05, 0.058));
      const tip = b(0.045, 0.045, 0.014, C.ink, x + 0.185, 0.05, 0.058);
      tip.rotation.z = Math.PI / 4;
      g.add(tip);
    }
  }
  for (let i = 0; i < 3; i++) {                           // 底部说明三行
    g.add(b(0.86 - i * 0.13, 0.022, 0.014, C.road, -0.06, -0.3 - i * 0.06, 0.058));
  }
  return g;
}

function dutyBoard() {                                   // 权利义务牌：两栏并排
  const g = wallBoard(1.32, 1.02, C.white, C.blue);
  g.add(b(0.86, 0.075, 0.014, C.ink, 0, 0.36, 0.058));
  g.add(b(0.016, 0.74, 0.014, C.glass, 0, -0.02, 0.058));  // 中缝
  for (let col = 0; col < 2; col++) {
    const cx = col ? 0.32 : -0.32;
    g.add(b(0.2, 0.05, 0.014, col ? C.blue : C.coral, cx, 0.24, 0.058));
    for (let i = 0; i < 4; i++) {
      g.add(b(0.42, 0.024, 0.014, C.ink, cx, 0.13 - i * 0.13, 0.058));
      g.add(b(0.26, 0.018, 0.014, C.road, cx + 0.06, 0.09 - i * 0.13, 0.058));
    }
  }
  return g;
}

function photoWall() {                                   // 照片墙 4 张（右墙，2×2）
  const g = new THREE.Group();
  const cols = [C.glass, C.sand, C.blue, C.mint];
  for (let i = 0; i < 4; i++) {
    const x = i % 2 ? 0.31 : -0.31;                      // 局部 x → 世界 z
    const y = i < 2 ? 0.25 : -0.25;
    g.add(b(0.4, 0.46, 0.035, C.blue, x, y, 0));
    g.add(b(0.34, 0.4, 0.04, C.white, x, y, 0.022));
    g.add(b(0.26, 0.3, 0.012, cols[i], x, y, 0.048));    // 抽象照片
    if (i === 0) {                                        // 合影：四个小人影
      for (let k = 0; k < 4; k++) {
        g.add(b(0.03, 0.08, 0.008, C.ink, x - 0.08 + k * 0.055, y - 0.05, 0.056));
      }
    } else if (i === 1) {                                 // 证书：三行字
      for (let k = 0; k < 3; k++) {
        g.add(b(0.17 - k * 0.03, 0.016, 0.008, C.ink, x, y + 0.06 - k * 0.05, 0.056));
      }
    } else if (i === 2) {                                 // 培训：一排桌
      g.add(b(0.2, 0.05, 0.008, C.cream, x, y - 0.06, 0.056));
    } else {                                              // 院落：一道横线
      g.add(b(0.2, 0.012, 0.008, C.cream, x, y + 0.02, 0.056));
    }
  }
  return g;
}

function wallClock() {                                   // 挂钟（右墙，局部朝 +z，外面转 -90°）
  const g = new THREE.Group();
  g.add(cy(0.21, 0.21, 0.045, C.blue, 0, 0, 0, 24));
  const dial = cy(0.185, 0.185, 0.02, C.white, 0, 0, 0.03, 24);
  dial.rotation.x = Math.PI / 2;
  g.add(dial);
  g.children[0].rotation.x = Math.PI / 2;
  for (let i = 0; i < 12; i++) {                          // 12 个刻度
    const a = (i / 12) * Math.PI * 2;
    g.add(b(0.012, i % 3 ? 0.022 : 0.038, 0.01, C.road,
      Math.cos(a) * 0.145, Math.sin(a) * 0.145, 0.042));
  }
  const mh = new THREE.Group();                           // 分针
  const mb = b(0.016, 0.13, 0.008, C.ink, 0, 0.065, 0.05);
  mh.add(mb);
  const sh = new THREE.Group();                           // 秒针
  const sb = b(0.008, 0.16, 0.006, C.coral, 0, 0.075, 0.056);
  sh.add(sb);
  g.add(mh, sh);
  A.minute = mh; A.sec = sh;
  return g;
}

// ---------------------------------------------------------------- 门
function doorWay() {
  const g = new THREE.Group();
  g.add(b(1.24, 2.34, 0.12, C.cream, 0, 1.16, 0));              // 门套
  g.add(b(1.06, 2.2, 0.1, C.road, 0, 1.09, 0.005));             // 门套内框
  g.add(b(1.0, 2.12, 0.05, C.wood, 0, 1.06, 0.075));            // 门扇
  g.add(b(0.74, 0.66, 0.03, C.sand, 0, 1.62, 0.1));             // 上凹板
  g.add(b(0.74, 0.5, 0.03, C.sand, 0, 0.62, 0.1));              // 下凹板
  g.add(b(0.68, 0.6, 0.014, C.wood, 0, 1.62, 0.108));
  g.add(b(0.68, 0.44, 0.014, C.wood, 0, 0.62, 0.108));
  g.add(cy(0.035, 0.035, 0.03, C.yellow, 0.38, 1.02, 0.11, 10)); // 锁座
  const lever = b(0.03, 0.03, 0.16, C.yellow, 0.38, 1.02, 0.18);
  g.add(lever);
  g.add(b(0.32, 0.12, 0.016, C.navy, 0, 1.76, 0.1));             // 无字门牌
  g.add(b(0.24, 0.03, 0.012, C.cream, 0, 1.76, 0.112));
  g.add(cy(0.014, 0.014, 0.1, C.road, -0.22, 1.62, 0.14, 6));    // 挂钩

  const coat = new THREE.Group();                                 // 门后挂着的外套
  coat.position.set(-0.22, 1.62, 0.17);
  coat.add(b(0.42, 0.09, 0.13, C.dark, 0, -0.02, 0));             // 肩
  coat.add(b(0.36, 0.3, 0.115, C.dark, 0, -0.2, 0));              // 上身
  coat.add(b(0.33, 0.32, 0.105, C.dark, 0, -0.5, 0));             // 下摆
  coat.add(b(0.13, 0.1, 0.14, C.ink, 0, 0.005, 0.01));            // 翻领
  for (const sx of [-1, 1]) {                                     // 两条垂下来的袖子
    const sl = b(0.1, 0.44, 0.1, C.dark, sx * 0.235, -0.28, 0.005);
    sl.rotation.z = sx * 0.09;
    coat.add(sl);
  }
  coat.add(b(0.28, 0.02, 0.12, C.road, 0, -0.26, 0.05));          // 口袋线
  coat.add(b(0.3, 0.02, 0.11, C.road, 0, -0.62, 0.05));
  g.add(coat);
  A.coat = coat;
  return g;
}

// ---------------------------------------------------------------- 桌椅
function tentCard(w, h) {                                // 空白桌牌（人字）
  const g = new THREE.Group();
  const f = b(w, h, 0.008, C.white, 0, h / 2, 0.035);
  f.rotation.x = -0.22;
  const k = b(w, h, 0.008, C.white, 0, h / 2, -0.035);
  k.rotation.x = 0.22;
  g.add(f, k);
  g.add(b(w * 0.78, 0.008, 0.012, C.road, 0, h * 0.32, 0.046));
  return g;
}

function cup(x, y, z, used) {                            // 一次性纸杯
  const g = new THREE.Group();
  g.add(cy(0.044, 0.032, 0.095, C.white, 0, 0.0475, 0, 12));
  g.add(cy(0.046, 0.046, 0.012, C.cream, 0, 0.093, 0, 12));
  if (used) {
    const w = new THREE.Mesh(new THREE.CircleGeometry(0.036, 12),
      new THREE.MeshBasicMaterial({ color: C.glass, transparent: true, opacity: 0.8 }));
    w.rotation.x = -Math.PI / 2;
    w.position.set(0, 0.062, 0);
    g.add(w);
    A.water = w;
  }
  g.position.set(x, y, z);
  return g;
}

function mediationTable() {                              // 3.4×1.4 长方调解桌（视觉中心）
  const g = new THREE.Group();
  g.add(b(3.4, 0.09, 1.4, C.wood, 0, 0.735, 0));          // 桌面（上表面 0.78）
  g.add(b(3.46, 0.045, 1.46, C.wood, 0, 0.687, 0));       // 台沿
  g.add(b(3.16, 0.13, 1.16, C.wood, 0, 0.6, 0));          // 桌裙
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {   // 四条腿 + 脚垫
    g.add(b(0.15, 0.62, 0.15, C.wood, sx * 1.52, 0.31, sz * 0.5));
    g.add(b(0.2, 0.025, 0.2, C.dark, sx * 1.52, 0.012, sz * 0.5));
  }
  g.add(b(2.9, 0.08, 0.08, C.wood, 0, 0.16, 0.5));        // 横撑
  g.add(b(2.9, 0.08, 0.08, C.wood, 0, 0.16, -0.5));
  g.add(b(0.08, 0.08, 0.9, C.wood, 1.52, 0.16, 0));
  g.add(b(0.08, 0.08, 0.9, C.wood, -1.52, 0.16, 0));
  g.add(b(0.5, 0.05, 0.2, C.road, -0.9, 0.6, 0.54));      // 桌下的小托盘

  // ---- 桌面陈设：沿四周排，中间 x -0.4~0.6 / z -1.1~-0.5 留空
  const Y = 0.78;
  const cardA = tentCard(0.4, 0.15);                      // 两块空白桌牌，微微朝内
  cardA.position.set(-1.32, Y, -0.36); cardA.rotation.y = 0.16;
  const cardB = tentCard(0.4, 0.15);
  cardB.position.set(1.28, Y, -1.46); cardB.rotation.y = Math.PI + 0.16;
  g.add(cardA, cardB);

  const stack = new THREE.Group();                        // 一叠调解申请书
  stack.position.set(-0.98, Y, -1.42); stack.rotation.y = 0.1;
  for (let i = 0; i < 6; i++) {
    stack.add(paper(0.3, 0.42, i === 5 ? C.cream : C.white,
      (i % 3 - 1) * 0.006, 0.002 + i * 0.0035, (i % 2) * 0.008, (i % 3) * 0.014));
  }
  const pg = new THREE.Group();                           // 最上一张：边角可起伏
  pg.position.set(-0.15, 0.025, -0.21);
  pg.add(b(0.3, 0.004, 0.42, C.white, 0.15, 0, 0.21));
  pg.add(b(0.2, 0.003, 0.014, C.ink, 0.16, 0.006, 0.1));
  pg.add(b(0.16, 0.003, 0.014, C.ink, 0.16, 0.006, 0.17));
  const stamp = cy(0.045, 0.045, 0.003, C.coral, 0.22, 0.007, 0.3, 14);
  pg.add(stamp);
  stack.add(pg);
  A.paperCorner = pg;
  g.add(stack);

  for (let i = 0; i < 3; i++) {                           // 三支散笔
    const pen = cy(0.011, 0.011, 0.19, [C.ink, C.navy, C.coral][i],
      [-0.52, 0.22, 0.46][i], Y + 0.012, [-0.92, -1.18, -0.36][i], 6);
    pen.rotation.z = Math.PI / 2;
    pen.rotation.y = [0.5, -0.32, 1.25][i];
    g.add(pen);
    g.add(b(0.05, 0.016, 0.016, C.road,
      [-0.52, 0.22, 0.46][i] + 0.06, Y + 0.012, [-0.92, -1.18, -0.36][i] + 0.02));
  }

  g.add(cy(0.068, 0.068, 0.038, C.coral, 0.06, Y + 0.019, -1.44, 14));   // 印泥盒
  const lid = cy(0.072, 0.072, 0.012, C.coral, 0.13, Y + 0.052, -1.36, 14);  // 盒盖斜放
  lid.rotation.z = 0.35;
  g.add(lid);

  const tissue = new THREE.Group();                       // 纸巾盒 + 抽出来的一角
  tissue.position.set(1.06, Y, -0.42);
  tissue.add(b(0.24, 0.085, 0.13, C.white, 0, 0.042, 0));
  tissue.add(b(0.06, 0.02, 0.14, C.cream, 0, 0.088, 0));
  const tf = b(0.08, 0.09, 0.02, C.white, 0.01, 0.13, 0);
  tf.rotation.z = 0.3;
  tissue.add(tf);
  g.add(tissue);

  g.add(cup(-1.36, Y, -0.52, true));                      // 三只纸杯（两只用过）
  g.add(cup(-1.1, Y, -0.74, true));
  g.add(cup(-0.84, Y, -0.5, false));

  const cradle = new THREE.Group();                       // 木托 + 小木槌（无徽标）
  cradle.position.set(0.92, Y, -1.42); cradle.rotation.y = -0.12;
  cradle.add(b(0.26, 0.045, 0.16, C.wood, 0, 0.022, 0));
  cradle.add(b(0.26, 0.03, 0.016, C.wood, 0, 0.055, 0.075));
  cradle.add(b(0.26, 0.03, 0.016, C.wood, 0, 0.055, -0.075));
  const head = cy(0.042, 0.042, 0.14, C.wood, 0, 0.088, 0, 12);
  head.rotation.x = Math.PI / 2;
  cradle.add(head);
  const grip = cy(0.012, 0.012, 0.24, C.wood, 0.1, 0.088, 0, 6);
  grip.rotation.z = Math.PI / 2;
  cradle.add(grip);
  g.add(cradle);

  const timer = new THREE.Group();                        // 计时器
  timer.position.set(-0.36, Y, -0.3); timer.rotation.y = 0.22;
  timer.add(b(0.14, 0.07, 0.11, C.dark, 0, 0.035, 0));
  timer.add(b(0.09, 0.045, 0.012, C.cream, 0, 0.038, 0.058));
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.014, 0.008),
    M(C.mint, { emissive: C.mint, emissiveIntensity: 1.2 }));
  led.position.set(0.045, 0.012, 0.058);
  timer.add(led);
  A.led = led;
  timer.add(b(0.09, 0.018, 0.03, C.road, 0, 0.02, -0.02));
  g.add(timer);

  const book = new THREE.Group();                         // 翻到中间的一本记事本
  book.position.set(0.36, Y, -0.52); book.rotation.y = -0.2;
  book.add(b(0.42, 0.012, 0.28, C.road, 0, 0.006, 0));
  const left = b(0.2, 0.006, 0.27, C.white, -0.1, 0.014, 0);
  const right = b(0.2, 0.006, 0.27, C.white, 0.1, 0.014, 0);
  left.rotation.z = 0.03; right.rotation.z = -0.03;
  book.add(left, right);
  for (let i = 0; i < 5; i++) {
    book.add(b(0.16, 0.003, 0.008, C.road, -0.1, 0.019, -0.09 + i * 0.045));
    book.add(b(0.14, 0.003, 0.008, C.road, 0.1, 0.019, -0.09 + i * 0.045));
  }
  const bp = cy(0.009, 0.009, 0.17, C.ink, 0.12, 0.03, 0.02, 6);
  bp.rotation.z = Math.PI / 2; bp.rotation.y = 0.5;
  book.add(bp);
  g.add(book);
  return g;
}

function longBench(w) {                                  // 2.6 米长条椅：座面 0.45，靠背在 +z
  const g = new THREE.Group();
  g.add(b(w, 0.09, 0.46, C.navy, 0, 0.405, 0));          // 座板（上表面 0.45）
  g.add(b(w, 0.4, 0.075, C.navy, 0, 0.66, 0.225));       // 靠背
  g.add(b(w - 0.1, 0.02, 0.085, C.blue, 0, 0.55, 0.227)); // 靠背下沿压条
  for (const sx of [-1, 1]) {                             // 两端侧板
    g.add(b(0.075, 0.45, 0.46, C.road, sx * (w / 2 - 0.06), 0.225, 0));
    g.add(b(0.09, 0.09, 0.5, C.road, sx * (w / 2 - 0.06), 0.42, 0.01));
  }
  g.add(b(w - 0.3, 0.06, 0.06, C.road, 0, 0.13, 0));      // 横撑
  g.add(b(0.05, 0.4, 0.42, C.road, 0, 0.24, 0.02));
  for (let i = 0; i < 3; i++) {                            // 座面上的三道坐痕
    g.add(b(w - 0.4, 0.008, 0.02, C.dark, 0, 0.452, -0.08 + i * 0.09));
  }
  return g;
}

function recordChair() {                                 // 记录椅（比长条椅矮一档，座面 0.42）
  const g = new THREE.Group();
  g.add(b(0.54, 0.08, 0.5, C.navy, 0, 0.38, 0));
  g.add(b(0.54, 0.46, 0.07, C.navy, 0, 0.66, -0.215));
  g.add(b(0.48, 0.02, 0.08, C.blue, 0, 0.45, -0.212));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(b(0.055, 0.36, 0.055, C.road, sx * 0.21, 0.18, sz * 0.19));
  }
  g.add(b(0.4, 0.045, 0.045, C.road, 0, 0.09, 0));
  return g;
}

function waitBench() {                                   // 等候长椅（带扶手，沿左墙放）
  const g = new THREE.Group();
  g.add(b(1.8, 0.08, 0.46, C.navy, 0, 0.41, 0));
  g.add(b(1.8, 0.36, 0.07, C.navy, 0, 0.63, 0.225));
  g.add(b(1.7, 0.018, 0.08, C.blue, 0, 0.53, 0.227));
  for (const sx of [-1, 1]) {
    g.add(b(0.07, 0.42, 0.46, C.road, sx * 0.83, 0.22, 0));
    g.add(b(0.06, 0.06, 0.44, C.blue, sx * 0.83, 0.47, 0.02));   // 磨亮的扶手
    g.add(b(0.07, 0.24, 0.07, C.road, sx * 0.83, 0.56, 0.16));
  }
  g.add(b(1.5, 0.06, 0.06, C.road, 0, 0.13, 0));
  return g;
}

function foldChair() {                                   // 折叠椅（收起来靠墙）
  const g = new THREE.Group();
  g.add(b(0.4, 0.045, 0.42, C.blue, 0, 0.62, 0));        // 座面
  g.add(b(0.4, 0.4, 0.04, C.blue, 0, 0.88, -0.19));      // 靠背
  for (const sx of [-1, 1]) {
    g.add(b(0.035, 0.6, 0.035, C.road, sx * 0.17, 0.32, 0.17));
    g.add(b(0.035, 0.55, 0.035, C.road, sx * 0.17, 0.28, -0.16));
  }
  g.add(b(0.34, 0.03, 0.03, C.road, 0, 0.12, 0.12));
  return g;
}

// ---------------------------------------------------------------- 角落小物
function extinguisher() {
  const g = new THREE.Group();
  g.add(cy(0.115, 0.115, 0.44, C.coral, 0, 0.34, 0, 14));
  g.add(cy(0.1, 0.1, 0.03, C.coral, 0, 0.56, 0, 14));
  g.add(cy(0.035, 0.035, 0.11, C.dark, 0, 0.63, 0, 8));
  g.add(b(0.14, 0.035, 0.05, C.dark, 0, 0.685, 0));
  g.add(cy(0.02, 0.02, 0.05, C.ink, 0.09, 0.62, 0, 6));   // 压力表
  const hose = cy(0.014, 0.014, 0.34, C.ink, 0.11, 0.5, 0.02, 6);
  hose.rotation.z = 0.55;
  g.add(hose);
  g.add(b(0.24, 0.03, 0.24, C.road, 0, 0.015, 0));
  g.add(b(0.16, 0.1, 0.008, C.white, 0, 0.36, 0.117));
  return g;
}

function umbrellaStand() {
  const g = new THREE.Group();
  g.add(cy(0.15, 0.13, 0.46, C.road, 0, 0.23, 0, 14));
  g.add(cy(0.155, 0.155, 0.03, C.dark, 0, 0.45, 0, 14));
  const umb = [[C.navy, 0.05, 0.95, 0.05], [C.ink, -0.05, 0.78, -0.04], [C.coral, 0.01, 0.62, 0.06]];
  for (const [col, dx, h, dz] of umb) {
    const u = cy(0.026, 0.026, h, col, dx, 0.3 + h / 2, dz, 6);
    u.rotation.z = dx * 0.5;
    u.rotation.x = dz * 0.5;
    g.add(u);
  }
  return g;
}

function cartons() {
  const g = new THREE.Group();
  g.add(b(0.54, 0.42, 0.44, C.sand, 0, 0.21, 0));
  g.add(b(0.54, 0.03, 0.1, C.cream, 0, 0.43, 0));
  g.add(b(0.18, 0.1, 0.008, C.white, -0.12, 0.26, 0.222));
  const top = b(0.44, 0.34, 0.38, C.sand, 0.02, 0.59, 0.02);
  top.rotation.y = 0.12;
  g.add(top);
  g.add(b(0.44, 0.02, 0.08, C.cream, 0.02, 0.765, 0.02));
  return g;
}

function wasteBin() {
  const g = new THREE.Group();
  g.add(cy(0.17, 0.14, 0.44, C.road, 0, 0.22, 0, 14));
  g.add(cy(0.18, 0.18, 0.04, C.dark, 0, 0.45, 0, 14));
  g.add(b(0.14, 0.06, 0.02, C.white, 0, 0.42, 0.16));       // 露出来的垃圾袋边
  g.add(b(0.09, 0.03, 0.012, C.ink, 0, 0.36, 0.16));
  return g;
}

function mopBucket() {
  const g = new THREE.Group();
  g.add(cy(0.19, 0.16, 0.3, C.blue, 0, 0.15, 0, 14));
  g.add(cy(0.2, 0.2, 0.03, C.dark, 0, 0.3, 0, 14));
  g.add(cy(0.16, 0.16, 0.02, C.glass, 0, 0.31, 0, 14));     // 桶里的水
  const pole = cy(0.024, 0.024, 1.25, C.wood, 0.1, 0.72, 0.02, 6);
  pole.rotation.z = -0.06;
  g.add(pole);
  for (let i = 0; i < 5; i++) {                              // 拖把头
    const s = b(0.03, 0.2, 0.03, C.cream, 0.16 + (i % 3) * 0.03, 0.16, -0.03 + i * 0.02);
    s.rotation.z = 0.16;
    g.add(s);
  }
  return g;
}

// 立式宣传架：一根柱 + 一块竖起来的牌（调解流程 / 便民提示都挂这个）
function posterStand() {
  const g = new THREE.Group();
  g.add(b(0.56, 0.05, 0.36, C.dark, 0, 0.028, 0));
  g.add(b(0.5, 0.04, 0.3, C.road, 0, 0.06, 0));
  g.add(cy(0.028, 0.028, 1.16, C.road, 0, 0.64, 0, 8));
  g.add(b(0.62, 0.9, 0.055, C.navy, 0, 1.52, 0));
  g.add(b(0.54, 0.82, 0.03, C.white, 0, 1.52, 0.032));
  g.add(b(0.34, 0.05, 0.012, C.coral, -0.04, 1.81, 0.052));
  for (let i = 0; i < 4; i++) {
    g.add(b(0.42 - (i % 2) * 0.1, 0.026, 0.012, C.ink, -0.02, 1.66 - i * 0.1, 0.052));
  }
  g.add(b(0.2, 0.11, 0.012, C.glass, 0.1, 1.24, 0.052));     // 一张小图
  g.add(b(0.24, 0.024, 0.012, C.road, -0.12, 1.24, 0.052));
  return g;
}

// 落地盆栽：门口那棵，把右下角压住
function floorPlant() {
  const g = new THREE.Group();
  g.add(cy(0.245, 0.19, 0.44, C.wood, 0, 0.22, 0, 14));    // 花盆：上宽下窄
  g.add(cy(0.26, 0.26, 0.05, C.sand, 0, 0.455, 0, 14));      // 盆沿
  g.add(cy(0.21, 0.21, 0.02, C.dark, 0, 0.445, 0, 14));      // 盆土
  for (let i = 0; i < 5; i++) {                              // 五根枝，各自往一边斜
    const a = i * 1.257;
    const h = 0.46 + (i % 3) * 0.13;
    const stem = cy(0.013, 0.011, h, C.sea,
      Math.cos(a) * 0.06, 0.46 + h / 2, Math.sin(a) * 0.06, 5);
    stem.rotation.z = Math.cos(a) * 0.14;
    stem.rotation.x = -Math.sin(a) * 0.14;
    g.add(stem);
    for (let k = 0; k < 2; k++) {                            // 枝上两片横着展开的叶
      const rr = 0.15 + k * 0.07;
      const leaf = ball(0.13, k ? C.mint : C.sea,
        Math.cos(a) * rr, 0.72 + h * 0.5 + k * 0.1, Math.sin(a) * rr, 9);
      leaf.scale.set(1.2, 0.5, 0.85);
      g.add(leaf);
    }
  }
  return g;
}

// 等候区的矮圆几：上面摊着两张宣传单 + 纸巾盒 + 一只纸杯
function teaTable() {
  const g = new THREE.Group();
  g.add(cy(0.34, 0.34, 0.05, C.wood, 0, 0.44, 0, 20));
  g.add(cy(0.05, 0.05, 0.42, C.road, 0, 0.21, 0, 8));
  g.add(cy(0.23, 0.25, 0.045, C.road, 0, 0.022, 0, 14));
  const s1 = b(0.3, 0.012, 0.22, C.white, -0.06, 0.47, 0.02);
  s1.rotation.y = 0.2;
  const s2 = b(0.28, 0.01, 0.2, C.cream, 0.04, 0.48, -0.07);
  s2.rotation.y = -0.16;
  g.add(s1, s2);
  g.add(b(0.26, 0.006, 0.012, C.ink, -0.05, 0.478, 0.02));   // 宣传单上的两行字
  g.add(b(0.18, 0.006, 0.012, C.road, -0.02, 0.484, 0.09));
  g.add(b(0.16, 0.07, 0.1, C.white, 0.17, 0.5, 0.1));         // 纸巾盒
  g.add(b(0.05, 0.02, 0.04, C.cream, 0.17, 0.54, 0.1));
  g.add(cy(0.04, 0.03, 0.09, C.white, -0.18, 0.49, -0.14, 10)); // 一只纸杯
  return g;
}

// 门口地垫
function doorMat() {
  const g = new THREE.Group();
  g.add(b(1.0, 0.022, 0.66, C.dark, 0, 0.011, 0));
  g.add(b(0.9, 0.006, 0.56, C.road, 0, 0.024, 0));
  g.add(b(0.46, 0.004, 0.05, C.cream, 0, 0.028, 0));
  return g;
}

// 右墙边的茶水柜：电水壶 + 暖瓶 + 一托盘纸杯（顺带解释了窗台和桌上的杯子）
function teaStation() {
  const g = new THREE.Group();
  g.add(b(0.46, 0.74, 1.36, C.wood, 0, 0.39, 0));            // 柜体
  g.add(b(0.52, 0.06, 1.42, C.wood, 0, 0.79, 0));             // 台面（上表面 0.82）
  g.add(b(0.03, 0.58, 1.24, C.sand, -0.235, 0.41, 0));        // 柜门
  g.add(b(0.02, 0.58, 0.02, C.wood, -0.25, 0.41, 0));
  for (const sz of [-1, 1]) {
    g.add(b(0.025, 0.09, 0.025, C.road, -0.255, 0.5, sz * 0.09));  // 拉手
    g.add(b(0.4, 0.06, 0.04, C.road, 0, 0.035, sz * 0.55));         // 柜脚
  }
  const tray = new THREE.Group();                              // 托盘 + 四只纸杯
  tray.position.set(0.0, 0.82, 0.34);
  tray.add(b(0.34, 0.02, 0.44, C.blue, 0, 0.01, 0));
  for (let i = 0; i < 4; i++) {
    tray.add(cy(0.042, 0.032, 0.09, C.white,
      -0.09 + (i % 2) * 0.17, 0.065, -0.1 + Math.floor(i / 2) * 0.2, 10));
  }
  g.add(tray);
  g.add(cy(0.11, 0.095, 0.24, C.white, 0.02, 0.94, -0.28, 14));  // 电水壶
  g.add(cy(0.1, 0.1, 0.03, C.road, 0.02, 1.07, -0.28, 14));
  const spout = cy(0.022, 0.016, 0.2, C.white, -0.12, 0.98, -0.28, 6);
  spout.rotation.z = 0.7;
  g.add(spout);
  g.add(b(0.04, 0.1, 0.03, C.road, 0.04, 0.9, -0.4));            // 壶把手
  g.add(cy(0.085, 0.085, 0.4, C.coral, 0.04, 1.02, -0.56, 14));  // 暖瓶
  g.add(cy(0.07, 0.05, 0.06, C.dark, 0.04, 1.25, -0.56, 12));
  return g;
}

// ---------------------------------------------------------------- 光与地
// 百叶窗切到地上的 9 条暖光：从窗根斜铺到右前方空地上，宽 0.22
// 斜角是刻意的：光条若顺着视线方向铺，透视会把它压成几条线，等于白铺。
function sunStripes() {
  const g = new THREE.Group();
  const N = 9, W = 2.6, L = 3.25, ANG = -0.62;
  for (let i = 0; i < N; i++) {
    const x0 = 0.8 + ((i + 0.5) / N) * W;
    const grp = new THREE.Group();
    grp.position.set(x0, 0.03, -4.36);
    grp.rotation.y = ANG;
    const geo = new THREE.PlaneGeometry(0.22, L);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, L / 2);
    grp.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: C.yellow, transparent: true, opacity: 0.55, depthWrite: false
    })));
    const core = new THREE.PlaneGeometry(0.1, L * 0.95);
    core.rotateX(-Math.PI / 2);
    core.translate(0, 0.002, L * 0.475);
    grp.add(new THREE.Mesh(core, new THREE.MeshBasicMaterial({
      color: C.cream, transparent: true, opacity: 0.48, depthWrite: false
    })));
    g.add(grp);
  }
  A.stripes = g;
  return g;
}

// ---------------------------------------------------------------- 场景装配
const room = { x0: -6, x1: 6, z0: -4.5, z1: 4.5, h: 3.0 };

const props = [
  // ---- 吊顶带（贴死墙内表面）：三面一圈，上沿压到墙顶
  { id: "s_soffitB", x: 0, z: -4.12, w: 11.9, d: 0.76, passable: true,
    build: () => b(11.9, 0.12, 0.76, C.cream, 0, 2.94, 0) },
  { id: "s_soffitL", x: -5.62, z: 0, w: 0.76, d: 8.6, passable: true,
    build: () => b(0.76, 0.12, 8.6, C.cream, 0, 2.94, 0) },
  { id: "s_soffitR", x: 5.62, z: 0, w: 0.76, d: 8.6, passable: true,
    build: () => b(0.76, 0.12, 8.6, C.cream, 0, 2.94, 0) },

  // ---- 四盏线灯（吊在吊顶带下；正式场所的光稳定，只有 1.8% 呼吸）
  { id: "s_lampA", x: -3.1, z: -3.92, w: 1.15, d: 0.17, passable: true,
    build: () => linearLight(1.15) },
  { id: "s_lampB", x: 1.5, z: -3.92, w: 1.15, d: 0.17, passable: true,
    build: () => linearLight(1.15) },
  { id: "s_lampC", x: -5.42, z: 0.6, w: 0.17, d: 1.15, passable: true,
    build: () => { const g = linearLight(1.15); g.rotation.y = Math.PI / 2; return g; } },
  { id: "s_lampD", x: 5.42, z: 0.2, w: 0.17, d: 1.15, passable: true,
    build: () => { const g = linearLight(1.15); g.rotation.y = Math.PI / 2; return g; } },

  // ---- 地面：一层很淡的冷调罩面（地砖冷白偏青）+ 门口到桌边的磨痕
  { id: "s_floorTone", x: 0, z: 0, w: 0.1, d: 0.1, passable: true,
    build: () => flat(11.9, 8.9, C.glass, 0, 0.016, 0, 0.26) },
  { id: "s_wear", x: 3.7, z: 1.15, w: 0.1, d: 0.1, passable: true,
    build: () => flat(0.5, 3.4, C.road, 0, 0.021, 0, 0.13, -2.26) },

  // ---- 西北：档案柜 ×2（后墙）+ 柜顶档案盒 + 饮水机（左墙）
  { id: "s_cab1", x: -5.45, z: -4.22, w: 1.0, d: 0.52, build: cabinet,
    interact: { x: -5.45, z: -3.2 } },
  { id: "s_cab2", x: -4.25, z: -4.22, w: 1.0, d: 0.52, build: cabinet },
  { id: "s_cabPlant", x: -4.25, z: -4.22, w: 0.4, d: 0.4, passable: true,
    build: () => {
      const g = new THREE.Group();                       // 柜顶的一盆绿萝
      g.add(cy(0.15, 0.12, 0.17, C.wood, 0, 1.665, 0, 12));
      g.add(cy(0.155, 0.155, 0.022, C.sand, 0, 1.735, 0, 12));
      for (let i = 0; i < 6; i++) {
        const a = i * 1.05;
        const leaf = ball(0.095, i % 2 ? C.mint : C.sea,
          Math.cos(a) * 0.12, 1.82 + (i % 3) * 0.03, Math.sin(a) * 0.1, 8);
        leaf.scale.set(1, 0.55, 1.25);
        g.add(leaf);
      }
      for (let i = 0; i < 2; i++) {                      // 两条垂到柜侧的枝
        const v = cy(0.012, 0.01, 0.3, C.sea, 0.16, 1.62, -0.05 + i * 0.1, 4);
        v.rotation.z = 0.35;
        g.add(v);
        g.add(ball(0.05, C.mint, 0.22, 1.48, -0.05 + i * 0.1, 6));
      }
      return g;
    } },
  { id: "s_cabTop", x: -5.45, z: -4.22, w: 0.6, d: 0.5, passable: true,
    build: () => {
      const g = new THREE.Group();
      for (let i = 0; i < 4; i++) {                       // 四摞档案盒
        g.add(b(0.34, 0.1, 0.26, i % 2 ? C.sand : C.cream, -0.22, 1.635 + i * 0.1, 0));
        g.add(b(0.34, 0.012, 0.02, C.road, -0.22, 1.68 + i * 0.1, 0.13));
      }
      g.add(b(0.3, 0.22, 0.24, C.blue, 0.24, 1.69, 0.02));   // 一只档案盒立着
      return g;
    } },
  { id: "s_water", x: -5.75, z: -2.55, w: 0.42, d: 0.42, build: waterCooler, rot: Math.PI / 2,
    interact: { x: -4.9, z: -2.55 } },

  // ---- 东北：后墙百叶窗 + 纱帘 + 吸音板 + 绿萝挂篮（+ 空调风口）
  { id: "s_window", x: 2.1, z: -4.38, w: 2.86, d: 0.16, build: windowWall,
    interact: { x: 2.1, z: -3.35 } },
  { id: "s_curtainL", x: 0.66, z: -4.28, w: 0.5, d: 0.2, passable: true,
    build: () => { const g = sheerCurtain(0.5, 1.55); g.position.set(0, 2.66, 0); return g; } },
  { id: "s_curtainR", x: 3.54, z: -4.28, w: 0.5, d: 0.2, passable: true,
    build: () => { const g = sheerCurtain(0.5, 1.55); g.position.set(0, 2.66, 0); return g; } },
  { id: "s_acoustic1", x: 0.0, z: -4.42, w: 0.8, d: 0.07,
    build: () => { const g = acoustic(0.8, 0.7); g.position.set(0, 2.06, 0.03); return g; } },
  { id: "s_acoustic2", x: 4.3, z: -4.42, w: 0.8, d: 0.07,
    build: () => { const g = acoustic(0.8, 0.7); g.position.set(0, 2.06, 0.03); return g; } },
  { id: "s_hang1", x: 0.6, z: -4.12, w: 0.4, d: 0.4, passable: true, build: hangPlant },
  { id: "s_hang2", x: 3.6, z: -4.12, w: 0.4, d: 0.4, passable: true, build: hangPlant },

  // ---- 后墙右段：照片墙 4 张 + 挂钟（后墙是唯一正对默认机位的墙，挂这里才看得见）
  { id: "s_photos", x: 4.3, z: -4.42, w: 1.4, d: 0.1,
    build: () => { const g = photoWall(); g.position.set(0, 2.0, 0.05); return g; },
    interact: { x: 4.3, z: -3.3 } },
  { id: "s_clock", x: 5.58, z: -4.42, w: 0.46, d: 0.1,
    build: () => { const g = wallClock(); g.position.set(0, 2.2, 0.06); return g; } },

  // ---- 右墙：空调风口（挂着百叶窗那阵风的来历）
  { id: "s_ac", x: 5.88, z: -3.5, w: 0.26, d: 1.0, rot: -Math.PI / 2,
    build: () => {
      const g = new THREE.Group();
      g.add(b(0.96, 0.3, 0.22, C.white, 0, 2.5, 0));
      g.add(b(0.88, 0.1, 0.03, C.glass, 0, 2.42, 0.115));   // 出风口
      for (let i = 0; i < 5; i++) {
        g.add(b(0.78, 0.008, 0.02, C.cream, 0, 2.4 + i * 0.012, 0.135));
      }
      g.add(cy(0.012, 0.012, 0.012, C.mint, 0.4, 2.45, 0.12, 6));   // 指示灯
      return g;
    } },

  // ---- 左墙：锦旗 + 意见箱（等候区上方，正好在长椅背后）
  { id: "s_banner", x: -5.9, z: 2.0, w: 1.0, d: 0.1, rot: Math.PI / 2, build: banner,
    interact: { x: -4.9, z: 2.0 } },
  { id: "s_mailbox", x: -5.92, z: 3.42, w: 0.1, d: 0.44, rot: Math.PI / 2,
    build: () => {
      const g = new THREE.Group();
      g.add(b(0.4, 0.48, 0.15, C.cream, 0, 1.46, 0.075));
      g.add(b(0.44, 0.04, 0.17, C.road, 0, 1.72, 0.075));     // 顶盖
      g.add(b(0.26, 0.045, 0.02, C.ink, 0, 1.56, 0.16));      // 投递口
      g.add(b(0.3, 0.13, 0.015, C.navy, 0, 1.38, 0.16));      // 标签
      g.add(b(0.22, 0.028, 0.012, C.cream, 0, 1.39, 0.17));
      g.add(b(0.06, 0.06, 0.05, C.yellow, 0.14, 1.25, 0.16)); // 锁扣
      return g;
    } },

  // ---- 后墙：流程牌 + 权利义务牌（必须后墙：侧墙是掠射角，等于没挂）
  { id: "s_flow", x: -2.85, z: -4.42, w: 1.4, d: 0.08,
    build: () => { const g = flowBoard(); g.position.set(0, 1.85, 0.04); return g; },
    interact: { x: -2.85, z: -3.3 } },
  { id: "s_duty", x: -1.45, z: -4.42, w: 1.4, d: 0.08,
    build: () => { const g = dutyBoard(); g.position.set(0, 1.85, 0.04); return g; } },

  // ---- 右墙：门（门后挂钩挂外套）+ 门牌 + 茶水柜
  { id: "s_side", x: 5.7, z: 0.35, w: 0.5, d: 1.4, build: teaStation,
    interact: { x: 4.95, z: 0.35 } },
  { id: "s_door", x: 5.96, z: 2.75, w: 0.1, d: 1.24, rot: -Math.PI / 2, build: doorWay,
    interact: { x: 4.9, z: 2.75 } },
  { id: "s_doorSign", x: 5.94, z: 3.62, w: 0.08, d: 0.5, rot: -Math.PI / 2,
    build: () => {
      const g = new THREE.Group();
      g.add(b(0.46, 0.2, 0.04, C.navy, 0, 1.72, 0));
      g.add(b(0.34, 0.05, 0.02, C.cream, 0, 1.74, 0.03));
      g.add(b(0.24, 0.03, 0.02, C.cream, 0, 1.66, 0.03));
      return g;
    } },

  // ---- 西南：等候长椅 + 折叠椅 ×3 + 雨伞架 + 灭火器 + 纸箱
  { id: "s_wait", x: -5.36, z: 2.5, w: 0.5, d: 1.9, rot: -Math.PI / 2, seat: true, facing: Math.PI / 2,
    build: () => { const g = waitBench(); g.rotation.y = 0; return g; },
    interact: { x: -4.4, z: 2.6 } },
  { id: "s_tea", x: -4.15, z: 1.55, w: 0.7, d: 0.7, build: teaTable,
    interact: { x: -4.15, z: 2.35 } },
  { id: "s_fold1", x: -5.72, z: 0.78, w: 0.42, d: 0.5, build: () => { const g = foldChair(); g.rotation.y = Math.PI / 2; g.rotation.z = 0.1; return g; } },
  { id: "s_fold2", x: -5.7, z: 1.2, w: 0.42, d: 0.5, build: () => { const g = foldChair(); g.rotation.y = Math.PI / 2; g.rotation.z = 0.12; return g; } },
  { id: "s_fold3", x: -5.68, z: 1.62, w: 0.42, d: 0.5, build: () => { const g = foldChair(); g.rotation.y = Math.PI / 2; g.rotation.z = 0.09; return g; } },
  { id: "s_umb", x: -5.5, z: 3.95, w: 0.34, d: 0.34, build: umbrellaStand },
  { id: "s_ext", x: -4.7, z: 4.22, w: 0.26, d: 0.26, build: extinguisher },
  { id: "s_boxes", x: -4.6, z: 3.5, w: 0.6, d: 0.5, build: cartons },

  // ---- 东南：调解桌 + 两侧长条椅 + 记录椅
  { id: "s_table", x: 0, z: -0.5, w: 3.4, d: 1.4, build: mediationTable,
    interact: { x: 2.55, z: 0.95 } },
  { id: "s_benchL", x: -0.4, z: 0.95, w: 2.6, d: 0.5, seat: true, facing: Math.PI,
    build: () => longBench(2.6), interact: { x: -1.2, z: 1.68 } },
  { id: "s_benchR", x: 0.5, z: -2.1, w: 2.6, d: 0.5, rot: Math.PI, seat: true, facing: 0,
    build: () => longBench(2.6), interact: { x: 0.5, z: -2.95 } },
  { id: "s_chair", x: 2.28, z: -0.48, w: 0.6, d: 0.6, rot: -Math.PI / 2 - 0.07, seat: true,
    facing: -Math.PI / 2 - 0.07, build: recordChair, interact: { x: 3.0, z: -0.4 } },

  // ---- 东南近门：立式宣传架 + 落地盆栽 + 门口地垫 + 垃圾桶 + 拖把
  { id: "s_stand", x: 3.95, z: 2.45, w: 0.62, d: 0.42, build: posterStand,
    interact: { x: 3.6, z: 3.2 } },
  { id: "s_plant", x: 5.6, z: 3.55, w: 0.56, d: 0.56, build: floorPlant },
  { id: "s_mat", x: 5.05, z: 2.75, w: 1.0, d: 0.66, passable: true, build: doorMat },
  { id: "s_bin", x: 4.72, z: 4.2, w: 0.38, d: 0.38, build: wasteBin },
  { id: "s_mop", x: 5.58, z: 4.28, w: 0.42, d: 0.42, passable: true, build: mopBucket },

  // ---- 地上：百叶窗的光条（次中心）
  { id: "s_sun", x: 0, z: 0, w: 0.1, d: 0.1, passable: true, build: sunStripes }
];

// 碰撞：家具进网格，人物半径 0.34 由运行时膨胀
const obstacles = props.filter((p) => !p.passable).map((p) => ({ x: p.x, z: p.z, w: p.w, d: p.d }));
obstacles.push({ x: 0, z: room.z0, w: 12.2, d: 0.4 });
obstacles.push({ x: room.x0, z: 0, w: 0.4, d: 9.2 });
obstacles.push({ x: room.x1, z: 0, w: 0.4, d: 9.2 });

// 氛围人物：两侧长条椅各坐一个人，都只留背影——"刚刚有人坐过"的证据
const characters = [
  { id: "p_a", personId: "p_a", label: "李秀兰", name: "李秀兰", role: "申请人 · 东院住户",
            x: -0.9, z: 0.92, y: -0.09, facing: Math.PI,
            pose: "sit", scale: 0.95, color: C.navy, pants: C.dark, hair: "#3a2c22", ambient: true },
  { id: "p_b", personId: "p_b", label: "张守义", name: "张守义", role: "被申请人 · 西院住户",
            x: 0.62, z: -2.13, y: -0.09, facing: 0,
            pose: "sit", scale: 0.96, color: C.road, pants: C.dark, hair: "#2e251e", ambient: true },
          { id: "p_c", personId: "p_c", label: "周建国", name: "周建国", role: "村委会副主任",
            x: 2.55, z: -0.6, y: 0, facing: -Math.PI / 2,
            pose: "stand", scale: 0.97, color: C.blue, pants: C.dark, hair: "#4a4038" }
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
    // 底座与房间：奶油白墙、沙色地台、深蓝台身
    baseColor: C.cream, baseSideColor: C.navy, siteColor: C.sand,
    terrainSideColor: C.road,
    wallColor: C.cream, wallOutColor: C.sand, wallCapColor: C.road, skirtColor: C.white,
    floorColor: C.white,
    skyTop: C.glass, skyMid: C.white, skyBottom: C.cream,
    // 下午三点二十：暖主光偏低、冷补光从右侧来
    light: { sun: C.cream, sunI: 2.2, fill: C.blue, fillI: 0.9, hemi: 0.55,
             hemiSky: C.glass, hemiGround: C.sand, exposure: 0.88 },
    actor: { x: 0.2, z: 3.5 },
    camYaw: 0.34, camPitch: 0.6, camDist: 15, camFocus: [0, 1.0, -0.3],
    walk: { x0: -5.5, x1: 5.5, z0: -3.85, z1: 4.15 },
    onSpot: (p) => { (window.__events = window.__events || []).push(["spot", p.id]); },
    onPerson: (p) => { (window.__events = window.__events || []).push(["person", p.id]); },
    onArrived: (p) => { (window.__events = window.__events || []).push(["arrived", +p.x.toFixed(2), +p.z.toFixed(2)]); },
    onSeat: (p) => { (window.__events = window.__events || []).push(["seat", p.id]); },
    // ---- 基础动效：10 条，幅度全部 2% 量级
    onFrame: (t) => {
      // ① 百叶窗的光条随日照极缓移动（20 秒一指宽 ≈ 0.02）
      if (A.stripes) {
        A.stripes.position.x = Math.sin(t * 0.055) * 0.045;
        A.stripes.position.z = Math.sin(t * 0.041 + 1.2) * 0.024;
      }
      // ② 纱帘被空调风带起一角又落下（0.02 弧度，两片不同相）
      A.curtain.forEach((c, i) => {
        const gust = 0.55 + 0.45 * Math.sin(t * 0.21 + i * 1.7);
        c.rotation.z = Math.sin(t * 0.85 + i * 2.1) * 0.02 * gust;
        c.rotation.x = Math.sin(t * 0.62 + i) * 0.012;
      });
      // ③④ 挂钟秒针一格一格走、分针极缓
      if (A.sec) { A.sec.rotation.z = -t * (Math.PI * 2 / 60); }
      if (A.minute) { A.minute.rotation.z = -t * (Math.PI * 2 / 3600); }
      // ⑤ 最满那只纸杯的水面，一圈极细的晃动
      if (A.water) {
        const k = 1 + Math.sin(t * 2.6) * 0.02;
        A.water.scale.set(k, 1 + Math.cos(t * 2.15) * 0.02, 1);
      }
      // ⑥ 申请书最上面那张的边角起伏 1 厘米
      if (A.paperCorner) { A.paperCorner.rotation.z = Math.sin(t * 0.95) * 0.03; }
      // ⑦ 门口那件外套的下摆偶尔动一下
      if (A.coat) {
        A.coat.rotation.z = Math.sin(t * 0.72) * 0.018 + Math.sin(t * 0.19) * 0.008;
      }
      // ⑧ 吊灯呼吸 1.8%（正式场所，幅度压到几乎看不出）
      for (const l of A.lamp) {
        l.m.material.emissiveIntensity = l.base * (1 + Math.sin(t * 1.7) * 0.018);
      }
      // ⑨ 饮水机桶里偶尔冒起一串小气泡
      for (const bp of A.bubbles) {
        const q = (t * 0.16 + bp.ph) % 1;
        bp.o.position.y = 0.92 + q * 0.24;
        bp.o.position.x = bp.x + Math.sin(q * 6) * 0.012;
        bp.o.material.opacity = 0.75 * Math.sin(q * Math.PI);
      }
      // ⑩ 绿萝垂枝、计时器指示灯
      for (let i = 0; i < A.vines.length; i++) {
        A.vines[i].rotation.z = Math.cos(i) * 0.16 + Math.sin(t * 0.8 + i) * 0.02;
      }
      if (A.led) { A.led.material.emissiveIntensity = 0.8 + 0.35 * Math.sin(t * 1.9); }
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
