# Execution

该目录是可独立构建的 TypeScript Computer-Use Runtime 与 `cua-midscene` 底层 Skill。TypeScript 核心负责调用外部 record 后处理器、把 trace 初始化为 Midscene YAML 任务、发现任务、解析本次输入、生成运行投影并直接调用 Midscene computer use；Review 通过独立 Windows recorder Worker 采集新录制。面向 GDEClaw 的 canonical Subagent 位于仓库顶层 Python `agent/`；本目录不发布 Agent definition 或模型 loop。

## 模块职责

```text
record trace
  -> cua/recording：调用外部 Python record 后处理器、规范化 source、初始化并验证任务
  -> cua/conversion：caption.operation -> task.yaml + task.json
  -> cua/task：数据根、catalog、YAML、输入、aiAct 投影与执行编排
  -> cua/act：无录制自然语言原生 aiAct 公开 API
  -> cli：开发命令和安装后 bin 的统一入口
  -> cua/index.ts：底层 TypeScript Runtime 嵌入 API
  -> review：Vue 本地复核应用、localhost 服务与复核专属 service
  -> runtime-bridge：Python Agent 调用 catalog、execute、workbench 的版本化 JSONL 边界
  -> executors：ComputerAgent、KeyboardTypeText、agent.runYaml()、agent.aiAct()
```

- `cua/contracts/`：普通 TypeScript 类型和 Ajv 文件边界校验。
- `runtime-bridge/`：向顶层 Python Agent 提供 JSON/JSONL catalog、execute、workbench 契约；不包含模型、prompt、Session 或 GDEClaw 逻辑。
- `cua/recording/`：定位外部 record 环境、运行 parser、复制标准化生成资产并编排任务创建。
- `cua/conversion/`：只根据结构化 trace operation 初始化任务；被标记的 click/doubleClick 会绑定 processed log 中的 reference patch。
- `cua/task/`：双 catalog、YAML、输入、运行快照和执行编排。
- `cua/act/`：不依赖录制任务或 YAML 的自然语言原生 aiAct 调用。
- `cli/`：统一命令分发与 stdout/stderr 输出协议。
- `review/`：与 `cua/` 平级的本地工作台；`service/` 组合任务资产、录制证据、Windows recorder 和执行控制，`server/` 使用 Fastify 提供受控 HTTP，`web/` 使用 Vue 3。
- `executors/`：Midscene 薄适配器、环境读取和 customAction。
- `projects/`：随 Skill 发布的只读内置任务。
- `schemas/`：CUA 自有持久化 JSON 契约；不复制 Midscene action 类型系统。
- `tests/`：契约、转换、任务、CLI 和执行器测试。
TypeScript 内部不建立与持久化契约重复的运行时模型类。Ajv 只校验从磁盘进入系统的 scene、task、trace 和执行结果；resolved YAML 最终交给 Midscene parser。

## Python Agent 与 Runtime Bridge

唯一 canonical Computer-Use Subagent 位于仓库顶层 `agent/`。GDEClaw 只调用其高层 `{ task }` invocation；Python Agent 自己运行模型 Tool Calling、判断 Recorded Skill、选择 replay/guided/freeform，并把 GUI 微观规划交给 Midscene。`cua_catalog`、`cua_execute`、`cua_workbench` 是 Python Agent 私有 Tool，不是 GDEClaw 的公共 Tool。

GDEClaw 专用 Adapter 属于 Host 产品边界。本仓库提供 Python API、一次一进程的 `cua-agent invoke` 和 Review 开发调用。`execution/SKILL.md` 及场景/任务 `SKILL.md` 面向 CLI 操作、维护和打包；Python Agent 不读取这些 Markdown，`cua_catalog` 只返回结构化 catalog/manifest/YAML 摘要。

本包只通过 `cua-midscene/runtime-bridge` 和构建后的 `dist/runtime-bridge/worker.js` 提供版本化 JSONL Runtime：

```text
GDEClaw Main Agent
  -> Python cua-agent（definition、模型 loop、私有 Tool、事件）
  -> TypeScript Runtime bridge（catalog、execute、workbench）
  -> Midscene computer use
```

JSONL request 包含 `schemaVersion`、`requestId`、`method`、`payload`；response 使用相同 request id，并明确区分 result 与结构化 error。worker stdout 只输出协议 frame，诊断写 stderr。一次 Python invocation 可复用一个 Node worker，invocation 结束即释放；不同 invocation 不共享模型 messages 或 Runtime 状态。

普通 `review` 不展示或注册 Agent API；开发者使用 `review --dev` 才能看到“Agent 调试”页签。Review Server 直接启动 Python Agent invocation，启动前检查 Python、JavaScript Runtime、bridge 路径和模型变量是否存在；模型端点和响应格式由 invocation 验证。页面是薄调试入口，不保存聊天或跨调用 Session。HTTP 请求等待 Agent 子进程完成，再一次性返回最终结果与累计事件，不提供实时事件传输或页面中途取消。

依赖准备属于安装流程：Host 把三个组件 wheels 安装到同一个隔离 Python 环境，准备隔离的 JavaScript Runtime，并提供 executable 与 bridge 路径。Python Agent invocation 和 Worker 调用不执行 `npm install`、`npm ci`、`uv sync`、`uv lock` 或 `pip install`。源码开发未配置统一 Python 时，record 与 recorder 分别使用相邻工程已准备完成的 `.venv`。

## 环境

要求 Node.js `>=22.18.0`，公司基线版本为 Node.js 22.18.0。

```powershell
npm ci
npm run check
```

从 `.env.example` 创建 `.env.local`，配置模型、Skill 外部的绝对数据根，以及可选的原始录制集合：

```text
MIDSCENE_MODEL_BASE_URL=https://ark.cn-beijing.volces.com/api/coding/v3
MIDSCENE_MODEL_NAME=minimax-m3
MIDSCENE_MODEL_FAMILY=doubao-vision
CUA_AGENT_MODEL_BASE_URL=https://ark.cn-beijing.volces.com/api/coding/v3
CUA_AGENT_MODEL_NAME=minimax-m3
CUA_AGENT_MODEL_API_KEY=replace-me
CUA_AGENT_MODEL_TIMEOUT_SECONDS=120
CUA_AGENT_MAX_TURNS=8
CUA_DATA_ROOT=C:\path\to\cua-data
CUA_RECORDINGS_ROOT=C:\path\to\recorder-output
```

`CUA_DATA_ROOT` 保存用户任务和运行产物；`CUA_RECORDINGS_ROOT` 是 Worker 写入且 catalog 读取的一级录制目录集合。组件宿主通过 `CUA_PYTHON_EXECUTABLE` 提供已经安装 `cua_record` 与 `cua_recorder` 的统一 Python；源码开发不设置该变量时，两个 Worker 分别使用相邻工程的 `.venv`。record 模型配置通过进程环境注入。

`CUA_AGENT_MODEL_BASE_URL`、`CUA_AGENT_MODEL_NAME`、`CUA_AGENT_MODEL_API_KEY` 配置 Python Agent 的任务级推理模型；未设置时读取对应 `MIDSCENE_MODEL_*`。模型请求超时默认 120 秒、最大 Tool Calling 轮次默认 8，Runtime 单请求超时为 300 秒。`review --dev` 在源码环境使用顶层 `agent/.venv`、服务进程 JavaScript executable 和 `execution/dist/runtime-bridge/worker.js`；集成环境可显式设置 `CUA_AGENT_ROOT`、`CUA_AGENT_PYTHON_EXECUTABLE`、`CUA_AGENT_JS_RUNTIME_EXECUTABLE` 与 `CUA_AGENT_RUNTIME_BRIDGE`。这些路径由安装流程准备。

## CLI

开发仓从 `execution` 运行：

```powershell
npm run cua -- scene list --json
npm run cua -- task list --scene browser-demo --json
npm run cua -- task describe --scene browser-demo --task air-tickets-demo --json
npm run cua -- task create-from-recording --scene <scene> --task <task> --recording <录制目录> [--goal "<任务描述>"]
npm run cua -- task init-from-trace --scene <scene> --task <task> --goal "<目标>"
npm run cua -- task validate --scene browser-demo --task air-tickets-demo
npm run cua -- task inspect --scene browser-demo --task air-tickets-demo --input step-002-input=GOOGLE
npm run cua -- task run --scene browser-demo --task air-tickets-demo --dry-run
npm run cua -- act run --scene browser-demo --task air-tickets-demo --dry-run
npm run cua -- act run --prompt "打开 Chrome 并搜索 GUI agent" --dry-run
npm run cua -- review --no-open
npm run cua -- review --dev --no-open
```

安装后的 Skill 使用编译入口：

```powershell
node dist/cli/main.js scene list --json
node dist/cli/main.js review --no-open
```

`task create-from-recording` 是原始录制的默认创建入口。可用 `--python-executable` 显式选择已经安装 `cua_record` 的 Python，否则按 `CUA_PYTHON_EXECUTABLE` 和源码开发环境解析。record processor 不接收 goal；命令在 trace 生成后将可选 `--goal` 写入任务 goal/description 和 YAML groupDescription。省略时这些字段保存空字符串。Python 进度写入 stderr，stdout 只输出最终 JSON。`task init-from-trace` 仅用于已经准备好标准化 source 的高级场景。

`review` 只启动监听 `127.0.0.1` 的本地页面，不提供步骤编辑 CLI。默认使用固定端口 `47831`；再次使用相同 `CUA_DATA_ROOT` 与相同开发模式调用时会识别并复用已有服务，不创建新的 Node 监听进程。普通模式和 `--dev` 身份不同，不能在同一端口互相复用。若该端口由其他程序、不同数据目录或不同开发模式的 review 服务占用，启动会明确失败而不会自动递增端口；测试或嵌入调用仍可通过 `startReviewServer({ port: 0 })` 使用随机端口。`--dev` 额外启用 Python Agent 调试入口；默认模式完全隐藏它。“任务复核”读取 builtin/user catalog，builtin 任务只读；用户任务保存前校验 revision、`task.json`、`task.yaml` 与 Midscene YAML。“从录制创建任务”既提供 Windows Worker 的显示器预览、`Ctrl+Shift+F9` 准备/开始/停止控制，也读取 `CUA_RECORDINGS_ROOT` 的一级目录，以占位卡片展示唯一 MP4 和唯一 `.txt`/`.log`/`.json` 事件文件，并复用 `createTaskFromRecording()` 创建完整用户任务。页面不播放视频、不展示完整日志，也不流式转发 Python 后处理日志；创建期间只显示不可确定的“正在生成”状态，成功后自动进入新任务复核。同一录制可以用于创建不同任务，每次都会重新处理。

未配置 `CUA_RECORDINGS_ROOT` 不会阻止 review 服务和任务复核启动。录制页只提示需要配置的环境变量、`execution/.env.local` 配置位置和路径示例，不直接修改环境文件，也不从后台服务进程唤起可能失焦或阻塞的桌面目录选择框。配置后重启 review 服务即可生效。存在零个或多个视频/事件文件的录制目录仍会显示，但不能生成任务。

`--input` 可重复；`--inputs <json-file>` 接收字符串值 JSON 对象。inspect 与 run 使用同一个 resolver，不调用模型、不回写任务。`--dry-run` 只构建并解析 YAML，不操作电脑，也不是模拟执行。

参考图步骤使用 Midscene 原生图片 prompt：canonical `task.yaml` 的 `images[].url` 保存相对任务根目录的路径（通常位于 `source/screenshots/`），resolver 验证文件和目录边界后在 resolved YAML 中改为绝对路径。HTTP(S) 与 data URL 保持不变。图片只用于语义定位，Midscene 仍结合文字 prompt、参考图和当前屏幕寻找目标，并点击定位结果；系统不执行像素模板匹配或录制坐标回放。

## 执行语义

- `task run` 直接执行参数已解析的多 task YAML，适合稳定页面。
- `act run --scene/--task` 将相同 resolved YAML 投影为有序完整 prompt，再执行单个 `ai` action。
- `act run --prompt` 将自然语言要求包装为单 `ai` action，不读取任务资产。
- 现有三种 CLI 路径复用 `executors/midscene-yaml.ts`，在同一进程内直接调用 Midscene。
- `runNaturalLanguageAiAct()` 是底层 TypeScript Runtime 嵌入 API，由 `executors/midscene-ai-act.ts` 直接调用一次 `agent.aiAct()`，不生成 YAML；它不是 GDEClaw Main Agent 的 canonical 入口。
- 每次实际执行设置 `MIDSCENE_RUN_DIR=<run-dir>/midscene`，并在 `finally` 中销毁 Agent、恢复原环境。
- Runtime 不提供跨进程并发锁，上层必须串行调用真实 computer use。
- 系统不维护自定义 flow，不自动切换模式、修改任务、重试或调用替代输入动作。
- 逐步 YAML 和录制任务整体 aiAct 都保留被明确选择的参考图片；图片缺失、路径越界或同名图片指向不同 URL 时启动前失败，不降级为纯文字动作。

原生 aiAct API 从包根入口导入：

```ts
import { runNaturalLanguageAiAct } from 'cua-midscene';

const run = await runNaturalLanguageAiAct({
  prompt: '打开 Chrome 并搜索 GUI agent',
  runsRoot: 'C:\\path\\to\\cua-data\\runs',
  dryRun: false,
});
```

它会保存 `ai-act-prompt.txt`、`ai-act-result.json` 和 Midscene 报告。`dryRun: true` 只校验 prompt 并写入结果，不初始化 ComputerDevice 或调用模型。

## 验证

```powershell
npm test
npm run build
```
