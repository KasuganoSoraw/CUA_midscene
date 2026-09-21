# Proposal

## Why

桌面任务中心能够创建和复核任务及录制，但缺少清理入口，用户只能离开应用手动操作目录。工作台需要在保持 catalog 边界和只读资产保护的前提下，提供可理解、可确认的任务与原始录制删除能力。

## What Changes

- 在任务复核界面为可写的用户任务提供删除入口，并在删除后刷新场景与任务列表。
- 在录制界面为原始录制提供删除入口，并在删除后刷新录制列表。
- 使用工作台内的双语确认对话框展示待删除对象与影响范围，不使用浏览器原生确认框。
- 服务端仅删除 catalog 已解析的用户任务目录或录制根内已解析的录制目录；内置任务、越界路径及活动录制均拒绝删除。
- 删除请求保持幂等边界清晰：目标已不存在时返回资源不存在，而不是扩大删除范围。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `local-task-review-app`: 增加从本地工作台安全删除用户任务和原始录制资产的行为、确认流程与只读保护要求。

## Impact

- `execution/review/server` 增加删除任务与录制的本地 HTTP 接口。
- `execution/review/service` 增加受 catalog、根目录和活动录制状态约束的删除服务。
- `execution/review/web` 增加双语删除入口、应用内确认对话框及删除后的选择状态刷新。
- `execution/tests/review` 增加删除成功、只读拒绝、路径边界、活动录制保护及前端 API 测试。
