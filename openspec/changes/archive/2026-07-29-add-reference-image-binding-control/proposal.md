## Why

任务复核页目前虽然能区分录制阶段生成的小图与 YAML 已绑定的 `locate.images`，但仍使用“目标小图/参考图”等不一致名称，并要求普通用户通过高级 JSON 完成绑定。用户无法从界面直接决定该图片是否参与执行定位，也容易误解它是固定点击坐标。

## What Changes

- 将录制小图和已绑定图片统一称为“定位参考图”，单图场景不再显示“目标小图 1”等数量描述。
- 在定位参考图区域提供“用于定位”和“取消使用”操作，直接更新当前步骤的浏览器草稿、变更对比和高级 JSON 预览。
- 明确说明定位参考图用于帮助 Midscene 识别目标外观，执行时仍结合页面与目标描述进行视觉定位，不代表固定坐标。
- 仅允许可写的 click/doubleClick 标准步骤修改绑定；builtin 任务和不支持的动作只展示状态与原因。
- 第一版普通界面只管理当前录制步骤的一张本地定位参考图，同时无损保留已有 YAML 中的多图 `locate.images`，不得静默删减或覆盖。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `local-task-review-app`: 增加定位参考图的统一命名、用途说明、单图绑定/取消使用和兼容性要求。

## Impact

- 主要影响 `execution/review/web` 的证据展示、状态文案与语义表单交互。
- 复用 `execution/review/shared/step-editor.ts` 现有 `referenceImages` 与 `locate.images` 双向转换，不新增长期配置文件。
- 不修改 review HTTP API、`execution/cua` 转换流程、Midscene YAML 协议或执行器行为。
- 需要补充 step editor 和浏览器交互验证，确保草稿联动、只读边界以及多图无损往返。
