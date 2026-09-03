## Why

源码开发配置分散在 `agent`、`record` 与 `execution` 的多个环境文件中，变量重复且启动入口对配置位置的理解不一致。仓库需要一个根目录环境配置入口，使开发调试、Review 和后续 Host 集成共享清晰的变量目录。

## What Changes

- **BREAKING**：删除子工程中的 `.env.example`，统一在仓库根提供 `.env.example`。
- **BREAKING**：TypeScript Runtime 只从仓库或组件根的 `.env.local`、`.env` 读取文件配置，不再读取 `execution/.env*`。
- 保持显式参数与进程环境优先于环境文件；产品运行仍由 Host 注入进程环境。
- 让源码 Agent、Record 和 Recorder 的开发命令使用根环境文件，运行包不依赖源码目录环境文件。
- 更新 Review 配置提示、测试、打包排除和分层文档。

## Capabilities

### New Capabilities

- `central-environment-configuration`: 定义根环境文件、变量集合、读取优先级和产品态边界。

### Modified Capabilities

- `cua-data-layout`: 将数据根的环境文件位置从 Skill 根改为组件/仓库根。
- `recording-catalog`: 将原始录制根的环境文件位置统一到组件/仓库根。
- `local-task-review-app`: 让 Review 的配置提示和服务读取统一指向根环境文件。

## Impact

- 配置资产：根 `.env.example`，删除 `agent/.env.example`、`record/.env.example` 和 `execution/.env.example`。
- TypeScript：环境文件定位、数据根、录制根、Python Worker 和 Midscene 环境加载。
- UI 与文档：Review 配置提示、开发启动和组件发行说明。
- 本地开发者需要将已有子目录环境变量合并到根 `.env.local`；真实密钥继续被 git 忽略。
