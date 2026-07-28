## 1. 录制器入口

- [x] 1.1 为 Python parser 增加可选 goal 并保持旧调用兼容
- [x] 1.2 增加 parser 单元测试，验证 goal 传递与空目标行为
- [x] 1.3 修复 `NUMPAD_DECIMAL` 在录制键盘合并中丢失的问题并增加回归测试

## 2. TypeScript 创建编排

- [x] 2.1 实现录制器根目录解析、环境校验和无 shell Python 子进程
- [x] 2.2 实现录制产物校验、标准化 source 复制和路径边界检查
- [x] 2.3 复用转换与 dry-run 验证，并在失败时清理本次任务半成品
- [x] 2.4 放宽 converter 的空 goal 限制并验证空描述 YAML

## 3. CLI 与公开 API

- [x] 3.1 新增 `task create-from-recording` 参数、帮助、JSON 输出和命令记录
- [x] 3.2 从 `cua/index.ts` 导出创建 API，并保持 `task init-from-trace` 行为不变

## 4. 测试与文档

- [x] 4.1 增加根目录优先级、产物复制、拒绝覆盖、失败清理和 stdout 契约测试
- [x] 4.2 更新环境示例、README、任务契约与 Skill 创建指引
- [x] 4.3 验证 execution 发布物继续保持 TypeScript-only

## 5. 验证

- [x] 5.1 运行 Python 单测、TypeScript 测试和构建
- [x] 5.2 运行 Skill 打包边界测试和 OpenSpec 严格校验
