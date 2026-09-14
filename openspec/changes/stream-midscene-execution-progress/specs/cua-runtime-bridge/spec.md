## ADDED Requirements

### Requirement: Bridge 流式转发受控执行进度
Runtime bridge SHALL 在 `execute` 请求运行期间按顺序输出与该请求关联的过程事件帧，并 SHALL 在结束时输出唯一终态响应。过程帧 SHALL 包含稳定的执行摘要，不包含 Midscene 原始 Dump、截图、完整模型消息或报告全文。

#### Scenario: Midscene 动作更新
- **WHEN** Midscene 在一次 `execute` 请求中报告动作状态变化
- **THEN** bridge SHALL 在终态响应前输出带有相同 request id 的 `execution.progress` 事件帧
- **AND** 事件 SHALL 包含动作名称、任务 ID、任务序号、可选的可读描述和状态
- **AND** 重复的累计状态更新 SHALL NOT 产生重复过程帧

#### Scenario: 同一动作的状态和描述更新
- **WHEN** Midscene 更新同一执行 ID 与任务 ID 的状态或描述
- **THEN** bridge SHALL 发送具有相同任务身份的新过程帧
- **AND** 事件消息 SHALL 表达动作及其目标，状态由结构化字段表达

#### Scenario: 执行失败
- **WHEN** Midscene 在动作过程中报告失败，随后执行请求失败
- **THEN** bridge SHALL 保留已发出的受控失败进度
- **AND** 最后 SHALL 输出包含根因的结构化终态错误，不自动重试或切换策略

#### Scenario: 普通 Runtime 请求
- **WHEN** bridge 处理 catalog 或 workbench 请求
- **THEN** 原有成功结果或结构化错误的终态协议 SHALL 继续可用
- **AND** worker SHALL 能在同一进程内继续处理后续请求
