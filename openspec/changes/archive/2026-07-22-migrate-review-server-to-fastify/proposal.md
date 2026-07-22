## Why

当前本地复核服务直接基于 `node:http` 手写路由分发、JSON body 解析和错误映射；功能已经可用，但随着会话生命周期、安全校验和更多复核 API 的加入，可读性与维护成本会快速恶化。现在迁移到 Fastify，可以在保持本地轻量部署方式不变的前提下，用明确的路由、hook、插件和统一错误处理建立更规范的服务端结构。

## What Changes

- 使用 Fastify 替换 review server 中手写的 `node:http` 请求分发和 JSON body 解析。
- **BREAKING** 将执行器运行时基线统一为公司环境 Node.js 22.18.0，以使用当前 Fastify 主版本并避免引入旧主版本维护债务。
- 将 catalog、task、evidence、mutation、validation 和 save 接口注册为明确的 Fastify routes。
- 使用统一错误处理保持现有 HTTP 状态码与前端错误响应契约。
- 保持 `127.0.0.1`、系统随机端口、`--no-open`、静态 Vue 产物、任务路径边界和 revision 保存语义不变。
- 更新依赖、类型、服务端测试和发布校验。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `local-task-review-app`: 明确服务端框架迁移后 CLI、HTTP API、静态资源与安全边界必须保持兼容。

## Impact

- 主要影响 `execution/review/server/`、`execution/tests/review/server.test.ts` 和 `execution/package*.json`。
- 新增 Fastify 运行时依赖，移除 review server 自行维护的通用 HTTP 路由/body/error 样板代码。
- 前端 API、canonical 任务资产、Agent/Skill 调用方式和本地数据目录结构均不改变。
