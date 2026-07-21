## 1. 契约与转换

- [x] 1.1 扩展 TypeScript 类型和 task JSON Schema，支持可选的步骤证据绑定并保持旧任务兼容
- [x] 1.2 更新 trace converter 生成证据绑定，并增加转换与契约测试

## 2. Review service

- [x] 2.1 创建 `execution/review/shared` DTO 和 `review/service` 任务组合、revision 与证据读取能力
- [x] 2.2 实现统一 `step-NNN` 的插入、删除、移动、输入迁移和语义 diff
- [x] 2.3 实现 user-only、revision-aware 的联合校验与原子保存，并覆盖冲突、builtin 与回滚测试

## 3. 本地服务与 CLI

- [x] 3.1 实现仅监听 loopback、使用随机端口和路径边界检查的 review HTTP API 与静态资源服务
- [x] 3.2 将统一命令分发入口提升到 `execution/cli`，保持现有命令兼容并新增 `cua review --no-open`
- [x] 3.3 增加 review server 与 CLI 冒烟测试

## 4. Vue 前端

- [x] 4.1 配置 Vue 3 + TypeScript + Vite，并将产物输出到 `dist/review/web`
- [x] 4.2 实现场景/任务导航、步骤列表、全局图与局部图查看、只读状态和外部 revision 冲突提示
- [x] 4.3 实现步骤编辑、插入、删除、移动、语义变更对比、校验与确认保存交互

## 5. 集成与文档

- [x] 5.1 更新 npm 构建、发布文件、TypeScript 配置与测试聚合入口
- [x] 5.2 更新 README、Skill/Agent 约束，明确 review 与 CUA 平级、Agent 仍直接编辑任务资产
- [x] 5.3 运行 Node 测试、Vue 构建、CLI 冒烟和 OpenSpec validate，并修复发现的问题
- [x] 5.4 根据产品决策移除本地访问 token 与公开端口参数，并重新执行回归验证
- [x] 5.5 修复 input 步骤运行时参数配置区布局，并完成 Vue 构建与浏览器视觉验证
- [x] 5.6 将步骤编辑改为语义表单，实时联动 Flow/参数预览，并支持显式高级 JSON 反向应用
