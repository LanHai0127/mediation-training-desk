// dialog.js · 场景内问话面板（点人物 → 走近 → 弹这一层）
// -----------------------------------------------------------------------------
// 2026-11 改版：**不再有预设话题**。面板只留
//   人物名 + 信任/情绪两条量表 + 一个输入框 + 发送按钮 + 对话记录。
// 玩家想说什么就说什么，判断交给模型（POST /api/dialogue，外壳在 app.js 里发）。
//
// 两件配套：
//   · 引用：输入框旁「引用笔记」「引用法条」，选中的引用以小标签显示、可 × 删掉；
//     发送时把 { notes:[id], laws:[id] } 一起交给 chat，消息气泡里也把引用块画出来。
//   · 兜底：模型没接上（超时 / 网络 / 接口 5xx）时**不编造人物台词**，
//     只在对话区落一条系统状态「这次没接上，再说一遍」，输入框内容原样留着好重发。
//     只有服务端明确返回降级、且回话为空时，才用调用方给的 fallback[] 里的一句
//     （数据来自 cases_dialog.json / 案卷，不是这里现编的）。
//
// 防注入：玩家原话 / 模型回话 / 引用内容 / 人物名，全部走 textContent。
// 全文唯一一处 innerHTML 是下面那张**静态**骨架（只有标签和 class，没有任何外部文本）。
//
// 用法：
//   const dlg = createDialog({
//     party: { id: "p_a", name: "李秀兰", role: "报案人 · 东院住户" },
//     chat: (text, { mode, refs }) => Promise<{ reply, state, reveal, overstep,
//                                              degraded, failed } | null>,
//     getNotes: () => [{ id, text }],                   // 手机笔记（可缺省）
//     getLaws:  () => [{ id, law, article, title, gist }], // 法条（可缺省）
//     fallback: ["……"],                                 // 只给"服务端空回话"兜底
//     onClose: () => {},
//     onRecord: (text, refs, res) => {}
//   });
//   dlg.close();  dlg.destroy();
// -----------------------------------------------------------------------------
import { PAL } from "../scenes/kit.js";

const STYLE_ID = "dlg-style";
const MAX_CHARS = 300;        // 与 server.py 的 text[:300] 对齐
const SEND_TIMEOUT = 13000;   // 外壳 12s 超时；这里再兜一层，避免 busy 卡死

function clampText(value, max) {
  const s = String(value == null ? "" : value);
  const n = max || MAX_CHARS;
  return s.length > n ? s.slice(0, n) : s;
}

function textOf(node) {
  return node ? String(node.textContent || "") : "";
}

function ensureStyle() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) { return; }
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent =
    // 本文件用 [hidden] 控制「选择器 / 引用条 / 忙碌行」。作者样式的 display:grid/flex
    // 会盖掉 UA 的 [hidden]{display:none}，所以先钉死一条（手机里 .tp-root 也是这么做的）。
    ".dlg-overlay [hidden]{display:none !important;}" +
    ".dlg-overlay{position:fixed;inset:0;z-index:72;display:flex;align-items:flex-end;justify-content:center;" +
      "padding:18px;background:rgba(41,72,88,.46);opacity:0;transition:opacity .22s ease;" +
      "font-family:\"PingFang SC\",\"Microsoft YaHei\",\"Noto Sans SC\",system-ui,sans-serif;}" +
    ".dlg-overlay.is-on{opacity:1;}" +
    ".dlg-card{position:relative;width:min(100%,720px);max-height:min(86vh,720px);display:flex;flex-direction:column;" +
      "overflow:hidden;background:" + PAL.cream + ";color:" + PAL.ink + ";border:1.5px solid " + PAL.ink + ";" +
      "border-radius:16px;box-shadow:0 28px 60px -24px rgba(41,72,88,.72),inset 0 1px 0 " + PAL.white + ";" +
      "transform:translateY(14px);transition:transform .24s cubic-bezier(.2,.85,.25,1);}" +
    ".dlg-overlay.is-on .dlg-card{transform:none;}" +
    ".dlg-head{display:flex;align-items:flex-start;gap:14px;padding:14px 16px 11px;" +
      "border-bottom:1.5px solid rgba(53,83,100,.22);}" +
    ".dlg-who{min-width:0;display:flex;flex-direction:column;gap:3px;}" +
    ".dlg-kicker{font-size:9.5px;letter-spacing:.52em;color:" + PAL.navy + ";opacity:.7;}" +
    ".dlg-name{font:600 21px/1.2 \"Songti SC\",\"Noto Serif SC\",\"SimSun\",serif;letter-spacing:.1em;" +
      "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +
    ".dlg-role{font-size:11.5px;color:" + PAL.navy + ";opacity:.82;line-height:1.5;" +
      "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +
    ".dlg-x{margin-left:auto;flex:none;width:30px;height:30px;padding:0;border-radius:50%;" +
      "border:1.5px solid " + PAL.ink + ";background:transparent;color:" + PAL.ink + ";" +
      "font:16px/1 system-ui,sans-serif;cursor:pointer;display:grid;place-items:center;" +
      "transition:background .15s ease,color .15s ease;}" +
    ".dlg-x:hover{background:" + PAL.ink + ";color:" + PAL.cream + ";}" +
    ".dlg-meters{display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:8px 16px 0;" +
      "font-size:11px;color:" + PAL.navy + ";opacity:.9;}" +
    ".dlg-meter{display:flex;align-items:center;gap:6px;}" +
    ".dlg-meter i{display:block;width:82px;height:5px;border-radius:3px;background:rgba(49,92,114,.18);overflow:hidden;}" +
    ".dlg-meter b{display:block;height:100%;border-radius:3px;background:" + PAL.navy + ";transition:width .35s ease;}" +
    ".dlg-meter em{font-style:normal;color:" + PAL.ink + ";font-variant-numeric:tabular-nums;}" +
    ".dlg-deg{font-size:10.5px;letter-spacing:.06em;color:" + PAL.coral + ";}" +
    ".dlg-thread{flex:1 1 auto;min-height:110px;max-height:236px;overflow-y:auto;display:flex;flex-direction:column;" +
      "gap:8px;padding:12px 16px;background:rgba(255,250,240,.62);border-top:1px solid rgba(49,92,114,.16);" +
      "scrollbar-width:thin;}" +
    ".dlg-empty{margin:auto 0;text-align:center;font-size:11.5px;line-height:1.7;color:" + PAL.navy + ";opacity:.62;}" +
    ".dlg-msg{display:flex;flex-direction:column;max-width:86%;min-width:0;}" +
    ".dlg-msg--me{align-self:flex-end;align-items:flex-end;}" +
    ".dlg-msg--them{align-self:flex-start;}" +
    ".dlg-msg--sys{align-self:center;max-width:100%;}" +
    ".dlg-bubble{padding:8px 11px;border-radius:12px;font-size:13.5px;line-height:1.62;white-space:pre-wrap;" +
      "word-break:break-word;border:1px solid transparent;min-width:0;max-width:100%;}" +
    ".dlg-msg--me .dlg-bubble{background:" + PAL.navy + ";color:" + PAL.white + ";border-bottom-right-radius:4px;}" +
    ".dlg-msg--them .dlg-bubble{background:" + PAL.white + ";border-color:rgba(53,83,100,.2);" +
      "border-bottom-left-radius:4px;}" +
    ".dlg-sys{padding:6px 12px;border-radius:999px;font-size:11.5px;line-height:1.6;" +
      "background:rgba(233,133,120,.16);color:#8a3b30;border:1px solid rgba(233,133,120,.5);" +
      "text-align:center;max-width:100%;word-break:break-word;}" +
    ".dlg-quote{margin:0 0 6px;padding:6px 8px;border-left:2px solid currentColor;border-radius:6px;" +
      "background:rgba(255,250,240,.16);font-size:11px;line-height:1.55;max-width:100%;" +
      "white-space:normal;word-break:break-word;}" +
    ".dlg-msg--me .dlg-quote{background:rgba(255,250,240,.16);color:" + PAL.cream + ";}" +
    ".dlg-msg--them .dlg-quote{background:rgba(49,92,114,.08);color:" + PAL.navy + ";}" +
    ".dlg-quote b{display:block;font-size:9.5px;letter-spacing:.14em;opacity:.8;font-weight:600;margin-bottom:1px;}" +
    ".dlg-quote span{display:block;}" +
    ".dlg-quote small{display:block;margin-top:2px;font-size:10px;opacity:.8;}" +
    ".dlg-note{margin-top:4px;max-width:46ch;font-size:10.5px;line-height:1.55;color:" + PAL.coral + ";}" +
    ".dlg-note--good{color:#4f7a68;}" +
    ".dlg-busy{padding:8px 16px 2px;font-size:11px;color:" + PAL.navy + ";opacity:.75;letter-spacing:.06em;}" +
    ".dlg-refs{display:flex;flex-wrap:wrap;gap:6px;padding:8px 16px 0;max-width:100%;min-width:0;}" +
    ".dlg-ref{display:inline-flex;align-items:center;gap:5px;max-width:100%;min-width:0;padding:3px 4px 3px 9px;" +
      "border-radius:999px;border:1px solid rgba(49,92,114,.42);background:" + PAL.white + ";color:" + PAL.navy + ";" +
      "font-size:11px;line-height:1.5;}" +
    ".dlg-ref b{flex:none;font-size:9px;letter-spacing:.1em;opacity:.72;font-weight:600;}" +
    ".dlg-ref span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:32ch;}" +
    ".dlg-ref button{flex:none;width:20px;height:20px;padding:0;border:0;border-radius:50%;background:transparent;" +
      "color:" + PAL.coral + ";font:14px/1 system-ui,sans-serif;cursor:pointer;display:grid;place-items:center;}" +
    ".dlg-ref button:hover{background:rgba(233,133,120,.18);}" +
    ".dlg-compose{flex:none;padding:8px 16px 10px;border-top:1px solid rgba(49,92,114,.16);background:" + PAL.cream + ";}" +
    ".dlg-refbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding-bottom:7px;}" +
    ".dlg-chip{padding:4px 10px;border-radius:999px;border:1px solid rgba(49,92,114,.42);background:" +
      PAL.white + ";color:" + PAL.navy + ";font:11.5px/1.4 inherit;letter-spacing:.06em;cursor:pointer;" +
      "transition:background .15s ease,color .15s ease,border-color .15s ease;white-space:nowrap;}" +
    ".dlg-chip:hover{border-color:" + PAL.ink + ";}" +
    ".dlg-chip.is-on{background:" + PAL.navy + ";border-color:" + PAL.navy + ";color:" + PAL.white + ";}" +
    ".dlg-inputrow{display:flex;align-items:flex-end;gap:8px;min-width:0;}" +
    ".dlg-input{flex:1 1 auto;min-width:0;width:100%;height:44px;max-height:104px;resize:none;padding:11px 12px;" +
      "border-radius:12px;border:1px solid rgba(49,92,114,.42);background:" + PAL.white + ";color:" + PAL.ink + ";" +
      "font:13.5px/1.4 inherit;letter-spacing:.02em;outline:none;overflow-y:auto;}" +
    ".dlg-input:focus{border-color:" + PAL.navy + ";box-shadow:0 0 0 2px rgba(49,92,114,.16);}" +
    ".dlg-input.is-shake{animation:dlg-shake .2s ease;}" +
    "@keyframes dlg-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-3px)}75%{transform:translateX(3px)}}" +
    ".dlg-input::placeholder{color:" + PAL.navy + ";opacity:.5;}" +
    ".dlg-send{flex:none;height:44px;padding:0 16px;border-radius:12px;border:1.5px solid " + PAL.navy + ";" +
      "background:" + PAL.navy + ";color:" + PAL.white + ";font:600 13.5px/1 inherit;letter-spacing:.08em;" +
      "cursor:pointer;transition:opacity .15s ease,transform .12s ease;}" +
    ".dlg-send:hover:not(:disabled){opacity:.9;}" +
    ".dlg-send:active:not(:disabled){transform:translateY(1px);}" +
    ".dlg-send:disabled{opacity:.45;cursor:default;}" +
    ".dlg-foot{display:flex;align-items:baseline;gap:8px;padding:0 16px 11px;font-size:9.5px;" +
      "color:" + PAL.navy + ";opacity:.55;letter-spacing:.04em;}" +
    ".dlg-foot span:last-child{margin-left:auto;}" +
    ".dlg-picker{position:absolute;inset:0;z-index:6;display:grid;place-items:center;padding:14px;" +
      "background:rgba(41,72,88,.42);}" +
    ".dlg-picker-card{width:min(100%,460px);max-height:100%;display:flex;flex-direction:column;overflow:hidden;" +
      "border-radius:14px;border:1.5px solid " + PAL.ink + ";background:" + PAL.white + ";" +
      "box-shadow:0 24px 48px -20px rgba(41,72,88,.7);}" +
    ".dlg-picker-head{display:flex;align-items:center;gap:10px;padding:11px 13px;" +
      "border-bottom:1px solid rgba(49,92,114,.18);}" +
    ".dlg-picker-head b{font-size:13px;letter-spacing:.08em;color:" + PAL.ink + ";}" +
    ".dlg-picker-head em{margin-left:auto;font-style:normal;font-size:11px;color:" + PAL.coral + ";}" +
    ".dlg-picker-head button{flex:none;width:26px;height:26px;padding:0;border-radius:50%;" +
      "border:1px solid " + PAL.ink + ";background:transparent;color:" + PAL.ink + ";font:14px/1 system-ui,sans-serif;" +
      "cursor:pointer;display:grid;place-items:center;}" +
    ".dlg-picker-list{flex:1 1 auto;min-height:0;overflow-y:auto;padding:9px;display:flex;flex-direction:column;" +
      "gap:6px;scrollbar-width:thin;}" +
    ".dlg-pick{display:flex;align-items:flex-start;gap:8px;width:100%;min-width:0;padding:9px 10px;text-align:left;" +
      "border-radius:10px;border:1px solid rgba(49,92,114,.28);background:" + PAL.white + ";" +
      "color:" + PAL.ink + ";font:inherit;cursor:pointer;}" +
    ".dlg-pick:hover{border-color:" + PAL.coral + ";}" +
    ".dlg-pick.is-on{border-color:" + PAL.navy + ";background:rgba(49,92,114,.08);}" +
    ".dlg-pick b{flex:none;font-size:11px;line-height:1.8;color:" + PAL.coral + ";letter-spacing:.06em;}" +
    ".dlg-pick span{display:flex;flex-direction:column;gap:2px;min-width:0;}" +
    ".dlg-pick strong{font-size:12.5px;font-weight:600;letter-spacing:.04em;}" +
    ".dlg-pick small{font-size:10.5px;line-height:1.45;color:" + PAL.navy + ";opacity:.8;" +
      "display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}" +
    ".dlg-pick i{flex:none;margin-left:auto;font-style:normal;font-size:12px;color:" + PAL.navy + ";opacity:.5;}" +
    ".dlg-pick.is-on i{opacity:1;color:" + PAL.navy + ";}" +
    ".dlg-pick-none{padding:18px 10px;text-align:center;font-size:11.5px;line-height:1.7;" +
      "color:" + PAL.navy + ";opacity:.66;}" +
    ".dlg-picker-foot{flex:none;padding:9px 13px 11px;border-top:1px solid rgba(49,92,114,.18);display:flex;}" +
    ".dlg-picker-foot button{flex:1;min-height:36px;border-radius:10px;border:1.5px solid " + PAL.navy + ";" +
      "background:" + PAL.navy + ";color:" + PAL.white + ";font:600 12.5px/1 inherit;letter-spacing:.1em;cursor:pointer;}" +
    "@media (max-width:640px), (max-height:560px){" +
      // 安全区 + 动态视口：刘海不压表头、底部横条不压关闭/脚注；键盘弹起时 dvh 会收缩
      ".dlg-overlay{padding:calc(10px + env(safe-area-inset-top)) calc(10px + env(safe-area-inset-right))" +
        " calc(10px + env(safe-area-inset-bottom)) calc(10px + env(safe-area-inset-left));}" +
      ".dlg-card{max-height:min(92vh,720px);max-height:min(92dvh,720px);}" +
      ".dlg-head{padding:12px 12px 9px;gap:8px;}" +
      ".dlg-kicker{font-size:13px;letter-spacing:.3em;}" +
      ".dlg-name{font-size:20px;}" +
      ".dlg-role{font-size:13px;white-space:normal;}" +
      ".dlg-x{width:44px;height:44px;font-size:18px;}" +
      ".dlg-meters{font-size:13px;}" +
      ".dlg-deg{font-size:13px;}" +
      ".dlg-thread{padding:10px 12px;max-height:min(34dvh,236px);}" +
      ".dlg-empty{font-size:13px;}" +
      ".dlg-bubble{font-size:15px;}" +
      ".dlg-sys{font-size:13px;}" +
      ".dlg-quote{font-size:13px;}" +
      ".dlg-quote b{font-size:13px;letter-spacing:.08em;}" +
      ".dlg-quote small{font-size:13px;}" +
      ".dlg-note{font-size:13px;}" +
      ".dlg-busy{font-size:13px;padding:8px 12px 0;}" +
      ".dlg-refs{padding:8px 12px 0;}" +
      ".dlg-ref{font-size:13px;padding:5px 5px 5px 10px;}" +
      ".dlg-ref b{font-size:13px;}" +
      ".dlg-ref span{max-width:22ch;}" +
      ".dlg-ref button{width:32px;height:32px;font-size:16px;}" +
      ".dlg-compose{padding:8px 12px calc(10px + env(safe-area-inset-bottom));}" +
      ".dlg-chip{min-height:44px;padding:8px 12px;font-size:13px;}" +
      ".dlg-input{font-size:15px;height:46px;}" +
      ".dlg-send{font-size:14px;height:46px;padding:0 14px;}" +
      ".dlg-foot{padding:0 12px 4px;font-size:13px;}" +
      ".dlg-picker{padding:10px;}" +
      ".dlg-picker-head{padding:10px 12px;}" +
      ".dlg-picker-head b{font-size:15px;}" +
      ".dlg-picker-head em{font-size:13px;}" +
      ".dlg-picker-head button{width:44px;height:44px;font-size:18px;}" +
      ".dlg-pick{min-height:52px;padding:10px 11px;}" +
      ".dlg-pick b{font-size:13px;line-height:1.6;}" +
      ".dlg-pick strong{font-size:15px;}" +
      ".dlg-pick small{font-size:13px;}" +
      ".dlg-pick i{font-size:13px;}" +
      ".dlg-pick-none{font-size:13px;}" +
      ".dlg-picker-foot button{min-height:44px;font-size:14px;}" +
    "}" +
    "@media (prefers-reduced-motion:reduce){" +
      ".dlg-overlay,.dlg-card,.dlg-meter b,.dlg-ref{transition:none !important;}" +
    "}";
  document.head.appendChild(s);
}

export function createDialog(opts) {
  const o = opts || {};
  const party = o.party || { id: "", name: "当事人", role: "" };
  const chat = typeof o.chat === "function" ? o.chat : null;
  const onClose = typeof o.onClose === "function" ? o.onClose : null;
  const onRecord = typeof o.onRecord === "function" ? o.onRecord : null;
  const getNotes = typeof o.getNotes === "function" ? o.getNotes : () => [];
  const getLaws = typeof o.getLaws === "function" ? o.getLaws : () => [];
  const fallbackBank = (Array.isArray(o.fallback) ? o.fallback : [])
    .map((x) => String(x == null ? "" : x).trim()).filter(Boolean);
  let fallbackUsed = 0;

  ensureStyle();

  const overlay = document.createElement("div");
  overlay.className = "dlg-overlay";
  const card = document.createElement("div");
  card.className = "dlg-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", "问话 · " + party.name);
  overlay.appendChild(card);

  // 骨架只写标签与 class，不放任何一句台词 / 任何玩家内容；文字全部走 textContent。
  card.innerHTML =
    '<div class="dlg-head">' +
      '<div class="dlg-who">' +
        '<span class="dlg-kicker">问 话</span>' +
        '<b class="dlg-name"></b>' +
        '<span class="dlg-role"></span>' +
      "</div>" +
      '<button type="button" class="dlg-x" aria-label="关闭问话面板">×</button>' +
    "</div>" +
    '<div class="dlg-meters">' +
      '<div class="dlg-meter" data-k="trust"><span>信任</span><i><b style="width:35%"></b></i><em>35</em></div>' +
      '<div class="dlg-meter" data-k="mood"><span>情绪</span><i><b style="width:42%"></b></i><em>42</em></div>' +
      '<span class="dlg-deg" hidden></span>' +
    "</div>" +
    '<div class="dlg-thread" role="log" aria-live="polite">' +
      '<div class="dlg-empty"></div>' +
    "</div>" +
    '<div class="dlg-busy" hidden>对方在斟酌怎么说……</div>' +
    '<div class="dlg-refs" hidden></div>' +
    '<div class="dlg-compose">' +
      '<div class="dlg-refbar">' +
        '<button type="button" class="dlg-chip" data-ref="note">引用笔记</button>' +
        '<button type="button" class="dlg-chip" data-ref="law">引用法条</button>' +
      "</div>" +
      '<div class="dlg-inputrow">' +
        '<textarea class="dlg-input" rows="1" maxlength="' + MAX_CHARS + '" ' +
          'placeholder="想说什么就说什么，回车发送" aria-label="想问的话"></textarea>' +
        '<button type="button" class="dlg-send">发送</button>' +
      "</div>" +
    "</div>" +
    '<div class="dlg-foot"><span>Enter 发送 · Shift+Enter 换行 · Esc 关闭</span>' +
      '<span class="dlg-count"></span></div>' +
    '<div class="dlg-picker" hidden>' +
      '<div class="dlg-picker-card" role="dialog" aria-modal="true" aria-label="选择引用">' +
        '<div class="dlg-picker-head"><b class="dlg-picker-title"></b><em class="dlg-picker-n"></em>' +
          '<button type="button" class="dlg-picker-x" aria-label="关闭选择">×</button></div>' +
        '<div class="dlg-picker-list"></div>' +
        '<div class="dlg-picker-foot"><button type="button" class="dlg-picker-ok">完成</button></div>' +
      "</div>" +
    "</div>";

  card.querySelector(".dlg-name").textContent = party.name || "当事人";
  card.querySelector(".dlg-role").textContent = party.role || "";
  const threadEl = card.querySelector(".dlg-thread");
  const emptyEl = card.querySelector(".dlg-empty");
  const metersEl = card.querySelector(".dlg-meters");
  const degEl = card.querySelector(".dlg-deg");
  const busyEl = card.querySelector(".dlg-busy");
  const refsEl = card.querySelector(".dlg-refs");
  const inputEl = card.querySelector(".dlg-input");
  const sendEl = card.querySelector(".dlg-send");
  const countEl = card.querySelector(".dlg-count");
  const pickerEl = card.querySelector(".dlg-picker");
  const pickerTitle = card.querySelector(".dlg-picker-title");
  const pickerN = card.querySelector(".dlg-picker-n");
  const pickerList = card.querySelector(".dlg-picker-list");

  let busy = false;
  let closed = false;
  let turns = 0;
  let pickerKind = "";
  // 选中的引用：{ kind:"note"|"law", id, label, text }
  let refs = [];

  emptyEl.textContent = "想说什么就说什么。先听，再问事实，最后才讲规矩。";
  countEl.textContent = "0 轮";
  (document.body || document.documentElement).appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.classList.add("is-on");
  });

  // ---------------------------------------------------------------- 引用标签
  function refKey(r) { return r.kind + ":" + r.id; }

  function hasRef(r) { return refs.some((x) => refKey(x) === refKey(r)); }

  function toggleRef(r) {
    if (!r) { return; }
    if (hasRef(r)) {
      refs = refs.filter((x) => refKey(x) !== refKey(r));
    } else if (refs.length < 6) {
      refs = refs.concat([r]);
    }
    renderRefs();
    if (pickerKind) { paintPicker(); }
  }

  function renderRefs() {
    refsEl.textContent = "";
    refsEl.hidden = !refs.length;
    refs.forEach((r) => {
      const tag = document.createElement("span");
      tag.className = "dlg-ref";
      tag.setAttribute("data-kind", r.kind);
      tag.setAttribute("data-id", r.id);
      const kind = document.createElement("b");
      kind.textContent = r.kind === "law" ? "法条" : "笔记";
      const label = document.createElement("span");
      label.textContent = r.label || "";
      label.title = r.text || r.label || "";
      const del = document.createElement("button");
      del.type = "button";
      del.setAttribute("aria-label", "移除这条引用");
      del.textContent = "×";
      del.addEventListener("click", () => { toggleRef(r); inputEl.focus({ preventScroll: true }); });
      tag.appendChild(kind);
      tag.appendChild(label);
      tag.appendChild(del);
      refsEl.appendChild(tag);
    });
  }

  function refsPayload() {
    const notes = refs.filter((r) => r.kind === "note").map((r) => r.id);
    const laws = refs.filter((r) => r.kind === "law").map((r) => r.id);
    if (!notes.length && !laws.length) { return null; }
    return { notes: notes, laws: laws };
  }

  function lawLabel(a) {
    const head = [a.law, a.article].filter(Boolean).join(" · ");
    return [head, a.title].filter(Boolean).join(" · ") || a.id;
  }

  function noteLabel(n) {
    return String(n.text || "").replace(/\s+/g, " ").trim().slice(0, 40) || n.id;
  }

  // ---------------------------------------------------------------- 引用选择器
  function paintPicker() {
    pickerList.textContent = "";
    const isLaw = pickerKind === "law";
    pickerTitle.textContent = isLaw ? "引用法条" : "引用笔记";
    const items = isLaw ? (getLaws() || []) : (getNotes() || []);
    const picked = refs.filter((r) => r.kind === pickerKind).length;
    pickerN.textContent = picked ? "已选 " + picked + " 条" : "";
    if (!items.length) {
      const none = document.createElement("div");
      none.className = "dlg-pick-none";
      none.textContent = isLaw ? "法条库没取到，先联网再试一次。"
        : "还没有笔记：去手机「笔记」写一条，或先问过一轮。";
      pickerList.appendChild(none);
      return;
    }
    items.forEach((item, i) => {
      if (!item || !item.id) { return; }
      const row = document.createElement("button");
      row.type = "button";
      row.className = "dlg-pick";
      row.setAttribute("data-id", item.id);
      const ref = isLaw
        ? { kind: "law", id: item.id, label: lawLabel(item),
            text: String(item.gist || "") }
        : { kind: "note", id: item.id, label: noteLabel(item),
            text: String(item.text || "") };
      const on = hasRef(ref);
      row.classList.toggle("is-on", on);
      const no = document.createElement("b");
      no.textContent = String(i + 1).padStart(2, "0");
      const wrap = document.createElement("span");
      const strong = document.createElement("strong");
      strong.textContent = isLaw ? ([item.law, item.article].filter(Boolean).join(" · ")
        || item.title || item.id) : (noteLabel(item));
      wrap.appendChild(strong);
      const small = document.createElement("small");
      small.textContent = isLaw ? (item.gist || item.title || "") : (item.text || "");
      wrap.appendChild(small);
      const mark = document.createElement("i");
      mark.textContent = on ? "✓" : "+";
      row.appendChild(no);
      row.appendChild(wrap);
      row.appendChild(mark);
      row.addEventListener("click", () => { toggleRef(ref); });
      pickerList.appendChild(row);
    });
  }

  function openPicker(kind) {
    pickerKind = kind === "law" ? "law" : "note";
    paintPicker();
    pickerEl.hidden = false;
    card.querySelectorAll("[data-ref]").forEach((b) => {
      b.classList.toggle("is-on", b.getAttribute("data-ref") === pickerKind);
    });
  }

  function closePicker() {
    pickerKind = "";
    pickerEl.hidden = true;
    card.querySelectorAll("[data-ref]").forEach((b) => { b.classList.remove("is-on"); });
    inputEl.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- 对话记录
  function push(role, text, note, good, quotes) {
    if (emptyEl.parentNode === threadEl) { emptyEl.remove(); }
    const row = document.createElement("div");
    if (role === "sys") {
      row.className = "dlg-msg dlg-msg--sys";
      const sys = document.createElement("div");
      sys.className = "dlg-sys";
      sys.textContent = String(text || "");
      row.appendChild(sys);
      threadEl.appendChild(row);
      threadEl.scrollTop = threadEl.scrollHeight;
      return;
    }
    row.className = "dlg-msg dlg-msg--" + role;
    const bub = document.createElement("div");
    bub.className = "dlg-bubble";
    // 引用块先画（只画文字，全部 textContent）
    (Array.isArray(quotes) ? quotes : []).forEach((q) => {
      const block = document.createElement("div");
      block.className = "dlg-quote";
      block.setAttribute("data-kind", q.kind || "");
      const kind = document.createElement("b");
      kind.textContent = q.kind === "law" ? "引用法条" : "引用笔记";
      const body = document.createElement("span");
      // 法条：主行是「法名 · 条号 · 标题」，要点作小字；笔记：主行就是笔记原文，不再重复一遍。
      body.textContent = q.kind === "law" ? (q.label || "") : (q.text || q.label || "");
      block.appendChild(kind);
      block.appendChild(body);
      if (q.kind === "law" && q.text) {
        const small = document.createElement("small");
        small.textContent = String(q.text).slice(0, 120);
        block.appendChild(small);
      }
      bub.appendChild(block);
    });
    if (text) {
      const line = document.createElement("div");
      line.className = "dlg-line";
      line.textContent = String(text || "");
      bub.appendChild(line);
    }
    row.appendChild(bub);
    if (note) {
      const n = document.createElement("div");
      n.className = "dlg-note" + (good ? " dlg-note--good" : "");
      n.textContent = note;
      row.appendChild(n);
    }
    threadEl.appendChild(row);
    threadEl.scrollTop = threadEl.scrollHeight;
  }

  function setMeters(st, degraded) {
    if (st && Number.isFinite(Number(st.trust)) && Number.isFinite(Number(st.mood))) {
      metersEl.hidden = false;
      const put = (k, v) => {
        const box = metersEl.querySelector('[data-k="' + k + '"]');
        if (!box) { return; }
        const pct = Math.round(Math.max(0, Math.min(1, Number(v))) * 100);
        box.querySelector("b").style.width = pct + "%";
        box.querySelector("em").textContent = String(pct);
      };
      put("trust", st.trust);
      put("mood", st.mood);
    }
    degEl.hidden = !degraded;
    degEl.textContent = degraded ? "本条走案卷兜底台词" : "";
  }

  function setBusy(v) {
    busy = !!v;
    busyEl.hidden = !busy;
    sendEl.disabled = busy;
    card.querySelectorAll("[data-ref]").forEach((b) => { b.disabled = busy; });
    if (!busy) { countEl.textContent = turns + " 轮"; }
  }

  function growInput() {
    const max = 104;
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(max, Math.max(44, inputEl.scrollHeight)) + "px";
  }

  function usableText() {
    return clampText(inputEl.value, MAX_CHARS).replace(/^\s+|\s+$/g, "");
  }

  // ---------------------------------------------------------------- 发送
  function send() {
    if (busy || closed) { return false; }
    const text = usableText();
    if (!text) {
      inputEl.focus({ preventScroll: true });
      inputEl.classList.add("is-shake");
      setTimeout(() => inputEl.classList.remove("is-shake"), 220);
      return false;
    }
    const payload = refsPayload();
    const quotes = refs.map((r) => ({ kind: r.kind, label: r.label, text: r.text }));
    // 发出去的这一刻就清空：失败时再原样填回去，允许直接重发
    inputEl.value = "";
    growInput();
    const keep = refs.slice();
    refs = [];
    renderRefs();
    push("me", text, "", false, quotes);
    setBusy(true);
    if (!chat) {
      setBusy(false);
      push("sys", "这次没接上，再说一遍");
      return false;
    }
    let done = false;
    const finish = (res) => {
      if (done || closed) { return; }
      done = true;
      setBusy(false);
      if (res && res.failed) {
        inputEl.value = text;
        refs = keep;
        renderRefs();
        growInput();
        push("sys", "这次没接上，再说一遍");
        return;
      }
      const model = res && res.reply ? String(res.reply) : "";
      let reply = model;
      let note = "";
      if (!reply) {
        // 服务端明确回了（只是没话）：用数据里的兜底句，绝不在这里现编
        if (res && res.degraded && fallbackBank.length) {
          reply = fallbackBank[fallbackUsed % fallbackBank.length];
          fallbackUsed += 1;
          note = "案卷兜底台词";
        } else {
          inputEl.value = text;
          refs = keep;
          renderRefs();
          growInput();
          push("sys", "这次没接上，再说一遍");
          return;
        }
      } else if (res && res.degraded) {
        note = "本条走案卷兜底台词";
      }
      if (res && res.overstep) {
        note = "⚠ 越界承诺：你答应了无权答应或做不到的事";
      }
      if (res && res.reveal) {
        note = (note ? note + " · " : "") + "（单独谈话 · 他说出了实情）" + res.reveal;
      }
      push("them", reply, note, !!(res && (res.reveal || res.overstep)));
      if (res && res.state) { setMeters(res.state, res.degraded); }
      turns += 1;
      countEl.textContent = turns + " 轮";
      if (onRecord) {
        try { onRecord(text, payload, res || { reply: reply }); } catch (err) { /* 记账失败不挡对话 */ }
      }
    };
    const timer = setTimeout(() => { finish({ failed: true }); }, SEND_TIMEOUT);
    Promise.resolve(chat(text, { mode: "separate", refs: payload }))
      .then((res) => { clearTimeout(timer); finish(res || null); })
      .catch(() => { clearTimeout(timer); finish({ failed: true }); });
    return true;
  }

  // ---------------------------------------------------------------- 关闭
  function destroy() {
    if (overlay.parentNode) { overlay.parentNode.removeChild(overlay); }
    removeEventListener("keydown", onKey, true);
  }

  function close() {
    if (closed) { return; }
    closed = true;
    overlay.classList.remove("is-on");
    removeEventListener("keydown", onKey, true);
    setTimeout(() => { destroy(); }, 220);
    if (onClose) { onClose(); }
  }

  function onKey(ev) {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      if (!pickerEl.hidden) { closePicker(); return; }
      close();
    }
  }
  addEventListener("keydown", onKey, true);

  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) { close(); }
  });
  card.querySelector(".dlg-x").addEventListener("click", close);
  card.querySelectorAll("[data-ref]").forEach((b) => {
    b.addEventListener("click", () => {
      if (b.classList.contains("is-on") && !pickerEl.hidden && pickerKind === b.getAttribute("data-ref")) {
        closePicker();
        return;
      }
      openPicker(b.getAttribute("data-ref"));
    });
  });
  card.querySelector(".dlg-picker-x").addEventListener("click", closePicker);
  card.querySelector(".dlg-picker-ok").addEventListener("click", closePicker);
  pickerEl.addEventListener("click", (ev) => {
    if (ev.target === pickerEl) { closePicker(); }
  });
  inputEl.addEventListener("input", growInput);
  inputEl.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" || ev.shiftKey || ev.isComposing) { return; }
    ev.preventDefault();
    ev.stopPropagation();
    send();
  });
  sendEl.addEventListener("click", () => { send(); });

  return {
    el: overlay,
    get mode() { return "separate"; },
    get asked() { return turns; },
    get refs() { return refs.map((r) => ({ kind: r.kind, id: r.id, label: r.label })); },
    send,
    close,
    destroy
  };
}
