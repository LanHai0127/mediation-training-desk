// app.js · 外壳：把六个 UI 模块和十场 3D 场景串成一条主线
// -----------------------------------------------------------------------------
// 这一层只做五件事：
//   ① 首屏：自己建一个 three 场景当"看板背景"，boot.js 把「开始调解」一块板挂上来；
//   ② 入场：点开始 → 加载页（十场逐个预热）→ 开场运镜 → 交相机给场景；
//   ③ 场景：iframe 载入 scenes/*.html，flight 每帧把机位 postMessage 下发；
//   ④ 手机：phone.js 挂在右上角，地图页 teleport → flight.transfer → 换 iframe；
//   ⑤ 收尾：结案 → 评价卡（review.js）→ 复盘时间轴（replay.js）→ 点节点飞回机位。
//      点人物 → 走近 → 问话面板（dialog.js）→ 回答进复盘节点与手机笔记。
//
// 关键约束：iframe 里外是两套 three 上下文，flight 拿不到那边的 camera，
// 只能靠 postMessage 下发机位；场景侧在 scene3d.js 里装了 camera:owner / camera:set 的监听。
// -----------------------------------------------------------------------------
import * as THREE from "../scenes/vendor/three.module.min.js";
import { PAL as C } from "../scenes/kit.js";
import { createFlight, paintClouds } from "./flight.js";
import { createBoot } from "./boot.js";
import { createPhone } from "./phone.js";
import { createReview, scorePlan } from "./review.js";
import { createReplay } from "./replay.js";
import { createDialog } from "./dialog.js";

const stage = document.getElementById("stage");
const bootHost = document.getElementById("boot");
const frame = document.getElementById("frame");
const hintEl = document.getElementById("hint");
const phoneMount = document.getElementById("phoneMount");
const loadEl = document.getElementById("load");
const loadCur = document.getElementById("loadCur");
const loadFill = document.getElementById("loadFill");
const loadBar = document.getElementById("loadBar");
const loadPct = document.getElementById("loadPct");
const loadCount = document.getElementById("loadCount");
const loadState = document.getElementById("loadState");
const loadDots = document.getElementById("loadDots");
const loadCloud = document.getElementById("loadCloud");
const reviewLayer = document.getElementById("reviewLayer");
const replayLayer = document.getElementById("replayLayer");
const replayHost = document.getElementById("replayHost");
const replayClose = document.getElementById("replayClose");
const rotateTip = document.getElementById("rotateTip");
const rotateTipClose = document.getElementById("rotateTipClose");

// ---------------------------------------------------------------- 设备判定
// 手机降级只在“真的像手机”时启用：触摸 / 窄边 ≤600。桌面（含 1440×900 的
// 回归测试）永远走原来的“十场全绿再进”，行为不因移动端优化而变。
const IS_TOUCH = (() => {
  try {
    return matchMedia("(pointer: coarse)").matches || ("ontouchstart" in window);
  } catch (err) {
    return "ontouchstart" in window;
  }
})();
const IS_MOBILE = (() => {
  const shortSide = Math.min(innerWidth || 0, innerHeight || 0);
  return IS_TOUCH || shortSide <= 600;
})();

// ---------------------------------------------------------------- 场景表
// 顺序 = 加载页预热顺序；actor 是落地时主角站的位置，facing 是朝向（弧度）。
const SCENES = {
  duty: { file: "scenes/duty.html", name: "派出所值班室", actor: { x: 0.9, z: 2.6 }, facing: Math.PI },
  mediation: { file: "scenes/mediation.html", name: "调解室", actor: { x: -0.6, z: 2.6 }, facing: Math.PI },
  wall: { file: "scenes/wall.html", name: "院墙地界", actor: { x: 0, z: 3.6 }, facing: Math.PI },
  yard: { file: "scenes/yard.html", name: "张家院", actor: { x: -2.2, z: 3.2 }, facing: 1.2 },
  lihome: { file: "scenes/lihome.html", name: "李家院", actor: { x: -0.6, z: 3.4 }, facing: 0.4 },
  village: { file: "scenes/village.html", name: "村委会", actor: { x: 0.4, z: 3.0 }, facing: 0 },
  shop: { file: "scenes/shop.html", name: "村口小卖部", actor: { x: 0.2, z: 5.2 }, facing: 0 },
  thresh: { file: "scenes/thresh.html", name: "晒谷场", actor: { x: -1.2, z: 2.8 }, facing: 0.6 },
  judicial: { file: "scenes/judicial.html", name: "镇司法所", actor: { x: 0.6, z: 3.0 }, facing: 0 },
  court: { file: "scenes/court.html", name: "社区篮球场", actor: { x: 0.4, z: 3.6 }, facing: 0 }
};
const SCENE_ORDER = Object.keys(SCENES);

// 地图页从第一天起就列全十场：每个场景是室内还是室外，只影响那一行的说明。
const SCENE_SETTING = {
  duty: "room", mediation: "room", judicial: "room", village: "room",
  wall: "yard", yard: "yard", lihome: "yard", shop: "yard", thresh: "yard", court: "yard"
};

// 三个案子是同时接到的：案卷 title 偏文学（三十公分 / 六点半的球场），
// 首屏和手机列表还需要一个一眼认得的短名。
const CASE_NAME = {
  case_06_wall: "院墙案",
  case_05_court: "广场舞案",
  case_00_flame: "消防通道案"
};

// 首屏镜头：S0 值班室本体当背景时，iframe 里的相机先抬到高处俯瞰整间屋子。
// 「开始游戏」之后云散，用 2.4 秒缓动下移到常规俯视位，再把相机交还场景。
const BOARD_VIEW = { pos: [0, 17.5, 11], look: [0, 0.3, 0], fov: 42 };
const DUTY_VIEW = { pos: [0, 9.2, 13.2], look: [0, 1.0, 0], fov: 42 };
const BOARD_EXIT_MS = 2400;

// 云朵传送的落位：抬升到 27.5 的俯瞰位之后，落点**也在上空**，不降到贴地高度。
// 后撤 10m + 高 13m → 相机 y=13、离主角 ≈16.4m、俯角 ≈52°，比首屏的 17.5 略低，
// 但仍然是明显的俯瞰；落到之后由 onTransfer 交还自由视角（还能自己拖/缩）。
// 后撤没有给到 12.5：那样人物离相机 20m+，头顶名签会提前吃到"远距离淡出"，落地第一眼没名字。
const LAND_DIST = 10;
const LAND_HEIGHT = 13;
// 竖屏手机水平视角窄，后撤多一点才装得下同一片院子
function landViewOpts() {
  return (IS_MOBILE && innerHeight > innerWidth)
    ? { dist: 13, height: 14, lookY: 1.1 }
    : { dist: LAND_DIST, height: LAND_HEIGHT, lookY: 1.05 };
}

// 案卷里的地点 id（case.json 的 scenes[].id）与外壳的场景文件名不是一套：
// 案卷用 room / station / boundary / zhang_home…，外壳用 duty / mediation / wall / yard…
// 这份对照表是两边唯一的接缝：手机地图上点的地点，必须能落到一个真的 iframe 页。
const SCENE_ALIAS = {
  station: "duty", room: "mediation", boundary: "wall", zhang_home: "yard",
  li_home: "lihome", village: "village", shop: "shop", threshing: "thresh",
  judicial: "judicial", court: "court"
};

// ---------------------------------------------------------------- 案卷数据
// /api/case/<id> 走的是 game.public_case：facts / scenes / dimensions(只留标签) / parties。
// 关键证据的权重档位（关键 2 / 一般 1）与点位对照，在 case.json 里是
// dimensions[].options[].evidence 那一层；服务端**有意削掉**它（玩家翻控制台就看得到答案），
// 所以这里镜像一张最小的档位表。case.json 以后若直接下发 evidence，这张表自动让位。
const KEY_EVIDENCE = {
  case_06_wall: ["f_archive", "f_marker", "f_wall", "f_rain", "f_e04", "f_e05", "f_e06",
                 "f_e07", "f_e10", "f_e11", "f_e13", "f_e15", "f_e16"],
  case_05_court: ["f_alarm", "f_noise"],
  case_00_flame: ["f_photo", "f_car", "f_fire"]
};
// 场景点位 id → 案卷事实 id（两套命名不同：场景用 s_*，案卷用 f_*）。
// 只有命中的点位才算"关键证据"，其余点位是"普通查看"。
const SPOT_FACT = {
  case_06_wall: {
    s_stone: "f_marker", s_ditch: "f_rain", s_drip: "f_rain",
    s_wallNew: "f_wall", s_wallOld: "f_wall"
  },
  case_05_court: { s_hoop: "f_noise", s_board: "f_rule", s_speaker: "f_noise" }
};

const params = new URLSearchParams(location.search);
const DEFAULT_CASE = params.get("case") || "case_06_wall";

// ---------------------------------------------------------------- 人物地图映射
// tools/gen_person_scenes.py 从 case.json 的 scenes[] + scenes/*.js 的 characters[]
// 生成：每个案子的每个 party 能在哪几张图里找到。它是派生数据，不塞进案卷，
// 改场景后重跑脚本即可；加载失败只少一行标注，不挡主线。
const PERSON_SCENES = { data: null, promise: null };
function loadPersonScenes() {
  if (!PERSON_SCENES.promise) {
    PERSON_SCENES.promise = fetch("./person_scenes.json", { headers: { Accept: "application/json" } })
      .then((res) => {
        if (!res.ok) { throw new Error("HTTP " + res.status); }
        return res.json();
      })
      .then((json) => {
        PERSON_SCENES.data = (json && typeof json === "object") ? json : {};
        return PERSON_SCENES.data;
      })
      .catch((err) => {
        PERSON_SCENES.data = {};
        console.warn("[app] 人物地图映射没取到：" + String((err && err.message) || err)
          + "（案件档案页会显示「暂未安排」）");
        return PERSON_SCENES.data;
      });
  }
  return PERSON_SCENES.promise;
}

// ---------------------------------------------------------------- 首屏的 three
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.96;
stage.appendChild(renderer.domElement);
// 探针要能一眼看出"画布在不在、谁在上面"，和场景侧 __dbg 一个路数
window.__dbg = { THREE, scene: null, camera: null, renderer };

const scene = new THREE.Scene();
scene.background = null;   // 透明，露出下面 iframe 里的真场景
/* 雾关掉：外层只画看板，不要再糊一层背景 */
window.__dbg.scene = scene;

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 400);
camera.position.set(0, 8.5, -6);
camera.lookAt(0, 1.2, 0);
window.__dbg.camera = camera;

scene.add(new THREE.HemisphereLight("#e8f2f8", "#9a8f7c", 1.25));
const sun = new THREE.DirectionalLight("#fff3d9", 2.0);
sun.position.set(-6, 14, 9);
scene.add(sun);

// 首屏的"地台"：一块简单的地板 + 几件家具剪影，让看板下面不是空的
/* 占位地台已删：首屏背景直接用 S0 值班室本体 */


// ---------------------------------------------------------------- 全局状态
const state = {
  mode: "BOARD",
  sceneId: null,
  boot: null,
  phone: null,
  started: false,
  frameReady: false,
  activated: false,
  boardCam: false,    // 首屏：iframe 相机被外壳压在俯瞰位
  camDescent: null,   // 点开始后 2.4s 的俯瞰 → 常规俯视补间
  nodes: [],          // 复盘节点（真实操作）
  seen: new Set(),    // 看过的证据（事实 id）
  clicks: {},         // 点位重复点击计数（连点三次以上算无效点击）
  t0: 0,
  caseId: DEFAULT_CASE,
  caseIndex: [],      // /api/cases 的三条摘要：手机案件页一次列全
  caseLoadSeq: 0,     // 防止快速换案时旧请求把新案数据盖回去
  data: null,
  dataError: "",
  closed: false,
  closedByCase: {},   // 三个案子各结各的：结了一个不能把另外两个也标成已结
  plan: null,
  cam: "board",       // board | host | play —— 谁在写相机（永远只有一套在写）
  dialog: null,       // 当前打开的问话面板
  loading: { active: false, finished: false, done: 0, total: SCENE_ORDER.length,
             pct: 0, cur: "", failed: [],
             // 移动端降级：第一场 ready 就进；其余场在后台串行继续。
             ready: [], early: false, background: false, backgroundDone: false },
  rotateTipShown: false
};
state.t0 = performance.now();

// ---------------------------------------------------------------- flight + boot
const flight = createFlight({
  camera,
  dom: document.body,
  onState: (s) => { state.mode = s; },
  // 转场走完（云散 + 下降落定）→ 把画面与操作权交回玩家。
  // 传送时场景自己不会动相机，这一步不做就会停在俯瞰的高位上。
  onTransfer: () => {
    const def = SCENES[state.sceneId];
    if (!def) { return; }
    frame.style.pointerEvents = "auto";
    // 进场景后外层看板层彻底让开指针（否则它盖在 iframe 上，点地面走不了、拖不动视角）
    yieldStage();
    frame.classList.add("on");
    state.frameReady = true;
    phone?.setScene?.(state.sceneId);
    showPhoneUI();
    startPlay(def);                 // 落地即把机位交给场景内的自由视角
  }
});

const boot = createBoot({
  camera, flight, dom: bootHost, scene,
  actorPos: SCENES.duty.actor, facing: SCENES.duty.facing,
  // 点「开始调解」直接进加载页；运镜等加载页走完再放（boot.start）
  onStartClick: () => startGame(),
  // 云散后不再直接 enterScene：先让 iframe 的相机用 2.4s 从俯瞰位下移，
  // 运镜结束（boot 的 onStart）再把相机交还场景。
  onStart: () => finishBoardExit()
});
state.boot = boot;

// ---------------------------------------------------------------- 小工具
function showHint(text) {
  hintEl.textContent = text;
  hintEl.classList.add("on");
  clearTimeout(showHint._t);
  showHint._t = setTimeout(() => hintEl.classList.remove("on"), 4200);
}

// ---------------------------------------------------------------- 横屏轻提示
// 竖屏下 3D 视野和拖动余量都窄；给一句不打断操作的提示，可关、记一次。
// 460ms 后才出现：避开进场景的运镜，别在镜头还在飞的时候抢眼。
const ROTATE_TIP_KEY = "tjt.rotateTip.v1";
let rotateTipTimer = 0;
function rotateTipDismissed() {
  try { return localStorage.getItem(ROTATE_TIP_KEY) === "1"; } catch (err) { return true; }
}
function hideRotateTip(persist) {
  clearTimeout(rotateTipTimer);
  if (!rotateTip) { return; }
  rotateTip.classList.remove("on");
  rotateTipTimer = setTimeout(() => { rotateTip.hidden = true; }, 260);
  if (persist) {
    try { localStorage.setItem(ROTATE_TIP_KEY, "1"); } catch (err) { /* 无痕模式 */ }
  }
}
function maybeShowRotateTip() {
  if (!rotateTip || !IS_MOBILE || rotateTipDismissed()) { return; }
  if (innerWidth >= innerHeight) { return; }          // 已经横屏了，不用提示
  rotateTip.hidden = false;
  requestAnimationFrame(() => rotateTip.classList.add("on"));
  clearTimeout(rotateTipTimer);
  rotateTipTimer = setTimeout(() => hideRotateTip(false), 9000);
}
rotateTipClose?.addEventListener("click", () => hideRotateTip(true));
addEventListener("resize", () => { if (innerWidth >= innerHeight) { hideRotateTip(false); } });

function sendToFrame(type, payload) {
  const w = frame.contentWindow;
  if (!w) { return; }
  try { w.postMessage({ source: "host", type, payload }, "*"); } catch (err) { /* 跨源或已销毁 */ }
}

// ---------------------------------------------------------------- 场景内自由视角
// 进入场景后相机只由 flight 算：app 把鼠标拖拽/滚轮喂给 flight，再把 flight 的 view
// 下发给 iframe。这里刻意不每帧灌 camera:set —— 只有机位真的变了才发。
// 场景侧收到 camera:owner { external:true } 后 placeCamera() 会直接 return，
// 不会再把机位拽回自己的 HOME（两个主人每帧互相覆盖，正是拖不动的根因）。
const playCam = {
  active: false,
  forceUntil: 0,
  px: 1e9, py: 1e9, pz: 1e9,
  lx: 1e9, ly: 1e9, lz: 1e9
};
let playToken = 0;

// 场景层彻底让开：visibility 只隐藏、不塌缩，canvas 的 clientWidth 仍随视口（I3 断言）。
// 不能用 display:none —— 画布尺寸会归零，WebGL 也就废了。
function yieldStage() {
  stage.style.visibility = "hidden";
  stage.style.pointerEvents = "none";
  const cv = stage.querySelector("canvas");
  if (cv) { cv.style.pointerEvents = "none"; }
}

// 竖屏手机：水平视角只有约 20°，4.2 米的默认跟随位会把人怼满屏。
// 往后退到 5.2 米、抬高 0.35 米，同一块屏能看到更多地面和人物关系；
// 横屏 / 桌面保持原机位（桌面回归测试的 3~5 米断言也不受影响）。
function playViewOpts() {
  return (IS_MOBILE && innerHeight > innerWidth) ? { dist: 5.2, height: 2.55 } : {};
}

function readActorPos() {
  try {
    const w = frame.contentWindow;
    const m = w && w.__mini;
    return m ? m.actorPos() : null;
  } catch (err) { return null; }
}

// 只在机位变化（或刚进场景的 1s 内）下发；D6 读的是稳定后的 iframe 相机，
// 此时最后一次下发值 == 外壳相机，零漂移。
function syncPlayCamera(force) {
  if (!playCam.active) { return; }
  const v = flight.view;
  const [px, py, pz] = v.pos;
  const [lx, ly, lz] = v.look;
  const moved = Math.abs(px - playCam.px) + Math.abs(py - playCam.py) + Math.abs(pz - playCam.pz)
    + Math.abs(lx - playCam.lx) + Math.abs(ly - playCam.ly) + Math.abs(lz - playCam.lz) > 0.004;
  if (!force && !moved && performance.now() > playCam.forceUntil) { return; }
  sendToFrame("camera:set", v);
  playCam.px = px; playCam.py = py; playCam.pz = pz;
  playCam.lx = lx; playCam.ly = ly; playCam.lz = lz;
}

function stopPlay() {
  playToken += 1;
  playCam.active = false;
  state.cam = "host";
  flight.endPlay();
}

// 把相机交回场景内的自由视角：场景不再自己 placeCamera，输入经 flight 改机位。
function startPlay(def) {
  if (!def || !state.started || !state.frameReady) { return false; }
  let w = null;
  try { w = frame.contentWindow; } catch (err) { w = null; }
  if (!w || !w.__mini) { return false; }
  playToken += 1;
  state.cam = "play";
  sendToFrame("camera:owner", { external: true });
  flight.beginPlay();
  playCam.active = true;
  playCam.forceUntil = 0;         // 落定时只发一次；之后严格按需（拖动/跟走/缩放）
  bindSceneInput();
  syncPlayCamera(true);
  // 只在第一次真正落地后提示一次横屏，不打断走位（提示层 pointer-events:none）
  if (!state.rotateTipShown) {
    state.rotateTipShown = true;
    setTimeout(maybeShowRotateTip, 1100);
  }
  return true;
}

// 场景自己的 pointerdown/move/up 只负责点选/走位；拖拽和滚轮在这里转成镜头运动。
// 两套监听并存：不 stopPropagation，场景的点击链路（walkTo / spot / person）照常工作。
function bindSceneInput() {
  let w = null, cv = null;
  try {
    w = frame.contentWindow;
    cv = w && w.__dbg && w.__dbg.renderer && w.__dbg.renderer.domElement;
  } catch (err) { return; }
  if (!w || !cv || w.__playInputBound) { return; }
  w.__playInputBound = true;
  // scene3d.js 的 pointerup 里有一处未声明的自由变量 props（命中家具那条分支），
  // 运行时直接抛 ReferenceError，walkTo 还没执行就被掐断 —— 表现就是"换了场景点地面不走"。
  // 这里补一个最小垫片：它只决定"走 goToProp 还是 groundAt"，真正的 interact 坐标
  // 仍由场景自己的 propById 提供，所以证据点位的走位/触发逻辑不变。
  if (!w.props) { w.props = { find: () => ({ interact: true }) }; }
  // 人物组被 scene.add 抢走了父节点（不在 pickable 里）→ 场景自己的点选收不到人。
  // 进场景时补一次结构修复，之后点人走的是场景原链路。
  repairPickable(w);
  const alive = () => playCam.active && state.cam === "play";
  let down = false, lastX = 0, lastY = 0, moved = 0, downAt = 0, fromXZ = null;

  cv.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType === "touch") { return; }        // 触摸走下面的 touch 链路
    if (!alive() || (ev.button != null && ev.button !== 0)) { return; }
    down = true; lastX = ev.clientX; lastY = ev.clientY;
    moved = 0; downAt = performance.now(); fromXZ = readActorPos();
  });
  w.addEventListener("pointermove", (ev) => {
    if (ev.pointerType === "touch") { return; }
    if (!down || !alive()) { return; }
    const dx = ev.clientX - lastX, dy = ev.clientY - lastY;
    lastX = ev.clientX; lastY = ev.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    if (Math.abs(dx) + Math.abs(dy) < 0.5) { return; }
    flight.orbit(dx, dy);
    syncPlayCamera(false);
  });
  const end = () => { down = false; };
  w.addEventListener("pointerup", (ev) => {
    if (ev.pointerType === "touch") { return; }
    const wasClick = down && moved < 10 && performance.now() - downAt < 1200;
    const start = fromXZ;
    down = false;
    if (wasClick && start && ev.button === 0) {
      // 场景的 pointerup 先跑；这里再补一次"按身份取目标"的射线。
      // 不能信场景那边的结果：它取 hits[0]，而墙 / 底座 / 家具描边线（LineSegments）
      // 都在射线里且常常更近，userData 上却没有 personId / propId —— 拿 hits[0] 会得到
      // 空身份，点击就退化成"走到地面点"：点人不开口、点家具不收证据，两个都栽在这。
      const target = pickTargetAt(ev.clientX, ev.clientY);
      if (target && target.kind === "person") {
        startPersonTalk(target.id, { plate: !!target.plate });
        return;
      }
      if (target && target.kind === "prop") {
        // 家具：让场景用它的 interact 点走位，到位由场景发 spot:click（证据记在那里）。
        personTalkTok += 1;          // 这一下不是点人：取消还没落地的"走近某人"
        const a = readActorPos();
        const hit = target.point;
        // 已经站在交互点跟前时 walkTo 会因为路径不足 2 格静默返回 false，
        // 那一下什么都不会发生 —— 直接按"查看"记账，不再等路径。
        if (a && hit && Math.hypot(hit.x - a.x, hit.z - a.z) <= 0.9) {
          handleSpotClick(target.id);
          return;
        }
        // 点证据物件：走得过去就走过去出证据；走不过去必须有一句明确提示（用户：不许静默）
        let ok = false;
        try { ok = w.__mini.goToProp(target.id); } catch (err) { ok = false; }
        if (!ok) { showHint("太远了，走近点再点"); }
        return;
      }
      // 场景的 pointerup 先跑；这里等一拍再确认"人到底动没动"。
      // 点进一个"看得见但走不到"的角落时，A* 给不出路、walkTo 静默返回 false，
      // 表现就是"点地面没反应"——兜底把人送到最近一个走得到的点。
      personTalkTok += 1;            // 这一下是点地面：取消还没落地的"走近某人"
      setTimeout(() => { rescueUnreachableClick(ev.clientX, ev.clientY, start); }, 260);
    }
  });
  w.addEventListener("pointercancel", end);

  cv.addEventListener("wheel", (ev) => {
    if (!alive()) { return; }
    ev.preventDefault();
    flight.zoom(ev.deltaY);
    syncPlayCamera(false);
  }, { passive: false });

  cv.addEventListener("dblclick", () => {
    if (!alive()) { return; }
    flight.resetPlay();
    syncPlayCamera(true);
  });

  // ---- 触摸（真机）：单指拖动转视角、双指捏合缩放。
  // 轻点本身交给场景 scene3d.js 的 touch 链路（走位 / 点人 / 点物件），
  // 这里只补两件宿主才知道的事：点人时走 startPersonTalk（近处也能开面板），
  // 点地面时挂一次“A* 走不到”的兜底。触摸事件和鼠标 pointer 事件都监听，
  // 但 pointer 里已经把 pointerType === "touch" 直接挡掉，不会双重触发。
  const touchDist = (ev) => {
    const a = ev.touches && ev.touches[0], b = ev.touches && ev.touches[1];
    if (!a || !b) { return 0; }
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  };
  let tState = null;
  cv.addEventListener("touchstart", (ev) => {
    if (!alive()) { return; }
    if (ev.touches.length >= 2) {
      tState = { multi: true, pinch: touchDist(ev), moved: 999, t0: performance.now() };
      ev.preventDefault();
      return;
    }
    const t = ev.touches[0];
    if (!t) { return; }
    tState = { multi: false, x: t.clientX, y: t.clientY, x0: t.clientX, y0: t.clientY,
               moved: 0, t0: performance.now(), pinch: 0 };
  }, { passive: false });
  w.addEventListener("touchmove", (ev) => {
    if (!tState || !alive()) { return; }
    if (ev.touches.length >= 2 || tState.multi) {
      if (!tState.multi) {
        tState = { multi: true, pinch: touchDist(ev), moved: 999, t0: performance.now() };
      }
      const d = touchDist(ev);
      if (tState.pinch > 0 && Math.abs(d - tState.pinch) > 0.5) {
        // 两指分开（d 变大）= 拉近：zoom 的 deltaY 用负数
        flight.zoom((tState.pinch - d) * 1.6);
        syncPlayCamera(false);
      }
      tState.pinch = d;
      ev.preventDefault();
      return;
    }
    const t = ev.touches[0];
    if (!t) { return; }
    const dx = t.clientX - tState.x, dy = t.clientY - tState.y;
    tState.x = t.clientX; tState.y = t.clientY;
    tState.moved += Math.abs(dx) + Math.abs(dy);
    if (tState.moved > 10) {
      flight.orbit(dx, dy);
      syncPlayCamera(false);
      ev.preventDefault();
    }
  }, { passive: false });
  const endTouch = (ev) => {
    if (!tState) { return; }
    const st = tState;
    const remaining = ev.touches ? ev.touches.length : 0;
    if (remaining >= 2) { return; }
    if (remaining >= 1) { tState = null; return; }   // 双指里抬起一根：剩下的不接管
    tState = null;
    const changed = ev.changedTouches && ev.changedTouches[0];
    const tap = !st.multi && st.moved < 10 && performance.now() - st.t0 < 350;
    if (!tap || !alive()) { return; }
    const x = changed ? changed.clientX : st.x0;
    const y = changed ? changed.clientY : st.y0;
    const target = pickTargetAt(x, y);
    if (target && target.kind === "person") {
      personTalkTok += 1;
      startPersonTalk(target.id, { plate: !!target.plate });
      return;
    }
    if (target && target.kind === "prop") {
      const a = readActorPos();
      const hit = target.point;
      // 已经站在交互点跟前时场景的 walkTo 会静默返回，这里直接按“查看”记账；
      // 其余情况由场景的 touch tap 去走位。
      if (a && hit && Math.hypot(hit.x - a.x, hit.z - a.z) <= 0.9) {
        personTalkTok += 1;
        handleSpotClick(target.id);
      }
      return;
    }
    // 点地面：场景已经执行 walkTo；这里只挂“看得见但走不到”的兜底。
    const start = readActorPos();
    personTalkTok += 1;
    setTimeout(() => { rescueUnreachableClick(x, y, start); }, 260);
  };
  w.addEventListener("touchend", endTouch, { passive: true });
  w.addEventListener("touchcancel", (ev) => { tState = null; }, { passive: true });

  // 焦点还留在场景 iframe 里时，Esc 只会发给 iframe；这里接一下，别让玩家按了没反应。
  w.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && state.dialog) {
      ev.preventDefault();
      closeDialog();
    }
  });
}

// 点选：按"第一个有身份的命中"取目标，人 / 家具两种。
// 不能用 hits[0]：墙、底座、家具的描边线（LineSegments）都在射线里，而且常常更近，
// 但它们的 userData 上没有 personId / propId。拿 hits[0] 会得到空身份，
// 点击就退化成"走到地面点"——点人不开口、点家具不收证据，两个 bug 都出在这一处。
let personTalkTok = 0;

function pickTargetAt(clientX, clientY) {
  let w = null;
  try { w = frame.contentWindow; } catch (err) { return null; }
  const dbg = w && w.__dbg;
  if (!dbg || !dbg.scene || !dbg.camera || !dbg.renderer) { return null; }
  const T = dbg.THREE;
  const rect = dbg.renderer.domElement.getBoundingClientRect();
  if (!rect.width || !rect.height) { return null; }
  const ndc = new T.Vector2(((clientX - rect.left) / rect.width) * 2 - 1,
                            -((clientY - rect.top) / rect.height) * 2 + 1);
  const ray = new T.Raycaster();
  ray.setFromCamera(ndc, dbg.camera);
  const hits = ray.intersectObjects(dbg.scene.children, true);
  for (const h of hits) {
    const u = (h.object && h.object.userData) || {};
    // 姓名牌也是"点人"：牌子比身体大，隔几米也好点（scene3d 里名字挂在 sprite 上）
    if (u.nameplateFor) { return { kind: "person", id: String(u.nameplateFor), point: h.point, plate: true }; }
    if (u.personId) { return { kind: "person", id: String(u.personId), point: h.point }; }
    if (u.propId) {
      // 地面 / 路面 / 草皮也是 prop（id 形如 g_*），又平又大：它们不是"可查看的物件"，
      // 点它们该按地面走位（走到手指点的那一点），而不是走到某个固定的交互点去。
      let flat = false;
      try {
        const box = new T.Box3().setFromObject(h.object);
        const size = box.getSize(new T.Vector3());
        flat = size.y < 0.35 && Math.max(size.x, size.z) > 8;
      } catch (err) { flat = false; }
      if (flat) { continue; }
      return { kind: "prop", id: String(u.propId), point: h.point };
    }
  }
  return null;
}

// scene3d.js 建场景时把人物组先 pickable.add(g)、同一轮又 scene.add(g)：
// THREE 的 add() 会把节点从旧父级摘走，于是可交互人物最后全挂在 Scene 根下、
// 不在 pickable 里。而场景自己的 pickAt() 只对 pickable.children 做射线 ——
// 点人永远命中不到，只会走到脚下的地面点（问话面板因此打不开）。
// 这里把人物组挂回 pickable：pickable 在原点、无缩放旋转，世界矩阵不变，
// 走位与 person:click 仍走场景原本那条链路（goToPerson → walkTo → fire）。
function repairPickable(w) {
  if (!w || w.__pickRepaired) { return 0; }
  const dbg = w.__dbg;
  const sc = dbg && dbg.scene;
  if (!sc || !Array.isArray(sc.children)) { return 0; }
  let pick = null;
  for (const c of sc.children) {
    if (!c || !c.isGroup) { continue; }
    let hasProp = false;
    c.traverse((o) => { if (!hasProp && o.userData && o.userData.propId) { hasProp = true; } });
    if (hasProp) { pick = c; break; }
  }
  if (!pick) { return 0; }
  w.__pickRepaired = true;
  let moved = 0;
  for (const c of sc.children.slice()) {
    if (!c || !c.isGroup || c === pick) { continue; }
    let pid = null;
    c.traverse((o) => { if (!pid && o.userData && o.userData.personId) { pid = o.userData.personId; } });
    if (pid) { pick.add(c); moved += 1; }
  }
  return moved;
}

// 一次"查看物件"的记账：时间轴 + 证据 + 手机证据夹。
// 场景发来的 spot:click 与"已经站在跟前"的宿主兜底都走这里，避免两套逻辑。
function handleSpotClick(id) {
  if (!id) { return; }
  state.clicks[id] = (state.clicks[id] || 0) + 1;
  const blocked = state.clicks[id] > 3;          // 连点同一件 = 无效点击
  recordNode(blocked ? "blocked" : "spot", id, { key: !blocked });
  if (blocked) { return; }
  const factId = caseState.spotFact[id] || id;
  state.seen.add(factId);
  phone?.setData?.({ evidence: evidenceForPhone() });
}

// 点人走两条通道（2026-11 折中方案）：
//   · 点**身体** → 场景里 goToPerson 先走位，到位才 postMessage person:click；
//   · 点**姓名牌** → 场景里 talkToPerson 原地 fire，立刻到。
// 宿主这里只做两件事：提示 + 兜底开面板（场景那条事件没到时，等走位落定再开）。
// **不再调 mini.goToPerson**：走位由 scene3d 的 pointerup/tapAt 发起，宿主再调一次
// 就会走两遍、弹两次；已经站在 1.5m 内时 walkTo 会给不出路，这里的轮询正好补上。
function startPersonTalk(partyId, opts) {
  if (!partyId) { return; }
  if (!playCam.active || state.cam !== "play") { return; }
  let w = null;
  try { w = frame.contentWindow; } catch (err) { return; }
  const mini = w && w.__mini;
  if (!mini) { return; }
  const fromPlate = !!(opts && opts.plate);
  const name = (state.data && state.data.parties && state.data.parties[partyId]
    && state.data.parties[partyId].name) || "当事人";
  showHint(fromPlate ? "和 " + name + " 说话…" : "走近 " + name + "…");
  const tok = (personTalkTok += 1);
  const t0 = performance.now();
  const poll = () => {
    if (tok !== personTalkTok || !playCam.active || state.cam !== "play") { return; }
    let st = null;
    try { st = mini.stats(); } catch (err) { st = null; }
    const waited = performance.now() - t0;
    const settled = st && !st.walking && st.path === 0 && waited > 160;
    if (settled || waited > 3400) {
      // 场景自己在到位时会发 person:click；已经开了就别再开一次（openDialog 也幂等）
      if (state.dialog || document.querySelector(".dlg-card")) { return; }
      openDialog(partyId);
      return;
    }
    setTimeout(poll, 130);
  };
  setTimeout(poll, 180);
}

// 点地面兜底：场景的 A* 只对"屏障外的点"给路。点进一个看得见却走不到的角落时，
// walkTo 会静默返回 false（没有 actor:blocked 事件），玩家看到的就是"点了没反应"。
// 这里等 260ms 确认人没动，再用同一条射线把点击落点算出来；只有该点确实不可达时，
// 才在它周围 3 米内找一个可走点送过去。可达的点一律不抢（那是场景自己的活）。
let lastRescueAt = 0;
function rescueUnreachableClick(clientX, clientY, from) {
  if (!playCam.active || state.cam !== "play" || !from) { return; }
  const now = performance.now();
  if (now - lastRescueAt < 400) { return; }
  let w = null;
  try { w = frame.contentWindow; } catch (err) { return; }
  const mini = w && w.__mini;
  const dbg = w && w.__dbg;
  if (!mini || !dbg || !dbg.camera || !dbg.renderer) { return; }
  const cur = readActorPos();
  if (!cur || Math.hypot(cur.x - from.x, cur.z - from.z) > 0.06) { return; }
  const st = mini.stats();
  if (!st || st.walking || st.path > 0) { return; }

  const T = dbg.THREE;
  const rect = dbg.renderer.domElement.getBoundingClientRect();
  if (!rect.width || !rect.height) { return; }
  const ndc = new T.Vector2(((clientX - rect.left) / rect.width) * 2 - 1,
                            -((clientY - rect.top) / rect.height) * 2 + 1);
  const ray = new T.Raycaster();
  ray.setFromCamera(ndc, dbg.camera);
  const ground = new T.Vector3();
  const plane = new T.Plane(new T.Vector3(0, 1, 0), 0);
  if (!ray.ray.intersectPlane(plane, ground)) { return; }
  if (Math.hypot(ground.x - cur.x, ground.z - cur.z) > 14) { return; }

  const info = mini.debugPath(ground.x, ground.z);
  if (!info || info.len > 0) { return; }        // 有路：不抢场景的走位

  let target = null;
  for (let ring = 1; ring <= 6 && !target; ring++) {
    for (let i = -ring; i <= ring && !target; i++) {
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) { continue; }
        const x = ground.x + i * 0.5;
        const z = ground.z + j * 0.5;
        if (Math.hypot(x - cur.x, z - cur.z) <= 0.8) { continue; }
        const near = mini.debugPath(x, z);
        if (near && near.len > 0) { target = { x, z }; break; }
      }
    }
  }
  if (!target) { showHint("那边过不去，换个地方点。"); return; }
  lastRescueAt = now;
  mini.walkTo(target.x, target.z);
  showHint("那边过不去，走到最近能站的地方。");
}

// ---------------------------------------------------------------- 首屏俯瞰 / 下移
// 首屏的 3D 屋子在 iframe 里，外层只负责看板。场景每次自己 placeCamera 会把
// 机位抢回去，所以先要 owner，再以 20fps 不断把同一个俯瞰位推过去。
let lastBoardCamAt = 0;

function pushBoardCamera(now, force) {
  if (!force && now - lastBoardCamAt < 50) { return; }
  lastBoardCamAt = now;
  sendToFrame("camera:set", {
    pos: BOARD_VIEW.pos.slice(),
    look: BOARD_VIEW.look.slice(),
    fov: BOARD_VIEW.fov
  });
}

function armBoardCamera() {
  if (state.started) { return; }
  state.frameReady = true;
  state.boardCam = true;
  sendToFrame("camera:owner", { external: true });
  pushBoardCamera(performance.now(), true);
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerp3(a, b, k) {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

// 云散之后：2.4s 内把 iframe 相机从俯瞰位缓动到常规俯视位。
// 这段时间不能再让 loadCloud 盖着画面（finishLoading 里已经 stopLoadClouds + 淡出）。
function updateBoardDescent(now) {
  const d = state.camDescent;
  if (!d) { return; }
  const k = Math.max(0, Math.min(1, (now - d.t0) / d.dur));
  const e = easeInOutCubic(k);
  sendToFrame("camera:set", {
    pos: lerp3(d.from.pos, d.to.pos, e),
    look: lerp3(d.from.look, d.to.look, e),
    fov: d.from.fov + (d.to.fov - d.from.fov) * e
  });
  if (k >= 1) { state.camDescent = null; }
}

function startBoardExit() {
  if (state.started || state.camDescent) { return; }
  state.boardCam = false;
  state.camDescent = {
    t0: performance.now(),
    dur: BOARD_EXIT_MS,
    from: BOARD_VIEW,
    to: DUTY_VIEW
  };
  boot?.start?.();
}

// 落位：外壳相机先「瞬间」站到落位（不能从看板位跳过去，否则画面会闪），
// 再以 0.9s 交回第三人称跟随；iframe 每帧跟着外壳相机，所以这里不会二次跳。
function finishBoardExit() {
  if (state.started) { return; }
  state.camDescent = null;
  state.boardCam = false;
  stopPlay();
  const tok = playToken;

  flight.snap({ pos: DUTY_VIEW.pos, look: DUTY_VIEW.look, fov: DUTY_VIEW.fov },
    { mode: "FOLLOW" });

  const def = SCENES.duty;
  state.sceneId = "duty";
  state.started = true;
  state.activated = true;
  state.frameReady = true;
  state.t0 = performance.now();
  frame.dataset.scene = "duty";
  frame.classList.add("on");
  frame.style.pointerEvents = "auto";
  // 进场景后外层看板层彻底让开指针：否则它盖在 iframe 上，点地面走不了、拖不动视角
  yieldStage();
  bootHost.style.display = "none";
  boot?.dispose?.();

  // 场景先不要自己 placeCamera：落位补间由 flight 走完再交自由视角
  sendToFrame("camera:owner", { external: true });
  flight.follow(def.actor, def.facing,
    Object.assign({ dur: 0.9, ease: "inOutCubic" }, playViewOpts()));
  setTimeout(() => {
    if (tok === playToken && state.started && state.cam === "host" && state.sceneId === "duty") {
      startPlay(def);
    }
  }, 960);
  phone?.setScene?.("duty");
  showPhoneUI();
  applyPhoneData();
}

function fadeIn(el, on) {
  if (!el) { return; }
  const tok = (el.__fadeTok = (el.__fadeTok || 0) + 1);
  if (on) {
    el.hidden = false;
    requestAnimationFrame(() => { if (el.__fadeTok === tok) { el.classList.add("on"); } });
  } else {
    el.classList.remove("on");
    setTimeout(() => { if (el.__fadeTok === tok) { el.hidden = true; } }, 260);
  }
}

// ---------------------------------------------------------------- ① 首屏 → 加载页
// 密码门已去掉：点「开始调解」直接进加载页（云背景 + 十场预热），看完运镜就落地。

// ---------------------------------------------------------------- ② 加载页
// 十个场景页逐个塞进同一个隐藏 iframe，等它们各自发 scene:ready。
// 用一条 iframe 而不是十条：一次只有一个 WebGL 上下文，内存不会炸。
let preloadEl = null;
let preloadWait = null;

function getPreloadFrame() {
  if (preloadEl && preloadEl.isConnected) { return preloadEl; }
  preloadEl = document.createElement("iframe");
  preloadEl.id = "preloadFrame";
  preloadEl.setAttribute("title", "场景预热");
  preloadEl.setAttribute("aria-hidden", "true");
  document.body.appendChild(preloadEl);
  return preloadEl;
}

for (let i = 0; i < SCENE_ORDER.length; i++) {
  loadDots.appendChild(document.createElement("b"));
}

// ---------------------------------------------------------------- 云背景
// 加载页不做"奶油色板 + 进度条"，直接让云先盖满：跟地图传送用的是同一个
// paintClouds（同一朵云、同一套漂浮相位），所以"云 → 场景"看起来是一件事。
// 12.5fps 就够（云飘得很慢），软件渲染的机器上也不抢预热要用的 CPU。
// 云表比转场那六团小一号、密一些：转场要"盖死"，加载页要"抬头全是云、缝里见天"。
const LOAD_CLOUDS = [
  { x: 0.06, y: 0.14, r: 0.19, ph: 0.3 },
  { x: 0.30, y: 0.08, r: 0.22, ph: 1.1 },
  { x: 0.58, y: 0.12, r: 0.20, ph: 2.2 },
  { x: 0.84, y: 0.20, r: 0.18, ph: 3.4 },
  { x: 0.14, y: 0.40, r: 0.21, ph: 4.1 },
  { x: 0.44, y: 0.36, r: 0.24, ph: 0.8 },
  { x: 0.74, y: 0.44, r: 0.19, ph: 2.9 },
  { x: 0.96, y: 0.52, r: 0.17, ph: 1.6 },
  { x: 0.10, y: 0.70, r: 0.22, ph: 1.9 },
  { x: 0.38, y: 0.78, r: 0.24, ph: 3.7 },
  { x: 0.66, y: 0.70, r: 0.21, ph: 0.5 },
  { x: 0.88, y: 0.82, r: 0.20, ph: 2.6 },
  { x: 0.20, y: 0.96, r: 0.20, ph: 4.6 },
  { x: 0.56, y: 0.98, r: 0.22, ph: 1.3 },
  { x: 0.90, y: 0.98, r: 0.18, ph: 3.1 }
];

let loadCloudRAF = 0;
let loadCloudLast = 0;

function sizeLoadCloud() {
  if (!loadCloud) { return; }
  const dpr = Math.min(devicePixelRatio || 1, 2);
  loadCloud.width = Math.max(1, Math.round(innerWidth * dpr));
  loadCloud.height = Math.max(1, Math.round(innerHeight * dpr));
  const ctx = loadCloud.getContext("2d");
  if (ctx) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
}

function pumpLoadCloud(now) {
  if (!loadCloud || loadEl.hidden) { loadCloudRAF = 0; return; }
  if (now - loadCloudLast >= 80) {
    loadCloudLast = now;
    const ctx = loadCloud.getContext("2d");
    // 满天云：小云团铺满整屏，缝里露出深墨蓝的天 —— 一眼是"云正盖过来"
    paintClouds(ctx, innerWidth, innerHeight, 1, now, {
      blobs: LOAD_CLOUDS,
      scale: 0.92,
      rim: 0.06,
      shadowColor: "rgba(41,72,88,.30)",
      shadowBlur: 90
    });
  }
  loadCloudRAF = requestAnimationFrame(pumpLoadCloud);
}

function startLoadClouds() {
  if (!loadCloud) { return; }
  sizeLoadCloud();
  if (!loadCloudRAF) {
    loadCloudLast = 0;
    loadCloudRAF = requestAnimationFrame(pumpLoadCloud);
  }
}

function stopLoadClouds() {
  if (loadCloudRAF) { cancelAnimationFrame(loadCloudRAF); loadCloudRAF = 0; }
  const ctx = loadCloud ? loadCloud.getContext("2d") : null;
  if (ctx) { ctx.clearRect(0, 0, innerWidth, innerHeight); }
}

function paintLoading(pct, text, index) {
  const total = SCENE_ORDER.length;
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  state.loading.pct = p;
  if (text != null) { loadCur.textContent = text; }
  loadFill.style.width = p + "%";
  loadPct.textContent = p + "%";
  loadBar.setAttribute("aria-valuenow", String(p));
  loadCount.textContent = Math.min(total, Math.max(0, index)) + " / " + total;
  loadState.textContent = p >= 100 ? "就绪" : "准备中";
  const dots = loadDots.children;
  for (let i = 0; i < dots.length; i++) {
    dots[i].className = i < Math.min(total, index) ? "ok" : (i === index ? "cur" : "");
  }
}

function openLoading() {
  if (state.loading.active || state.loading.finished) { return; }
  state.loading.active = true;
  state.loading.done = 0;
  state.loading.failed.length = 0;
  paintLoading(0, "正在准备 " + SCENES[SCENE_ORDER[0]].name + "…", 0);
  fadeIn(loadEl, true);
  startLoadClouds();
  // 完成/降级都由 preloadAll 自己收口：桌面走“全绿再进”，手机走“首场就进”。
  preloadAll();
}

function preloadOne(id) {
  return new Promise((resolve) => {
    const f = getPreloadFrame();
    const def = SCENES[id];
    let settled = false;
    const finish = (why) => {
      if (settled) { return; }
      settled = true;
      clearTimeout(timer);
      if (preloadWait && preloadWait.id === id) { preloadWait = null; }
      if (why !== "ready") { state.loading.failed.push(id + ":" + why); }
      resolve(why);
    };
    const timer = setTimeout(() => finish("timeout"), 9000);
    preloadWait = { id, finish };
    // 不带 query：让浏览器缓存命中，后面真的进场景时是热的
    f.src = "./" + def.file;
  });
}

function onPreloadReady(srcWin) {
  if (!preloadWait) { return; }
  // 同一个 iframe 换 src，可能收到上一条的迟到 ready —— 用路径名核一下是谁发的
  let path = "";
  try { path = String((srcWin && srcWin.location && srcWin.location.pathname) || ""); } catch (err) { path = ""; }
  const want = SCENES[preloadWait.id] && SCENES[preloadWait.id].file;
  if (path && want && !path.endsWith(want.replace(/^\.\//, ""))) { return; }
  preloadWait.finish("ready");
}

async function preloadAll() {
  const total = SCENE_ORDER.length;
  for (let i = 0; i < total; i++) {
    const id = SCENE_ORDER[i];
    paintLoading((i / total) * 100, "正在准备 " + SCENES[id].name + "…", i);
    const why = await preloadOne(id);
    state.loading.done = i + 1;
    if (why === "ready") { state.loading.ready.push(id); }
    paintLoading(((i + 1) / total) * 100, "", Math.min(i + 1, total));
    // 移动端降级：第一场 ready 就放人进场景，其余九场在隐藏 iframe 里继续串行预热
    // （地图上传送到还没预热的场时，teleport 本来就会临时加载，不需要另写一条路径）。
    if (IS_MOBILE && why === "ready" && !state.loading.early && !state.loading.finished) {
      state.loading.early = true;
      state.loading.background = true;
      finishLoading(true);
    }
    // 后台预热不要和刚进场景的渲染抢同一拍 CPU：每场之间让出 180ms
    if (state.loading.background) {
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
  }
  state.loading.done = total;
  state.loading.pct = 100;
  if (state.loading.finished) {
    completeBackgroundPreload();
  } else {
    paintLoading(100, "准备完成，正在进入…", total);
    finishLoading(false);
  }
}

// 后台九场也全部就绪：进度记满、拆掉预热 iframe（它这时候还占着一份 WebGL 上下文）。
function completeBackgroundPreload() {
  if (state.loading.backgroundDone) { return; }
  state.loading.backgroundDone = true;
  state.loading.pct = 100;
  state.loading.done = state.loading.total;
  paintLoading(100, "", state.loading.total);
  setTimeout(dropPreload, 600);
}

function dropPreload() {
  // 预热用的 WebGL 上下文用完就扔：留着白占一份显存，真进场景时容易掉帧
  if (preloadEl && preloadEl.parentNode) { preloadEl.parentNode.removeChild(preloadEl); }
  preloadEl = null;
  preloadWait = null;
}

function finishLoading(early) {
  if (state.loading.finished) { return; }
  state.loading.finished = true;
  setTimeout(() => {
    state.loading.active = false;
    fadeIn(loadEl, false);
    stopLoadClouds();
    // 降级路径不能拆预热 iframe：后面九场还在里面排队。
    if (!early) { dropPreload(); }
    const go = () => {
      if (!boot || boot.introDone) { enterScene("duty"); return; }
      // 云已经散了（stopLoadClouds + 淡出）；这里同时启动看板散场与 2.4s 机身下移
      startBoardExit();
    };
    if (!state.data && state.dataPromise) {
      state.dataPromise.finally(() => setTimeout(go, 40));
    } else {
      setTimeout(go, 80);
    }
  }, 480);
}

// ---------------------------------------------------------------- ③ 场景载入
let frameToken = 0;

function loadFrame(id) {
  const def = SCENES[id];
  state.frameReady = false;
  state.activated = false;
  frameToken += 1;
  const tok = frameToken;
  frame.dataset.scene = id;
  const onLoad = () => {
    frame.removeEventListener("load", onLoad);
    // 场景脚本挂监听需要一两帧，别在 load 当拍就下发相机
    setTimeout(() => { if (tok === frameToken) { activateScene(); } }, 240);
  };
  frame.addEventListener("load", onLoad);
  frame.src = "./" + def.file;
}

function activateScene() {
  const def = SCENES[state.sceneId];
  if (!def) { return; }
  if (state.activated) { return; }
  state.activated = true;
  state.frameReady = true;
  // 先压住相机：新场景的 placeCamera 不能在我们补间的时候抢镜
  sendToFrame("camera:owner", { external: true });
  frame.classList.add("on");
  phone?.setScene?.(state.sceneId);

  // 传送（FLIGHT）中不抢镜头：落地机位由 flight.transfer 的补间负责，
  // 转场结束的 onTransfer 再把相机交给场景内的自由视角。
  if (flight.mode === "FLIGHT") { return; }

  stopPlay();
  const tok = playToken;
  flight.follow(def.actor, def.facing, Object.assign({ dur: 0.9 }, playViewOpts()));
  setTimeout(() => {
    if (tok === playToken && state.activated && state.cam === "host" && state.sceneId) {
      startPlay(SCENES[state.sceneId]);
    }
  }, 960);
}

function enterScene(id) {
  const def = SCENES[id];
  if (!def) { return; }
  closeDialog();
  state.loading.active = false;
  fadeIn(loadEl, false);
  if (state.started && id === state.sceneId) { activateScene(); return; }
  // 首屏背景本来就载着 duty：直接进这一场时不要再改 src 重载一次。
  // 重载会有一段"旧文档已被点、新文档还没接通"的空窗，真实点击会丢。
  const curSrc = frame.getAttribute("src") || "";
  if (!state.started && curSrc.endsWith(def.file) && readActorPos()) {
    enterLoadedScene(id);
    return;
  }
  stopPlay();
  state.sceneId = id;
  state.started = true;
  state.t0 = performance.now();
  boot.dispose?.();
  bootHost.style.display = "none";
  showPhoneUI();
  frame.style.pointerEvents = "auto";
  // 进场景后外层看板层彻底让开指针：否则它盖在 iframe 上，点地面走不了、拖不动视角
  yieldStage();
  sendToFrame("camera:owner", { external: true });
  loadFrame(id);
}

// 首屏那张 duty 已经载好时走这条：不重载 iframe，直接把看板层收走、交相机。
function enterLoadedScene(id) {
  const def = SCENES[id];
  if (!def) { return; }
  stopPlay();
  state.boardCam = false;
  state.camDescent = null;
  state.sceneId = id;
  state.started = true;
  state.activated = true;
  state.frameReady = true;
  state.t0 = performance.now();
  frame.dataset.scene = id;
  frame.classList.add("on");
  frame.style.pointerEvents = "auto";
  yieldStage();
  bootHost.style.display = "none";
  boot?.dispose?.();
  sendToFrame("camera:owner", { external: true });
  flight.follow(def.actor, def.facing,
    Object.assign({ dur: 0.9, ease: "inOutCubic" }, playViewOpts()));
  const tok = playToken;
  setTimeout(() => {
    if (tok === playToken && state.started && state.cam === "host" && state.sceneId === id) {
      startPlay(def);
    }
  }, 960);
  phone?.setScene?.(id);
  showPhoneUI();
  applyPhoneData();
}

// ---------------------------------------------------------------- 云朵传送
// 时序全部交给 flight.transfer：抬升 → 云起 → **云盖住时才换 iframe**，然后等新场景
// 真的 ready（收到 scene:ready 或 9 秒超时）→ 云散 → 下降。
// 关键点：加载器返回 Promise。Promise resolve 之前 flight 不会散云，
// 所以"云散了、场景还没换好"这件事从结构上就不可能发生（旧写法靠 0.1s 窗口，掉帧就丢）。
// pendingReady 是"这一趟传送正在等谁"的存根，由 message 处理里的 scene:ready 兑现。
let pendingReady = null;

// 同一张 iframe 换 src 时，可能收到上一条的迟到 ready：用路径名核一下是谁发的。
// 取不到路径（跨源/导航中）时按"是它"处理 —— 宁可多等一轮超时，也不要提前散云。
function readyFromScene(win, id) {
  let path = "";
  try { path = String((win && win.location && win.location.pathname) || ""); } catch (err) { path = ""; }
  const want = SCENES[id] && SCENES[id].file;
  if (!path || !want) { return true; }
  return path.endsWith(want.replace(/^\.\//, ""));
}

function teleport(id) {
  if (!SCENES[id] || id === state.sceneId) { return false; }
  const def = SCENES[id];
  closeDialog();
  phone?.close?.();
  stopPlay();                 // 转场期间机位由 flight 接管，场景不许动相机
  state.sceneId = id;
  state.started = true;
  state.activated = false;
  state.frameReady = false;
  frameToken += 1;         // 让还在路上的上一场 ready 失效
  const tok = frameToken;
  const land = flight.pose(def.actor, def.facing, Object.assign({ yaw: 0 }, landViewOpts()));
  frame.style.pointerEvents = "none";    // 转场期间禁止玩家操作（点一下 = 跳过）

  // 加载器：云盖满的那一拍才被 flight 调用；resolve 之前云不散。
  const loadScene = () => new Promise((resolve) => {
    let settled = false;
    const finish = (why) => {
      if (settled) { return; }
      settled = true;
      clearTimeout(timer);
      if (pendingReady && pendingReady.tok === tok) { pendingReady = null; }
      resolve(why);
    };
    const timer = setTimeout(() => finish("timeout"), 9000);
    pendingReady = { id, tok, finish };
    frame.dataset.scene = id;
    frame.src = "./" + def.file;
    // 新文档一建立就压住相机；activateScene/scene:ready 还会再发一次（这条可能落在旧文档上）
    setTimeout(() => { sendToFrame("camera:owner", { external: true }); }, 300);
  });

  flight.transfer(loadScene, { land });
  showHint("前往 " + def.name);
  return true;
}

// ---------------------------------------------------------------- ④ 手机
const caseState = { factsById: {}, keyIds: new Set(), spotFact: {}, spotLabel: {} };

function adaptCase(pub) {
  const id = pub.id || DEFAULT_CASE;
  const facts = Array.isArray(pub.facts) ? pub.facts : [];
  const keyList = KEY_EVIDENCE[id] || [];
  const keyIds = new Set(keyList);

  caseState.factsById = {};
  facts.forEach((f) => { caseState.factsById[f.id] = f; });
  caseState.keyIds = keyIds;
  caseState.spotFact = SPOT_FACT[id] || {};
  // 点位标签：案卷里的 spots 是另一套 id，能对上就用真实标题
  caseState.spotLabel = {};
  (pub.scenes || []).forEach((s) => {
    (s.spots || []).forEach((p) => { if (p && p.id) { caseState.spotLabel[p.id] = p.label || ""; } });
  });

  // case.json 现在没有 evidence 字段（见 docs/最终形态提示词 §10.3），
  // 这里按 facts 推一份：{ id, weight, spot } + 人类可读的 title/text。
  // found 不在这里定 —— 它是运行时状态，由 state.seen 拼。
  const evidence = (Array.isArray(pub.evidence) && pub.evidence.length
    ? pub.evidence
    : facts.map((f) => ({ id: f.id, weight: keyIds.has(f.id) ? 2 : 1, spot: "" }))
  ).map((e) => {
    const f = caseState.factsById[e.id] || {};
    return {
      id: e.id,
      weight: Number(e.weight) || 1,
      spot: e.spot || "",
      title: f.title || e.title || e.id,
      text: f.text || e.text || ""
    };
  });

  // 手机地图要用外壳的场景 id，否则点了传送找不到目标（案卷 id → 场景文件名）
  const scenes = (pub.scenes || []).map((s) => {
    const sid = SCENE_ALIAS[s.id] || (SCENES[s.id] ? s.id : "");
    return Object.assign({}, s, {
      id: sid || s.id,
      caseId: s.id,
      name: s.name || (sid && SCENES[sid] ? SCENES[sid].name : s.id),
      teleportable: !!sid
    });
  });

  return {
    id,
    title: pub.title || "",
    meta: pub.meta || {},
    alarm: pub.alarm || {},
    facts,
    evidence,
    keyIds,
    scenes,
    dimensions: pub.dimensions || [],
    parties: pub.parties || {},
    partyOrder: pub.partyOrder || Object.keys(pub.parties || {}),
    characters: pub.parties || {},
    contacts: Object.keys(pub.parties || {}).map((pid) => {
      const p = pub.parties[pid] || {};
      return { id: pid, alias: p.name || pid, tag: p.role || "当事人", note: p.job || "" };
    })
  };
}

function evidenceForPhone() {
  const seen = state.seen;
  return (state.data?.evidence || []).map((e) => ({
    ...e,
    found: seen.has(e.id),
    title: caseState.factsById[e.id]?.title || e.title
  }));
}

function loadCase(id) {
  state.caseId = id;
  state.dataError = "";
  state.closed = !!state.closedByCase[id];
  const seq = (state.caseLoadSeq += 1);
  return fetch("/api/case/" + encodeURIComponent(id), { headers: { Accept: "application/json" } })
    .then((res) => {
      if (!res.ok) { throw new Error("HTTP " + res.status); }
      return res.json();
    })
    .then((pub) => {
      // 换案很快时，先发的请求可能后到：只让最后一次请求落盘
      if (seq !== state.caseLoadSeq) { return state.data; }
      state.data = adaptCase(pub);
      state.closed = !!state.closedByCase[id];
      applyPhoneData();
      return state.data;
    })
    .catch((err) => {
      state.dataError = String((err && err.message) || err);
      console.warn("[app] 案卷没取到：" + state.dataError + "（手机各页会显示空状态）");
      return null;
    });
}

// 十场场景一次列全：地图刚打开就要能看到所有地点，而不是只看到当前案子的几处。
function allScenes() {
  return SCENE_ORDER.map((id) => ({
    id,
    name: SCENES[id].name,
    setting: SCENE_SETTING[id] || "yard",
    visited: true
  }));
}

// 手机案件页的三条摘要。列表接口没回来之前，至少把当前案卷本身列出来。
function caseListForPhone() {
  const rows = (Array.isArray(state.caseIndex) ? state.caseIndex : []).map((c) => ({
    id: c.id,
    name: CASE_NAME[c.id] || c.title || c.id,
    title: c.title || "",
    subtitle: c.subtitle || "",
    difficulty: c.difficulty || "",
    playtime: c.playtime || "",
    current: c.id === state.caseId
  }));
  if (!rows.length && state.data) {
    rows.push({
      id: state.data.id,
      name: CASE_NAME[state.data.id] || state.data.title || state.data.id,
      title: state.data.title || "",
      subtitle: state.data.meta?.subtitle || "",
      current: true
    });
  }
  return rows;
}

// 首屏不显示手机图标：点过「开始调解」、真正进了场景之后才让它出现。
function showPhoneUI() {
  phoneMount.classList.remove("is-booting");
}

function loadCaseIndex() {
  return fetch("/api/cases", { headers: { Accept: "application/json" } })
    .then((res) => {
      if (!res.ok) { throw new Error("HTTP " + res.status); }
      return res.json();
    })
    .then((json) => {
      state.caseIndex = Array.isArray(json && json.cases) ? json.cases : [];
      applyPhoneData();
      return state.caseIndex;
    })
    .catch((err) => {
      state.caseIndex = [];
      console.warn("[app] 案件列表没取到：" + String((err && err.message) || err));
      return [];
    });
}

function applyPhoneData() {
  const d = state.data;
  if (!d || !phone) { return; }
  phone.setData({
    case: { id: d.id, title: d.title, meta: d.meta, alarm: d.alarm,
            parties: d.parties, partyOrder: d.partyOrder,
            dimensions: d.dimensions, scenes: d.scenes },
    cases: caseListForPhone(),
    evidence: evidenceForPhone(),
    characters: d.characters,
    scenes: allScenes(),
    personScenes: (PERSON_SCENES.data || {})[d.id] || {},
    contacts: d.contacts,
    sceneId: state.sceneId || "duty",
    closed: state.closed
  });
}

const phone = createPhone({
  mount: phoneMount,
  // 桌面沿用国庆项目那台机器的风格（深墨壳 + 中性浅屏 + 品牌蓝）；
  // 九宫格图标仍是这套工具自己画的线性图标，配色在 phone.js 的 ICON_TONE 里压暗过一档。
  onAction: (type, payload) => {
    if (type === "teleport" && payload?.sceneId) { teleport(payload.sceneId); return; }
    if (type === "case:switch" && payload?.id) { setCase(payload.id); return; }
    if (type === "call" && payload?.id) { callFromPhone(payload.id); return; }
    if (type === "review") { openReview(); return; }
    if (type === "close-case") { closeCase(payload && payload.plan); return; }
  }
});
state.phone = phone;

function openPhone(page) {
  phone?.open?.();
  if (page) { phone?.openPage?.(page); }
}

// ---------------------------------------------------------------- ④.5 问话面板
// 玩家自由输入一句话 → POST /api/dialogue（旧训练台同一条接口，12s 超时）。
// cases_dialog.json 不再提供"预设话题"，只留每人一份兜底台词：服务端明确返回降级
// 且回话为空时才会用到；网络失败 / 超时一律不编人物台词，面板显示"没接上"。
// 记帐：每一轮成功对话 → 一条复盘节点 + 一条手机笔记。
const dialogCat = { caseId: "", promise: null, data: null };
// 法条选择器用的 9 条条文：src/web/laws/laws.json 是 src/laws/laws.json 的静态镜像
// （服务端只把 web/ 目录当静态根，前端读不到 src/laws/）。
const lawCat = { promise: null, data: [] };
const dialogNet = { caseId: "", sid: "", promise: null, seq: 0 };

function loadDialogCatalog() {
  if (!dialogCat.promise) {
    dialogCat.promise = fetch("./cases_dialog.json", { headers: { Accept: "application/json" } })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("HTTP " + res.status))))
      .then((json) => { dialogCat.data = json; return json; })
      .catch((err) => {
        console.warn("[app] 问话资料没取到：" + String((err && err.message) || err));
        dialogCat.promise = null;
        return null;
      });
  }
  return dialogCat.promise;
}

function loadLaws() {
  if (lawCat.data.length) { return Promise.resolve(lawCat.data); }
  if (!lawCat.promise) {
    lawCat.promise = fetch("./laws/laws.json", { headers: { Accept: "application/json" } })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("HTTP " + res.status))))
      .then((json) => {
        lawCat.data = Array.isArray(json && json.articles) ? json.articles : [];
        return lawCat.data;
      })
      .catch((err) => {
        console.warn("[app] 法条镜像没取到：" + String((err && err.message) || err));
        lawCat.promise = null;
        return [];
      });
  }
  return lawCat.promise;
}

// 手机笔记：优先问 phone（同一份 localStorage）；没有 phone 时直接读同一把钥匙。
const NOTES_KEY = "tjt.phone.notes.v1";
function notesForDialog() {
  try {
    const list = phone?.getNotes?.();
    if (Array.isArray(list) && list.length) { return list; }
  } catch (err) { /* phone 还没建好 */ }
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr)
      ? arr.filter((n) => n && String(n.text || "").trim()).map((n, i) => ({
          id: String(n.id || "n" + i), text: String(n.text || ""), t: Number(n.t) || 0
        }))
      : [];
  } catch (err) {
    return [];
  }
}

// 服务端降级且没给回话时的兜底句：只从案卷数据里取，不在前端写任何一句台词。
function offlineLines(boxParty) {
  const bank = (boxParty && (boxParty.answers || boxParty.fallback)) || {};
  const out = [];
  ["other", "calm", "empathy"].forEach((k) => {
    (Array.isArray(bank[k]) ? bank[k] : []).forEach((x) => {
      const line = String(x == null ? "" : x).trim();
      if (line) { out.push(line); }
    });
  });
  return out;
}

// 一个案子一个服务端会话：对话状态（信任/情绪/说过什么）由 Session 自己攒。
function ensureDialogSession() {
  if (dialogNet.sid && dialogNet.caseId === state.caseId) {
    return Promise.resolve(dialogNet.sid);
  }
  if (dialogNet.promise && dialogNet.caseId === state.caseId) { return dialogNet.promise; }
  const cid = state.caseId;
  const seq = (dialogNet.seq += 1);
  dialogNet.caseId = cid;
  dialogNet.sid = "";
  dialogNet.promise = fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ caseId: cid })
  })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error("HTTP " + res.status))))
    .then((json) => {
      const sid = json && json.view && json.view.sessionId;
      if (!sid) { throw new Error("session 里没有 sessionId"); }
      if (seq !== dialogNet.seq || cid !== state.caseId) { return sid; }   // 换案了，旧会话作废
      dialogNet.sid = sid;
      return sid;
    })
    .catch((err) => {
      console.warn("[app] 对话会话没建起来：" + String((err && err.message) || err));
      dialogNet.promise = null;        // 下次点话题再试，别把一次失败钉死
      throw err;
    });
  return dialogNet.promise;
}

// 自由输入 → 模型。12s 超时；失败时**不返回任何台词**，只回 { failed: true }，
// 由面板显示"这次没接上，再说一遍"。refs 只在真的有引用时才带，服务端不认识也不会 400。
const DIALOG_TIMEOUT = 12000;

function cleanRefs(refs) {
  if (!refs || typeof refs !== "object") { return null; }
  const pick = (list) => (Array.isArray(list) ? list.map((x) => String(x || "")).filter(Boolean) : []);
  const notes = pick(refs.notes);
  const laws = pick(refs.laws);
  if (!notes.length && !laws.length) { return null; }
  const out = {};
  if (notes.length) { out.notes = notes; }
  if (laws.length) { out.laws = laws; }
  return out;
}

function askParty(party, text, opts) {
  const o = opts || {};
  const refs = cleanRefs(o.refs);
  return ensureDialogSession().then((sid) => new Promise((resolve, reject) => {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = setTimeout(() => {
      try { ctrl?.abort(); } catch (err) { /* 已结束 */ }
      reject(new Error("timeout"));
    }, DIALOG_TIMEOUT);
    const body = {
      sessionId: sid, partyId: party.id, text: String(text || ""),
      // phone：从手机通讯录拨出去的通话，和到场问话共用同一个判定内核，
      // 但服务端按 channel=phone 记账（复盘里的“电话沟通”/单独沟通都认它）。
      channel: o.mode === "face" ? "face" : o.mode === "phone" ? "phone" : "separate"
    };
    if (refs) { body.refs = refs; }
    fetch("/api/dialogue", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("HTTP " + res.status))))
      .then((json) => { if (!json || !json.ok) { throw new Error("dialogue 失败"); } resolve(json); })
      .catch(reject)
      .finally(() => clearTimeout(timer));
  })).catch((err) => {
    console.warn("[app] 问话没接上：" + String((err && err.message) || err));
    return { failed: true };
  });
}

function closeDialog() {
  if (!state.dialog) { return; }
  const d = state.dialog;
  state.dialog = null;
  try { d.close(); } catch (err) { /* 已销毁 */ }
}

// 同一拍里连开两次（场景的 person:click + 宿主"走近"轮询）会留下两个面板：
// 后一次把前一次 closeDialog 掉，但前一次的资料还在路上，回来照样 createDialog。
// 用一个序号把过期的那次作废。
let dialogSeq = 0;
let dialogPartyId = "";     // 当前面板属于谁：同一个人不重开（见 openDialog 顶部的幂等判断）
let dialogMode = "separate";  // separate = 到场问话；phone = 手机拨出去的通话

function openDialog(partyId, opt) {
  const mode = opt && opt.mode === "phone" ? "phone" : "separate";
  if (!partyId) { return Promise.resolve(null); }
  if (!state.data) { showHint("案卷还在加载，等一下再问。"); return Promise.resolve(null); }
  // 同一个人已经开着面板时不要重开：从俯瞰位点人，主角要走 9~10 米，
  // 场景的 person:click 与宿主的"走近"轮询可能各开一次 —— 第二次 openDialog 会
  // 把玩家刚打进去的字连同气泡一起清掉（K2 的现场就是"输入被清空、0 轮"）。
  if (dialogPartyId === partyId && dialogMode === mode
      && state.dialog && document.querySelector(".dlg-card")) {
    return Promise.resolve(state.dialog);
  }
  closeDialog();
  dialogPartyId = partyId;
  dialogMode = mode;
  const seq = (dialogSeq += 1);
  return Promise.all([loadDialogCatalog(), loadLaws()]).then(([cat, laws]) => {
    if (seq !== dialogSeq) { return null; }     // 又点了一次，这次作废
    if (!state.started) { return null; }        // 资料文件缺了也照常开：人物名从案卷取
    const cid = state.caseId;
    const box = (cat && cat.cases && cat.cases[cid]) || null;
    const pub = (state.data && state.data.parties && state.data.parties[partyId]) || {};
    const boxParty = (box && box.parties && box.parties[partyId]) || null;
    if (!boxParty && !pub.name) {
      showHint("这个人不是本案当事人，问不出什么。");
      return null;
    }
    const party = Object.assign(
      { id: partyId, name: pub.name || partyId, role: pub.role || "" },
      boxParty || {}
    );
    if (!party.name) { showHint("他不是本案当事人。"); return null; }
    let callTimer = 0;
    const dlg = createDialog({
      party,
      // 自由输入：玩家打什么就发什么，判断交给模型；refs 跟着一起提交。
      // 拨电话也走这一条（mode=phone → /api/dialogue 的 channel=phone），
      // 所以"在地图上点人"和"在手机里打电话"看到的是同一个面板、同一套判定。
      chat: (text, info) => askParty(party, text, { mode, refs: info && info.refs }),
      getNotes: () => notesForDialog(),
      getLaws: () => laws || [],
      // 只给"服务端明确降级且回话为空"兜底，网络失败不用它（不编人物台词）。
      fallback: offlineLines(boxParty),
      onClose: () => {
        clearInterval(callTimer);
        if (state.dialog && state.dialog.el === dlg.el) {
          state.dialog = null;
          dialogPartyId = "";
          dialogMode = "separate";
        }
      },
      onRecord: (text, refs, res) => {
        const said = String(text || "").replace(/\s+/g, " ").trim();
        const reply = String((res && res.reply) || "").slice(0, 160);
        recordNode(mode === "phone" ? "call" : "dialog", partyId, {
          label: said.slice(0, 16) + (said.length > 16 ? "…" : ""),
          tag: res && (res.reveal || res.overstep) ? "good" : "ok"
        });
        const cited = [];
        if (refs && refs.notes && refs.notes.length) { cited.push("笔记×" + refs.notes.length); }
        if (refs && refs.laws && refs.laws.length) { cited.push("法条×" + refs.laws.length); }
        const head = (mode === "phone" ? "【通话·" : "【问话·") + party.name + "】"
          + said.slice(0, 40) + (cited.length ? "（引用 " + cited.join("、") + "）" : "") + "：";
        if (reply) { phone?.addNote?.(head + reply); }
      }
    });
    state.dialog = dlg;
    // 通话和到场问话共用一张面板，只把抬头和身份行换掉：
    // 「问 话」→「通 话」，身份后面挂一个真实的通话计时；右上角 × 就是挂断。
    if (mode === "phone") {
      const kicker = dlg.el.querySelector(".dlg-kicker");
      if (kicker) { kicker.textContent = "通 话"; }
      const roleEl = dlg.el.querySelector(".dlg-role");
      const baseRole = String(party.role || "");
      const startedAt = Date.now();
      const tick = () => {
        if (!roleEl) { return; }
        const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
        const mm = String(Math.floor(s / 60)).padStart(2, "0");
        const ss = String(s % 60).padStart(2, "0");
        roleEl.textContent = (baseRole ? baseRole + " · " : "") + "通话中 " + mm + ":" + ss;
      };
      tick();
      callTimer = setInterval(tick, 1000);
      const x = dlg.el.querySelector(".dlg-x");
      if (x) { x.setAttribute("aria-label", "挂断"); x.setAttribute("title", "挂断"); }
    }
    // 点人时焦点还在 iframe 里，Esc 会发给场景窗口；把焦点收回面板输入框，
    // 键盘事件才落在宿主页（面板自己也挂了 capture 监听）。
    setTimeout(() => {
      try { dlg.el.querySelector(".dlg-input").focus({ preventScroll: true }); }
      catch (err) { /* 老浏览器 */ }
    }, 30);
    showHint((mode === "phone" ? "通话中：" : "问话：") + party.name + " · 想说什么就说什么");
    return dlg;
  });
}

// 手机通讯录点「拨打」：和地图上点人是同一张问话面板，只是 channel 记成 phone。
// 手机壳 .tp-root 是 z-index 9000，问话面板是 72 —— 不收起来会把面板整个盖住，
// 所以先把手机滑出屏幕（0.35s），再弹面板；关闭面板（×/Esc）就是挂断。
let callOpenTimer = 0;
function callFromPhone(partyId) {
  if (!partyId) { return; }
  clearTimeout(callOpenTimer);
  phone?.close?.();
  callOpenTimer = setTimeout(() => {
    if (!state.started) { return; }
    openDialog(partyId, { mode: "phone" });
  }, 380);
}

// ---------------------------------------------------------------- ⑤ 评价 / 复盘
let review = null;
let replay = null;

function buildRubric() {
  const dims = state.data?.dimensions || [];
  return {
    mustMention: dims.map((d) => d.name).filter(Boolean),
    timeLimit: { ok: ["七日内", "七天内", "三日内", "三天内"], score: 8 },
    forbid: []
  };
}

// 手机评价页的文本框在「结案」时按行/句拆成 claims 传进来（最小版，不做结构化编辑）。
// 空文本就是空方案：评价只认写过的正文，不拿维度拼示例方案。
function buildReviewInput() {
  const plan = state.plan || { claims: [] };
  return {
    evidence: evidenceForPhone(),
    plan,
    rubric: buildRubric()
  };
}

function openReview() {
  if (!state.data) { showHint("案卷还在加载，稍等一下再评价。"); return; }
  closeDialog();
  closeReplay();
  if (review) { review.destroy(); review = null; }
  const input = buildReviewInput();
  reviewLayer.classList.add("on");
  review = createReview({
    mount: reviewLayer,
    data: input,
    onClose: () => { closeReview(); },
    onReplay: () => { closeReview(); openReplay(); }
  });
  state.review = { score: review.score(), input };
  // 手机「评价复盘」页也把分数显示出来（原来一直是「—」）
  phone?.setReviewScore?.(review.score());
  return review;
}

function closeReview() {
  reviewLayer.classList.remove("on");
  if (review) { review.destroy(); review = null; }
}

function closeCase(plan) {
  if (plan && Array.isArray(plan.claims)) { state.plan = plan; }
  // 三个案子各结各的：只把当前这件标成已结，换回另外两件仍然能看空态、继续办。
  state.closedByCase[state.caseId] = true;
  state.closed = true;
  phone?.setClosed?.(true);
  phone?.close?.();
  applyPhoneData();
  showHint("案子已结，评价卡出来了");
  openReview();
}

// ---- 复盘节点：真实操作 ≥10 条就用玩家的，否则按案卷排一条 12 节点的参考线
function nodeTagFor(kind, factId) {
  if (kind === "blocked") { return "bad"; }
  if (kind === "spot" && factId && caseState.keyIds.has(factId)) { return "good"; }
  return "ok";
}

function recordNode(kind, rawId, extra) {
  const def = SCENES[state.sceneId];
  const factId = caseState.spotFact[rawId] || rawId;
  const key = caseState.keyIds.has(factId);
  const label = caseState.spotLabel[rawId] || "";
  let action = "";
  if (kind === "person") {
    const p = state.data?.parties?.[rawId] || {};
    action = "与「" + (p.name || rawId) + "」谈话";
  } else if (kind === "dialog") {
    const p = state.data?.parties?.[rawId] || {};
    action = "问「" + ((extra && extra.label) || "话题") + "」· " + (p.name || rawId);
  } else if (kind === "call") {
    const p = state.data?.parties?.[rawId] || {};
    action = "通话「" + ((extra && extra.label) || "话题") + "」· " + (p.name || rawId);
  } else if (kind === "seat") {
    action = "坐下" + (label ? "：" + label : "");
  } else if (kind === "blocked") {
    action = "走向一个过不去的点";
  } else if (label) {
    action = "查看「" + label + "」";
  } else {
    const f = caseState.factsById[factId];
    action = f ? "查看《" + f.title + "》" : "查看了 " + rawId;
  }
  const t = Math.max(0, Math.round((performance.now() - state.t0) / 1000));
  // 节点坐标必须记"这件事发生时主角站的位置"。以前这里写的是场景的默认落机位
  // （def.actor），同一场景里所有节点的 actor 完全一样 —— 复盘时点哪个都飞到同一点，
  // 用户看到的就是"点哪都一样"。readActorPos 读的是 iframe 里 __mini.actorPos()：
  // spot/person 的点击本来就发生在"走到点位之后"，所以这里拿到的就是现场坐标。
  const at = readActorPos();
  const ax = Number(at && at.x);
  const az = Number(at && at.z);
  const live = Number.isFinite(ax) && Number.isFinite(az);
  const px = live ? ax : (def?.actor?.x ?? 0);
  const pz = live ? az : (def?.actor?.z ?? 0);
  state.nodes.push({
    t, scene: def ? def.name : state.sceneId, sceneId: state.sceneId,
    actor: [px, pz],
    action, tag: (extra && extra.tag) || nodeTagFor(kind, factId), id: rawId, fact: factId
  });
  if (state.nodes.length > 40) { state.nodes.shift(); }
  if (extra?.key) { state.seen.add(factId); }
}

function demoNodes() {
  const d = state.data || {};
  const facts = (d.facts || []).slice();
  const parties = d.partyOrder || Object.keys(d.parties || {});
  const dims = d.dimensions || [];
  const keyFacts = facts.filter((f) => caseState.keyIds.has(f.id));
  const rest = facts.filter((f) => !caseState.keyIds.has(f.id));
  const picked = keyFacts.concat(rest).slice(0, 6);
  const out = [];
  let t = 6;
  const step = 22;
  // 参考时间轴（玩家真实操作不足 10 条时的兜底）没有逐节点的走位数据：
  // 按"同一场景里的第几个节点"沿 x 铺开一个落点，12 个节点各占一处；
  // 否则每个节点都钉在 def.actor，复盘点哪个都落在同一个机位。
  const nth = {};
  const push = (action, tag, sceneId) => {
    const def = SCENES[sceneId] || SCENES.duty;
    const k = (nth[sceneId] = (nth[sceneId] || 0) + 1);
    const x = Math.max(-4.5, Math.min(4.5, def.actor.x + (k - 2) * 1.15));
    const z = Math.max(-4.5, Math.min(6, def.actor.z + ((k % 3) - 1) * 0.7));
    out.push({ t, scene: def.name, sceneId, actor: [x, z],
               action, tag, demo: true });
    t += step;
  };
  const alarm = String((d.alarm && (d.alarm.text || d.alarm.source)) || "接到报警");
  push("接警：" + alarm.slice(0, 26), "ok", "duty");
  picked.forEach((f) => push("查看《" + (f.title || f.id) + "》", "good", "wall"));
  const p1 = d.parties?.[parties[0]]?.name || "当事人甲";
  const p2 = d.parties?.[parties[1]]?.name || "当事人乙";
  push("与「" + p1 + "」单独谈：先听他把话说完", "ok", "wall");
  push("与「" + p2 + "」背靠背问底线", "ok", "wall");
  push("现场量尺、拍照，把界石位置写进笔录", "good", "wall");
  push("出方案：" + dims.slice(0, 3).map((x) => x.name).join(" / "), "ok", "mediation");
  push("签字结案：约定履行期限与验收方式", "good", "mediation");
  return out.slice(0, 12);
}

function buildTimeline() {
  const real = state.nodes.slice(-14);
  if (real.length >= 10) { return real; }
  return demoNodes();
}

function openReplay(nodes) {
  const list = nodes || buildTimeline();
  if (!list.length) { showHint("还没有可复盘的节点。"); return; }
  closeDialog();
  if (replay) { replay.destroy(); replay = null; }
  replayHost.textContent = "";
  replayLayer.classList.add("on");
  replay = createReplay({
    mount: replayHost,
    nodes: list,
    onSeek: (node, i) => seekReplay(node, i)
  });
  state.replay = { count: (replay.nodes || []).length, seeks: 0, demo: list.some((n) => n && n.demo) };
  return replay;
}

function closeReplay() {
  const wasOpen = replayLayer.classList.contains("on") || !!replay;
  replayLayer.classList.remove("on");
  replayHost.textContent = "";
  if (replay) { replay.destroy(); replay = null; }
  // 收起复盘后把相机交回场景内的自由视角（否则会停在 REPLAY 高空）
  if (wasOpen && state.started && state.frameReady && state.sceneId) {
    const def = SCENES[state.sceneId];
    if (def) { startPlay(def); }
  }
}

// 点节点：镜头飞回当时的机位。REPLAY 是第 6 个状态（§2 那张表），
// 机位仍由外壳算、由 postMessage 下发 —— 场景那边不许自己动相机。
function seekReplay(node, index) {
  if (state.replay) { state.replay.seeks += 1; }
  // 机位锚点用节点自己记下的坐标。旧代码这里是：
  //   const sameScene = !node.sceneId || node.sceneId === state.sceneId;
  //   const a = sameScene ? node.actor : null;          // 跨场景一律退回当前主角位
  // 加上 recordNode 把每个节点都写成 def.actor，结果就是所有节点共用同一个机位。
  const def = SCENES[state.sceneId] || SCENES.duty;
  const a = node && Array.isArray(node.actor) ? node.actor : null;
  const ax = a ? Number(a[0]) : NaN;
  const az = a ? Number(a[1]) : NaN;
  const x = Number.isFinite(ax) ? ax : def.actor.x;
  const z = Number.isFinite(az) ? az : def.actor.z;
  // 同一锚点也可能叠着多个节点（坐下 / 谈话都在同一张凳子旁）：再按节点序号
  // 给一个很小的方位差（±0.66rad），保证第 N 个和第 M 个落的是两个机位。
  // 半径沿用原来的斜距（6.4 / 7.2 ≈ 9.63），构图不变。
  const i = Number.isFinite(Number(index)) ? Number(index) : 0;
  const yaw = 0.72 + ((i % 7) - 3) * 0.22;
  const R = 9.6;
  const pose = {
    pos: [x + Math.sin(yaw) * R, 7.4, z + Math.cos(yaw) * R],
    look: [x, 1.0, z],
    fov: 38
  };
  stopPlay();                       // REPLAY 期间机位由 flight 的补间控制
  flight.to("REPLAY", pose);
  sendToFrame("camera:owner", { external: true });
  sendToFrame("camera:set", { pos: pose.pos, look: pose.look, fov: pose.fov });
  showHint("回放第 " + (i + 1) + " 个节点" + (node && node.scene ? " · " + node.scene : ""));
}

replayClose.addEventListener("click", () => closeReplay());
addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape") { return; }
  if (state.dialog) { ev.stopPropagation(); closeDialog(); return; }
  if (replay) { ev.stopPropagation(); closeReplay(); }
});

// ---------------------------------------------------------------- ⑥ 场景事件
addEventListener("message", (ev) => {
  const d = ev.data || {};
  if (d.source !== "mini3d") { return; }

  // 预热 iframe 的 ready 只用来推进进度条
  if (preloadEl && ev.source === preloadEl.contentWindow) {
    if (d.type === "scene:ready") { onPreloadReady(ev.source); }
    return;
  }
  if (ev.source !== frame.contentWindow) { return; }

  if (d.type === "scene:ready") {
    // 首屏背景是 iframe 里的 S0：一就绪就把相机抬到俯瞰位，并锁住 owner。
    if (!state.started) { armBoardCamera(); return; }
    // 传送中：这条 ready 就是"加载完成"的信号 —— 先兑现 flight 那边的等待（云才肯散），
    // 再走常规激活。activateScene 看到 FLIGHT 不会抢镜头，落地机位仍归转场补间。
    if (pendingReady && pendingReady.id === state.sceneId
        && readyFromScene(ev.source, pendingReady.id)) {
      pendingReady.finish("ready");
    }
    activateScene();
    return;
  }

  // 场景侧发的是渲染事件的完整名（spot:click / person:click / actor:seat /
  // actor:blocked），外壳这里统一收成短名再记账。以前只认短名，导致真实点出来的
  // 证据一个都没进时间轴（点完照样"没反应"）。
  const typeAlias = {
    "spot:click": "spot",
    "person:click": "person",
    "actor:seat": "seat",
    "actor:blocked": "blocked"
  };
  const evType = typeAlias[d.type] || d.type;
  if (evType === "spot") {
    handleSpotClick(d.payload?.id || "");
    return;
  }
  if (evType === "person" || evType === "seat" || evType === "blocked") {
    const id = d.payload?.id || "";
    recordNode(evType, id, { key: evType !== "blocked" });
    // 场景走不过去（物件/目标点不可达）：给一句人话，别让玩家以为"点了没反应"
    if (evType === "blocked") { showHint("太远了，走近点再点"); }
    if (evType === "person" && id) {
      // 走近之后才开面板：场景侧 person:click 是"到位"才发的，和点证据同一条链路。
      openDialog(id);
    }
    if (evType !== "blocked" && id) {
      const factId = caseState.spotFact[id] || id;
      state.seen.add(factId);
      phone?.setData?.({ evidence: evidenceForPhone() });
    }
  }
});

// ---------------------------------------------------------------- ⑦ 帧循环
let last = performance.now();
function tick(now) {
  // 单帧抛错不许把整条循环打死：记一笔 __err，下一帧照常跑
  // （探针断言 __err 为空，所以"记下来"和"别卡死"两件事都得做）
  try {
    frameTick(now);
  } catch (err) {
    if (!window.__err) { window.__err = String((err && err.stack) || err); }
  }
  requestAnimationFrame(tick);
}

function frameTick(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (boot && !state.started) {
    boot.update?.(dt);
    const pr = boot.progress;
    if (pr) { flight.parallax(pr.yaw, pr.pitch); }   // 看板视差带着镜头一起动（§1.2）
  }
  flight.update(dt);
  // 加载页整屏被云盖住时，背后的 3D 不用画：一帧省一次全屏合成，预热更快
  if (!state.loading.active && loadEl.hidden) {
    renderer.render(scene, camera);
  }

  // 首屏：iframe 相机压在俯瞰位；点开始后走 2.4s 下移，落位前不交还 owner。
  if (!state.started) {
    if (state.camDescent) { updateBoardDescent(now); }
    else if (state.boardCam) { pushBoardCamera(now); }
  }

  // 相机：落位/传送/复盘时跟 flight 逐帧同步；进场景落定后交给自由视角，
  // 只有机位真的变了才下发（不再每帧灌 camera:set 把玩家的拖拽覆盖掉）。
  if (state.started) {
    if (state.cam === "play" && playCam.active) {
      const a = readActorPos();
      if (a) { flight.track(a.x, a.z, dt); }
      syncPlayCamera(false);
    } else {
      sendToFrame("camera:set", flight.view);
    }
  }
}
requestAnimationFrame(tick);

addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  if (loadCloudRAF) { sizeLoadCloud(); }
});

// 首屏：相机先摆到 BOARD
flight.to("BOARD", { dur: 0.01 });

// 首屏背景 = S0 值班室本体（真实的屋子，不是占位盒子）
frame.src = "./scenes/duty.html";
frame.classList.add("on");
frame.style.pointerEvents = "none";     // 首屏时只当背景，点击交给上面的看板层

// 案卷先拉起来（不等加载页，手机一开就有数据）；案件清单并行拉，
// 手机「案件档案」要能一次列出同时接到的三件。
state.dataPromise = loadCase(DEFAULT_CASE);
loadCaseIndex();
loadPersonScenes().then(() => applyPhoneData());   // 映射晚到就再刷一次手机数据
loadLaws();          // 引用法条的选择列表：先热一下，点面板时不用等

// 自己的异常也记一笔：探针断言 window.__err 为空，才说明外壳没在后台报错
addEventListener("error", (ev) => {
  if (!window.__err) { window.__err = String((ev && ev.message) || "error"); }
});
addEventListener("unhandledrejection", (ev) => {
  if (!window.__err) { window.__err = "unhandledrejection: " + String((ev && ev.reason) || ""); }
});

// ---------------------------------------------------------------- 探针与外壳入口
function startGame() {
  if (state.started) { return true; }
  if (!state.loading.active) { openLoading(); }
  return true;
}

// 三个案子同时可办：手机「案件档案」里点哪件，这里就把当前案卷换成哪件。
// 玩法不重开、场景不重置，只换案卷数据（手机里的案件页仍然列全三件）。
function setCase(id) {
  if (!id || !id.startsWith("case_")) { return false; }
  closeDialog();
  if (id === state.caseId && state.data && state.data.id === id) {
    phone?.openPage?.("case");
    return true;
  }
  state.caseId = id;
  state.data = null;
  state.plan = null;
  state.closed = !!state.closedByCase[id];
  state.dataPromise = loadCase(id);
  // 案卷还在路上：先把列表里的「在办」标记挪过去，别让人以为没点到
  phone?.setData?.({ cases: caseListForPhone() });
  const meta = (state.caseIndex || []).find((c) => c.id === id) || {};
  showHint("当前案件：" + (CASE_NAME[id] || meta.title || id));
  return true;
}

window.__app = {
  flight, boot, phone, state, camera, scene, SCENES, SCENE_ORDER,
  isMobile: IS_MOBILE, isTouch: IS_TOUCH,
  enterScene, teleport, startGame, setCase, openPhone,
  loadCaseIndex, allScenes, caseListForPhone,
  openDialog, closeDialog,
  loading: state.loading,
  openLoading, preloadAll,
  openReview, closeReview, closeCase, openReplay, closeReplay, seekReplay,
  buildTimeline, buildReviewInput, evidenceForPhone,
  scorePlan,
  get review() { return review; },
  get replay() { return replay; },
  get dialog() { return state.dialog; },
  get data() { return state.data; },
  get caseList() { return state.caseIndex.slice(); }
};
