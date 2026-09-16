## ADDED Requirements

### Requirement: Execute 返回经校验的 Midscene HTML 报告路径
Runtime bridge SHALL 为 replay、guided 和 freeform 执行保留底层 Midscene HTML 报告路径，并 SHALL 仅在报告完成写入且文件实际存在时通过可选 `reportPath` 返回该路径。

#### Scenario: 实际执行生成 HTML 报告
- **WHEN** 任一执行策略完成且 Midscene 生成可访问的 HTML 报告文件
- **THEN** `cua_execute` 结果 SHALL 在顶层包含该文件的 `reportPath`
- **AND** 持久化执行结果 SHALL 保留相同路径

#### Scenario: dry-run 不生成报告
- **WHEN** 调用方执行 dry-run
- **THEN** `cua_execute` 结果 SHALL 不包含 `reportPath`

#### Scenario: 报告文件没有生成
- **WHEN** 底层动作执行完成但预期的报告文件不存在
- **THEN** 执行结果 SHALL 不包含 `reportPath`
- **AND** 报告缺失 SHALL NOT 单独把已成功的电脑操作改为失败
