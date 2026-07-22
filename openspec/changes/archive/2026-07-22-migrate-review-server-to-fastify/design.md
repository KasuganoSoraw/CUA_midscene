## Context

review server 当前用一个 `node:http` handler 同时承担 URL 拆分、路由匹配、JSON body 限制、错误状态映射、静态文件和 SPA fallback。现有 API 数量不多，但文件已经混合基础设施与业务路由；即将讨论的页面会话、心跳和自动退出会进一步增加生命周期逻辑。公司运行环境固定为 Node.js 22.18.0，项目采用 TypeScript、JSON Schema 和 AJV，适合迁移到 Fastify 当前主版本。

## Goals / Non-Goals

**Goals:**

- 用声明式 Fastify routes 替换条件分支式路由和手写 body 解析。
- 分离应用装配、HTTP routes、服务监听与系统浏览器启动职责。
- 保持现有 URL、请求方法、JSON/二进制响应、状态码和前端调用完全兼容。
- 保持 loopback 随机端口、2 MiB body 上限、SPA fallback、证据路径边界与可编程关闭能力。
- 为后续 session/heartbeat 和安全 hooks 提供清晰扩展点。

**Non-Goals:**

- 本次不实现页面关闭后自动停止服务。
- 不改变前端 DTO、canonical 任务资产或 review service 业务逻辑。
- 不增加公网监听、远程部署、登录、数据库或 token。
- 不以压测吞吐量作为迁移目标。

## Decisions

### 1. 使用 Fastify 5 与 `@fastify/static`

选择当前 Fastify 主版本，不为了保留 Node 18 声明而引入旧框架主版本；`package.json.engines.node` 同步为 `>=22.18.0`，与公司环境一致。静态 Vue 产物由官方 static plugin 提供，未知非 API GET 路径回退到 `index.html`。

备选 Express 的 middleware 模型更普及，但当前项目已经以 TypeScript DTO 和 JSON Schema 为中心，Fastify 的 route schema、hook、插件封装和 `inject()` 测试接口更适合后续扩展。继续使用 `node:http` 的依赖最少，但无法解决本次可读性与规范化目标。

### 2. 应用工厂与监听生命周期分离

`createReviewApp()` 构建并返回 `FastifyInstance`，负责插件、错误处理和 routes；`startReviewServer()` 只解析运行布局、调用 `listen({host: '127.0.0.1', port: 0})` 并返回 URL 与 `close()`。测试可通过 Fastify `inject()` 验证路由，通过真实监听测试 loopback 和随机端口。

### 3. 业务路由集中在独立模块

新增 routes 模块，按 catalog、task、evidence 和 draft mutation/save 分组注册明确的 method/path handler。scene/task 继续经过 `requireIdentifier()`，evidence helper 继续在解析后验证目标位于任务 `source/` 内；Fastify 只负责 HTTP 编排，不下沉或复制 review service 业务逻辑。

### 4. 统一错误响应保持兼容

应用级 error handler 将 `ReviewConflictError` 映射为 409、`ReviewReadonlyError` 映射为 403、明确 `statusCode` 映射为对应状态，其他输入和校验错误保持 400，并继续返回 `{ "error": "..." }`。API not-found 固定返回 404；静态路径只对非 API GET/HEAD 做 SPA fallback。

## Risks / Trade-offs

- [新增 Fastify 与 static plugin 增加发布依赖] → 固定兼容主版本并通过 package/Skill 发布测试验证依赖和构建产物。
- [框架默认错误格式或 body 限制改变前端契约] → 使用自定义 error handler，并增加错误状态与 2 MiB 上限回归测试。
- [SPA fallback 吞掉未知 API] → API 404 与非 API fallback 分开处理，测试未知接口。
- [Node 运行时基线提升] → 在 engines、README、Skill 与测试中明确 Node.js 22.18.0。
- [Fastify plugin 封装增加学习成本] → 保持一个应用工厂和一个 routes 模块，不引入过度分层。

## Migration Plan

1. 更新 Node engine 与 Fastify/static 依赖。
2. 将 handler 迁移为 Fastify 应用工厂和 routes。
3. 更新启动生命周期与测试，确保 CLI 输出和前端 API 不变。
4. 运行 typecheck、完整测试、生产构建与 OpenSpec 严格校验。

若迁移出现不可接受的兼容问题，可移除新增依赖并恢复归档前的 `node:http` app/main 实现；任务资产和前端无需迁移。

## Open Questions

无；页面会话与自动退出在后续独立变更中设计。
