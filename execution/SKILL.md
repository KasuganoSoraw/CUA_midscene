---
name: cua-midscene
description: 使用本地场景/任务 Skill 与 Midscene computer use 创建、发现、检查、修改或执行桌面任务。已有录制时运行 canonical Midscene YAML；没有录制时将自然语言包装为临时 YAML。用户要求从 trace 创建任务、列出可用电脑操作、修正任务步骤、改变本次输入或实际操作桌面时使用。
---

# CUA Midscene

将包含本文件、`pyproject.toml` 和 `package.json` 的目录作为 Skill 根目录，并始终从该目录运行 Python CLI。该目录是完整交付单元，不依赖外层 CUA 仓库；Python 负责 trace 转换、任务与输入，TypeScript 只注册 customActions 并调用 Midscene `agent.runYaml()`。

首次运行前检查 `uv run cua --help` 和 `npm run typecheck`。缺少依赖时明确告知用户，再在 Skill 根目录运行 `uv sync` 与 `npm install`；不得把依赖目录、报告或环境密钥打包为 Skill 资产。

## 判断意图

- **创建**：从任务 `source/` 中的结构化 trace 初始化 `task.yaml` 和 `task.json`。
- **长期修改**：以后都改变 canonical `task.yaml` 中的动作、prompt 或占位符。
- **单次调用**：只覆盖本次已声明输入，不修改任务资产。

无法判断“仅本次”还是“以后都使用”时，必须先询问用户。

## 选择入口

- **已有录制任务**：使用 `uv run cua task run --scene <scene> --task <task>`。
- **无录制自然语言任务**：使用 `uv run cua act run --prompt "<电脑操作要求>"`。

录制任务只执行其 `task.yaml`。需要 aiAct 规划时应在 YAML 中明确使用 Midscene 原生 `ai` action，不存在另一套“把录制步骤重新拼成完整 prompt”的执行模式。失败后报告原始错误并等待用户决定；不得自动切换、修改任务或重试。

## 发现任务

1. 运行 `uv run cua scene list --json`。
2. 选择场景后运行 `uv run cua task list --scene <scene> --json`。
3. 只读取目标场景的 `SKILL.md`，再读取目标任务的 `SKILL.md` 和 `task.json`。需要修改流程时才读取目标 `task.yaml` 和相关 source，不要一次加载所有任务资产。

## 创建任务

1. 将 ShowUI-Aloha trace、processed log 和截图放入 `projects/<scene>/<task>/source/`。
2. 检查每个 trace step 都有结构化 `caption.operation`；不得根据 observation、Action、Expectation 或关键词补猜。
3. 运行 `uv run cua task init-from-trace --scene <scene> --task <task> --goal "<目标>"`。
4. 运行 `uv run cua task validate --scene <scene> --task <task>`。

如果 `task.yaml` 或 `task.json` 已存在，初始化直接失败。除非用户明确要求删除并重新初始化，否则不得移除现有资产绕过该错误。

## 长期修改

1. 读取任务 `task.yaml`、相关 source trace 和截图，定位错误动作。
2. 向用户展示 YAML 原值、新值和中文原因。
3. 停止并等待用户明确确认。
4. 确认后直接编辑 `task.yaml`，再运行 `task validate`。
5. 除非用户同时要求执行，否则修改后不操作电脑。

不创建自定义 flow、route、overrides、proposal 或 history。缺失动作、顺序错误或新增动作由用户确认后直接修改 YAML，或回到 trace 重新初始化；不得静默跳过或在失败后自动改写。

## 单次调用

1. 运行 `uv run cua task describe --scene <scene> --task <task> --json` 读取 input ID、中文说明和录制默认值。
2. 只传递用户本次明确改变的输入；未提供项保持 `task.json` 中的录制默认值。
3. 使用 `uv run cua task inspect ... --input <id>=<value>` 检查 resolved YAML。
4. 用户明确要求实际操作电脑时，运行 `task run`；可先加 `--dry-run`。

同一参数需要影响后续动作时，canonical YAML 必须在相关 prompt 中显式复用同一个 `{{input-id}}`。不要根据字面值机械替换，不要从用户自然语言临时发明 input ID，也不要把一次性值写回任务文件。

## 约束

- 不使用 browser-use、Playwright、Puppeteer 或 CDP。
- 不在 trace 转换、任务发现、输入解析或 YAML 快照构建中调用模型。
- 不绕过 Python CLI 直接调用 TypeScript runner。
- 不未经确认长期修改 `task.yaml`。
- 不用兼容读取、替代动作、静默跳过、自动重试或单用例硬编码掩盖失败。

需要检查目录、字段和完整命令时，读取 [任务契约](references/task-contract.md)。
