## 1. Record Python Package

- [x] 1.1 将 Aloha 录制处理逻辑迁入 `src/cua_record`、配置 wheel 元数据与包内资源，并通过包导入和资源定位测试
- [x] 1.2 提供 `python -m cua_record process <recording>` 稳定入口，迁移现有 Record 测试并验证产物命名和失败行为不变

## 2. Host Python Worker Contract

- [x] 2.1 实现无 shell 的宿主 Python Worker 启动配置与进程工具，并通过 executable、module、环境、输出和退出错误单元测试
- [x] 2.2 将 `task create-from-recording` 切换为宿主 Python 执行 `cua_record`，删除 record 源码根/`uv` 运行依赖并通过录制任务创建测试
- [x] 2.3 将 Windows Recorder 服务切换为宿主 Python 执行 `cua_recorder`，删除 Recorder 源码标记/`uv` 运行依赖并通过服务测试

## 3. JavaScript Runtime Injection

- [x] 3.1 为 Python Runtime client 提供通用 JavaScript Runtime executable 构造入口并保留 cwd/env，通过 Node 与宿主 executable 配置测试

## 4. Component Distribution

- [x] 4.1 定义并实现版本化 `manifest.json` 生成与解析校验，通过相对路径、兼容版本和必需入口测试
- [x] 4.2 实现单一组件构建命令，生成三个 wheels、编译 JavaScript Runtime 和隔离的 production `node_modules`，并验证 staging 内容完整
- [x] 4.3 实现组件静态验证器，拒绝绝对路径、缺失文件、源码/开发工具泄漏和未声明入口，并通过正反例测试

## 5. Clean Staging Verification

- [x] 5.1 实现源码仓外 smoke test，使用外部 Python/Node 验证 wheel imports 与 Runtime bridge `catalog` 协议
- [x] 5.2 更新 README、SKILL 与环境示例，只记录组件构建、宿主运行时契约和开发调试入口，并通过文档/发布面测试

## 6. Validation

- [ ] 6.1 运行 Record、Recorder、Agent 与 execution 测试、类型检查和 lint，修复全部回归
- [ ] 6.2 运行组件实际构建、clean staging smoke test 和 `openspec validate --all --strict`，确认变更达到可归档状态
