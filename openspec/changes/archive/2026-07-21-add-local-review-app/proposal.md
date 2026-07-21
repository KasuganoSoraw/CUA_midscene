## Why

当前录制任务只能由 Agent 或开发者直接修改 `task.yaml`，缺少面向人类的本地可视化复核入口。GDE Claw 只能稳定打开系统浏览器，因此需要一个随执行器发布、读取 `CUA_DATA_ROOT`、不依赖远程服务或数据库的本地复核应用。

## What Changes

- 在 `execution/review/` 新增与 `cua/` 平级的复核应用，包含 Vue 3 + TypeScript + Vite 前端、本地 Node.js HTTP 服务、共享 DTO 和复核专属 service。
- 将发布命令入口提升为顶层 `execution/cli/`，保留现有命令语义，并新增仅用于启动本地页面的 `cua review` 命令；不新增面向 Agent 的步骤编辑 CLI。
- `cua review` 仅监听 `127.0.0.1` 并使用系统分配的随机端口；第一版不引入访问 token 或登录鉴权。
- 前端从 builtin/user catalog 展示场景和任务，组合 `task.yaml`、`task.json` 与只读 `source/`，在步骤卡片中展示全局图和局部图。
- 支持修改、新增、删除和移动步骤；结构编辑继续使用连续的 `step-NNN | <operation-type>` 命名，并事务性同步 YAML 输入占位符、`task.json.inputs` 与录制证据绑定。
- 在现有 `task.json.source` 中增加可选步骤证据绑定，不新增持久化 JSON 文件；人工新增步骤允许没有独立录制证据。
- 保存时校验 revision、只允许写入 user catalog、联合验证 `task.json` 与 `task.yaml`，并以原子替换避免半写入。
- Agent 仍可在用户确认后直接修改任务资产，并继续使用现有 `task validate` 验证，不强制经过 review service。
- 步骤内容由语义表单编辑；高级区域实时预览或显式应用 Flow/参数 JSON，普通用户不必直接维护 JSON。

## Capabilities

### New Capabilities
- `local-task-review-app`: 本地 Vue 复核控制台、localhost 服务、安全的任务与证据读取、草稿差异和确认保存。
- `task-structure-editing`: 对任务步骤执行插入、删除、移动和连续重编号，并同步输入与录制证据绑定。

### Modified Capabilities
- `midscene-yaml-tasks`: 区分普通内容校准与受控结构编辑，结构编辑可重编号但保存后仍必须满足连续且严格递增的 `step-NNN` 契约。
- `trace-to-midscene-flow`: 初始化任务时生成步骤到原始 trace step 的证据绑定，供后续重编号后继续定位截图。

## Impact

- 受影响代码：`execution/cua/`、新的 `execution/cli/` 与 `execution/review/`、构建脚本、schemas、tests、README 和 Skill 说明。
- 新增运行时/开发依赖：Vue 3、Vite 及 Vue TypeScript 构建支持；本地服务优先使用 Node.js 内置 HTTP 能力，不引入远程服务或数据库。
- 发布产物新增 `dist/review/server` 与 `dist/review/web`；用户数据目录结构仍保持 `projects/`、`runs/`、`cache/`，不会复制前端文件。
- `task.json` schema 增加向后兼容的可选证据绑定字段；既有任务没有该字段时仍可读取，并可从原始 trace/processed log 建立初始视图。
