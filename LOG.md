# LOG · 接力日志（append-only，只增不改）

规则：每节必写"下一步"，不写等于把球扔地上。
　　　只记本项目。引入外部骨架时写"引入 XX 骨架"，不写从哪引入。

## 2026-11-02 · 第 0 天 · S0 立规矩

**做了什么**
- 建 `PROJECT.md` / `TASKS.md` / `LOG.md` / `CHECKLIST.md` + `docs/` `src/` `tools/` 三个目录
- 从比赛 PDF 逐页抄出赛程表、作品基本要求、AI 要求 A/B、最低验收 7 项、一页 PPT 7 模块、提交 4 材料、评审流程、评分 7 项、加分 5 项、提交表 17 字段、参赛纪律 7 条
- 写 `docs/COMPLIANCE.md`：合规红线 10 条 + 每条兑现位置 + 6 项验收动作
- 跑第一次清洁 grep

**为什么这么做**
- 先有验收回路再写代码。CHECKLIST 是唯一对照源，抄错一条就是白丢分，所以宁可慢，逐页对图抄
- 合规声明（角标、页脚、虚构声明）不是最后补的装饰，是模板层就要占位的东西，先写死位置，后面每加页面回来对

**卡在哪 / 怎么解的**
- PDF 三张关键表都是**嵌图**，`md` 提取只剩 `<!-- Image omitted -->`，拿不到文字
  → 改用整页渲染逐页看图抄录
- 整页渲染一开始报 `cannot read the input PDF`，同一份文件 `md` 却能读
  → 原因是文件名含中文且 `活动方案 ` 后带空格；复制成 `plan.pdf` 后 8 页全部渲染成功
- 试过装 Python PDF 库，装到一半超时，放弃；现成 CLI 够用

**改动文件**
- `PROJECT.md`（新建）· `TASKS.md`（新建）· `LOG.md`（新建）· `CHECKLIST.md`（新建）· `docs/COMPLIANCE.md`（新建）

**下一步**
- 等 LanHai 确认 CHECKLIST 里 3 条待确认项（评分项无单项分值 / AI 要求表右侧裁切 / 加分项写"周一下午"与"周日上午答辩"矛盾）
- 确认后进 S1：引入 HTTP 服务骨架与验收骨架，让 `run_all.py --record` 跑通 1 套 1 条断言

## 2026-11-02 · 第 0 天 · 两处定档（S0 收尾）

**做了什么**
- CHECKLIST 评分 7 项：按**等权**处理，各约 14.3 分，写进文件作为我方假设
- S4 案子改为**难度阶梯**：先 3 个简单案（噪音 / 宠物 / 高空抛物，均 2 人），再补 1 个高难案（劳资欠薪，3 方）

**为什么这么做**
- 评分原文没给单项分值，与其空着不如写死一个假设，自检时口径统一
- 简单案的作用是**把数据格式、判定链路、结局路由验通**，不是把故事写满。先用 2 人案把结构跑稳，再加第三方主体与结构性冲突，返工面小
- 4 个案子里 3 个属同一大类（邻里），场景物件可复用，画一遍够用

**卡在哪 / 怎么解的**
- 无

**改动文件**
- `CHECKLIST.md`（评分假设）· `TASKS.md`（S4 重排为案 01~04、S0 阻塞解除）

**下一步**
- 进 S1：引入服务骨架与验收骨架，`run_all.py --record` 跑通 1 套 1 条断言

## 2026-11-02 · 第 0 天 · S1 骨架

**做了什么**
- `src/server.py`（约 470 行，标准库零依赖）：路由骨架 + 安全头 + CSP + 登录闸 + 限流器 + 静态服务 + `GameServer.request_queue_size = 256`
- `src/auth.py`：登录鉴权（PBKDF2、双闸失败限速、失败计数落盘、回环豁免需"对端也是回环"）；**cookie 名与两个环境变量前缀已换成本项目的**
- 版本探针 `GET /__ver` → build 时间戳 + git 短 hash + pid + port（部署后靠它确认线上跑的是刚部署的那份）
- 健康检查 `GET /api/health`：阶段、构建戳、限流快照、登录状态（只报数量，不报名单）
- 页面：`src/web/index.html` + `app.css`（政务蓝 + 暖灰，14 个 `:root` 变量，不硬写颜色），登录页三件（`login.html/css/js`）与中性图标 `favicon.svg`
- 验收脚手架 `tools/run_all.py`（台账式记账 + 拒绝假账护栏）+ `tools/test_smoke.py`（10 条断言）
- `start.bat`、`.gitignore`、首次 git 提交 `63040a0`

**为什么这么做**
- 从第一分钟就有验收回路：先让"空壳能跑 + 能记账"，后面每加一层只往里加断言，不留到最后补测试
- 登录闸、CSP、越界读护栏这些是**部署那天才发现就晚了**的东西，趁骨架还小先钉住，有断言守着
- 合规角标与页脚声明写进入口页模板，后面每个新页面复制同一段，不在最后统一补

**卡在哪 / 怎么解的**
- 验收脚本一开始连不上本机端口：本机 `HTTP_PROXY` 指向本地代理，`urllib` 会把 `127.0.0.1` 也交出去，表现是"服务没起"
  → 两处都改用 `ProxyHandler({})` 显式绕开，并在起服务时设 `NO_PROXY`。这条以后所有自测脚本都照做
- 首屏角标贴右边缘被裁 → 改成悬浮胶囊（`top/right: 12px` + `white-space: nowrap`）
- `/__ver` 一开始返回 `git: nogit`：构建戳是**进程启动时的快照**，git 提交之后必须重启进程才会变
  → 记下来：部署切换的判定标准是"探针里的 build/git 变了"，不做进程重启就等于没切

**改动文件**
- 新建：`src/server.py`、`src/auth.py`、`src/web/{index.html,app.css,login.html,login.css,login.js,favicon.svg}`、`tools/run_all.py`、`tools/test_smoke.py`、`start.bat`、`.gitignore`
- 生成：`tools/_ledger.json`（test_smoke 10 项，all_ok: true）

**验收数据**
- `python tools/run_all.py --record` → 1 套 / **10 项断言全绿** / 0.7s / ledger 已写
- `/__ver` → `build 2026-11-02T19:43:38+0800 · git 63040a0`
- 故意把端口指到 9999 跑一次 → 提示"服务没起"并**拒绝记账**（护栏有效）

**下一步**
- S2 场景层：先定 4 类场景与 kind 清单（25~30 种），再写 `scene.js`（A\* + 镜头 + `BACKDROP_Y` 单一常量），
  然后 `test_art.py` 双向契约；顺序不能倒——先有注册表再有绘制函数，最后才有 scenes.json 引用

## 2026-11-02 · 第 0 天 · S2 场景 + S5 对话（补做）

**做了什么**
- `src/web/scene.js`（约 780 行）：2.5D 场景引擎
  · 29 个 `spotXxx` 绘制函数 + `SPOT_KINDS` 注册表；**认不出的 kind 画红色问号框**，不静默回落
  · 投影：远端 0.62 → 近端 1.24 的纵深缩放；物件大小另用 `artScale()` 按画布宽度自适应
  · 画家算法按 y 排序，人夹在景物中间；`BACKDROP_Y` 单一常量同时当地平线与寻路上边界
  · A\* 网格寻路（28px 格、斜走不切角）、点击走动、点物件查看、走进范围才可交互
  · 挂墙件（窗/门/钟/公示牌/暖气片）单独一档缩放并钉在地平线上，否则一扇门会顶出画布
- 移动端：Pointer Events（点一下就走，不依赖鼠标）、画布按容器宽 + DPR 自适应、`touch-action: manipulation`、输入框 16px 防 iOS 聚焦放大、窄屏单列 + 场景标签横滑
- 案子 `src/cases/case_01_noise/case.json`：3 场景 / 32 点位 / 2 当事人 / 6 条事实，29 种 kind 全部用上
- 对话层 `src/game/dialogue.py`：意图识别（道歉/共情/承诺/事实/施压）→ 状态增量（trust/mood）→ 出口语；
  独立谈话 +0.04 信任，信任过 0.62 吐隐情且只吐一次；越界承诺识别；事实白名单过滤
- 模型层 `src/game/llm.py`：OpenAI 兼容 `/chat/completions`，**任何失败返回 None 不抛异常**；只从环境变量或 `config.local.json` 读密钥
- 服务端新增 `/api/cases`、`/api/case/<id>`、`/api/session`、`/api/look`、`/api/scene`、`/api/dialogue`、`/api/llm/status`
- `tools/ui_probe.py`：CDP 布局探针，直接问浏览器 `scrollWidth` 与超界元素
- 测试：`test_art.py`（9 项）、`test_llm.py`（14 项），`run_all` 扩到 3 套

**为什么这么做**
- 判定与对话彻底分开：对话接口只回台词与状态，**不返回任何判定字段**，模型无法影响结论
- 场景先立"双向契约"再画：数据用了注册表没有的 kind 必须变红，注册了没人用的也算问题（死代码）
- 移动端不当"缩小版桌面"：点地面就走、点物件就看，不用鼠标悬停这种手机上不存在的能力

**卡在哪 / 怎么解的**
- JSON 里混进半角引号（`"再忍两天"`）→ 解析直接失败。规矩：中文引号一律用「」，`json.load` 每次改完必跑
- 首屏看起来"被一块米色盖住"：`.compliance-badge` 基类有 `bottom:12px`，窄屏媒体查询又给了 `top:8px`，
  两个都设 → 元素被拉成贯穿整屏的宽条。修法是窄屏显式 `top:auto`
- 窄屏截图一直显示"右侧被裁"，以为布局溢出。**用 `--window-size` 截图是假象**（窗口有最小宽度、也没有移动端视口），
  换成 CDP `Emulation.setDeviceMetricsOverride` 一量：`scrollWidth == 390`，根本没有溢出。
  教训：判断有没有溢出要问浏览器，不要看截图
- 物件统一放大 1.8 倍后，手机上只剩"人和一台电视" → 改成按画布宽度的比例缩放（下限 0.6）

**改动文件**
- 新建：`src/web/scene.js`、`src/web/app.js`、`src/game/{__init__,dialogue,llm}.py`、`src/cases/case_01_noise/case.json`、`src/config.local.example.json`、`tools/{test_art,test_llm,ui_probe}.py`、`README.md`
- 改写：`src/web/index.html`、`src/web/app.css`（布局 + 移动端）、`src/server.py`（+6 个接口）

**验收数据**
- `python tools/run_all.py --record` → **3 套 / 33 项断言全绿**（test_smoke 10 · test_art 9 · test_llm 14），ledger `all_ok: true`
- 未配置模型时对话全走剧本：同一句问 3 次回复不全相同、触发词使情绪下降、越界承诺被抓、隐情只吐一次
- 移动端 390×844：`scrollWidth == 390`，无横向溢出；截图见 `tools/_logs/m390b.png`

**下一步**
- S3 判定内核（四维：诉求/底线/证据/台阶 + 覆盖率 + 破裂也是合格结局），再 S4 补案 02~04

## 2026-11-02 · 第 0 天 · S3 判定 + S4 四案 + S5 法条 + S6 复盘（接模型后一次做完）

**做了什么**
- `src/judge/kernel.py`：`noul` / `choice` / `score` 三原语 + 温度 0.8 softmax + 置信度校准（base = 0.5·top + 0.5·margin，再乘 0.6+0.4·覆盖率）
- `src/judge/mediation.py`：四维判定（诉求/底线/证据/台阶）、覆盖率、**天花板**、过程分、结局路由；阈值写成 THRESH_ACT 0.62 / PASS 0.60 / RUPTURE_CEILING 0.40，注释标明经验值待校准
- 多解机制：`requires.trust` 让"谈崩的人签不了字"，天花板随信任下降；天花板 < 0.40 时 **refer 合格 / agreement 不合格**
- `src/game/report.py`：复盘报告（四维对照、Top3 失误、"换成…"、未触碰诉求、过程画像），纯本地生成
- `src/game/rag.py` + `src/laws/laws.json`：8 条法条要点（人民调解法 5 / 民法典 2 / 治安管理处罚法 1），按 id 可溯源，检索不到返回空
- 案子补到 4 个：案 02 楼下的狗、案 03 掉下来的花盆、案 04 四万二的工钱（3 方）
- 前端：方案区（四维单选）、提交/转办两个出口、复盘弹层（复制文本 / 打印 PDF / 再练一次）、侧栏法条卡
- 服务端：`/api/submit`、`/api/report/<sid>`、`/api/audit/<sid>`、`/api/laws`
- 交付材料：`docs/调解台-一页PPT.pptx`（7 模块，数字取自 ledger）、`docs/答辩脚本.md`、`docs/部署说明.md`、`docs/提交表.md`、`deploy/*`
- 接入真实密钥（DeepSeek deepseek-chat，约 1.2s/轮）；密钥只写 `src/config.local.json`，该文件在 .gitignore 里

**为什么这么做**
- 判定与对话彻底分开：`evaluate(plan, ctx, mode)` 的入参里**没有一句话**，模型无法影响结论
- 天花板这个概念是整个作品的核心：它把"谈崩了还硬凑协议"从"高分"变成"不合格"，让"破裂"成为合格答案
- 报告数字只搬 `result`，不二次计算；`test_judge` 断言报告与判定逐位一致

**卡在哪 / 怎么解的**
- 置信度永远过不了线（所有案子都判 need_more）：一开始用 softmax 后的概率差当 margin，被温度压扁到 0.2。
  → 改用**原始质量差**（0.45）算 margin，满分方案置信度 0.72
- 覆盖率虚高：方案因信任不足不可用时，仍把它的 `satisfies` 计进覆盖率
  → 加 `if ok:` 才计入；"两头得罪"场景覆盖率从 0.85 掉到 0.22，和直觉一致
- 关键证据没处可拿（f_audio / f_notice 没有任何点位挂着）→ 满分方案永远判"待补"
  → 把两条事实分别挂到茶几、鞋柜，门后挂备案回执；报警记录改为开局已知
- `case.json` 是服务启动时载入的，改完不重启就一直用旧数据（白排查半天）→ 写进 LOG 当规矩
- Python 里写 JSON 反复被中文半角引号坑（`"再忍两天"`），一晚上踩三次 → 案子数据一律用 JSON 文件直接写，中文引号统一用「」
- PPT 排版不能靠猜：用 LibreOffice 无头渲染成 PNG 再看，比肉眼读 pptx 靠谱

**改动文件**
- 新建：`src/judge/{__init__,kernel,mediation}.py`、`src/game/report.py`、`src/game/rag.py`、`src/laws/laws.json`、`src/cases/case_0{2,3,4}_*/case.json`、`tools/{test_judge,test_laws,make_ppt}.py`、`docs/{答辩脚本,部署说明,提交表}.md`、`docs/调解台-一页PPT.pptx`、`deploy/*`
- 改写：`src/game/{__init__,dialogue}.py`、`src/server.py`、`src/web/{index.html,app.js,app.css}`、`tools/{run_all,ui_probe}.py`

**验收数据**
- `python tools/run_all.py --record` → **5 套 / 77 项断言全绿**（smoke 10 · art 9 · judge 28 · laws 16 · llm 14），ledger `all_ok: true`
- 端到端（真实模型）：看现场取证 → 分别谈 4 轮 → 提交 → 复盘「调解达成 · 合格」，覆盖率 1.00、置信度 0.77
- 八种判定场景逐条走通：满分/无证据/没分别谈/只保工期/硬凑/转办/过早转办/空方案

**下一步**
- 云端部署（按要求本轮不做）；做一个选案页，让 4 个案子在界面上可选；补 5 类纠纷；录兜底演示视频

## 2026-11-02 · 第 0 天 · S8 续：角标、复盘排版、拖动平移

**做了什么**
- 合规角标从 body 顶层移进画布（右上角），滚动时不再压正文；登录页仍用 fixed 版；打印复盘时在报告顶部单独出一枚 `.print-badge`
- 复盘报告重做：抬头（案名 · 副标题 · 生成时间）、数字块加进度条与**及格线刻度**（0.60 / 0.62 / 无）、四维由表格改卡片式分数条、过程改四小格
- 场景支持**按住拖动平移**（手机画布窄，不拖看不全屋子）；一走动自动回到跟随
- 焦点陷阱：弹层内 Tab 循环，关闭后焦点回到打开处
- 首屏失败态：不再只显示 `Failed to fetch`，改为"先运行 start.bat"的可操作提示
- 换案 confirm：有谈话或方案时先问一句
- `ui_probe` 新增 `--media print`，打印版式可以自动截图核对

**为什么这么做**
- 角标是合规红线，但把正文压住就变成"为了合规牺牲可读性"，最后两边都不达标；移进画布后两者都成立
- 复盘是赛道二"可复盘"的落点，也是评委唯一会带走的纸面材料，所以按打印件来做：数字带刻度、四维卡片化、断页不拆块

**卡在哪 / 怎么解的**
- 打印角标一开始不显示：`.print-badge{display:none}` 写在文件末尾，晚于 `@media print` 里的 `display:block`，同优先级后者被前者覆盖
  → 打印规则加 `!important`，并在注释里写明原因（否则下次又被"整理"回去）
- 拖动被当成点击：`pointerup` 只看位移总和，横向拖动 100px 也会触发 tap → 增加 `drag.moved` 标记，拖动后不再触发点击
- `test_ui` 因为改了复盘 DOM（`.v-verdict` → `.verdict-main i`）假红一次，说明测试选择器要跟结构一起改

**改动文件**
- `src/web/{index.html,app.js,app.css,scene.js}`、`src/game/report.py`、`tools/{ui_probe,test_ui}.py`、`docs/COMPLIANCE.md`、`TASKS.md`

**验收数据**
- `run_all.py --record` → **7 套 / 115 项断言全绿**
- 打印媒体模拟：只出报告、顶部有角标、按钮消失、四维不跨页拆开

## 2026-11-03 · 手机功能（按既有玩法对齐）

**做了什么**
- 会话层加记事本：`add_note / update_note / delete_note`，600 字上限、时间戳、`N1` 递增 id；`view()` 带 notes
- 提交门槛：记事本为空 → 返回 `{ok:false, need:"notes", message:"…先写一条…"}`，**不给判定结果**；删光笔记后依然拦
- 接口 `/api/notes`（list/add/update/delete），内容只存内存，日志不记正文
- 手机 UI：状态栏（时间/电量）、刘海、桌面六宫格、底部「桌面 / 收起」
  · 桌面：警情卡 + 最近一条笔记卡 + 按进度变化的引导提示 + 进度行
  · 记事本：列表、编辑器、插入素材（把已掌握的事实写进笔记）、修改/删除、⌘/Ctrl+Enter 保存
  · 地点：场景列表点一处直接过去；现场素材：已掌握/未掌握分开；警情简报；操作须知
  · 电话：如实写「未接入拨号」，不假装能用
- 顶栏徽标同步笔记条数；提交被拦时自动打开记事本
- 复盘报告新增「我的笔记」区块，纯文本导出同样带

**为什么这么做**
- 「诉求要自己写下来」是训练的一部分，不是 UX 装饰。空着就能交方案，记事本就成了摆设
- 门槛放在**服务端**而不是只在前端拦：前端忘了拦、或者有人直接调接口，都绕不过去
- 电话功能没做就写「未接入拨号」，不用假界面凑数

**卡在哪 / 怎么解的**
- 状态栏文字被刘海压住：`::before` 画了 16px 刘海，状态栏 padding-top 只有 10px → 改成 22px
- 笔记里的三行并成一行：`.p-item b` 默认 `white-space: normal`，换行被折叠 → 加 `pre-wrap`
- 加了门槛之后 `test_api` / `test_ui` 全线变红——因为提交前没有笔记。这不是应用坏了，是测试没跟上新规则
  → `test_api.new_session()` 默认写一条；`test_ui` 用真实点击走一遍「打开手机→新写→保存」，顺带把手机流程测了
- 手机桌面大片空白 → 补警情卡、最近笔记卡、引导提示，既填充又有信息

**改动文件**
- `src/game/__init__.py`（记事本 + 门槛）、`src/game/report.py`（笔记进复盘）、`src/server.py`（/api/notes）
- `src/web/{index.html,app.css,app.js}`（手机整套）
- `tools/{test_notes.py,test_ui.py,test_api.py,run_all.py}`

**验收数据**
- `run_all.py --record` → **8 套 / 139 项断言全绿**（新增 test_notes 18；test_ui 23，含手机 8 项）
- 空笔记提交被拦 → 打开记事本 → 写一条 → 再交，正常出结局

## 2026-11-03 · S10 建模与电话通道

**做了什么**
- 判定改 N 维：维度顺序读 case.dimensions，2 维（电话案）/4 维/5 维（院墙）共用一套代码
- 物件 29 → **43 种**：值班台、座机、警情公示栏、对讲机充电座、篮球架、便携音箱、公园长椅、球场灯、围网、垃圾桶、排水沟、界石、柴垛、屋檐
- 地面材质 6 种（wood/tile/concrete/dirt/grass/court），球场自动画底线、边线、中线、罚球圈
- 固定站位人物：`characters` 数组渲染，点人走近即谈话；带朝向、坐/站、呼吸微动
- 物件支持 `layer` 显式层级（屋檐要压在墙上，光靠 y 排会被墙挡住）
- ResizeObserver 跟随容器宽度
- 电话通道：`/api/call`（start/end）+ dialogue 的 phone 通道；通话记录只记"跟谁、多久、几轮"，不存内容
- 三个新案子：堵住的那条道（电话·2 维）、六点半的球场（三方·4 维）、三十公分（三方·5 维）
- 法条补《消防法》第二十八条，检索标签覆盖新场景

**为什么这么做**
- 用户要"先做建模和其他功能"：建模不等于跑 3D，缺的是**可辨识的场地**（塑胶+白线）、**能读懂的墙**（砖纹、瓦檐）、**能点的人**（站位人物）
- 电话案必须能真的"电话办完"：所以判定里把 phone 也算单独沟通，否则事办成了还判程序不合格

**卡在哪 / 怎么解的**
- 画布只铺了半个舞台，右侧一条空白：`resize()` 只在挂载时算一次，舞台宽度后来被右栏内容撑开
  → 加 ResizeObserver；再给 resize 加"尺寸没变就跳过"，避免自激
- 屋檐怎么放都不对：放墙顶被墙覆盖（y 排序），放墙前又像装饰带
  → 引入 `layer`，屋檐设 400，明确"压在墙上面"
- 球场三分弧画歪：投影是非线性的，世界坐标里的圆投到屏幕不是圆
  → 直接删掉，只保留边线/中线/罚球圈（够认，不误导）
- 加了新案子后 `test_laws` 红 3 条、`test_llm` 红 1 条：新案子匹配不到两条法条；白名单测试默认取第一个案子（没有 f_audio）
  → 补法条标签；测试显式挑带该事实的案子，不靠"第一个"

**改动文件**
- `src/web/scene.js`（14 种新物件 + characters + layer + 地面材质 + ResizeObserver）
- `src/game/__init__.py`、`src/server.py`（通话）、`src/judge/mediation.py`（N 维、phone 算单独沟通）
- `src/cases/case_00_flame`、`case_05_court`、`case_06_wall`（新建）
- `src/laws/laws.json`、`tools/{test_call.py,run_all.py,test_llm.py}`

**验收数据**
- `run_all.py --record` → **9 套 / 157 项断言全绿**
- 开胃菜：拨号 → 通话 → 挂断 → 写笔记 → 提交 → 「电话办结 · 合格」，覆盖率 1.00

## 2026-11-03 · S11 3D 微缩场景（换掉 2.5D）

**做了什么**
- 提示词重写为 v2：面向 three.js 程序化场景（旧版 2.5D 存档到 `docs/archive/`）
- 提示词新增 §1.2「可玩性规格」：移动（网格/膨胀/速度/朝向）、交互（走近才触发/热区/反馈）、
  相机（跟随/拖拽/回正/限制）、性能、以及给 AI 的 6 条自检清单；七个场景各补「可行走与交互」
- 通用运行时 `src/web/scenes/scene3d.js`：底座 20×20、Toon 材质、程序化地砖纹理、墙裙、
  主光阴影 + 冷补光 + 雾、A*（0.5 格 / 八向 / 不切角 / **视线拉直**）、碰撞膨胀 0.45、
  主角走位与摆臂、相机跟随 + 拖拽旋转 + 松手回正、Raycaster 拾取
- S0 值班台场景：L 形值班台、显示器、座机、公示栏、文件柜、饮水机、长椅、垃圾桶、门
- three 0.180 本地副本，零 CDN

**为什么这么做**
- 观赏模型和游戏场景是两码事：能转不等于能玩。所以把「可玩性」写成提示词里的硬规范，
  再落一个真能走的原型，证明这条路可行——不然提示词写得再细也只是纸面
- 业务层（判定/对话/手机/复盘/电话）一行没动，只换渲染层，风险最小

**卡在哪 / 怎么解的**
- 场景页一片空白、canvas 都没有：**页面 CSP 是 `script-src 'self'`，内联脚本被直接拦掉**
  → 把场景脚本拆成 `duty.js` 外链；这条坑写进提示词 §6 与代码注释
- 走位一抖一抖、8 单位要走 5.6 秒：A* 给的是格路径，折线太多
  → 先去掉共线点，再做视线拉直（能直走就直走），同样距离从 5665ms 降到 2231ms
- 事件测试拿不到回调：场景里的 `window.__mini` 只暴露了走位，没有事件记录
  → 场景页把事件 push 到 `window.__events`，测试才能断言「arrived 先于 spot」

**验收数据**
- `run_all.py --record` → **10 套 / 167 项断言全绿**（新增 test_scene3d 10 项）
- 实测：起点 (0,4.2) → 点地走到 (6,4)；点公示栏 2231ms 到位后才触发 spot；
  点值班台正中（障碍内）会吸附到旁边，不会卡在走路状态
