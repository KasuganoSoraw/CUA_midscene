# AGENT

## 项目简介

本项目探索基于真实桌面环境的 Computer Use Agent 工作流。顶层 Python `agent` 是接受完整任务的专门 Subagent；Windows-only `recorder` 负责采集视频与键鼠日志；`record` 负责将录制资产转换为结构化日志与 trace；TypeScript `execution` 负责任务初始化、参数化调用和执行，并通过 Midscene computer use 操作本地 Chrome、堡垒机、远程桌面或企业内网页系统。

项目不以 browser-use、Playwright、Puppeteer 或 CDP 作为执行底座。主执行路径围绕 Midscene computer use 展开。

## 规范

1. 开发过程、文档、提交说明和面向用户的回复均使用中文；代码标识、API、命令、路径和第三方专有名词可以保留英文。
2. 项目不通过兜底、静默跳过、硬编码成功路径或伪造结果掩盖执行缺陷；不确定、不可执行或模型能力不足时应显式失败并保留诊断信息。
3. 不为单一演示用例构造特化逻辑。样例可验证链路，但任务契约、目录和执行器设计必须面向后续业务流程。
4. 执行任务维护的开发者或维护型 Agent 应区分创建、长期修改和单次调用。长期修改必须先展示 YAML 原值、新值和原因并等待确认；Python CUA Subagent 的三个私有 Tool 不提供任务创建或长期编辑能力。
5. `agent` 使用 Python，保存 canonical definition、调用级模型 loop、私有 Tool、Runtime client 和事件；`execution` 全面使用 TypeScript，保存 Runtime bridge、转换、任务解析、CLI 与 Midscene 适配。持久化 JSON 契约只在文件边界通过 Ajv 校验，Midscene YAML 最终由 Midscene parser 校验。
6. `task.yaml` 是唯一长期执行事实源，不维护自定义 flow、route、overrides、proposal 或 history。`task.json` 保存输入定义和录制默认值；本次参数只进入运行快照。
7. Skill 内的 `execution/projects` 是只读 builtin catalog，用户任务只写入 `<CUA_DATA_ROOT>/projects`；运行快照、结果、报告和截图只写入 `<CUA_DATA_ROOT>/runs/<run-id>`。TypeScript Runtime worker 在自身 Node 进程内直接调用 Midscene API，不启动额外任务 runner；Python Agent 启动该 worker 属于语言边界，不是第二套执行器。
8. 每个 trace step 对应一个 `step-NNN | <operation-type>` Midscene task；输入 ID 为 `step-NNN-input`。不得重编号、复用编号、打乱顺序或启用 `continueOnError`。
9. GDEClaw Main Agent 只向 Python CUA Subagent 提交完整任务；CUA Subagent 必须在私有 Tool 中显式选择执行模式：稳定录制任务使用 replay，需要统一规划时使用 guided，无录制使用 freeform。失败后不得自动切换、修改任务或重试。
10. Runtime 不提供跨进程 computer use 并发锁。上层调用方必须保证真实桌面操作串行执行，不得把执行器描述为并发安全。
11. TypeScript 主流程应保持可顺读。单次使用且只做参数转发的函数默认不抽取；只有复用、隔离 I/O/第三方边界、承载独立业务规则或显著降低复杂度时才抽象。函数通常不超过约 200 行，但不得为满足行数机械拆出无意义调用层。
12. Agent 到 Runtime 的依赖方向固定为 `agent (Python) -> execution/runtime-bridge (TypeScript) -> Midscene`。`execution` 不得导入 Python Agent、模型 SDK、Agent prompt 或 GDEClaw；GDEClaw 不得注册 CUA 内部 Tool。Agent invocation 不保存跨调用 Session，依赖只在安装/部署阶段准备。
13. 仓库提供 Python 包、单次进程 invocation、Review `--dev` 调试入口和 Runtime bridge。GDEClaw 注册与生命周期 Adapter、网络服务和长期 Agent daemon 位于仓库边界之外。
14. `execution/SKILL.md` 与任务目录中的 `SKILL.md` 是 CLI 操作、维护和打包说明；Python Agent 不读取这些 Markdown，而是通过 `cua_catalog` 获取结构化 task/scene 数据。不得把这些文件描述为 GDEClaw 需要注册的公共 Tool 或 Python Agent 的运行时 prompt。
15. 代码、注释、文档、Skill 和 UI 文案只描述稳定设计、能力边界和必要用法。变更历史只在用户明确要求时记录；其他场景不写入对话过程、用户纠正过程、版本演进或前后方案比较，修改时同步清理同类元叙述。
