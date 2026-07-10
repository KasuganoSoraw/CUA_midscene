---
name: cua-midscene
description: 使用 CUA 仓库中的 ShowUI-Aloha 录制产物和 Midscene computer use 任务包完成任务创建、人工校准建议、参数化调用与执行检查。用户要求创建或运行桌面操作流程、修正某个 Midscene 步骤、修改本次输入参数，或查看可调用 CUA 项目时使用。
---

# CUA Midscene

使用仓库 CLI 操作 `CUA_midscene/projects/<project-name>` 任务包。先定位包含 `CUA_midscene/package.json` 的 CUA 仓库，再从 `CUA_midscene` 目录运行命令。

## 分类请求

把用户请求明确分类为以下一种：

- **创建**：从录制和 trace 生成新的基础 flow 与任务配置。
- **校准**：长期修正已有步骤的 route 或 timing。
- **调用**：只改变本次执行输入，不修改任务定义。

如果无法判断修改仅本次生效还是以后都生效，先询问用户，不要修改文件或执行电脑操作。

## 创建任务

1. 确认 ShowUI-Aloha trace、processed log 和截图已放入项目 `source/`。
2. 运行 `npm run flow:convert -- --project <name> --goal "<目标>"`。
3. 运行 `npm run flow:validate -- --project <name>`。
4. 展示生成的输入定义和需要人工检查的步骤。不要把基础 IR 当作长期人工维护文件。

## 校准任务

1. 读取 `flow:inspect` 输出、源 trace 和相关截图，确认错误来自已有 step 的执行描述。
2. 在 `calibration/proposals/` 创建 proposal，只修改 route 或 timing；不要修改 source、evidence、intent 或 step id。
3. 运行 `calibration:validate`，向用户展示原值、新值和原因。
4. 停止并等待用户明确确认。不得在同一次未确认交互中调用 apply。
5. 用户确认后，运行带 `--confirmed` 的 `calibration:apply`。
6. 除非用户同时要求执行，否则应用校准后不要自动操作电脑。

缺失步骤、步骤顺序错误或需要新增步骤时，要求重新生成 trace。不要通过跳过、隐式插入或自动重试掩盖结构问题。

## 调用任务

1. 运行 `project:list -- --json` 读取任务和输入定义。
2. 只传递用户本次明确改变的输入；未提供输入继续使用录制默认值。
3. 执行前使用 `flow:inspect` 或 `flow:validate` 检查 resolved flow。
4. 用户明确要求实际操作电脑时，才运行 `flow:run`。

不要把一次性输入写进 `project.json`、`flow-overrides.json` 或基础 IR。未知输入或生命周期不明确时先询问用户。

## 约束

- 不使用 browser-use、Playwright、Puppeteer 或 CDP。
- 不在 resolver、校准应用或参数合并中调用模型。
- 不直接长期修改 `ir/midscene-flow.json`。
- 不未经确认应用 Agent 生成的校准。
- 不用兜底、静默跳过或针对单一用例的硬编码掩盖失败。

需要编写项目配置、proposal 或调用具体命令时，读取 [任务契约](references/task-contract.md)。
