---
name: cua-midscene
description: 使用本地场景/任务与 Midscene computer use 发现、创建、校准或执行桌面任务。用户要求从原始录制目录或标准化 trace 创建任务、修正长期步骤、临时改变输入、运行已有任务，或在无录制时直接操作电脑时使用。
---

# CUA Midscene

本目录是供 GDE Claw 等外部 Agent 或 Agent Host 集成的完整 TypeScript Skill 交付单元，要求 Node.js `>=22.18.0`。发布或嵌入后从执行器包根目录使用 `node dist/cli/main.js ...`；在源码仓开发时使用 `npm run cua -- ...`。

## 核心事实

- `task.yaml` 是唯一长期执行流程，由人、Agent、前端和 Midscene 共同消费。
- `task.json` 保存任务元数据、输入 ID 和录制默认值，不保存执行步骤。
- `source/` 是校准时的只读录制证据。
- `source/screenshots/*.reference.png` 是可选的干净定位参考；带红叉 crop 只用于理解录制点击点，不能作为 Midscene reference patch。
- Skill 内 `projects/` 是只读 builtin catalog；用户任务只写入 `<CUA_DATA_ROOT>/projects/`。
- 运行产物只写入 `<CUA_DATA_ROOT>/runs/<run-id>/`。
- computer use 必须由上层串行调用。
- Agent Host 调用本 Skill 命令时必须设置较长的任务超时。录制处理、模型规划和真实 computer use 可能长时间运行，不得因控制台短暂无输出而提前终止；只有控制台持续较长时间没有新增输出且任务明显无进展时，才尝试终止并原样报告。

`CUA_DATA_ROOT` 保存用户任务和运行产物；`CUA_RECORD_ROOT` 定位外部录制处理器；`CUA_RECORDINGS_ROOT` 定位原始录制集合。命令行参数优先于环境配置，完整优先级见 `references/task-contract.md`。

## 判断意图

- **发现**：列出场景或任务，不读取无关资产。
- **从原始录制创建**：使用单一命令生成 trace、规范化 source、初始化并验证任务。
- **从标准 source 初始化**：仅当 source 已包含标准化 trace 与 processed log 时使用高级初始化命令。已有资产不得自动覆盖。
- **校准**：提出 `task.yaml` 修改建议，展示原值、新值和原因，等待明确确认。
- **参数契约修改**：长期改变默认值、标签或说明时单独提出 `task.json` 差异并等待确认。
- **单次调用**：只通过已声明的 `--input` 传值，不修改任务资产。
- **执行**：只有用户明确要求操作电脑时才运行非 dry-run 命令。

无法判断“仅本次”还是“以后都使用”时必须询问。

## 发现与创建

1. 运行 `node dist/cli/main.js scene list --json`，再运行 `node dist/cli/main.js task list --scene <scene> --json`。
2. 只读取目标场景和任务的 `SKILL.md`、`task.json`；检查动作时再读取 `task.yaml` 和必要 source。
3. 用户提供原始录制目录时，运行 `node dist/cli/main.js task create-from-recording --scene <scene> --task <task> --recording "<录制目录>" [--goal "<任务描述>"]`。`--goal` 只保存为创建后的任务描述，不参与 trace 生成；用户未说明时可以省略且不得推测。
4. 该命令内部运行外部 recorder、规范化 source、初始化并静态验证；Agent 不得再手工调用 Python、重命名或搬运录制产物。
5. 只有 user task 的 `source/showui-trace.json` 和 `source/processed-log-sc.json` 已经标准化时，才运行 `node dist/cli/main.js task init-from-trace --scene <scene> --task <task> --goal "<目标>"`，再运行 `node dist/cli/main.js task validate --scene <scene> --task <task> --json`。

两种创建入口均不得覆盖已有 user 或 builtin 任务；失败时原样报告错误。

## 校准协议

1. 按 `step-NNN | <operation-type>` 定位 `task.yaml` 步骤，必要时只读查看 source。
2. 展示 YAML 位置、原值、新值和中文原因。
3. 确认目标 `origin=user`、`writable=true`；builtin 任务不得修改。
4. 停止并等待用户明确确认。
5. 确认后只修改 user task 的 `task.yaml`，再运行 `node dist/cli/main.js task validate --scene <scene> --task <task> --json`。
6. 除非用户同时要求执行，否则校准完成后不得操作电脑。

普通内容校准不得修改 `source/`、`task.json` 或运行报告，也不得启用 `continueOnError`。参数契约修改是唯一允许单独编辑 `task.json` 的情况。步骤插入、删除或移动只能通过复核页面完成；Agent 不得直接重编号 YAML 步骤。

难以用文字区分的图标可以经确认后在对应 `aiTap`/`aiDoubleClick` 中增加或调整 `locate.prompt` 与 `locate.images`，但只能引用任务包内已有的干净 reference patch。图片名必须被 prompt 明确引用；参考图中心表示录制目标外观，不是要求 Midscene 点击固定坐标。

## 本地复核页面

运行 `node dist/cli/main.js review --no-open --json` 启动仅监听 `127.0.0.1:47831` 的本地复核页面；相同数据目录的已有服务会被复用。端口被其他程序或不同数据目录占用时应原样报告错误，不自动递增端口。

任务创建成功后，或用户进入可视化校准时，运行上述命令，读取返回的 `url` 并在回复中提供给用户。

## 调用与执行

所有任务命令中的本次输入都使用相同的稀疏参数：可重复传入 `--input "<input-id>=<value>"`，或使用 `--inputs <json-file>`；未提供项保持录制默认值。Agent 不得只在执行命令中传值，而用默认值执行 inspect 或 validate。

1. 读取输入定义：`node dist/cli/main.js task describe --scene <scene> --task <task> --json`。
2. 检查本次解析结果：`node dist/cli/main.js task inspect --scene <scene> --task <task> [--input "<input-id>=<value>"] [--inputs <json-file>] --json`。
3. 使用同一组输入静态验证：`node dist/cli/main.js task validate --scene <scene> --task <task> [--input "<input-id>=<value>"] [--inputs <json-file>] --json`。
4. 稳定录制任务逐步执行：`node dist/cli/main.js task run --scene <scene> --task <task> [--input "<input-id>=<value>"] [--inputs <json-file>]`。
5. 录制任务需要统一规划时：`node dist/cli/main.js act run --scene <scene> --task <task> [--input "<input-id>=<value>"] [--inputs <json-file>]`。
6. 无录制时：`node dist/cli/main.js act run --prompt "<电脑操作要求>"`。

仅验证命令形状和运行投影时，可在 `task run` 或两种 `act run` 后增加 `--dry-run`。需要详细任务结构、输入契约、参考图和运行产物说明时，读取 `references/task-contract.md`。

`--dry-run` 不调用模型、不创建设备、不验证页面定位，不得描述为模拟执行。执行失败后报告原始错误并等待决定，不得自动切换模式、修改任务或重试。

同一输入需要影响后续动作时，只能经确认后在 `task.yaml` 中显式复用同一个 `{{input-id}}`；不得机械全文替换或从用户自然语言发明 input ID。

## 约束

- 不使用 browser-use、Playwright、Puppeteer 或 CDP。
- 不在转换、发现、输入解析或 YAML 快照中调用模型。
- 不创建自定义 flow、route、overrides、proposal 或 history。
- 不使用兼容读取、替代动作、静默跳过、自动重试或单用例硬编码掩盖失败。
