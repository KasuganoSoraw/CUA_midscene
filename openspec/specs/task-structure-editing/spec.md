# task-structure-editing Specification

## Purpose

定义录制任务步骤插入、删除、移动时的统一命名、输入迁移、证据绑定与可写边界，确保结构变化后 YAML 执行顺序、运行时参数和原始录制证据仍保持一致且可校验。

## Requirements

### Requirement: 结构编辑保持统一步骤命名
复核应用 SHALL 对插入、删除和移动操作重新生成连续的 `step-NNN | <operation-type>` 名称，并以 YAML `tasks[]` 数组顺序作为执行顺序，不得引入 `manual-*` 等第二套用户可见命名。

#### Scenario: 在中间插入步骤
- **WHEN** 用户在 `step-008` 与 `step-009` 之间插入 click 步骤
- **THEN** 新步骤 SHALL 命名为 `step-009 | click`
- **AND** 原 `step-009` 及后续步骤 SHALL 按新顺序连续重编号

#### Scenario: 移动步骤
- **WHEN** 用户将一个步骤移动到新的数组位置
- **THEN** 所有步骤 SHALL 按移动后的顺序重新编号
- **AND** 保存后的步骤编号 SHALL 唯一、连续且严格递增

### Requirement: 输入契约随结构编辑事务性迁移
结构编辑 SHALL 基于解析后的 YAML 对象同步重命名步骤输入占位符与 `task.json.inputs` 键，不得通过不受约束的全文字符串替换迁移输入。

#### Scenario: 插入点后存在输入步骤
- **WHEN** 插入导致原 `step-010 | input` 变为 `step-011 | input`
- **THEN** YAML 占位符 SHALL 变为 `{{step-011-input}}`
- **AND** `task.json.inputs` SHALL 将对应定义迁移到 `step-011-input`

#### Scenario: 新增固定输入动作
- **WHEN** 用户新增使用固定字符串的 `KeyboardTypeText` 步骤且未选择暴露运行时参数
- **THEN** 系统 SHALL 只在 YAML 中保存固定值
- **AND** `task.json.inputs` SHALL NOT 新增声明

### Requirement: 录制证据身份独立于当前步骤顺序
`task.json.source` SHALL 可选保存当前 `step-NNN` 到原始 trace step 的证据绑定；结构编辑 SHALL 同步迁移绑定，但 SHALL NOT 修改 `source/` 录制文件或复制截图路径。

#### Scenario: 插入人工步骤
- **WHEN** 用户在两个录制步骤之间插入人工步骤
- **THEN** 新步骤的证据绑定 SHALL 为空
- **AND** 后续录制步骤 SHALL 继续绑定其原始 trace step

#### Scenario: 展示人工步骤上下文
- **WHEN** 人工步骤没有独立录制证据
- **THEN** 页面 MAY 展示最近录制步骤的截图作为上下文参考
- **AND** 页面 SHALL 明确标记该截图不是本步骤录制证据

### Requirement: 结构编辑只写入用户任务
新增、删除、移动和确认保存 SHALL 仅允许作用于 `origin=user` 且 `writable=true` 的任务。

#### Scenario: 尝试编辑内置任务
- **WHEN** 客户端向 builtin task 发送结构编辑请求
- **THEN** 服务 SHALL 拒绝请求且不得修改 Skill 安装目录
