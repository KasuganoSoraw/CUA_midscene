## 1. Midscene 过程适配

- [x] 1.1 从累计 Dump 提取去重的受控动作事件，运行单元测试验证状态变化、重复快照与敏感字段隔离
- [x] 1.2 将回调接入 YAML 和原生 aiAct 执行器并传遍三种执行策略，运行执行器和策略测试验证调用期间到达

## 2. Runtime Bridge 协议

- [x] 2.1 为 execute 请求增加关联过程帧并保留终态响应，运行 bridge 测试验证帧顺序、错误和后续请求

## 3. Python Agent 映射

- [x] 3.1 让 Runtime client 在总超时内读取过程帧与终态帧，运行客户端测试验证请求关联、失败、取消及超时
- [x] 3.2 将执行进度映射为关联 Tool 的 `execution.progress`，运行 Agent 与 CLI 测试验证事件顺序和终态兼容

## 4. 集成验证

- [x] 4.1 更新必要的调用文档，运行 Python、TypeScript 测试、构建及 OpenSpec 严格校验验证完整链路
