# CUA

本项目用于探索面向真实桌面环境的 Computer Use Agent（CUA）方案。当前重点是验证一条可落地的路径：用户先通过录制产生可理解的操作信息，再由 Midscene 作为主执行器，在本地 Chrome、堡垒机、远程桌面或企业内网页系统中完成电脑操作。

项目短期目标不是做 browser-use，也不是直接通过 Playwright、Puppeteer、CDP 等浏览器自动化协议控制页面。目标场景是公司内环境中常见的“先经过堡垒机或远程桌面，再进入目标网页系统”的链路，因此底座优先选择视觉驱动的 computer use。

## 项目定位

当前仓库由两个子项目组成：

```text
CUA/
├── execution/         # 执行域：任务转换、校准、参数化调用和执行器
│   └── projects/      # 可由 Agent 调用的业务任务包
├── record/            # 录制域：从录制资源生成结构化日志和 trace
├── skills/            # 仓库内维护的 Codex Skill 源文件
└── openspec/          # 需求规格与变更记录
```

### execution

`execution` 是本项目的执行域，负责 trace 转换、任务校准、参数化调用以及使用 `@midscene/computer` 操作真实桌面应用。

当前该目录不再保留早期手写实验脚本。后续企业网管系统的自动化执行会优先沉淀在这个目录下。Midscene 是主执行器，负责感知屏幕、定位元素、点击、输入和处理失败后的视觉回退。

`execution/projects/<project-name>/` 用于保存单个业务流程的全部执行产物：

- `source/`：ShowUI-Aloha Learn 生成的 trace、processed log 和截图。
- `ir/`：可重新生成的基础 Midscene flow，例如 `midscene-flow.json`。
- `config/`：任务说明、录制默认输入和已经确认的人工校准。
- `calibration/`：Agent 待确认的校准建议及已应用历史。
- `generated/`：后续从 flow 派生出的 Midscene 脚本。
- `reports/`：执行报告及本次 resolved flow 快照，不提交 Git。

### record

`record` 当前以 ShowUI-Aloha Learn 为实现基础，只负责教学录制信息处理，不承担执行和回放。

也就是说，该目录现在只保留上游项目中与学习侧相关的能力；原本用于 Actor、Executor、执行和回放的 `Aloha_Act` 已删除。

- 读取录制产生的视频和输入日志。
- 抽取截图、鼠标、键盘等操作信息。
- 生成结构化操作日志。
- 生成可供后续模型理解的 trace，并在 trace 中输出面向 Midscene 的最小 `operation` 动作结构。

本项目暂不计划把 ShowUI-Aloha 作为最终执行器。当前已具备从 ShowUI-Aloha trace 转换为 Midscene flow IR 的初版能力，后续会继续基于这些结构化信息生成更快的固化脚本，并在脚本失败时回退到 Midscene 视觉操作。

## 总体流程设想

```text
用户教学录制
    ↓
ShowUI-Aloha Learn
    ↓
结构化操作日志 / trace（含 operation prompt、locatePrompt）
    ↓
转换为基础 Midscene flow IR
    ↓
已确认校准 + 本次参数
    ↓
resolved flow
    ↓
Midscene computer use 执行
```

这个拆分的核心原因是速度和稳定性：

- 录制阶段提供足够多的用户意图、页面上下文和操作轨迹。
- 固定流程可以尽量转换成脚本化或半脚本化执行，减少每一步都依赖视觉模型的成本。
- 当页面变化、坐标失效或流程失败时，再回退到 Midscene 的视觉操作能力。

## 环境与密钥

本项目当前使用火山 Ark 的 OpenAI 兼容接口进行实验：

```text
https://ark.cn-beijing.volces.com/api/coding/v3
```

模型名当前配置为：

```text
minimax-m3
```

真实 API Key 不应提交到仓库。请分别复制示例环境文件并在本地填写：

```powershell
Copy-Item execution\.env.example execution\.env.local
Copy-Item record\.env.example record\.env
```

其中：

- `execution/.env.local` 用于 Midscene computer use。
- `record/.env` 用于 ShowUI-Aloha Learn 阶段调用 OpenAI 兼容接口生成 trace。

这些本地环境文件已经被 `.gitignore` 忽略。

## 运行 Midscene 转换与执行实验

进入 Midscene 目录：

```powershell
cd execution
npm install
```

检查环境：

```powershell
npm run check
```

将 ShowUI-Aloha trace 转换为 Midscene flow：

```powershell
npm run flow:convert -- --project air-tickets-demo --goal "将 Qatar Airways 订票页面设置为 Singapore 到 Los Angeles 的单程航班搜索"
```

这一步当前不调用模型，只做确定性规则映射。模型调用发生在 ShowUI-Aloha Learn 生成 trace 阶段，以及 Midscene runner 实际执行 flow 阶段。

使用通用 runner 执行 Midscene flow：

```powershell
npm run flow:run -- --project air-tickets-demo
```

列出任务、验证和检查最终执行内容：

```powershell
npm run project:list -- --json
npm run flow:validate -- --project air-tickets-demo
npm run flow:inspect -- --project air-tickets-demo --input step-002-value="GOOGLE"
```

调用输入采用稀疏覆盖：只传本次需要改变的 input id，其余输入继续使用 `config/project.json` 中的录制默认值。`flow:inspect` 和 `flow:run` 共用同一个确定性 resolver，合并顺序固定为基础 IR、已确认校准、本次输入；该过程不调用模型。

Agent 发现长期流程错误时，应先在 `calibration/proposals/` 生成修改建议并展示差异。只有用户明确确认后才能执行：

```powershell
npm run calibration:validate -- --project air-tickets-demo --proposal <proposal-id>
npm run calibration:apply -- --project air-tickets-demo --proposal <proposal-id> --confirmed
```

待确认 proposal 不参与执行。人工可以直接编辑 `config/flow-overrides.json`，但必须随后运行 `flow:validate`。

注意：`flow:run` 是执行 flow，不是转换 trace。整体链路中，`flow:convert` 才是 trace 到 `midscene-flow.json` 的转换命令。新增项目时不需要再新增 npm script，只需要替换 `--project <project-name>`；如果目标说明变化，同时传入新的 `--goal`。

当前样例 flow 会保留 trace 中的 `operation.prompt`。对于文本输入，trace 还必须提供只描述输入框目标的 `operation.locatePrompt`，converter 会把它写入 input route，runner 按 route 顺序执行。真正无法映射为可执行策略的步骤会被标记为 `manual-review` 并 fail fast。

执行阶段的文本输入不使用 Midscene 内置 `aiInput`。runner 会调用自定义 `KeyboardTypeText` action，把 input route 的 `locatePrompt` 传给该 action 的 `locate` 字段复用 Midscene 定位管线，再用键盘事件逐键输入，避免在堡垒机或远程桌面中依赖外部剪贴板。

converter 会根据 `processed-log-sc.json` 中相邻动作的 `timestamp` 生成 `timing.waitBeforeMs`，runner 在执行每个 step 前按该时间做确定性等待。当前等待时间会忽略极短间隔，并将长间隔最多截断为 30 秒，避免把录制中的异常长停顿完整带入执行。runner 不再在定位失败后默认调用 `aiWaitFor` 重试；`aiWaitFor` 只应来自显式 `wait` route 或后续明确标记的页面跳转场景。

注意：执行阶段使用的是 Midscene 的 computer use 能力，操作真实桌面应用。它不依赖 browser-use，也不通过浏览器调试协议直接控制网页。

## 运行 ShowUI-Aloha Learn 实验

进入 ShowUI-Aloha 目录：

```powershell
cd record
uv sync
```

基于上游示例录制生成结构化日志和 trace：

```powershell
uv run python Aloha_Learn\parser.py Aloha_Learn\projects\air_tickets
```

该流程会处理录制资源，并生成 learn 阶段产物。当前这些生成物主要用于分析和转换实验，不作为最终执行入口。

## 当前边界

已完成：

- 初始化 Midscene computer use 实验工程。
- 配置火山 Ark OpenAI 兼容接口。
- 引入 ShowUI-Aloha，并跑通 learn 阶段的 trace 生成。
- 初步打通 ShowUI-Aloha trace 到 Midscene flow 的转换链路，converter 优先消费 trace 中的 `operation.prompt`，并在 input route 中使用 `operation.locatePrompt` 定位输入框。
- 新增通用 runner，能够读取 `midscene-flow.json` 并按 route 调用 Midscene computer use。
- 将 input route 改为 Midscene 自定义 `KeyboardTypeText` action 执行，避免剪贴板输入。
- 将项目扩展为基础 IR、已确认校准、本次参数和 resolved flow 分层的可调用任务包。
- 提供项目发现、验证、检查、校准审批和参数化运行 CLI。
- 提供仓库内 `cua-midscene` Codex Skill，约束 Agent 区分创建、校准和调用。

待实现：

- 将一次成功执行的流程固化为更快的脚本化步骤。
- 设计明确且可审计的失败诊断与视觉恢复流程；当前不自动修改任务或失败后重试。
- 面向华为网管系统沉淀可复用的任务模板和失败恢复策略。

## 安装 Agent Skill

Skill 源文件由仓库中的 `skills/cua-midscene/` 维护。本机安装副本位于 `$CODEX_HOME/skills` 或 `~/.codex/skills`，不纳入 Git：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-cua-midscene-skill.ps1
```

## 版本管理说明

本仓库以 `CUA` 根目录作为唯一 Git 仓库维护。`record` 中的 ShowUI-Aloha 源码纳入当前项目，但不保留其上游 Git 历史。

本地密钥、依赖目录、运行报告、虚拟环境和生成 trace 默认不提交。
