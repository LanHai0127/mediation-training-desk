// review.js · 调解评价卡（最终形态提示词 §6）
// -----------------------------------------------------------------------------
// 一张竖版卡：大字总分 + 圆形印章评级 + 四段人话（做对了 / 漏掉了 / 不合规 / 下一轮）。
//
// 两个出口：
//   scorePlan(input)             纯函数，不碰 DOM，可直接跑测试
//   createReview({ mount, onClose })  把卡片挂到 mount 里，纯 DOM
//
// 三套评分公式（§6.1~§6.3，字面实现）：
//   了解度    0~40 = 已看过证据的权重和 / 全部关键证据权重和 × 40
//                    权重档位：关键 2 / 一般 1 / 干扰 0.5
//                    方案为空时只保留 0~5 的"看过"分（见下）
//   合法合规  0~35 = 三个必答点（各 8）+ 履行方式与期限（11）− 引用错法条（每条 3）
//                    必答点"命中但没给依据"按半条计 4 分（§6.2"只给结论不给依据：半分"）
//   可执行性  0~25 = 有具体期限（8）+ 违约或司法确认（7）+ 双方都让步（10）
//                    − 单方零让步且没解释（8）
//   总分 = 三项之和（0~100）；A ≥ 90、B ≥ 75、C 其余
//
//   空方案（claims 里没有任何一句非空正文）时，合法合规与可执行性**都是 0**：
//   没有"方案基础分"这回事。以前 samplePlan 之类的调用方塞一份示例方案进来，
//   玩家一个字没写也能拿到 ~30 分（必答点半条 + 双方让步 10），这一条堵在这里。
//   同时了解度只记 0~5 的"看过"分（UNDERSTANDING_NO_PLAN）：玩家确实可能翻过证据，
//   但一句话没写就说明还没形成方案 —— 40 分满格留给"看过并且在方案里用上了"的那一轮。
//
// 输入：
//   {
//     evidence: [{ id, weight, found }],              // weight: 2 / 1 / 0.5
//     plan:     { claims: [{ text, lawId, correct }] },// 一句话一个主张
//     rubric:   { mustMention: [], timeLimit: { ok: [] }, forbid: [] }
//   }
//   可选补充字段（有就用，没有就退回文字判断）：
//     evidence[].title / label / name     证据的人类可读名字（写进点评）
//     claim.lawTitle / lawName            法条的人类可读名字（写进点评）
//     claim.side = "a" | "b" | "both"     这条主张是谁在让步
//     plan.concessions = { a: true, b: true }  哪几方让了步（不走文字猜测）
//
// 输出：
//   { total, grade: "A"|"B"|"C", gradeLabel, scores: { understanding, legality, executability },
//     sections: { good: [], missed: [], illegal: [], next: [] } }
//   sections 每段 1~3 条，都是能读顺口的话，不是分数罗列。
// -----------------------------------------------------------------------------
import { PAL } from "../scenes/kit.js";

// =============================================================================
// 一、评分（纯函数）
// =============================================================================

// 中文判断用：去掉标点空白，只留字，避免"、"和空格把同一句话判成两句
const PUNCT = /[\s，。；：、！？,.;:!?"'“”‘’「」『』（）()【】〔〕…—－\-_/]/g;
const norm = (s) => String(s == null ? "" : s).replace(PUNCT, "").toLowerCase();

// 只起连接作用的字不参与覆盖率计算（"费用分摊或恢复原状"→"费用分摊恢复原状"）
const CHAR_SKIP = new Set(["的", "了", "是", "也", "又", "就", "都", "还", "和", "与", "及", "或"]);

function clamp(n, lo, hi) {
  return n < lo ? lo : n > hi ? hi : n;
}

// 关键字覆盖率：mustMention 是"历史共用排水"这种短语，而玩家写的是整句，
// 所以按"关键字里有多少个字出现在这句话里"来算，一半以上算命中。
const HIT_RATE = 0.5;
function coverage(key, text) {
  const k = norm(key);
  if (!k) { return 0; }
  const chars = [...new Set(k)].filter((c) => !CHAR_SKIP.has(c));
  if (!chars.length) { return 0; }
  let hit = 0;
  for (const c of chars) { if (text.includes(c)) { hit += 1; } }
  return hit / chars.length;
}

// 期限：数字/中文数字 + 天日周月，或"月底前""限期"这类说法
const TIME_RE = [
  /\d+\s*(天|日|周|个月|月|小时)/,
  /[一二两三四五六七八九十半]+\s*(天|日|周|个月|月)\s*(之?内|以内|内|前)?/,
  /月底前|年底前|本周内|本月内|即日|当场完成|限期/
];

// 履行方式：谁去办、怎么办（"写清履行方式和期限"里前半句）
// 不写"由"——它太常见（理由、自由），会把没写方式的方案误判成写了
const METHOD_RE = /负责|承担|出工|出钱|出资|分摊|分担|清通|疏通|开挖|修复|恢复|拆除|拆|填|修|铺|补种|支付|付款|结清|签字|到场|见证|监督|验收|公证|司法确认|协助/;

// 违约 / 司法确认（§6.3 的第二项）
const REMEDY_RE = /违约|违约金|司法确认|强制执行|不履行|逾期/;

// 让步的语言标记（没有结构化字段时用）
const GIVE_RE = /让|退|承担|出资|分摊|分担|配合|同意|接受|补偿|赔偿|道歉|恢复原状/;
const BOTH_RE = /双方|两家|各方|各自|共同|互相|各让|各出/;
const SOLO_RE = [
  /(必须|应当|立即|一律|限|自行|全部)[^，。；]{0,12}(拆|拆除|清除|赔偿|承担|负责|恢复|让出|出资|出钱)/,
  /由[^，。；]{0,8}(承担|赔偿|负责|清除|拆除|出资|出钱)/
];

const TIER = (w) => (w >= 1.5 ? "关键" : w >= 0.75 ? "一般" : "干扰");
const GRADE_LABEL = { A: "优秀", B: "良好", C: "待改进" };
// 空方案时了解度的上限：玩家可能真的翻过证据，但一句方案都没写，只值这一点"看过"分。
const UNDERSTANDING_NO_PLAN = 5;

const evName = (e) => String((e && (e.title || e.label || e.name)) || (e && e.id) || "一件材料");
const lawName = (c) => String((c && (c.lawTitle || c.lawName || c.lawId)) || "一条法条");

function short(s, n) {
  const t = String(s == null ? "" : s).replace(/\s+/g, " ").trim().replace(/[。！？，；、…]+$/, "");
  return t.length > n ? t.slice(0, n).replace(/[，。；、\s]+$/, "") + "…" : t;
}

// 让步判断：先看结构化字段，没有再退回文字
function concessions(plan, claims, joined, njoined) {
  const declared = plan && plan.concessions;
  if (Array.isArray(declared)) {
    return { mutual: declared.filter(Boolean).length >= 2, unilateral: false };
  }
  if (declared && typeof declared === "object") {
    const sides = Object.keys(declared).filter((k) => declared[k]);
    return { mutual: sides.length >= 2, unilateral: false };
  }
  const bySide = new Set();
  for (const c of claims) {
    if (c && c.side && c.side !== "none" && c.concede !== false) {
      if (c.side === "both") { bySide.add("a"); bySide.add("b"); } else { bySide.add(String(c.side)); }
    }
  }
  if (bySide.size) {
    return { mutual: bySide.size >= 2, unilateral: bySide.size < 2 && SOLO_RE.some((re) => re.test(joined)) };
  }
  const mutual = BOTH_RE.test(njoined) && GIVE_RE.test(njoined);
  const unilateral = !mutual && SOLO_RE.some((re) => re.test(joined));
  return { mutual, unilateral };
}

export function scorePlan(input) {
  const src = input || {};
  const evidence = Array.isArray(src.evidence) ? src.evidence.filter(Boolean) : [];
  const plan = src.plan || {};
  const claims = (Array.isArray(plan.claims) ? plan.claims : []).filter((c) => c && typeof c === "object");
  const rubric = src.rubric || {};

  const texts = claims.map((c) => String(c.text == null ? "" : c.text));
  const joined = texts.join("；");
  const njoined = norm(joined);
  const ntexts = texts.map(norm);
  // "写过方案"的唯一判据：至少有一句去掉标点后还有字的正文。
  // 只给 concessions / lawId / correct 这些结构化字段、没有正文，不算方案。
  const hasPlan = ntexts.some((t) => t.length > 0);

  // ---------------------------------------------------------------- 6.1 了解度
  let totalW = 0;
  let foundW = 0;
  for (const e of evidence) {
    const raw = Number(e.weight);
    const w = Number.isFinite(raw) && raw > 0 ? raw : 1;
    totalW += w;
    if (e.found) { foundW += w; }
  }
  const ratio = totalW > 0 ? foundW / totalW : 0;
  // 方案为空：只看不写，了解度只留"翻过材料"的极少量分（最多 5 分）。
  // 有方案正文时才按 §6.1 的 0~40 满格算 —— 分数主要跟着方案走，不是躺着拿。
  const understanding = hasPlan
    ? clamp(Math.round(ratio * 40), 0, 40)
    : clamp(Math.round(ratio * UNDERSTANDING_NO_PLAN), 0, UNDERSTANDING_NO_PLAN);

  // ---------------------------------------------------------------- 6.2 合法合规
  const mustList = Array.isArray(rubric.mustMention) ? rubric.mustMention : [];
  const must = mustList.map((m) => {
    const text = typeof m === "string" ? m : String((m && (m.text || m.label || m.id)) || "");
    let bestScore = 0;
    let bestClaim = null;
    ntexts.forEach((t, j) => {
      const s = coverage(text, t);
      if (s > bestScore) { bestScore = s; bestClaim = claims[j]; }
    });
    const hit = !!text && bestScore >= HIT_RATE;
    const wrong = hit && !!bestClaim && bestClaim.correct === false;
    const cited = hit && !wrong && !!(bestClaim && bestClaim.lawId);
    // 命中且引对 = 8；命中但只给结论 = 4（半分）；引错 = 该点不算分，另计 −3
    const pts = !hit || wrong ? 0 : cited ? 8 : 4;
    return { text, hit, cited, wrong, pts, claim: bestClaim };
  });

  const okPhrases = (rubric.timeLimit && Array.isArray(rubric.timeLimit.ok)) ? rubric.timeLimit.ok : [];
  // 期限要"引原话"才有说服力，所以把命中的那一小截抠出来，别整句抄上去
  let deadlineText = "";
  for (let i = 0; i < texts.length && !deadlineText; i++) {
    const okp = okPhrases.find((p) => { const np = norm(p); return !!np && ntexts[i].includes(np); });
    if (okp) { deadlineText = String(okp); break; }
    for (const re of TIME_RE) {
      const m = texts[i].match(re);
      if (m) { deadlineText = m[0]; break; }
    }
  }
  const hasDeadline = hasPlan && !!deadlineText;
  const hasMethod = hasPlan && METHOD_RE.test(joined);

  const wrongClaims = hasPlan ? claims.filter((c) => c.correct === false) : [];
  const mustPts = hasPlan ? must.reduce((a, m) => a + m.pts, 0) : 0;
  // 空方案没有合法合规分：不引用、不写期限、不谈履行，本来就不该得分。
  const legality = hasPlan
    ? clamp(mustPts + (hasDeadline && hasMethod ? 11 : 0) - 3 * wrongClaims.length, 0, 35)
    : 0;

  // ---------------------------------------------------------------- 6.3 可执行性
  // 期限/违约/让步都是"方案里写了什么"才有的分；空方案一律 0，不再靠默认让步白拿 10 分。
  const remedy = hasPlan && REMEDY_RE.test(joined);
  const { mutual, unilateral } = hasPlan
    ? concessions(plan, claims, joined, njoined)
    : { mutual: false, unilateral: false };
  const executability = hasPlan
    ? clamp((hasDeadline ? 8 : 0) + (remedy ? 7 : 0) + (mutual ? 10 : 0) - (unilateral ? 8 : 0), 0, 25)
    : 0;

  // ---------------------------------------------------------------- 总分与评级
  const total = clamp(understanding + legality + executability, 0, 100);
  const grade = total >= 90 ? "A" : total >= 75 ? "B" : "C";

  // ---------------------------------------------------------------- 四段人话
  const sections = buildSections({
    evidence, claims, must, ratio, totalW, hasDeadline, deadlineText,
    remedy, mutual, unilateral, wrongClaims, forbid: Array.isArray(rubric.forbid) ? rubric.forbid : [],
    njoined
  });

  return {
    total,
    grade,
    gradeLabel: GRADE_LABEL[grade],
    scores: { understanding, legality, executability },
    sections
  };
}

function buildSections(ctx) {
  const {
    evidence, must, ratio, totalW, hasDeadline, deadlineText,
    remedy, mutual, unilateral, wrongClaims, forbid, njoined
  } = ctx;

  const good = [];
  const missed = [];
  const illegal = [];
  const next = [];

  const found = evidence.filter((e) => e.found);
  const lost = evidence.filter((e) => !e.found)
    .sort((a, b) => (Number(b.weight) || 1) - (Number(a.weight) || 1));
  const hitMust = must.filter((m) => m.hit && !m.wrong);
  const missMust = must.filter((m) => !m.hit);

  // ---- 你做得对的
  if (totalW > 0 && ratio >= 1) {
    good.push("该看的材料你一件没落，开口的时候心里是有底的。");
  } else if (ratio >= 0.6) {
    good.push("案子里的事你基本摸清了，说话不是凭印象。");
  } else if (found.length) {
    const top = found.slice().sort((a, b) => (Number(b.weight) || 1) - (Number(a.weight) || 1))[0];
    good.push("「" + evName(top) + "」这一件你抓住了，它是这案子里最能站住的东西。");
  }
  if (hitMust.length) {
    const m = hitMust[0];
    good.push("你点明了「" + m.text + "」，这句话正好压在争议正中间。");
  }
  if (hasDeadline) {
    good.push("你写了「" + deadlineText + "」——有日子的方案才算方案。");
  } else if (remedy) {
    good.push("你留了违约和司法确认的后手，这张纸才不是空的。");
  } else if (mutual) {
    good.push("两边都留了台阶，谁也没被架在火上。");
  }
  if (!good.length) {
    good.push(ctx.claims.some((c) => String(c.text || "").trim())
      ? "你把话谈到了能落笔的地步，这已经比隔着院墙喊强。"
      : "这一轮还没有能夸的地方——方案还是空的，先从证据看起。");
  }

  // ---- 你漏掉的
  let restLost = lost;
  if (totalW > 0 && ratio < 0.6 && lost.length) {
    // §6.1：低于 60% 要专门点一句"你还没弄清哪件事"，所以先把最重的那件单独拎出来
    missed.push("你还没弄清「" + evName(lost[0]) + "」是怎么回事——这一步没走，后面全靠印象。");
    restLost = lost.slice(1);
  }
  restLost.slice(0, 2).forEach((e) => {
    const w = Number(e.weight) || 1;
    missed.push("「" + evName(e) + "」你没碰过——" + TIER(w) + "材料，缺口就在这儿。");
  });
  missMust.slice(0, 2).forEach((m) => {
    missed.push("「" + m.text + "」你没说出口，对方就比你多一分理。");
  });
  if (!hasDeadline) {
    missed.push("方案里没有一句“几天内办完”，这种事一拖就变卦。");
  }
  if (!missed.length) {
    missed.push("没发现明显的漏项——这一轮你看得比大多数人全。");
  }

  // ---- 哪条不合规（先点没有依据的话，再点文号对不上的，最后点单方压人）
  const forbidHits = forbid
    .map((f) => (typeof f === "string" ? f : String((f && (f.text || f.label)) || "")))
    .filter((f) => { const nf = norm(f); return !!nf && (njoined.includes(nf) || coverage(f, njoined) >= 0.6); });
  if (forbidHits.length) {
    illegal.push("「" + forbidHits[0] + "」这句没有法律依据，写进协议也执行不了。");
  }
  wrongClaims.slice(0, 2).forEach((c) => {
    if (illegal.length >= 3) { return; }
    illegal.push("「" + short(c.text, 15) + "」挂在了「" + lawName(c) + "」名下，对不上号，写进协议就是坑。");
  });
  if (unilateral && illegal.length < 3) {
    illegal.push("整份方案只在要求一边让，另一边一句义务都没写，签了也难服人。");
  }
  if (!illegal.length) {
    illegal.push("没有踩到不该踩的地方。");
  }

  // ---- 下一轮建议
  if (lost.length) {
    next.push("下一轮先去「" + evName(lost[0]) + "」，看完了再开口。");
  }
  if (missMust.length) {
    next.push("把「" + missMust[0].text + "」写成一句话，放在方案最前面。");
  }
  if (!hasDeadline) {
    next.push("给一个死期限（“七天内”就够），再点明谁去办、谁验收。");
  } else if (unilateral) {
    next.push("补一条对边的义务，让方案看起来不像判决。");
  }
  if (wrongClaims.length) {
    next.push("引用之前先翻一眼原文，别凭印象挂文号。");
  }
  if (!next.length) {
    next.push("保持这个节奏；下一轮把话说得更短、更具体。");
  }

  const cap = (arr) => arr.slice(0, 3);
  return { good: cap(good), missed: cap(missed), illegal: cap(illegal), next: cap(next) };
}

// =============================================================================
// 二、卡片（纯 DOM）
// =============================================================================

const STYLE_ID = "rv-style";

function ensureStyle() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) { return; }
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent =
    ".rv-overlay{position:fixed;inset:0;z-index:60;display:grid;place-items:center;padding:18px;" +
      "background:rgba(41,72,88,.45);animation:rv-fade .2s ease both;}" +
    ".rv-host{position:relative;box-sizing:border-box;width:100%;height:100%;display:flex;align-items:center;" +
      "justify-content:center;padding:2px;overflow:auto;container-type:inline-size;color:" + PAL.ink + ";}" +
    ".rv-overlay .rv-host{width:min(100%,360px);height:auto;}" +
    ".rv-card{--seal:64px;position:relative;box-sizing:border-box;width:min(100%,340px);" +
      "aspect-ratio:5.2/6.4;display:flex;flex-direction:column;gap:8px;padding:15px 15px 11px;" +
      "background:" + PAL.white + ";border:1.5px solid " + PAL.ink + ";border-radius:16px;" +
      "box-shadow:0 22px 46px -22px rgba(41,72,88,.65),inset 0 1px 0 " + PAL.cream + ";" +
      "font-family:\"PingFang SC\",\"Microsoft YaHei\",\"Noto Sans SC\",system-ui,sans-serif;" +
      "animation:rv-in .34s cubic-bezier(.2,.85,.25,1) both;overflow:hidden;}" +
    ".rv-head{display:flex;align-items:flex-end;gap:8px;}" +
    ".rv-title{font-size:15px;font-weight:600;letter-spacing:.22em;line-height:1.05;white-space:nowrap;}" +
    ".rv-score{margin-left:auto;margin-right:calc(var(--seal) + 8px);display:flex;align-items:baseline;gap:4px;}" +
    ".rv-total{font-size:36px;font-weight:700;line-height:.86;letter-spacing:-.02em;color:" + PAL.coral + ";" +
      "font-variant-numeric:tabular-nums;}" +
    ".rv-max{font-size:10.5px;font-style:normal;color:" + PAL.ink + ";opacity:.55;}" +
    ".rv-seal{position:absolute;top:11px;right:11px;width:var(--seal);height:var(--seal);border-radius:50%;" +
      "border:2px solid " + PAL.coral + ";color:" + PAL.coral + ";display:grid;place-content:center;text-align:center;" +
      "transform:rotate(-9deg);opacity:.92;pointer-events:none;}" +
    ".rv-seal::after{content:\"\";position:absolute;inset:4px;border:1px dashed " + PAL.coral + ";border-radius:50%;" +
      "opacity:.6;}" +
    ".rv-seal-l{font-size:calc(var(--seal)*.42);font-weight:700;line-height:1;letter-spacing:.02em;}" +
    ".rv-seal-t{font-size:calc(var(--seal)*.15);line-height:1.5;letter-spacing:.1em;opacity:.9;}" +
    ".rv-dims{display:flex;gap:6px;padding-bottom:6px;border-bottom:1.5px solid " + PAL.coral + ";}" +
    ".rv-dim{flex:1;display:flex;flex-direction:column;gap:1px;min-width:0;}" +
    ".rv-dim span{font-size:9.5px;letter-spacing:.06em;opacity:.55;white-space:nowrap;}" +
    ".rv-dim b{font-size:15px;font-weight:600;line-height:1;font-variant-numeric:tabular-nums;}" +
    ".rv-body{flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:7px;" +
      "padding-right:2px;scrollbar-width:thin;}" +
    ".rv-body::-webkit-scrollbar{width:4px;}" +
    ".rv-body::-webkit-scrollbar-thumb{background:rgba(53,83,100,.22);border-radius:2px;}" +
    ".rv-sec{--tick:" + PAL.mint + ";}" +
    ".rv-sec[data-kind=missed]{--tick:" + PAL.yellow + ";}" +
    ".rv-sec[data-kind=illegal]{--tick:" + PAL.coral + ";}" +
    ".rv-sec[data-kind=next]{--tick:" + PAL.blue + ";}" +
    ".rv-sec h4{margin:0 0 2px;font-size:10.5px;font-weight:600;letter-spacing:.14em;display:flex;align-items:center;gap:6px;}" +
    ".rv-sec h4::before{content:\"\";width:3px;height:10px;border-radius:2px;background:var(--tick);}" +
    ".rv-sec ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:2px;}" +
    ".rv-sec li{position:relative;padding-left:9px;font-size:11.5px;line-height:1.5;letter-spacing:.01em;}" +
    ".rv-sec li::before{content:\"·\";position:absolute;left:0;top:0;color:" + PAL.ink + ";opacity:.45;font-weight:700;}" +
    ".rv-foot{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding-top:6px;border-top:1px solid rgba(53,83,100,.14);}" +
    ".rv-hint{font-size:10px;line-height:1.3;opacity:.5;}" +
    ".rv-replay{margin-left:auto;font:inherit;font-size:11.5px;line-height:1;padding:6px 15px;border-radius:999px;" +
      "border:1.5px solid " + PAL.coral + ";background:" + PAL.coral + ";color:" + PAL.white + ";cursor:pointer;" +
      "transition:background .16s ease,color .16s ease,opacity .16s ease;}" +
    ".rv-replay:hover,.rv-replay:focus-visible{background:" + PAL.ink + ";border-color:" + PAL.ink + ";outline:none;}" +
    ".rv-close{margin-left:auto;font:inherit;font-size:11.5px;line-height:1;padding:6px 15px;border-radius:999px;" +
      "border:1.5px solid " + PAL.coral + ";background:transparent;color:" + PAL.coral + ";cursor:pointer;" +
      "transition:background .16s ease,color .16s ease;}" +
    ".rv-replay + .rv-close{margin-left:0;}" +
    ".rv-close:hover,.rv-close:focus-visible{background:" + PAL.coral + ";color:" + PAL.white + ";outline:none;}" +
    "@keyframes rv-in{from{opacity:0;transform:translateX(16px) scale(.97);}to{opacity:1;transform:none;}}" +
    "@keyframes rv-fade{from{opacity:0;}to{opacity:1;}}" +
    "@keyframes rv-pop{0%{opacity:0;transform:rotate(-9deg) scale(1.7);}60%{opacity:.95;}" +
      "100%{opacity:.92;transform:rotate(-9deg) scale(1);}}" +
    ".rv-seal--pop{animation:rv-pop .5s cubic-bezier(.2,.9,.2,1) .12s both;}" +
    "@container (max-width:279px){" +
      // 窄容器（手机面板里）：卡片不再锁 5.2:6.4，改成内容撑高，印章收进表头一行，避免压住三维分数
      ".rv-card{--seal:38px;padding:11px 11px 9px;aspect-ratio:auto;}" +
      ".rv-head{align-items:center;}" +
      ".rv-title{font-size:12px;letter-spacing:.14em;}" +
      ".rv-total{font-size:24px;}" +
      ".rv-score{margin-right:0;}" +
      ".rv-seal{position:relative;transform:none;margin-left:2px;flex:0 0 auto;}" +
      ".rv-seal-l{font-size:16px;}" +
      ".rv-seal-t{display:none;}" +
      ".rv-dim b{font-size:13px;}" +
      ".rv-sec li{font-size:10.5px;}" +
      ".rv-body{overflow-y:visible;}" +
      ".rv-hint{display:none;}" +
    "}" +
    // 真机：卡片不再锁 5.2:6.4 的桌面比例（那个比例在 390 宽下会挤压正文），
    // 改成内容撑高 + 视口封顶，正文自己滚；按钮/关闭都 ≥44px。
    "@media (max-width:640px), (max-height:560px){" +
      ".rv-overlay{padding:calc(10px + env(safe-area-inset-top)) calc(10px + env(safe-area-inset-right))" +
        " calc(10px + env(safe-area-inset-bottom)) calc(10px + env(safe-area-inset-left));}" +
      ".rv-overlay .rv-host{width:100%;height:auto;}" +
      ".rv-card{width:min(100%,560px);aspect-ratio:auto;max-height:calc(100vh - env(safe-area-inset-top)" +
        " - env(safe-area-inset-bottom) - 20px);max-height:calc(100dvh - env(safe-area-inset-top)" +
        " - env(safe-area-inset-bottom) - 20px);padding:14px 13px 11px;gap:9px;}" +
      ".rv-title{font-size:16px;letter-spacing:.18em;}" +
      ".rv-max{font-size:13px;}" +
      ".rv-total{font-size:38px;}" +
      ".rv-dim span{font-size:13px;}" +
      ".rv-dim b{font-size:18px;}" +
      ".rv-seal-t{font-size:13px;}" +
      ".rv-sec h4{font-size:13px;}" +
      ".rv-sec li{font-size:14px;}" +
      ".rv-hint{font-size:13px;}" +
      ".rv-replay,.rv-close{min-height:44px;padding:0 16px;font-size:13px;}" +
    "}" +
    "@media (prefers-reduced-motion:reduce){" +
      ".rv-card,.rv-overlay,.rv-seal--pop{animation:none !important;}" +
    "}";
  document.head.appendChild(s);
}

function resolveMount(m) {
  if (m && typeof m === "object" && m.nodeType === 1) { return m; }
  if (typeof m === "string") { return document.querySelector(m); }
  return null;
}

const SECTION_TITLE = {
  good: "你做得对的",
  missed: "你漏掉的",
  illegal: "哪条不合规",
  next: "下一轮建议"
};

/**
 * 竖版评价卡。
 * @param {Object}   opt
 * @param {Element|string} [opt.mount]  挂载点；不传就自己铺一层居中浮层
 * @param {Function} [opt.onClose]      点「关闭」或按 Esc 时回调，只会回调一次
 * @param {Function} [opt.onReplay]     点「看复盘」时回调 (score)；不传则按钮不显示
 * @param {Object}   [opt.data]         构造时直接给一份 scorePlan 的输入
 * @returns {{ el, card, render, update, score, close, destroy }}
 */
export function createReview(opt) {
  const opts = opt || {};
  ensureStyle();

  const mount = resolveMount(opts.mount);
  let overlay = null;
  let host = null;

  if (mount) {
    host = document.createElement("div");
    host.className = "rv-host";
    mount.appendChild(host);
  } else {
    overlay = document.createElement("div");
    overlay.className = "rv-overlay";
    host = document.createElement("div");
    host.className = "rv-host";
    overlay.appendChild(host);
    (document.body || document.documentElement).appendChild(overlay);
  }

  const card = document.createElement("article");
  card.className = "rv-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "false");
  card.setAttribute("aria-label", "调解评价");
  card.innerHTML =
    '<header class="rv-head">' +
      '<div class="rv-title">调解评价</div>' +
      '<div class="rv-score"><b class="rv-total">—</b><i class="rv-max">/ 100</i></div>' +
      '<div class="rv-seal" aria-hidden="true"><span class="rv-seal-l">—</span><span class="rv-seal-t">未评</span></div>' +
    "</header>" +
    '<div class="rv-dims">' +
      '<div class="rv-dim"><span>了解度</span><b data-k="understanding">0</b></div>' +
      '<div class="rv-dim"><span>合法合规</span><b data-k="legality">0</b></div>' +
      '<div class="rv-dim"><span>可执行性</span><b data-k="executability">0</b></div>' +
    "</div>" +
    '<div class="rv-body">' +
      '<section class="rv-sec" data-kind="good"><h4>' + SECTION_TITLE.good + "</h4><ul></ul></section>" +
      '<section class="rv-sec" data-kind="missed"><h4>' + SECTION_TITLE.missed + "</h4><ul></ul></section>" +
      '<section class="rv-sec" data-kind="illegal"><h4>' + SECTION_TITLE.illegal + "</h4><ul></ul></section>" +
      '<section class="rv-sec" data-kind="next"><h4>' + SECTION_TITLE.next + "</h4><ul></ul></section>" +
    "</div>" +
    '<footer class="rv-foot">' +
      '<button class="rv-replay" type="button"' + (typeof opts.onReplay === "function" ? "" : " hidden") +
      '>看复盘</button>' +
      '<button class="rv-close" type="button">关闭</button></footer>';
  host.appendChild(card);

  const totalEl = card.querySelector(".rv-total");
  const sealEl = card.querySelector(".rv-seal");
  const sealL = card.querySelector(".rv-seal-l");
  const sealT = card.querySelector(".rv-seal-t");
  const dimEls = {
    understanding: card.querySelector('[data-k="understanding"]'),
    legality: card.querySelector('[data-k="legality"]'),
    executability: card.querySelector('[data-k="executability"]')
  };
  const lists = {
    good: card.querySelector('[data-kind="good"] ul'),
    missed: card.querySelector('[data-kind="missed"] ul'),
    illegal: card.querySelector('[data-kind="illegal"] ul'),
    next: card.querySelector('[data-kind="next"] ul')
  };

  let last = null;
  let closed = false;

  const fill = (ul, items) => {
    ul.textContent = "";
    (items || []).forEach((t) => {
      const li = document.createElement("li");
      li.textContent = t;          // 一律 textContent：玩家的话不当作 HTML
      ul.appendChild(li);
    });
  };

  function render(input) {
    const res = scorePlan(input || {});
    last = res;

    totalEl.textContent = String(res.total);
    card.dataset.grade = res.grade;

    for (const k of Object.keys(dimEls)) {
      dimEls[k].textContent = String(res.scores[k]);
    }
    for (const k of Object.keys(lists)) {
      fill(lists[k], res.sections[k]);
    }

    sealL.textContent = res.grade;
    sealT.textContent = res.gradeLabel;
    sealEl.classList.remove("rv-seal--pop");
    void sealEl.offsetWidth;       // 强制回流，让印章每次都重新"盖"一下
    sealEl.classList.add("rv-seal--pop");

    return res;
  }

  function destroy() {
    closed = true;
    document.removeEventListener("keydown", onKey);
    if (overlay) { overlay.remove(); } else if (host) { host.remove(); }
    overlay = null;
    host = null;
  }

  function close() {
    if (closed) { return; }
    destroy();
    if (typeof opts.onClose === "function") { opts.onClose(); }
  }

  function onKey(ev) {
    if (ev.key === "Escape") { ev.stopPropagation(); close(); }
  }

  const onReplay = typeof opts.onReplay === "function" ? opts.onReplay : null;
  card.querySelector(".rv-close").addEventListener("click", close);
  // 「看复盘」：评价看完接着看复盘，是这条链路的下一环。
  // 卡片自己不销毁 —— 由宿主决定关掉卡片再去开时间轴（回放要看背后的场景）。
  card.querySelector(".rv-replay").addEventListener("click", () => {
    if (!onReplay) { return; }
    try {
      onReplay(last);
    } catch (err) {
      console.error("[review] onReplay 回调出错", err);
    }
  });
  if (overlay) {
    overlay.addEventListener("click", (ev) => { if (ev.target === overlay) { close(); } });
  }
  document.addEventListener("keydown", onKey);

  if (opts.data) { render(opts.data); }

  return {
    el: overlay || host,
    card,
    /** 重新评分并上屏，返回 scorePlan 的完整结果 */
    render,
    /** render 的别名，方便接线 */
    update: render,
    /** 当前这次评分结果 */
    score: () => last,
    close,
    destroy
  };
}
