## Context

Python CLI 已逐帧写出事件 JSONL，但模型 adapter 的 `complete()` 等待完整 HTTP 响应，Review 的 Node 适配器和 HTTP 页面也只在进程退出后展示累计帧。现有最终响应协议是 JSON，Tool call 参数可能由模型分片返回。

## Goals / Non-Goals

**Goals:**
- 在不暴露供应商 SSE 格式的前提下，向 runner 传递可见文本增量并组装完整 `ModelResponse`。
- 保留最终 `InvocationResult` 和已有 JSONL CLI 的兼容性。
- 让 Workbench 验证事件确实在 invocation 完成前到达。

**Non-Goals:**
- 不创建跨调用 Session、GDEClaw 消息类型或专属 Tool Card。
- 不增量解析最终 JSON 中的 `reply`。

## Decisions

### 1. 模型层只有一个流式解析来源

`ModelClient.stream()` 提供可见文本 delta 和轮次的完整 `ModelResponse`；OpenAI-compatible adapter 在内部累积按 index 关联的 Tool call delta，解析成功后才交给 runner。保留 `complete()` 作为消费同一流的兼容入口；测试替身也遵循此契约。runner 不解析原始 SSE。

### 2. 最终 JSON 先隔离再分类

每轮开头先缓存空白和首个有效字符；以 JSON object 起始的内容全量缓存，不向可见事件输出。其他普通文本可增量输出；若最终没有 Tool call，它仍进入现有终态 reply，并由消费者按轮次避免重复展示。模型协议层继续完整解析最终状态。不能确定的前缀保持保守缓存，不输出隐藏 reasoning 字段。

### 3. Tool 事件仅公开受控信息

开始事件携带模型已完成校验的参数。完成事件携带 Tool 返回的 JSON-compatible 结构或错误，不发送供应商原始帧；数据仍受现有 Tool 契约约束，Workbench 对大型值做受控展示。

### 4. Workbench 保留 JSON 入口并另设开发流入口

Node 子进程适配器逐行解析 Python JSONL，对流式调用立即转发事件。`review --dev` 增加 NDJSON HTTP 入口，浏览器逐帧更新记录；现有完成后返回 JSON 的入口继续可用。普通 Review 不注册任一 Agent 入口。新传输只在 CUA Workbench 内部使用，GDEClaw 仍消费 Python invocation 的通用事件。

## Risks / Trade-offs

- [供应商在 SSE 中长时间静默] → 模型超时和调用取消必须终止等待并关闭连接。
- [模型把最终 JSON 前加普通文字] → 只保证合法最终协议 JSON 不泄漏；无效响应按现有兼容规则处理并测试。
- [Workbench 中途断连] → 关闭其调用级 Python 子进程，保留终态诊断；不建立后台会话。

## Migration Plan

先发布 Python 事件契约与流式模型能力，再更新 CUA Workbench；Host 可以继续消费现有终态结果，并按需适配新增事件类型。
