## MODIFIED Requirements

### Requirement: 录制证据身份独立于当前步骤顺序
`task.json.source` SHALL 可选保存当前 `step-NNN` 到原始 trace step 的证据绑定；结构编辑 SHALL 同步迁移绑定，但 SHALL NOT 修改 `source/` 录制文件、复制截图路径或把其他步骤的截图作为当前步骤证据。

#### Scenario: 插入人工步骤
- **WHEN** 用户在两个录制步骤之间插入人工步骤
- **THEN** 新步骤的证据绑定 SHALL 为空
- **AND** 后续录制步骤 SHALL 继续绑定其原始 trace step

#### Scenario: 展示无证据人工步骤
- **WHEN** 人工步骤没有独立录制证据
- **THEN** 页面 SHALL 展示默认占位图
- **AND** 页面 SHALL NOT 自动展示最近录制步骤的截图
