---
name: cua-midscene
description: 使用 CUA 的本地场景/任务 Skill 与 Midscene computer use 创建、发现、检查、长期修改或执行桌面流程，支持确定性逐步执行、录制任务整体 aiAct 和无录制自然语言 aiAct。用户要求录制产物创建任务、列出可用电脑操作、修正某个 Midscene step、改变本次输入或实际操作桌面时使用。
---

# CUA Midscene

将包含本文件、`pyproject.toml` 和 `package.json` 的目录作为 Skill 根目录，并始终从该目录运行 Python CLI。该目录是完整交付单元，不依赖外层 CUA 仓库；Python 负责业务契约，TypeScript 只消费 prompt 或 resolved flow 并调用 Midscene。

首次运行前检查 `uv run cua --help` 和 `npm run typecheck` 是否可用。缺少依赖时明确告知用户，再在 Skill 根目录运行 `uv sync` 与 `npm install`；不得把依赖目录或环境密钥打包为 Skill 资产。

## 判断意图

- **创建**：从任务 `source/` 中的 trace 首次初始化 flow。
- **长期修改**：以后都改变任务中的已有 step。
- **单次调用**：只改变本次输入，不修改任务资产。

无法判断“仅本次”还是“以后都使用”时，先询问用户。

## 选择执行模式

- **确定性录制流程**：已有任务且页面稳定时，使用 `uv run cua flow run --scene <scene> --task <task>`。它按 step 逐步执行，规划成本较低。
- **录制任务整体规划**：已有任务且用户明确希望 Midscene 统一规划完整步骤时，使用 `uv run cua act run --scene <scene> --task <task>`。
- **无录制自然语言任务**：没有可用任务资产时，使用 `uv run cua act run --prompt "<电脑操作要求>"`。

必须显式选择一种模式。任何模式失败后都先报告原始错误并等待用户决定；不得自动切换模式、自动修改 flow 或自动重试。

## 发现任务

1. 运行 `uv run cua scene list --json`。
2. 选择场景后运行 `uv run cua task list --scene <scene> --json`。
3. 只读取目标场景的 `SKILL.md`，再读取目标任务的 `SKILL.md` 和 `task.json`。不要一次加载所有任务 flow 或 source。

## 创建任务

1. 将 ShowUI-Aloha trace、processed log 和截图放入 `projects/<scene>/<task>/source/`。
2. 检查每个 trace step 都有结构化 operation；不得根据 Action、Expectation 或关键词补猜。
3. 运行 `uv run cua task init-from-trace --scene <scene> --task <task> --goal "<目标>"`。
4. 运行 `uv run cua flow validate --scene <scene> --task <task>`。

已有 `midscene-flow.json` 时初始化会失败。不要删除或覆盖它来绕过失败，除非用户明确要求重新初始化并已处理现有资产。

## 长期修改

1. 读取任务 `midscene-flow.json`、相关 source trace 和截图，定位已有 step。
2. 向用户展示 step ID、原值、新值和中文原因。
3. 停止并等待用户明确确认。
4. 确认后直接编辑 `midscene-flow.json`，再运行 `flow validate`。
5. 除非用户同时要求执行，否则修改后不自动操作电脑。

不创建 overrides、proposal 或 history。缺失步骤、顺序错误或新增步骤应回到 trace 或由用户明确编辑完整 flow；不得静默跳过、隐式插入或失败后自动改写并重试。

## 单次调用

1. 运行 `uv run cua task describe --scene <scene> --task <task> --json` 读取已声明 input ID。
2. 只传递用户本次明确改变的输入；未提供项保持 canonical flow 当前值。
3. 用 `flow inspect` 检查 resolved flow。
4. 根据“选择执行模式”显式选择 `flow run` 或任务型 `act run`；两者都可以先加 `--dry-run` 检查执行输入。
5. 用户明确要求实际操作电脑时，才运行不带 `--dry-run` 的命令。

不要把一次性输入写入 `task.json` 或 `midscene-flow.json`，也不要从 prompt 临时发明 input ID。

## 约束

- 不使用 browser-use、Playwright、Puppeteer 或 CDP。
- 不在任务发现、参数解析或 resolved flow 构建中调用模型。
- 不绕过 Python CLI 直接调用 TypeScript executor。
- 不把 `flow run`、任务型 `act run` 和自然语言 `act run` 作为彼此的失败兜底。
- 不未经确认长期修改 canonical flow。
- 不用兜底、静默跳过或单用例硬编码掩盖失败。

需要检查目录、JSON 字段或完整命令时，读取 [任务契约](references/task-contract.md)。
