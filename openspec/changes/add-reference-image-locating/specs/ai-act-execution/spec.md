## ADDED Requirements

### Requirement: 录制任务整体 aiAct 保留参考图片
系统 SHALL 在把录制任务投影为单次 aiAct 时，同时汇总有序文字步骤和其中的参考图片，并使用 Midscene 原生图片 prompt 作为临时 `ai` action 输入。

#### Scenario: 多个步骤包含参考图
- **WHEN** resolved task 的一个或多个 click/doubleClick action 包含 `locate.images`
- **THEN** 最终 aiAct prompt SHALL 保留步骤顺序并引用对应图片名
- **AND** 临时 YAML 的 `ai` action SHALL 包含去重后的 `images`

#### Scenario: 图片定义冲突
- **WHEN** 多个步骤使用相同图片名但映射到不同 URL，或图片结构无法解释
- **THEN** aiAct prompt 构造 SHALL 显式失败
- **AND** SHALL NOT 丢弃图片、改写为纯文本或切换逐步执行
