import * as THREE from "./vendor/three.module.min.js";
import { createScene } from "./scene3d.js";

// ---------------------------------------------------------------- 材质小工具
const M = (color, opts) => new THREE.MeshToonMaterial({ color, ...(opts || {}) });

function boxMesh(w, h, d, color, x = 0, y = 0, z = 0, opts) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M(color, opts));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------- 场景内容
const room = { x0: -7, x1: 7, z0: -6, z1: 6, h: 3 };

const props = [
  {
    id: "s_desk", x: 2.2, z: -2.2, w: 4.6, d: 1.5, h: 0.76, color: "#9aa3ad",
    interact: { x: 2.2, z: 0.2 },
    build: () => {
      const g = new THREE.Group();
      g.add(boxMesh(4.6, 0.1, 1.5, "#b9b4ac", 0, 0.76, 0));
      g.add(boxMesh(4.3, 0.68, 1.3, "#8f9aa3", 0, 0.38, 0));
      g.add(boxMesh(4.4, 0.04, 1.4, "#cfd3d8", 0, 0.72, 0));
      // 显示器
      g.add(boxMesh(0.95, 0.6, 0.08, "#33414f", 0.55, 1.15, -0.1));
      g.add(boxMesh(0.18, 0.28, 0.18, "#6b7480", 0.55, 0.92, -0.1));
      // 登记簿 + 笔
      g.add(boxMesh(0.42, 0.04, 0.3, "#fbfaf7", -1.1, 0.83, 0.1));
      g.add(boxMesh(0.14, 0.02, 0.02, "#3f4a56", -0.75, 0.83, 0.1));
      return g;
    }
  },
  {
    id: "s_desk2", x: -0.4, z: -1.2, w: 1.5, d: 2.6, h: 0.76, color: "#9aa3ad",
    build: () => {
      const g = new THREE.Group();
      g.add(boxMesh(1.5, 0.1, 2.6, "#b9b4ac", 0, 0.76, 0));
      g.add(boxMesh(1.3, 0.68, 2.4, "#8f9aa3", 0, 0.38, 0));
      return g;
    }
  },
  {
    id: "s_phone", x: 1.05, z: -2.35, w: 0.4, d: 0.3, h: 0.14, color: "#3f4a56",
    interact: { x: 1.05, z: 0.0 },
    build: () => {
      const g = new THREE.Group();
      g.add(boxMesh(0.4, 0.1, 0.3, "#3f4a56", 0, 0.81, 0));
      g.add(boxMesh(0.12, 0.06, 0.26, "#2b323a", 0, 0.88, 0));
      g.add(boxMesh(0.36, 0.07, 0.09, "#4b5563", 0, 0.9, -0.06));
      return g;
    }
  },
  {
    id: "s_chair", x: 2.2, z: -3.5, w: 0.7, d: 0.7, h: 1.0, color: "#5b6672",
    build: () => {
      const g = new THREE.Group();
      g.add(boxMesh(0.62, 0.1, 0.6, "#5b6672", 0, 0.5, 0));
      g.add(boxMesh(0.62, 0.6, 0.08, "#5b6672", 0, 0.8, -0.26));
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 10), M("#3f4a56")));
      g.children[2].position.y = 0.25;
      return g;
    }
  },
  {
    id: "s_bench", x: 1.6, z: 2.2, w: 1.8, d: 0.55, h: 0.45, color: "#a9805a",
    build: () => {
      const g = new THREE.Group();
      g.add(boxMesh(1.8, 0.09, 0.5, "#b98b5e", 0, 0.45, 0));
      for (const s of [-1, 1]) {
        g.add(boxMesh(0.1, 0.45, 0.45, "#8f7a5e", s * 0.75, 0.22, 0));
      }
      return g;
    }
  },
  {
    id: "s_cabinet", x: -5.9, z: -5.3, w: 1.1, d: 0.6, h: 1.8, color: "#cfd6de",
    build: () => {
      const g = new THREE.Group();
      g.add(boxMesh(1.1, 1.8, 0.6, "#cfd6de", 0, 0.9, 0));
      for (let i = 0; i < 3; i++) {
        g.add(boxMesh(1.0, 0.48, 0.04, "#dde3ea", 0, 0.35 + i * 0.55, 0.31));
        g.add(boxMesh(0.16, 0.05, 0.05, "#6b7480", 0, 0.35 + i * 0.55, 0.35));
      }
      return g;
    }
  },
  {
    id: "s_water", x: 5.9, z: -5.2, w: 0.55, d: 0.5, h: 1.35, color: "#eef1f4",
    build: () => {
      const g = new THREE.Group();
      g.add(boxMesh(0.55, 0.95, 0.5, "#eef1f4", 0, 0.48, 0));
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.42, 16), M("#cbe3f2")));
      g.children[1].position.y = 1.15;
      return g;
    }
  },
  {
    id: "s_board", x: -6.78, z: -1.0, w: 0.1, d: 2.4, h: 1.3, color: "#f2f1ec",
    interact: { x: -5.6, z: -1.0 },
    build: () => {
      const g = new THREE.Group();
      g.add(boxMesh(0.1, 1.3, 2.4, "#f2f1ec", 0, 1.75, 0));
      g.add(boxMesh(0.12, 0.16, 2.4, "#2f4a6d", 0, 2.35, 0));
      const cols = ["#ffffff", "#fdf3e3", "#eef4ff", "#ffffff"];
      for (let i = 0; i < 4; i++) {
        const p = boxMesh(0.03, 0.34, 0.52, cols[i], 0.07, 1.95 - Math.floor(i / 2) * 0.5, -0.56 + (i % 2) * 0.58);
        g.add(p);
      }
      return g;
    }
  },
  {
    id: "s_door", x: 6.86, z: 1.2, w: 0.1, d: 1.1, h: 2.2, color: "#a88a68",
    interact: { x: 5.7, z: 1.2 },
    build: () => {
      const g = new THREE.Group();
      g.add(boxMesh(0.1, 2.2, 1.1, "#a88a68", 0, 1.1, 0));
      g.add(boxMesh(0.06, 0.5, 0.85, "#b99a76", 0, 1.6, 0));
      g.add(boxMesh(0.06, 0.6, 0.85, "#b99a76", 0, 0.75, 0));
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), M("#e3c98d"));
      knob.position.set(-0.07, 1.05, 0.36);
      g.add(knob);
      return g;
    }
  },
  {
    id: "s_bin", x: -3.6, z: 4.4, w: 0.5, d: 0.5, h: 0.8, color: "#6b7480",
    build: () => {
      const g = new THREE.Group();
      g.add(boxMesh(0.24, 0.75, 0.4, "#6b7480", -0.13, 0.4, 0));
      g.add(boxMesh(0.24, 0.75, 0.4, "#4a7fa5", 0.13, 0.4, 0));
      return g;
    }
  },
  {
    id: "s_mat", x: 0.2, z: 4.9, w: 1.6, d: 0.9, h: 0.03, color: "#b8b2a6", passable: true,
    build: () => boxMesh(1.6, 0.03, 0.9, "#b8b2a6", 0, 0.015, 0)
  }
];

// 障碍 = 家具 + 三面墙
const obstacles = props.filter((p) => !p.passable).map((p) => ({ x: p.x, z: p.z, w: p.w, d: p.d }));
obstacles.push({ x: 0, z: -6, w: 14, d: 0.4 });
obstacles.push({ x: -7, z: 0, w: 0.4, d: 12 });
obstacles.push({ x: 7, z: 0, w: 0.4, d: 12 });

const scene = createScene({
  mount: document.getElementById("stage"),
  room,
  props,
  obstacles,
  characters: [],
  actor: { x: 0, z: 4.2 },
  onSpot: (p) => { (window.__events = window.__events || []).push(["spot", p.id]); console.log("[spot]", p.id); },
  onPerson: (p) => { (window.__events = window.__events || []).push(["person", p.id]); console.log("[person]", p.id); },
  onArrived: (p) => { (window.__events = window.__events || []).push(["arrived", +p.x.toFixed(2), +p.z.toFixed(2)]); }
});

// 供父页面/测试调用
window.__mini = scene;

// 事件桥：父页面可以下发走位与换场景指令
window.addEventListener("message", (ev) => {
  const d = ev.data || {};
  if (d.type === "actor:move" && d.payload) {
    scene.walkTo(d.payload.x, d.payload.z);
  }
  if (d.type === "actor:teleport" && d.payload) {
    scene.setActor(d.payload.x, d.payload.z);
  }
});
