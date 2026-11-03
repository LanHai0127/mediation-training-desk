// 调解台 · 3D 微缩场景运行时
// -----------------------------------------------------------------------------
// 职责：把「一块微缩底座 + 一个能走的人 + 可点的东西」跑起来。
// 场景数据（房间、家具、站位人物）由外部传入，运行时本身不含任何案子内容。
//
// 关键约定（改了要同步 docs/场景与人物建模提示词.md §1.2）：
//   · 底座 20×20，中心为原点；地面 y=0；人物脚底 origin。
//   · 网格 0.5 单位，A* 八向，斜走要求两个正交格都通。
//   · 障碍按 AABB 膨胀人物半径 0.45。
//   · 点物件/人物只是"走过去"，到位才回调；不做隔空触发。
// -----------------------------------------------------------------------------
import * as THREE from "./vendor/three.module.min.js";

const GRID = 0.5;
const HALF = 9.2;                 // 可站立范围 [-9.2, 9.2]
const COLS = Math.round((HALF * 2) / GRID);
const ACTOR_R = 0.45;
const SPEED = 3.4;
const INTERACT = 2.2;
const EYE_H = 0.9;

const COL = {
  base: "#cfd8dc", baseSide: "#8fa3ad",
  floor: "#e8e6e0", wall: "#f2efe8", wallIn: "#f6f3ec",
  brand: "#2f4a6d", wood: "#b98b5e", metal: "#8f9aa3", dark: "#3f4a56",
  skin: "#e8c9a8", hair: "#2b3138", chair: "#5b6672"
};

function toon(color, opts = {}) {
  return new THREE.MeshToonMaterial({ color, ...opts });
}

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cyl(r1, r2, h, mat, x = 0, y = 0, z = 0, seg = 16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ------------------------------------------------------------------ 主角
function makeActor() {
  const g = new THREE.Group();
  const bodyMat = toon("#2f4a6d");
  const pants = toon("#2b3542");

  const torso = box(0.52, 0.66, 0.3, bodyMat, 0, 1.02, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 16), toon(COL.skin));
  head.position.set(0, 1.5, 0);
  head.castShadow = true;
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.175, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), toon(COL.hair));
  hair.position.set(0, 1.53, 0);
  const badge = box(0.09, 0.07, 0.01, toon("#ffffff"), -0.13, 1.18, 0.16);

  const arms = [];
  const legs = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(s * 0.33, 1.28, 0);
    const upper = cyl(0.065, 0.06, 0.58, bodyMat, 0, -0.29, 0, 12);
    arm.add(upper);
    g.add(arm);
    arms.push(arm);

    const leg = new THREE.Group();
    leg.position.set(s * 0.14, 0.62, 0);
    leg.add(cyl(0.085, 0.07, 0.6, pants, 0, -0.3, 0, 12));
    const shoe = box(0.17, 0.09, 0.3, toon("#23282e"), 0, -0.62, 0.04);
    leg.add(shoe);
    g.add(leg);
    legs.push(leg);
  }

  g.add(torso, head, hair, badge);
  g.userData.parts = { arms, legs, torso, head };
  return g;
}

// ------------------------------------------------------------------ 站位人物
function makePerson(o) {
  const g = new THREE.Group();
  const cloth = toon(o.color || "#7c8a99");
  const sit = o.pose === "sit";
  const s = o.scale || 1;

  const torso = box(0.46 * s, 0.58 * s, 0.28 * s, cloth, 0, (sit ? 0.86 : 1.0) * s, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155 * s, 18, 14), toon(COL.skin));
  head.position.set(0, (sit ? 1.2 : 1.34) * s, 0);
  head.castShadow = true;
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.16 * s, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.56),
    toon(o.hair || COL.hair));
  hair.position.set(0, (sit ? 1.23 : 1.37) * s, 0);

  for (const sd of [-1, 1]) {
    const leg = cyl(0.075 * s, 0.06 * s, sit ? 0.44 : 0.58, toon(o.pants || "#3c4652"),
      sd * 0.11 * s, (sit ? 0.42 : 0.32) * s, sit ? 0.16 * s : 0, 10);
    if (sit) { leg.rotation.x = -1.15; }
    g.add(leg);
    g.add(cyl(0.055 * s, 0.05 * s, 0.52 * s, cloth, sd * 0.28 * s, (sit ? 1.0 : 1.16) * s, 0, 10));
  }
  g.add(torso, head, hair);
  g.position.set(o.x, 0, o.z);
  g.rotation.y = o.facing || 0;
  return g;
}

// ------------------------------------------------------------------ A*
function buildGrid(obstacles) {
  const blocked = new Uint8Array(COLS * COLS);
  const mark = (x0, z0, x1, z1) => {
    const c0 = Math.max(0, Math.floor((x0 + HALF) / GRID));
    const c1 = Math.min(COLS - 1, Math.ceil((x1 + HALF) / GRID));
    const r0 = Math.max(0, Math.floor((z0 + HALF) / GRID));
    const r1 = Math.min(COLS - 1, Math.ceil((z1 + HALF) / GRID));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) { blocked[r * COLS + c] = 1; }
    }
  };
  for (const o of obstacles) {
    mark(o.x - o.w / 2 - ACTOR_R, o.z - o.d / 2 - ACTOR_R,
         o.x + o.w / 2 + ACTOR_R, o.z + o.d / 2 + ACTOR_R);
  }
  return blocked;
}

const cell = (v) => Math.max(0, Math.min(COLS - 1, Math.floor((v + HALF) / GRID)));
const center = (i) => i * GRID - HALF + GRID / 2;

function freeNear(blocked, c, r) {
  if (!blocked[r * COLS + c]) { return [c, r]; }
  for (let d = 1; d < 14; d++) {
    for (let dr = -d; dr <= d; dr++) {
      for (let dc = -d; dc <= d; dc++) {
        if (Math.abs(dr) !== d && Math.abs(dc) !== d) { continue; }
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= COLS || rr >= COLS) { continue; }
        if (!blocked[rr * COLS + cc]) { return [cc, rr]; }
      }
    }
  }
  return null;
}

function astar(blocked, from, to) {
  const key = (c, r) => r * COLS + c;
  const open = [from];
  const gScore = new Float32Array(COLS * COLS).fill(Infinity);
  const came = new Int32Array(COLS * COLS).fill(-1);
  const closed = new Uint8Array(COLS * COLS);
  const h = (c, r) => Math.hypot(c - to[0], r - to[1]);
  gScore[key(...from)] = 0;

  while (open.length) {
    let bi = 0, bf = Infinity;
    for (let i = 0; i < open.length; i++) {
      const [c, r] = open[i];
      const f = gScore[key(c, r)] + h(c, r);
      if (f < bf) { bf = f; bi = i; }
    }
    const cur = open.splice(bi, 1)[0];
    const [cc, rr] = cur;
    const ck = key(cc, rr);
    if (cc === to[0] && rr === to[1]) {
      const path = [cur];
      let k = ck;
      while (came[k] >= 0) { const prev = came[k]; path.unshift([prev % COLS, Math.floor(prev / COLS)]); k = prev; }
      return path;
    }
    closed[ck] = 1;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) { continue; }
        const nc = cc + dc, nr = rr + dr;
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= COLS) { continue; }
        if (blocked[nr * COLS + nc]) { continue; }
        if (dr && dc && (blocked[rr * COLS + nc] || blocked[nr * COLS + cc])) { continue; } // 不切角
        const nk = nr * COLS + nc;
        if (closed[nk]) { continue; }
        const ng = gScore[ck] + (dr && dc ? 1.414 : 1);
        if (ng < gScore[nk]) {
          gScore[nk] = ng;
          came[nk] = ck;
          if (!open.some(([oc, orr]) => oc === nc && orr === nr)) { open.push([nc, nr]); }
        }
      }
    }
  }
  return null;
}

// ------------------------------------------------------------------ 场景
export function createScene(opts) {
  const host = opts.mount;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(opts.sky || "#dfe7ea");
  scene.fog = new THREE.FogExp2(opts.fog || "#cfdbe0", 0.0075);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.98;
  host.appendChild(renderer.domElement);

  // 光
  const hemi = new THREE.HemisphereLight("#eef6ff", "#b8b2a6", 0.42);
  const sun = new THREE.DirectionalLight("#fff1dc", 2.6);
  sun.position.set(-9, 15, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  const sc = sun.shadow.camera;
  sc.left = -14; sc.right = 14; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 48;
  const fill = new THREE.DirectionalLight("#bcd7ea", 0.85);
  fill.position.set(11, 7, -10);
  scene.add(hemi, sun, fill);

  // 底座
  const base = box(20, 0.55, 20, toon(opts.baseColor || COL.base), 0, -0.275, 0);
  base.receiveShadow = true;
  const sideMat = toon(COL.baseSide);
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(20.02, 0.18, 20.02), sideMat);
  skirt.position.y = -0.5;
  scene.add(base, skirt);

  // 地面：用 canvas 现画一张地砖，比纯色更像"模型"
  function floorTexture(tint) {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d");
    g.fillStyle = tint || "#ece9e2";
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = "rgba(150,142,128,.35)";
    g.lineWidth = 2.5;
    for (let i = 0; i <= 4; i++) {
      const p = i * 64;
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 256); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(256, p); g.stroke();
    }
    g.fillStyle = "rgba(255,255,255,.14)";
    g.fillRect(0, 0, 256, 3);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(7, 7);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }

  const floorMat = toon(opts.floorColor || COL.floor, { map: floorTexture(opts.floorColor) });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.001;
  floor.receiveShadow = true;
  scene.add(floor);

  // 墙（前墙不建，方便看进去）
  const wallMat = toon(opts.wallColor || COL.wall, { side: THREE.DoubleSide });
  const room = opts.room; // {x0,x1,z0,z1,h}
  const addWall = (w, h, d, x, y, z) => {
    const m = box(w, h, d, wallMat, x, y, z);
    m.castShadow = true;
    scene.add(m);
  };
  const RW = room.x1 - room.x0, RD = room.z1 - room.z0, RH = room.h;
  addWall(RW, RH, 0.18, (room.x0 + room.x1) / 2, RH / 2, room.z0);      // 后
  addWall(0.18, RH, RD, room.x0, RH / 2, (room.z0 + room.z1) / 2);      // 左
  addWall(0.18, RH, RD, room.x1, RH / 2, (room.z0 + room.z1) / 2);      // 右

  // 墙裙：一条 0.9 高的深色下摆，房间立刻有"装修过"的感觉
  const skirtMat = toon(opts.skirtColor || "#ddd8cd");
  scene.add(box(RW, 0.9, 0.06, skirtMat, (room.x0 + room.x1) / 2, 0.45, room.z0 + 0.12));
  scene.add(box(0.06, 0.9, RD, skirtMat, room.x0 + 0.12, 0.45, (room.z0 + room.z1) / 2));
  scene.add(box(0.06, 0.9, RD, skirtMat, room.x1 - 0.12, 0.45, (room.z0 + room.z1) / 2));

  // 道具
  const pickable = new THREE.Group();
  scene.add(pickable);
  const propById = new Map();
  for (const p of opts.props || []) {
    const holder = new THREE.Group();
    holder.position.set(p.x, 0, p.z);
    holder.rotation.y = p.rot || 0;
    const mesh = p.build ? p.build(THREE, toon) : box(p.w || 0.6, p.h || 0.6, p.d || 0.6, toon(p.color || COL.wood), 0, (p.h || 0.6) / 2, 0);
    holder.add(mesh);
    mesh.traverse((o) => { if (o.isMesh) { o.userData.propId = p.id; } });
    scene.add(holder);
    pickable.add(holder);
    propById.set(p.id, { data: p, obj: holder, baseY: 0 });
  }

  // 站位人物
  const people = new Map();
  for (const c of opts.characters || []) {
    const g = makePerson(c);
    g.traverse((o) => { if (o.isMesh) { o.userData.personId = c.id; } });
    scene.add(g);
    pickable.add(g);
    people.set(c.id, g);
  }

  // 主角
  const actor = makeActor();
  actor.position.set(opts.actor?.x ?? 0, 0, opts.actor?.z ?? 4);
  scene.add(actor);

  // 选点圈
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.5, 40),
    new THREE.MeshBasicMaterial({ color: "#2f6feb", transparent: true, opacity: 0.5, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  ring.visible = false;
  scene.add(ring);

  const blocked = buildGrid(opts.obstacles || opts.props || []);
  const state = {
    path: [], target: null, pending: null, walking: false, phase: 0,
    camYaw: Math.PI / 4, camPitch: 0.74, camDist: 26,
    focus: new THREE.Vector3(actor.position.x, EYE_H, actor.position.z)
  };

  // ---------------------------------------------------------------- 相机
  function placeCamera() {
    const d = state.camDist;
    const y = Math.sin(state.camPitch) * d;
    const r = Math.cos(state.camPitch) * d;
    camera.position.set(
      state.focus.x + Math.sin(state.camYaw) * r,
      Math.max(1.2, y),
      state.focus.z + Math.cos(state.camYaw) * r
    );
    camera.lookAt(state.focus);
  }

  // ---------------------------------------------------------------- 输入
  let dragging = false, dragMoved = 0, lastX = 0, lastY = 0, lastInteract = 0;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();

  function pickAt(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(pickable.children, true);
    if (hits.length) { return hits[0].object.userData; }
    return {};
  }

  function groundAt(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    if (ray.ray.intersectPlane(groundPlane, hitPoint)) { return hitPoint.clone(); }
    return null;
  }

  const el = renderer.domElement;
  el.addEventListener("pointerdown", (ev) => {
    dragging = true; dragMoved = 0; lastX = ev.clientX; lastY = ev.clientY;
    el.setPointerCapture?.(ev.pointerId);
  });
  el.addEventListener("pointermove", (ev) => {
    if (dragging) {
      const dx = ev.clientX - lastX, dy = ev.clientY - lastY;
      dragMoved += Math.abs(dx) + Math.abs(dy);
      lastX = ev.clientX; lastY = ev.clientY;
      if (dragMoved > 6) {
        state.camYaw -= dx * 0.006;
        state.camPitch = Math.max(0.18, Math.min(1.35, state.camPitch + dy * 0.004));
        state.idleSince = performance.now();
        placeCamera();
      }
      return;
    }
    const now = performance.now();
    if (now - lastInteract < 60) { return; }
    lastInteract = now;
    const hit = pickAt(ev);
    highlight(hit.propId || hit.personId || null);
    el.style.cursor = (hit.propId || hit.personId) ? "pointer" : "default";
  });
  el.addEventListener("pointerup", (ev) => {
    const wasDrag = dragMoved > 8;
    dragging = false;
    if (wasDrag) { return; }
    const hit = pickAt(ev);
    if (hit.personId) { goToPerson(hit.personId); return; }
    if (hit.propId) { goToProp(hit.propId); return; }
    const p = groundAt(ev);
    if (p) { walkTo(p.x, p.z); }
  });
  el.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    state.camDist = Math.max(8, Math.min(30, state.camDist + ev.deltaY * 0.012));
    state.idleSince = performance.now();
    placeCamera();
  }, { passive: false });

  // 触屏双指缩放
  let pinch = 0;
  el.addEventListener("touchmove", (ev) => {
    if (ev.touches.length !== 2) { return; }
    const d = Math.hypot(ev.touches[0].clientX - ev.touches[1].clientX,
                         ev.touches[0].clientY - ev.touches[1].clientY);
    if (pinch) {
      state.camDist = Math.max(8, Math.min(30, state.camDist - (d - pinch) * 0.05));
      placeCamera();
    }
    pinch = d;
  }, { passive: true });
  el.addEventListener("touchend", () => { pinch = 0; });

  // ---------------------------------------------------------------- 高亮
  let hot = null;
  function highlight(id) {
    if (hot === id) { return; }
    if (hot) {
      const old = propById.get(hot);
      if (old) {
        old.obj.traverse((o) => {
          if (o.isMesh && o.material && o.material.emissive) { o.material.emissive.setHex(0x000000); }
        });
      }
    }
    hot = id;
    if (id) {
      const cur = propById.get(id);
      if (cur) {
        cur.obj.traverse((o) => {
          if (o.isMesh && o.material && o.material.emissive) { o.material.emissive.setHex(0x223344); }
        });
      }
    }
  }

  // ---------------------------------------------------------------- 寻路
  function walkTo(x, z, pending) {
    const from = [cell(actor.position.x), cell(actor.position.z)];
    const goal = freeNear(blocked, cell(x), cell(z));
    if (!goal) { fire("actor:blocked", {}); return false; }
    const cells = astar(blocked, freeNear(blocked, ...from) || from, goal);
    if (!cells || cells.length < 2) {
      state.path = [];
      return false;
    }
    const pts = cells.map(([c, r]) => new THREE.Vector3(center(c), 0, center(r)));
    const visible = (a, b) => {
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (GRID * 0.5));
      for (let i = 0; i <= steps; i++) {
        const tt = steps ? i / steps : 0;
        const c = cell(a.x + (b.x - a.x) * tt);
        const r = cell(a.z + (b.z - a.z) * tt);
        if (blocked[r * COLS + c]) { return false; }
      }
      return true;
    };
    const straight = [];
    let anchor = 0;
    while (anchor < pts.length - 1) {
      let far = pts.length - 1;
      for (; far > anchor + 1; far--) {
        if (visible(pts[anchor], pts[far])) { break; }
      }
      straight.push(pts[far]);
      anchor = far;
    }
    if (straight.length) { pts.length = 0; pts.push(...straight); }
    // 去掉共线的中间点：A* 给的是格路径，直接走会一抖一抖
    const path = [pts[0] || state.path[0] || new THREE.Vector3()];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = path[path.length - 1], b = pts[i], c = pts[i + 1];
      const cross = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
      if (Math.abs(cross) > 1e-6) { path.push(b); }
    }
    if (pts.length > 1) { path.push(pts[pts.length - 1]); }
    state.path = path.filter(Boolean);
    state.pending = pending || null;
    ring.position.set(x, 0.02, z);
    ring.visible = true;
    return true;
  }

  function goToProp(id) {
    const p = propById.get(id);
    if (!p) { return; }
    const d = p.data;
    const ip = d.interact || { x: d.x, z: d.z + (d.d || 0.8) / 2 + 1.0 };
    walkTo(ip.x, ip.z, { type: "spot", id });
  }

  function goToPerson(id) {
    const g = people.get(id);
    if (!g) { return; }
    const dx = g.position.x - actor.position.x;
    const dz = g.position.z - actor.position.z;
    const len = Math.hypot(dx, dz) || 1;
    walkTo(g.position.x - dx / len * 1.5, g.position.z - dz / len * 1.5, { type: "person", id });
  }

  function fire(type, payload) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ source: "mini3d", type, payload }, "*");
    }
    const cb = { "spot:click": opts.onSpot, "person:click": opts.onPerson, "actor:arrived": opts.onArrived }[type];
    if (cb) { cb(payload); }
  }

  // ---------------------------------------------------------------- 循环
  const clock = new THREE.Clock();
  let idleSince = performance.now();

  function tick() {
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;

    // 走位
    if (state.path.length) {
      const next = state.path[0];
      const dx = next.x - actor.position.x, dz = next.z - actor.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.12) {
        state.path.shift();
        if (!state.path.length) {
          const want = Math.atan2(actor.rotation.y >= 0 ? 0 : 0, 1);
          ring.visible = false;
          const pending = state.pending;
          state.pending = null;
          fire("actor:arrived", { x: actor.position.x, z: actor.position.z });
          if (pending) { fire(pending.type === "spot" ? "spot:click" : "person:click", { id: pending.id }); }
        }
      } else {
        const step = Math.min(dist, SPEED * dt);
        actor.position.x += (dx / dist) * step;
        actor.position.z += (dz / dist) * step;
        const wantYaw = Math.atan2(dx, dz);
        let diff = wantYaw - actor.rotation.y;
        while (diff > Math.PI) { diff -= Math.PI * 2; }
        while (diff < -Math.PI) { diff += Math.PI * 2; }
        actor.rotation.y += Math.max(-0.14, Math.min(0.14, diff));
        state.phase += dt * 7.5;
      }
      state.walking = true;
    } else {
      state.walking = false;
      state.phase += dt * 1.6;
    }

    // 摆臂 / 走路起伏
    const parts = actor.userData.parts;
    const swing = state.walking ? Math.sin(state.phase) * 0.5 : Math.sin(state.phase) * 0.03;
    parts.arms[0].rotation.x = swing;
    parts.arms[1].rotation.x = -swing;
    parts.legs[0].rotation.x = -swing * 0.9;
    parts.legs[1].rotation.x = swing * 0.9;
    actor.position.y = state.walking ? Math.abs(Math.sin(state.phase)) * 0.035 : 0;

    // 站位人物呼吸
    people.forEach((g, id) => {
      const ph = (id.charCodeAt(1) || 0) * 0.7;
      g.position.y = Math.sin(t * 1.3 + ph) * 0.008;
    });

    // 灯微呼吸
    sun.intensity = 2.6 * (1 + Math.sin(t * 1.7) * 0.004);

    // 相机跟随（死区 + 回正）
    const dxc = actor.position.x - state.focus.x;
    const dzc = actor.position.z - state.focus.z;
    if (Math.hypot(dxc, dzc) > 3) {
      state.focus.x += dxc * 0.08;
      state.focus.z += dzc * 0.08;
    } else {
      state.focus.x += dxc * 0.03;
      state.focus.z += dzc * 0.03;
    }
    state.focus.y += (EYE_H - state.focus.y) * 0.1;

    if (performance.now() - idleSince > 2000) {
      const backYaw = Math.PI / 4, backPitch = 0.72;
      state.camYaw += (backYaw - state.camYaw) * 0.02;
      state.camPitch += (backPitch - state.camPitch) * 0.02;
    }
    placeCamera();

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  function resize() {
    const w = host.clientWidth || window.innerWidth;
    const h = host.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    placeCamera();
  }
  window.addEventListener("resize", resize);

  resize();
  placeCamera();
  requestAnimationFrame(tick);

  return {
    walkTo,
    goToProp,
    goToPerson,
    actorPos: () => ({ x: actor.position.x, z: actor.position.z }),
    stats: () => ({ path: state.path.length, walking: state.walking, camDist: state.camDist }),
    setActor: (x, z) => { actor.position.set(x, 0, z); state.focus.set(x, EYE_H, z); placeCamera(); },
    resize
  };
}
