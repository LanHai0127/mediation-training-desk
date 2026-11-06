// 场景建模工具箱：贴图 + 零件工厂
// -----------------------------------------------------------------------------
// 为什么单独一个文件：S3 院墙写完之后，第二、第三个场景都要同一套
// "canvas 贴图 + 圆角零件 + 贴地切片"。复制第三遍就等于以后改一次要改三处。
//
// 约定（与 §1.4 视觉规格一致）：
//   · 家具一律圆角 r = min(0.04, 最小边×0.4)；最小边 < 0.055 用直角盒
//   · 贴图全部 canvas 现画，零外部请求
//   · decal 只做贴地薄片，不投影、只接收
// -----------------------------------------------------------------------------
import * as THREE from "./vendor/three.module.min.js";
import { roundedGeo, roundedSeg } from "./scene3d.js";

export { THREE };

export const M = (color, opts) => {
  // outline 是给 b() 用的开关，不是材质属性；漏进材质会触发
  // THREE.Material: 'outline' is not a property of THREE.MeshToonMaterial.
  const { outline: _outline, ...mat } = opts || {};
  return new THREE.MeshToonMaterial({ color, ...mat });
};

export function tex(w, h, draw, rx = 1, ry = 1) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) * k) | 0;
  const g = Math.min(255, ((n >> 8) & 255) * k) | 0;
  const b = Math.min(255, (n & 255) * k) | 0;
  return "rgb(" + r + "," + g + "," + b + ")";
}

// 砖墙：v6 起改成纯色 + 一层很淡的横向分格（不放噪点，只保留"这是砖"的暗示）
export function brickTex(base, mortar, rows = 8, cols = 5) {
  // 只用两个纯色画的砖格：没有噪点、没有随机色差，但错缝还在
  const t = tex(256, 256, (g) => {
    g.fillStyle = mortar; g.fillRect(0, 0, 256, 256);
    const bh = 256 / rows, bw = 256 / cols;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * bw * 0.5;
      for (let c = -1; c <= cols; c++) {
        g.fillStyle = base;
        g.fillRect(c * bw + off + 1.2, r * bh + 1.2, bw - 2.4, bh - 2.4);
      }
    }
  });
  return t;
}

function brickTexNoise(base, mortar, rows = 8, cols = 5) {
  return tex(256, 256, (g) => {
    g.fillStyle = mortar; g.fillRect(0, 0, 256, 256);
    const bh = 256 / rows, bw = 256 / cols;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * bw * 0.5;
      for (let c = -1; c <= cols; c++) {
        const x = c * bw + off + 1.5, y = r * bh + 1.5;
        g.fillStyle = shade(base, 0.88 + Math.random() * 0.2);
        g.fillRect(x, y, bw - 3, bh - 3);
        g.fillStyle = "rgba(255,255,255,.10)";
        g.fillRect(x, y, bw - 3, 1.6);
      }
    }
    for (let i = 0; i < 400; i++) {
      g.fillStyle = "rgba(80,70,60," + (Math.random() * 0.05).toFixed(3) + ")";
      g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
  });
}

// 泥土地：v6 起改成纯色（噪点会让模型变脏），保留签名让旧调用点不用改
export function soilTex(base, dark, rx = 4, ry = 4) {
  return flatTex(base);
}

function soilTexNoise(base, dark, rx = 4, ry = 4) {
  return tex(256, 256, (g) => {
    g.fillStyle = base; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = Math.random() < 0.5 ? dark : "rgba(210,196,170,.25)";
      const s = 1 + Math.random() * 3.4;
      g.fillRect(Math.random() * 256, Math.random() * 256, s, s);
    }
    for (let i = 0; i < 26; i++) {
      g.strokeStyle = dark;
      g.globalAlpha = 0.25;
      g.lineWidth = 1 + Math.random() * 2;
      const y = Math.random() * 256;
      g.beginPath(); g.moveTo(0, y); g.lineTo(256, y + (Math.random() - 0.5) * 20); g.stroke();
      g.globalAlpha = 1;
    }
  }, rx, ry);
}

// 草地：v6 起改成纯色
export function grassTex(rx = 3, ry = 3) {
  return flatTex("#7d9163");
}

function grassTexNoise(rx = 3, ry = 3) {
  return tex(256, 256, (g) => {
    g.fillStyle = "#7d9163"; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2200; i++) {
      const t = Math.random();
      g.fillStyle = t < 0.4 ? "#6d8256" : (t < 0.75 ? "#8aa16d" : "#5d7249");
      g.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 3, 1 + Math.random() * 2);
    }
  }, rx, ry);
}

// 水泥地：v6 起改成纯色（补丁与裂缝改用几何贴片，不再画进贴图）
export function concreteTex(base = "#b9b2a4", rx = 3, ry = 3) {
  return flatTex(base);
}

function concreteTexNoise(base = "#b9b2a4", rx = 3, ry = 3) {
  return tex(256, 256, (g) => {
    g.fillStyle = base; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1600; i++) {
      g.fillStyle = "rgba(120,112,100," + (Math.random() * 0.12).toFixed(3) + ")";
      g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 3);
    }
    // 两块补丁
    for (let i = 0; i < 2; i++) {
      const x = Math.random() * 180, y = Math.random() * 180;
      g.fillStyle = "rgba(150,143,130,.55)";
      g.fillRect(x, y, 40 + Math.random() * 40, 30 + Math.random() * 30);
    }
    // 一道裂缝
    g.strokeStyle = "rgba(90,84,74,.45)";
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(20, 256);
    let x = 20;
    for (let y = 256; y > 0; y -= 26) { x += (Math.random() - 0.5) * 18; g.lineTo(x, y); }
    g.stroke();
  }, rx, ry);
}

// 零件：圆角盒
export function b(w, h, d, color, x = 0, y = 0, z = 0, opts) {
  const min = Math.min(w, h, d);
  const geo = min < 0.055
    ? new THREE.BoxGeometry(w, h, d)
    : roundedGeo(w, h, d, Math.min(0.04, min * 0.4), roundedSeg(w, h, d));
  const m = new THREE.Mesh(geo, typeof color === "string" ? M(color, opts) : color);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  // v6：大件一律描边（圆角盒的 Edges 会略钝，正好接近手绘线）
  if (!opts || opts.outline !== false) { outline(m, Math.max(w, h, d)); }
  return m;
}

export function cy(r1, r2, h, color, x = 0, y = 0, z = 0, seg = 14) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg),
    typeof color === "string" ? M(color) : color);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export function ball(r, color, x = 0, y = 0, z = 0, seg = 12) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(8, seg - 4)), M(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

// 贴地薄片（水渍、苔藓、落叶堆、脚印）：不投影、只接收
export function decal(w, d, color, x, z, y = 0.012, op = 1) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({ color, transparent: op < 1, opacity: op, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

// 地面贴片：室外场景靠"地面有几种材质"来破单调，室内也可以用来铺院子
export function ground(w, d, x, z, map, color = "#ffffff", y = 0.008) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), M(color, { map }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  return m;
}

// 一丛草/一蓬灌木：三颗压扁的球，比单球像植物
export function bush(x = 0, z = 0, r = 0.34, dark = "#5f7a45", light = "#6f8c52") {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const bl = ball(r - i * r * 0.16, i % 2 ? dark : light, (i - 1) * r * 0.8, r * 0.9 + r * 0.16, 0, 9);
    bl.scale.y = 0.8;
    g.add(bl);
  }
  g.position.set(x, 0, z);
  return g;
}

// ============================================================================
// v6 视觉基准（2026-11-04）
// ----------------------------------------------------------------------------
// 这四条是从「海边便利店」那件成品里读出来的，全项目共用：
//   ① 15 色定死 —— 不再现给十六进制；要新色先加进 PAL
//   ② 描边 —— 最大边 > OUTLINE_MIN 的盒子加 EdgesGeometry，墨色、半透明
//   ③ 零噪点贴图 —— 地面/道路/水/墙一律纯色；贴图只允许 canvas 写字
//   ④ 模型浮在环境里 —— 底座外面铺一层同色外景平面
// ============================================================================

// ① 色板：与提示词 §1 第 3 条完全一致
export const PAL = {
  ink: "#355364", cream: "#fff3d7", white: "#fffaf0", blue: "#82c9d5",
  sea: "#62bfc7", navy: "#315c72", peach: "#f4a58b", coral: "#e98578",
  mint: "#a5d8bd", sand: "#e8cca1", road: "#667782", yellow: "#ffd781",
  wood: "#b98e68", glass: "#b7e1df", dark: "#294858",
  // 2026-11-04 增补四个"土地色"：便利店那套是海边场景，没有草地/泥土/砖瓦，
  // 而院墙案三场全靠这几档区分新旧与干湿。仍然走"先加常量再用"的规矩。
  grass: "#7d9163", soil: "#a08d70", brick: "#a2745f", tile: "#6b6357"
};

// ② 描边：只给"大件"，小件加会糊，也会把绘制调用翻倍
const OUTLINE_MIN = 0.55;
const inkMat = new THREE.LineBasicMaterial({ color: PAL.ink, transparent: true, opacity: 0.5 });
export function outline(mesh, size) {
  if (!mesh || !mesh.geometry) { return mesh; }
  if (size !== undefined && size <= OUTLINE_MIN) { return mesh; }
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 32), inkMat);
  e.renderOrder = 2;
  e.castShadow = false;
  e.receiveShadow = false;
  mesh.add(e);
  return mesh;
}

// ③ 贴图只剩"写字"这一种：把旧的噪点贴图函数留成兼容壳，内部改为纯色，
//    这样十个场景不用逐个改调用点，但产出立刻干净。
export function flatTex(color) {
  return tex(8, 8, (g) => { g.fillStyle = color; g.fillRect(0, 0, 8, 8); });
}

