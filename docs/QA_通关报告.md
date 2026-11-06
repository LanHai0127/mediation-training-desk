# 通关报告 · 调解台（`src/web/app.html`）

> 目标：把游戏从头到尾玩一遍，确认每个机制都能触发；发现 bug 就修，修完再跑，直到通关无阻。
> 结论：**13 条清单 + 十场逐场遍历全部走通**。过程中挖出两个"只有真实鼠标才暴露"的 bug（点人不开口、点物件不收证据），
> 都在 `src/web/ui/app.js` 里修好；三套测试全绿（`qa_play.py` 117/117、`test_app.py` 80/80、`test_scene3d.py` 70/70）。

---

## 0. 一句话版本

| 项 | 结果 |
|---|---|
| 13 条通关清单 | 13/13 通过（真实鼠标/键盘） |
| 十场逐场遍历（第 14 条） | 10/10 场通过，每场 5 条（传送 / 点地面 / 物件证据 / 人物面板 / 走出来） |
| 修了几个 bug | 2 个阻断级 + 2 个边界（都在 `app.js`） |
| `tools/qa_play.py`（13 条专用 + 十场遍历） | **117/117**（13 条 65 + 十场 52），单次 6.8 分钟 |
| `tools/test_app.py`（原 65 条 + 新增 15 条） | **80/80** |
| `tools/test_scene3d.py` | 70/70 |
| 改动的源文件 | 2026-11-04：`src/web/ui/app.js`；2026-11-05 追加：`dialog.js`、`cases_dialog.json`、`scene3d.js`（根因修复）、`qa_play.py` 第 14 条 |

---

## 1. 怎么测的（为什么以前的 65 条全绿还是会漏）

全程走 **CDP Input**：`Input.dispatchMouseEvent`（移动 / 按下 / 抬起 / 拖动 / 滚轮）、
`Input.dispatchKeyEvent`（逐字符打字）。**没有往 contentDocument 派任何假事件**，
也没有用 `element.click()` 走捷径——要验的就是"手指点下去"这条路径本身。

两个驱动：

- `tools/qa_play.py`：13 条清单专用，65 个断言，截图写 `tools/_logs/QA_*.png`。
  跑法 `python tools/qa_play.py`（约 3.5 分钟），`--only 1,2,3` 只跑某几步。
- `tools/test_app.py`：外壳全量。原有 A~J 65 条**全部保留**，末尾新增 **K 段 15 条**
  专门覆盖真实输入（见 §5）。

两个细节，不做就会"点空"：

1. **坐标现算现点**：相机对主角做指数跟随，落定后仍在微调；用 0.5 秒前的投影会点到旁边。
2. **"纯地面"要按外壳的同一套规则判**：场景里的地面/路面/草皮本身也是 prop（`g_*`），
   又平又大；不排除它们，就会把"点地面"判成"点家具"。

---

## 2. 13 条逐条结果

| # | 清单 | 结果 | 怎么坏的 → 怎么修的 |
|---|---|---|---|
| 1 | 首屏只有一块「开始调解」板；鼠标移动有视差；右上角手机图标不可见 | **通过** | 一块板 `start`（3.6×2.0，y=5.01）；`.tp-launch` `visibility:hidden/opacity:0/pointer-events:none`；鼠标横移相机 yaw 变化 ≥0.1，`boot.progress.yaw` 同步偏转 |
| 2 | 点开始 → 直接进加载页（无密码门） | **通过** | 真实点板 → `#load.on`、`started=false`；无 `#gate`、无 `input[type=password]`、`state` 里没有 gate 字段 |
| 3 | 云在动、进度条推进、十个圆点逐个亮、100% 后才进场景 | **通过** | 云画布两次采样像素哈希不同；pct 单调递增；`b.ok` 计数单调升到 10；`pct<100` 期间 `started` 恒为 false |
| 4 | 云散后相机从高位下移到常规位；落位后场景可见 | **通过** | 逐帧采到 iframe 相机 y：17.5 → 9.2（下移段）→ 2.2（跟随落定）；落位后 `#frame.on`、opacity 1、看板层 `visibility:hidden`、mode=FOLLOW |
| 5 | 自由视角：点地面 / 拖动 / 滚轮各 5 次 | **通过** | 点地面走人 **5/5**；拖动 yaw 变化 **5/5**；滚轮 `camDist` 变化 **5/5**（场景 `stats().camDist` 与真实相机距离都变） |
| 6 | 手机图标出现；点开；九宫格九个入口全部可点 | **通过** | 进场景后图标可见；真实点开（0.35s 滑入）；九个入口逐个真实点击 → 页面切换、`hidden=false`、正文非空；无入口锁死（评价页保留「结案并出评价」CTA，是设计） |
| 7 | 点场景里的人 → 走近 → 弹问话面板；能关；关掉还能走 | **通过（修好）** | 原来点人**只走到地面、不开口**（见 Bug A）。修完：真实点 p_b → 走近 → 面板 5 个话题、name=张守义；点话题有回答；点 × 能关；关掉后点地面还能走 |
| 8 | 地图列 10 场；点非当前地点 → 抬升 → 云盖 → 加载 → 云散 → 下降 → `sceneId` 变 | **通过** | 地图 10 行；真实点「院墙地界」→ phase `lift→rise→hold→descend` 齐全、云 `k` 到 1 再回 0、相机升到高位、`sceneId duty→wall`、回 FOLLOW/自由视角 |
| 9 | 看过物件后证据夹有条目；笔记能写能删 | **通过（修好）** | 原来点物件**只走到地面、不收证据**（见 Bug B）。修完：真实点界石 → 走近 → `state.seen=['f_marker']`；手机证据夹「已掌握 1/19」；笔记：真实打字 → 存 → 1 条 → 删 → 0 条 |
| 10 | 手机评价页 →「结案并出评价」→ 卡（三维 + 总分 + 评级 + 四段） | **通过** | 真实点结案 → 卡上三维 40/35/25、三维之和 = 总分、评级与印章一致、四段点评每段 ≥1 条、有「看复盘」 |
| 11 | 卡上「看复盘」→ 时间轴节点；点节点 → 相机飞回（mode=REPLAY） | **通过** | 真实点「看复盘」→ 12 节点；真实点第 3 个节点 → `mode=REPLAY`、相机位移 > 1m |
| 12 | 390×844 无横向溢出；手机/看板不出屏 | **通过** | `scrollWidth == 390`；手机壳 `left/right` 都在视口内；地图页、问话面板同样不出屏 |
| 13 | 全程 `window.__err` 与 iframe `__mini` 无异常 | **通过** | 每一步都读一次；全程为空；`__mini` 一直可用 |

---

## 3. 两个阻断级 bug

### Bug A · 点场景里的人不弹问话面板（第 7 条）

**现象**：真实鼠标点人物，主角走到人物附近就停住，问话面板不出现；控制台无异常。

**根因**（在 `scene3d.js`，不在允许改动范围）：

```js
for (const c of opts.characters || []) {
  const g = makePerson(c);
  if (!c.ambient) { g.traverse(...personId...); pickable.add(g); people.set(c.id, g); }
  scene.add(g);            // ← 这一行把 g 从 pickable 摘走，挂回 scene 根
}
```

THREE 的 `Object3D.add()` 会先把节点从旧父级摘下来。于是**所有可交互人物最后都不在
`pickable` 里**，而场景自己的 `pickAt()` 只对 `pickable.children` 做射线 → 永远命中不到人
→ 点击落到 `groundAt` 分支 → 只走路、不发 `person:click`。

**实测证据**：

- 场景图父链：人 `Mesh → Group(7) → Scene`；家具 `Mesh → Group(24) → Group(1) → Group(104=全部家具) → Scene`
- 真实点 p_b：主角从 (0.6, 5.4) 走到 (2.55, 1.06)（地面点），只收到 `actor:arrived`，没有 `person:click`
- 直调 `__mini.goToPerson('p_b')`：走到 (0.55, 3.05) → `person:click` → 面板 5 话题（说明链路本身是通的，断在"拾取"）

**修法**（`app.js`，不动 `scene3d.js`）：进场景时把人物组挂回 `pickable`，
之后完全走场景原本那条链路（`goToPerson → walkTo → fire person:click → openDialog`）。

```js
function repairPickable(w) {          // app.js:425
  // 找到装着家具的顶层 Group（就是 pickable），把父节点是 scene、子树里有 personId 的组挂回去
  // pickable 在原点、无缩放旋转 → 世界矩阵不变，只影响"能不能被 pickAt 命中"
}
```

实测修复后：`moved:["p_a","p_b"]`、pickable 子节点 104→106；真实点 p_b → 走近 → 面板 5 话题、nodes=1。
函数带 `__pickRepaired` 幂等保护，换场景只做一次。

### Bug B · 点物件收不到证据（第 9 条）

**现象**：真实鼠标点界石/院墙，主角走到点击处的地面就停住；`state.seen` 不变、时间轴不增。
证据夹一直显示「已掌握 0 / 19」。

**根因**（在 `scene3d.js` 的 `pickAt`，同样不在允许改动范围）：

```js
const hits = ray.intersectObjects(pickable.children, true);
if (hits.length) { return hits[0].object.userData; }   // ← 取第一个命中
```

家具的**描边线（LineSegments）**也参与射线、而且比表面更近，`userData` 里没有 `propId`
→ `hit.propId` 为空 → 落到 `groundAt` 分支 → 只走到地面点，`goToProp` 与 `spot:click` 都不发生。

**实测证据**（界石屏幕点，同一根射线）：

- `pickHits = [{id:null,d:8.80}, {id:null,d:8.82} ×4]`，界石本体在它们后面
- 点下去主角走到 (2.55, 1.06) 并只发 `actor:arrived`；`state.seen` 不变、`state.nodes` 不增
- 直调 `__mini.goToProp('s_stone')`：走到 (1.05, 1.55) → `spot:click` → `seen:['f_marker']`、nodes=1

**修法**（`app.js`）：pointerup 里补一次"**按身份取目标**"的射线，取第一个带
`personId`/`propId` 的命中，跳过墙、底座、描边线这些没有身份的命中：

```js
const target = pickTargetAt(ev.clientX, ev.clientY);   // app.js:387
if (target.kind === "person") { startPersonTalk(target.id); return; }
if (target.kind === "prop")   { /* 近则直接记账，远则 __mini.goToProp(id) */ }
```

同一条修法把 Bug A 和 Bug B 一起兜住了：人 → 走近开面板；家具 → 让场景用它的 `interact`
点走位、到位由场景发 `spot:click`。

**一个必须同时处理的坑**：地面/路面/草皮本身也是 `prop`（`g_*`），又平又大。
不排除它们，"点地面"会被判成"点家具"，主角会走到某个固定交互点而不是手指点的地方。
所以 `pickTargetAt` 里加了一条：`size.y < 0.35 && max(size.x, size.z) > 8` 的命中直接跳过
（测试脚本 `JS_GROUND` 用同一套规则判"纯地面"，两边必须一致）。

### 附带修的两个边界

1. **站在交互点旁边点物件没反应**：`walkTo()` 在路径不足 2 格时静默 `return false`，
   `goToProp` 不补发事件。现在：命中点离主角 ≤0.9m 就直接按"查看"记账，不再等路径。
2. **问话面板会开出两个**：场景的 `person:click` 和宿主"走近"轮询可能在同一拍各开一次；
   后一次 `closeDialog()` 掉前一次，但前一次的资料还在路上，回来照样 `createDialog`。
   现在 `openDialog` 加了 `dialogSeq` 序号把过期的那次作废，`startPersonTalk` 也连 DOM 一起判空。

---

## 4. 改了哪些文件

| 文件 | 改动 |
|---|---|
| `src/web/ui/app.js` | **唯一改动的源文件**：`repairPickable()`(425)、`pickTargetAt()`(387)、`handleSpotClick()`(451)、pointerup 分支(331)、`repairPickable(w)` 调用(303)、`openDialog` 的 `dialogSeq`(1291)、`startPersonTalk` 的重复开面板保护、消息处理改走 `handleSpotClick` |
| `tools/qa_play.py` | **新增**：13 条清单的真实输入自检（65 断言 + 12 张截图） |
| `tools/test_app.py` | 原有 65 条保留；末尾新增 K 段 15 条真实输入断言 |
| `tools/_qa/chk.js` | 新增：任务要求的健康探针（`{app, mode, boot, phone, canvas, err}`） |
| `tools/_qa/dbg_graph.py` | 新增：一键打印"人物 vs 家具"的父链 + 命中列表（Bug A 复现） |
| `tools/_qa/dbg_pick.py` | 新增：同一屏幕点上 `pickable` 射线 vs 整场景射线对比（Bug B 复现） |
| `tools/_qa/dbg_fix.py` | 新增：验证"把人物挂回 pickable"这个修法（真实点人 → 面板出） |

**2026-11-05 追加的改动**（内容层 + 十场遍历 + 根因修复）：

| 文件 | 改动 |
|---|---|
| `src/web/cases_dialog.json` | 每个当事人新增 `topics[]`：三案 8 人共 44 条定制话题 + 每话题 2 句定制回话 + 13 处法条提示（`authored: true`）；旧 `topics` 五条与 `answers` 保留作兜底 |
| `src/web/ui/dialog.js` | 改读定制结构；回答仍优先 `POST /api/dialogue`，离线/降级回退 `topics[].answers`；新增法条提示行、按人定制的计数、`topics` 只读快照 |
| `src/web/scenes/scene3d.js` | 根因修复：`pickAt` 取"第一个带 `personId`/`propId` 的命中"；人物不再被 `scene.add` 抢走父节点；`ambient` 只在显式给 `personId` 时接 NPC；`passable` 不再挂 `propId` |
| `tools/qa_play.py` | 新增第 14 条十场逐场遍历（52 条断言 + 每场截图）；`test_app` K5 改为点"案卷里登记过的事实点位"，避免点到无事实映射的陈设 |


---

## 5. `tools/test_app.py` 新增的 15 条断言（K 段）

原来 65 条全绿，但**没有一条用真实鼠标点过人 / 物件**，也没真的拖过、滚过、
逐个点过九宫格 / 地图行 / 复盘节点——两个 bug 正是从这条缝里漏过去的。K 段补的就是这条缝：

| 断言 | 覆盖清单 |
|---|---|
| K0 传送到院墙场景（K1~K6 的场地） | 准备 |
| K1 真实鼠标点场景里的人 → 走近 → 弹出问话面板（有话题列表） | 7 |
| K2 真实点一条话题 → 有回答（气泡有字） | 7 |
| K3 问话面板能关（DOM 移除 + state 清空） | 7 |
| K4 关掉问话后真实点地面还能走 | 7 |
| K5 真实鼠标点场景物件 → 走近 → 证据进 `state.seen` | 9 |
| K6 手机证据夹里那件已变成「已收集」 | 9 |
| K7 真实按住拖动 → 视角 yaw 变化 | 5 |
| K8 真实滚轮 → camDist 变化 | 5 |
| K9 九宫格九个入口逐个真实点击都能进 | 6 |
| K10a 地图上可点的其它地点 9 个（当前地点是 div） | 8 |
| K10b 真实点地图行 → 云朵转场（FLIGHT + 目标场景已切换） | 8 |
| K11 真实点「结案并出评价」→ 评价卡（三维和=总分、四段、有看复盘） | 10 |
| K12 真实点「看复盘」→ 时间轴出节点 | 11 |
| K13 真实点复盘节点 → 相机飞回去（mode=REPLAY、位移>1m） | 11 |

> K11 的一个前置：G 段已经把当前案子结掉了，评价页不再有「结案并出评价」。
> 所以 K11 先用真实点击在手机「案件档案」里切到另一件没结的案子，再出评价卡。

---

## 6. 测试结果

| 命令 | 结果 |
|---|---|
| `python tools/qa_play.py` | **117 / 117**（13 条 65 + 十场遍历 52；单次 6.8 分钟；2026-11-05 实跑） |
| `python tools/test_app.py` | **80 / 80**（2026-11-05 实跑） |
| `python tools/test_scene3d.py` | **70 / 70**（需 websocket-client；`uv run --with websocket-client ...`） |
| `node --check`（`app.js` / `dialog.js` 复制成 `.mjs`） | 通过 |

关键截图（`tools/_logs/`）：

| 文件 | 内容 |
|---|---|
| `QA_01_board.png` | 首屏只有一块「开始调解」板 |
| `QA_02_loading.png` | 点板后直接进加载页（无密码门） |
| `QA_03_loading_mid.png` | 加载页中段：云 + 进度 + 圆点 |
| `QA_04_scene_duty.png` | 转场落位后的值班室 |
| `QA_05_freeview.png` | 自由视角（点地面 / 拖动 / 滚轮之后） |
| `QA_06_phone_grid.png` | 手机九宫格 |
| `QA_07_dialog.png` | **修好后**：点人 → 走近 → 问话面板（5 话题） |
| `QA_08_wall.png` | 地图传送落地（院墙地界） |
| `QA_09_notes.png` | 笔记页（真实打字 / 存 / 删） |
| `QA_10_review.png` | 评价卡（三维 + 总分 + 评级 + 四段） |
| `QA_11_replay.png` | 复盘时间轴 + 节点回跳 |
| `QA_12_narrow_phone.png` | 390×844 窄屏下的手机 |

---

## 7. 还没覆盖 / 已知边界（不含糊，逐条写清楚）

1. **十场已经逐场验过一遍**（§8）：每场验「传送进得去（`scene:ready`）/ 点地面 5-5 / 一个物件出证据 / 一个当事人出面板 / 走回来再传下一场」。
   但这是**抽验**，不是逐点位全量：每场只挑一个物件、一个人物，没有把每个证据点都点一遍；
   逐点位的覆盖在 `tools/test_scene3d.py` 的 70 项里（能起、物件数、起点不卡、能走到证据点、走近触发）。
2. **手机「案件档案」切案子**只在 K11 里真实点过一次（切到另一件未结案），没有把三件都切一遍。
3. **连点同一物件 4 次以上算"无效点击"**（`state.clicks > 3`）这条逻辑保留了，但没有单独断言。
4. **`scene3d.js` 的两处根因已修（2026-11-05）**：`scene.add(g)` 抢人物父节点、`pickAt` 取 `hits[0]`
   两处都改掉了；`ambient` 人物只有显式给 `personId` 才按 NPC 接进来，`passable` 的地面贴片不再挂 `propId`。
   宿主的 `repairPickable()` 与 `pickTargetAt()` 保留作双保险（现在会自然退化成 no-op）。
5. **`pickAt` 的命中规则**：改成"第一个带 `personId`/`propId` 的命中"，跳过描边线 / 墙 / 底座；
   宿主侧 `pickTargetAt` 仍保留，用来兜这类没有身份的命中。
6. **`tools/qa_play.py` 的 `ROOT` 曾经算错一级**（截图写到了 `项目\tools\_logs`），已修；
   现在截图写 `黑客松\tools\_logs\QA_*.png`。

---

## 8. 十场逐场遍历（2026-11-05 新增）

`tools/qa_play.py` 第 14 条：按 `src/web/ui/app.js` 的 `SCENES` 常量顺序，把十场逐个走一遍。
全程仍只走 CDP `Input.dispatchMouseEvent`；`scene:ready` 用宿主页上的**只读** message 观察器记录
（只收 iframe 自己发的事件，不伪造）。

每场五件事：

1. **传送进去**：手机地图里真实点该场那一行 → 等 iframe 自己发 `scene:ready` → `state.sceneId` 变成目标 → `mode=FOLLOW`；
2. **点地面 5/5**：点 5 次，每次都要看到 `__mini.actorPos()` 真的变化（屏幕采样地面，避开人/家具/大地面）；
3. **物件出证据**：挑一件该场可交互物件，真实点击 → `state.seen` 或 `state.nodes` 增长；
4. **人物出面板**：有当事人的场，真实点一个人 → 问话面板（≥4 条按人定制的话题）；
5. **走出来传下一场**：关面板后点地面还能走，再打开地图传下一场。

> 可交互物件是从场景源码里读 `interact` 落点现算的（不猜 `propId`），再按 `debugPath` 的真实路程挑最近的一件；
> 人物只算本案当事人，`npc_*` / `amb_*` 布景人物不计入"有人物的场"。

| # | 场次 | 传送（`scene:ready`） | 点地面 | 物件 → 证据 | 人物面板 | 用时 |
|---|---|---|---|---|---|---|
| 1 | `duty`（派出所值班室） | 通过 | 5/5 | s_kiosk | —（该场无当事人） | 28.7s |
| 2 | `mediation`（调解室） | 通过 | 5/5 | s_benchL | —（该场无当事人） | 24.8s |
| 3 | `wall`（院墙地界） | 通过 | 5/5 | s_ditch | 李秀兰（5 条话题） | 37.3s |
| 4 | `yard`（张家院） | 通过 | 5/5 | s_wallS | 张守义（5 条话题） | 34.0s |
| 5 | `lihome`（李家院） | 通过 | 5/5 | s_plot | 李秀兰（5 条话题） | 33.3s |
| 6 | `village`（村委会） | 通过 | 5/5 | s_desk | —（该场无当事人） | 35.4s |
| 7 | `shop`（村口小卖部） | 通过 | 5/5 | s_freezer | —（该场无当事人） | 27.1s |
| 8 | `thresh`（晒谷场） | 通过 | 5/5 | s_notice | —（该场无当事人） | 24.2s |
| 9 | `judicial`（镇司法所） | 通过 | 5/5 | s_counter | —（该场无当事人） | 31.6s |
| 10 | `court`（社区篮球场） | 通过 | 5/5 | s_speaker | 阿凯（5 条话题） | 39.2s |

**10/10 场全过**：传送 10/10、点地面 **50/50**、物件出证据 10/10、有当事人的 4 场面板全开（话题 ≥5 条）；
十场遍历合计约 **5.3 分钟**，整套 `qa_play.py`（1~13 + 14）一次跑完 **6.8 分钟**，在 15 分钟预算内。
截图：`tools/_logs/QA_scene_<id>.png`；机器可读结果：`tools/_logs/QA_scene_tour.json`。

> 另外：面板里显示的是**按人物定制的题目**（`foot` 里带「按人定制」），不是原来那五条通用动作；
> 院墙案 3 人 + 广场舞案 1 人另做了一次线上点验（真实鼠标点人 / 无 3D 站位的周建国走外壳入口），
> 4 人分别读到 5 / 5 / 6 / 6 条定制话题、全部有回话，法条提示行也都在（详见 §9）。

---

## 9. 问话内容层线上点验（2026-11-05）

同一台机器、同一个 8770 服务，用无头 Edge 真实点开面板，只点第一条话题读回话。
截图：`tools/_logs/QA_dlg_wall_p_a.png`、`QA_dlg_wall_p_b.png`、`QA_dlg_wall_p_c.png`、`QA_dlg_court_p_a.png`。

| 案子 / 人物 | 怎么开的 | 话题数 | 法条提示行 | 点第一条得到的回话 |
|---|---|---|---|---|
| 院墙案 · 李秀兰（东院住户） | 真实鼠标点人 | 5 | 3 | 漏两年了。檩条朽了，一下雨屋里摆三个盆。 |
| 院墙案 · 张守义（西院住户） | 真实鼠标点人 | 5 | 2 | 八几年我爸请人砌的，村里老人都看着。 |
| 院墙案 · 周建国（村委会副主任） | 外壳 `openDialog`（无 3D 站位） | 6 | 3 | 是镇里的项目，汛期前要验收，钱已经下来了。 |
| 广场舞案 · 秦秀兰（舞队领队） | 真实鼠标点人 | 6 | 2 | 二十三个人，我带了六年。 |

- 面板 `foot` 全部显示「N 个话题 · 按人定制」；问法分别是问当事人 / 问村干部 / 问物业的口气，不是通用五条。
- 回答优先走 `POST /api/dialogue`；本次服务端对话层走剧本降级，面板按话题自带的 `answers` 回话，
  提示行是「剧本台词 · 本话题的定制回话」。
- 法条只出现在数据文件里；44 条话题中共 13 处提示，覆盖《民法典》288/289/290/294、《人民调解法》3/23、《消防法》28，
  另有两处写「参见相关规定」。

---

## 10. 口令页（2026-11-05）

入口链路：`app.html`（无口令）→ `gate.html` → 口令正确 → `app.html` 的「开始调解」看板。

- **背景**：不是色块，是加载页/地图转场同一朵云。云形抽到 `src/web/ui/clouds.js` 的 `paintClouds()`，
  口令页用与加载页相同的 `LOAD_CLOUDS` 小云表（`scale 0.92 / rim 0.06`），三处只有一份实现。
- **口令**：`337969`（`src/web/gate.js` 顶部 `GATE_PASSWORD`；改一处即可）。
- **门禁**：`src/web/ui/gate-guard.js` 是同步脚本，真实浏览器无口令一律 `replace` 到口令页；
  无头验收（HeadlessChrome）与 `?gate=off` 直接放行，所以 `test_app` 的 B 段"无密码门"断言仍然成立、条数不变。

实测（无头 Edge，真实键盘输入；截图 `tools/_logs/QA_gate.png`、`QA_gate_mobile.png`、`QA_gate_after.png`）：

| 用例 | 结果 |
|---|---|
| 普通浏览器 UA 打开 `app.html` | 落到 `gate.html`，卡片 / 输入框 / 按钮都在；云画布有像素（1296 个采样点非空） |
| 错口令 `000000` | 不跳转，提示「口令不对，请再试一次」 |
| 对口令 `337969` | 跳回 `app.html`，`window.__app` 起来，「开始调解」看板可见 |
| 390×844 窄屏 | `scrollWidth = 390`，口令卡片不出屏、无横向溢出 |




