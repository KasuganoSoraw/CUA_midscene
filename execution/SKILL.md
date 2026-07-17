---
name: cua-midscene
description: 使用本地场景/任务 Skill 与 Midscene computer use 发现、创建、重建、校准或执行桌面任务。用户要求从录制 trace 创建任务、修正某一步、调整长期流程、临时改变输入、运行已有任务，或在无录制时直接操作电脑时使用。
---

# CUA Midscene

将包含本文件、`pyproject.toml` 和 `package.json` 的目录作为 Skill 根目录，并始终从该目录运行 `uv run cua ...`。该目录是完整交付单元，不依赖外层 CUA 仓库。

## 核心事实

- `task.yaml` 是唯一长期可执行流程，由人、Agent、前端和 Midscene 共同消费。
- `task.json` 是任务元数据和参数契约，保存输入 ID 与录制默认值，不保存执行步骤。
- `source/` 保存 trace、处理日志和截图，是校准时的只读录制证据。
- Skill 内的 `projects/` 是只读 builtin catalog；不得在其中创建、校准或沉淀用户任务。
- 用户任务是由 Executor Skill 管理的数据包，只写入 `<CUA_DATA_ROOT>/projects/`。
- 所有运行产物只写入 `<CUA_DATA_ROOT>/runs/<run-id>/`，不得写回任务目录或 Skill。

运行前必须配置 Skill 外部的绝对数据根。优先级为命令行 `--data-root`、进程 `CUA_DATA_ROOT`、`.env.local`、`.env`。发现命令可在未配置时只读取 builtin catalog；创建、验证和执行必须有可写数据根。

不得为了保持上下游一致而反向修改 `source/`。只有用户明确要求“重新生成 trace”或“重建任务”时，才进入重建流程；这不属于校准。

## 判断意图

- **发现**：列出场景或任务，不读取无关任务资产。
- **创建/重建**：从 `source/` 初始化 `task.yaml` 和 `task.json`。已有任务必须先说明会替换哪些资产并等待用户明确确认；不得删除文件绕过初始化冲突。
- **校准**：用户说“校准”“修正步骤”“这一步不对”“以后改成”或表达同类长期意图时，提出 `task.yaml` 修改建议并等待确认。
- **参数契约修改**：用户明确要求以后改变输入默认值、标签或说明时，提出 `task.json` 修改建议并单独等待确认；不得同时改写执行步骤。
- **单次调用**：用户只改变本次输入时，通过已声明的 `--input` 传值，不修改任务资产。
- **执行**：只有用户明确要求操作电脑时才运行非 dry-run 的执行命令。

无法判断变更是“仅本次”还是“以后都使用”时，必须先询问用户。

## 发现与创建

1. 运行 `uv run cua scene list --json`，选择场景后运行 `uv run cua task list --scene <scene> --json`。
2. 只读取目标场景的 `SKILL.md`，再读取目标任务的 `SKILL.md` 和 `task.json`；检查步骤时才读取 `task.yaml` 和相关 source。
3. 创建任务前检查 user catalog 中目标任务的 `source/showui-trace.json` 和 `source/processed-log-sc.json`。每个 trace step 必须有结构化 `caption.operation`，不得根据其他自然语言字段补猜。
4. 运行 `uv run cua task init-from-trace --scene <scene> --task <task> --goal "<目标>"`，然后运行 `uv run cua task validate --scene <scene> --task <task>`。

动作类型和目录契约见 [任务契约](references/task-contract.md)。转换器发现非法或不一致动作时必须失败，不得降级为替代动作。

## 校准协议

1. 读取 `task.yaml`，按稳定的 `step-NNN | <operation-type>` 定位目标步骤；按需只读查看 trace、日志和截图。
2. 在对话中展示 YAML 位置、原值、新值和中文原因。
3. 确认目标的 `origin=user` 与 `writable=true`；builtin 任务不得修改，应创建新的 user task 标识。
4. 停止并等待用户明确确认。未经确认不得写入任何任务资产。
5. 确认后只修改 user task 的 `task.yaml`，再运行 `uv run cua task validate --scene <scene> --task <task>`。
6. 除非用户同时要求执行，否则校准完成后不得操作电脑。

校准不得修改 `source/`、`task.json` 或报告；不得重编号、复用或打乱 step ID，也不得启用 `continueOnError`。缺失动作、顺序错误或新增动作可以在确认后直接修改 YAML；需要纠正模型原始 trace 时必须切换为重建意图并重新确认。

只有参数契约修改可以在确认后编辑 `task.json`，并且仅限输入定义、默认值和任务说明。若同一请求还需要改变 YAML 占位符或执行动作，必须分别展示两份差异并取得确认。

## 单次调用与执行

1. 运行 `uv run cua task describe --scene <scene> --task <task> --json` 读取 input ID 和默认值。
2. 只传用户本次明确改变的输入；未提供项保持 `task.json` 中的录制默认值。
3. 使用 `uv run cua task inspect ... --input <id>=<value>` 查看参数解析后的 YAML；使用 `task validate` 做静态验证。
4. 已有录制默认使用 `uv run cua task run --scene <scene> --task <task>`。只有用户明确要求整体规划，或明确确认页面可能偏离录制路径时，才使用任务型 `uv run cua act run --scene <scene> --task <task>`。
5. 无录制时使用 `uv run cua act run --prompt "<电脑操作要求>"`。

`--dry-run` 只构建并静态解析执行 YAML，不调用模型、不创建设备，也不验证页面定位；不要把它描述为模拟执行。执行失败后报告原始错误并等待用户决定，不得自动切换模式、修改任务或重试。

同一输入需要影响后续动作时，只能在用户确认后于 `task.yaml` 中显式复用同一个 `{{input-id}}`。不得根据字面值机械替换，不得从用户自然语言发明 input ID，也不得把一次性值写回任务文件。

## 约束

- 不使用 browser-use、Playwright、Puppeteer 或 CDP。
- 不在 trace 转换、任务发现、输入解析或 YAML 快照构建中调用模型。
- 不绕过 Python CLI 直接调用 TypeScript runner。
- 不创建自定义 flow、route、overrides、proposal 或 history。
- 不用兼容读取、替代动作、静默跳过、自动重试或单用例硬编码掩盖失败。
