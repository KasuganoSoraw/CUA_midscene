## Why

CUA 任务需要作为 GDEClaw Skill 的正式目录资产，由宿主选择并交给执行专用 SubAgent。独立的场景目录无法提供统一身份、资产边界和直接编辑能力。

## What Changes

- **BREAKING** Workbench 使用平铺 Skill 列表与 skillName API，录制生成不需要命名表单。
- 增加 CUA_SKILLS_ROOT、版本化 Manifest、SKILL.md 身份与安全资产解析。
- 在受控暂存目录组装、校验并安装完整 Skill，保存直接作用于正式资产。
- **BREAKING** 默认模型结构化执行绑定使用 skillName，缺省 guided；保留独立旧版 CLI 兼容。
- Workbench 服务复用同时绑定数据根与 Skill 根；宿主负责浏览器与 worker 生命周期。

## Capabilities

### New Capabilities

- `cua-skill-assets`: 单 Skill 创建、发现、安全校验、直接编辑与可信执行绑定。

### Modified Capabilities

无。相关旧版场景 CLI 保留为独立兼容入口，新工作流由 cua-skill-assets 完整定义。

## Impact

涉及 TypeScript 资产、录制生成、Review API/Vue、Runtime Bridge、Python Agent 契约、测试与集成文档。不涉及 GDEClaw 内部 Skill 注册、启用、签名或分发 API。
