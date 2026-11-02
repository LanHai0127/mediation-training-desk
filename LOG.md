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
