## MODIFIED Requirements

### Requirement: 本地复核应用随执行器发布
系统 SHALL 将复核应用的 Fastify 服务端与 Vue 3 前端构建产物随 `cua-midscene` 包发布，并通过统一命令启动仅监听 loopback 的临时本地服务；服务端框架迁移 SHALL 保持既有 CLI 和 HTTP 契约兼容。

#### Scenario: 启动复核控制台
- **WHEN** 用户在 Node.js 22.18.0 或更高版本调用 `cua review` 并具有有效的 `CUA_DATA_ROOT`
- **THEN** 系统 SHALL 在 `127.0.0.1` 上使用系统分配的随机可用端口启动服务
- **AND** 系统 SHALL 提供不含访问 token、可由系统浏览器打开的本地 URL

#### Scenario: 发布环境离线使用
- **WHEN** 目标机器无法访问远程服务器
- **THEN** 复核页面 SHALL 仍可从包内静态资源加载并读写本地 user catalog
- **AND** 系统 SHALL NOT 要求数据库或远程 API

#### Scenario: Fastify 迁移保持接口兼容
- **WHEN** 现有 Vue 前端或 CLI 调用 review server
- **THEN** 服务 SHALL 保持既有请求路径、HTTP 方法、成功响应和业务错误状态码
- **AND** 未知 API SHALL 返回结构化 404，非 API 页面路径 SHALL 回退到 Vue 入口
