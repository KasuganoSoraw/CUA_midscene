## 1. Python Agent 包与静态契约

- [x] 1.1 建立顶层 `agent/` Python package、`pyproject.toml`、lock、src/test 布局和导入入口
- [x] 1.2 迁移 canonical description/instructions、无状态 invocation contracts 与事件类型
- [x] 1.3 增加 definition、contracts、事件序列化和跨 invocation 隔离的确定性测试

## 2. TypeScript Runtime Bridge

- [x] 2.1 定义版本化 JSON request/response/error/frame 契约与 method dispatch
- [x] 2.2 实现复用现有 catalog、execute、workbench adapter 的 JSONL worker/CLI 入口
- [x] 2.3 增加多请求、stdout 隔离、错误保真、构建和 package surface 测试

## 3. Python Runtime Client 与私有 Tools

- [x] 3.1 实现 Node worker 生命周期、request id、超时、取消和异常退出处理
- [x] 3.2 实现 Python 私有 `cua_catalog`、`cua_execute`、`cua_workbench` Tool schema 与 registry
- [x] 3.3 使用 fake worker 覆盖连续请求、结果映射、底层失败和清理行为

## 4. 无状态模型 Tool Calling Loop

- [x] 4.1 定义 provider-neutral model client protocol 与模型 message/tool-call 数据结构
- [x] 4.2 实现单次 invocation runner、Tool loop、最大轮次、最终结果和失败语义
- [x] 4.3 实现取消检查与 `agent.started`、progress、Tool、completed/failed/needs-input 事件
- [x] 4.4 使用 fake model/runtime 验证策略调用、多 Tool round、无跨调用上下文和事件顺序

## 5. Review 开发入口

- [ ] 5.1 让 Review Server 仅在 `--dev` 下启动/调用 Python Agent，并移除外部 Agent Host 可用性依赖
- [ ] 5.2 调整 Agent 调试页展示自然语言任务、结构化状态、最终回复和允许公开的事件
- [ ] 5.3 验证普通模式隐藏、开发模式调用、失败/取消显示及服务复用

## 6. 旧 TypeScript Agent 清理与集成说明

- [ ] 6.1 删除 `execution/agent` definition、Host invocation seam、TS Agent tests 和 `cua-midscene/agent` export
- [ ] 6.2 更新 TypeScript/Python 构建发布面、README 与 GDEClaw 安装态/运行态集成说明
- [ ] 6.3 确认仓库只保留一个 canonical Agent，而 `execution` 仅公开 Runtime bridge

## 7. 完整验证

- [ ] 7.1 运行 Python 格式/类型/测试与 lock 一致性检查
- [ ] 7.2 运行 TypeScript 类型检查、完整测试、构建和 package surface 检查
- [ ] 7.3 运行 Review 普通/开发模式复核及 OpenSpec 严格验证
