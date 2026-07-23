## Why

当前录制 crop 通过红叉准确标示用户点击位置，适合 trace 生成，却会遮挡目标真实外观，无法直接作为 Midscene 图片 prompt。对于无稳定文字、难以用自然语言区分的企业图标，需要在不削弱现有 trace 证据的前提下生成干净参考图，并将其贯通到 canonical Midscene YAML。

## What Changes

- 录制截图处理新增无标注、目标居中的 PNG reference patch，同时完整保留现有全屏截图和带红叉 crop 的行为。
- trace 模型可为确有必要的 click/doubleClick operation 输出可选 `useReferenceImage: true`，表示建议使用视觉参考，而不是判断目标是否属于“小图标”。
- trace 转换器根据 processed log 中的确定性图片路径生成原生 Midscene `locate.images`，模型不生成文件路径、Base64 或图片名称。
- canonical YAML 保存任务内相对图片路径；执行解析阶段将本地图片路径转换为绝对路径，避免依赖进程当前目录。
- 录制任务整体 aiAct prompt 保留图片 prompt，不将其错误降级为纯文本或静默忽略。
- 图片、路径或模型输出不完整时显式失败，不回退到纯文本点击。

## Capabilities

### New Capabilities
- `recording-reference-images`: 定义录制阶段无标注参考图的生成、格式、路径和与现有标注 crop 的并存规则。

### Modified Capabilities
- `trace-to-midscene-flow`: trace operation 可选择视觉参考，转换器确定性生成 Midscene `locate.images`。
- `midscene-yaml-tasks`: resolved YAML 解析任务内本地图片路径，并由原生 Midscene YAML runner 执行图片 prompt。
- `ai-act-execution`: 录制任务整体 aiAct 投影应保留参考图片 prompt 及路径语义。

## Impact

- 影响 `record/Aloha_Learn` 的截图处理、trace prompt、trace 清洗和测试。
- 影响 `execution/cua` 的 trace 契约、YAML 转换、任务解析、整体 aiAct prompt 投影和测试。
- 需要更新 record、execution、任务契约与 Skill 文档。
- 不新增运行时依赖，不修改现有 input、KeyboardTypeText 或 Midscene computer use 执行底座。
