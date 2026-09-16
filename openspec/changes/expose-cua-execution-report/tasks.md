## 1. 执行报告契约

- [x] 1.1 在 YAML 与原生 aiAct 执行结果类型和 JSON Schema 中增加可选 `reportPath`，并通过契约校验测试验证兼容性
- [x] 1.2 为两类 Midscene 执行器配置稳定报告名，销毁后校验实际文件并持久化路径，通过 dry-run、报告存在和报告缺失测试验证

## 2. Runtime Tool 返回

- [x] 2.1 将底层 `reportPath` 提升到 replay、guided、freeform 的 `cua_execute` 顶层结果，并通过三种策略与无报告场景测试验证

## 3. Agent 回复约束

- [x] 3.1 更新 canonical instructions，加入克制的工具调用说明以及 Workbench URL、HTML 报告路径回复规则，并通过定义测试验证

## 4. 整体验证

- [x] 4.1 运行 Python Agent 与 TypeScript execution 全量测试并修复回归
- [x] 4.2 严格校验 `expose-cua-execution-report` OpenSpec change，确认所有任务和产物一致
