## Context

Python SubAgent 使用 JSONL 调用 TypeScript Runtime。录制解析和模型调用由 cua_record 提供；Workbench 使用 Vue、本地 Fastify 和文件草稿。正式 CUA Skill 与普通宿主 Skill 共用受信根目录。

## Goals / Non-Goals

目标是生成并导入单个 CUA Skill，统一身份、路径边界和执行绑定。宿主原生接口负责安装、注册与启用；CUA 不实现这些内部机制、签名、SkillHub 或业务数据分析。

## Decisions

- 增加独立 skills 资产模块。0.3 task.json 使用 skillName，不保存 scene/task；0.1 cua-manifest.json 声明 kind、skillName 与 taskSchemaVersion。SKILL.md frontmatter 是身份与描述来源，四处身份必须一致。
- RuntimeLayout 集中解析 CUA_SKILLS_ROOT，沿用进程环境、.env.local、.env 优先级。缺省时 Skill 功能明确失败，freeform 仍可运行。旧项目解析仅用于显式旧版 CLI。
- 每次读取、保存、删除、图片上传、执行都重新验证合法 Manifest 与真实路径；只接受 Skill 内的本地文件引用，拒绝绝对路径、链接越界和未标记目录。
- 沿用 TraceGenerator 模型客户端归纳 name/description/goal，沿用 trace 转换构造步骤。不从用户表单获取身份。扫描正式根下所有目录及 SKILL.md 名称，占用时使用安全随机后缀并统一身份，不重复调用模型。
- CUA_SKILL_EXPORT_TEMP_ROOT 配置独立导出根，缺省使用系统临时目录。组装校验完成后生成根层单 Skill ZIP，POST 到 GDECLAW_API_BASE_URL 的 /api/gdeclaw/skills/import，查询参数 enable=true 与 target_name，multipart 仅包含 file。不发送 X-Agent-Id、Token 或 rename_map，不手动设置 Content-Type。
- 导入不自动重试；409 不覆盖或换名重传，网络和超时报告不确定结果。ZIP 保留为诊断产物。2xx 合法响应后从 CUA_SKILLS_ROOT 重新校验全部正式资产，失败不能报告创建成功。
- Workbench 使用 /api/skills 与平铺列表。保留草稿、revision、参考图与执行反馈，保存正式资产不依赖宿主更新 API。
- 模型结构化执行使用 skillName，省略策略时归一化为 guided。保留自由目标 freeform、显式 replay、不可篡改绑定和成功终态。宿主数据根不进入模型参数。
- Review 服务身份包含规范化 Skill 根，不同根不复用。宿主 Workbench 调用保留独立于模型。

## Risks / Trade-offs

- 原生导入使用 mock HTTP 回归，真实宿主的 ZIP 解包、注册和启用仍需联调验证。
- 文件系统并发和外部替换：宿主仲裁安装冲突，CUA 保留真实路径校验、revision 与保存写锁；不把本地目录权限当成远程多租户安全机制。
- 契约不兼容：显式版本与迁移说明；旧项目不自动写入共享 Skill 根。
