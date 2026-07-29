# Execution

该目录是可独立发布的 `cua-midscene` Skill。TypeScript 核心负责调用外部 record 处理器、把 trace 初始化为 Midscene YAML 任务、发现任务、解析本次输入、生成运行投影并直接调用 Midscene computer use。

## 模块职责

```text
record trace
  -> cua/recording：调用外部 Python recorder、规范化 source、初始化并验证任务
  -> cua/conversion：caption.operation -> task.yaml + task.json
  -> cua/task：数据根、catalog、YAML、输入、aiAct 投影与执行编排
  -> cli：开发命令和安装后 bin 的统一入口
  -> cua/index.ts：GDE Claw 等上层工具直接导入的 API
  -> review：Vue 本地复核应用、localhost 服务与复核专属 service
  -> executors：ComputerAgent、KeyboardTypeText、agent.runYaml()
```

- `cua/contracts/`：普通 TypeScript 类型和 Ajv 文件边界校验。
- `cua/recording/`：定位外部 record 环境、运行 parser、复制标准化生成资产并编排任务创建。
- `cua/conversion/`：只根据结构化 trace operation 初始化任务；被标记的 click/doubleClick 会绑定 processed log 中的 reference patch。
- `cua/task/`：双 catalog、YAML、输入、运行快照和执行编排。
- `cli/`：统一命令分发与 stdout/stderr 输出协议。
- `review/`：与 `cua/` 平级的本地复核应用；`service/` 组合任务资产、录制证据和 `locate.images` 执行参考图，`server/` 使用 Fastify 提供受控 HTTP，`web/` 使用 Vue 3。
- `executors/`：Midscene 薄适配器、环境读取和 customAction。
- `projects/`：随 Skill 发布的只读内置任务。
- `schemas/`：CUA 自有持久化 JSON 契约；不复制 Midscene action 类型系统。
- `tests/`：契约、转换、任务、CLI 和执行器测试。

TypeScript 内部不建立与持久化契约重复的运行时模型类。Ajv 只校验从磁盘进入系统的 scene、task、trace 和执行结果；resolved YAML 最终交给 Midscene parser。

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
CUA_DATA_ROOT=C:\path\to\cua-data
CUA_RECORD_ROOT=C:\path\to\CUA\record
CUA_RECORDINGS_ROOT=C:\path\to\recorder-output
```

`CUA_DATA_ROOT` 保存用户任务和运行产物；`CUA_RECORD_ROOT` 指向包含 `pyproject.toml` 和 `Aloha_Learn/parser.py` 的 Python 处理器目录；`CUA_RECORDINGS_ROOT` 指向录制器生成的一级目录集合。安装后的 execution Skill 不包含 Python；一键创建命令会在 `CUA_RECORD_ROOT` 运行 uv，并由 Python 自行读取 `record/.env`。

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
```

安装后的 Skill 使用编译入口：

```powershell
node dist/cli/main.js scene list --json
node dist/cli/main.js review --no-open
```

`task create-from-recording` 是原始录制的默认创建入口，会按 record 原有无 goal 方式生成 trace、规范化 `source/`、初始化任务并完成静态验证。可选的 `--goal` 只写入任务 goal/description 和 YAML groupDescription，不进入 trace prompt；省略时这些字段保存空字符串。Python 进度写入 stderr，最终 stdout 保持为单个 JSON。`task init-from-trace` 仅用于已经准备好标准化 source 的高级场景。

`review` 只启动监听 `127.0.0.1` 的本地页面，不提供步骤编辑 CLI。默认使用固定端口 `47831`；再次使用相同 `CUA_DATA_ROOT` 调用时会识别并复用已有服务，不创建新的 Node 监听进程。若该端口由其他程序或不同数据目录的 review 服务占用，启动会明确失败而不会自动递增端口；测试或嵌入调用仍可通过 `startReviewServer({ port: 0 })` 使用随机端口。“任务复核”读取 builtin/user catalog，builtin 任务只读；用户任务保存前校验 revision、`task.json`、`task.yaml` 与 Midscene YAML。“从录制创建任务”读取 `CUA_RECORDINGS_ROOT` 的一级子目录，以占位卡片展示唯一 MP4 和唯一 `.txt`/`.log`/`.json` 事件文件，可打开系统目录，并复用 `createTaskFromRecording()` 创建完整用户任务。页面不播放视频、不展示完整日志，也不流式转发 Python 日志；创建期间只显示不可确定的“正在生成”状态，成功后自动进入新任务复核。同一录制可以用于创建不同任务，每次都会重新处理。

未配置 `CUA_RECORDINGS_ROOT` 不会阻止 review 服务和任务复核启动。录制页只提示需要配置的环境变量、`execution/.env.local` 配置位置和路径示例，不直接修改环境文件，也不从后台服务进程唤起可能失焦或阻塞的桌面目录选择框。配置后重启 review 服务即可生效。存在零个或多个视频/事件文件的录制目录仍会显示，但不能生成任务。

`--input` 可重复；`--inputs <json-file>` 接收字符串值 JSON 对象。inspect 与 run 使用同一个 resolver，不调用模型、不回写任务。`--dry-run` 只构建并解析 YAML，不操作电脑，也不是模拟执行。

参考图步骤使用 Midscene 原生图片 prompt：canonical `task.yaml` 的 `images[].url` 保存相对任务根目录的路径（通常位于 `source/screenshots/`），resolver 验证文件和目录边界后在 resolved YAML 中改为绝对路径。HTTP(S) 与 data URL 保持不变。图片只用于语义定位，Midscene 仍结合文字 prompt、参考图和当前屏幕寻找目标，并点击定位结果；系统不执行像素模板匹配或录制坐标回放。

## 执行语义

- `task run` 直接执行参数已解析的多 task YAML，适合稳定页面。
- `act run --scene/--task` 将相同 resolved YAML 投影为有序完整 prompt，再执行单个 `ai` action。
- `act run --prompt` 将自然语言要求包装为单 `ai` action，不读取任务资产。
- 三种路径复用 `executors/midscene-yaml.ts`，在同一进程内直接调用 Midscene。
- 每次实际执行设置 `MIDSCENE_RUN_DIR=<run-dir>/midscene`，并在 `finally` 中销毁 Agent、恢复原环境。
- 第一版不实现并发锁，上层必须串行调用真实 computer use。
- 不兼容旧 flow，不自动切换模式、修改任务、重试或调用替代输入动作。
- 逐步 YAML 和录制任务整体 aiAct 都保留被明确选择的参考图片；图片缺失、路径越界或同名图片指向不同 URL 时启动前失败，不降级为纯文字动作。

## 验证

```powershell
npm test
npm run build
```
