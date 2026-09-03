# CUA

本项目探索面向真实桌面环境的 Computer Use Agent（CUA）：顶层 Python `agent` 接收 Main Agent 委派的完整任务并完成任务级 Tool Calling；`record` 将教学录制处理为结构化日志与 trace；TypeScript `execution` 通过 Midscene computer use 操作 Chrome、堡垒机、远程桌面或企业内网页系统。

项目不使用 browser-use、Playwright、Puppeteer 或 CDP 作为执行底座。企业内网中“先经过堡垒机，再操作目标网页”的链路必须基于真实屏幕与键盘鼠标事件。

## 目录

```text
CUA/
├── component.toml          # 可装配组件的版本、运行时与 Python 包声明
├── docs/                   # 组件发行与宿主集成说明
├── agent/                  # Python CUA Subagent：definition、模型 loop、私有 Tool 与事件
├── recorder/               # Windows 录制 Worker：PyAV 视频、Win32 键鼠与全局快捷键
├── record/                 # 教学录制处理：视频、日志、截图 -> trace
├── execution/              # TypeScript Computer-Use Runtime
│   ├── cua/                # 转换、任务解析、执行编排和底层公开 API
│   ├── cli/                # 开发与安装后的命令入口
│   ├── executors/          # Midscene 适配与 KeyboardTypeText
│   ├── runtime-bridge/     # Python Agent 使用的版本化 JSONL Runtime 边界
│   ├── projects/           # 随 Skill 发布的只读内置任务
│   ├── schemas/            # Ajv 在文件边界使用的 JSON Schema
│   ├── SKILL.md            # 执行器 Skill 入口
│   └── references/         # Agent 按需读取的任务契约
├── scripts/                # 组件构建、结构校验与 clean-room smoke test
└── openspec/               # 规格与变更记录
```

`recorder` 是 Windows-only 采集进程，生成 MP4 与键鼠 TXT；`record` 基于 ShowUI-Aloha Learn，负责录制后处理，不包含 Act、Actor、Executor 或回放能力。`execution` 使用 TypeScript，在 Runtime worker 自身进程内直接调用 Midscene，并通过 JSONL Runtime bridge 服务 Python Agent。`execution` 可作为底层 Skill/CLI 独立发布，不安装为本机 Codex Skill。

顶层 `agent/` 是唯一 canonical CUA Subagent。它提供 Python `cua-agent` 包、自身定位与 instructions、一次 invocation 内的模型 Tool Calling，以及私有 `cua_catalog`、`cua_execute`、`cua_workbench`。GDEClaw 只提交完整任务并接收事件与最终结果，不注册内部 Tool，也不承担第二层 Computer-Use 推理。CUA Subagent 不保存跨调用上下文或 Memory；Midscene 管理更下层的截图、页面状态和动作上下文。

Workbench 的“Agent 调试”页签只在使用 `review --dev` 启动时出现，直接调用 Python Agent invocation。它是薄的开发调试入口，不承载聊天产品、跨调用上下文或 Agent 决策逻辑。Host Adapter 使用相同的高层请求、事件与结果语义。

## 集成边界与术语

- 仓库发布 Python `CuaAgent`、单次 `cua-agent invoke` 进程协议、私有 Tool loop、TypeScript Runtime bridge 和 `review --dev` 调试入口。
- GDEClaw 注册与生命周期 Adapter、常驻 Agent 服务、跨调用 Session、网络 API 和实时事件传输属于 Host 产品边界，不由本仓库提供。
- `execution/SKILL.md` 是底层 CLI 的操作与维护说明；场景/任务目录中的 `SKILL.md` 是随任务包交付的维护说明。Python Agent 不读取这些 Markdown，而是通过 `cua_catalog` 获取结构化 scene/task 数据。
- Python Agent 的私有 Tool 可以把受控调用摘要作为诊断结果返回，但 GDEClaw 不注册、选择或直接调用这些 Tool。

## 数据流

```text
教学录制
  -> recorder：采集 MP4 + 键鼠 TXT（也可使用兼容的既有录制）
  -> record：日志、全屏截图、带红叉 trace crop、干净 reference patch、trace
  -> task create-from-recording：自动规范化 source、初始化并静态验证任务
  -> TypeScript converter：task.yaml + task.json
  -> 开发者、Review 或维护型 Agent 确认后直接维护 task.yaml
  -> TypeScript resolver：<CUA_DATA_ROOT>/runs/<run-id>/resolved-task.yaml
  -> task run：按多个 Midscene task 顺序执行
  -> act run --scene/--task：投影为完整步骤 prompt，再执行单个 ai action

无录制自然语言要求
  -> GDEClaw Main Agent：委派完整任务
  -> Python CUA Agent：选择私有 Tool 与 freeform 策略
  -> JSONL Runtime bridge：调用 TypeScript execution
  -> TypeScript runNaturalLanguageAiAct()：直接调用原生 agent.aiAct()
```

`task.yaml` 是任务唯一长期可执行流程，直接使用 Midscene 原生 YAML action。`task.json` 保存任务说明、trace 来源、输入 ID 和录制默认值；`source/` 是校准时的只读录制证据。必要的 click/doubleClick 可以在 YAML 中使用 Midscene 原生 `locate.images` 引用 `source/` 下的干净 reference patch；它是语义定位参考，不是坐标模板。系统不维护自定义 route、resolved flow、override、proposal 或 history。

## 快速开始

完整源码开发需要分别准备三个 Python 工程和 TypeScript Runtime：

```powershell
Copy-Item .env.example .env.local
# 编辑仓库根 .env.local，填写模型配置、数据根和可选录制输出根

cd agent
uv sync --locked

cd ..\record
uv sync --locked

cd ..\recorder
uv sync --locked

cd ..\execution
npm ci
npm run check
npm run build

npm run cua -- review --no-open
npm run cua -- review --dev --no-open
```

普通 `review` 用于任务与录制复核；`review --dev` 额外提供无 Session 的 Agent 自然语言调试入口。完整 CLI 命令见 [`execution/README.md`](./execution/README.md)，Agent 进程调用见 [`agent/README.md`](./agent/README.md)。

执行器要求 Node.js `>=22.18.0`。

实际操作电脑时去掉 `--dry-run`。Runtime 不提供跨进程并发锁，上层调用方必须串行发起真实 computer use；查询、转换、inspect 和 dry-run 不操作电脑。

底层 TypeScript Runtime 的嵌入方可以从 execution 包根入口导入独立 API，不需要生成 YAML，也不需要启动额外任务 runner。它不是 GDEClaw Main Agent 的 canonical 集成入口；GDEClaw 应调用顶层 Python Subagent：

```ts
import { runNaturalLanguageAiAct } from 'cua-midscene';

const run = await runNaturalLanguageAiAct({
  prompt: '打开 Chrome 并搜索 GUI agent',
  runsRoot: 'C:\\path\\to\\cua-data\\runs',
});
```

该 API 保存 `ai-act-prompt.txt` 和 `ai-act-result.json`，随后由 `executors/midscene-ai-act.ts` 直接调用一次 `agent.aiAct()`。现有三个 CLI 执行模式和任务资产格式均未改变。

`task create-from-recording` 是从原始录制创建任务的默认入口。`--goal` 仅作为创建后任务的描述信息，不会进入 trace 生成 prompt；可以省略，省略时任务 goal/description 与 YAML groupDescription 保存空字符串。命令会运行 record parser、复制标准化生成资产、初始化任务并完成静态验证，不复制原始视频和事件日志。

仅当 trace 与 processed log 已经放入 user task `source/` 时，使用高级初始化入口：

```powershell
npm run cua -- task init-from-trace --scene <scene> --task <task> --goal "<任务目标>"
```

若 `task.yaml` 或 `task.json` 已存在，初始化直接失败，不覆盖人工或前端修改。

## Skill 与用户数据

```text
execution/projects/<scene>/          # 随 Skill 发布，只读
└── <task>/
    ├── task.yaml                    # 唯一长期执行事实源
    ├── task.json                    # 元数据、trace 来源和输入默认值
    ├── SKILL.md
    └── source/                      # trace、日志、截图和 reference patch

<CUA_DATA_ROOT>/
├── projects/<scene>/<task>/         # 用户创建和长期维护的任务数据包
├── cache/
└── runs/<run-id>/
    ├── resolved-task.yaml
    ├── ai-act-prompt.txt            # 仅录制任务整体 aiAct
    ├── ai-act-task.yaml             # 仅录制任务整体 aiAct
    ├── execution-result.json
    ├── ai-act-result.json           # 仅原生 aiAct API
    └── midscene/                    # Midscene 报告、截图等产物
```

数据根优先级为 `--data-root`、进程 `CUA_DATA_ROOT`、仓库根 `.env.local`、仓库根 `.env`。`CUA_PYTHON_EXECUTABLE` 是组件宿主提供的统一 Python，必须已经安装 `cua-agent`、`cua-recorder` 与 `cua-record`；源码开发未设置时，record 后处理和 Windows recorder 分别使用相邻工程的 `.venv`。`CUA_RECORDINGS_ROOT` 是 review 页面读取并写入新录制的原始录制集合；缺少它不会阻止任务复核启动，录制页只提示变量名、配置位置和示例，不直接修改本机环境。发现命令可只读取内置任务；创建、验证和执行必须配置数据根。同一 `scene/task` 在 builtin 与 user 两处重复会显式失败。

trace 每个 step 必须包含结构化 `caption.operation`。converter 不从 observation、think、action、expectation 或关键词猜测动作。click、doubleClick、input、keyboard、wait 分别转换为 `aiTap`、`aiDoubleClick`、`KeyboardTypeText`、`KeyboardPress`、`aiWaitFor`。click/doubleClick 仅在 `useReferenceImage: true` 时绑定对应 processed log 的 `screenshot_reference`；证据缺失、越界或文件不存在会直接失败。canonical YAML 保存任务内相对图片路径，resolver 验证后只在本次运行快照中改为绝对路径，逐步执行和整体 aiAct 均保留图片 prompt。`KeyboardTypeText` 通过底层键盘事件输入 ASCII，不使用剪贴板。

## 验证与打包

仓库根 `.env.example` 是源码开发的完整变量契约；真实值只放在被忽略的根 `.env.local` 或进程环境中，不得提交。TypeScript Runtime 自动读取根环境文件，进程环境优先；Python 包由 Review/Runtime 注入环境，独立运行时使用 `uv run --env-file ..\.env.local ...`。`CUA_AGENT_MODEL_*` 未设置时读取相应的 `MIDSCENE_MODEL_*`。组件发布物不携带环境文件，产品态由 Host 注入进程环境。

```powershell
cd execution
npm test
npm run build
npm pack --dry-run

cd ..\agent
uv lock --check
uv run --locked pytest
uv run --locked ruff check .
uv run --locked mypy

cd ..\recorder
uv lock --check
uv run --locked python -m unittest discover -s tests -v

cd ..\record
uv lock --check
uv run --locked python -m unittest discover -s tests -v
```

## 可装配组件

`component.toml` 定义组件版本、兼容运行时和三个 Python wheel。构建产物是供 Host 安装的组件目录，不携带 Python 或 Node/Electron executable：

```powershell
uv run --project record --locked python scripts\build_component.py --force
uv run --project record --locked python scripts\verify_component.py dist\computer-use-component
```

组件目录结构、clean-room smoke test、本地 Host 安装、直接运行和 GDEClaw/Electron 适配见 [`docs/component-distribution.md`](./docs/component-distribution.md)。运行阶段只启动已安装模块和 Runtime，不执行依赖解析、安装、lock 或构建。
