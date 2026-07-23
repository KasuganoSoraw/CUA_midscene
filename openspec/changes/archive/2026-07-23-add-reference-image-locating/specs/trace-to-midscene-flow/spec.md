## ADDED Requirements

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
