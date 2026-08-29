## Context

当前仓库的 `execution/agent` 是 TypeScript Agent-facing 能力层：它保存 definition、instructions、三个 Tool 契约，并通过 `invokeCuaSubagent(request, host)` 把真正的模型循环交给外部 Host。这个形态适合 Node Host 注入，但不符合最新集成边界：GDEClaw 应只把完整任务委派给一个专门的 CUA Subagent，策略选择和内部 Tool Calling 应由 CUA 自己完成。

现有 `execution` 已稳定拥有任务 catalog、replay、guided、freeform、workbench、Midscene 和桌面操作。迁移不能重写或复制这些执行能力，只应改变 Agent 层语言、运行边界与集成方式。GDEClaw 未来统一管理安装和生命周期，但 CUA Agent 仍应是可独立开发、测试和通过 `review --dev` 调用的包。

## Goals / Non-Goals

**Goals:**

- 建立顶层 Python `agent/` 包，成为唯一 canonical CUA Subagent。
- 让 Agent 自己执行一次调用内的模型 Tool Calling、领域路由、私有 Tool 调用、事件输出和取消检查。
- 保持每次 invocation 无跨调用上下文；只在单次调用内保存模型 messages 和 Tool 结果。
- 建立 Python 到 TypeScript Runtime 的稳定 JSON 边界，保持单向依赖。
- 让 GDEClaw 与 `review --dev` 调用同一个高层入口并获得同一种结果/事件语义。
- 在迁移验证完成后删除旧 TS Agent 层，避免双重实现。
- 让安装态准备依赖、运行态纯执行。

**Non-Goals:**

- 不实现长期记忆、持久 Session、用户聊天历史、scheduler 或多 Agent orchestration。
- 不在 Python 重写 catalog、task runner、Midscene、Workbench 或桌面操作。
- 不让 GDEClaw 感知或直接调用 CUA 内部 Tool。
- 不在首版实现常驻全局服务、远程网络协议或完整产品打包器。
- 不让 Agent 自己执行 `uv sync`、`npm install` 或其他依赖准备命令。

## Decisions

### 1. `agent/` 是顶层 Python 包

采用与 `execution/`、`record/`、`recorder/` 并列的顶层目录，包名按职责命名而不是按语言命名。推荐结构：

```text
agent/
  pyproject.toml
  uv.lock
  src/cua_agent/
    __init__.py
    runner.py
    contracts.py
    events.py
    definition/
    tools/
    runtime_client.py
  tests/
```

这表示独立构建和运行边界，不表示 Agent 与 Runtime 在架构上对等。依赖方向始终是 `agent -> execution runtime -> Midscene`。

备选方案是在 `execution/agent-python` 下实现。该方案会让 Python 包继续从属于 npm 包目录，模糊 GDEClaw 安装边界，因此不采用。

### 2. Python Agent 自托管薄 Tool Calling loop

`runner` 接收一个完整自然语言任务、调用配置好的模型、向模型提供私有 Tool schema、执行 Tool call 并把结果追加到本次 messages，直到返回最终回复或达到 turn limit。模型客户端使用窄接口注入，使确定性测试无需真实模型。

Agent 不保存 invocation 结束后的 messages。GDEClaw 管理任务 ID、后台状态、取消请求和用户会话；Python Agent 只接受调用级 ID/取消信号并输出事件。

备选方案是继续由 GDEClaw 运行模型循环。该方案会把 CUA 路由知识和内部 Tool 暴露给主系统，并形成第二层 Computer-Use 推理，因而不采用。

### 3. 内部 Tool 保持私有

Python Agent 注册 `cua_catalog`、`cua_execute`、`cua_workbench` 三个领域 Tool，但 GDEClaw 只调用高层 `invoke(task)`。Tool schema、策略选择和调用轨迹是 CUA 内部实现；可通过开发事件观察，但不成为 GDEClaw 的公共 Tool surface。

执行失败默认原样返回给模型并形成最终失败，不自动重试、切换策略或修改 canonical task。

### 4. TypeScript Runtime 提供 JSON bridge

`execution` 新增独立 Runtime bridge 入口，接受版本化 JSON request，调用现有 Tool adapter，并输出版本化 JSON response。首版提供一次请求 CLI，测试与连续调用需要时提供 JSONL worker；Python `runtime_client` 屏蔽传输差异。

请求必须包含唯一 request id、method 和 JSON payload；响应必须关联 request id，并区分成功结果与结构化错误。stdout 只承载协议帧，诊断写 stderr，避免日志破坏 JSON。

备选方案是 Python 直接导入 TypeScript 或为三种能力在 GDEClaw 写包装器。前者不可行且耦合语言运行时，后者泄漏内部 Tool，因此不采用。

### 5. 生命周期按一次 Agent invocation 隔离

首版允许 Python 为一次调用启动一个 Node worker，并在该调用结束时关闭。这样一次任务内多次 catalog/describe/execute 可复用同一 Runtime 进程，同时不同调用之间不共享 Agent messages。若部署环境更适合单次 CLI，runtime client 仍可使用相同协议逐次执行。

不建立跨调用常驻 Session。以后若由 GDEClaw 复用进程，也必须把 invocation state 按调用清理。

### 6. 事件与最终结果分离

Agent 输出 JSON 友好的 domain events：`agent.started`、`progress`、`tool.started`、`tool.completed`、`execution.started`、`agent.completed`、`failed`、`needs-input`。最终 invocation result 单独返回，包含状态、面向主 Agent 的摘要、可选结构化数据和错误。

私有模型 messages 不作为公共结果；Tool 输入/结果仅在开发模式或明确允许的诊断 sink 中暴露。

### 7. `review --dev` 复用 Python invocation

Review Server 的开发模式 endpoint 启动或连接本地 Python Agent runner，传递 `{task}` 并把事件和最终结果映射给现有页面。普通 `review` 不注册 endpoint、不展示页签。页面仍是开发者调试入口，不成为用户聊天产品，也不存储会话。

### 8. 迁移完成后删除 TS Agent

先迁移 definition、instructions、request/result、Tool schema 和策略约束；再接通 Runtime bridge 和 Review；最后删除 `execution/agent`、`cua-midscene/agent` export 及 Host 注入契约。中间阶段以 Python 为目标实现，旧 TS 代码仅作对照，不新增双写逻辑。

### 9. 安装态与运行态分离

Python 包保留 `pyproject.toml` 和 lock，TypeScript Runtime 保留 `package.json`、lock 和构建产物。GDEClaw 产品安装阶段准备隔离环境并提供可执行路径；Agent 运行阶段只调用准备好的 Python 与 Node executable。

## Risks / Trade-offs

- [跨语言协议增加调试面] → 使用版本化 JSON schema、request id、stderr 诊断和双侧契约测试。
- [Node worker 异常退出导致调用悬挂] → Python client 监控退出码、设置调用级超时并在 finally 中终止子进程。
- [迁移期出现两套 Agent 行为漂移] → Python definition 成为目标真源，Review 切换后立即删除 TS Agent export，并用行为测试覆盖关键策略。
- [模型 SDK 绑定导致未来集成困难] → 以窄 model client protocol 隔离 SDK；runner 只依赖标准化 message/tool-call 结果。
- [开发事件泄漏敏感 Tool 输入] → 公共事件默认只含方法名、阶段和摘要，完整 payload 仅在显式开发诊断模式开放。
- [Windows 子进程和路径差异] → executable 路径显式注入，测试 Windows command resolution，并避免依赖 shell 拼接。

## Migration Plan

1. 归档现有 TS Agent Capability，固定迁移前基线。
2. 新建 Python 包、definition、contracts、events 与确定性测试。
3. 在 `execution` 建立 Runtime bridge 和协议测试。
4. 实现 Python runtime client、私有 Tool registry 与 fake-runtime 测试。
5. 实现模型 loop、turn limit、取消和事件测试。
6. 把 `review --dev` 切换到 Python runner，验证自然语言任务、事件和错误显示。
7. 删除旧 TS Agent layer/export，更新 README 与集成说明。
8. 运行 Python、TypeScript、Review、构建、发布面和 OpenSpec 全量验证。

若迁移失败，可回退到本变更前的基线提交；删除 TS Agent 的提交安排在 Python 调试链验证之后，便于独立回滚。

## Open Questions

- 首个真实模型 adapter 使用哪个与 GDEClaw 最一致的 SDK；核心 runner 先保持 provider-neutral。
- GDEClaw 最终选择进程内 Python 调用、独立 Python worker 还是 CLI；公共 Python invocation contract 不依赖该选择。
- 产品构建阶段如何固化 Node executable 与 `execution` dist 路径；本变更先支持显式配置并提供可诊断缺失错误。
