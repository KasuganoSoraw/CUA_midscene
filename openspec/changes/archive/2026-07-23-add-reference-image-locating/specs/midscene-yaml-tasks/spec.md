## ADDED Requirements

### Requirement: resolved YAML 解析本地参考图路径
任务 resolver SHALL 保留 canonical `task.yaml` 中的任务内相对图片路径，并仅在 resolved task 中将本地 `images[].url` 转换为经过验证的绝对路径；HTTP(S) 和 data URL SHALL 保持原值。

#### Scenario: 解析任务内参考图
- **WHEN** canonical YAML 图片 URL 指向任务目录内存在的相对文件
- **THEN** resolved YAML SHALL 使用该文件的绝对路径
- **AND** canonical YAML SHALL 保持不变

#### Scenario: 本地参考图无效
- **WHEN** 图片路径不存在或相对路径逃逸任务根目录
- **THEN** resolver SHALL 在初始化 ComputerAgent 前失败
- **AND** SHALL NOT 将图片转换为 Base64、忽略图片或继续纯文本执行

### Requirement: 原生 YAML runner 执行图片 prompt
TypeScript runner SHALL 将解析后的 Midscene `locate.images` 原样交给 `agent.runYaml()`，不得在 executor 中实现模板匹配、业务路由或替代定位。

#### Scenario: 执行图片点击步骤
- **WHEN** resolved YAML 包含合法 `aiTap` 或 `aiDoubleClick` 图片 prompt
- **THEN** runner SHALL 通过当前 ComputerAgent 和 Midscene YAML parser 执行该动作
