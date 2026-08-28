## REMOVED Requirements

### Requirement: 系统生成独立 Agent Runtime 精简包
**Reason**: 新的 `cua-midscene/agent` 已成为统一 Agent-facing 集成形态，不再维护第二套裁剪发布物。
**Migration**: Host 从完整 `cua-midscene` 包的 `./agent` 子路径加载 definition 和 Tool。

### Requirement: 精简包只包含首期运行资产
**Reason**: 独立精简包及其发布白名单被删除。
**Migration**: 使用完整包发布面，并通过 Agent Tool 契约限制可调用能力。

### Requirement: 精简 CLI 支持自然语言 Computer Use
**Reason**: 专用 CLI 与包名被删除，避免和完整 CLI、Agent Tool 形成重复入口。
**Migration**: Host 调用 `cua_execute` 的 `freeform` strategy；人工开发仍可使用完整 CLI 的 `act run --prompt`。

### Requirement: 精简包提供窄 Node API
**Reason**: 窄 API 被 canonical Agent definition 与三个宿主无关 Tool 取代。
**Migration**: 从 `cua-midscene/agent` 导入 `cuaAgentDefinition`、`cuaCatalog`、`cuaExecute` 和 `cuaWorkbench`。

### Requirement: 数据与凭证保持在发布物外部
**Reason**: 该要求只约束已删除的独立精简发布物。
**Migration**: 完整 CUA 包继续通过外部数据根和环境配置管理运行数据与凭证。

### Requirement: Skill 指导 Agent 安全调用
**Reason**: 独立精简包的 `SKILL.md` 被 canonical Agent instructions 取代。
**Migration**: Host 加载 `cuaAgentDefinition.instructions`，完整 Skill 文档继续描述底层 CLI。

### Requirement: 精简包支持后续增量扩展
**Reason**: 后续集成扩展统一发生在 Agent Capability 和 Host Adapter，不再扩张旧发布白名单。
**Migration**: 在 `cua-midscene/agent` 增加兼容的 Tool 契约或由 Host Adapter 转换。
