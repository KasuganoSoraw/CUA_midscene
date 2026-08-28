# Execution

该目录是可独立构建的 TypeScript Computer-Use Runtime 与 `cua-midscene` 底层 Skill。TypeScript 核心负责调用外部 record 处理器、把 trace 初始化为 Midscene YAML 任务、发现任务、解析本次输入、生成运行投影并直接调用 Midscene computer use。面向 GDEClaw 的 canonical Subagent 位于仓库顶层 Python `agent/`；本目录不再发布第二套 Agent definition 或模型 loop。

## 模块职责

```text
record trace
  -> cua/recording：调用外部 Python recorder、规范化 source、初始化并验证任务
  -> cua/conversion：caption.operation -> task.yaml + task.json
  -> cua/task：数据根、catalog、YAML、输入、aiAct 投影与执行编排
  -> cua/act：无录制自然语言原生 aiAct 公开 API
  -> cli：开发命令和安装后 bin 的统一入口
  -> cua/index.ts：GDE Claw 等上层工具直接导入的 API
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
- `review/`：与 `cua/` 平级的本地复核应用；`service/` 组合任务资产、录制证据和 `locate.images` 执行参考图，`server/` 使用 Fastify 提供受控 HTTP，`web/` 使用 Vue 3。
- `executors/`：Midscene 薄适配器、环境读取和 customAction。
- `projects/`：随 Skill 发布的只读内置任务。
- `schemas/`：CUA 自有持久化 JSON 契约；不复制 Midscene action 类型系统。
- `tests/`：契约、转换、任务、CLI 和执行器测试。
TypeScript 内部不建立与持久化契约重复的运行时模型类。Ajv 只校验从磁盘进入系统的 scene、task、trace 和执行结果；resolved YAML 最终交给 Midscene parser。

## Python Agent 与 Runtime Bridge

唯一 canonical Computer-Use Subagent 位于仓库顶层 `agent/`。GDEClaw 只调用其高层 `{ task }` invocation；Python Agent 自己运行模型 Tool Calling、判断 Recorded Skill、选择 replay/guided/freeform，并把 GUI 微观规划交给 Midscene。`cua_catalog`、`cua_execute`、`cua_workbench` 是 Python Agent 私有 Tool，不是 GDEClaw 的公共 Tool。

本包只通过 `cua-midscene/runtime-bridge` 和构建后的 `dist/runtime-bridge/worker.js` 提供版本化 JSONL Runtime：

```text
GDEClaw Main Agent
  -> Python cua-agent（definition、模型 loop、私有 Tool、事件）
  -> TypeScript Runtime bridge（catalog、execute、workbench）
  -> Midscene computer use
```

JSONL request 包含 `schemaVersion`、`requestId`、`method`、`payload`；response 使用相同 request id，并明确区分 result 与结构化 error。worker stdout 只输出协议 frame，诊断写 stderr。一次 Python invocation 可复用一个 Node worker，invocation 结束即释放；不同 invocation 不共享模型 messages 或 Runtime 状态。

普通 `review` 不展示或注册 Agent API；开发者使用 `review --dev` 才能看到“Agent 调试”页签。Review Server 直接启动 Python Agent invocation，检查 Python executable、模型配置和构建后的 Runtime bridge，不再等待外部 AgentHost。页面是薄调试入口，不保存聊天或跨调用 Session。

开发阶段可分别运行 npm 与 uv 环境；产品安装阶段由 GDEClaw 安装 `cua-agent` wheel、准备隔离的 Node Runtime 并提供 executable 路径。运行 invocation 时不得执行 `npm install`、`npm ci`、`uv sync`、`uv lock` 或 `pip install`。

## 环境

要求 Node.js `>=22.18.0`，公司基线版本为 Node.js 22.18.0。

```powershell
npm install
npm run check
```

从 `.env.example` 创建 `.env.local`，配置模型、Skill 外部的绝对数据根、独立的 record 处理器根目录，以及可选的原始录制集合：

```text
MIDSCENE_MODEL_BASE_URL=https://ark.cn-beijing.volces.com/api/coding/v3
MIDSCENE_MODEL_NAME=minimax-m3
MIDSCENE_MODEL_FAMILY=doubao-vision
CUA_AGENT_MODEL_BASE_URL=https://ark.cn-beijing.volces.com/api/coding/v3
CUA_AGENT_MODEL_NAME=minimax-m3
CUA_DATA_ROOT=C:\path\to\cua-data
CUA_RECORD_ROOT=C:\path\to\CUA\record
CUA_RECORDINGS_ROOT=C:\path\to\recorder-output
```

`CUA_DATA_ROOT` 保存用户任务和运行产物；`CUA_RECORD_ROOT` 指向包含 `pyproject.toml` 和 `Aloha_Learn/parser.py` 的 Python 处理器目录；`CUA_RECORDINGS_ROOT` 指向录制器生成的一级目录集合。安装后的 execution Skill 不包含 Python；一键创建命令会在 `CUA_RECORD_ROOT` 运行 uv，并由 Python 自行读取 `record/.env`。

`CUA_AGENT_MODEL_BASE_URL`、`CUA_AGENT_MODEL_NAME`、`CUA_AGENT_MODEL_API_KEY` 配置 Python Agent 自身的任务级推理模型；未设置时兼容回退到对应 `MIDSCENE_MODEL_*`。`review --dev` 在源码环境默认使用顶层 `agent/.venv`、当前 Node executable 和 `execution/dist/runtime-bridge/worker.js`；集成环境可显式设置 `CUA_AGENT_ROOT`、`CUA_AGENT_PYTHON_EXECUTABLE`、`CUA_AGENT_NODE_EXECUTABLE` 与 `CUA_AGENT_RUNTIME_BRIDGE`。这些路径必须由安装阶段准备。

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

`task create-from-recording` 是原始录制的默认创建入口，会按 record 原有无 goal 方式生成 trace、规范化 `source/`、初始化任务并完成静态验证。可选的 `--goal` 只写入任务 goal/description 和 YAML groupDescription，不进入 trace prompt；省略时这些字段保存空字符串。Python 进度写入 stderr，最终 stdout 保持为单个 JSON。`task init-from-trace` 仅用于已经准备好标准化 source 的高级场景。

`review` 只启动监听 `127.0.0.1` 的本地页面，不提供步骤编辑 CLI。默认使用固定端口 `47831`；再次使用相同 `CUA_DATA_ROOT` 与兼容开发模式调用时会识别并复用已有服务，不创建新的 Node 监听进程。若该端口由其他程序或不同数据目录/开发模式的 review 服务占用，启动会明确失败而不会自动递增端口；测试或嵌入调用仍可通过 `startReviewServer({ port: 0 })` 使用随机端口。`--dev` 额外启用 Python Agent 调试入口；默认模式完全隐藏它。“任务复核”读取 builtin/user catalog，builtin 任务只读；用户任务保存前校验 revision、`task.json`、`task.yaml` 与 Midscene YAML。“从录制创建任务”读取 `CUA_RECORDINGS_ROOT` 的一级子目录，以占位卡片展示唯一 MP4 和唯一 `.txt`/`.log`/`.json` 事件文件，可打开系统目录，并复用 `createTaskFromRecording()` 创建完整用户任务。页面不播放视频、不展示完整日志，也不流式转发 Python 录制处理日志；创建期间只显示不可确定的“正在生成”状态，成功后自动进入新任务复核。同一录制可以用于创建不同任务，每次都会重新处理。

未配置 `CUA_RECORDINGS_ROOT` 不会阻止 review 服务和任务复核启动。录制页只提示需要配置的环境变量、`execution/.env.local` 配置位置和路径示例，不直接修改环境文件，也不从后台服务进程唤起可能失焦或阻塞的桌面目录选择框。配置后重启 review 服务即可生效。存在零个或多个视频/事件文件的录制目录仍会显示，但不能生成任务。

`--input` 可重复；`--inputs <json-file>` 接收字符串值 JSON 对象。inspect 与 run 使用同一个 resolver，不调用模型、不回写任务。`--dry-run` 只构建并解析 YAML，不操作电脑，也不是模拟执行。

参考图步骤使用 Midscene 原生图片 prompt：canonical `task.yaml` 的 `images[].url` 保存相对任务根目录的路径（通常位于 `source/screenshots/`），resolver 验证文件和目录边界后在 resolved YAML 中改为绝对路径。HTTP(S) 与 data URL 保持不变。图片只用于语义定位，Midscene 仍结合文字 prompt、参考图和当前屏幕寻找目标，并点击定位结果；系统不执行像素模板匹配或录制坐标回放。

## 执行语义

- `task run` 直接执行参数已解析的多 task YAML，适合稳定页面。
- `act run --scene/--task` 将相同 resolved YAML 投影为有序完整 prompt，再执行单个 `ai` action。
- `act run --prompt` 将自然语言要求包装为单 `ai` action，不读取任务资产。
- 现有三种 CLI 路径复用 `executors/midscene-yaml.ts`，在同一进程内直接调用 Midscene。
- `runNaturalLanguageAiAct()` 是面向 GDE Claw 等进程内集成方的独立 API，由 `executors/midscene-ai-act.ts` 直接调用一次 `agent.aiAct()`，不生成 YAML。
- 每次实际执行设置 `MIDSCENE_RUN_DIR=<run-dir>/midscene`，并在 `finally` 中销毁 Agent、恢复原环境。
- 第一版不实现并发锁，上层必须串行调用真实 computer use。
- 不兼容旧 flow，不自动切换模式、修改任务、重试或调用替代输入动作。
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
