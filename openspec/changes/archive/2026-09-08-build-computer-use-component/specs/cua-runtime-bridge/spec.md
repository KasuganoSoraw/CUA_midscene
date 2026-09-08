## MODIFIED Requirements

### Requirement: Python client 管理调用级 Runtime 生命周期
Python Runtime client SHALL 支持显式 JavaScript Runtime executable、bridge 路径、工作目录、环境、超时、取消和进程退出检测，并 SHALL 在 invocation 结束时关闭其启动的 worker。JavaScript Runtime 可以是兼容 Node executable，也可以是通过显式环境进入 Node 模式的兼容宿主 executable。

#### Scenario: Node worker 异常退出
- **WHEN** worker 在返回当前请求前退出
- **THEN** Python client SHALL 返回包含退出信息的结构化 Runtime 错误
- **AND** invocation SHALL NOT 无限等待

#### Scenario: 宿主提供 JavaScript Runtime 环境
- **WHEN** 宿主传入绝对 Runtime executable、bridge 路径、组件工作目录和附加环境
- **THEN** Python client SHALL 使用这些值启动 worker
- **AND** Python client SHALL NOT 推测 GDEClaw 安装目录或假设 executable 必须命名为 Node
