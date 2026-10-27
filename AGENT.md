# AGENT

## 项目简介

本项目探索基于真实桌面环境的 Computer Use Agent 工作流。顶层 Python `agent` 是接受完整任务的专门 Subagent；Windows-only `recorder` 负责采集视频与键鼠日志；`record` 负责将录制资产转换为结构化日志与 trace；TypeScript `execution` 负责任务初始化、参数化调用和执行，并通过 Midscene computer use 操作本地 Chrome、堡垒机、远程桌面或企业内网页系统。

项目不以 browser-use、Playwright、Puppeteer 或 CDP 作为执行底座。主执行路径围绕 Midscene computer use 展开。

## 规范

1. 开发过程、文档、提交说明和面向用户的回复均使用中文；代码标识、API、命令、路径和第三方专有名词可以保留英文。
2. 项目不通过兜底、静默跳过、硬编码成功路径或伪造结果掩盖执行缺陷；不确定、不可执行或模型能力不足时应显式失败并保留诊断信息。
3. 不为单一演示用例构造特化逻辑。样例可验证链路，但任务契约、目录和执行器设计必须面向后续业务流程。
4. 执行任务维护的开发者或维护型 Agent 应区分创建、长期修改和单次调用。长期修改必须先展示 YAML 原值、新值和原因并等待确认；Python CUA Subagent 的模型工具不提供任务创建、长期编辑或 Workbench 调用能力。
5. `agent` 使用 Python，保存 canonical definition、调用级模型 loop、私有 Tool、Runtime client 和事件；`execution` 全面使用 TypeScript，保存 Runtime bridge、转换、任务解析、CLI 与 Midscene 适配。持久化 JSON 契约只在文件边界通过 Ajv 校验，Midscene YAML 最终由 Midscene parser 校验。
6. `task.yaml` 是唯一长期执行事实源，不维护自定义 flow、route、overrides、proposal 或 history。`task.json` 保存输入定义和录制默认值；本次参数只进入运行快照。
7. 正式任务位于 `<CUA_SKILLS_ROOT>/<skill-name>`。SKILL.md frontmatter name、目录、cua-manifest.json 与 task.json 的身份必须一致。只管理合法 CUA 标记的完整资产，普通宿主 Skill 不进入 CUA 的编辑、删除或执行范围。运行快照、结果、报告和截图只写入 `<CUA_DATA_ROOT>/runs/<run-id>`。旧 projects 仅供显式兼容 CLI 使用，不是新工作流的资产目录。
8. 每个 trace step 对应一个 `step-NNN | <operation-type>` Midscene task；输入 ID 为 `step-NNN-input`。结构编辑统一重编号并迁移输入及证据绑定，不得丢失引用或启用 continueOnError。
9. GDEClaw Main Agent 选择 Skill 并提交完整任务。CUA 只向模型暴露 cua_execute，使用 skillName、inputs 和确定的策略，缺省 guided，明确严格回放时 replay；无绑定则 freeform，不重新发现或选择 Skill。Catalog 仅供非模型调用方查询。失败后不得自动切换、修改任务或重试，成功后不继续 GUI 操作或业务分析。
10. Runtime 不提供跨进程 computer use 并发锁。上层调用方必须保证真实桌面操作串行执行，不得把执行器描述为并发安全。
11. 单个函数或方法不得超过 50 行，应按职责组织代码，不通过压缩语句或机械转发规避限制。TypeScript 主流程应保持可顺读；抽象应服务于复用、隔离 I/O/第三方边界、独立业务规则或复杂度控制。
12. Agent 到 Runtime 的依赖方向固定为 `agent (Python) -> execution/runtime-bridge (TypeScript) -> Midscene`。`execution` 不得导入 Python Agent、模型 SDK、Agent prompt 或 GDEClaw；GDEClaw 不得注册 CUA 内部 Tool。Agent invocation 不保存跨调用 Session，依赖只在安装/部署阶段准备。
13. 仓库提供 Python 包、单次进程 invocation、Review `--dev` 调试入口和 Runtime bridge。Skill 生成在独立临时目录完成并打包 ZIP，通过宿主注入的 GDECLAW_API_BASE_URL 调用原生导入接口；GDEClaw 负责正式安装、注册与启用。CUA 不直接安装到正式 Skill 根，不实现宿主网络服务、生命周期管理或长期 Agent daemon。
14. `execution/SKILL.md` 是 CLI 维护说明；正式任务的 SKILL.md 是供 GDEClaw 选择与委派的 Skill 描述，Runtime 读取其身份并校验 CUA 标记。Python Agent 不自行扫描或加载这些 Markdown。Workbench 只由宿主设置入口调用 Runtime workbench，浏览器和 worker 生命周期归宿主所有。不臆造 GDEClaw 注册、更新、启用或分发 API。
15. 代码、注释、文档、Skill 和 UI 文案只描述稳定设计、能力边界和必要用法。变更历史只在用户明确要求时记录；其他场景不写入对话过程、用户纠正过程、版本演进或前后方案比较，修改时同步清理同类元叙述。
16. 源码仓的环境变量契约只保存在根 `.env.example`，本地真实值只保存在被忽略的根 `.env.local`。TypeScript Runtime 按“进程环境、根 `.env.local`、根 `.env`”读取；Python 包由调用方注入进程环境。组件和独立 execution 发布包不得携带环境文件。
