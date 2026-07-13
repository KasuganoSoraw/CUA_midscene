# CUA

本项目探索面向真实桌面环境的 Computer Use Agent（CUA）：用户通过教学录制提供操作证据，系统把录制产物转换为可校准、可参数化的任务包，再由 Midscene computer use 操作本地 Chrome、堡垒机、远程桌面或企业内网页系统。

项目不使用 browser-use、Playwright、Puppeteer 或 CDP 作为执行底座。对于公司内网中“先经过堡垒机，再操作目标网页”的链路，执行器必须基于真实屏幕和键盘鼠标事件。

## 目录定位

```text
CUA/
├── record/            # 教学录制处理：视频/日志/截图 → trace
├── execution/         # Python 任务核心与 TypeScript Midscene 执行器
│   ├── cua/           # 转换、契约、任务、校准、CLI
│   ├── executors/     # Midscene 薄适配器和 customActions
│   ├── schemas/       # 从 Pydantic 生成的 JSON Schema
│   └── projects/      # 可由 Agent 调用的业务任务包
├── skills/            # 仓库内维护的 Codex Skill 源文件
└── openspec/          # 规格与变更记录
```

`record` 以 ShowUI-Aloha Learn 为基础，只负责录制信息处理，不包含 Act、Actor、Executor 或回放能力。`execution` 是主执行域，以 Python 为主体技术栈；TypeScript 仅用于调用官方 Midscene Node.js SDK。

## 总体流程

```text
教学录制
  ↓
record：结构化日志 / trace
  ↓
Python converter：基础 midscene-flow.json
  ↓
已确认校准 + 本次稀疏参数
  ↓
resolved-flow.json
  ↓
TypeScript Midscene executor
  ↓
真实桌面 computer use
```

基础 IR 可以重新生成，不作为长期人工维护文件。长期修正写入已确认校准；单次变化通过调用参数覆盖。Agent 生成的校准建议必须先展示差异并等待用户确认，未经确认不得应用、自动重试或操作电脑。

## 环境与密钥

当前实验使用火山 Ark 的 OpenAI 兼容接口：

```text
https://ark.cn-beijing.volces.com/api/coding/v3
```

当前模型名为 `minimax-m3`。真实 API Key 不提交仓库：

```powershell
Copy-Item execution\.env.example execution\.env.local
Copy-Item record\.env.example record\.env
```

- `record/.env`：ShowUI-Aloha Learn 生成语义 trace。
- `execution/.env.local`：Midscene computer use 屏幕理解与动作执行。

## 快速开始

初始化执行域：

```powershell
cd execution
uv sync
npm install
npm run check
```

转换、检查和 dry-run 样例任务：

```powershell
uv run cua flow convert --project air-tickets-demo --goal "将 Qatar Airways 订票页面设置为 Singapore 到 Los Angeles 的单程航班搜索"
uv run cua flow validate --project air-tickets-demo
uv run cua flow inspect --project air-tickets-demo --input step-002-value=GOOGLE
uv run cua flow run --project air-tickets-demo --dry-run
```

实际执行：

```powershell
uv run cua flow run --project air-tickets-demo
```

执行前 Python 会把基础 IR、已确认校准和本次参数合并为 `reports/<run-id>/resolved-flow.json`。TypeScript executor 只消费该快照，不读取项目配置或重新解析参数。

## 录制处理

```powershell
cd record
uv sync
uv run python Aloha_Learn\parser.py Aloha_Learn\projects\air_tickets
```

trace 的 `operation.prompt` 应包含足够的视觉定位信息；input 还应提供只描述目标输入框的 `operation.locatePrompt`。执行时 input 使用 `KeyboardTypeText` 发送 ASCII 键盘事件，不依赖剪贴板。

## 校准与参数

```powershell
cd execution
uv run cua project list --json
uv run cua calibration validate --project <project-name> --proposal <proposal-id>
uv run cua calibration apply --project <project-name> --proposal <proposal-id> --confirmed
```

合并与校准不调用模型。待确认 proposal 不影响 inspect 或 run。缺失、增加或重排 step 属于 trace 结构问题，不通过 overrides 隐式修补。

## 当前状态

已完成：

- record 教学录制处理与中文 trace 生成。
- trace 到基础 Midscene IR 的 Python 确定性转换。
- Pydantic 持久化契约与可复现 JSON Schema。
- 任务发现、稀疏参数、人工校准和 resolved flow。
- Python CLI 与 Node Midscene 薄执行器进程协议。
- 无剪贴板 `KeyboardTypeText` customAction。
- 可安装的 `cua-midscene` Codex Skill。

后续重点：

- 从成功运行中沉淀更快的固化步骤或脚本派生产物。
- 建立明确、可审计且由人触发的失败诊断与视觉恢复流程。
- 面向华为网管系统沉淀可复用任务模板。

## Agent Skill

Skill 源文件位于 `skills/cua-midscene/`，本机安装副本不纳入 Git：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-cua-midscene-skill.ps1
```

本仓库以 `CUA` 根目录作为唯一 Git 仓库。密钥、依赖目录、虚拟环境和运行报告均被忽略。
