## ADDED Requirements

### Requirement: Agent 将 Runtime 执行进度映射为调用级事件
Python Agent SHALL 在私有 `cua_execute` 运行期间消费与当前 Runtime 请求关联的受控过程帧，并 SHALL 将其转换为按顺序到达的 Host-neutral `execution.progress` 事件。每个事件 SHALL 关联当前 invocation、Tool call 和轮次。

#### Scenario: 执行期间出现 Midscene 进度
- **WHEN** Runtime 在 `cua_execute` 终态响应前发出过程帧
- **THEN** Agent SHALL 在 `tool.completed` 前发送关联的 `execution.progress`
- **AND** 合法的任务 ID、动作描述及状态 SHALL 保留在调用级事件中
- **AND** 现有 CLI JSONL、Review 开发流及最终 invocation result SHALL 保持可用

#### Scenario: Review 展示执行进度
- **WHEN** Review 开发页收到同一 invocation、Tool call、执行 ID 与任务 ID 的状态更新
- **THEN** 页面 SHALL 更新已有进度项，而非重复追加相同动作
- **AND** 其他调用事件 SHALL 保持原有顺序

#### Scenario: 无效或错配过程帧
- **WHEN** Runtime 过程帧的版本、请求 ID 或结构与当前请求不符
- **THEN** Python Runtime client SHALL 以协议错误结束该请求
- **AND** Agent SHALL NOT 将错配内容作为当前调用进度公开

#### Scenario: 执行取消或超时
- **WHEN** `cua_execute` 在等待过程或终态帧时被取消或超过请求超时
- **THEN** Python Runtime client SHALL 停止等待并关闭对应 worker
- **AND** Agent SHALL 返回可诊断的调用终态
