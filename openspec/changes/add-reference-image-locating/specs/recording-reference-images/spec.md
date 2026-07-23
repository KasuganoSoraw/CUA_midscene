## ADDED Requirements

### Requirement: 点击录制同时生成标注 crop 与干净参考图
录制截图处理 SHALL 为具有坐标的 click 和 doubleClick 动作保留现有带红叉 crop，并额外生成以录制点击点为中心、无任何标注的 PNG 参考图；两类图片不得互相覆盖。

#### Scenario: 生成点击步骤截图
- **WHEN** 录制动作包含有效点击坐标
- **THEN** processed log SHALL 同时记录现有 `screenshot_crop` 和新增 `screenshot_reference`
- **AND** `screenshot_crop` SHALL 继续包含红叉并供 trace 生成使用
- **AND** `screenshot_reference` SHALL 为 `96×96` PNG 且不包含程序绘制的红叉、边框或文字

#### Scenario: 非定位动作不生成参考图
- **WHEN** 录制动作是 type、keyboard、scroll 或其他无点击坐标动作
- **THEN** processed log SHALL NOT 声明 `screenshot_reference`

### Requirement: 参考图生成失败必须暴露
录制处理 SHALL 在应生成参考图但无法读取帧、裁剪或保存图片时终止，不得复用带红叉 crop、全屏截图或空路径作为替代。

#### Scenario: 参考图无法保存
- **WHEN** click 或 doubleClick 的 reference patch 保存失败
- **THEN** 录制处理 SHALL 抛出包含动作和时间信息的错误
- **AND** SHALL NOT 输出声称完整的 processed log
