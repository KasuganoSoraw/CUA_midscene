## ADDED Requirements

### Requirement: TypeScript Runtime 暴露版本化 JSON 协议
`execution` SHALL 提供稳定、版本化、JSON 友好的 Runtime bridge，使 Python Agent 能调用 catalog、execute 与 workbench，而无需导入 TypeScript 模块。

#### Scenario: Python 发送 Runtime 请求
- **WHEN** bridge 收到包含协议版本、request id、method 和 payload 的有效请求
- **THEN** bridge SHALL 调用对应现有 Runtime adapter
- **AND** 响应 SHALL 包含相同 request id、成功结果或结构化错误

### Requirement: Bridge 保持 Agent 到 Runtime 的单向依赖
Runtime bridge SHALL 只公开 Computer-Use 执行能力，并 SHALL NOT 导入 Python Agent、模型 SDK、Agent prompt、GDEClaw Adapter 或 Agent messages。

#### Scenario: 构建 execution 包
- **WHEN** TypeScript 编译器构建 Runtime bridge
- **THEN** bridge SHALL 仅依赖 `execution` 内现有 catalog、executor、workbench 和公共契约
- **AND** 构建 SHALL NOT 要求 Python Agent 已安装

### Requirement: 一次 Agent 调用可复用 Runtime worker
bridge SHALL 支持在单个 Node worker 生命周期内处理多个相互关联的 JSON 请求，并 SHALL 在 worker 结束时释放其持有资源。

#### Scenario: Agent 先 list 再 describe 后 execute
- **WHEN** Python Agent 在同一次 invocation 中连续发送三个请求
- **THEN** worker SHALL 逐个返回可关联响应而无需为每个请求重新加载整个 bridge
- **AND** 响应顺序或 request id SHALL 足以消除结果歧义

### Requirement: 协议输出与诊断输出隔离
bridge SHALL 保证协议 stdout 只包含合法 JSON frame，并 SHALL 将非协议日志与诊断写入 stderr 或显式事件通道。

#### Scenario: Runtime 产生诊断日志
- **WHEN** 底层执行器需要输出调试信息
- **THEN** 诊断 SHALL NOT 混入 JSON response frame
- **AND** Python client SHALL 仍能解析对应请求结果

### Requirement: Bridge 保留底层结果和根因
bridge SHALL 保留 catalog 的 ready/error item、执行策略结果、workbench 深链接，以及底层异常的可诊断根因，并 SHALL NOT 自动重试或切换策略。

#### Scenario: execute 返回失败
- **WHEN** 底层 replay、guided 或 freeform 执行失败
- **THEN** bridge SHALL 返回结构化失败或包含根因的错误响应
- **AND** bridge SHALL NOT 改用其他 strategy 或重新执行

### Requirement: Python client 管理调用级 Runtime 生命周期
Python Runtime client SHALL 支持显式 executable/bridge 路径、超时、取消和进程退出检测，并 SHALL 在 invocation 结束时关闭其启动的 worker。

#### Scenario: Node worker 异常退出
- **WHEN** worker 在返回当前请求前退出
- **THEN** Python client SHALL 返回包含退出信息的结构化 Runtime 错误
- **AND** invocation SHALL NOT 无限等待
