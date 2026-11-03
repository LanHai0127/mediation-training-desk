# 调解台 · 基层矛盾纠纷调解模拟训练系统

> 教学演练 · 虚构案例 · 非真实警情
> 参赛赛道：赛道二 · FDE 场景交付类

给刚接手社区的派出所民警，在**接处警之后、立案之前的首次调解**里，用 20 分钟把一类高发纠纷走一遍：
看现场 → 分别谈话 → 组合方案 → 拿到一份"你哪里做错了"的复盘。

## 现在能做什么

| 能力 | 状态 |
|---|---|
| 2.5D 现场（画家算法 + 透视缩放 + A\* 寻路 + 镜头跟随） | 可用，29 种物件 · 4 个案子 |
| 点击走动 / 点击查看，移动端单指操作 | 可用（Pointer Events，无需鼠标） |
| 当事人对话（情绪/信任双状态，背靠背 vs 面对面） | 可用，模型只出口语 |
| 模型不可用时走剧本台词 | 可用（拔掉 key 也能完整体验） |
| 四维判定（诉求/底线/证据/台阶）+ 覆盖率 + 置信度 | 可用，阈值是经验值待校准 |
| 多解正确：破裂时「依法转办」判合格、「硬凑协议」判不合格 | 可用（有单独测试） |
| 训练复盘报告（四维对照、Top3 失误、未触碰诉求） | 可用，可复制文本 / 打印 PDF |
| 法条速查（8 条，带条号可溯源，只作提示） | 可用 |
| 手机：记事本（增删改/插入素材）、地点、现场素材、警情简报、须知 | 可用；记事本空着不许交方案 |
| 电话通道：拨号、通话、挂断、通话记录 | 可用；电话 = 单独沟通，能办完电话案 |
| 固定站位人物：点人即谈话 | 可用，14 个（含共用角色） |
| 场景物件 43 种 / 地面材质 6 种（球场画白线） | 可用 |
| **3D 微缩场景**（three.js）：点地走、点物走近触发、拖拽转视角 | S0 值班台可用（可走可点） |
| 一页 PPT / 答辩脚本 / 提交表 / 部署材料 | 已备（`docs/`、`deploy/`） |
| 云端 HTTPS 部署 | 未做（按要求本轮不做） |

## 跑起来

```bash
# 方式一：双击 start.bat（Windows）
# 方式二：
python src/server.py --port 8770
```

浏览器打开 `http://127.0.0.1:8770/`。零第三方依赖，Python 3.10+ 即可。

七个案子，页面右上角下拉可切：

| 案子 | 类型 | 当事人 | 特色 |
|---|---|---|---|
| 堵住的那条道 | 消防通道被占 | 2 | **一通电话办完，不用出现场** |
| 楼上的电钻 | 夜间装修噪声 | 2 | 3 个场景，证据链最完整 |
| 楼下的狗 | 宠物扰民 | 2 | 举证靠录音与物业台账 |
| 掉下来的花盆 | 高空抛物 | 2 | 查不清责任时，转办才是正确答案 |
| 六点半的球场 | 广场舞 vs 篮球 | 3 | 公共场地分时段规则 |
| 四万二的工钱 | 劳资欠薪 | 3 | 五方诉求，结构性冲突 |
| 三十公分 | 院墙越界与排水 | 3 | 5 个维度，根源解法在村委 |

## 接模型（可选）

不配也能跑：对话走剧本台词，流程完整。要接模型，二选一：

```bash
# ① 环境变量（推荐，不落盘）
set TJ_LLM_KEY=sk-xxxx
set TJ_LLM_BASE=https://api.deepseek.com/v1   # 兼容 OpenAI 格式的都可
set TJ_LLM_MODEL=deepseek-chat
```

```jsonc
// ② src/config.local.json（复制 config.local.example.json 改）
{ "llm": { "baseUrl": "https://api.deepseek.com/v1", "key": "sk-xxxx", "model": "deepseek-chat" } }
```

页面右上角会显示当前是「在线」还是「未配置 · 剧本台词」；对话坞里的「离线演示」可以随时切回剧本，
用来当场演示"拔掉模型功能不中断"。

## 验收

```bash
python tools/run_all.py            # 全跑
python tools/run_all.py --record   # 全跑并把实测断言数写进 tools/_ledger.json
```

断言数**只从 `_ledger.json` 读**，不手抄。0 条断言 + 非零退出会被判为"没跑起来"并拒绝记账。

移动端布局用 CDP 探针量（不靠肉眼）：

```bash
~/.workbuddy/binaries/python/envs/default/Scripts/python.exe tools/ui_probe.py --width 390 --height 844
```

## 目录

```
src/
  server.py          标准库 HTTP 服务：路由 / 安全头 / 登录闸 / 限流 / 版本探针
  auth.py            鉴权：PBKDF2 + 双闸失败限速 + 回环豁免需对端也回环
  game/
    __init__.py      案子加载、训练会话、公开视图（隐情不下发）
    dialogue.py      当事人对话：意图识别 → 状态增量 → 模型/剧本出口语
    llm.py           模型调用：失败一律返回 None，上层降级，不抛异常
  cases/case_01_noise/case.json   案子：3 场景 / 32 点位 / 2 当事人 / 6 条事实
  web/
    scene.js         2.5D 场景引擎（SPOT_KINDS 注册表 / A* / 投影 / 绘制）
    app.js           前端胶水：API、场景、面板、对话
    app.css          政务蓝 + 暖灰，全部走 :root 变量
tools/
  run_all.py         台账式验收
  test_smoke.py      服务与页面（10 项）
  test_art.py        场景物件双向契约（9 项，拼错 kind 必须变红）
  test_llm.py        对话层与降级（14 项）
  test_judge.py      判定内核与复盘（28 项）
  test_laws.py       法条库可溯源（16 项）
  test_scene3d.py    3D 场景交互（10 项，需 websocket-client）
  test_call.py       电话通道（15 项）
  test_notes.py      记事本与提交门槛（18 项）
  test_api.py        接口边界与并发（20 项）
  test_ui.py         浏览器真实点击/拖动流程（17 项，需 websocket-client）
  ui_probe.py        CDP 布局探针（量 scrollWidth / 抓窄屏溢出 / 模拟真实点击）
  make_ppt.py        生成一页 PPT（数字取自 ledger）
docs/
  调解台-一页PPT.pptx    比赛要求的一页 PPT（7 模块）
  答辩脚本.md            8 分钟逐段脚本 + 提问预备
  部署说明.md            只加不改的部署流程（systemd / Docker / nginx）
  提交表.md              17 字段草稿
  场景与人物建模提示词.md  3D 微缩场景提示词（v3，细节密度版）
  archive/               旧版 2.5D 提示词存档
deploy/                Dockerfile / systemd unit / nginx conf（未部署）
```

## 合规

- 全部案件、姓名、地址、电话均为虚构；页面常驻角标「教学演练 · 虚构案例 · 非真实警情」
- 生成的任何文本不具法律效力，不替代真实执法决策
- 不使用真实警务标识与真实单位名称
- 细则见 `docs/COMPLIANCE.md`，每条都写明在哪兑现
