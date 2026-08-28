# CUA Agent

`cua-agent` 是面向 GDEClaw 和本地开发调试的唯一 canonical Computer-Use Subagent。

它每次接收一个完整任务，在单次调用内负责模型 Tool Calling 和任务级执行策略选择；它不保存跨调用 Session、长期记忆或用户聊天历史。实际 catalog、replay、guided、freeform、workbench 和 Midscene 执行仍由 TypeScript `execution` Runtime 提供。

当前目录是独立 Python 包边界。依赖由安装或部署阶段准备，运行阶段不会执行 `uv sync`、`pip install`、`npm install` 或 lock 操作。

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

GDEClaw 不需要注册内部 Tool，也不需要理解 replay、guided 或 freeform。它负责用户会话、任务 ID、后台生命周期和取消；本包只保存一次 invocation 内的 messages 和 Tool result，结束后即释放，不实现长期 Memory、持久 Session、scheduler 或多 Agent routing。

## 开发

```powershell
uv sync --locked
uv run --locked pytest
uv run --locked ruff check .
uv run --locked mypy
uv build
```

本地进程入口从 stdin 读取一个 JSON request，并在 stdout 输出事件与最终结果 JSONL：

```powershell
$env:CUA_AGENT_NODE_EXECUTABLE = 'C:\Program Files\nodejs\node.exe'
$env:CUA_AGENT_RUNTIME_BRIDGE = 'E:\HW\CUA\execution\dist\runtime-bridge\worker.js'
$env:CUA_DATA_ROOT = 'C:\path\to\cua-data'
'{"task":"打开 Chrome","invocationId":"dev-1"}' | uv run --locked cua-agent invoke
```

需要配置 `CUA_AGENT_MODEL_BASE_URL`、`CUA_AGENT_MODEL_NAME`、`CUA_AGENT_MODEL_API_KEY`；缺少专用变量时兼容回退到相应 `MIDSCENE_MODEL_*`。真实密钥只能存在于被忽略的本地环境或进程环境中。

## 集成与依赖

推荐 GDEClaw 在产品安装/构建阶段：

1. 安装本目录构建的 `cua-agent` wheel 到隔离 Python 环境。
2. 安装并构建 `execution`，保留 Node executable 与 `dist/runtime-bridge/worker.js`。
3. 向 Agent 进程提供模型配置、`CUA_DATA_ROOT` 和两个 Runtime 路径。
4. 运行阶段只启动 `cua-agent invoke`，不调用任何包管理命令。

`review --dev` 使用完全相同的 Python invocation，只是将事件和结果显示在开发调试页面。普通 `review` 不注册该入口。
