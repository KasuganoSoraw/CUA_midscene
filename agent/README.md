# CUA Agent

`cua-agent` 是面向 GDEClaw 和本地开发调试的唯一 canonical Computer-Use Subagent。

它每次接收一个完整任务，在单次调用内负责模型 Tool Calling 和任务级执行策略选择；它不保存跨调用 Session、长期记忆或用户聊天历史。catalog、replay、guided、freeform、workbench 和 Midscene 执行由 TypeScript `execution` Runtime 提供。

本目录是独立 Python 包边界。依赖由安装或部署阶段准备，invocation 不执行 `uv sync`、`pip install`、`npm install` 或 lock 操作。

本包提供 Python API 和一次一进程的 `cua-agent invoke`；Review `--dev` 通过 TypeScript Runtime bridge 调用该入口。GDEClaw 注册与生命周期 Adapter、常驻 daemon、网络服务和跨调用事件传输由 Host 产品层提供。

## 调用边界

```text
GDEClaw Main Agent
  -> invoke({ task })
  -> Python CUA Agent
       -> model Tool Calling
       -> private cua_catalog / cua_execute / cua_workbench
  -> TypeScript JSONL Runtime bridge
  -> Midscene
```

GDEClaw 不需要注册内部 Tool，也不需要理解 replay、guided 或 freeform。Host Adapter 负责用户会话、任务 ID、后台生命周期和取消；本包只保存一次 invocation 内的 messages 和 Tool result，结束后即释放，不实现长期 Memory、持久 Session、scheduler 或多 Agent routing。Tool 名称和输入/输出摘要可以作为受控诊断数据返回，但不构成 Host 可调用 Tool。

## 开发

```powershell
uv sync --locked
uv run --locked pytest
uv run --locked ruff check .
uv run --locked mypy
uv build
```

本地进程入口从 stdin 一次性读取一个 JSON request，在 stdout 输出零到多个事件 frame 和一个最终结果 frame 后退出。它不是可复用 daemon，也不在 stdin 上接收第二次调用或中途取消 frame：

```powershell
$env:CUA_AGENT_JS_RUNTIME_EXECUTABLE = 'C:\Program Files\nodejs\node.exe'
$env:CUA_AGENT_RUNTIME_BRIDGE = 'E:\HW\CUA\execution\dist\runtime-bridge\worker.js'
$env:CUA_DATA_ROOT = 'C:\path\to\cua-data'
'{"task":"打开 Chrome","invocationId":"dev-1"}' | uv run --locked cua-agent invoke
```

需要配置 `CUA_AGENT_MODEL_BASE_URL`、`CUA_AGENT_MODEL_NAME`、`CUA_AGENT_MODEL_API_KEY`；未设置专用变量时读取相应 `MIDSCENE_MODEL_*`。`CUA_AGENT_MODEL_TIMEOUT_SECONDS` 默认 120 秒，`CUA_AGENT_MAX_TURNS` 默认 8，Runtime 单请求超时为 300 秒。真实密钥只能存在于被忽略的本地环境或进程环境中。

`agent/.env.example` 只是环境变量契约示例，Python CLI 本身不加载 `.env` 文件。直接调用时由 shell/进程管理器注入环境；`review --dev` 则继承 Review Server 已从 `execution/.env.local`、`execution/.env` 和进程环境加载的变量。

## 调用结果与取消

- `CuaAgent.invoke(..., event_sink=..., cancelled=...)` 支持程序内事件回调和边界式取消检查。
- `cua-agent invoke` 输出事件 JSONL；stdin 协议只提交一次请求，不提供运行中的 cancel frame。
- Review 开发 API 等待子进程结束后一次性返回结果和累计事件，不提供实时事件传输或 Agent 中途取消按钮。
- Review 的“Python Agent 可用 / model configured”只表示路径存在且模型变量齐全；端点连通性、TLS 和模型响应格式在实际 invocation 时验证。

## 集成与依赖

Host 产品的安装/构建流程应：

1. 安装本目录构建的 `cua-agent` wheel 到隔离 Python 环境。
2. 安装 `execution` Runtime，保留兼容的 JavaScript executable 与 `dist/runtime-bridge/worker.js`。
3. 向 Agent 进程提供模型配置、`CUA_DATA_ROOT` 和两个 Runtime 路径。
4. invocation 只启动 `cua-agent invoke`，不调用包管理命令。

`review --dev` 使用完全相同的 Python invocation，只是将事件和结果显示在开发调试页面。普通 `review` 不注册该入口。
