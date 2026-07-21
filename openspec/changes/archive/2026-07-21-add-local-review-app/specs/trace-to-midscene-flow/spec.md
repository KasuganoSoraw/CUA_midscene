## MODIFIED Requirements

### Requirement: 每个 trace step 保留为独立 Midscene task
converter SHALL 将每个 trace step 按原顺序生成一个 Midscene `tasks[]` 项，使用 `step-NNN | <operation-type>` 作为初始名称，并在 `task.json.source` 中建立当前步骤到原始 trace step 的证据绑定。

#### Scenario: 步骤包含录制等待
- **WHEN** 某一步与前一步存在需要保留的录制间隔
- **THEN** converter SHALL 将裁剪后的 `sleep` 放在该步骤 task 的 flow 首位
- **AND** 本步骤的交互动作 SHALL 紧随其后

#### Scenario: 生成证据绑定
- **WHEN** trace 与 processed log 按相同长度和顺序完成转换
- **THEN** 每个生成的 `step-NNN` SHALL 绑定对应的原始 trace step ID
- **AND** 绑定 SHALL NOT 重复保存全局图或局部图路径

#### Scenario: trace step 标识非法
- **WHEN** step ID 非正整数、重复或未按轨迹顺序严格递增
- **THEN** converter SHALL 失败且不写出任务资产
