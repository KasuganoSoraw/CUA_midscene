# 执行专用 SubAgent 与宿主入口

GDEClaw Main Agent 选择 Skill，CUA SubAgent 执行指定电脑操作，不重新发现 Skill，不承担业务分析或报告撰写。每次 invocation 独立，成功后停止 Tool，失败后不自动重试、更换任务或切换策略。

| 配置 | 模型可见工具 | 结构化绑定 |
| --- | --- | --- |
| 执行专用 | cua_execute | skillName，默认 guided，显式 replay |
| freeform_only=True | cua_execute | 仅 freeform，拒绝 Skill 绑定 |

Agent 不提供 cua_catalog 或 cua_workbench 模型 Tool，未知调用在 Registry 被拒绝。GDEClaw 使用 CuaAgent(...) 和 load_agent_definition()；底层 Catalog、CLI 和宿主 Workbench 调用不经过模型工具注册表。

结构化请求示例：

```json
{"task":"执行已选定的告警查询","execution":{"skillName":"network-alarm-search","inputs":{}}}
```

execution 与模型调用严格比较；策略缺省归一化为 guided。Skill 由 Runtime 在 CUA_SKILLS_ROOT 中校验与解析，不接受模型文件路径。旧 scene/task 绑定不适用于执行专用 Agent。

自由目标示例：

```json
{"task":"打开系统并导出本月销售报表"}
```

此请求直接绑定 freeform，不依赖 Skill 根或 Catalog；有明确显示器约束时可显式传入 freeform、goal 和 displayId。

宿主通过 Keeper 持有的 Runtime worker 发送 method=workbench，取得 URL 和 reused，由宿主前端打开页面。此路径不经过 Agent 模型；不要在启动请求返回后关闭 worker。

完整资产 Schema、版本要求、接口示例、安全边界和迁移步骤见 [CUA Skill 集成契约](gdeclaw-skill-integration.md)。本仓库实现正式目录资产，不宣称已验证 GDEClaw 内部注册、启用、签名或分发流程。
