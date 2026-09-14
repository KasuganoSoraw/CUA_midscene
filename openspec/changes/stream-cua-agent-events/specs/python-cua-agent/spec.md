## MODIFIED Requirements

### Requirement: Agent 提供取消与结构化事件
Python Agent SHALL 在模型与 Tool 调用期间检查取消信号，并 SHALL 按同一 invocation 的发生顺序输出 Host-neutral 的结构化生命周期、assistant 与 Tool 事件。assistant 文本事件 SHALL 以轮次关联可见增量；Tool 开始事件 SHALL 包含完整调用参数，完成事件 SHALL 包含关联的结果或错误；最终协议 JSON 和隐藏推理 SHALL NOT 作为可见文本增量输出。

#### Scenario: Tool 调用前收到取消
- **WHEN** invocation 在下一次 Tool 调用前被取消
- **THEN** Agent SHALL NOT 启动该 Tool
- **AND** Agent SHALL 输出取消或失败终止事件及对应最终结果

#### Scenario: 正常完成一次任务
- **WHEN** 模型返回最终答复
- **THEN** Agent SHALL 输出 `agent.completed` 事件
- **AND** 最终结果 SHALL 包含状态和面向 Host 的回复

#### Scenario: 可见 assistant 文本增量
- **WHEN** 模型在同一轮返回用户可见文本增量
- **THEN** Agent SHALL 按顺序输出 `assistant.started`、`assistant.delta` 和 `assistant.completed`，并关联轮次
- **AND** 已确认的增量 SHALL 在完整模型响应返回前到达事件消费者

#### Scenario: Tool call 参数分片
- **WHEN** 模型把一个或多个 Tool call 的名称和参数分多帧返回
- **THEN** Agent SHALL 在组装并验证完整调用参数后才输出 `tool.started`
- **AND** 同一调用的 `tool.started` 和 `tool.completed` SHALL 使用相同 `callId` 与 `turn`

#### Scenario: Tool 成功或失败
- **WHEN** Agent 完成一次私有 Tool 调用
- **THEN** `tool.completed` SHALL 包含成功状态与可公开的结构化结果，或失败状态与错误
- **AND** 事件 SHALL NOT 包含 Host 专有消息类型或未经控制的敏感数据

#### Scenario: 最终协议内容
- **WHEN** 模型输出最终响应协议 JSON
- **THEN** Agent SHALL 在完整解析后通过终态事件和最终结果提供干净的 `reply`
- **AND** Agent SHALL NOT 将原始 JSON 片段作为 `assistant.delta` 输出
