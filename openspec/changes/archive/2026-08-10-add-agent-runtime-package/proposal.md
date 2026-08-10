## Why

GDE Claw 首期只需要自然语言 Computer Use 与无剪贴板键盘输入能力，但当前 `cua-midscene` 发布面同时包含录制任务、转换、项目资产和复核前端，难以作为轻量工具或 Skill 集成。需要在不删除完整工程能力的前提下，提供一个可独立安装、可通过 CLI 或 Node API 调用的首期精简发布物。

## What Changes

- 新增 Agent Runtime 精简发布形态，仅包含自然语言 aiAct、Midscene Computer Agent、`KeyboardTypeText`、配置、报告契约和必要文档。
- 新增不依赖任务、录制和 Review 模块的专用 CLI，并保留稳定的 `act run --prompt` 命令语义。
- 新增面向工具注册方的窄 Node API 导出，使未来 GDE Claw 适配器无需模拟 CLI 或复制执行逻辑。
- 新增唯一的精简打包命令和发布白名单，产物不得包含用户数据、录制器、任务资产、复核前端、源码测试或本地环境文件。
- 保留现有完整 CLI、完整 Skill 和全部源码能力，不删除、不降级现有录制与任务流程。
- 更新中文文档，明确源码开发命令、完整发布物和 Agent Runtime 精简包的差异。

## Capabilities

### New Capabilities

- `agent-runtime-package`: 定义首期 Agent 精简包的内容边界、CLI/API 契约、Skill 指引、构建验证和后续扩展方式。

### Modified Capabilities


## Impact

- 影响 `execution` 的构建脚本、专用 CLI/API 入口、发布说明和测试。
- 新增独立精简包产物，但不改变现有 `cua-midscene` 完整包的命令与运行行为。
- GDE Claw 后续可以选择调用精简包 CLI 或 Node API；具体工具注册适配器仍等待宿主接口确认。
