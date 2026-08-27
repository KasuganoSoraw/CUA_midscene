## Context

`execution/cua` 已经提供任务 catalog、Replay、录制任务整体 aiAct、Freeform aiAct、录制转换和数据根解析；`execution/review` 提供本地 Workbench。旧 `agent-runtime` 只把 Freeform 能力另行裁剪发布，无法表达新的任务发现、策略路由和 Workbench 能力。当前需要的是位于确定性能力之上的 Agent-facing 层：一份可由不同 Host 加载的 canonical definition，以及少量稳定、结构化、可测试的 Tool adapter。

新的 Agent 层需要服务两种未来承载方式：独立 CUA Chat Host 和 GDEClaw Computer-Use Subagent。它不能依赖任何特定 Agent Framework，也不能引入自己的 LLM loop、session、memory 或依赖安装逻辑。开发阶段继续使用现有 npm/uv 环境；未来依赖 provisioning 属于 GDEClaw 集成范围。

## Goals / Non-Goals

**Goals:**

- 在 `execution/agent/` 建立逻辑独立、工程上仍属于 `cua-midscene` 包的 Agent Capability。
- 以 Markdown 和机器可读 TypeScript 对象共同提供唯一 Agent definition。
- 暴露 `cua_catalog`、`cua_execute`、`cua_workbench` 三个宿主无关 Tool。
- 保持 Tool 为薄适配层，复用 `cua` 和 `review` 的现有公开能力。
- 以依赖注入和 dry-run 覆盖 Tool 路由、参数映射、错误传播与 Workbench URL 行为。
- 提供一个由 `review --dev` 显式启用、不包含 Agent 逻辑的薄人工调试入口，并让它与未来 GDEClaw Adapter 复用同一 invocation contract。

**Non-Goals:**

- 不实现 Standalone LLM Host、通用聊天产品、Agent loop、session、memory、scheduler 或 trajectory runner。
- 不实现 GDEClaw Profile/Tool 注册代码或修复 GDEClaw 自身问题。
- 不改变现有开发依赖方式，不实现 runtime provisioning、self-contained bundle 或运行时安装依赖。
- 不再维护第二套精简发布物或专用 Agent CLI。
- 不实现跨进程桌面锁，也不允许 Tool 在失败后自动重试或切换策略。

## Decisions

### Agent 作为 `execution` 内的平级上层

新增 `execution/agent/`，与 `cua/`、`review/`、`cli/` 平级。`agent` 依赖 `cua` 和 Review Server 的公共入口，核心模块不得反向依赖 `agent`。

相比仓库根独立 package，这避免当前阶段引入 workspace、包间版本和发布顺序；相比放入 `cua/agent`，它保留“确定性核心”和“智能调用界面”的清晰边界。

### Canonical definition 由 Markdown 资产和 TypeScript 索引组成

`description.md` 面向 Host/Main Agent 说明何时委派完整任务，`instructions.md` 面向 Computer-Use Agent 说明无状态任务边界和任务级决策。机器定义以 `invocationMode: stateless-task` 固定不继承跨调用上下文；`definition/index.ts` 从 package root 加载这两个文件并导出稳定对象及 Tool 名称，未来 Adapter 不再维护第二份提示词。

构建后模块仍从发布根的 `agent/definition/*.md` 读取资产，因此完整 npm 发布白名单需要加入 `agent`，并增加 `./agent` 子路径导出。Agent Capability 成为唯一 Agent-facing 发布入口。

### 删除旧精简 Agent Runtime

删除 `execution/agent-runtime/`、其独立打包脚本、npm 命令、专项测试和文档说明。底层 `cua/act` 与 `runNaturalLanguageAiAct()` 继续保留，因为 Freeform Tool 仍复用它们；删除的是重复的裁剪发布与专用入口，不是 Freeform 执行能力。

### Tool 使用判别联合类型并支持依赖注入

`contracts.ts` 定义 JSON 友好的 request/result：

- `cua_catalog` 使用 `list-scenes`、`list-tasks`、`describe-task` 三种 action。
- `cua_execute` 使用显式 `replay`、`guided`、`freeform` strategy；前两者要求 scene/task，后者要求 goal。
- `cua_workbench` 使用 `recording`、`review`、`execution` mode，并可携带 scene/task。

每个 Tool 函数接受可选 dependencies，仅用于测试或 Host 适配。默认依赖直接调用现有 TypeScript API。相比让 Tool 自己实现 `auto` 路由，显式 strategy 使模式选择留在 Agent instructions，并防止失败后的隐式降级。

### Tool 自行解析统一运行布局，但不准备依赖

Tool 接受可选 `dataRoot` 并复用 `resolveRuntimeLayout`。Catalog 可在只有 builtin catalog 时工作；执行和 Workbench 复用 `requireDataPaths`，缺少可写数据根时在操作电脑或启动服务前明确失败。

Tool 不检查或安装 npm/Python 依赖。运行环境未准备好时保留底层错误，由未来 Host 的 provisioning 阶段负责解决。

### Workbench 使用深链接而不复制页面逻辑

`cua_workbench` 启动或复用现有 Review Server，默认不调用 `openSystemBrowser`，返回 `baseUrl` 和带 `mode`、可选 `scene/task` 查询参数的 `url`。Workbench 前端在初始化时读取这些参数，选择对应页签和任务。

这允许 Standalone Host、GDEClaw 内嵌浏览器或其他 Host 自己决定如何展示页面；Subagent 生命周期结束不会关闭已启动的 Workbench 服务。

### Agent 页签是仅开发态启用的统一 invocation 薄客户端

在现有 Vue Workbench 增加 `agent` 页签，但只有使用 `review --dev` 启动时才注册 invocation endpoint 并向页面声明开发模式，且开发入口 URL 带有 `dev=1`。普通 `review` 默认不展示该页签。页签提供单任务输入、最终回复和 Tool 调用轨迹；每次提交相互独立，不保存 Subagent 对话上下文。页面不直接选择 replay/guided/freeform，也不直接调用三个 CUA Tool；它只向 Review Server 的统一 invocation endpoint 提交 `{ task }`。

Review Server 调用 `invokeCuaSubagent()`，该函数把 canonical definition 与三个 Tool 交给注入的 Agent Host。未来 GDEClaw Adapter 复用同一函数和 request/result 类型，因此调用来源不会形成两套 Agent 行为。当前仓库不内置 LLM loop；没有注入 Host 时 status endpoint 返回不可用，调用 endpoint 返回明确的 503，不降级为 Freeform。

### 不提供伪 Agent Runtime 测试

本次测试确定性验证 definition、Tool contract 和调用映射，不为了测试 instructions 而实现一个正式 `runAgent()`。Agent 级自然语言轨迹评估留给未来 Host/harness；当前只确保 Host 获得一致的 instructions 与 Tool 集合。

## Risks / Trade-offs

- [Markdown 在构建后不位于 `dist`] → 通过 package root 读取 `agent/definition`，并在完整发布白名单和测试中固定该资产。
- [Tool contract 与 GDEClaw 最终 schema 不完全一致] → 保持 JSON 友好且 framework-agnostic，未来 Adapter 只转换参数和结果。
- [Workbench 查询参数与 Vue 内部状态漂移] → 将解析限制为三个 mode 和已存在的 scene/task 字段，并用前端类型检查及 Tool URL 测试覆盖。
- [薄 Agent 页签被误认为独立聊天产品] → 默认隐藏，仅由 `review --dev` 显式启用；界面使用“单次调用/调用记录”语义，不提供会话列表、长期记忆或页面侧 Tool 路由。
- [开发环境没有 Agent Host] → 显示明确不可用状态；不让前端绕过 Subagent 直接执行桌面操作。
- [同一桌面可能被多个进程调用] → instructions 明确串行要求；本次不虚构全局并发安全，机器级 lease 另行设计。
- [删除精简包影响仍在使用旧包名的集成方] → 将 `cua-midscene/agent` 作为唯一后续入口；本仓库当前不保留旧包兼容层。

## Migration Plan

1. 增加 Agent definition、contracts 和 Tool adapters，不改变现有入口。
2. 增加 `./agent` package 子路径、TypeScript build include 和发布资产。
3. 增加 Workbench 深链接初始化，保持无查询参数时的现有默认行为。
4. 删除旧精简包及其发布链，避免两种 Agent 集成形态继续并存。
5. 增加统一 Subagent invocation 边界、仅开发态注册的 Review Server 端点和由 `review --dev` 显示的 Workbench Agent 调试页签。
6. 通过测试、类型检查和构建验证后，Standalone/GDEClaw 可在后续变化中加载该能力。

回滚时恢复旧精简包文件与打包脚本，并移除 `execution/agent/`、`./agent` 导出和 Workbench 查询参数初始化；现有完整 CLI、Review 与 CUA Core 不受影响。

## Open Questions

- GDEClaw 最终直接导入 Node API 还是通过 CLI/进程适配，留待取得正式 Host 接口后决定。
- Agent-level trajectory eval 使用哪一种模型与 Host harness，留待 Standalone 或 GDEClaw 集成阶段决定。
