## Why

当前用户虽然可以通过 CLI 从原始录制创建完整任务，但仍需手工寻找录制目录并填写路径，已有本地复核页面也无法发现录制器产物。需要在不增加录制清单文件、数据库或远程服务的前提下，让用户在同一个本地控制台中选择录制并创建可复核任务。

## What Changes

- 新增 `CUA_RECORDINGS_ROOT`，用于配置录制器实际输出的原始录制集合，与 Python 录制处理器根和最终任务数据根区分。
- 未配置录制根时在页面中提示 `CUA_RECORDINGS_ROOT`、`execution/.env.local` 配置位置和路径示例，不阻止现有任务复核。
- 动态扫描录制根下包含 `inputs/` 的一级目录，从现有视频、事件日志和日志元数据构造录制列表与详情，不新增 `recording.json` 或其他持久化索引。
- 在 review Web 页面增加“从录制创建任务”页签，左侧选择录制目录，右侧以占位卡片展示视频和事件日志基本信息。
- 支持从占位卡片或明确按钮在系统文件资源管理器中打开经过安全解析的录制目录。
- 提供可选择已有场景或输入新场景的 Combobox、任务输入框和可选目标输入框，并调用现有 `createTaskFromRecording()` 创建完整任务。
- 使用轻量自定义 Select 与可编辑 Combobox 统一任务复核页和录制创建页的字段、尾部箭头、弹层、选项、悬浮态与焦点态，箭头区域不得用大面积遮罩破坏输入框圆角。
- 生成期间只展示“正在生成”的不确定进度状态，不引入流式日志、任务队列、取消或恢复机制。
- 创建成功后刷新任务目录并自动切换到新任务的复核界面；失败时在页面内展示错误，不使用浏览器原生弹窗。
- 第一版不实现视频播放、事件日志正文预览、真实视频封面、下载或录制状态持久化。

## Capabilities

### New Capabilities

- `recording-catalog`: 定义原始录制根配置、一级目录发现、文件校验、元数据投影与安全打开目录能力。

### Modified Capabilities

- `local-task-review-app`: 在现有本地复核控制台中增加录制发现、任务创建表单、生成中状态与成功后跳转。
- `recording-task-creation`: 允许本地 review 服务通过公开 TypeScript API 复用与 CLI 相同的完整任务创建编排。

## Impact

- `execution/cua/recording/`：新增录制 catalog 与根目录解析模块，保持现有创建编排不变。
- `execution/review/service/`、`execution/review/server/`、`execution/review/shared/`：新增录制列表、详情、打开目录和创建任务 API。
- `execution/review/web/`：新增 Vue 页签、录制选择、文件占位卡片、创建表单和生成状态。
- `execution/.env.example`、README 与 Skill 文档：说明 `CUA_RECORDINGS_ROOT` 的职责和未配置时行为。
- 不增加外部运行时依赖，不修改 canonical task/trace/YAML schema。
