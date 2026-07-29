## ADDED Requirements

### Requirement: 本地 review 服务复用完整任务创建编排
本地 review 服务 SHALL 通过公开 TypeScript API 调用与 `task create-from-recording` 相同的完整任务创建编排，不得在 route 或前端重复实现 parser、资产复制、转换、验证或失败清理。

#### Scenario: 页面发起创建
- **WHEN** review 服务收到有效 recording ID、scene、task 和可选 goal
- **THEN** 服务 SHALL 将安全解析后的录制绝对路径传给 `createTaskFromRecording()`
- **AND** 创建结果 SHALL 与 CLI 使用相同的覆盖保护、canonical 资产和静态验证

#### Scenario: 同一录制创建多个任务
- **WHEN** 用户为同一 recording ID 提交不同且不存在的 scene/task
- **THEN** 系统 SHALL 允许每次重新运行既有创建编排
- **AND** 系统 SHALL NOT 为录制与任务建立额外持久化映射
