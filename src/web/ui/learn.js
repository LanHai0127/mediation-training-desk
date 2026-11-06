// learn.js · 学习（手机里的两个 Tab：操作 / 知识）—— 最终形态提示词 §8
// -----------------------------------------------------------------------------
// 定位：手机九宫格里的第 8 格。**不出手机**，不铺满屏、不跳页，只在手机壳里滚。
//
// 两个 Tab：
//   操作（8 条）：每条 = 标题 + 两行说明 + 一个 3 秒 3D 演示位。
//                演示位现在只有占位按钮，点了把 key 交给 onPlayDemo(key)，
//                真正的 3 秒镜头由 3D 场景接管（复用真实场景，只换机位）。
//                接入方式：在 onPlayDemo 里按 key 拿 `slot[data-demo]` 这个空位，
//                把 canvas / 场景渲染到那块 96px 高的框里，别改这里的结构。
//   知识（12 张卡）：核心结论（≤20 字，粗体）+ 三行解释 + 一条法条出处。
//
// 约束（都是项目里的硬规矩）：
//   ① 配色只用 kit.js 的 PAL，不新增十六进制；需要半透明就按 PAL 现算 rgba。
//   ② 纯 DOM + CSS，不引框架、不读网络；法条内置在下面，不依赖 /api/laws。
//   ③ 字号只有三档：16（标题）/ 14（结论、Tab）/ 12（正文、法条、小字）。
//
// 用法：
//   const learn = createLearn({ mount: phoneBody, onPlayDemo: (key) => scene.demo(key) });
//   learn.show("know");     // 切到知识（切 Tab 会各自记住滚动位置）
//   learn.destroy();        // 从 DOM 上摘掉，顺带清掉演示计时器
//
// 注意：mount 必须是**有确定高度**的容器（手机页主体），否则滚动区撑不开。
// -----------------------------------------------------------------------------
import { PAL } from "../scenes/kit.js";

const STYLE_ID = "learn-style";

// 12 张卡的分组：只用 PAL 里已有的颜色，不另造色。
const TAG_COLOR = {
  程序: PAL.blue,
  方法: PAL.peach,
  实体: PAL.mint,
  协议: PAL.yellow,
  现场: PAL.sand,
  文书: PAL.coral
};

// ---------------------------------------------------------------- 操作：8 条
// 两行说明各自独立成行：第一行说"怎么操作"，第二行说"容易踩的坑"。
const OPS = [
  {
    key: "walk",
    title: "怎么走",
    lines: [
      "点地面，落点亮起光环，主角走过去。",
      "拖动转视角，滚轮或双指缩放。"
    ]
  },
  {
    key: "spot",
    title: "怎么点物件",
    lines: [
      "点有交互的家具，会描边发亮。",
      "走到两米二以内，不点也会自动触发。"
    ]
  },
  {
    key: "evidence",
    title: "怎么看证据",
    lines: [
      "证据夹里亮的是已找到，灰问号是没找到。",
      "要走到跟前看过，点开就跑开不算。"
    ]
  },
  {
    key: "ask",
    title: "怎么问人",
    lines: [
      "点人进对话，先问事实，再问诉求。",
      "同一句话问两遍，答得不一样就是缺口。"
    ]
  },
  {
    key: "phone",
    title: "怎么开手机",
    lines: [
      "点右上角手机图标，从右侧滑出。",
      "再点一次收起，功能都在手机里。"
    ]
  },
  {
    key: "teleport",
    title: "怎么传送",
    lines: [
      "地图里点没去过的地点，云散开就到了。",
      "不能传送到脚下这一处，点了会抖一下。"
    ]
  },
  {
    key: "plan",
    title: "怎么写方案",
    lines: [
      "一句话一个主张，先写结论再写依据。",
      "写清谁做什么、几天做完、做不到怎么办。"
    ]
  },
  {
    key: "submit",
    title: "怎么提交",
    lines: [
      "方案写完点提交，两秒内出评价卡。",
      "先看了解度，再看合规和可执行性。"
    ]
  }
];

// ---------------------------------------------------------------- 知识：12 张卡
// 每张卡的"核心结论"都压在 20 字以内，一句话能背下来；
// 法条出处全部对着现行文本核过条号（人民调解法 2010 年通过、2011-01-01 施行；
// 民法典 2021-01-01 施行）。不确定条号的一律只写"参见相关规定"，不硬编号。
const CARDS = [
  {
    tag: "程序",
    title: "调解受理范围",
    core: "民间纠纷能调，一方拒绝就不能调",
    lines: [
      "邻里、债务、赡养、损害赔偿这类民事纠纷，调委会都能受理；治安、刑事案件不能靠调解了事。",
      "一方明确拒绝，或者中途要求终止，就应当停下来，不能硬拉着调。",
      "法院、公安在受理前认为适宜调解的，可以告知当事人先来申请。"
    ],
    law: "《人民调解法》第十七条"
  },
  {
    tag: "程序",
    title: "回避",
    core: "跟一方沾亲带故，就该主动换人",
    lines: [
      "调解员与当事人有亲属、债务、恩怨关系的，先自己说明并退出，别等对方提出来。",
      "当事人有权选择或者接受调解员，也可以要求换人——把选择权交回给他们。",
      "不能偏袒一方，也不能收受财物；这两条踩了，谈成的协议也站不住。"
    ],
    law: "《人民调解法》第十五条"
  },
  {
    tag: "方法",
    title: "背靠背",
    core: "分开谈，是为了让人不丢面子",
    lines: [
      "当着对方，人很难改口；分开单独谈，他才肯说“我其实可以让一步”。",
      "分开谈时只转述诉求和底线，不转述对方原话、不添油加醋，否则两边都会恨你。",
      "谈拢了要再合起来当面确认一遍——背靠背只是过程，不是结果。"
    ],
    law: "《人民调解法》第二十二条"
  },
  {
    tag: "方法",
    title: "面对面",
    core: "当面谈，先把话说透再谈钱",
    lines: [
      "双方都愿意坐下来时，面对面能把误会当场戳破，比来回传话快得多。",
      "先让各自把事实和委屈讲完，讲完再谈方案；抢着说“你也有错”最容易谈崩。",
      "当面谈不拢就转背靠背，别硬撑着让两人越吵越僵。"
    ],
    law: "《人民调解法》第三条"
  },
  {
    tag: "实体",
    title: "相邻排水",
    core: "历史共用排水，一方不得擅自堵截",
    lines: [
      "这条沟是几十年前两家一起用出来的，属于历史形成的共用排水，不是谁家的私产。",
      "一方把沟堵上、把出水口改向，就是擅自堵截；邻居有权要求排除妨害、恢复原状。",
      "清通和修缮的费用按受益和过错分摊；确实要改道，得两家商量一致再动。"
    ],
    law: "《民法典》第二百九十条"
  },
  {
    tag: "实体",
    title: "宅基地边界",
    core: "边界看登记四至，不看老墙老界石",
    lines: [
      "先调宅基地使用权证和不动产登记簿，以登记的四至、面积为准；老墙、老界石只能当参考。",
      "证书记载和登记簿对不上，除有证据证明登记确有错误，以登记簿为准。",
      "争的是“这块地到底归谁”，那是土地权属争议，应告知找乡镇政府或自然资源部门处理。"
    ],
    law: "《民法典》第二百一十七条"
  },
  {
    tag: "协议",
    title: "口头协议效力",
    core: "口头协议也生效，但要当场记下来",
    lines: [
      "双方说不用写协议，口头达成的调解协议从达成那天起就生效，一样有法律约束力。",
      "口头协议最怕事后不认账，调解员必须当场把协议内容记进笔录，让双方签字按印。",
      "金额大、履行期长的，还是写书面协议，省得日后扯皮。"
    ],
    law: "《人民调解法》第三十条"
  },
  {
    tag: "协议",
    title: "履行与司法确认",
    core: "怕反悔，三十日内一起申请司法确认",
    lines: [
      "调解协议有法律约束力，但不是判决；一方不履行，还得靠法院那一步。",
      "双方认为有必要，可以自协议生效之日起三十日内共同向法院申请司法确认。",
      "确认有效后对方仍不履行，可以直接申请强制执行——这一步才是真正的保险。"
    ],
    law: "《人民调解法》第三十三条"
  },
  {
    tag: "现场",
    title: "证据固定",
    core: "当场记、当场签，别等事后补",
    lines: [
      "现场照片要拍到参照物（门牌、墙角、水沟走向），单拍一摊水说明不了位置。",
      "当事人的陈述当场记成笔录，念给他听，让他逐页签字按印。",
      "收货台账、缴费单据、聊天记录这些书证，能复印就复印，原件让当事人自己收好。"
    ],
    law: "《人民调解法》第二十四条"
  },
  {
    tag: "现场",
    title: "情绪降温",
    core: "先接住情绪，再谈事",
    lines: [
      "人正在气头上听不进法条，先让他把话说完；递杯水、换个坐的位置都比讲道理管用。",
      "把“你骂人”换成“你刚才那句话，他听着是什么感受”，把人拉回到事上。",
      "发现有可能激化、甚至可能闹成治安刑事案件的，及时报告派出所，别自己硬扛。"
    ],
    law: "《人民调解法》第二十一条"
  },
  {
    tag: "现场",
    title: "记录要点",
    core: "记事实、记分歧、记让步，不记评价",
    lines: [
      "时间、地点、在场人、各自说了什么、争的是哪一点，按顺序记，别写成作文。",
      "分歧点和各自的让步要单独记——这两样是后面写协议的直接素材。",
      "调解结束后，登记、笔录、协议书一起立卷归档，下次再来还是这本账。"
    ],
    law: "《人民调解法》第二十七条"
  },
  {
    tag: "文书",
    title: "结案文书",
    core: "谁、做什么、多久做完、做不到怎么办",
    lines: [
      "协议书写清当事人基本情况、纠纷事实和争议事项、各方责任，再写达成的内容。",
      "履行方式、期限必须具体到“几月几日前、由谁、把钱交到谁手上”。",
      "双方签名盖章按指印、调解员签名、加盖调委会印章，协议才生效；一式三份各执一份。"
    ],
    law: "《人民调解法》第二十九条"
  }
];

const DEMO_LABEL = "看 3 秒演示";
const DEMO_NOTE = "3 秒演示位 · 待接入";

// ---------------------------------------------------------------- 小工具
// PAL 只有 6 位十六进制，半透明按需现算，避免为了描边去新增颜色常量。
function rgba(hex, a) {
  let h = String(hex || "").replace("#", "");
  if (h.length === 3) { h = h.replace(/./g, (c) => c + c); }
  const n = parseInt(h, 16) || 0;
  return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) { n.className = cls; }
  if (text != null) { n.textContent = text; }
  return n;
}

// 样式只注入一次；用 PAL 现算，保证"改一个 PAL 全站跟着变"。
const CSS = `
.learn, .learn * { box-sizing: border-box; }

.learn {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  color: ${PAL.ink};
  font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, -apple-system, sans-serif;
  -webkit-tap-highlight-color: transparent;
  -webkit-font-smoothing: antialiased;
}

/* ---------------------------------------------------------------- Tab 条 */
.learn-tabs {
  flex: 0 0 auto;
  display: flex;
  gap: 4px;
  padding: 0 4px;
  border-bottom: 1px solid ${rgba(PAL.ink, 0.14)};
}
.learn-tab {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  padding: 10px 6px 9px;
  border: 0;
  border-radius: 8px 8px 0 0;
  background: transparent;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  color: ${rgba(PAL.ink, 0.55)};
  cursor: pointer;
  transition: color .18s ease, background-color .18s ease;
}
.learn-tab:hover { color: ${PAL.ink}; background: ${rgba(PAL.cream, 0.7)}; }
.learn-tab[aria-selected="true"] { color: ${PAL.ink}; }
.learn-tab[aria-selected="true"]::after {
  content: "";
  position: absolute;
  left: 18%;
  right: 18%;
  bottom: -1px;
  height: 2px;
  border-radius: 2px;
  background: ${PAL.coral};
}
.learn-tab-n {
  margin-left: 4px;
  font-size: 12px;
  font-weight: 400;
  color: ${rgba(PAL.ink, 0.42)};
}
.learn-tab:focus-visible,
.learn-demo-btn:focus-visible {
  outline: 2px solid ${PAL.coral};
  outline-offset: 2px;
}

/* ---------------------------------------------------------------- 滚动区 */
.learn-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: 12px 12px 18px;
  scrollbar-width: thin;
  scrollbar-color: ${rgba(PAL.ink, 0.22)} transparent;
}
.learn-body::-webkit-scrollbar { width: 6px; }
.learn-body::-webkit-scrollbar-track { background: transparent; }
.learn-body::-webkit-scrollbar-thumb {
  border-radius: 3px;
  background: ${rgba(PAL.ink, 0.2)};
}
.learn-body::-webkit-scrollbar-thumb:hover { background: ${rgba(PAL.ink, 0.34)}; }

.learn-pane { display: flex; flex-direction: column; gap: 12px; }
.learn-pane[hidden] { display: none; }

.learn-lead {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: ${rgba(PAL.ink, 0.5)};
}

/* ---------------------------------------------------------------- 操作行 */
.learn-op {
  padding: 12px;
  border: 1px solid ${rgba(PAL.ink, 0.1)};
  border-radius: 12px;
  background: ${PAL.white};
}
.learn-op-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.learn-op-no {
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: ${PAL.coral};
}
.learn-op-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: .01em;
}
.learn-op-lines {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 6px 0 10px;
  padding: 0;
  list-style: none;
}
.learn-op-lines li {
  position: relative;
  padding-left: 10px;
  font-size: 12px;
  line-height: 1.6;
  color: ${rgba(PAL.ink, 0.78)};
}
.learn-op-lines li::before {
  content: "";
  position: absolute;
  left: 0;
  top: .62em;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: ${PAL.sand};
}

/* ---------------------------------------------------------------- 演示位 */
.learn-demo {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 96px;
  overflow: hidden;
  border: 1px dashed ${rgba(PAL.ink, 0.24)};
  border-radius: 10px;
  background: linear-gradient(180deg, ${rgba(PAL.cream, 0.75)}, ${rgba(PAL.white, 0.95)});
  transition: border-color .2s ease, background-color .2s ease;
}
.learn-demo:hover { border-color: ${rgba(PAL.coral, 0.55)}; }
.learn-demo-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: 1px solid ${rgba(PAL.ink, 0.28)};
  border-radius: 999px;
  background: ${PAL.white};
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  color: ${PAL.ink};
  cursor: pointer;
  transition: color .18s ease, border-color .18s ease, transform .12s ease;
}
.learn-demo-btn:hover { color: ${PAL.coral}; border-color: ${PAL.coral}; transform: translateY(-1px); }
.learn-demo-btn:active { transform: translateY(0); }
.learn-demo-ico { font-size: 9px; line-height: 1; }
.learn-demo-note {
  font-size: 12px;
  color: ${rgba(PAL.ink, 0.42)};
  transition: color .18s ease;
}
.learn-demo-note.is-warn { color: ${PAL.coral}; }
.learn-demo-bar {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 0;
  height: 2px;
  background: ${PAL.coral};
  opacity: 0;
}
.learn-demo.is-playing {
  border-color: ${rgba(PAL.coral, 0.6)};
  background: ${rgba(PAL.cream, 0.9)};
}
.learn-demo.is-playing .learn-demo-bar {
  opacity: 1;
  animation: learn-demo-run 3s linear forwards;
}
.learn-demo.is-playing .learn-demo-btn { color: ${PAL.coral}; border-color: ${rgba(PAL.coral, 0.6)}; }
@keyframes learn-demo-run {
  from { width: 0; }
  to { width: 100%; }
}

/* ---------------------------------------------------------------- 知识卡 */
.learn-card {
  position: relative;
  padding: 12px 12px 11px 14px;
  border: 1px solid ${rgba(PAL.ink, 0.1)};
  border-radius: 12px;
  background: ${PAL.white};
}
.learn-card-bar {
  position: absolute;
  left: 0;
  top: 14px;
  bottom: 14px;
  width: 3px;
  border-radius: 0 3px 3px 0;
}
.learn-card-kicker {
  display: flex;
  align-items: center;
  gap: 6px;
}
.learn-card-no {
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: ${PAL.coral};
}
.learn-card-tag {
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 1.5;
  color: ${rgba(PAL.ink, 0.72)};
  background: ${rgba(PAL.cream, 0.9)};
}
.learn-card-title {
  margin: 5px 0 0;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: .01em;
}
.learn-card-core {
  margin: 7px 0 8px;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.5;
  color: ${PAL.ink};
}
.learn-card-lines {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0 0 9px;
  padding: 0;
  list-style: none;
}
.learn-card-lines li {
  position: relative;
  padding-left: 10px;
  font-size: 12px;
  line-height: 1.65;
  color: ${rgba(PAL.ink, 0.76)};
}
.learn-card-lines li::before {
  content: "";
  position: absolute;
  left: 0;
  top: .68em;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: ${rgba(PAL.ink, 0.24)};
}
.learn-card-law {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding-top: 8px;
  border-top: 1px dashed ${rgba(PAL.ink, 0.14)};
  font-size: 12px;
  line-height: 1.5;
  color: ${rgba(PAL.ink, 0.62)};
}
.learn-law-tag {
  flex: 0 0 auto;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 12px;
  color: ${PAL.coral};
  background: ${rgba(PAL.coral, 0.12)};
}

.learn-foot {
  margin: 2px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: ${rgba(PAL.ink, 0.42)};
}

@media (prefers-reduced-motion: reduce) {
  .learn * { transition: none !important; animation: none !important; }
  .learn-demo.is-playing .learn-demo-bar { opacity: .6; width: 100%; }
}
`;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) { return; }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  (document.head || document.documentElement).appendChild(style);
}

// ---------------------------------------------------------------- 创建
/**
 * @param {Object}   opts
 * @param {Element|string} opts.mount       挂载点（手机页主体，需要有确定高度）
 * @param {(key:string, slot:HTMLElement) => void} [opts.onPlayDemo] 点演示位时回调，key 见 OPS
 * @returns {{ el:HTMLElement, show:(tab:string)=>void, destroy:()=>void, tab:string }}
 */
export function createLearn({ mount, onPlayDemo } = {}) {
  const host = typeof mount === "string" ? document.querySelector(mount) : mount;
  if (!host) { throw new Error("createLearn：mount 没找到（传元素或选择器）"); }

  injectStyle();

  const root = el("div", "learn");
  root.setAttribute("data-learn", "");

  // ---- Tab 条
  const tabsBar = el("div", "learn-tabs");
  tabsBar.setAttribute("role", "tablist");
  tabsBar.setAttribute("aria-label", "学习");

  const tabs = [
    { id: "ops", label: "操作", count: OPS.length },
    { id: "know", label: "知识", count: CARDS.length }
  ];
  const tabBtns = new Map();

  tabs.forEach((t) => {
    const btn = el("button", "learn-tab");
    btn.type = "button";
    btn.id = "learn-tab-" + t.id;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-controls", "learn-pane-" + t.id);
    btn.appendChild(document.createTextNode(t.label));
    btn.appendChild(el("span", "learn-tab-n", String(t.count)));
    btn.addEventListener("click", () => show(t.id));
    tabBtns.set(t.id, btn);
    tabsBar.appendChild(btn);
  });

  // 左右键切 Tab：手机上也接了键盘的场景（外接键盘 / 桌面调试）不至于卡住。
  tabsBar.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") { return; }
    e.preventDefault();
    const ids = tabs.map((t) => t.id);
    const i = ids.indexOf(active);
    const next = ids[(i + (e.key === "ArrowRight" ? 1 : ids.length - 1)) % ids.length];
    show(next);
    tabBtns.get(next)?.focus();
  });

  // ---- 滚动区 + 两个 pane
  const body = el("div", "learn-body");
  const panes = new Map();

  // 操作
  const opsPane = el("section", "learn-pane");
  opsPane.id = "learn-pane-ops";
  opsPane.setAttribute("role", "tabpanel");
  opsPane.setAttribute("aria-labelledby", "learn-tab-ops");
  opsPane.appendChild(el("p", "learn-lead", "8 个动作。点演示位看 3 秒示例。"));

  OPS.forEach((op, i) => {
    const row = el("article", "learn-op");

    const head = el("div", "learn-op-head");
    head.appendChild(el("span", "learn-op-no", String(i + 1).padStart(2, "0")));
    head.appendChild(el("h3", "learn-op-title", op.title));
    row.appendChild(head);

    const list = el("ul", "learn-op-lines");
    op.lines.forEach((line) => list.appendChild(el("li", null, line)));
    row.appendChild(list);

    // 演示位：结构留给 3D 场景，`data-demo` 就是 key，别改这里。
    const slot = el("div", "learn-demo");
    slot.dataset.demo = op.key;

    const btn = el("button", "learn-demo-btn");
    btn.type = "button";
    btn.title = "3 秒演示（3D 场景接入后在这块里播）";
    btn.setAttribute("aria-label", op.title + "：" + DEMO_LABEL);
    btn.appendChild(el("span", "learn-demo-ico", "▶"));
    btn.appendChild(el("span", "learn-demo-txt", DEMO_LABEL));

    const note = el("span", "learn-demo-note", DEMO_NOTE);
    slot.appendChild(btn);
    slot.appendChild(note);
    slot.appendChild(el("span", "learn-demo-bar"));
    row.appendChild(slot);

    btn.addEventListener("click", () => playDemo(op.key, slot, btn, note));
    opsPane.appendChild(row);
  });

  // 知识
  const knowPane = el("section", "learn-pane");
  knowPane.id = "learn-pane-know";
  knowPane.setAttribute("role", "tabpanel");
  knowPane.setAttribute("aria-labelledby", "learn-tab-know");
  knowPane.appendChild(el("p", "learn-lead", "12 条常识。每条一句结论、三句解释、一条法条。"));

  CARDS.forEach((card, i) => {
    const box = el("article", "learn-card");
    const accent = TAG_COLOR[card.tag] || PAL.sand;

    const bar = el("span", "learn-card-bar");
    bar.style.background = accent;
    box.appendChild(bar);

    const kicker = el("div", "learn-card-kicker");
    kicker.appendChild(el("span", "learn-card-no", String(i + 1).padStart(2, "0")));
    const tagEl = el("span", "learn-card-tag", card.tag);
    tagEl.style.background = rgba(accent, 0.2);
    kicker.appendChild(tagEl);
    box.appendChild(kicker);

    box.appendChild(el("h3", "learn-card-title", card.title));
    box.appendChild(el("p", "learn-card-core", card.core));

    const lines = el("ul", "learn-card-lines");
    card.lines.forEach((line) => lines.appendChild(el("li", null, line)));
    box.appendChild(lines);

    const law = el("p", "learn-card-law");
    law.appendChild(el("span", "learn-law-tag", "法条"));
    law.appendChild(el("span", null, card.law));
    box.appendChild(law);

    knowPane.appendChild(box);
  });

  knowPane.appendChild(
    el("p", "learn-foot", "要点用于训练，正式办案以现行有效的法条文本为准。")
  );

  panes.set("ops", opsPane);
  panes.set("know", knowPane);
  body.appendChild(opsPane);
  body.appendChild(knowPane);

  root.appendChild(tabsBar);
  root.appendChild(body);
  host.appendChild(root);

  // ---------------------------------------------------------------- 状态
  let active = "ops";
  const scrollTop = { ops: 0, know: 0 };

  function show(id) {
    const target = panes.has(id) ? id : "ops";
    if (target !== active) {
      scrollTop[active] = body.scrollTop;
      active = target;
      panes.forEach((pane, key) => { pane.hidden = key !== active; });
      tabBtns.forEach((btn, key) => {
        btn.setAttribute("aria-selected", key === active ? "true" : "false");
        btn.tabIndex = key === active ? 0 : -1;
      });
      body.scrollTop = scrollTop[active] || 0;
    }
    return active;
  }

  // 演示位：先给 3 秒的可视反馈，真画面交给 onPlayDemo（3D 场景接管）。
  function playDemo(key, slot, btn, note) {
    if (typeof onPlayDemo !== "function") {
      note.textContent = "演示位还没接上（onPlayDemo 未提供）";
      note.classList.add("is-warn");
      clearTimeout(slot._learnNoteT);
      slot._learnNoteT = setTimeout(() => {
        note.textContent = DEMO_NOTE;
        note.classList.remove("is-warn");
      }, 1800);
      return;
    }

    try {
      onPlayDemo(key, slot);
    } catch (err) {
      console.warn("[learn] onPlayDemo 出错：", key, err);
    }

    const txt = btn.querySelector(".learn-demo-txt");
    if (txt) { txt.textContent = "演示中…"; }
    note.textContent = "3 秒";

    // 先摘再挂，强制一次回流，让进度条动画从头开始
    slot.classList.remove("is-playing");
    void slot.offsetWidth;
    slot.classList.add("is-playing");

    clearTimeout(slot._learnT);
    slot._learnT = setTimeout(() => {
      slot.classList.remove("is-playing");
      if (txt) { txt.textContent = DEMO_LABEL; }
      note.textContent = DEMO_NOTE;
    }, 3000);
  }

  // 初始状态：操作 Tab 在前，另一个先藏起来
  panes.forEach((pane, key) => { pane.hidden = key !== active; });
  tabBtns.forEach((btn, key) => {
    btn.setAttribute("aria-selected", key === active ? "true" : "false");
    btn.tabIndex = key === active ? 0 : -1;
  });

  return {
    el: root,
    show,
    get tab() { return active; },
    destroy() {
      panes.forEach((pane) => {
        pane.querySelectorAll(".learn-demo").forEach((slot) => {
          clearTimeout(slot._learnT);
          clearTimeout(slot._learnNoteT);
        });
      });
      root.remove();
    }
  };
}
