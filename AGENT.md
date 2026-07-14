# AGENT

## 项目简介

本项目用于探索基于真实桌面环境的 Computer Use Agent（CUA）工作流。整体方向是：由 `record` 负责教学录制信息处理，将录制视频、输入日志和截图转换为结构化日志与 trace；由 `execution` 负责任务初始化、参数化调用和执行，并通过 Midscene computer use 操作本地 Chrome、堡垒机、远程桌面或企业内网页系统。

当前项目不以 browser-use、Playwright、Puppeteer 或 CDP 作为执行底座。主执行路径应围绕 Midscene computer use 展开。

## 规范

1. 开发过程、文档、提交说明和面向用户的回复均应使用中文；必要的代码标识、API 名称、命令、文件路径和第三方专有名词可以保留英文。
2. 当前项目处于开发探索阶段，不应通过兜底实现、静默跳过、硬编码成功路径或伪造结果来掩盖实际执行逻辑的缺陷；遇到不确定、不可执行或模型能力不足的步骤，应显式暴露问题并保留可诊断信息。
3. 方案设计和代码实现不应只针对单一演示用例构造特化逻辑；样例可以用于验证链路，但抽象、目录结构、IR schema、路由规则和执行器设计应优先保持面向后续多业务流程的泛化能力。
4. Agent 应将任务交互区分为创建、长期修改和单次调用。长期修改必须先展示 step 原值、新值和原因并等待用户确认，确认后直接编辑任务的 `midscene-flow.json` 并验证；未经确认不得修改、自动重试或操作电脑。
5. `execution/cua` 是 Python 业务核心，负责转换、场景与任务发现、参数解析和 CLI；`execution/executors` 只保存 TypeScript Midscene 适配器和 customActions。持久化契约使用 Pydantic 并生成 `execution/schemas`，仅在 Python 内部使用的 VO 不生成 JSON Schema。对应测试分别放在 `execution/tests/python` 和 `execution/tests/executors`。
6. 任务根目录的 `midscene-flow.json` 是唯一长期执行事实源，不维护 overrides、proposal 或 history。`task.json` 只声明输入绑定，未传入参数时保留 flow 当前值。
7. Python 与 TypeScript 的唯一执行边界是 `reports/<run-id>/resolved-flow.json`。TypeScript executor 不得读取 canonical flow、任务清单、source 或本次参数，也不得实现旧任务 resolver 兜底。
