# CUA

本项目探索面向真实桌面环境的 Computer Use Agent（CUA）：`record` 把教学录制处理为结构化日志与 trace，`execution` 将其初始化为本地任务 Skill，再由 Midscene computer use 操作 Chrome、堡垒机、远程桌面或企业内网页系统。

项目不使用 browser-use、Playwright、Puppeteer 或 CDP 作为执行底座。企业内网中“先经过堡垒机，再操作目标网页”的链路必须基于真实屏幕与键盘鼠标事件。

## 目录

```text
CUA/
├── record/                 # 教学录制处理：视频、日志、截图 → trace
├── execution/              # Python 任务核心与 TypeScript Midscene 适配器
│   ├── cua/                # 转换、契约、任务解析和 CLI
│   ├── executors/          # Midscene 薄适配器与 customActions
│   ├── schemas/            # Pydantic 生成的 JSON Schema
│   └── projects/           # 本地场景与任务 Skill
├── skills/cua-midscene/    # 执行器级 Agent Skill 源文件
└── openspec/               # 规格与变更记录
```

`record` 基于 ShowUI-Aloha Learn，只保留录制处理，不包含 Act、Actor、Executor 或回放能力。`execution` 以 Python 为主体；TypeScript 仅用于调用 Midscene Node.js SDK。

## 数据流

```text
教学录制
  ↓
record：日志、截图、trace
  ↓
Python converter：初始化任务 midscene-flow.json
  ↓
人工、Agent 或未来前端确认后直接维护该 flow
  ↓ + 本次稀疏输入
resolved-flow.json
  ├─ flow run → TypeScript 逐步 executor
  └─ act run  → 有序步骤 prompt → agent.aiAct()

无录制自然语言要求
  ↓
act run → agent.aiAct()

两条路径最终均使用真实桌面 computer use
```

任务根目录的 `midscene-flow.json` 是唯一长期执行事实源。长期修正直接编辑它；Agent 必须先展示 step 原值、新值和原因，等待用户确认后才能修改。单次输入通过 CLI 参数覆盖，不回写任务。

## 快速开始

```powershell
cd execution
uv sync
npm install
npm run check
```

发现与检查示例任务：

```powershell
uv run cua scene list --json
uv run cua task list --scene browser-demo --json
uv run cua task describe --scene browser-demo --task air-tickets-demo --json
uv run cua flow validate --scene browser-demo --task air-tickets-demo
uv run cua flow inspect --scene browser-demo --task air-tickets-demo --input step-002-value=GOOGLE
uv run cua flow run --scene browser-demo --task air-tickets-demo --dry-run
uv run cua act run --scene browser-demo --task air-tickets-demo --dry-run
uv run cua act run --prompt "打开 Chrome 并搜索 GUI agent" --dry-run
```

实际执行：

```powershell
uv run cua flow run --scene browser-demo --task air-tickets-demo
uv run cua act run --scene browser-demo --task air-tickets-demo
uv run cua act run --prompt "打开 Chrome 并搜索 GUI agent"
```

从已放入任务 `source/` 的 trace 首次初始化 flow：

```powershell
uv run cua task init-from-trace --scene browser-demo --task <task-name> --goal "<任务目标>"
```

如果目标 `midscene-flow.json` 已存在，初始化会直接失败，不覆盖人工或前端修改。

## 任务资产

```text
execution/projects/<scene>/
├── scene.json
├── SKILL.md
└── <task>/
    ├── task.json
    ├── SKILL.md
    ├── midscene-flow.json
    ├── source/
    └── reports/<run-id>/
        ├── resolved-flow.json
        ├── execution-result.json
        ├── ai-act-prompt.txt
        └── ai-act-result.json
```

`task.json` 只保存输入 ID、中文说明和 `route.value` 绑定，不复制默认值。未传入参数时保留 `midscene-flow.json` 中的当前值。`reports/` 是本地运行产物，不纳入 Git。

执行模式由用户或上层 Agent 显式选择：`flow run` 适合稳定录制流程并按 step 快速执行；任务型 `act run` 将 resolved flow 组合成完整有序 prompt，由 Midscene 统一规划；自然语言 `act run` 用于没有录制资产的任务。任一模式失败都不会自动切换到另一模式。

## 录制与模型

```powershell
cd record
uv sync
uv run python Aloha_Learn\parser.py Aloha_Learn\projects\air_tickets
```

trace 每个 step 必须包含结构化 `operation`。converter 不从 Action、Expectation 或录制文本关键词猜测 route；input 必须显式提供只描述目标输入框的 `operation.locatePrompt`。执行 input 时使用 `KeyboardTypeText` 发送 ASCII 键盘事件，不依赖剪贴板。

当前实验使用火山 Ark OpenAI 兼容接口与 `minimax-m3`。真实 API Key 只放在 `record/.env` 和 `execution/.env.local`，不得提交。

## 开发验证

```powershell
cd execution
uv run pytest
uv run python -m cua.models.schema --check
npm test
```

Skill 源文件位于 `skills/cua-midscene/`，安装到本机的副本不纳入 Git：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-cua-midscene-skill.ps1
```
