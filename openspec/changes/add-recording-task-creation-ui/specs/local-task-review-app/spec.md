## ADDED Requirements

### Requirement: 本地复核应用提供从录制创建任务页
本地 review 应用 SHALL 提供独立于任务步骤编辑器的“从录制创建任务”页签，并 SHALL 使用与现有任务选择一致的左侧列表和右侧详情布局。

#### Scenario: 浏览录制目录
- **WHEN** 用户进入录制创建页且录制根可用
- **THEN** 左侧 SHALL 展示动态发现的录制目录
- **AND** 右侧 SHALL 使用占位卡片展示视频和事件日志名称、大小及录制基本信息
- **AND** 页面 SHALL NOT 尝试播放视频或加载完整事件日志正文

#### Scenario: 录制根未配置
- **WHEN** 用户进入录制创建页且录制根不可用
- **THEN** 页面 SHALL 展示 `CUA_RECORDINGS_ROOT` 配置提示
- **AND** 任务复核页签 SHALL 继续可用

### Requirement: 用户通过语义表单创建完整任务
录制创建页 SHALL 允许用户选择或输入场景、输入任务标识和可选目标，并 SHALL 在一次操作中创建完整可复核任务，而不暴露 trace 等内部产物。

#### Scenario: 创建到已有场景
- **WHEN** 用户从 Combobox 选择已有 scene、输入不存在的 task 并选择有效录制
- **THEN** 页面 SHALL 提交完整任务创建请求
- **AND** goal 留空时 SHALL 以空任务描述创建

#### Scenario: 创建到新场景
- **WHEN** 用户在 Combobox 输入合法的新 scene ID
- **THEN** 系统 SHALL 使用该 ID 创建新用户场景和任务
- **AND** 新场景初始 title SHALL 使用该 scene ID

#### Scenario: 生成任务期间
- **WHEN** 完整任务创建请求尚未结束
- **THEN** 页面 SHALL 展示“正在生成任务”的不确定进度状态
- **AND** 页面 SHALL 禁用录制选择、表单和重复提交
- **AND** 页面 SHALL NOT 展示虚假百分比或要求流式日志

#### Scenario: 创建成功
- **WHEN** 服务成功创建并验证完整任务
- **THEN** 页面 SHALL 刷新任务 catalog
- **AND** 页面 SHALL 自动切换到任务复核页并打开新任务

#### Scenario: 创建失败
- **WHEN** 创建流程返回错误
- **THEN** 页面 SHALL 恢复表单并在页面内展示错误
- **AND** 页面 SHALL NOT 使用浏览器原生 alert

