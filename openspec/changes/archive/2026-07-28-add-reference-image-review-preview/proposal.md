## Why

最新录制与转换链路已经会为部分点击步骤生成干净的 reference patch，并在 `task.yaml` 的 `locate.images` 中作为执行资产引用；当前复核页面既看不到该图片，也无法把这种 Flow 识别为标准点击步骤，导致用户无法确认实际定位依据，只能进入高级 JSON。

## What Changes

- 在复核任务视图中同时投影 processed log 的可选 `screenshot_reference` 和 canonical `task.yaml` 的 `locate.images`，区分“可用录制目标小图”与“已绑定执行参考图”。
- 在步骤证据区增加参考图展示及清晰的“执行定位参考”语义，与全局图、带点击标记的局部图区分。
- 扩展点击/双击语义编辑器，使其识别 `aiTap`/`aiDoubleClick` 与 `locate.prompt + locate.images` 结构；修改目标描述时完整保留图片引用。
- 对本地参考图继续复用受限于任务 `source/` 的文件读取接口，不新增任意路径接口、上传器或第二份资产。
- 增加服务组合、语义往返、前端类型与构建测试。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `local-task-review-app`: 复核视图需要展示步骤的图片定位资产，并允许标准表单安全往返编辑带 `locate.images` 的点击类 Flow。
- `task-structure-editing`: 无独立录制证据的新增或人工步骤不再继承其他步骤截图，改为显示中性占位图。

## Impact

- 影响 `execution/review/service`、`execution/review/shared`、`execution/review/web` 及对应测试。
- 复用现有 Fastify evidence API，不改变 canonical YAML 结构、任务保存协议或 CLI 命令。
- 不增加运行时依赖，不修改录制器和执行器的参考图生成/解析逻辑。
