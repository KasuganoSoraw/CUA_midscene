## MODIFIED Requirements

### Requirement: 人工调试与 GDEClaw 复用 Python invocation
仅由 `review --dev` 启用的人工调试入口 SHALL 与 GDEClaw Host Adapter 调用同一个 Python invocation contract，并 SHALL 在调用运行期间展示其通用事件；普通 `review` SHALL NOT 展示 Agent 调试入口或注册 invocation API。

#### Scenario: 开发者提交自然语言任务
- **WHEN** 开发者在 `review --dev` 的 Agent 页签提交非空任务
- **THEN** Review Server SHALL 把 `{task}` 交给 Python CUA Agent
- **AND** 页面 SHALL 在调用运行期间展示允许公开的进度、assistant 文本增量和 Tool 生命周期事件
- **AND** 页面 SHALL 在结束时展示最终回复与状态，不自行选择执行策略或直接调用 Runtime Tool

#### Scenario: 普通用户启动 Workbench
- **WHEN** 用户执行 `review` 且未提供 `--dev`
- **THEN** Workbench SHALL NOT 展示 Agent 调试页签
- **AND** Review Server SHALL NOT 注册 Agent invocation endpoint
