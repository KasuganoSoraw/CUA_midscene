## Context

见 proposal.md。当前 Midscene 实例由 YAML 和原生 aiAct 执行器分别创建；本地安装的 Midscene Agent 提供 `addDumpUpdateListener`，回调携带累计 `ExecutionDump.tasks`。Runtime Bridge 当前每个请求只发送一行终态响应，Python client 只读取一行。

## Goals / Non-Goals

**Goals:**
- 从 Midscene 过程状态生成小型、可关联的调用级事件，同时保持现有终态结果契约。
- replay、guided 和 freeform 均可将过程事件沿同一执行链传到 Agent。

**Non-Goals:**
- 不增加 YAML 单步重试，也不改变 Midscene 的动作或报告格式。
- 不将原始 Dump、截图、Prompt、模型内部信息或 Host 专有对象送入事件流。

## Decisions

### 1. 在执行器边界适配 Midscene Dump

YAML 与原生 aiAct 执行器在调用前注册 `addDumpUpdateListener`，调用结束时移除。适配器只读取执行 ID、task ID、序号、类型、子类型和状态；不序列化回调的 `dump` 字符串、参数或原始错误文本。对 `pending` 不发事件，`finished` 对外规范化为 `succeeded`。按执行 ID、task ID、状态去重，避免累计快照重复上报；不对相同动作的不同状态去重。

### 2. 沿既有参数链传递过程回调

`cuaExecute` 将回调传给 replay/guided/freeform 的任务编排，再传给相应 Midscene 执行器。Runtime Bridge 的 execute handler 接收可选回调；worker 在对应请求的 stdout 上先写带 request id 的 `type: event` 帧，最后仍写现有终态响应。catalog/workbench 的响应不变。

### 3. Python client 读取一问多帧

Python client 在单个总超时内循环读取同一 request id 的帧。事件帧先验证版本、request id 和受控 schema，再回调给 Tool；终态响应沿现有错误和结果解析。Tool 与 runner 只处理稳定的 `execution.progress`，附加 invocation、callId、turn，不引入跨调用状态。取消或超时关闭 worker。

## Risks / Trade-offs

- [Midscene Dump 累计更新密集] → 以执行 task 身份和状态去重，不发送原始参数、截图或报告。
- [回调抛错影响执行] → 进度回调仅传输受控结构；真实执行错误继续以终态为准。
- [过程帧与终态帧混淆] → 仅 `type: event` 进入事件分支，终态保留原有 `ok` 结构，并验证 request id。
- [模型/执行长时间运行] → 保持单个请求的总超时与取消检查，不因收到过程帧无限延长。

## Migration Plan

Bridge 终态帧保持兼容；Python client 同时接受旧的纯终态响应和带过程帧的新响应。现有 Review 事件传输可直接展示新事件类型。
