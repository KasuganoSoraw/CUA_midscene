## 1. 运行时与依赖

- [x] 1.1 将 Node.js 运行时基线更新为 22.18.0，并加入兼容版本的 Fastify 与 static plugin
- [x] 1.2 更新 README、Skill 和发布测试中的运行时与 review server 说明

## 2. Fastify 服务端迁移

- [x] 2.1 将 review 应用装配、统一错误处理和 Vue 静态资源迁移到 Fastify
- [x] 2.2 将 catalog、task、evidence、mutation、validation 与 save 迁移为声明式 routes
- [x] 2.3 更新 loopback 随机端口启动、关闭和 CLI 类型契约

## 3. 验证

- [x] 3.1 扩展服务端测试，覆盖接口兼容、未知 API、SPA fallback、body 限制和错误状态
- [x] 3.2 运行 TypeScript 检查、完整测试、生产构建与 OpenSpec 严格校验
