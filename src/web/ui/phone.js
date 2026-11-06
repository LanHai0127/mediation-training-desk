// ============================================================================
// phone.js · 手机系统（唯一功能入口）
// ----------------------------------------------------------------------------
// 对应 docs/最终形态提示词.md §4（手机系统）、§8（学习两个 Tab）。
// 纯 DOM + CSS，不引 three —— UI 层不碰渲染。
// 配色默认照搬国庆项目那台手机（深墨壳 #1f2328 / 中性屏 #f7f6f3 / 品牌蓝 #1d4ed8），
// 九个 app 图标按这套色板分四类着色；要切回本项目 PAL：createPhone({ theme: "pal" })。
//
// 对外：
//   const phone = createPhone({ mount, onOpen, onClose, onAction, theme });
//   theme: "legacy"（默认，国庆那台的配色）| "pal"（本项目色板）
//   phone.setData({ case, evidence, characters, laws, scenes, personScenes });   // 增量覆盖
//   personScenes = { p_a: [{ scene: "wall", name: "院墙地界" }], ... }：本案每个当事人
//   能在哪几张图里找到，案件档案页在当事人下面显示；由 tools/gen_person_scenes.py 生成。
//   phone.open() / phone.close() / phone.toggle() / phone.openPage("map")
//   phone.setScene("boundary") / phone.setClosed(true)
//   phone.addNote("...") / phone.destroy()
//
//   onAction(type, payload)  type：teleport / call / note:add / review
//   onOpen() / onClose()
//
// 九个页面的 key（HTML 上就是 [data-page=key]）：
//   case 案件档案 · people 人物关系 · evidence 证据夹 · notes 笔记 · laws 法条
//   map 地图 · contact 通讯 · learn 学习 · review 评价复盘
//   另有 home：九宫格桌面（不是功能页，是九个入口的容器）
//
// 数据兼容：没单独给 evidence / characters / scenes 时，自动从 case 里的
//   facts（旧 app 的"现场素材"）、parties + partyOrder、scenes 取；
//   contacts 缺省时用 characters 兜底。所以旧的 case.json 可以原样喂进来。
// ============================================================================

// ---------------------------------------------------------------------------
// PAL：与 scenes/kit.js 逐字一致，只服务可选的 "pal" 主题；默认主题用的是
// 国庆那台手机的配色（见下方 vars）。不复用 kit.js 的 export，是因为它顶部
// import 了 three —— UI 层不能因为要个色号就把 600KB 拉进来。
// ---------------------------------------------------------------------------
export const PAL = {
  ink: "#355364", cream: "#fff3d7", white: "#fffaf0", blue: "#82c9d5",
  navy: "#315c72", peach: "#f4a58b", coral: "#e98578", mint: "#a5d8bd",
  sand: "#e8cca1", road: "#667782", yellow: "#ffd781", wood: "#b98e68",
  glass: "#b7e1df", dark: "#294858"
};

// ---------------------------------------------------------------------------
// 九个功能：key / 标签 / 图标 / 分类色。
// 一进游戏九个全开：评价复盘不再等结案，结案只是「出评价」的触发，不是解锁条件。
// ---------------------------------------------------------------------------
const PAGE_LIST = [
  { key: "case",     label: "案件档案", icon: "case",     tone: "blue" },
  { key: "people",   label: "人物关系", icon: "people",   tone: "blue" },
  { key: "evidence", label: "证据夹",   icon: "evidence", tone: "warn" },
  { key: "notes",    label: "笔记",     icon: "notes",    tone: "blue" },
  { key: "laws",     label: "法条",     icon: "laws",     tone: "blue" },
  { key: "map",      label: "地图",     icon: "map",      tone: "ok" },
  { key: "contact",  label: "通讯",     icon: "call",     tone: "blue" },
  { key: "learn",    label: "学习",     icon: "learn",    tone: "ok" },
  { key: "review",   label: "评价复盘", icon: "review",   tone: "danger" }
];
const PAGE_MAP = {};
PAGE_LIST.forEach(function (p) { PAGE_MAP[p.key] = p; });

// ---------------------------------------------------------------------------
// §8 学习：操作 8 条。每条 = 标题 + 两行说明。
// ---------------------------------------------------------------------------
const OPS = [
  { id: "walk", no: 1, title: "怎么走", lines: [
    "点地面，角色自己走过去；不是瞬移。",
    "按住拖动是转视角，别把它当走路用。"] },
  { id: "spot", no: 2, title: "怎么点物件", lines: [
    "走近到 2.2 米内再点，远了点不动。",
    "有描边的才能点；没描边的走过去站住就行。"] },
  { id: "evidence", no: 3, title: "怎么看证据", lines: [
    "点开的证据自动进手机「证据夹」。",
    "四个维度里的「证据支撑」，就是靠这些撑起来的。"] },
  { id: "ask", no: 4, title: "怎么问人", lines: [
    "点人进对话。先听半分钟，再问第一句。",
    "同一个问题追问两次，对方会冷场。"] },
  { id: "phone", no: 5, title: "怎么开手机", lines: [
    "右上角手机图标，或按 P 键。",
    "再点一次收起；点手机外的空白也收起。"] },
  { id: "teleport", no: 6, title: "怎么传送", lines: [
    "手机里点「地图」，选一个地点。",
    "云起云散大约六秒，落地就是那儿。"] },
  { id: "plan", no: 7, title: "怎么写方案", lines: [
    "每个维度选一条，选之前先看证据够不够。",
    "拿不准的那条，先去问人，别硬凑。"] },
  { id: "submit", no: 8, title: "怎么提交", lines: [
    "五条选满才能提交，提交后当场出评价。",
    "评价看三件事：了解度、合法合规、可执行性。"] }
];

// ---------------------------------------------------------------------------
// §8 学习：知识 12 张卡。每张 = 一句核心结论（≤20 字）+ 三行解释 + 一条出处。
// 出处跟 src/laws/laws.json 的口径对齐：只作提示，正式引用以现行文本为准。
// ---------------------------------------------------------------------------
const KNOWLEDGE = [
  { id: "scope", title: "平等主体之间的民间纠纷才归调解", lines: [
    "邻里、家庭、买卖、小额债务这类平等主体之间的纠纷，可以调解。",
    "行政争议、刑事案子不归人民调解，别接。",
    "拿不准的，先看能不能自愿协商，再谈走哪条程序。"],
    cite: "人民调解法 第二条" },
  { id: "avoid", title: "跟当事人有利害关系就回避", lines: [
    "是当事人近亲属、与纠纷有利害关系、可能影响公正的，都应当回避。",
    "当事人可以口头或书面申请换人，不用给理由给到难堪。",
    "换人不丢人，硬调才出事。"],
    cite: "人民调解法 第十五条" },
  { id: "back-to-back", title: "先分开谈，再合起来谈", lines: [
    "双方一见面就顶牛时，先挨个问：他要什么、最不肯让什么。",
    "把话各自的底线摸清，再决定哪一句由谁来说。",
    "分开谈不等于背着人定事，谈完还是要当面说清。"],
    cite: "人民调解法 第二十条（调解方式）" },
  { id: "face-to-face", title: "面对面的火候：先给台阶再摆事实", lines: [
    "当着两家念法条，等于当众判谁对谁错，容易翻脸。",
    "先把人按回椅子上：一句「都不是外人」，比十条道理先用。",
    "事实留到台阶给够之后再说。"],
  cite: "人民调解法 第二十一条（明法析理）" },
  { id: "drainage", title: "相邻排水：低处要容水，改道要补偿", lines: [
    "不动产权利人应当为相邻权利人用水、排水提供必要便利。",
    "对自然流水的走向，低处不能擅自堵截；改道造成损失要赔。",
    "院墙案这类檐水改道，先看水往哪走，再谈谁出钱修沟。"],
  cite: "民法典 第二百九十条" },
  { id: "boundary", title: "宅基地边界：认档案、认界石，别认嗓门", lines: [
    "四至以登记档案和界石为准，口头说的只能当线索。",
    "已经按现状发证的，再改要走更正登记，调解室一句话定不了。",
    "当场量尺、拍照、写进笔录，这三件事做完再说结论。"],
  cite: "民法典 第二百八十八条（相邻关系）" },
  { id: "oral-deal", title: "口头协议有效，但要有东西能证明", lines: [
    "口头约定在法律上不是无效，难点永远在「怎么证明」。",
    "证人、录音、事后追认、履行行为，都能补强。",
    "调解时把当年的口头约定写成书面协议，是最省事的固定办法。"],
  cite: "民法典 第四百六十九条（合同形式）" },
  { id: "enforce", title: "协议签完还不算完，要能落地", lines: [
    "调解协议写清履行时间、方式、违约怎么办，才有执行力。",
    "双方可以自协议生效起三十日内共同申请司法确认。",
    "确认之后一方不履行，另一方可直接申请强制执行。"],
  cite: "人民调解法 第三十三条（司法确认）" },
  { id: "evidence", title: "证据固定：先拍照，再写清来源", lines: [
    "现场照片要带参照物和比例尺，别只拍一张特写。",
    "每条证据记清楚：谁提供、什么时候、看到什么。",
    "自己看到的写「看到」，别人说的写「听某某说」，别混。"],
  cite: "人民调解法 第二十二条（调查核实）" },
  { id: "cool-down", title: "情绪先降温，方案才进得去", lines: [
    "人在气头上时，任何方案都会被当成偏袒。",
    "先复述对方的话，让他确认「你听懂了」，再往下谈。",
    "能让两个人坐下来喝口水，比多讲十分钟道理有用。"],
  cite: "人民调解法 第二十一条（疏导）" },
  { id: "record", title: "记录要点：时间、地点、谁说了什么", lines: [
    "记录不写评价，只写事实和各方说法。",
    "关键数字（三十公分、两万六、十二月前）一律原话照录。",
    "当场读一遍给当事人听，听完再签。"],
  cite: "人民调解法 第二十七条（调解笔录）" },
  { id: "closing", title: "结案文书写清三件事", lines: [
    "一写各方权利义务，二写履行期限，三写不履行怎么办。",
    "能当场履行的，当场履行完再签；不能的，约好回访时间。",
    "卷宗里留一份协议原件，别只留在手机相册里。"],
  cite: "人民调解法 第二十九条（协议内容）" }
];

// ---------------------------------------------------------------------------
// 图标：24×24 线性图标，颜色一律 currentColor（由 CSS 给 PAL 色）
// ---------------------------------------------------------------------------
const ICONS = {
  case: '<path d="M3.5 7.2a2 2 0 0 1 2-2h4l1.6 2.1h7.4a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z"/><path d="M7.2 12.2h9.6M7.2 15.4h6.4"/>',
  people: '<circle cx="12" cy="6.4" r="2.4"/><circle cx="5.6" cy="17.2" r="2.2"/><circle cx="18.4" cy="17.2" r="2.2"/><path d="M10.4 8.5 7 15.2M13.6 8.5 17 15.2M7.8 17.2h8.4"/>',
  evidence: '<path d="M11.2 3.8H19a1.2 1.2 0 0 1 1.2 1.2v7.8a2 2 0 0 1-.6 1.4l-5.5 5.5a2 2 0 0 1-2.8 0l-5.7-5.7a2 2 0 0 1 0-2.8l5.6-5.6a2 2 0 0 1 1.4-.6Z"/><circle cx="16.4" cy="7.8" r="1.4"/>',
  notes: '<path d="M4 17.6 4.8 14l9.6-9.6a2.1 2.1 0 0 1 3 3L7.8 17l-3.8.6Z"/><path d="M13.2 5.6l3 3"/><path d="M4 21h16"/>',
  laws: '<path d="M12 4.2v14.4M8 19.6h8M4.6 7.2h14.8"/><path d="M4.6 7.2 2 13a2.9 2.9 0 0 0 5.6 0Z"/><path d="M19.4 7.2 16.8 13a2.9 2.9 0 0 0 5.6 0Z"/>',
  map: '<path d="M9 4.2 3.6 6.2v13.6L9 17.8l6 2 5.4-2V4.2l-5.4 2-6-2Z"/><path d="M9 4.2v13.6M15 6.2v13.6"/>',
  call: '<path d="M6.4 3.4h2.5l1.6 4-2 1.5a11.6 11.6 0 0 0 5.6 5.6l1.5-2 4 1.6v2.5a2 2 0 0 1-2.2 2A16.4 16.4 0 0 1 4.4 5.6a2 2 0 0 1 2-2.2Z"/>',
  learn: '<path d="M2.6 8.6 12 4.2l9.4 4.4L12 13 2.6 8.6Z"/><path d="M6.6 10.6v4.2c0 1.5 2.4 2.8 5.4 2.8s5.4-1.3 5.4-2.8v-4.2"/><path d="M21.4 8.6v4.6"/>',
  review: '<path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8L12 3.6Z"/>',
  lock: '<rect x="4.6" y="9.6" width="14.8" height="10.4" rx="2.2"/><path d="M8.2 9.6V7.4a3.8 3.8 0 0 1 7.6 0v2.2"/>',
  phone: '<rect x="7" y="2.6" width="10" height="18.8" rx="2.6"/><path d="M10.6 5.4h2.8M11 18.3h2"/>'
};

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------
const HTML_ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) { return HTML_ESC[ch]; });
}

function txt(v) { return v == null ? "" : String(v).trim(); }

function asArray(v) {
  if (Array.isArray(v)) { return v; }
  if (v == null) { return []; }
  if (typeof v === "object") { return Object.keys(v).map(function (k) { return v[k]; }); }
  return [v];
}

function rgba(hex, alpha) {
  var h = String(hex).replace("#", "");
  if (h.length === 3) { h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; }
  var n = parseInt(h, 16);
  return "rgba(" + ((n >> 16) & 255) + ", " + ((n >> 8) & 255) + ", " + (n & 255) + ", " + alpha + ")";
}

function el(tag, cls, text) {
  var node = document.createElement(tag);
  if (cls) { node.className = cls; }
  if (text !== undefined && text !== null) { node.textContent = text; }
  return node;
}

function clear(node) { while (node.firstChild) { node.removeChild(node.firstChild); } }

function svgWrap(name) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || "") + "</svg>";
}

// ---------------------------------------------------------------------------
// 数据归一化：外部数据什么形状都收，内部只认一套字段
// ---------------------------------------------------------------------------
function normalizeEvidence(input, caseData) {
  var source = [];
  if (Array.isArray(input)) { source = input; }
  else if (input && Array.isArray(input.items)) { source = input.items; }
  else if (input && typeof input === "object") { source = asArray(input); }
  if (!source.length && caseData) {
    source = Array.isArray(caseData.evidence) ? caseData.evidence
      : (Array.isArray(caseData.facts) ? caseData.facts : []);
  }
  return source.map(function (it, i) {
    var o = (it && typeof it === "object") ? it : { title: it };
    // found 是评价与复盘统一用的字段（review.js 的 scorePlan 读它），
    // got/collected/seen 是更早的写法 —— 三套都收，内部一律同时给两个名字。
    var found = !(o.found === false || o.got === false || o.collected === false || o.seen === false);
    return {
      id: txt(o.id) || "e" + (i + 1),
      title: txt(o.title || o.label || o.name) || "未命名证据",
      text: txt(o.text || o.gist || o.desc || o.note),
      weight: typeof o.weight === "number" ? o.weight : null,
      spot: txt(o.spot || o.spotId),
      got: found,
      found: found
    };
  });
}

function normalizeCharacters(input, caseData) {
  var source = [];
  if (Array.isArray(input)) { source = input; }
  else if (input && typeof input === "object") {
    source = Object.keys(input).map(function (k) {
      return Object.assign({ id: k }, input[k] || {});
    });
  } else if (caseData) {
    var parties = caseData.parties;
    if (Array.isArray(parties)) { source = parties; }
    else if (parties && typeof parties === "object") {
      var order = Array.isArray(caseData.partyOrder) && caseData.partyOrder.length
        ? caseData.partyOrder : Object.keys(parties);
      source = order.filter(function (id) { return parties[id]; }).map(function (id) {
        return Object.assign({ id: id }, parties[id]);
      });
    }
  }
  return source.map(function (it, i) {
    var o = it || {};
    var needs = asArray(o.needs).map(function (n) {
      return txt(n && typeof n === "object" ? (n.text || n.label) : n);
    }).filter(Boolean);
    var links = asArray(o.links || o.relations).map(function (x) {
      return txt(x && typeof x === "object" ? (x.id || x.to) : x);
    }).filter(Boolean);
    return {
      id: txt(o.id) || "p" + (i + 1),
      name: txt(o.name || o.label) || "未署名",
      role: txt(o.role || o.title),
      job: txt(o.job),
      age: o.age == null ? "" : String(o.age),
      note: txt(o.brief || o.note || o.profile),
      needs: needs,
      links: links
    };
  });
}

function normalizeLaws(input) {
  var source = [];
  if (Array.isArray(input)) { source = input; }
  else if (input && Array.isArray(input.articles)) { source = input.articles; }
  else if (input && typeof input === "object") { source = asArray(input); }
  return source.map(function (it, i) {
    var o = it || {};
    return {
      id: txt(o.id) || "l" + (i + 1),
      law: txt(o.law || o.source),
      article: txt(o.article || o.articleNo),
      title: txt(o.title),
      gist: txt(o.gist || o.text || o.summary),
      tags: asArray(o.tags).map(txt).filter(Boolean)
    };
  });
}

function normalizeScenes(input) {
  var source = [];
  if (Array.isArray(input)) { source = input; }
  else if (input && Array.isArray(input.scenes)) { source = input.scenes; }
  else if (input && typeof input === "object") { source = asArray(input); }
  return source.map(function (it, i) {
    var o = it || {};
    var setting = txt(o.setting);
    return {
      id: txt(o.id) || "s" + (i + 1),
      name: txt(o.name || o.title) || "未命名地点",
      setting: setting === "room" ? "室内" : (setting === "yard" ? "室外" : setting),
      spots: asArray(o.spots).length,
      visited: o.visited !== false,
      current: o.current === true
    };
  });
}

function normalizePersonScenes(input) {
  // 外壳送进来的是「本案每个 party 能去哪」：
  //   { p_a: [{ scene: "wall", name: "院墙地界" }, ...], ... }
  // 只保留 scene；name 缺了就退回 scene（宁可显示英文 id，也不要空行）。
  var out = {};
  if (!input || typeof input !== "object") { return out; }
  Object.keys(input).forEach(function (pid) {
    var list = asArray(input[pid]);
    var seen = {};
    out[pid] = list.map(function (it, i) {
      var o = (it && typeof it === "object") ? it : { name: it };
      var scene = txt(o.scene || o.id);
      return { scene: scene, name: txt(o.name || o.label) || scene || "未命名地点" };
    }).filter(function (it) {
      if (!it.scene || seen[it.scene]) { return false; }
      seen[it.scene] = 1;
      return true;
    });
  });
  return out;
}

function normalizeContacts(input, caseData, characters) {
  var source = [];
  if (Array.isArray(input)) { source = input; }
  else if (input && Array.isArray(input.contacts)) { source = input.contacts; }
  else if (caseData && Array.isArray(caseData.contacts)) { source = caseData.contacts; }
  if (!source.length) {
    source = characters.map(function (ch) {
      return { id: ch.id, alias: ch.name, tag: ch.role, note: ch.job };
    });
  }
  return source.map(function (it, i) {
    var o = it || {};
    return {
      id: txt(o.id || o.partyId) || "c" + (i + 1),
      name: txt(o.alias || o.name || o.label) || "未署名",
      tag: txt(o.tag || o.role),
      note: txt(o.note || o.job)
    };
  });
}

// 三个案子的摘要：手机「案件档案」一次列全，点哪件换哪件。
// 列表还没送到时，至少把当前案卷本身当成一条，页面不至于空着。
function normalizeCaseList(input, caseData) {
  var source = [];
  if (Array.isArray(input)) { source = input; }
  else if (input && Array.isArray(input.cases)) { source = input.cases; }
  if (!source.length && caseData) { source = [caseData]; }
  // 外壳显式给了 current 就听外壳的（换案瞬间列表要立刻挪标记）；
  // 只给了案卷数据时，再用 caseData.id 倒推。
  var hasCurrent = source.some(function (it) { return it && it.current === true; });
  return source.map(function (it, i) {
    var o = it || {};
    var id = txt(o.id) || "case_" + (i + 1);
    var name = txt(o.name) || txt(o.title) || "未命名案件";
    var title = txt(o.title);
    return {
      id: id,
      name: name,
      title: title && title !== name ? title : "",
      subtitle: txt(o.subtitle || o.sub),
      difficulty: txt(o.difficulty),
      playtime: txt(o.playtime),
      current: o.current === true || (!hasCurrent && !!(caseData && txt(caseData.id) === id))
    };
  });
}

function detectClosed(caseData) {
  if (!caseData || typeof caseData !== "object") { return false; }
  if (caseData.closed === true) { return true; }
  var s = txt(caseData.status);
  if (s === "closed" || s === "结案" || s === "已结案") { return true; }
  if (caseData.ending && (caseData.ending.closed === true || caseData.ending.state === "closed")) {
    return true;
  }
  return false;
}

const LS_KEY = "tjt.phone.notes.v1";

function loadNotes() {
  try {
    var raw = window.localStorage.getItem(LS_KEY);
    var arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) { return []; }
    return arr.filter(function (n) {
      return n && typeof n.text === "string" && n.text.trim();
    }).map(function (n, i) {
      return { id: txt(n.id) || "n" + i, text: txt(n.text), t: Number(n.t) || 0 };
    });
  } catch (err) {
    return [];
  }
}

function saveNotes(list) {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(list.slice(-80)));
  } catch (err) { /* 无痕模式/沙箱里写不进去就算了，别让手机打不开 */ }
}

// 写方案草稿：按 caseId 存一份纯文本，刷新/换页不丢（写不进去也不影响结案）。
const PLAN_LS_KEY = "tjt.phone.plan.v1.";
function loadPlanDraft(caseId) {
  try {
    return window.localStorage.getItem(PLAN_LS_KEY + txt(caseId)) || "";
  } catch (err) { return ""; }
}
function savePlanDraft(caseId, text) {
  try {
    window.localStorage.setItem(PLAN_LS_KEY + txt(caseId), String(text == null ? "" : text));
  } catch (err) { /* 忽略 */ }
}
// 最小版：一个文本框 → 按换行/句号/分号拆成 claims，不做结构化编辑。
function planClaimsFromText(raw) {
  var out = [];
  String(raw == null ? "" : raw).split(/\n+/).forEach(function (line) {
    line.split(/[。；;]+/).forEach(function (seg) {
      var text = txt(seg);
      if (text) { out.push({ text: text }); }
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// 样式：颜色全部由 PAL 插值生成（含半透明），所以这文件里只有一个颜色来源。
// ---------------------------------------------------------------------------
// 图标配色：桌面沿用国庆项目那套（中性浅屏 + 深墨壳），但**图标是这套工具自己画的**，
// 所以不跟国庆的高饱和蓝/橙/绿/红走 —— 换成 PAL 四个色相压暗一档的值：
// 白底 22px 线框仍过 4.5:1 对比度，放在中性桌面上不抢眼，又跟外壳的墨蓝/赭/薄荷/珊瑚同源。
const ICON_TONE = {
  info: "#315c72",     // PAL.navy  · 档案 / 人物 / 笔记 / 法条 / 通讯
  warn: "#8a6a4a",     // PAL.wood  · 证据
  ok: "#4f7a68",       // PAL.mint  · 地点 / 学习
  danger: "#b5564a"    // PAL.coral · 评价复盘
};

function buildCss() {
  // 默认用国庆项目那台手机的配色：深墨壳 + 中性浅屏 + 品牌蓝。
  // 想切回本项目 PAL，createPhone({ theme: "pal" })，.tp-theme-pal 会整套换掉。
  var vars = [
    "--c-ink: #1f2328;",
    "--c-ink2: #4b5563;",
    "--c-road: #838b96;",
    "--c-frame: #1f2328;",
    "--c-navy: #1d4ed8;",
    "--c-blue: #1d4ed8;",
    "--c-dark: #12337d;",
    "--c-mint: #eaf0ff;",
    "--c-white: #ffffff;",
    "--c-cream: #f7f6f3;",
    "--c-glass: #e5e2dc;",
    "--c-sand: #fdf3e3;",
    "--c-wood: #b45309;",
    "--c-coral: #b42318;",
    "--c-peach: #fdf3e3;",
    "--c-yellow: #fdf3e3;",
    "--c-ok: #0f7b4f;",
    "--icon-info: " + ICON_TONE.info + ";",
    "--icon-warn: " + ICON_TONE.warn + ";",
    "--icon-ok: " + ICON_TONE.ok + ";",
    "--icon-danger: " + ICON_TONE.danger + ";"
  ].join("\n");
  return `
.tp-root {
${vars}
  --tp-h: 70vh;
  --tp-w: calc(var(--tp-h) * 0.62 / 1.2);
  --tp-ease: cubic-bezier(.22, 1, .36, 1);
  --line: #e5e2dc;
  --line-soft: #f2efea;
  --shadow: 0 1px 2px rgba(16, 24, 40, .05);
  position: fixed;
  inset: 0;
  z-index: 9000;
  pointer-events: none;
  color: var(--c-ink);
  font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, -apple-system, sans-serif;
  font-size: 12px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  -webkit-tap-highlight-color: transparent;
}
.tp-root *, .tp-root *::before, .tp-root *::after { box-sizing: border-box; }
.tp-root [hidden] { display: none !important; }
.tp-root button { font-family: inherit; }
.tp-root :focus-visible { outline: 2px solid var(--c-blue); outline-offset: 2px; }

/* ---------------------------------------------------------------- 右上角开关 */
.tp-launch {
  position: fixed;
  top: 18px;
  right: 18px;
  width: 44px;
  height: 44px;
  padding: 0;
  display: grid;
  place-items: center;
  border: 1px solid var(--c-ink);
  border-radius: 14px;
  background: var(--c-white);
  color: var(--c-navy);
  cursor: pointer;
  pointer-events: auto;
  z-index: 9020;
  box-shadow: 0 4px 14px rgba(16, 24, 40, .16);
  transition: background .18s ease, color .18s ease, transform .18s ease,
              right .35s var(--tp-ease), box-shadow .18s ease;
}
.tp-launch svg { width: 20px; height: 20px; display: block; }
.tp-launch:hover { transform: translateY(-1px); box-shadow: 0 8px 20px rgba(16, 24, 40, .22); }
.tp-launch:active { transform: translateY(0) scale(.96); }
/* 手机打开后右上角开关仍是白底，不跟着变成蓝块。 */

/* ---------------------------------------------------------------- 遮罩 */
.tp-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9000;
  background: rgba(20, 24, 30, .22);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity .35s ease, visibility 0s linear .35s;
}
.tp-root.is-open .tp-backdrop {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transition: opacity .35s ease, visibility 0s;
}

/* 居中：跟国庆项目那台手机一样，屏幕正中，从右侧滑进来 */
.tp-shell {
  position: fixed;
  top: 50%;
  left: 50%;
  right: auto;
  height: var(--tp-h);
  width: auto;
  aspect-ratio: 0.62 / 1.2;
  max-width: 94vw;
  max-height: calc(100vh - 28px);
  margin-left: calc(var(--tp-w) * -0.5);
  margin-top: calc(var(--tp-h) * -0.5);
  padding: 9px;
  display: flex;
  flex-direction: column;
  background: var(--c-frame);
  border: 1px solid var(--c-ink);
  border-radius: 34px;
  box-shadow: 0 30px 70px rgba(0, 0, 0, .38), inset 0 0 0 1px rgba(255, 255, 255, .06);
  overflow: hidden;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translateX(calc(50vw + var(--tp-w)));
  z-index: 9010;
  transition: transform .35s var(--tp-ease), opacity .25s ease, visibility 0s linear .35s;
}
.tp-root.is-open .tp-shell {
  transform: translateX(0);
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transition: transform .35s var(--tp-ease), opacity .2s ease, visibility 0s;
}

/* 刘海：压住屏幕顶沿，跟旧版一样 */
.tp-notch {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 84px;
  height: 17px;
  border-bottom-left-radius: 12px;
  border-bottom-right-radius: 12px;
  background: var(--c-frame);
  z-index: 4;
}
.tp-screen {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: 26px;
  background: var(--c-cream);
  overflow: hidden;
}
.tp-status {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 23px 14px 5px;
  font-size: 10px;
  color: var(--c-road);
  position: relative;
  z-index: 3;
}
.tp-time {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: .02em;
  color: var(--c-ink);
  font-variant-numeric: tabular-nums;
}
.tp-status-right { font-size: 9px; letter-spacing: .02em; color: var(--c-road); }
.tp-stage { position: relative; flex: 1; min-height: 0; }
.tp-foot {
  flex: none;
  display: flex;
  gap: 8px;
  padding: 7px 12px 11px;
  border-top: 1px solid var(--line);
}
.tp-foot button {
  flex: 1;
  padding: 8px;
  border: 1px solid var(--c-navy);
  border-radius: 10px;
  background: var(--c-white);
  color: var(--c-navy);
  font-size: 11px;
  cursor: pointer;
  transition: border-color .15s ease, color .15s ease;
}
.tp-foot button:hover { border-color: var(--c-blue); color: var(--c-blue); }
.tp-foot button, .tp-foot button:last-child { font-weight: 600; }   /* 两个按钮同粗，别再一个 700 一个 600 */

/* ---------------------------------------------------------------- 页面骨架 */
.tp-page {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--c-cream);
  animation: tp-page-in .18s ease both;
}
@keyframes tp-page-in {
  from { opacity: 0; transform: translateX(6px); }
  to { opacity: 1; transform: none; }
}
.tp-page-home { background: var(--c-cream); }
.tp-head {
  flex: none;
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 2px 13px 8px;
  border-bottom: 1px solid var(--line);
}
.tp-back {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--c-navy);
  font-size: 11px;
  cursor: pointer;
}
.tp-back:hover { color: var(--c-dark); text-decoration: underline; }
.tp-title {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--c-ink);
  letter-spacing: .01em;
}
.tp-sub {
  margin-left: auto;
  font-size: 9.5px;
  color: var(--c-road);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tp-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 8px 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  scrollbar-width: thin;
  scrollbar-color: rgba(31, 35, 40, .2) transparent;
}
.tp-body::-webkit-scrollbar, .tp-home::-webkit-scrollbar { width: 4px; }
.tp-body::-webkit-scrollbar-thumb, .tp-home::-webkit-scrollbar-thumb {
  background: rgba(31, 35, 40, .18);
  border-radius: 99px;
}

/* ---------------------------------------------------------------- 桌面 */
.tp-home {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 2px 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  scrollbar-width: thin;
  scrollbar-color: rgba(31, 35, 40, .2) transparent;
}
.tp-home-clock {
  margin-top: 3px;
  text-align: center;
  font-size: 36px;
  font-weight: 300;
  line-height: 1.08;
  letter-spacing: .01em;
  color: var(--c-ink);
  font-variant-numeric: tabular-nums;
}
.tp-home-date {
  margin-top: -1px;
  text-align: center;
  font-size: 10px;
  letter-spacing: .03em;
  color: var(--c-road);
}

/* 在办卡片：桌面第一块信息 */
.tp-widget {
  position: relative;
  flex: none;
  width: 100%;
  margin-top: 2px;
  padding: 8px 10px 7px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--c-white);
  text-align: left;
  cursor: pointer;
  box-shadow: var(--shadow);
  transition: border-color .18s ease, transform .18s ease;
}
.tp-widget:hover { border-color: var(--c-blue); }
.tp-widget:active { transform: scale(.995); }
.tp-widget-k {
  position: absolute;
  top: 8px;
  right: 9px;
  padding: 0 7px;
  border-radius: 999px;
  background: var(--c-sand);
  color: var(--c-wood);
  font-size: 9px;
  line-height: 17px;
  letter-spacing: .02em;
}
.tp-widget-t {
  padding-right: 46px;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.45;
  color: var(--c-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tp-widget-m {
  font-size: 10.5px;
  line-height: 1.55;
  color: var(--c-road);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.tp-widget.is-empty .tp-widget-k { background: var(--c-line-soft); color: var(--c-road); }

/* 九宫格：格子仍是 1:1，图标是白底分类色；上下留白交给 auto 均分，
   手机放大后底部不会留出一大块空。 */
.tp-grid {
  flex: none;
  margin-block: auto;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.tp-app {
  position: relative;
  aspect-ratio: 1 / 1;
  padding: 6px 2px 5px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 0;
  border-radius: 14px;
  background: transparent;
  color: var(--c-road);
  cursor: pointer;
  transition: background .15s ease;
}
.tp-app:active { background: rgba(31, 35, 40, .05); }
.tp-app-icon {
  position: relative;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 13px;
  background: var(--c-white);
  color: var(--c-navy);
  box-shadow: 0 2px 5px rgba(16, 24, 40, .05);
  transition: transform .16s var(--tp-ease), box-shadow .16s ease;
}
.tp-app-icon > svg { width: 22px; height: 22px; display: block; }
.tp-app-label {
  font-size: 10px;
  line-height: 1.2;
  letter-spacing: .01em;
  color: var(--c-ink2);
  white-space: nowrap;
}
.tp-app:hover .tp-app-icon { transform: translateY(-2px); box-shadow: 0 6px 12px rgba(16, 24, 40, .12); }

/* 图标配色：白底线框 + 分类色。四个色相来自本项目 PAL 压暗一档，
   跟国庆那台机器的品牌蓝区分开（那套蓝留给桌面强调与按钮）。 */
.tp-app--blue .tp-app-icon { color: var(--icon-info); }
.tp-app--warn .tp-app-icon { color: var(--icon-warn); }
.tp-app--ok .tp-app-icon { color: var(--icon-ok); }
.tp-app--danger .tp-app-icon { color: var(--icon-danger); }
.tp-app-count {
  position: absolute;
  top: -5px;
  right: -5px;
  min-width: 16px;
  padding: 0 4px;
  border: 1px solid var(--c-white);
  border-radius: 999px;
  background: var(--c-navy);
  color: #fff;
  font-size: 8px;
  font-style: normal;
  line-height: 14px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.tp-app-lock {
  position: absolute;
  right: -4px;
  bottom: -4px;
  width: 16px;
  height: 16px;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: var(--c-white);
  color: var(--c-road);
  display: none;
  box-shadow: 0 1px 2px rgba(16, 24, 40, .06);
}
.tp-app-lock svg { width: 100%; height: 100%; display: block; }
.tp-app.is-locked .tp-app-lock { display: block; }
.tp-app.is-locked .tp-app-icon {
  background: rgba(31, 35, 40, .05);
  color: #9aa1a9;
  border-style: dashed;
  box-shadow: none;
}
.tp-app.is-locked .tp-app-label { color: #9aa1a9; }
.tp-app.is-locked:hover .tp-app-icon { transform: none; box-shadow: none; }
.tp-app.is-locked { cursor: not-allowed; }
.tp-app.is-shake { animation: tp-shake .32s ease; }
@keyframes tp-shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-3px); }
  55% { transform: translateX(3px); }
  80% { transform: translateX(-1px); }
}
.tp-root.is-open .tp-app { animation: tp-tile-in .3s var(--tp-ease) both; }
.tp-root.is-open .tp-app:nth-child(2) { animation-delay: .015s; }
.tp-root.is-open .tp-app:nth-child(3) { animation-delay: .03s; }
.tp-root.is-open .tp-app:nth-child(4) { animation-delay: .045s; }
.tp-root.is-open .tp-app:nth-child(5) { animation-delay: .06s; }
.tp-root.is-open .tp-app:nth-child(6) { animation-delay: .075s; }
.tp-root.is-open .tp-app:nth-child(7) { animation-delay: .09s; }
.tp-root.is-open .tp-app:nth-child(8) { animation-delay: .105s; }
.tp-root.is-open .tp-app:nth-child(9) { animation-delay: .12s; }
@keyframes tp-tile-in {
  from { opacity: 0; transform: translateY(6px) scale(.97); }
  to { opacity: 1; transform: none; }
}

/* 桌面提示条已经删掉：入口就在九宫格里，不再用一行字复述。 */

/* ---------------------------------------------------------------- 文字与卡片 */
.tp-p { margin: 0; font-size: 11.5px; line-height: 1.75; color: var(--c-ink); white-space: pre-line; }
.tp-p.tp-muted { font-size: 10.5px; color: var(--c-road); }
.tp-p.tp-strong { font-size: 15px; font-weight: 700; color: var(--c-ink); line-height: 1.4; }
.tp-card {
  padding: 9px 11px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--c-white);
  box-shadow: var(--shadow);
}
.tp-body > .tp-card:first-child { padding-top: 9px; }
.tp-card-h {
  margin: 0 0 2px;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--c-ink);
}
.tp-kv { display: flex; gap: 8px; font-size: 11.5px; line-height: 1.7; }
.tp-kv .k { flex: none; min-width: 34px; color: var(--c-road); font-size: 10.5px; }
.tp-kv .v { flex: 1; min-width: 0; overflow-wrap: anywhere; }
/* 案件档案 · 「人在哪张图」：附在当事人行下面的一行小字。
   13px / 次要灰，不抢主线；超过 3 处时整行是可点的 button（展开/收起）。 */
.tp-party { display: flex; flex-direction: column; gap: 1px; }
.tp-party + .tp-party { margin-top: 7px; }
.tp-party-scene {
  display: block;
  width: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 13px;
  line-height: 1.65;
  color: var(--c-road);
  text-align: left;
  overflow-wrap: anywhere;
}
button.tp-party-scene { cursor: pointer; }
/* 触屏可点区域要 ≥44px（test_mobile 的九页审计），但这一行是"小字附注"、不该撑高版式：
   上下 padding 撑出 45px 的命中区，负 margin 把占位抵回去。 */
button.tp-party-scene { padding-top: 12px; padding-bottom: 12px;
  margin-top: -12px; margin-bottom: -12px; }
.tp-party-scene .tp-party-scene-more { color: var(--c-navy); opacity: .68; }
button.tp-party-scene:hover .tp-party-scene-more,
button.tp-party-scene:focus-visible .tp-party-scene-more { opacity: 1; text-decoration: underline; }
.tp-party-scene:focus-visible { outline: 2px solid var(--c-navy); outline-offset: 2px; border-radius: 3px; }
.tp-party-scene.is-missing { font-style: italic; opacity: .78; }
.tp-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 1px; }
.tp-chip {
  padding: 0 7px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--c-cream);
  color: var(--c-ink);
  font-size: 9.5px;
  line-height: 17px;
  white-space: nowrap;
}
.tp-chip.alt { background: var(--c-white); color: var(--c-navy); border-color: rgba(29, 78, 216, .25); }

/* ---------------------------------------------------------------- 案件列表 */
/* 三个案子同时接到：点一件换在办，不是二选一的选择器 */
.tp-cases { display: flex; flex-direction: column; gap: 5px; }
.tp-case-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--c-cream);
  color: var(--c-ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.tp-case-row:hover { border-color: var(--c-blue); background: var(--c-white); }
.tp-case-row.is-current {
  background: var(--c-mint);
  border-color: rgba(29, 78, 216, .35);
  cursor: default;
}
.tp-case-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.tp-case-n { font-size: 11.5px; font-weight: 700; color: var(--c-ink); }
.tp-case-t {
  font-size: 9.5px;
  color: var(--c-road);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tp-case-tag {
  flex: none;
  padding: 0 7px;
  border-radius: 999px;
  background: var(--c-navy);
  color: #fff;
  font-size: 9px;
  line-height: 17px;
}

.tp-empty {
  padding: 26px 14px;
  text-align: center;
  color: var(--c-road);
  font-size: 11px;
  line-height: 1.8;
}
.tp-empty b { display: block; margin-bottom: 2px; font-size: 12px; color: var(--c-ink); }

/* ---------------------------------------------------------------- 人物关系 */
.tp-relmap {
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--c-white);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.tp-relmap svg { display: block; width: 100%; height: auto; }
.tp-relmap .lines line { stroke: var(--c-road); stroke-width: 1; stroke-dasharray: 3 3; opacity: .55; }
.tp-relmap .nodes circle { fill: var(--c-navy); }
.tp-relmap .nodes text { fill: var(--c-cream); font-size: 10px; text-anchor: middle; dominant-baseline: middle; }
.tp-relmap .nodes text.lbl { fill: var(--c-ink); font-size: 8.5px; }
.tp-relmap-cap { margin: -2px 2px 0; font-size: 9.5px; line-height: 1.6; color: var(--c-road); }
.tp-person-wrap {
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--c-white);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.tp-person {
  width: 100%;
  padding: 8px 11px;
  display: flex;
  align-items: center;
  gap: 9px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.tp-person:hover { background: var(--c-cream); }
.tp-ava {
  flex: none;
  width: 27px;
  height: 27px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--c-navy);
  color: var(--c-cream);
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}
.tp-person-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.tp-person-n { font-size: 12px; font-weight: 700; color: var(--c-ink); }
.tp-person-r { font-size: 10px; color: var(--c-road); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tp-person-caret { flex: none; font-size: 9px; color: var(--c-road); transition: transform .15s ease; }
.tp-person.is-open .tp-person-caret { transform: rotate(180deg); }
.tp-person-d {
  padding: 8px 11px 10px;
  border-top: 1px dashed var(--line);
  background: var(--c-cream);
  font-size: 10.5px;
  line-height: 1.75;
  color: var(--c-ink);
  white-space: pre-line;
}

/* ---------------------------------------------------------------- 证据夹 */
.tp-evi-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
.tp-evi {
  position: relative;
  min-height: 84px;
  padding: 8px 9px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--c-white);
  box-shadow: var(--shadow);
}
.tp-evi-t { font-size: 11px; font-weight: 700; line-height: 1.45; color: var(--c-ink); }
.tp-evi-x {
  font-size: 10px;
  line-height: 1.55;
  color: var(--c-road);
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.tp-evi-m { margin-top: auto; font-size: 9px; color: var(--c-wood); }
.tp-evi.is-missing { border-style: dashed; box-shadow: none; background: rgba(31, 35, 40, .03); }
.tp-evi.is-missing .tp-evi-t { color: var(--c-road); font-weight: 600; }
.tp-evi-q {
  flex: 1;
  display: grid;
  place-items: center;
  font-size: 20px;
  font-weight: 300;
  color: var(--c-road);
  opacity: .55;
}

/* ---------------------------------------------------------------- 笔记 */
.tp-note-editor {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 9px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--c-white);
  box-shadow: var(--shadow);
}
.tp-note-input {
  width: 100%;
  min-height: 58px;
  padding: 7px 8px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--c-cream);
  color: var(--c-ink);
  font: inherit;
  font-size: 11.5px;
  line-height: 1.7;
  resize: vertical;
}
.tp-note-input::placeholder { color: var(--c-road); opacity: .8; }
.tp-note-input:focus { outline: 2px solid rgba(29, 78, 216, .28); outline-offset: 1px; border-color: var(--c-blue); }
/* 评价页 · 结案前写方案（最小版：一个多行框，按行/句拆 claims） */
.tp-plan { display: flex; flex-direction: column; gap: 4px; width: 100%; text-align: left; }
.tp-plan-t { font-size: 11px; font-weight: 600; color: var(--c-road); }
.tp-plan-input { min-height: 92px; background: var(--c-white); }
.tp-note-actions { display: flex; justify-content: flex-end; gap: 7px; }
.tp-btn {
  padding: 5px 12px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--c-white);
  color: var(--c-road);
  font-size: 10.5px;
  cursor: pointer;
  transition: border-color .15s ease, color .15s ease, background .15s ease;
}
.tp-btn:hover { border-color: var(--c-blue); }
.tp-btn.primary { border-color: var(--c-navy); background: var(--c-navy); color: #fff; font-weight: 600; }
.tp-btn.primary:hover { background: var(--c-dark); border-color: var(--c-dark); }
.tp-note {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--c-white);
  box-shadow: var(--shadow);
}
.tp-note-t { flex: 1; min-width: 0; font-size: 11px; line-height: 1.7; color: var(--c-ink); white-space: pre-line; overflow-wrap: anywhere; }
.tp-note-del {
  flex: none;
  width: 20px;
  height: 20px;
  padding: 0;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--c-road);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}
.tp-note-del:hover { background: rgba(180, 35, 24, .1); color: var(--c-coral); }

/* ---------------------------------------------------------------- 法条 */
.tp-law {
  padding: 9px 11px;
  border: 1px solid var(--line);
  border-left: 3px solid var(--c-blue);
  border-radius: 10px;
  background: var(--c-white);
  box-shadow: var(--shadow);
}
.tp-law-h { display: flex; flex-wrap: wrap; align-items: baseline; gap: 5px; }
.tp-law-h b { font-size: 9.5px; font-weight: 600; color: var(--c-road); }
.tp-law-h span { font-size: 11.5px; font-weight: 700; color: var(--c-ink); }
.tp-law-g { margin: 4px 0 0; font-size: 10.5px; line-height: 1.75; color: var(--c-ink); }

/* ---------------------------------------------------------------- 地图 */
.tp-scene {
  width: 100%;
  padding: 9px 10px;
  display: flex;
  align-items: center;
  gap: 9px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--c-white);
  color: var(--c-ink);
  text-align: left;
  cursor: pointer;
  box-shadow: var(--shadow);
  transition: border-color .15s ease, background .15s ease;
}
button.tp-scene:hover { border-color: var(--c-blue); }
.tp-scene.is-here { background: var(--c-mint); border-color: rgba(29, 78, 216, .35); cursor: default; }
.tp-scene.is-unvisited { border-style: dashed; box-shadow: none; }
.tp-scene-dot {
  flex: none;
  width: 9px;
  height: 9px;
  border: 1px solid rgba(29, 78, 216, .4);
  border-radius: 50%;
  background: var(--c-blue);
}
.tp-scene.is-here .tp-scene-dot { background: var(--c-navy); border-color: var(--c-navy); }
.tp-scene.is-unvisited .tp-scene-dot { background: var(--c-white); border-style: dashed; }
.tp-scene-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.tp-scene-n { font-size: 12px; font-weight: 700; color: var(--c-ink); }
.tp-scene-m { font-size: 10px; color: var(--c-road); }
.tp-scene-tag {
  flex: none;
  padding: 0 7px;
  border-radius: 999px;
  background: var(--c-navy);
  color: #fff;
  font-size: 9px;
  line-height: 17px;
}

/* ---------------------------------------------------------------- 通讯 */
/* 整行是拨号键：点姓名 / 头像 / 右侧「拨打」都直接弹通话框，不再要求点中小按钮 */
.tp-call {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 9px 10px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--c-white);
  box-shadow: var(--shadow);
  color: var(--c-ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color .15s ease, background .15s ease, transform .12s ease;
}
.tp-call:hover { border-color: var(--c-blue); }
.tp-call:active { transform: scale(.995); background: rgba(29, 78, 216, .04); }
.tp-call .tp-ava { pointer-events: none; }
.tp-call-main { flex: 1; min-width: 0; pointer-events: none; }
.tp-call-n { font-size: 12px; font-weight: 700; color: var(--c-ink); }
.tp-call-t { font-size: 10px; color: var(--c-road); }
.tp-call-d { margin-top: 2px; font-size: 10px; line-height: 1.55; color: var(--c-ink); }
.tp-call .tp-btn { flex: none; padding: 4px 10px; pointer-events: none; }

/* 通话对话框：点「拨打」后盖住手机屏幕，只有挂断 */
.tp-call-dialog {
  position: absolute;
  inset: 0;
  z-index: 8;
  display: grid;
  place-items: center;
  padding: 22px;
  background: rgba(20, 24, 30, .52);
  -webkit-backdrop-filter: blur(5px);
  backdrop-filter: blur(5px);
  opacity: 0;
  transition: opacity .18s ease;
}
.tp-call-dialog.is-on { opacity: 1; }
.tp-call-card {
  width: 100%;
  padding: 20px 16px 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--c-cream);
  box-shadow: 0 18px 44px rgba(0, 0, 0, .28);
  text-align: center;
}
.tp-call-ava {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--c-navy);
  color: #fff;
  font-size: 20px;
  font-weight: 700;
  line-height: 1;
}
.tp-call-name { font-size: 15px; font-weight: 700; color: var(--c-ink); }
.tp-call-tag { font-size: 10px; color: var(--c-road); }
.tp-call-state {
  margin-top: 4px;
  font-size: 12px;
  color: var(--c-navy);
  font-variant-numeric: tabular-nums;
}
.tp-call-hang {
  width: 100%;
  margin-top: 8px;
  padding: 9px;
  border: 1px solid var(--c-coral);
  border-radius: 999px;
  background: var(--c-coral);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

/* ---------------------------------------------------------------- 学习 */
.tp-tabs {
  display: flex;
  gap: 4px;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--c-white);
}
.tp-tab {
  flex: 1;
  padding: 5px 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--c-road);
  font-size: 11px;
  cursor: pointer;
  transition: background .15s ease, color .15s ease;
}
.tp-tab.is-on { background: var(--c-navy); color: #fff; font-weight: 600; }
.tp-op {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 9px 10px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--c-white);
  box-shadow: var(--shadow);
}
.tp-op-no {
  flex: none;
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--c-mint);
  color: var(--c-navy);
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.tp-op-main { flex: 1; min-width: 0; }
.tp-op-t { font-size: 11.5px; font-weight: 700; color: var(--c-ink); }
.tp-op-l { font-size: 10px; line-height: 1.6; color: var(--c-road); }
.tp-kcard {
  padding: 9px 11px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--c-white);
  box-shadow: var(--shadow);
}
.tp-kcard-t { font-size: 11.5px; font-weight: 700; line-height: 1.5; color: var(--c-ink); }
.tp-kcard-l { margin-top: 3px; font-size: 10px; line-height: 1.65; color: var(--c-road); }
.tp-kcard-c {
  margin-top: 5px;
  padding-top: 4px;
  border-top: 1px dashed var(--line);
  font-size: 9px;
  color: var(--c-wood);
}

/* ---------------------------------------------------------------- 评价 / 复盘 */
.tp-score { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; }
.tp-score-i {
  padding: 9px 5px 8px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--c-white);
  text-align: center;
  box-shadow: var(--shadow);
}
.tp-score-n {
  font-size: 22px;
  font-weight: 300;
  line-height: 1.1;
  color: var(--c-navy);
  font-variant-numeric: tabular-nums;
}
.tp-score-l { font-size: 9px; color: var(--c-road); }
.tp-stamp-row { display: flex; align-items: center; gap: 11px; padding: 2px 1px; }
.tp-seal {
  flex: none;
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  border: 1px solid var(--c-coral);
  border-radius: 50%;
  color: var(--c-coral);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: .04em;
  transform: rotate(-9deg);
  box-shadow: inset 0 0 0 3px var(--c-white), inset 0 0 0 4px var(--c-coral);
}
.tp-locked {
  margin: 2px 0;
  padding: 24px 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  border: 1px dashed var(--line);
  border-radius: 12px;
  background: var(--c-white);
  text-align: center;
}
.tp-locked-ico {
  width: 40px;
  height: 40px;
  padding: 10px;
  border-radius: 50%;
  background: rgba(180, 35, 24, .1);
  color: var(--c-coral);
}
.tp-locked-ico svg { width: 100%; height: 100%; display: block; }
.tp-locked-t { font-size: 12.5px; font-weight: 700; color: var(--c-ink); }
.tp-locked-d { margin: 0; font-size: 10.5px; line-height: 1.75; color: var(--c-road); }

/* ---------------------------------------------------------------- 轻提示 */
.tp-toast {
  position: absolute;
  left: 50%;
  bottom: 74px;
  z-index: 5;
  max-width: 84%;
  padding: 6px 13px;
  border-radius: 999px;
  background: rgba(31, 35, 40, .94);
  color: #fff;
  font-size: 10px;
  line-height: 1.5;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0;
  transform: translate(-50%, 8px);
  pointer-events: none;
  transition: opacity .18s ease, transform .18s ease;
}
.tp-toast.is-on { opacity: 1; transform: translate(-50%, 0); }

/* ---------------------------------------------------------------- PAL 主题（可选） */
/* 默认是国庆那台手机的配色；要回本项目色板：createPhone({ theme: "pal" }) */
.tp-theme-pal {
  --c-ink: ${PAL.ink};
  --c-ink2: ${PAL.road};
  --c-road: ${PAL.road};
  --c-frame: ${PAL.navy};
  --c-navy: ${PAL.navy};
  --c-blue: ${PAL.blue};
  --c-dark: ${PAL.dark};
  --c-mint: ${PAL.mint};
  --c-white: ${PAL.white};
  --c-cream: ${PAL.cream};
  --c-glass: ${PAL.glass};
  --c-sand: ${PAL.sand};
  --c-wood: ${PAL.wood};
  --c-coral: ${PAL.coral};
  --c-peach: ${PAL.peach};
  --c-yellow: ${PAL.yellow};
  --c-ok: ${PAL.mint};
  --icon-info: ${PAL.navy};
  --icon-warn: ${PAL.wood};
  --icon-ok: ${PAL.mint};
  --icon-danger: ${PAL.coral};
  --line: ${rgba(PAL.ink, 0.14)};
  --line-soft: ${rgba(PAL.ink, 0.07)};
}

/* ---------------------------------------------------------------- 窄屏 / 矮屏 */
@media (max-width: 900px) {
  .tp-root { --tp-h: 80vh; }
  .tp-launch { top: 12px; right: 12px; width: 38px; height: 38px; border-radius: 11px; }
  /* 手机居中后几乎占满宽度，开关就不跟它抢地方了：底下的「收起手机」还在 */
  .tp-root.is-open .tp-launch { opacity: 0; visibility: hidden; pointer-events: none; }
  .tp-app-icon { width: 50px; height: 50px; border-radius: 14px; }
  .tp-app-icon > svg { width: 25px; height: 25px; }
  .tp-app-label { font-size: 10.5px; }
  /* 高屏上只有三行图标：九宫格由 margin-block:auto 居中。 */
}
@media (max-height: 620px) {
  .tp-root { --tp-h: 88vh; }
}
/* ---------------------------------------------------------------- 真机（竖屏） */
/* 面板在 844 高下 80vh ≈ 675px，宽 ≈ 349px；这是"拿在手里"的尺寸，不是桌面预览。
   字号全部抬到 ≥13px、可点区域 ≥44px；九宫格三行仍能完整放下。 */
@media (max-width: 600px), (orientation: landscape) and (max-height: 560px) {
  .tp-root { --tp-h: 80vh; --tp-h: min(80dvh, 720px); font-size: 13px; }
  .tp-launch {
    top: calc(10px + env(safe-area-inset-top));
    right: calc(10px + env(safe-area-inset-right));
    width: 44px; height: 44px; border-radius: 13px;
  }
  .tp-status { padding: 9px 12px 4px; font-size: 13px; }
  .tp-time { font-size: 13px; }
  .tp-status-right { font-size: 13px; }
  .tp-foot { gap: 8px; padding: 8px 10px calc(10px + env(safe-area-inset-bottom)); }
  .tp-foot button { min-height: 44px; font-size: 14px; border-radius: 11px; }
  .tp-head { align-items: center; padding: 4px 12px 8px; gap: 8px; }
  .tp-back {
    min-width: 44px; min-height: 44px; padding: 0 6px;
    display: inline-flex; align-items: center; font-size: 14px;
  }
  .tp-title { font-size: 16px; }
  .tp-sub { font-size: 13px; }
  .tp-body { padding: 10px 11px 16px; gap: 9px; }
  .tp-home { padding: 2px 10px 10px; gap: 6px; }
  .tp-home-clock { font-size: 40px; }
  .tp-home-date { font-size: 13px; }
  .tp-widget { padding: 10px 12px 9px; }
  .tp-widget-k { font-size: 13px; line-height: 20px; }
  .tp-widget-t { font-size: 16px; }
  .tp-widget-m { font-size: 13px; line-height: 1.5; }
  .tp-grid { gap: 6px; }
  .tp-app { min-height: 88px; padding: 4px 2px; gap: 4px; }
  .tp-app-icon { width: 48px; height: 48px; border-radius: 14px; }
  .tp-app-icon > svg { width: 26px; height: 26px; }
  .tp-app-label { font-size: 13px; }
  .tp-app-count { min-width: 20px; font-size: 13px; line-height: 18px; }
  .tp-app-lock { width: 18px; height: 18px; }

  .tp-p { font-size: 14px; line-height: 1.7; }
  .tp-p.tp-muted { font-size: 13px; }
  .tp-p.tp-strong { font-size: 16px; }
  .tp-card { padding: 10px 12px; }
  .tp-card-h { font-size: 15px; }
  .tp-kv { font-size: 14px; }
  .tp-kv .k { font-size: 13px; min-width: 40px; }
  .tp-chip { font-size: 13px; line-height: 20px; padding: 0 9px; }
  .tp-case-row { min-height: 52px; padding: 10px 11px; }
  .tp-case-n { font-size: 14px; }
  .tp-case-t { font-size: 13px; }
  .tp-case-tag { font-size: 13px; line-height: 20px; }
  .tp-empty { font-size: 13px; }
  .tp-empty b { font-size: 15px; }
  .tp-relmap .nodes text { font-size: 13px; }
  .tp-relmap .nodes text.lbl { font-size: 13px; }
  .tp-relmap-cap { font-size: 13px; }
  .tp-person { min-height: 52px; padding: 10px 11px; }
  .tp-ava { width: 34px; height: 34px; font-size: 14px; }
  .tp-person-n { font-size: 14px; }
  .tp-person-r { font-size: 13px; }
  .tp-person-caret { font-size: 13px; }
  .tp-person-d { font-size: 13px; }
  .tp-evi-t { font-size: 14px; }
  .tp-evi-x { font-size: 13px; }
  .tp-evi-m { font-size: 13px; }
  .tp-note-editor { padding: 10px; }
  .tp-note-input { min-height: 96px; font-size: 16px; }
  .tp-btn { min-height: 44px; padding: 8px 14px; font-size: 13px; border-radius: 10px; }
  .tp-note { padding: 10px 11px; }
  .tp-note-t { font-size: 14px; }
  .tp-note-del { width: 44px; height: 44px; font-size: 17px; border-radius: 9px; }
  .tp-law { padding: 10px 12px; }
  .tp-law-h b { font-size: 13px; }
  .tp-law-h span { font-size: 14px; }
  .tp-law-g { font-size: 14px; }
  .tp-scene { min-height: 56px; padding: 10px 11px; }
  .tp-scene-n { font-size: 14px; }
  .tp-scene-m { font-size: 13px; }
  .tp-scene-tag { font-size: 13px; line-height: 20px; }
  .tp-call { padding: 10px 11px; }
  .tp-call-n { font-size: 14px; }
  .tp-call-t { font-size: 13px; }
  .tp-call-d { font-size: 13px; }
  .tp-call .tp-btn { min-height: 44px; }
  .tp-call-name { font-size: 16px; }
  .tp-call-tag { font-size: 13px; }
  .tp-call-state { font-size: 14px; }
  .tp-call-hang { min-height: 44px; font-size: 14px; }
  .tp-tabs { padding: 3px; }
  .tp-tab { min-height: 44px; font-size: 13px; }
  .tp-op { padding: 10px 11px; }
  .tp-op-no { width: 22px; height: 22px; font-size: 13px; }
  .tp-op-t { font-size: 14px; }
  .tp-op-l { font-size: 13px; }
  .tp-kcard { padding: 10px 12px; }
  .tp-kcard-t { font-size: 14px; }
  .tp-kcard-l { font-size: 13px; }
  .tp-kcard-c { font-size: 13px; }
  .tp-score-l { font-size: 13px; }
  .tp-seal { width: 52px; height: 52px; font-size: 14px; }
  .tp-locked-t { font-size: 15px; }
  .tp-locked-d { font-size: 13px; }
  .tp-toast { font-size: 13px; bottom: calc(74px + env(safe-area-inset-bottom)); }
}

/* ---------------------------------------------------------------- 真机（横屏） */
/* 横屏不再套"手机壳"：改成右侧抽屉（≤420px），3D 场景左侧吃满。
   九宫格改 5 列 × 2 行，390px 高的屏幕也不用滚。 */
@media (orientation: landscape) and (max-height: 560px) {
  .tp-root { --tp-h: 100vh; --tp-h: 100dvh; --tp-w: min(420px, 88vw); font-size: 13px; }
  .tp-shell {
    top: 0; left: auto; right: 0; height: var(--tp-h); width: min(420px, 88vw);
    aspect-ratio: auto; max-width: none; max-height: none; margin: 0;
    padding: calc(8px + env(safe-area-inset-top)) calc(8px + env(safe-area-inset-right))
             calc(8px + env(safe-area-inset-bottom)) 8px;
    border-radius: 18px 0 0 18px;
    transform: translateX(100%);
  }
  .tp-root.is-open .tp-shell { transform: none; }
  .tp-notch { display: none; }
  .tp-screen { border-radius: 14px 0 0 14px; }
  .tp-launch {
    top: calc(8px + env(safe-area-inset-top));
    right: calc(8px + env(safe-area-inset-right));
    width: 44px; height: 44px;
  }
  .tp-root.is-open .tp-launch { opacity: 0; visibility: hidden; pointer-events: none; }
  .tp-status { padding: 5px 12px 2px; }
  .tp-status, .tp-time, .tp-status-right { font-size: 13px; }
  .tp-stage { min-height: 0; }
  .tp-home { padding: 0 8px 6px; gap: 4px; }
  .tp-home-clock { margin-top: 0; font-size: 24px; }
  .tp-home-date { font-size: 13px; }
  .tp-widget { margin-top: 0; padding: 6px 9px; }
  .tp-widget-t { font-size: 14px; }
  .tp-widget-m { font-size: 13px; }
  .tp-widget-k { font-size: 13px; }
  .tp-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 5px; }
  .tp-app { aspect-ratio: auto; min-height: 68px; padding: 3px 1px; gap: 3px; }
  .tp-app-icon { width: 40px; height: 40px; border-radius: 12px; }
  .tp-app-icon > svg { width: 22px; height: 22px; }
  .tp-app-label { font-size: 13px; }
  .tp-head { padding: 2px 10px 6px; }
  .tp-title { font-size: 16px; }
  .tp-body { padding: 8px 9px 10px; gap: 7px; }
  .tp-foot { gap: 6px; padding: 5px 8px calc(6px + env(safe-area-inset-bottom)); }
  .tp-foot button { min-height: 44px; font-size: 14px; }
}

/* 减动效只减装饰（页面淡入、图标依次落位、抖一下），不动 0.35s 的滑入 ——
   打开时长是 §4.1 的硬指标，无头浏览器默认就是 reduce，不能在这里被砍掉。 */
@media (prefers-reduced-motion: reduce) {
  .tp-page, .tp-app, .tp-app-icon { transition-duration: .01ms !important; animation-duration: .01ms !important; animation-delay: 0s !important; }
}
`;
}

// ---------------------------------------------------------------------------
// createPhone
// ---------------------------------------------------------------------------
export function createPhone(options) {
  var opts = options || {};
  var host = resolveMount(opts.mount);
  var onOpen = typeof opts.onOpen === "function" ? opts.onOpen : null;
  var onClose = typeof opts.onClose === "function" ? opts.onClose : null;
  var onAction = typeof opts.onAction === "function" ? opts.onAction : null;

  ensureStyle();
  instances += 1;

  // ---------------------------------------------------------------- 状态
  var state = {
    open: false,
    page: "home",
    tab: "ops",
    raw: { caseData: null, cases: null, evidence: null, characters: null, laws: null,
           scenes: null, contacts: null, personScenes: null },
    caseData: null,
    caseList: [],
    evidence: [],
    characters: [],
    laws: [],
    scenes: [],
    contacts: [],
    personScenes: {},
    notes: loadNotes(),
    sceneId: "",
    closed: false,
    closedOverride: null
  };

  var lastFocus = null;
  var toastTimer = 0;
  var clockTimer = 0;
  var callTimer = 0;
  var callStartedAt = 0;
  var callOpen = false;
  var callReturnFocus = null;
  var destroyed = false;
  // 结案后的评分（review.js 算完由外壳回填），null = 还没评
  var reviewScore = null;

  // ---------------------------------------------------------------- 骨架
  // 配色：默认搬国庆那台手机；opts.theme === "pal" 时切回本项目色板
  var theme = opts.theme === "pal" ? "pal" : "legacy";
  var root = el("div", theme === "pal" ? "tp-root tp-theme-pal" : "tp-root");
  root.setAttribute("data-open", "false");

  var launch = document.createElement("button");
  launch.type = "button";
  launch.className = "tp-launch";
  launch.setAttribute("aria-label", "打开手机");
  launch.setAttribute("aria-expanded", "false");
  launch.setAttribute("title", "手机");
  launch.innerHTML = svgWrap("phone");

  var backdrop = el("div", "tp-backdrop");
  backdrop.setAttribute("aria-hidden", "true");

  var shell = el("aside", "tp-shell");
  shell.setAttribute("role", "dialog");
  shell.setAttribute("aria-modal", "true");
  shell.setAttribute("aria-label", "案件手机");
  shell.setAttribute("aria-hidden", "true");
  shell.innerHTML = [
    '<div class="tp-notch" aria-hidden="true"></div>',
    '<div class="tp-screen">',
    '  <div class="tp-status">',
    '    <span class="tp-time" data-slot="clock">--:--</span>',
    '    <span class="tp-status-right">执勤终端 · 电量 76%</span>',
    "  </div>",
    '  <div class="tp-stage">',
    homeMarkup(),
    PAGE_LIST.map(pageMarkup).join(""),
    "  </div>",
    '  <div class="tp-foot">',
    '    <button type="button" data-back="1">桌面</button>',
    '    <button type="button" data-close="1">收起手机</button>',
    "  </div>",
    "</div>",
    '<div class="tp-call-dialog" data-slot="call-dialog" role="dialog" aria-modal="true"' +
    ' aria-labelledby="tp-call-name" aria-hidden="true" hidden>',
    '  <div class="tp-call-card">',
    '    <div class="tp-call-ava" data-slot="call-ava" aria-hidden="true"></div>',
    '    <div class="tp-call-name" id="tp-call-name" data-slot="call-name"></div>',
    '    <div class="tp-call-tag" data-slot="call-tag"></div>',
    '    <div class="tp-call-state" data-slot="call-state" role="timer"></div>',
    '    <button class="tp-call-hang" type="button" data-slot="call-hang" data-call-hang="1">挂断</button>',
    "  </div>",
    "</div>",
    '<div class="tp-toast" data-slot="toast" role="status" aria-live="polite"></div>'
  ].join("\n");

  root.appendChild(launch);
  root.appendChild(backdrop);
  root.appendChild(shell);
  host.appendChild(root);

  var slots = {};
  Array.prototype.forEach.call(shell.querySelectorAll("[data-slot]"), function (node) {
    slots[node.getAttribute("data-slot")] = node;
  });
  var pageEls = Array.prototype.slice.call(shell.querySelectorAll(".tp-page"));

  // ---------------------------------------------------------------- 数据归一
  function rebuild() {
    var c = state.caseData = state.raw.caseData;
    state.caseList = normalizeCaseList(state.raw.cases, c);
    state.evidence = normalizeEvidence(state.raw.evidence, c);
    state.characters = normalizeCharacters(state.raw.characters, c);
    state.laws = normalizeLaws(state.raw.laws);
    state.scenes = normalizeScenes(
      state.raw.scenes !== null && state.raw.scenes !== undefined
        ? state.raw.scenes : (c && c.scenes)
    );
    state.contacts = normalizeContacts(state.raw.contacts, c, state.characters);
    state.personScenes = normalizePersonScenes(state.raw.personScenes);
    state.closed = state.closedOverride !== null ? state.closedOverride : detectClosed(c);
    state.sceneId = pickSceneId(c);
  }

  function pickSceneId(c) {
    var known = state.scenes.some(function (s) { return s.id === state.sceneId; });
    if (state.sceneId && (known || !state.scenes.length)) { return state.sceneId; }
    var current = state.scenes.filter(function (s) { return s.current; })[0];
    if (current) { return current.id; }
    var fromCase = txt(c && c.sceneId);
    if (fromCase) { return fromCase; }
    return state.sceneId || "";
  }

  // ---------------------------------------------------------------- 渲染
  function emptyBlock(parent, title) {
    var box = el("div", "tp-empty");
    box.appendChild(el("b", "", title));
    parent.appendChild(box);
    return box;
  }

  function card(title) {
    var box = el("section", "tp-card");
    if (title) { box.appendChild(el("h3", "tp-card-h", title)); }
    return box;
  }

  function kv(k, v) {
    var row = el("div", "tp-kv");
    row.appendChild(el("span", "k", k));
    row.appendChild(el("span", "v", v));
    return row;
  }

  function renderHome() {
    var c = state.caseData || {};
    var meta = c.meta || {};
    var title = txt(c.title);
    var gotCount = state.evidence.filter(function (e) { return e.got; }).length;

    var widget = shell.querySelector(".tp-widget");
    if (widget) {
      var alarm = c.alarm || {};
      widget.classList.toggle("is-empty", !title);
      slots["widget-k"].textContent = title ? "在办" : "未加载";
      slots["widget-t"].textContent = title || "还没有加载案子";
      slots["widget-m"].textContent = title
        ? [txt(alarm.time), txt(meta.brief || meta.subtitle)].filter(Boolean).join("  ")
        : "";
    }

    var counts = {
      evidence: gotCount,
      notes: state.notes.length,
      laws: state.laws.length,
      map: state.scenes.length,
      contact: state.contacts.length
    };
    Object.keys(counts).forEach(function (key) {
      var badge = shell.querySelector('[data-app="' + key + '"] .tp-app-count');
      if (!badge) { return; }
      var n = counts[key];
      badge.textContent = n > 99 ? "99+" : String(n);
      badge.hidden = !n;
    });

    // 九个入口一进游戏就全开：评价复盘不再挂锁，结案只是「出评价」的触发。
    var review = shell.querySelector('[data-app="review"]');
    if (review) {
      review.classList.remove("is-locked");
      review.removeAttribute("aria-disabled");
      review.setAttribute("title", "看评价与复盘");
    }
    updateClock();
  }

  function caseSwitcher() {
    var current = state.caseList.filter(function (it) { return it.current; })[0];
    var nowId = current ? current.id : (state.caseData ? txt(state.caseData.id) : "");
    var box = card("全部案件");
    var list = el("div", "tp-cases");
    state.caseList.forEach(function (item) {
      var now = item.id === nowId;
      var row = document.createElement(now ? "div" : "button");
      row.className = "tp-case-row" + (now ? " is-current" : "");
      if (now) {
        row.setAttribute("aria-current", "true");
      } else {
        row.type = "button";
        row.setAttribute("aria-label", "切换到 " + item.name);
        row.addEventListener("click", function () {
          emit("case:switch", { id: item.id });
          toast("切换到「" + item.name + "」");
        });
      }
      var main = el("span", "tp-case-main");
      main.appendChild(el("span", "tp-case-n", item.name));
      var sub = [item.title, item.subtitle].filter(Boolean).join(" · ");
      if (sub) { main.appendChild(el("span", "tp-case-t", sub)); }
      row.appendChild(main);
      if (now) { row.appendChild(el("span", "tp-case-tag", "在办")); }
      list.appendChild(row);
    });
    box.appendChild(list);
    return box;
  }

  // 案件档案 · 当事人下面那行「人在哪张图」。
  // >3 处时截成前 3 个 + 等 N 处，整行可点展开；只有 1 处就只写一个。
  var missingSceneWarned = Object.create(null);

  function partySceneLine(ch) {
    var list = state.personScenes[ch.id] || [];
    var line = document.createElement(list.length > 3 ? "button" : "div");
    line.className = "tp-party-scene";
    if (list.length > 3) { line.type = "button"; }
    line.setAttribute("data-party", ch.id);
    line.setAttribute("data-scenes", list.map(function (it) { return it.scene; }).join(","));

    if (!list.length) {
      line.textContent = "📍 暂未安排";
      line.classList.add("is-missing");
      var key = ((state.caseData && state.caseData.id) || "case") + "/" + ch.id;
      if (!missingSceneWarned[key]) {
        missingSceneWarned[key] = 1;
        console.warn("[phone] 案件档案：「" + ch.name + "」(" + ch.id + ") 没有可对话场景，"
          + "显示「暂未安排」（检查 src/web/person_scenes.json 或重跑 tools/gen_person_scenes.py）");
      }
      return line;
    }

    var names = list.map(function (it) { return it.name; }).filter(Boolean);
    var full = names.join(" · ");
    var head = names.slice(0, 3).join(" · ");
    var paint = function (open) {
      clear(line);
      line.appendChild(document.createTextNode("📍 " + (open ? full : head)));
      if (list.length <= 3) { return; }
      var rest = list.length - 3;
      line.appendChild(document.createTextNode(" "));
      line.appendChild(el("span", "tp-party-scene-more", open ? "收起" : "等 " + rest + " 处"));
      line.setAttribute("data-more", open ? "0" : String(rest));
      line.setAttribute("data-expanded", open ? "true" : "false");
      line.setAttribute("aria-expanded", open ? "true" : "false");
      line.setAttribute("title", open ? "收起地图标注" : "展开全部 " + list.length + " 处");
    };
    paint(false);
    if (list.length > 3) {
      line.addEventListener("click", function () {
        paint(line.getAttribute("data-expanded") !== "true");
      });
    }
    return line;
  }

  function renderCase() {
    var body = slots["body-case"];
    clear(body);
    var c = state.caseData;
    slots["sub-case"].textContent = state.caseList.length > 1
      ? state.caseList.length + " 个案"
      : (c ? (state.closed ? "已结案" : "办理中") : "");
    if (state.caseList.length > 1) { body.appendChild(caseSwitcher()); }
    if (!c) {
      emptyBlock(body, "还没有案件信息");
      return;
    }
    var meta = c.meta || {};

    var head = card("案件");
    head.appendChild(el("p", "tp-p tp-strong", txt(c.title) || "未命名案件"));
    if (meta.subtitle) { head.appendChild(el("p", "tp-p tp-muted", txt(meta.subtitle))); }
    if (meta.brief) { head.appendChild(el("p", "tp-p", txt(meta.brief))); }
    var chips = el("div", "tp-chips");
    [meta.difficulty, meta.playtime, c.id].forEach(function (v, i) {
      var value = txt(v);
      if (value) { chips.appendChild(el("span", "tp-chip" + (i ? " alt" : ""), value)); }
    });
    if (chips.childNodes.length) { head.appendChild(chips); }
    body.appendChild(head);

    var alarm = c.alarm || {};
    var acc = card("受理情况");
    if (alarm.time) { acc.appendChild(kv("接报", txt(alarm.time))); }
    if (alarm.source) { acc.appendChild(kv("来源", txt(alarm.source))); }
    acc.appendChild(kv("状态", state.closed ? "已结案" : "办理中"));
    if (alarm.text) { acc.appendChild(el("p", "tp-p tp-muted", txt(alarm.text))); }
    body.appendChild(acc);

    var parties = card("当事人");
    if (!state.characters.length) {
      parties.appendChild(el("p", "tp-p tp-muted", "还没有人物信息。"));
    } else {
      state.characters.forEach(function (ch) {
        var wrap = el("div", "tp-party");
        wrap.setAttribute("data-party", ch.id);
        var row = el("div", "tp-kv");
        row.appendChild(el("span", "k", ch.name));
        row.appendChild(el("span", "v", [ch.role, ch.job, ch.age ? ch.age + " 岁" : ""]
          .filter(Boolean).join(" · ")));
        wrap.appendChild(row);
        wrap.appendChild(partySceneLine(ch));
        parties.appendChild(wrap);
      });
    }
    body.appendChild(parties);

    var focuses = card("争议焦点");
    var dims = asArray(c.dimensions);
    if (!dims.length) {
      focuses.appendChild(el("p", "tp-p tp-muted", "还没有梳理争议焦点。"));
    } else {
      var dimChips = el("div", "tp-chips");
      dims.forEach(function (d) {
        var name = txt(d && typeof d === "object" ? (d.name || d.title) : d);
        if (name) { dimChips.appendChild(el("span", "tp-chip", name)); }
      });
      focuses.appendChild(dimChips);
    }
    body.appendChild(focuses);

    var needs = asArray(c.needs).map(function (n) {
      return txt(n && typeof n === "object" ? (n.text || n.label) : n);
    }).filter(Boolean);
    if (needs.length) {
      var needCard = card("各方诉求");
      needs.forEach(function (n, i) {
        needCard.appendChild(el("p", "tp-p", (i + 1) + ". " + n));
      });
      body.appendChild(needCard);
    }
  }

  function renderPeople() {
    var body = slots["body-people"];
    clear(body);
    slots["sub-people"].textContent = state.characters.length ? state.characters.length + " 人" : "";
    if (!state.characters.length) {
      emptyBlock(body, "还没有人物信息");
      return;
    }

    var links = [];
    state.characters.forEach(function (ch) {
      ch.links.forEach(function (to) {
        if (state.characters.some(function (x) { return x.id === to; })) {
          links.push({ from: ch.id, to: to });
        }
      });
    });

    if (state.characters.length > 1) {
      body.appendChild(relationMap(links));
    }

    state.characters.forEach(function (ch) { body.appendChild(personRow(ch)); });
  }

  function relationMap(links) {
    var box = el("div", "tp-relmap");
    var W = 268;
    var H = 136;
    var list = state.characters;
    var cx = W / 2;
    var cy = H / 2 - 5;
    var radius = Math.min(W, H) / 2 - 27;
    var pos = {};
    list.forEach(function (ch, i) {
      var a = -Math.PI / 2 + (i / Math.max(1, list.length)) * Math.PI * 2;
      pos[ch.id] = { x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius };
    });
    function round(n) { return Math.round(n * 10) / 10; }

    var lines = links.map(function (link) {
      var a = pos[link.from];
      var b = pos[link.to];
      if (!a || !b) { return ""; }
      return '<line x1="' + round(a.x) + '" y1="' + round(a.y) +
        '" x2="' + round(b.x) + '" y2="' + round(b.y) + '" />';
    }).join("");

    var nodes = list.map(function (ch) {
      var p = pos[ch.id];
      var shortName = ch.name.length > 4 ? ch.name.slice(0, 4) + "…" : ch.name;
      return '<circle cx="' + round(p.x) + '" cy="' + round(p.y) + '" r="15" />' +
        '<text x="' + round(p.x) + '" y="' + round(p.y + 0.5) + '">' + esc(ch.name.slice(0, 1)) + "</text>" +
        '<text class="lbl" x="' + round(p.x) + '" y="' + round(p.y + 26) + '">' + esc(shortName) + "</text>";
    }).join("");

    box.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" aria-hidden="true">' +
      '<g class="lines">' + lines + "</g>" +
      '<g class="nodes">' + nodes + "</g>" +
      "</svg>";
    return box;
  }

  function personRow(ch) {
    var wrap = el("div", "tp-person-wrap");
    var btn = el("button", "tp-person");
    btn.type = "button";
    btn.setAttribute("aria-expanded", "false");

    btn.appendChild(el("span", "tp-ava", ch.name.slice(0, 1)));
    var main = el("span", "tp-person-main");
    main.appendChild(el("span", "tp-person-n", ch.name));
    var sub = [ch.role, ch.job].filter(Boolean).join(" · ");
    if (sub) { main.appendChild(el("span", "tp-person-r", sub)); }
    btn.appendChild(main);
    btn.appendChild(el("span", "tp-person-caret", "▾"));

    var detail = el("div", "tp-person-d");
    var bits = [];
    if (ch.age) { bits.push("年龄 " + ch.age); }
    if (ch.needs.length) { bits.push("诉求：" + ch.needs.join("；")); }
    if (ch.note) { bits.push(ch.note); }
    detail.textContent = bits.length ? bits.join("\n") : "简介还没填。";
    detail.hidden = true;

    btn.addEventListener("click", function () {
      var openNow = detail.hidden;
      detail.hidden = !openNow;
      btn.classList.toggle("is-open", openNow);
      btn.setAttribute("aria-expanded", openNow ? "true" : "false");
    });

    wrap.appendChild(btn);
    wrap.appendChild(detail);
    return wrap;
  }

  function renderEvidence() {
    var body = slots["body-evidence"];
    clear(body);
    var all = state.evidence;
    var got = all.filter(function (e) { return e.got; }).length;
    slots["sub-evidence"].textContent = all.length ? "已掌握 " + got + " / " + all.length : "";
    if (!all.length) {
      emptyBlock(body, "还没有证据");
      return;
    }
    var grid = el("div", "tp-evi-grid");
    all.forEach(function (ev, i) {
      var box = el("div", "tp-evi" + (ev.got ? "" : " is-missing"));
      box.appendChild(el("div", "tp-evi-t", ev.got ? ev.title : "未收集"));
      if (ev.got) {
        if (ev.text) { box.appendChild(el("div", "tp-evi-x", ev.text)); }
        var meta = [ev.weight !== null ? "权重 " + ev.weight : "", ev.spot].filter(Boolean).join(" · ");
        if (meta) { box.appendChild(el("div", "tp-evi-m", meta)); }
      } else {
        box.appendChild(el("div", "tp-evi-q", "?"));
      }
      grid.appendChild(box);
    });
    body.appendChild(grid);
  }

  function renderNotes() {
    var body = slots["body-notes"];
    var keep = "";
    var oldInput = body.querySelector(".tp-note-input");
    if (oldInput) { keep = oldInput.value; }
    clear(body);

    slots["sub-notes"].textContent = state.notes.length ? state.notes.length + " 条" : "";

    var editor = el("div", "tp-note-editor");
    var input = el("textarea", "tp-note-input");
    input.rows = 3;
    input.maxLength = 300;
    input.placeholder = "写一条笔记";
    input.value = keep;
    var actions = el("div", "tp-note-actions");
    var save = el("button", "tp-btn primary", "存下");
    save.type = "button";
    actions.appendChild(save);
    editor.appendChild(input);
    editor.appendChild(actions);
    body.appendChild(editor);

    save.addEventListener("click", function () {
      var value = input.value.trim();
      if (!value) { toast("还没写东西"); input.focus(); return; }
      input.value = "";      // 先清空再存：renderNotes 会把输入框里的字原样留在新节点上
      addNote(value);
      toast("已记下");
    });
    input.addEventListener("keydown", function (ev) {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") { save.click(); }
    });

    if (!state.notes.length) {
      emptyBlock(body, "还没有笔记");
    } else {
      state.notes.slice().reverse().forEach(function (note) {
        var row = el("div", "tp-note");
        row.appendChild(el("div", "tp-note-t", note.text));
        var del = el("button", "tp-note-del", "×");
        del.type = "button";
        del.setAttribute("aria-label", "删除这条笔记");
        del.addEventListener("click", function () {
          removeNote(note.id);
          toast("已删除");
        });
        row.appendChild(del);
        body.appendChild(row);
      });
    }
  }

  function renderLaws() {
    var body = slots["body-laws"];
    clear(body);
    slots["sub-laws"].textContent = state.laws.length ? state.laws.length + " 条" : "";
    if (!state.laws.length) {
      emptyBlock(body, "还没有可引用的条文");
      return;
    }
    state.laws.forEach(function (law) {
      var box = el("div", "tp-law");
      var head = el("div", "tp-law-h");
      var name = [law.law, law.article].filter(Boolean).join(" · ");
      head.appendChild(el("b", "", name || "条文"));
      if (law.title) { head.appendChild(el("span", "", law.title)); }
      box.appendChild(head);
      if (law.gist) { box.appendChild(el("p", "tp-law-g", law.gist)); }
      if (law.tags.length) {
        var chips = el("div", "tp-chips");
        law.tags.slice(0, 5).forEach(function (tag) {
          chips.appendChild(el("span", "tp-chip alt", tag));
        });
        box.appendChild(chips);
      }
      body.appendChild(box);
    });
  }

  function renderMap() {
    var body = slots["body-map"];
    clear(body);
    var here = state.scenes.filter(function (s) { return s.id === state.sceneId; })[0];
    slots["sub-map"].textContent = state.scenes.length
      ? state.scenes.length + " 处" + (here ? " · 当前 " + here.name : "")
      : "";
    if (!state.scenes.length) {
      emptyBlock(body, "还没有地图");
      return;
    }

    state.scenes.forEach(function (scene) {
      var isHere = scene.id === state.sceneId;
      var row = document.createElement(isHere ? "div" : "button");
      row.className = "tp-scene" +
        (isHere ? " is-here" : "") +
        (!isHere && !scene.visited ? " is-unvisited" : "");
      if (isHere) {
        row.setAttribute("aria-current", "true");
      } else {
        row.type = "button";
        row.setAttribute("aria-label", "传送到 " + scene.name);
        row.addEventListener("click", function () {
          toast("去「" + scene.name + "」");
          emit("teleport", { sceneId: scene.id });
          close();
        });
      }

      var dot = el("span", "tp-scene-dot");
      dot.setAttribute("aria-hidden", "true");
      var main = el("span", "tp-scene-main");
      main.appendChild(el("span", "tp-scene-n", scene.name));
      var meta = [
        scene.setting,
        scene.spots ? scene.spots + " 个点位" : "",
        isHere ? "" : (scene.visited ? "去过" : "还没去过")
      ].filter(Boolean).join(" · ");
      main.appendChild(el("span", "tp-scene-m", meta));
      row.appendChild(dot);
      row.appendChild(main);
      if (isHere) { row.appendChild(el("span", "tp-scene-tag", "当前")); }
      body.appendChild(row);
    });
  }

  function renderContact() {
    var body = slots["body-contact"];
    clear(body);
    slots["sub-contact"].textContent = state.contacts.length ? state.contacts.length + " 人" : "";
    if (!state.contacts.length) {
      emptyBlock(body, "还没有可以打的人");
      return;
    }
    state.contacts.forEach(function (contact) {
      // 整行就是一个拨号键：点姓名 / 头像 / 「拨打」都立刻弹通话框。
      // 以前只有行尾那个 43×24 的小按钮带 click，点到行上没有任何反应 —— 用户看到的就是"点了没弹"。
      var row = el("button", "tp-call");
      row.type = "button";
      row.setAttribute("data-call", contact.id || "");
      row.setAttribute("aria-label", "拨打给 " + (contact.name || "联系人"));
      row.appendChild(el("span", "tp-ava", contact.name.slice(0, 1)));
      var main = el("div", "tp-call-main");
      main.appendChild(el("div", "tp-call-n", contact.name));
      if (contact.tag) { main.appendChild(el("div", "tp-call-t", contact.tag)); }
      if (contact.note) { main.appendChild(el("div", "tp-call-d", contact.note)); }
      row.appendChild(main);

      // 视觉提示，不再单独吃点击（pointer-events:none 在 CSS 里）
      var dial = el("span", "tp-btn primary", "拨打");
      dial.setAttribute("aria-hidden", "true");
      row.appendChild(dial);
      row.addEventListener("click", function () { callContact(contact); });
      body.appendChild(row);
    });
  }

  function callContact(contact) {
    if (!contact) { return; }
    // 2026-11：通话改成直接打开"问话面板"（和地图上点人完全同一套，能自由说话、
    // 引用笔记/法条），不再只弹一张状态卡。手机壳由外壳先收起（z-index 9000 会盖住
    // z-index 72 的面板）。openCall / .tp-call-dialog 保留给以后的来电/等待接通。
    emit("call", { id: contact.id, name: contact.name || "" });
  }

  function renderLearn() {
    var body = slots["body-learn"];
    clear(body);
    var tabs = el("div", "tp-tabs");
    tabs.setAttribute("role", "tablist");
    [{ key: "ops", label: "操作", count: OPS.length }, { key: "knowledge", label: "知识", count: KNOWLEDGE.length }]
      .forEach(function (tab) {
        var btn = el("button", "tp-tab" + (state.tab === tab.key ? " is-on" : ""),
          tab.label + " " + tab.count);
        btn.type = "button";
        btn.setAttribute("role", "tab");
        btn.setAttribute("aria-selected", state.tab === tab.key ? "true" : "false");
        btn.addEventListener("click", function () {
          if (state.tab === tab.key) { return; }
          state.tab = tab.key;
          renderLearn();
        });
        tabs.appendChild(btn);
      });
    body.appendChild(tabs);

    if (state.tab === "ops") {
      slots["sub-learn"].textContent = OPS.length + " 条";
      OPS.forEach(function (op) {
        var row = el("div", "tp-op");
        row.appendChild(el("span", "tp-op-no", String(op.no)));
        var main = el("div", "tp-op-main");
        main.appendChild(el("div", "tp-op-t", op.title));
        op.lines.forEach(function (line) { main.appendChild(el("div", "tp-op-l", line)); });
        row.appendChild(main);
        body.appendChild(row);
      });
    } else {
      slots["sub-learn"].textContent = KNOWLEDGE.length + " 张";
      KNOWLEDGE.forEach(function (k) {
        var box = el("div", "tp-kcard");
        box.appendChild(el("div", "tp-kcard-t", k.title));
        k.lines.forEach(function (line) { box.appendChild(el("div", "tp-kcard-l", line)); });
        box.appendChild(el("div", "tp-kcard-c", "出处：" + k.cite));
        body.appendChild(box);
      });
    }
  }

  function renderReview() {
    var body = slots["body-review"];
    clear(body);

    slots["sub-review"].textContent = state.closed
      ? (reviewScore ? "已评 · " + reviewScore.grade : "已结案")
      : "未结案";

    // 九个入口一进游戏就全开，这一页不再等结案才解锁。
    // 没结案时保留「结案并出评价」这个触发，不再写说明。
    if (!state.closed) {
      var notice = el("div", "tp-locked");
      var ico = el("div", "tp-locked-ico");
      ico.innerHTML = svgWrap("review");
      notice.appendChild(ico);
      notice.appendChild(el("div", "tp-locked-t", "还没结案"));
      // 结案前写方案：文本框直接放在按钮上方；内容会拆成 claims 交给外壳评分。
      var planBox = el("div", "tp-plan");
      planBox.appendChild(el("div", "tp-plan-t", "你的调解方案（可选）"));
      var planInput = el("textarea", "tp-note-input tp-plan-input");
      planInput.setAttribute("data-plan-input", "1");
      planInput.rows = 5;
      planInput.placeholder = "写下你的调解方案：谁做什么、多久做完、做不到怎么办";
      var planCaseId = txt(state.caseData && state.caseData.id);
      planInput.value = loadPlanDraft(planCaseId);
      planInput.addEventListener("input", function () {
        savePlanDraft(planCaseId, planInput.value);
      });
      planBox.appendChild(planInput);
      notice.appendChild(planBox);
      var end = el("button", "tp-btn primary", "结案并出评价");
      end.type = "button";
      end.setAttribute("data-end", "1");
      end.addEventListener("click", function () {
        savePlanDraft(planCaseId, planInput.value);
        emit("close-case", { plan: { claims: planClaimsFromText(planInput.value) } });
        toast("已结案");
      });
      notice.appendChild(end);
      var home = el("button", "tp-btn", "回到桌面");
      home.type = "button";
      home.addEventListener("click", function () { showPage("home"); });
      notice.appendChild(home);
      body.appendChild(notice);
    }

    var sc = reviewScore && reviewScore.scores ? reviewScore : null;
    var grid = el("div", "tp-score");
    [["了解度", "understanding", 40], ["合法合规", "legality", 35],
     ["可执行性", "executability", 25]].forEach(function (pair) {
      var cell = el("div", "tp-score-i");
      cell.appendChild(el("div", "tp-score-n", sc ? String(sc.scores[pair[1]]) : "—"));
      cell.appendChild(el("div", "tp-score-l", pair[0] + " / " + pair[2]));
      grid.appendChild(cell);
    });
    body.appendChild(grid);

    var stampRow = el("div", "tp-stamp-row");
    stampRow.appendChild(el("div", "tp-seal", sc ? sc.grade : "待评"));
    if (sc) {
      stampRow.appendChild(el("p", "tp-p tp-muted",
        "总分 " + sc.total + " / 100 · " + sc.gradeLabel));
    }
    body.appendChild(stampRow);

    if (state.closed) {
      var replay = el("button", "tp-btn primary", "生成评价卡");
      replay.type = "button";
      replay.setAttribute("data-review", "1");
      replay.addEventListener("click", function () {
        emit("review", {});
      });
      body.appendChild(replay);
    }
  }

  var RENDERERS = {
    home: renderHome,
    case: renderCase,
    people: renderPeople,
    evidence: renderEvidence,
    notes: renderNotes,
    laws: renderLaws,
    map: renderMap,
    contact: renderContact,
    learn: renderLearn,
    review: renderReview
  };

  function renderPage(key) {
    (RENDERERS[key] || renderHome)();
  }

  function showPage(key) {
    if (!Object.prototype.hasOwnProperty.call(RENDERERS, key)) { key = "home"; }
    state.page = key;
    hideToast();
    pageEls.forEach(function (page) {
      page.hidden = page.getAttribute("data-page") !== key;
    });
    renderPage(key);
    var scroller = shell.querySelector('[data-page="' + key + '"] .tp-body, [data-page="' + key + '"] .tp-home');
    if (scroller) { scroller.scrollTop = 0; }
  }

  function refresh() {
    renderHome();
    renderPage(state.page);
  }

  // ---------------------------------------------------------------- 交互
  function toast(message) {
    if (!message || !slots.toast) { return; }
    slots.toast.textContent = message;
    slots.toast.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      slots.toast.classList.remove("is-on");
    }, 1600);
  }

  function hideToast() {
    if (!slots.toast) { return; }
    clearTimeout(toastTimer);
    slots.toast.classList.remove("is-on");
  }

  function emit(type, payload) {
    if (!onAction) { return; }
    try {
      onAction(type, payload);
    } catch (err) {
      console.error("[phone] onAction(" + type + ") 抛错：", err);
    }
  }

  // ---------------------------------------------------------------- 通话对话框
  function two(n) { return (n < 10 ? "0" : "") + n; }

  function hangUp(silent) {
    clearInterval(callTimer);
    callTimer = 0;
    if (!slots["call-dialog"]) { return; }
    var wasOpen = callOpen;
    callOpen = false;
    slots["call-dialog"].classList.remove("is-on");
    slots["call-dialog"].hidden = true;
    slots["call-dialog"].setAttribute("aria-hidden", "true");
    // 挂断后回到打电话之前那一页，焦点还给刚点的联系人整行：键盘和读屏不会掉到页面顶上。
    if (wasOpen && state.open && callReturnFocus && typeof callReturnFocus.focus === "function") {
      try { callReturnFocus.focus({ preventScroll: true }); } catch (err) { callReturnFocus.focus(); }
    }
    callReturnFocus = null;
    if (!silent) { toast("已挂断"); }
  }

  function openCall(contact) {
    if (!contact || !slots["call-dialog"]) { return; }
    hangUp(true);
    callReturnFocus = document.activeElement;
    slots["call-ava"].textContent = String(contact.name || "?").slice(0, 1);
    slots["call-name"].textContent = contact.name || "";
    slots["call-tag"].textContent = contact.tag || "";
    slots["call-state"].textContent = "通话中 00:00";
    slots["call-dialog"].hidden = false;
    slots["call-dialog"].setAttribute("aria-hidden", "false");
    callOpen = true;
    requestAnimationFrame(function () {
      if (!slots["call-dialog"].hidden) { slots["call-dialog"].classList.add("is-on"); }
    });
    // 焦点直接落在「挂断」：面板是模态层，Tab 不该先跑到背后的联系人或页面按钮上。
    var hang = slots["call-hang"];
    if (hang) {
      try { hang.focus({ preventScroll: true }); } catch (err) { hang.focus(); }
    }
    callStartedAt = Date.now();
    callTimer = setInterval(function () {
      var s = Math.max(0, Math.floor((Date.now() - callStartedAt) / 1000));
      slots["call-state"].textContent = "通话中 " + two(Math.floor(s / 60)) + ":" + two(s % 60);
    }, 1000);
  }

  function updateClock() {
    if (!slots.clock) { return; }
    var d = new Date();
    var hh = d.getHours();
    var mm = d.getMinutes();
    var text = (hh < 10 ? "0" : "") + hh + ":" + (mm < 10 ? "0" : "") + mm;
    slots.clock.textContent = text;
    if (slots["home-clock"]) { slots["home-clock"].textContent = text; }
  }

  function onShellClick(ev) {
    var target = ev.target;
    if (!target || typeof target.closest !== "function") { return; }
    var back = target.closest("[data-back]");
    if (back) { showPage("home"); return; }
    var closer = target.closest("[data-close]");
    if (closer) { close(); return; }
    var jump = target.closest("[data-jump]");
    if (jump) { showPage(jump.getAttribute("data-jump")); return; }
    var app = target.closest("[data-app]");
    if (!app) { return; }
    var key = app.getAttribute("data-app");
    if (!PAGE_MAP[key]) { return; }
    // 九个入口全部开放：没有 needsClosed 之类的门，点哪个进哪个。
    showPage(key);
  }

  function open(page) {
    if (state.open) {
      if (page) { showPage(page); }
      return;
    }
    lastFocus = document.activeElement;
    state.open = true;
    root.classList.add("is-open");
    root.setAttribute("data-open", "true");
    shell.setAttribute("aria-hidden", "false");
    launch.setAttribute("aria-expanded", "true");
    launch.setAttribute("aria-label", "收起手机");
    launch.setAttribute("title", "收起手机");
    if (page) { showPage(page); } else { refresh(); }
    updateClock();
    focusInto();
    if (onOpen) {
      try { onOpen(); } catch (err) { console.error("[phone] onOpen 抛错：", err); }
    }
  }

  function close() {
    if (!state.open) { return; }
    state.open = false;
    hangUp(true);
    hideToast();
    root.classList.remove("is-open");
    root.setAttribute("data-open", "false");
    shell.setAttribute("aria-hidden", "true");
    launch.setAttribute("aria-expanded", "false");
    launch.setAttribute("aria-label", "打开手机");
    launch.setAttribute("title", "手机");
    if (lastFocus && typeof lastFocus.focus === "function" && lastFocus !== document.body) {
      try { lastFocus.focus({ preventScroll: true }); } catch (err) { /* 老浏览器不认参数 */ }
    }
    if (onClose) {
      try { onClose(); } catch (err) { console.error("[phone] onClose 抛错：", err); }
    }
  }

  function toggle() { if (state.open) { close(); } else { open(); } }

  function onKeydown(ev) {
    if (!state.open) { return; }
    if (ev.key === "Escape") {
      ev.stopPropagation();
      if (slots["call-dialog"] && !slots["call-dialog"].hidden) { hangUp(); return; }
      close();
      return;
    }
    if (ev.key === "Tab") { trapTab(ev); }
  }

  // 手机是模态层：Tab 不许跑到后面的场景里去
  function focusables() {
    var nodes = shell.querySelectorAll(
      'button, textarea, input, select, a[href], [tabindex]:not([tabindex="-1"])'
    );
    return Array.prototype.filter.call(nodes, function (node) {
      if (node.disabled || node.hidden) { return false; }
      if (node.closest("[hidden]")) { return false; }
      return node.offsetParent !== null;
    });
  }

  function trapTab(ev) {
    var list = focusables();
    if (!list.length) { return; }
    var first = list[0];
    var last = list[list.length - 1];
    var active = document.activeElement;
    if (!shell.contains(active)) {
      ev.preventDefault();
      first.focus();
      return;
    }
    if (ev.shiftKey && active === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && active === last) {
      ev.preventDefault();
      first.focus();
    }
  }

  function focusInto() {
    var scope = shell.querySelector('[data-page="' + state.page + '"]');
    if (!scope) { return; }
    var target = scope.querySelector(".tp-app, .tp-back, .tp-tab, .tp-btn");
    if (!target) { return; }
    try { target.focus({ preventScroll: true }); } catch (err) { target.focus(); }
  }

  launch.addEventListener("click", function (ev) {
    ev.preventDefault();
    ev.stopPropagation();
    toggle();
  });
  backdrop.addEventListener("click", function () { close(); });
  shell.addEventListener("click", onShellClick);
  var callHang = shell.querySelector("[data-call-hang]");
  if (callHang) { callHang.addEventListener("click", function () { hangUp(); }); }
  document.addEventListener("keydown", onKeydown);
  clockTimer = setInterval(updateClock, 30000);
  updateClock();

  // ---------------------------------------------------------------- 笔记
  function addNote(text) {
    var value = txt(text);
    if (!value) { return null; }
    var note = { id: "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text: value, t: Date.now() };
    state.notes.push(note);
    saveNotes(state.notes);
    renderHome();
    if (state.page === "notes") { renderNotes(); }
    emit("note:add", { note: note });
    return note;
  }

  function removeNote(id) {
    var before = state.notes.length;
    state.notes = state.notes.filter(function (n) { return n.id !== id; });
    if (before === state.notes.length) { return; }
    saveNotes(state.notes);
    renderHome();
    if (state.page === "notes") { renderNotes(); }
    emit("note:remove", { id: id });
  }

  // ---------------------------------------------------------------- 对外 API
  var api = {
    el: root,
    open: open,
    close: close,
    toggle: toggle,
    isOpen: function () { return state.open; },
    get page() { return state.page; },
    openPage: function (key) {
      if (!state.open) { open(key); } else { showPage(key); }
    },
    setData: function (patch) {
      if (!patch || typeof patch !== "object") { return api; }
      var has = function (key) { return Object.prototype.hasOwnProperty.call(patch, key); };
      if (has("case")) {
        var prev = state.raw.caseData;
        var next = patch.case || null;
        // 换案子：上一件的评分不能贴到新案上
        if (prev && next && txt(prev.id) !== txt(next.id)) { reviewScore = null; }
        state.raw.caseData = next;
      }
      if (has("cases")) { state.raw.cases = patch.cases == null ? null : patch.cases; }
      if (has("evidence")) { state.raw.evidence = patch.evidence == null ? null : patch.evidence; }
      if (has("characters")) { state.raw.characters = patch.characters == null ? null : patch.characters; }
      if (has("laws")) { state.raw.laws = patch.laws == null ? null : patch.laws; }
      if (has("scenes")) { state.raw.scenes = patch.scenes == null ? null : patch.scenes; }
      if (has("personScenes")) {
        state.raw.personScenes = patch.personScenes == null ? null : patch.personScenes;
      }
      if (has("contacts")) { state.raw.contacts = patch.contacts == null ? null : patch.contacts; }
      if (has("sceneId")) { state.sceneId = txt(patch.sceneId); }
      if (has("closed")) { state.closedOverride = patch.closed == null ? null : !!patch.closed; }
      rebuild();
      refresh();
      return api;
    },
    setScene: function (sceneId) {
      state.sceneId = txt(sceneId);
      renderHome();
      if (state.page === "map") { renderMap(); }
      return api;
    },
    setClosed: function (closed) {
      state.closedOverride = !!closed;
      rebuild();
      refresh();
      return api;
    },
    // 结案后的评价结果回填（外壳算完再送进来）；传 null 清空
    setReviewScore: function (score) {
      reviewScore = score && typeof score === "object" ? score : null;
      if (state.page === "review") { renderReview(); }
      return api;
    },
    getSceneId: function () { return state.sceneId; },
    isClosed: function () { return state.closed; },
    addNote: addNote,
    removeNote: removeNote,
    getNotes: function () { return state.notes.slice(); },
    refresh: refresh,
    destroy: function () {
      if (destroyed) { return; }
      destroyed = true;
      document.removeEventListener("keydown", onKeydown);
      clearInterval(clockTimer);
      clearInterval(callTimer);
      clearTimeout(toastTimer);
      if (root.parentNode) { root.parentNode.removeChild(root); }
      instances -= 1;
      if (instances <= 0) { removeStyle(); }
    }
  };

  rebuild();
  renderHome();
  return api;
}

// ---------------------------------------------------------------------------
// 骨架模板
// ---------------------------------------------------------------------------
function homeMarkup() {
  return [
    '<section class="tp-page tp-page-home" data-page="home" aria-label="桌面">',
    '  <div class="tp-home">',
    '    <div class="tp-home-clock" data-slot="home-clock">--:--</div>',
    '    <div class="tp-home-date" data-slot="home-date">调解台 · 执勤手机</div>',
    '    <button class="tp-widget" type="button" data-jump="case">',
    '      <span class="tp-widget-k" data-slot="widget-k">未加载</span>',
    '      <span class="tp-widget-t" data-slot="widget-t">还没有加载案子</span>',
    '      <span class="tp-widget-m" data-slot="widget-m">等 setData 把案子送进来</span>',
    "    </button>",
    '    <div class="tp-grid">',
    PAGE_LIST.map(tileMarkup).join("\n"),
    "    </div>",
    "  </div>",
    "</section>"
  ].join("\n");
}

function tileMarkup(def) {
  return [
    '<button class="tp-app tp-app--' + def.tone + '" type="button" data-app="' + def.key +
      '" aria-label="' + def.label + '">',
    '  <span class="tp-app-icon" aria-hidden="true">' + svgWrap(def.icon),
    '    <i class="tp-app-count" hidden></i>',
    "  </span>",
    '  <span class="tp-app-label">' + def.label + "</span>",
    "</button>"
  ].join("");
}

function pageMarkup(def) {
  return [
    '<section class="tp-page" data-page="' + def.key + '" aria-label="' + def.label + '" hidden>',
    '  <header class="tp-head">',
    '    <button class="tp-back" type="button" data-back="1" aria-label="返回桌面">‹ 桌面</button>',
    '    <h2 class="tp-title">' + def.label + "</h2>",
    '    <span class="tp-sub" data-slot="sub-' + def.key + '"></span>',
    "  </header>",
    '  <div class="tp-body" data-slot="body-' + def.key + '"></div>',
    "</section>"
  ].join("\n");
}

// ---------------------------------------------------------------------------
// 样式注入（多实例共用一份）
// ---------------------------------------------------------------------------
var instances = 0;
var styleCache = "";

function ensureStyle() {
  if (document.getElementById("tjphone-style")) { return; }
  if (!styleCache) { styleCache = buildCss(); }
  var style = document.createElement("style");
  style.id = "tjphone-style";
  style.textContent = styleCache;
  (document.head || document.documentElement).appendChild(style);
}

function removeStyle() {
  var style = document.getElementById("tjphone-style");
  if (style && style.parentNode) { style.parentNode.removeChild(style); }
}

function resolveMount(mount) {
  if (mount && typeof mount === "string") {
    var found = document.querySelector(mount);
    if (found) { return found; }
    console.warn("[phone] mount 选择器没找到：" + mount + "，改挂到 body。");
    return document.body;
  }
  if (mount && typeof mount.appendChild === "function") { return mount; }
  return document.body;
}

export default createPhone;
