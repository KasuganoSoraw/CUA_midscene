## ADDED Requirements

### Requirement: trace 可建议使用视觉参考
trace 生成模型 SHALL 仅为 click 或 doubleClick operation 可选输出 `useReferenceImage: true`，表示目标主要依赖视觉外观且纯文字定位仍易混淆；字段不得替代非空、可执行的 `prompt`。

#### Scenario: 难以描述的企业图标
- **WHEN** 点击目标没有稳定文字并主要依赖形状、颜色或企业自定义图形识别
- **THEN** trace operation MAY 输出 `useReferenceImage: true`
- **AND** operation prompt SHALL 仍描述目标区域、相对锚点和点击意图

#### Scenario: 文字目标无需图片
- **WHEN** 目标可由稳定可见文字和所在区域准确区分
- **THEN** trace operation SHALL NOT 因目标尺寸较小而强制输出 `useReferenceImage: true`

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
