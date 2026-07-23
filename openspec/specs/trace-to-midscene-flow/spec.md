## Purpose

定义从 `record` 教学录制产物到 `execution` 中 Midscene computer use 执行流程的转换边界、项目产物组织方式、IR 要求和 runner 行为。
## Requirements
### Requirement: Converter 直接生成 Midscene YAML
TypeScript converter SHALL 只根据 ShowUI-Aloha trace 的结构化 operation 与录制时间生成任务根目录的 `task.yaml`。

#### Scenario: 转换受支持的 trace
- **WHEN** trace 包含 click、input、keyboard 或 wait operation
- **THEN** converter SHALL 分别生成 `aiTap`、`KeyboardTypeText`、`KeyboardPress` 或 `aiWaitFor` action
- **AND** 录制间隔 SHALL 以裁剪后的 `sleep` action 表达

#### Scenario: trace 信息不足
- **WHEN** operation 缺失、类型未知或必填字段为空
- **THEN** converter SHALL 失败且不写出半成品 `task.yaml`
- **AND** converter SHALL NOT 从其他自然语言字段猜测动作

### Requirement: 新输入完全来源于 trace input operation
converter SHALL 为每个结构化 input operation 生成稳定输入 ID、中文说明、录制默认值和 YAML 占位符。

#### Scenario: 初始化多个输入
- **WHEN** trace 依次包含三个 input operation
- **THEN** `task.json` SHALL 声明三个由对应 trace step ID 派生的输入
- **AND** `task.yaml` SHALL 在对应 `KeyboardTypeText.value` 中引用这些输入

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

### Requirement: trace 可建议使用视觉参考
trace 生成模型 SHALL 仅为 click 或 doubleClick operation 可选输出 `useReferenceImage: true`。当点击目标本体是无可见文字标签的紧凑纯图标或符号控件时，模型 SHALL 输出该字段，而不再额外判断纯文字定位是否足够；字段不得替代非空、可执行的 `prompt`。

#### Scenario: 无文字小图标
- **WHEN** 红叉下方点击目标本体是紧凑的纯图标或符号控件
- **AND** 目标本身没有可见文字标签
- **THEN** trace operation SHALL 输出 `useReferenceImage: true`
- **AND** operation prompt SHALL 仍描述目标区域、相对锚点和点击意图

#### Scenario: 文字目标无需图片
- **WHEN** 目标可由稳定可见文字和所在区域准确区分
- **OR** 目标是带相邻可见文字标签的单选框或复选框
- **THEN** trace operation SHALL NOT 因控件内部含有小图形而输出 `useReferenceImage: true`

### Requirement: 转换器确定性生成 Midscene 图片定位
converter SHALL 根据 trace step 与 processed log 的既有一一对应关系取得参考图，而不得让模型生成或猜测文件路径。

#### Scenario: 视觉参考步骤转换成功
- **WHEN** click 或 doubleClick operation 包含 `useReferenceImage: true` 且对应 processed step 提供有效 `screenshot_reference`
- **THEN** converter SHALL 生成包含 `locate.prompt` 与 `locate.images` 的原生 Midscene action
- **AND** 图片名 SHALL 由稳定 step ID 派生
- **AND** prompt SHALL 明确要求匹配该参考图正中央的主要目标

#### Scenario: 视觉参考证据缺失
- **WHEN** operation 请求视觉参考但 processed step 缺少、越界引用或无法找到 reference patch
- **THEN** converter SHALL 失败并指出 step 与图片问题
- **AND** SHALL NOT 回退为纯文本点击

