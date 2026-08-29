# CUA Agent

`cua-agent` 是面向 GDEClaw 和本地开发调试的唯一 canonical Computer-Use Subagent。

它每次接收一个完整任务，在单次调用内负责模型 Tool Calling 和任务级执行策略选择；它不保存跨调用 Session、长期记忆或用户聊天历史。实际 catalog、replay、guided、freeform、workbench 和 Midscene 执行仍由 TypeScript `execution` Runtime 提供。

当前目录是独立 Python 包边界。依赖由安装或部署阶段准备，运行阶段不会执行 `uv sync`、`pip install`、`npm install` 或 lock 操作。

当前仓库已经实现 Python API、一次一进程的 `cua-agent invoke`、Review `--dev` 调试入口和 TypeScript Runtime bridge；尚未实现 GDEClaw 专用注册/生命周期 Adapter、常驻 Agent daemon、网络服务或跨调用事件流。GDEClaw 是该 invocation contract 的目标集成方，不应被描述为当前已经接通的产品 Host。

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

GDEClaw 不需要注册内部 Tool，也不需要理解 replay、guided 或 freeform。未来 Adapter 负责用户会话、任务 ID、后台生命周期和取消；本包只保存一次 invocation 内的 messages 和 Tool result，结束后即释放，不实现长期 Memory、持久 Session、scheduler 或多 Agent routing。Tool 名称和输入/输出摘要可以作为受控诊断数据返回，但这不等于向 Host 注册可调用 Tool。

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
$env:CUA_AGENT_NODE_EXECUTABLE = 'C:\Program Files\nodejs\node.exe'
$env:CUA_AGENT_RUNTIME_BRIDGE = 'E:\HW\CUA\execution\dist\runtime-bridge\worker.js'
$env:CUA_DATA_ROOT = 'C:\path\to\cua-data'
'{"task":"打开 Chrome","invocationId":"dev-1"}' | uv run --locked cua-agent invoke
```

需要配置 `CUA_AGENT_MODEL_BASE_URL`、`CUA_AGENT_MODEL_NAME`、`CUA_AGENT_MODEL_API_KEY`；缺少专用变量时兼容回退到相应 `MIDSCENE_MODEL_*`。`CUA_AGENT_MODEL_TIMEOUT_SECONDS` 默认 120 秒，`CUA_AGENT_MAX_TURNS` 默认 8，Runtime 单请求超时当前固定为 300 秒。真实密钥只能存在于被忽略的本地环境或进程环境中。

`agent/.env.example` 只是环境变量契约示例，Python CLI 本身不加载 `.env` 文件。直接调用时由 shell/进程管理器注入环境；`review --dev` 则继承 Review Server 已从 `execution/.env.local`、`execution/.env` 和进程环境加载的变量。

公司内网证书尚未接入系统信任链时，可临时设置 `CUA_AGENT_MODEL_TLS_VERIFY=false`，仅关闭 Python Agent 模型请求的证书链和主机名验证。该开关默认是 `true`，不得作为正式交付默认值；长期方案应安装公司根证书或为 Agent 配置专用 CA bundle。

当前模型 HTTP adapter 使用 Python 标准库 `urllib.request`，因此 `agent` 的运行时第三方依赖仍为空。换成 `requests` 不会自动解决证书问题；未来若需要代理、Session 或 CA bundle 配置，可在保持 `ModelClient` 接口不变的前提下替换 transport。

## 调用结果与取消

- `CuaAgent.invoke(..., event_sink=..., cancelled=...)` 支持程序内事件回调和边界式取消检查。
- `cua-agent invoke` 输出事件 JSONL，但当前 stdin 协议只提交一次请求，不提供运行中的 cancel frame。
- Review 开发 API 当前等待子进程结束后一次性返回结果和累计事件，页面不是实时流式控制台，也没有 Agent 中途取消按钮。
- Review 的“Python Agent 可用 / model configured”只表示路径存在且模型变量齐全；端点连通性、TLS 和模型响应格式在实际 invocation 时验证。

## 集成与依赖

推荐 GDEClaw 在产品安装/构建阶段：

1. 安装本目录构建的 `cua-agent` wheel 到隔离 Python 环境。
2. 安装并构建 `execution`，保留 Node executable 与 `dist/runtime-bridge/worker.js`。
3. 向 Agent 进程提供模型配置、`CUA_DATA_ROOT` 和两个 Runtime 路径。
4. 运行阶段只启动 `cua-agent invoke`，不调用任何包管理命令。

`review --dev` 使用完全相同的 Python invocation，只是将事件和结果显示在开发调试页面。普通 `review` 不注册该入口。
