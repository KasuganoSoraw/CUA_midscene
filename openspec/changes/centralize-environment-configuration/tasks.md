## 1. Shared Environment Configuration

- [x] 1.1 增加 TypeScript 根环境文件定位与解析模块，并通过根路径、`.env.local` 覆盖和进程环境优先级测试
- [x] 1.2 将数据根、录制根、Python Worker 与 Midscene 配置切换到共享模块，并通过对应单元测试

## 2. Configuration Surface

- [ ] 2.1 在仓库根创建完整 `.env.example`，删除三个子工程 example，并通过发布面测试确认组件与 execution 包不携带环境文件
- [ ] 2.2 更新 Review 配置提示、README、Agent 与组件发行文档，使源码命令只引用根环境文件并通过文档断言

## 3. Validation

- [ ] 3.1 运行 execution 全量测试、类型检查和三个 Python 包测试，修复环境加载回归
- [ ] 3.2 重建并验证组件、运行 clean-room smoke test 与 `openspec validate --all --strict`，确认产品态不依赖环境文件
