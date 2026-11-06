// replay.js · 复盘时间轴（最终形态提示词 §7）
// -----------------------------------------------------------------------------
// 一条横向时间轴：节点按 tag 上色（绿=做对 / 黄=可更好 / 红=明显失误），
// 点节点 → 回调 onSeek(node)，由外壳把相机飞回当时的机位；
// 节点展开后给一句「如果当时…」的对照；底部一条进度带把整场走势摊平。
//
// 用法：
//   const rp = createReplay({ mount: $("phoneBody"), onSeek: (node) => flight.replay(node) });
//   rp.setNodes(caseData.replayNodes);        // 10~14 个节点
//   rp.select(3);                             // 也可以程序选中
//
// 节点结构：{ t, scene, actor: [x, z], action, tag: "good"|"ok"|"bad" }
// 可选字段：ifThen（/alt/hint/contrast/tip）—— 自己写好的「如果当时…」，优先于自动生成
// -----------------------------------------------------------------------------
import { PAL } from "../scenes/kit.js";

// =============================================================================
// 一、数据与文案
// =============================================================================

const TAGS = {
  good: { color: PAL.mint, label: "做对", dot: "g" },
  ok: { color: PAL.yellow, label: "可更好", dot: "y" },
  bad: { color: PAL.coral, label: "明显失误", dot: "r" }
};
const TAG_ORDER = ["good", "ok", "bad"];
const tagOf = (n) => (n && TAGS[n.tag] ? n.tag : "ok");

// 「如果当时…」：先看节点自带的，再按动作关键词挑，最后按 tag 兜底。
// 都控制在 30 字以内，一句话说完。
const HINTS = [
  { re: /打断|抢话|拍桌|吼|呛|顶|吵/, txt: "不接那句硬话，这个节点还能往回收。" },
  { re: /分开|背靠背|单独|回避/, txt: "分开谈这一步是对的，收口时再合起来。" },
  { re: /法条|条款|念|引用|依据/, txt: "把法条留到最后一句说，前面先让人把话讲尽。" },
  { re: /问|聊|听|劝|谈/, txt: "把「还有呢」多问一句，关键的话往往在后头。" },
  { re: /查看|看|量|拍|翻|查档|档案|找/, txt: "顺手把这一幕存进证据夹，后面就不用只靠嘴说。" },
  { re: /让|出资|分摊|赔|补偿|退/, txt: "先让他自己把数说出口，比你说的好接受。" },
  { re: /走|离开|起身|散场|结束|摔门/, txt: "先别起身，把话停在这儿也比摔门走强。" }
];

const BY_TAG = {
  good: [
    "把这句话对着另一边再说一遍，这一步就闭环了。",
    "多留一句依据，事后谁也赖不掉。"
  ],
  ok: [
    "先问一句「您想怎么解决」，就不用绕这一圈。",
    "把话头交给当事人，比自己下判断省力。"
  ],
  bad: [
    "不接那句硬话，这里还有回旋的余地。",
    "先分开谈，就不会当面对上。"
  ]
};

const PREFIX = "如果当时";

function ifThenFor(node, i) {
  const own = node && (node.ifThen || node.alt || node.hint || node.contrast || node.tip || node.then);
  if (typeof own === "string" && own.trim()) {
    return own.trim().replace(/^如果当时[，,、\s]*/, "");
  }
  const act = String((node && node.action) || "");
  for (const h of HINTS) {
    if (h.re.test(act)) { return h.txt; }
  }
  const list = BY_TAG[tagOf(node)];
  return list[Math.abs(i) % list.length];
}

function fmtTime(t) {
  const s = Math.max(0, Math.round(Number(t) || 0));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

function fmtPos(actor) {
  if (!Array.isArray(actor) || actor.length < 2) { return ""; }
  const x = Number(actor[0]);
  const z = Number(actor[1]);
  if (!Number.isFinite(x) || !Number.isFinite(z)) { return ""; }
  return "(" + x.toFixed(1) + ", " + z.toFixed(1) + ")";
}

// =============================================================================
// 二、样式（只注入一次；色值全部来自 kit.js 的 PAL）
// =============================================================================

const STYLE_ID = "rp-style";

function ensureStyle() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) { return; }
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent =
    ".rp-overlay{position:fixed;inset:0;z-index:60;display:grid;place-items:center;padding:20px;" +
      "background:rgba(41,72,88,.45);animation:rp-fade .2s ease both;}" +
    ".rp-host{position:relative;box-sizing:border-box;width:100%;min-width:0;max-width:100%;" +
      "display:flex;flex-direction:column;gap:8px;" +
      "padding:14px 14px 12px;background:" + PAL.white + ";border:1.5px solid " + PAL.ink + ";border-radius:14px;" +
      "box-shadow:0 18px 40px -20px rgba(41,72,88,.55);color:" + PAL.ink + ";" +
      "font-family:\"PingFang SC\",\"Microsoft YaHei\",\"Noto Sans SC\",system-ui,sans-serif;" +
      "animation:rp-in .3s cubic-bezier(.2,.85,.25,1) both;}" +
    ".rp-overlay .rp-host{width:min(100%,560px);}" +
    ".rp-host--flat{border:0;border-radius:0;box-shadow:none;background:transparent;padding:0;}" +
    ".rp-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;}" +
    ".rp-title{font-size:14px;font-weight:600;letter-spacing:.2em;white-space:nowrap;}" +
    ".rp-count{font-size:10.5px;opacity:.55;white-space:nowrap;}" +
    ".rp-legend{margin-left:auto;display:flex;gap:9px;font-size:10px;opacity:.8;white-space:nowrap;}" +
    ".rp-legend i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:3px;" +
      "vertical-align:1px;}" +
    ".rp-legend .g{background:" + PAL.mint + ";}" +
    ".rp-legend .y{background:" + PAL.yellow + ";}" +
    ".rp-legend .r{background:" + PAL.coral + ";}" +
    ".rp-railWrap{position:relative;margin:0 -4px;}" +
    ".rp-overlay .rp-railWrap::after{content:\"\";position:absolute;top:0;right:0;bottom:8px;width:22px;" +
      "pointer-events:none;background:linear-gradient(90deg,rgba(255,250,240,0)," + PAL.white + ");}" +
    ".rp-rail{position:relative;display:flex;gap:4px;padding:2px 10px 8px;overflow-x:auto;overflow-y:hidden;" +
      "min-width:0;max-width:100%;" +
      "scroll-behavior:smooth;scrollbar-width:thin;" +
      "mask-image:linear-gradient(90deg,transparent 0,#000 10px,#000 calc(100% - 14px),transparent 100%);" +
      "-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 10px,#000 calc(100% - 14px),transparent 100%);}" +
    ".rp-rail::-webkit-scrollbar{height:4px;}" +
    ".rp-rail::-webkit-scrollbar-thumb{background:rgba(53,83,100,.22);border-radius:2px;}" +
    ".rp-rail::before{content:\"\";position:absolute;left:14px;right:14px;top:13px;height:2px;" +
      "background:rgba(53,83,100,.16);border-radius:1px;}" +
    ".rp-node{position:relative;flex:0 0 86px;display:flex;flex-direction:column;align-items:center;gap:2px;" +
      "padding:0 2px 2px;border:0;background:none;font:inherit;color:inherit;cursor:pointer;text-align:center;}" +
    ".rp-node[data-tag=good]{--c:" + PAL.mint + ";}" +
    ".rp-node[data-tag=ok]{--c:" + PAL.yellow + ";}" +
    ".rp-node[data-tag=bad]{--c:" + PAL.coral + ";}" +
    ".rp-dot{width:14px;height:14px;margin:4px 0 5px;border-radius:50%;background:var(--c);" +
      "border:2px solid " + PAL.white + ";box-shadow:0 0 0 1.5px var(--c);" +
      "transition:transform .16s ease,box-shadow .16s ease;}" +
    ".rp-node:hover .rp-dot{transform:scale(1.16);}" +
    ".rp-node.is-on .rp-dot{transform:scale(1.2);box-shadow:0 0 0 2px " + PAL.ink + ";}" +
    ".rp-time{font-size:9.5px;line-height:1.2;opacity:.55;font-variant-numeric:tabular-nums;}" +
    ".rp-act{font-size:10.5px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;" +
      "-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;}" +
    ".rp-node.is-on .rp-act{font-weight:600;}" +
    ".rp-node:focus-visible{outline:none;}" +
    ".rp-node:focus-visible .rp-dot{outline:2px solid " + PAL.navy + ";outline-offset:2px;}" +
    ".rp-detail{box-sizing:border-box;min-height:80px;padding:8px 11px;border-radius:10px;" +
      "background:rgba(255,243,215,.62);border:1px solid rgba(53,83,100,.14);" +
      "display:flex;flex-direction:column;gap:3px;justify-content:center;}" +
    ".rp-d-meta{font-size:9.5px;letter-spacing:.06em;opacity:.6;}" +
    ".rp-d-act{font-size:12.5px;line-height:1.45;}" +
    ".rp-d-if{margin-top:3px;padding-top:5px;border-top:1px dashed rgba(233,133,120,.5);" +
      "font-size:12px;line-height:1.5;color:" + PAL.coral + ";}" +
    ".rp-d-if b{font-weight:600;letter-spacing:.06em;}" +
    ".rp-empty{font-size:11.5px;line-height:1.6;opacity:.55;text-align:center;}" +
    ".rp-band{display:flex;gap:2px;height:9px;border-radius:5px;overflow:hidden;" +
      "background:rgba(53,83,100,.1);}" +
    ".rp-seg{flex:0 0 auto;min-width:4px;border:0;padding:0;background:var(--c);opacity:.82;cursor:pointer;" +
      "transition:opacity .16s ease;}" +
    ".rp-seg[data-tag=good]{--c:" + PAL.mint + ";}" +
    ".rp-seg[data-tag=ok]{--c:" + PAL.yellow + ";}" +
    ".rp-seg[data-tag=bad]{--c:" + PAL.coral + ";}" +
    ".rp-seg:hover{opacity:1;}" +
    ".rp-seg.is-on{opacity:1;box-shadow:inset 0 0 0 2px " + PAL.ink + ";}" +
    ".rp-foot{display:flex;align-items:baseline;gap:8px;font-size:9.5px;opacity:.5;}" +
    ".rp-foot span:last-child{margin-left:auto;}" +
    "@keyframes rp-in{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:none;}}" +
    "@keyframes rp-fade{from{opacity:0;}to{opacity:1;}}" +
    // 真机：复盘面板按视口封顶；时间轴保留横向滚动，并显式开启触摸惯性。
    "@media (max-width:640px), (max-height:560px){" +
      ".rp-overlay{padding:calc(10px + env(safe-area-inset-top)) calc(10px + env(safe-area-inset-right))" +
        " calc(10px + env(safe-area-inset-bottom)) calc(10px + env(safe-area-inset-left));}" +
      ".rp-host{width:100%;max-width:100%;max-height:calc(100vh - env(safe-area-inset-top)" +
        " - env(safe-area-inset-bottom) - 20px);max-height:calc(100dvh - env(safe-area-inset-top)" +
        " - env(safe-area-inset-bottom) - 20px);padding:12px 11px 10px;gap:7px;overflow-y:auto;}" +
      ".rp-title{font-size:16px;}" +
      ".rp-count{font-size:13px;}" +
      ".rp-legend{font-size:13px;gap:7px;}" +
      ".rp-rail{-webkit-overflow-scrolling:touch;touch-action:pan-x;padding:2px 8px 10px;}" +
      ".rp-node{flex:0 0 78px;}" +
      ".rp-time{font-size:13px;}" +
      ".rp-act{font-size:13px;}" +
      ".rp-d-meta{font-size:13px;}" +
      ".rp-d-act{font-size:14px;}" +
      ".rp-d-if{font-size:13px;}" +
      ".rp-empty{font-size:13px;}" +
      ".rp-foot{font-size:13px;}" +
    "}" +
    "@media (prefers-reduced-motion:reduce){" +
      ".rp-host,.rp-overlay,.rp-rail{animation:none !important;scroll-behavior:auto;}" +
      ".rp-dot{transition:none;}" +
    "}";
  document.head.appendChild(s);
}

function resolveMount(m) {
  if (m && typeof m === "object" && m.nodeType === 1) { return m; }
  if (typeof m === "string") { return document.querySelector(m); }
  return null;
}

// =============================================================================
// 三、时间轴
// =============================================================================

/**
 * 横向复盘时间轴。
 * @param {Object}   opt
 * @param {Element|string} [opt.mount]  挂载点；不传就自己铺一层居中浮层
 * @param {Function} [opt.onSeek]       点节点时回调 (node, index) —— 外壳据此飞回机位
 * @param {Array}    [opt.nodes]        构造时直接给节点
 * @returns {{ el, setNodes, select, current, nodes, destroy }}
 */
export function createReplay(opt) {
  const opts = opt || {};
  ensureStyle();

  const mount = resolveMount(opts.mount);
  let overlay = null;
  let host = null;
  if (mount) {
    host = document.createElement("div");
    host.className = "rp-host rp-host--flat";
    mount.appendChild(host);
  } else {
    overlay = document.createElement("div");
    overlay.className = "rp-overlay";
    host = document.createElement("div");
    host.className = "rp-host";
    overlay.appendChild(host);
    (document.body || document.documentElement).appendChild(overlay);
  }

  host.innerHTML =
    '<div class="rp-head">' +
      '<div class="rp-title">复盘</div>' +
      '<div class="rp-count">0 个节点</div>' +
      '<div class="rp-legend">' +
        TAG_ORDER.map((k) => '<span><i class="' + TAGS[k].dot + '"></i>' + TAGS[k].label + "</span>").join("") +
      "</div>" +
    "</div>" +
    '<div class="rp-railWrap"><div class="rp-rail"></div></div>' +
    '<div class="rp-detail"></div>' +
    '<div class="rp-band"></div>' +
    '<div class="rp-foot"><span>整场走势</span></div>';

  const countEl = host.querySelector(".rp-count");
  const railEl = host.querySelector(".rp-rail");
  const detailEl = host.querySelector(".rp-detail");
  const bandEl = host.querySelector(".rp-band");

  let nodes = [];
  let nodeEls = [];
  let segEls = [];
  let cur = -1;

  const onSeek = typeof opts.onSeek === "function" ? opts.onSeek : null;

  function normalize(list) {
    const out = (Array.isArray(list) ? list : [])
      .filter((n) => n && typeof n === "object")
      .map((n) => ({
        t: Number(n.t) || 0,
        scene: n.scene,
        actor: n.actor,
        action: n.action,
        tag: tagOf(n),
        raw: n
      }));
    // 都是数字时间就按时间排；有一个不是，就保持调用方给的顺序
    const allNum = out.every((n) => Number.isFinite(Number(n.raw.t)));
    if (allNum) { out.sort((a, b) => a.t - b.t); }
    return out;
  }

  function durations() {
    return nodes.map((n, i) => {
      const next = nodes[i + 1];
      const d = next ? next.t - n.t : 24;
      return Math.max(1, Math.round(Number(d) || 1));
    });
  }

  function renderDetail(node) {
    detailEl.textContent = "";
    if (!node) {
      detailEl.innerHTML = '<div class="rp-empty">点一个节点</div>';
      return;
    }
    const meta = document.createElement("div");
    meta.className = "rp-d-meta";
    const pos = fmtPos(node.actor);
    // 坐标是给相机用的，不写进正文；鼠标停上去能看到
    if (pos) { meta.title = "机位 " + pos; }
    meta.textContent = [fmtTime(node.t), node.scene ? String(node.scene) : ""].filter(Boolean).join(" · ");

    const act = document.createElement("div");
    act.className = "rp-d-act";
    act.textContent = String(node.action || "（这一步没留下记录）");

    const iff = document.createElement("div");
    iff.className = "rp-d-if";
    const b = document.createElement("b");
    b.textContent = PREFIX;
    iff.appendChild(b);
    iff.appendChild(document.createTextNode(ifThenFor(node.raw, cur)));

    detailEl.appendChild(meta);
    detailEl.appendChild(act);
    detailEl.appendChild(iff);
  }

  function scrollToNode(i) {
    const el = nodeEls[i];
    const rail = railEl;
    if (!el || !rail) { return; }
    const left = el.offsetLeft - (rail.clientWidth - el.offsetWidth) / 2;
    if (typeof rail.scrollTo === "function") {
      rail.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
    } else {
      rail.scrollLeft = Math.max(0, left);
    }
  }

  function select(i, o) {
    const n = nodes[i];
    if (!n) { return null; }
    cur = i;
    nodeEls.forEach((el, j) => {
      el.classList.toggle("is-on", j === i);
      if (j === i) { el.setAttribute("aria-current", "true"); }
      else { el.removeAttribute("aria-current"); }
    });
    segEls.forEach((el, j) => { el.classList.toggle("is-on", j === i); });
    renderDetail(n);
    if (!o || o.scroll !== false) { scrollToNode(i); }
    if ((!o || o.seek !== false) && onSeek) {
      try { onSeek(n.raw, i); } catch (err) { console.error("[replay] onSeek 回调出错", err); }
    }
    return n.raw;
  }

  function render() {
    countEl.textContent = nodes.length + " 个节点";

    railEl.textContent = "";
    bandEl.textContent = "";
    nodeEls = [];
    segEls = [];

    if (!nodes.length) {
      const empty = document.createElement("div");
      empty.className = "rp-empty";
      empty.textContent = "还没有可复盘的节点";
      railEl.appendChild(empty);
      renderDetail(null);
      return;
    }

    const durs = durations();
    const totalD = durs.reduce((a, b) => a + b, 0);

    nodes.forEach((n, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "rp-node";
      btn.dataset.tag = n.tag;
      btn.dataset.i = String(i);
      btn.setAttribute("aria-label", fmtTime(n.t) + " " + String(n.action || "") + "（" + TAGS[n.tag].label + "）");

      const dot = document.createElement("span");
      dot.className = "rp-dot";
      dot.setAttribute("aria-hidden", "true");

      const time = document.createElement("span");
      time.className = "rp-time";
      time.textContent = fmtTime(n.t);

      const act = document.createElement("span");
      act.className = "rp-act";
      act.textContent = String(n.action || "（无记录）");

      btn.appendChild(dot);
      btn.appendChild(time);
      btn.appendChild(act);
      btn.addEventListener("click", () => { select(i); });
      railEl.appendChild(btn);
      nodeEls.push(btn);
    });

    nodes.forEach((n, i) => {
      const seg = document.createElement("button");
      seg.type = "button";
      seg.className = "rp-seg";
      seg.dataset.tag = n.tag;
      seg.dataset.i = String(i);
      seg.style.flexGrow = String(Math.max(1, durs[i]));
      seg.style.flexBasis = "0";
      seg.title = fmtTime(n.t) + " " + String(n.action || "") + " · " + TAGS[n.tag].label;
      seg.setAttribute("aria-label", seg.title);
      seg.addEventListener("click", () => { select(i); });
      bandEl.appendChild(seg);
      segEls.push(seg);
    });
    bandEl.dataset.total = String(totalD);

    renderDetail(null);
  }

  function setNodes(list) {
    nodes = normalize(list);
    cur = -1;
    render();
    return api;
  }

  function destroy() {
    if (host) { host.removeEventListener("keydown", onKey); }
    if (overlay) { overlay.remove(); } else if (host) { host.remove(); }
    overlay = null;
    host = null;
    nodeEls = [];
    segEls = [];
  }

  function onKey(ev) {
    if (!nodes.length) { return; }
    if (ev.key === "ArrowRight") {
      ev.preventDefault();
      select(Math.min(nodes.length - 1, cur + 1));
    } else if (ev.key === "ArrowLeft") {
      ev.preventDefault();
      select(Math.max(0, cur - 1));
    }
  }

  // 鼠标滚轮也能横着走：时间轴默认只有触控板和 shift+滚轮，桌面端太藏
  function onWheel(ev) {
    if (!ev.deltaY || Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) { return; }
    if (railEl.scrollWidth <= railEl.clientWidth + 1) { return; }
    ev.preventDefault();
    railEl.scrollLeft += ev.deltaY;
  }
  railEl.addEventListener("wheel", onWheel, { passive: false });

  // 只在时间轴内部响应左右键；外面的方向键归相机
  host.addEventListener("keydown", onKey);
  if (overlay) {
    overlay.addEventListener("click", (ev) => { if (ev.target === overlay) { destroy(); } });
  }

  const api = {
    el: overlay || host,
    /** 换一批节点并重画（点/选中状态会清空） */
    setNodes,
    /** 选中第 i 个节点，默认会回调 onSeek */
    select,
    /** 当前选中的原始节点；没选返回 null */
    current: () => (cur >= 0 && nodes[cur] ? nodes[cur].raw : null),
    /** 只读副本 */
    get nodes() { return nodes.map((n) => n.raw); },
    destroy
  };

  if (opts.nodes) { setNodes(opts.nodes); } else { render(); }
  return api;
}

