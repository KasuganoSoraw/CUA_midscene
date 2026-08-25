## Why

现有本地 review 页面只能复核、保存任务和从录制创建任务，用户仍需回到命令行配置输入并启动执行。项目需要在同一个本地工作台中提供可观察、可复用现有 TypeScript runner 的任务运行入口，同时避免把长生命周期执行状态塞入步骤编辑器。

## What Changes

- 在“任务复核”“从录制创建任务”旁新增独立“任务运行”页签，并将页面定位扩展为本地任务工作台。
- 在任务复核页增加“运行此任务”快捷入口；未保存草稿不得被直接执行，用户任务可保存后跳转，内置任务可直接跳转。
- 任务运行页复用场景/任务 catalog，按 `task.json.inputs` 生成运行时输入表单，并允许选择逐步 `task run` 或整体规划 `act run`。
- 增加准备态，使用户有时间切换到目标初始界面后再开始实际执行；首版使用明确倒计时，不引入新的全局热键依赖。
- review server 增加单执行会话管理、状态查询、启动和停止 API，通过无 shell Node 子进程调用现有 CLI，保留最终 JSON、错误摘要和 run directory。
- 展示当前执行状态、耗时、最终结果和运行目录；真实执行长时间无输出时保持可观察状态，不伪造步骤进度。
- 首版不实现录制器与执行器之间的共享桌面会话锁，也不实现多执行并发、完整日志流或持久化运行历史索引。

## Capabilities

### New Capabilities

- `task-execution-console`: 定义本地任务运行页、运行时输入、准备倒计时、单执行会话、子进程边界与结果展示。

### Modified Capabilities

- `local-task-review-app`: 将现有复核控制台扩展为包含任务复核、录制创建和任务运行三个页签的本地工作台，并提供从当前任务跳转执行的入口。

## Impact

- `execution/review/web` 增加任务运行页面、状态轮询、输入表单和导航入口。
- `execution/review/server` 增加执行编排 API，`execution/review/service` 增加单子进程状态机。
- 复用 `execution/cua/task/execution.ts` 与现有 CLI，不新增第三方依赖，不改变 canonical 任务、输入解析或 run directory 契约。
- 增加 Fastify、前端 API、状态机和构建测试；真实执行仍依赖现有 Midscene 模型与桌面环境配置。
