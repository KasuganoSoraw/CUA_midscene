# CUA

本项目探索面向真实桌面环境的 Computer Use Agent（CUA）：`record` 将教学录制处理为结构化日志与 trace，`execution` 将 trace 直接初始化为 Midscene YAML 任务，并通过 Midscene computer use 操作 Chrome、堡垒机、远程桌面或企业内网页系统。

项目不使用 browser-use、Playwright、Puppeteer 或 CDP 作为执行底座。企业内网中“先经过堡垒机，再操作目标网页”的链路必须基于真实屏幕与键盘鼠标事件。

## 目录

```text
CUA/
├── record/                 # 教学录制处理：视频、日志、截图 -> trace
├── execution/              # 可独立发布的 CUA Midscene Skill
│   ├── cua/                # Python 转换、任务解析和 CLI
│   ├── executors/          # 极薄的 Midscene YAML runner 与 customActions
│   ├── projects/           # 本地场景与任务 Skill
│   ├── schemas/            # Pydantic 生成的稳定 JSON 契约
│   ├── SKILL.md            # 执行器 Skill 入口
│   └── references/         # Agent 按需读取的任务契约
└── openspec/               # 规格与变更记录
```

`record` 基于 ShowUI-Aloha Learn，只保留录制处理，不包含 Act、Actor、Executor 或回放能力。`execution` 以 Python 为主体；TypeScript 仅用于注册 Midscene customAction 和调用 `agent.runYaml()`。

## 数据流

```text
教学录制
  -> record：日志、截图、trace
  -> Python converter：task.yaml + task.json
  -> 人、Agent 或未来前端确认后直接维护 task.yaml
  -> Python 解析本次输入：reports/<run-id>/resolved-task.yaml
  -> TypeScript：agent.runYaml()

无录制自然语言要求
  -> 临时单 action YAML
  -> 同一个 agent.runYaml()
```

`task.yaml` 是任务唯一长期执行事实源，直接使用 Midscene 原生 YAML action。`task.json` 保存任务说明、trace 来源、输入 ID 和录制默认值。系统不维护自定义 route、resolved flow、override、proposal 或 history。

## 快速开始

```powershell
cd execution
uv sync
npm install
npm run check

uv run cua scene list --json
uv run cua task list --scene browser-demo --json
uv run cua task describe --scene browser-demo --task air-tickets-demo --json
uv run cua task validate --scene browser-demo --task air-tickets-demo
uv run cua task inspect --scene browser-demo --task air-tickets-demo --input step-002-input=GOOGLE
uv run cua task run --scene browser-demo --task air-tickets-demo --dry-run
uv run cua act run --prompt "打开 Chrome 并搜索 GUI agent" --dry-run
```

实际操作电脑时去掉 `--dry-run`：

```powershell
uv run cua task run --scene browser-demo --task air-tickets-demo
uv run cua act run --prompt "打开 Chrome 并搜索 GUI agent"
```

从已放入任务 `source/` 的 trace 初始化任务：

```powershell
uv run cua task init-from-trace --scene <scene> --task <task> --goal "<任务目标>"
```

若 `task.yaml` 或 `task.json` 已存在，初始化直接失败，不覆盖人工或前端修改。

## 任务资产

```text
execution/projects/<scene>/
├── scene.json
├── SKILL.md
└── <task>/
    ├── task.yaml                 # 唯一长期执行事实源
    ├── task.json                 # 元数据、trace 来源和输入默认值
    ├── SKILL.md
    ├── source/                   # trace、日志和截图
    └── reports/<run-id>/         # Git 忽略
        ├── resolved-task.yaml
        └── execution-result.json
```

trace 每个 step 必须包含结构化 `operation`。converter 不从 observation、Action、Expectation 或关键词猜测动作。每个 trace step 生成一个名为 `step-NNN | <operation-type>` 的 Midscene task，整体目标保存在 `task.json.goal` 和 YAML `agent.groupDescription`。input 必须显式提供 `operation.locatePrompt` 和 `operation.value`，并生成 `KeyboardTypeText` action；该动作通过底层键盘事件输入 ASCII，不使用剪贴板。

输入参数 ID 由对应步骤派生，例如 `step-002-input`，YAML 使用显式 `{{step-002-input}}` 占位符。同一参数需要影响后续动作时，应经确认后在相关 YAML prompt 中复用同一个占位符；系统不会根据业务文本自动猜测关联。

## 模型与验证

当前实验使用火山 Ark OpenAI 兼容接口与 `minimax-m3`。真实 API Key 只放在 `record/.env` 和 `execution/.env.local`，不得提交。

```powershell
cd execution
uv run pytest
uv run python -m cua.models.schema --check
npm test
```

安装本地 Skill 副本：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-cua-midscene-skill.ps1
```
