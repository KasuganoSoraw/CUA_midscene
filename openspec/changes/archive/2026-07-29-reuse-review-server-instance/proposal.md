## Why

`cua review` 当前每次都在随机端口启动新的 Fastify 进程，重复调用会留下多个长期监听的 Node 进程和不同 URL。GDE Claw 只需要再次打开同一个本地复核控制台，因此应优先复用已经运行的同配置服务。

## What Changes

- 将 review 服务默认端口固定为 `47831`，不再默认请求系统随机端口。
- 在启动前探测 `127.0.0.1:47831` 的服务身份与数据根标识；匹配时直接复用 URL，不创建新 Fastify 实例。
- 端口空闲时按现有方式启动 review 服务；端口被其他程序或不同数据根的 review 服务占用时明确失败。
- 保留 `startReviewServer({ port })` 的显式端口能力，供测试或嵌入调用隔离实例。
- 本轮不实现端口递增、心跳、空闲关闭、服务列表或关闭按钮。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `local-task-review-app`: 将默认启动契约从随机端口改为固定端口上的同配置实例复用。

## Impact

- 修改 `execution/review/server` 的服务身份接口、探测和启动结果。
- 修改 `execution/cli/main.ts` 对复用结果的输出，但保持现有 URL、`--no-open` 与 `--json` 使用方式。
- 增加 review server/CLI 测试和启动文档。
- 不修改 Vue 业务页面、任务资产协议、远程服务或认证设计。
