// flight.js · 相机状态机 + 云朵转场（最终形态提示词 §2、§3）
// -----------------------------------------------------------------------------
// 全作只有这一个入口能改相机。任何"镜头从 A 到 B"都走 `fly()`，
// 任何"换地图"都走 `transfer()`。场景自己不许再动 camera。
//
// 设计要点：
//   ① 每个状态是一组参数（位置、看向、距离、俯仰），切换一律补间，禁止硬切；
//   ② 云朵转场是唯一允许的全屏遮挡，云形由 canvas 画，不是白屏；
//   ③ 所有动画共用一条 tick，时间用真实毫秒，掉帧也不会变慢或变快；
//   ④ 转场是"五段 + 一段变长"：抬升 → 云起 → 云盖住时切场景并等 ready（变长）
//      → 云散 → 下降。换场景不再靠固定时间窗口，加载多久就等多久。
//
// 用法：
//   const flight = createFlight({ camera, dom, onState });
//   flight.to("BOARD");                     // 首屏
//   flight.follow(actorPos, yaw);           // 落地跟随
//   flight.transfer(loadNewScene);          // 地图传送（云朵），loadNewScene() 返回 Promise
//   flight.update(dt);                      // 每帧调用
// -----------------------------------------------------------------------------
import * as THREE from "../scenes/vendor/three.module.min.js";
// 云形抽到 clouds.js：加载页 / 口令页 / 转场共用同一套形状（见文件头注释）。
import { paintClouds } from "./clouds.js";
export { paintClouds };

const EASE = {
  linear: (t) => t,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutQuint: (t) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2)
};

// ---------------------------------------------------------------- 转场时序（§2 云朵传送）
// 五段，speed 是整体倍速（1 = 正常）：
//   ① 抬升 1.8s   相机升到"俯瞰整张地图"的高位 —— 抬升**完全结束**才开始出云
//   ② 云起 0.8s   六团云合拢盖满
//   ③ 等待 ×       云盖满的那一拍切场景，然后**一直等**新场景 ready（变长，9s 封顶）
//   ④ 云散 1.2s   加载完成之后才散
//   ⑤ 下降 1.6s   从高位运镜落到常规位
// ③ 是唯一一段时长不固定的：不能再用"固定时间窗口"去换场景 —— 软件渲染一掉帧
// 就会整段跳过那个 0.1s 窗口，结果是云散了、场景没换（旧写法的已知 bug 源）。
export const TRANSFER = { lift: 1.8, rise: 0.8, dissolve: 1.2, descend: 1.6, loadTimeout: 9 };

// 抬升位：整块底座（室外 20.1×20.1，含 1.1 米高的侧板）四边全部进画面，四周留呼吸边。
// 比原来的 14 米高出一倍 —— 14 米时底座前沿会被画面下沿切掉，只看得到半张地图。
// 1440×900 实测（NDC，±1 = 画面边缘）：底 -0.79 / 顶 +0.67 / 左右 ±0.62，
// 即底边留 21%、顶边留 33%、两侧各留 38%。
export const LIFT_POSE = { pos: [0, 27.5, 17], look: [0, -1.2, 0], fov: 42 };

// 六个状态的默认参数（坐标都在场景坐标系里，y 是离地高度）
export const PRESET = {
  BOARD:  { pos: [0, 10.6, -12.5], look: [0, 3.4, 0], fov: 40, ease: "inOutCubic", dur: 1.2 },
  FOLLOW: { pos: [0, 1.6, 2.6],  look: [0, 1.35, 0], fov: 42, ease: "outCubic",   dur: 0.6 },
  DIALOG: { pos: [0, 1.5, 2.2],  look: [0, 1.4, 0],  fov: 40, ease: "inOutCubic", dur: 0.7 },
  LOOK:   { pos: [0, 1.3, 1.2],  look: [0, 1.2, 0],  fov: 36, ease: "inOutCubic", dur: 0.7 },
  REPLAY: { pos: [0, 7.0, 5.0],  look: [0, 0.8, 0],  fov: 38, ease: "inOutCubic", dur: 1.0 }
};

// ---------------------------------------------------------------- 云形（可复用）
// 形状与绘制在 clouds.js（加载页、口令页、转场共用）；这里 re-export 保持旧调用方不变。

export function createFlight({ camera, dom, onState, onTransfer, clock = () => performance.now() }) {
  const state = {
    mode: "BOARD",
    tween: null,          // { from, to, t0, dur, ease }
    cloud: null,          // { phase, t0, done }
    yaw: 0, pitch: 0,     // FOLLOW 下由玩家拖动累加
    disturbed: false,
    // BOARD 视差：看板层由 boot 算，镜头由这里跟 —— 相机只有一个主人。
    // 目标角由宿主每帧喂进来（boot.progress），这里做阻尼，超调不会超过 ±0.35。
    par: { yaw: 0, pitch: 0, tyaw: 0, tpitch: 0, on: false }
  };

  const cur = {
    pos: new THREE.Vector3(...PRESET.BOARD.pos),
    look: new THREE.Vector3(...PRESET.BOARD.look),
    fov: PRESET.BOARD.fov
  };

  // ---------------------------------------------------------------- 场景内自由视角
  // 进场景落定后（app 调 beginPlay）镜头仍然只有 flight 一个主人：
  // 拖动/滚轮只改 cur，再由 app 把 view 下发给 iframe。
  // 场景那边收到 camera:owner { external:true } 后 placeCamera() 会直接 return，
  // 不会再每帧把机位拽回自己的 HOME —— 这是"两个主人互相覆盖"的根因。
  const play = {
    on: false,
    base: new THREE.Vector3(),   // 入场景时相机相对 look 的偏移（双击回正用）
    baseFov: 42
  };
  const _off = new THREE.Vector3();

  // ---------------------------------------------------------------- 云层（DOM 覆盖）
  const cv = document.createElement("canvas");
  cv.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;opacity:0;z-index:40;";
  (dom || document.body).appendChild(cv);
  const cx = cv.getContext("2d");

  function sizeCanvas() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  sizeCanvas();
  addEventListener("resize", sizeCanvas);

  function drawCloud(k, t) {
    // k: 0→1 合拢程度（0 = 云彻底散开，把画布藏起来省一次全屏合成）
    if (k <= 0.001) {
      cv.style.opacity = "0";
      if (cv._on) { cx.clearRect(0, 0, innerWidth, innerHeight); cv._on = false; }
      return;
    }
    cv.style.opacity = "1";
    cv._on = true;
    paintClouds(cx, innerWidth, innerHeight, k, t);
  }

  // ---------------------------------------------------------------- 补间
  function fly(to, opts = {}) {
    play.on = false;                 // 任何脚本运镜都收回自由视角，避免两套参数同时改 cur
    const p = typeof to === "string" ? PRESET[to] : to;
    if (!p) { return; }
    const dur = (opts.dur ?? p.dur ?? 0.8) * 1000;
    state.tween = {
      from: { pos: cur.pos.clone(), look: cur.look.clone(), fov: cur.fov },
      to: {
        pos: new THREE.Vector3(...(opts.pos || p.pos)),
        look: new THREE.Vector3(...(opts.look || p.look)),
        fov: opts.fov ?? p.fov ?? 38
      },
      // at：补间的起算时刻。转场用它把"云散完"那个绝对点钉死，
      // 掉帧只会让这一帧少走一点，不会把整段往后拖（默认 = 现在）。
      t0: Number.isFinite(opts.at) ? opts.at : clock(),
      dur, ease: EASE[opts.ease || p.ease || "inOutCubic"]
    };
    // 传预设名就等于进那个状态（flight.to("REPLAY") 不设模式的话，
    // 宿主拿到的 mode 会停在旧值，验收脚本对着 mode 断言就会假通过）
    const mode = opts.mode || (typeof to === "string" ? to : null);
    if (mode && mode !== state.mode) { state.mode = mode; onState?.(mode); }
  }

  // 落点换算：主角背后 dist 米、高 h 米，看向主角胸口。
  // follow() 与云朵转场的落地补间共用同一套算式，落定不跳。
  function pose(actorPos, facing = 0, opts = {}) {
    const dist = opts.dist ?? 4.2, h = opts.height ?? 2.2;
    const yaw = facing + (opts.yaw ?? state.yaw);
    return {
      pos: [actorPos.x - Math.sin(yaw) * dist, h, actorPos.z - Math.cos(yaw) * dist],
      look: [actorPos.x, opts.lookY ?? 1.2, actorPos.z],
      fov: opts.fov ?? 42
    };
  }

  function apply() {
    // BOARD 视差：绕「看板中心」把机位转一个小角度（不是平移整块画面）。
    // 只在 BOARD 里生效 —— 进了场景以后镜头归 follow/dialog 管，视差归零。
    let px = cur.pos.x, py = cur.pos.y, pz = cur.pos.z;
    if (state.mode === "BOARD" && !state.cloud && !state.tween) {
      const a = state.par.yaw, b = state.par.pitch;
      if (Math.abs(a) > 1e-5 || Math.abs(b) > 1e-5) {
        const dx = px - cur.look.x, dz = pz - cur.look.z;
        const ca = Math.cos(a), sa = Math.sin(a);
        px = cur.look.x + dx * ca - dz * sa;
        pz = cur.look.z + dx * sa + dz * ca;
        py += b * 3.2;      // 俯仰：抬/压 3.2 米的臂长，±0.18 → ±0.58m
      }
    }
    camera.position.set(px, py, pz);
    camera.lookAt(cur.look);
    if (Math.abs(camera.fov - cur.fov) > 0.01) { camera.fov = cur.fov; camera.updateProjectionMatrix(); }
  }

  // 视差目标：宿主每帧喂 boot.progress 的 yaw/pitch（弧度，已封在 ±0.35 / ±0.18）
  function parallax(yaw, pitch) {
    state.par.tyaw = Number.isFinite(yaw) ? yaw : 0;
    state.par.tpitch = Number.isFinite(pitch) ? pitch : 0;
    state.par.on = true;
  }

  // ---------------------------------------------------------------- 转场（§2 云朵传送）
  // 云的可视程度 k（0 = 没云，1 = 盖死）记在 c.k 上，探针读 flight.transition 就能看到
  // "此刻云盖到几成"，不用去猜 canvas 的像素。
  // 已经盖死（k=1）且没有变化时不必每帧重画：整屏 shadowBlur 很贵，而这段正好是新场景
  // 在解析/建场景的时候，抢 CPU 会把 ready 拖慢几百毫秒。140ms 重画一次（约 7fps）
  // 云照样在缓慢漂浮，看不出是"跳帧"。
  function cloudAt(c, k, now) {
    const kk = Math.max(0, Math.min(1, k));
    if (Math.abs(kk - c.k) < 0.002 && c.k > 0.995 && now - (c.lastPaint || 0) < 140) { return; }
    c.k = kk;
    c.lastPaint = now;
    drawCloud(c.k, now);
  }

  // ③ 的开始：调加载器。三种写法都吃：
  //   loadScene() → Promise      （app.js 的 teleport 走这条）
  //   loadScene(done)            （形参 ≥1 时等 done() 回调）
  //   loadScene() → 非 Promise   （同步完成，直接算加载完）
  // Promise 未 resolve / done() 未调用之前，云一直保持 k=1 —— 这就是"变长的那一段"。
  function beginLoad(c) {
    if (c.loadStarted) { return; }
    c.loadStarted = true;
    c.loadT0 = clock();
    const done = () => {
      if (c.loadDone) { return; }
      c.loadDone = true;
      c.loadAt = clock();
    };
    if (!c.loadScene) { done(); return; }
    const wantsDone = c.loadScene.length >= 1;
    let ret = null;
    try {
      ret = c.loadScene(done);
    } catch (err) {
      done();
      return;
    }
    if (ret && typeof ret.then === "function") { ret.then(done, done); }
    else if (!wantsDone) { done(); }
  }

  function startDescent(c) {
    if (c.landed) { return; }
    c.landed = true;
    if (!c.land) { return; }          // 没给落点：原地停住（老调用方行为不变）
    // at = 云散完那个绝对时刻：掉帧不会把 1.6s 的下降拉长
    fly({ pos: c.land.pos, look: c.land.look, fov: c.land.fov ?? c.fov,
          ease: "outCubic", dur: TRANSFER.descend * c.speed,
          at: c.loadAt + c.dissolveMs });   // fly() 的 dur 是秒
  }

  function finishTransfer(c, snap) {
    state.cloud = null;
    drawCloud(0, clock());
    if (snap) {
      // 跳过 = 直接到 ⑤ 末尾：不做 1.6s 的下降补间，一帧站到落点
      state.tween = null;
      const p = c.land || c.lift;
      if (p) {
        cur.pos.set(p.pos[0], p.pos[1], p.pos[2]);
        cur.look.set(p.look[0], p.look[1], p.look[2]);
        cur.fov = p.fov ?? c.fov;
      }
    }
    state.mode = "FOLLOW";
    onState?.("FOLLOW");
    onTransfer?.(c);
  }

  // 一跳一帧地推进五段时序。所有分界点都是**绝对时间戳**（t0 / loadAt），
  // 不是"这一帧发现该换段了才从现在起算" —— 掉一帧只是这一段少走一点，
  // 不会把后面每一段都往后推一帧。软件渲染 8~12fps 时这一点很要紧。
  function stepTransfer(c, now) {
    // ③ 的保险丝：加载器既不 resolve 也不调 done() 时，云不能永远盖着屏幕
    if (c.loadStarted && !c.loadDone && now - c.loadT0 > c.safetyMs) {
      c.loadDone = true; c.loadAt = clock(); c.overdue = true;
    }

    const el = now - c.t0;
    // ① 抬升：完全结束才出云
    if (el < c.liftMs) {
      c.phase = "lift";
      cloudAt(c, 0, now);
      return;
    }
    // ② 云起
    if (!c.loadStarted && el < c.liftMs + c.riseMs) {
      c.phase = "rise";
      cloudAt(c, (el - c.liftMs) / c.riseMs, now);
      return;
    }
    // ③ 云盖满的那一拍：切场景，然后一直等 ready —— 云保持盖住不动
    if (!c.loadStarted) {
      c.phase = "hold";
      cloudAt(c, 1, now);
      beginLoad(c);
      return;
    }
    if (!c.loadDone) {
      c.phase = "hold";
      cloudAt(c, 1, now);
      return;
    }
    // ④ 云散：从"加载完成那一刻"起算（不是从这一帧起算）
    const after = now - c.loadAt;
    if (after < c.dissolveMs) {
      c.phase = "dissolve";
      cloudAt(c, 1 - after / c.dissolveMs, now);
      return;
    }
    // ⑤ 下降：散完才开；补间同样从 dissolveMs 那个绝对点起算
    c.phase = "descend";
    cloudAt(c, 0, now);
    startDescent(c);
    if (after >= c.dissolveMs + c.descendMs) { finishTransfer(c, false); }
  }

  // 点击跳过（整段转场玩家不能操作，唯一允许的就是这一下）。
  // skipArmAt 之前的事件不算：触发这次转场的那次点击会一路冒泡到 window，
  // 不挡掉的话"点地图地点"会当场把转场跳过去。
  function skipTransfer() {
    const c = state.cloud;
    if (!c) { return false; }
    if (clock() < c.skipArmAt) { return false; }
    c.skipped = true;
    return true;
  }

  // 转场期间在任何地方按下都算"跳过"（手机会话里的点按除外 —— 那是开手机不是跳过）
  addEventListener("pointerdown", (ev) => {
    if (!state.cloud) { return; }
    const t = ev.target;
    if (t && typeof t.closest === "function" && t.closest(".tp-root")) { return; }
    skipTransfer();
  }, true);

  // ---------------------------------------------------------------- 对外 API
  return {
    get mode() { return state.mode; },
    get yaw() { return state.par.yaw; },
    get pitch() { return state.par.pitch; },
    // 当前机位（app 用它下发 camera:set；pos/look 是普通数组，方便直接 postMessage）
    get view() {
      return {
        pos: [cur.pos.x, cur.pos.y, cur.pos.z],
        look: [cur.look.x, cur.look.y, cur.look.z],
        fov: cur.fov
      };
    },
    get playing() { return play.on; },

    // ---- 场景内自由视角（FOLLOW 落定后由 app 接管输入，参数仍归 flight）
    // beginPlay 把当前"背后跟随"的机位记成基准位：之后拖动/缩放/回正都绕 cur.look。
    beginPlay() {
      play.on = true;
      state.tween = null;
      state.yaw = 0; state.pitch = 0;
      play.base.copy(cur.pos).sub(cur.look);
      play.baseFov = cur.fov;
      return this.view;
    },
    endPlay() { play.on = false; },

    // 左键拖动：绕 look 转（yaw 不设上限，可 360°），上下拖改**俯仰角**。
    // 用角度而不是"高度（米）"：视距固定，4m 和 40m 处同样的手拖量得到同样的俯仰变化，
    // 拉到远景也能一路抬到 83°（接近正俯视）——旧写法按米加、再被 4.6m 夹住，
    // 越远越抬不起来，远景永远是贴地平视。
    orbit(dx, dy) {
      if (!play.on) { return; }
      _off.copy(cur.pos).sub(cur.look);
      const d = _off.length() || 0.001;
      const r = Math.hypot(_off.x, _off.z) || 0.001;
      const a = Math.atan2(_off.x, _off.z) - dx * 0.006;
      const phi = Math.atan2(_off.y, r);           // 0 = 平视，π/2 = 正俯视
      const next = Math.max(-0.06, Math.min(1.45, phi + dy * 0.0022));
      const flat = Math.cos(next) * d;
      cur.pos.set(cur.look.x + Math.sin(a) * flat,
                  cur.look.y + Math.sin(next) * d,
                  cur.look.z + Math.cos(a) * flat);
      apply();
    },

    // 滚轮/双指：沿视线拉近拉远（4.0~40 米）。负 deltaY = 拉近（与场景 side 的手感一致）。
    // 4.0 是"贴脸但不穿模"的温和下限；40 是 1440×900 下整块 20m 底座 + 四周留边的上限。
    // 滚轮和双指捏合在 app.js 里是同一个入口，改这一处两边一起生效。
    zoom(deltaY) {
      if (!play.on) { return; }
      _off.copy(cur.pos).sub(cur.look);
      const d = _off.length() || 0.001;
      const nd = Math.max(4.0, Math.min(40.0, d * Math.exp(deltaY * 0.0015)));
      cur.pos.copy(cur.look).addScaledVector(_off, nd / d);
      apply();
    },

    // 主角走动时镜头跟住（保持入场景时的相对机位；不做硬切）
    track(x, z, dt) {
      if (!play.on) { return; }
      const k = 1 - Math.exp(-Math.max(0, dt) * 9);
      const dx = (x - cur.look.x) * k;
      const dz = (z - cur.look.z) * k;
      if (Math.abs(dx) + Math.abs(dz) < 0.0002) { return; }
      cur.look.x += dx; cur.look.z += dz;
      cur.pos.x += dx; cur.pos.z += dz;
      apply();
    },

    // 双击 / R：回到入场景时的机位（仍以当前主角位置为 look）
    resetPlay() {
      if (!play.on) { return; }
      cur.pos.copy(cur.look).add(play.base);
      cur.fov = play.baseFov;
      apply();
    },

    to(mode, opts) { fly(mode, opts); },
    // 无补间落位：视口从"俯瞰"切到"常规"时，外壳需要在一帧内把 cur 挪到落点，
    // 否则 follow() 会从看板位起补，画面先闪一下。
    snap(p, opts = {}) {
      if (!p || !Array.isArray(p.pos) || !Array.isArray(p.look)) { return; }
      cur.pos.set(p.pos[0], p.pos[1], p.pos[2]);
      cur.look.set(p.look[0], p.look[1], p.look[2]);
      cur.fov = p.fov ?? 42;
      state.tween = null;
      state.yaw = 0;
      state.pitch = 0;
      const mode = opts.mode || state.mode;
      if (mode !== state.mode) { state.mode = mode; onState?.(mode); }
      apply();
    },
    pose,
    // 首屏视差：宿主每帧把 boot.progress 喂进来，镜头绕看板轻轻偏一点
    parallax,

    // 跟随：把状态机参数换算成"主角背后 4.2 米"的世界坐标
    follow(actorPos, facing = 0, opts = {}) {
      const p = pose(actorPos, facing, opts);
      fly({ pos: p.pos, look: p.look, fov: p.fov, ease: opts.ease || "outCubic",
            dur: opts.dur ?? 0.6 }, { mode: "FOLLOW", ...opts });
    },

    // 对话：机位在两人连线的垂直方向偏出去，不正对任何一方
    dialog(a, b, opts = {}) {
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len, nz = dx / len;
      const side = opts.side ?? 1;
      fly({ pos: [mx + nx * 2.2 * side, 1.5, mz + nz * 2.2 * side],
            look: [mx, 1.4, mz], fov: 40, ease: "inOutCubic", dur: 0.7 },
          { mode: "DIALOG", ...opts });
    },

    lookAt(target, normal, opts = {}) {
      const d = opts.dist ?? 1.2;
      fly({ pos: [target.x + normal.x * d, 1.3, target.z + normal.z * d],
            look: [target.x, 1.2, target.z], fov: 36, ease: "inOutCubic", dur: 0.7 },
          { mode: "LOOK", ...opts });
    },

    // 云朵转场：抬升 1.8 → 云起 0.8 → 云盖住时切场景并等 ready（变长，9s 封顶）
    //            → 云散 1.2 → 下降 1.6。总时长 = 5.4s + 加载时长。
    // loadScene 是"加载器"：返回 Promise，或形参写成 (done) 等回调。
    // 它 resolve / done() 之前云一直盖住 —— 不再靠固定时间窗口换场景。
    // opts.land = { pos:[x,y,z], look:[x,y,z], fov } —— 下降落到的常规位。
    // 不传就原地停住（老调用方行为不变）。
    transfer(loadScene, opts = {}) {
      const speed = opts.speed ?? 1;
      const t0 = clock();
      // 转场开始时把玩家的拖拽角清零：落地机位按 scene 配置算，不能带着上一张图的偏航
      state.yaw = 0; state.pitch = 0;
      state.par.yaw = 0; state.par.pitch = 0;
      const lift = opts.lift || LIFT_POSE;
      state.cloud = {
        t0, phase: "lift", speed, k: 0,
        // 各段时长（毫秒）固定在这里：阶段推进只跟这些数和 t0 / loadAt 比，
        // 不跟"上一帧"比，所以掉帧不会把整段转场越拖越长。
        liftMs: TRANSFER.lift * 1000 * speed,
        riseMs: TRANSFER.rise * 1000 * speed,
        dissolveMs: TRANSFER.dissolve * 1000 * speed,
        descendMs: TRANSFER.descend * 1000 * speed,
        loadScene: typeof loadScene === "function" ? loadScene : null,
        loadStarted: false, loadDone: false, loadT0: 0, loadAt: 0, overdue: false,
        safetyMs: (opts.loadTimeout ?? TRANSFER.loadTimeout) * 1000 + 400,
        skipped: false, skipArmAt: t0 + 320,
        land: opts.land || null, landed: false, fov: opts.fov ?? 42,
        lift: { pos: lift.pos.slice(), look: lift.look.slice(), fov: lift.fov ?? 42 }
      };
      // ① 抬升：直接升到俯瞰整张地图的高位（不再用"原地拔高到 14 米"）
      // 注意 fly() 的 dur 单位是秒，这里不能先乘 1000。
      fly({ pos: state.cloud.lift.pos, look: state.cloud.lift.look,
            fov: state.cloud.lift.fov, ease: "inOutQuint", dur: TRANSFER.lift * speed,
            at: t0 },
          { mode: "FLIGHT" });
    },

    // 跳过：整段转场直接到 ⑤ 末尾。若此时新场景还没 ready，云继续盖住，等它就绪再收。
    skip() { return skipTransfer(); },

    // 转场进度（探针用）：phase / 云覆盖 k / 加载状态 / 各段实际耗时
    get transition() {
      const c = state.cloud;
      if (!c) { return null; }
      return { phase: c.phase, k: c.k, skipped: c.skipped,
               loadStarted: c.loadStarted, loaded: c.loadDone, overdue: c.overdue,
               elapsed: +((clock() - c.t0) / 1000).toFixed(3),
               loadMs: c.loadDone ? Math.round(c.loadAt - c.loadT0) : null,
               sinceLoad: c.loadDone ? Math.round(clock() - c.loadAt) : null };
    },

    // 玩家拖动（只有 FOLLOW/REPLAY 生效）
    drag(dx, dy) {
      if (state.mode !== "FOLLOW" && state.mode !== "REPLAY") { return; }
      state.yaw -= dx * 0.006;
      state.pitch = Math.max(-0.5, Math.min(0.9, state.pitch + dy * 0.004));
      state.disturbed = true;
    },

    update(dt) {
      const now = clock();
      const dtNow = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 1 / 60;

      // 云转场优先（五段时序见 stepTransfer）
      if (state.cloud) {
        const c = state.cloud;
        if (c.skipped) {
          // 跳过：没切场景就先切，然后直接到 ⑤ 末尾；
          // 但新场景没 ready 之前云不许散 —— 否则会露出一个还在加载的 iframe。
          beginLoad(c);
          if (c.loadDone) { finishTransfer(c, true); }
          else { cloudAt(c, 1, now); }
        } else {
          stepTransfer(c, now);
        }
      } else {
        drawCloud(0, now);
      }

      // 补间
      if (state.tween) {
        const k = Math.min(1, (now - state.tween.t0) / state.tween.dur);
        const e = state.tween.ease(k);
        cur.pos.lerpVectors(state.tween.from.pos, state.tween.to.pos, e);
        cur.look.lerpVectors(state.tween.from.look, state.tween.to.look, e);
        cur.fov = state.tween.from.fov + (state.tween.to.fov - state.tween.from.fov) * e;
        if (k >= 1) { state.tween = null; }
      }

      // FOLLOW 的环绕：绕主角转，而不是绕世界原点
      if (state.mode === "FOLLOW" && !state.tween && (state.yaw || state.pitch)) {
        const look = cur.look;
        const r = Math.hypot(cur.pos.x - look.x, cur.pos.z - look.z);
        const a = Math.atan2(cur.pos.x - look.x, cur.pos.z - look.z) + state.yaw * 0.02;
        cur.pos.x = look.x + Math.sin(a) * r;
        cur.pos.z = look.z + Math.cos(a) * r;
        cur.pos.y = 1.6 + state.pitch * 1.4;
        state.yaw *= 0.96;
      }

      // 视差阻尼：按 60fps 标定，鼠标停住后不会抖；回到场景里自动收敛到 0
      const aimYaw = state.mode === "BOARD" ? state.par.tyaw : 0;
      const aimPitch = state.mode === "BOARD" ? state.par.tpitch : 0;
      const kv = 1 - Math.pow(1 - 0.08, Math.max(0.0001, dtNow) * 60);
      state.par.yaw += (aimYaw - state.par.yaw) * kv;
      state.par.pitch += (aimPitch - state.par.pitch) * kv;

      apply();
    }
  };
}
