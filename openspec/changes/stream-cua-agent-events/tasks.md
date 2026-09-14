## 1. Agent 事件契约

- [x] 1.1 扩展 Python 与 TypeScript 的可见文本及 Tool 事件结构，运行契约测试验证字段和事件顺序
- [x] 1.2 让 runner 发送完整 Tool 输入、结果与错误事件，运行 runner 测试验证成功和失败路径

## 2. 模型流与执行器

- [x] 2.1 实现 OpenAI-compatible SSE 解析和 Tool call 分片组装，运行模型适配器测试验证内容、参数和错误处理
- [x] 2.2 让 runner 消费模型增量并隔离最终 JSON，运行 Agent 测试验证普通文本、最终状态和取消

## 3. Workbench 实时预览

- [x] 3.1 让 Python 子进程适配器逐帧输出事件，运行 Node 测试验证完成前收到事件与异常处理
- [x] 3.2 增加仅开发模式可用的 NDJSON 入口，运行 Review 服务测试验证可见性与流时序
- [x] 3.3 更新 Workbench 逐帧展示与终态去重，运行前端测试和构建验证页面产物

## 4. 集成验证

- [x] 4.1 运行 Python、TypeScript 检查和 OpenSpec 严格校验，确保现有 JSON 入口与终态结果保持可用
