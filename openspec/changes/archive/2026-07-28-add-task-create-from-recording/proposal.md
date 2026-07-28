## Why

当前从原始录制目录到可执行任务需要跨 `record` 与 `execution` 手工运行 Python、重命名和搬运产物，再调用 TypeScript CLI 初始化与验证。该流程难以由上层 Agent 稳定执行，也容易产生路径错误和半成品任务。

## What Changes

- 新增 `task create-from-recording`，一次完成 trace 生成、source 规范化、任务初始化与静态验证。
- 新增外部录制器根目录配置，并保持 `record/.env` 与 `execution/.env.local` 的配置边界。
- 将 `--goal` 设为可选任务描述；它不参与 trace 生成，省略时持久化空字符串。
- 创建失败时清理本次新建的任务目录，不覆盖既有 user 或 builtin 任务。
- 保留 `task init-from-trace`，供已有标准化 source 的高级场景继续使用。

## Capabilities

### New Capabilities

- `recording-task-creation`: 定义从原始录制目录一键创建、验证用户任务的 CLI、配置、产物和失败语义。

### Modified Capabilities

- `local-task-skills`: 将上层 Agent 的默认录制任务创建入口改为单一执行器命令，并保留已有 source 的高级入口。

## Impact

- 新增 TypeScript 录制编排模块、公开 API 与 CLI 分发。
- 更新 execution 环境示例、Skill、任务契约和相关 README。
- 不改变现有 task、trace 或 YAML 持久化结构，也不把 Python 录制器打包进 execution Skill。
