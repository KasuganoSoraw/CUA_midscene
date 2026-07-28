## Context

现有本地 review 应用已经通过 Fastify 与 Vue 组合 `CUA_DATA_ROOT` 下的任务资产，并直接复用 `cua/task` 的 catalog API。录制侧已经存在公开的 `createTaskFromRecording()`，但调用者必须提供某次录制的绝对路径；系统尚未定义录制集合根、目录发现 API 或面向人的创建界面。

真实录制器会在用户配置的输出根下创建 `Recording_*` 或 `Quick_Recording_*` 等一级目录，每个目录包含 `inputs/`、视频和事件日志。目录名称前缀不稳定，因此录制发现必须以目录结构和文件事实为准。用户明确要求不新增 `recording.json`、数据库、索引、后台任务或第二份事实源。

## Goals / Non-Goals

**Goals:**

- 通过 `CUA_RECORDINGS_ROOT` 定位原始录制集合，并在未配置时保持现有任务复核可用。
- 安全扫描一级录制目录，返回足以展示和创建任务的动态视图。
- 在现有 review 页面增加独立页签，让用户选择录制、填写 scene/task/可选 goal，并创建完整任务。
- 复用 `createTaskFromRecording()`，保持 CLI 与页面使用同一编排、覆盖保护、失败清理和验证逻辑。
- 生成期间提供明确的不可交互状态，成功后直接进入新任务复核。

**Non-Goals:**

- 不播放视频、不读取完整事件日志、不生成真实视频封面。
- 不展示 Python 流式日志、不报告虚假百分比、不增加 SSE、WebSocket、任务队列或持久化 job。
- 不提供生成取消、页面重连、自动处理、文件监听或录制到任务映射。
- 不修改 canonical task、trace 或 YAML schema。

## Decisions

### 1. 录制 catalog 属于 `cua/recording`，review 只负责投影

新增 `cua/recording/recording-catalog.ts`，负责：

- 解析 `CUA_RECORDINGS_ROOT`。
- 校验绝对目录和读取边界。
- 扫描根目录的一级子目录。
- 识别 `inputs/` 中的视频与事件日志。
- 从已有日志头部尽力解析开始时间和屏幕信息。
- 使用 recording ID 安全解析录制目录。

review service 和 routes 复用该模块。这样目录契约不会成为 Vue/Fastify 私有逻辑，后续 Agent 或 CLI 可以继续复用，同时不改动现有 trace 转换流程。

环境变量解析优先级为：显式服务端参数（测试与嵌入调用）→ 进程 `CUA_RECORDINGS_ROOT` → `execution/.env.local` → `execution/.env`。未配置返回“不可用”状态而不是阻止 review 服务启动。

### 2. 录制列表完全由文件系统动态构造

系统只扫描配置根的一级目录。候选目录不限制名称前缀，但必须有 `inputs/`；详情返回目录 ID、视频/事件日志名称与大小、可选日志元数据、ready 和 errors。

第一版要求 `inputs/` 中恰好一个 `.mp4` 和一个 `.txt`、`.log` 或 `.json` 事件日志。数量不符的录制仍出现在列表中，但 `ready=false` 且不能生成。API 不返回绝对路径，也不写入录制目录。

### 3. 打开目录是显式且受边界保护的本地操作

页面只向 `POST /api/recordings/:id/open-folder` 提交 recording ID。服务端重新在 `CUA_RECORDINGS_ROOT` 下解析并确认目标是一级目录，再使用无 shell 系统命令打开：

- Windows：`explorer.exe <目录>`
- macOS：`open <目录>`
- Linux：`xdg-open <目录>`

不提供接收任意路径的接口。视频与事件日志占位卡片都触发同一个明确的打开目录动作。

### 4. 创建接口同步等待并返回最终 JSON

`POST /api/recordings/:id/tasks` 接收 scene、task 和可选 goal。route 安全解析录制目录后直接调用现有 `createTaskFromRecording()`，并传入 review server 已解析的 catalog、runsRoot 和 recording 绝对路径。

Python progress 保持写入服务端 stderr；前端不接收流式日志。请求期间页面显示不确定进度条和“正在生成任务”，禁用会改变请求参数或重复提交的控件。完成后返回最终 scene/task；失败沿用 review 的结构化错误响应。

### 5. Vue 使用独立录制工作区组件

顶层 App 增加“任务复核”和“从录制创建任务”页签。录制页使用独立 `RecordingWorkspace.vue`，保持现有 main 的左侧目录列表与右侧详情布局，避免将录制状态继续堆入任务步骤编辑器。

场景控件为可编辑 Combobox：可选择 API 返回的现有 scene ID，也可输入新 ID。新场景的 ID 同时作为初始 title；任务为自由输入 ID；goal 可留空。创建成功时组件向 App 发出 scene/task，App 刷新 catalog、切回任务复核并打开该任务。

### 6. 未配置时通过后端完成录制根配置

未配置 `CUA_RECORDINGS_ROOT` 时，录制页提供“选择录制目录”按钮。按钮调用本地 review API，由后端通过无 shell 系统进程唤起原生文件夹选择框；浏览器不使用上传控件，也不接收所选绝对路径。

用户选择有效目录后，服务先使用既有录制根规则校验路径，再原子更新 `execution/.env.local` 中的 `CUA_RECORDINGS_ROOT`。更新必须保留文件中的其他变量、空行和注释，并替换已有同名项而不是追加重复项。写入成功后当前服务立即使用新目录并返回刷新后的录制视图，后续启动按既有环境优先级读取。

用户取消选择时返回未选择状态且保持任务复核可用。目录校验或 `.env.local` 写入失败时返回页面内错误，不建立仅限当前进程的隐式临时配置。

## Risks / Trade-offs

- [同步请求可能持续较久] → 页面持续展示不确定进度并禁用重复提交；第一版明确不承诺取消或重连。
- [关闭页面后用户看不到最终结果] → 服务端不主动取消已经启动的创建；重新打开后可从任务目录发现成功产物。
- [目录内容在扫描后发生变化] → 打开和创建时重新解析、校验 recording ID 与目录内容，不信任旧的前端详情。
- [系统打开目录命令失败] → 返回结构化错误且不影响录制目录与 review 服务。
- [系统目录选择框不可用或被取消] → 取消视为无变更；启动失败返回页面内错误。
- [安装目录不可写] → 原子更新失败并保留原 `.env.local`，页面提示用户改用环境变量或手工配置。
- [日志元数据格式漂移] → 元数据解析为尽力行为；解析失败不影响仅由必需文件决定的 ready 状态。
