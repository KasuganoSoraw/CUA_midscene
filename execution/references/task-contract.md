# CUA Midscene 任务与执行契约

## 目录

```text
<skill-root>/projects/<scene>/       # 只读 builtin catalog
├── scene.json
├── SKILL.md
└── <task>/
    ├── task.yaml
    ├── task.json
    ├── SKILL.md
    └── source/

<CUA_DATA_ROOT>/
├── projects/<scene>/<task>/        # 可写 user catalog，结构同上
├── cache/
└── runs/<run-id>/
        ├── resolved-task.yaml
        ├── execution-result.json
        └── midscene/
```

`task.yaml` 是唯一长期可执行流程，语法直接遵循 Midscene YAML。`task.json` 是参数契约，保存任务元数据、trace 来源、输入 ID、中文说明与录制默认值。`source/` 保存 trace、处理日志和截图，是校准时的只读录制证据。`resolved-task.yaml` 是应用本次输入后的运行快照，不是另一份人工维护流程。

命令按 builtin 与 user 两个 catalog 发现任务，并在 JSON 中返回 `origin`、`writable` 和实际路径。同一 scene 可合并，同一 `scene/task` 重复则失败。内置任务不可修改；新建与长期维护只发生在 user catalog。任务目录中的 `SKILL.md` 是 Executor 管理数据包的一部分，不应作为独立 GDE Claw Skill 注册。

## 命令

```powershell
uv run cua scene list --json
uv run cua task list --scene <scene> --json
uv run cua task describe --scene <scene> --task <task> --json
uv run cua task init-from-trace --scene <scene> --task <task> --goal "<目标>"
uv run cua task validate --scene <scene> --task <task>
uv run cua task inspect --scene <scene> --task <task>
uv run cua task inspect --scene <scene> --task <task> --input <input-id>=<value>
uv run cua task inspect --scene <scene> --task <task> --inputs <inputs.json>
uv run cua task run --scene <scene> --task <task> --dry-run
uv run cua task run --scene <scene> --task <task>
uv run cua act run --scene <scene> --task <task> --dry-run
uv run cua act run --scene <scene> --task <task> --input <input-id>=<value>
uv run cua act run --prompt "打开 Chrome 并搜索 GUI agent" --dry-run
uv run cua act run --prompt "打开 Chrome 并搜索 GUI agent"
```

`--input` 可以重复。`--inputs` 必须是字符串值 JSON 对象；两种来源不得重复同一 ID。

所有命令支持 `--data-root <绝对路径>`；也可设置 `CUA_DATA_ROOT`。优先级为 CLI、进程环境、`.env.local`、`.env`。创建和执行要求可写数据根，且数据根不得位于 Skill 内。

## 输入契约

```json
{
  "schemaVersion": "0.2",
  "scene": "browser-demo",
  "task": "air-tickets-demo",
  "title": "Qatar Airways 航班搜索",
  "description": "设置单程航班搜索条件",
  "goal": "完成单程航班搜索",
  "source": {
    "tracePath": "source/showui-trace.json",
    "processedLogPath": "source/processed-log-sc.json",
    "conversionCommand": "uv run cua task init-from-trace ..."
  },
  "inputs": {
    "step-002-input": {
      "type": "string",
      "label": "Chrome 地址栏/搜索栏",
      "description": "在地址栏输入搜索词",
      "default": "QATAR AIRWAYS"
    }
  }
}
```

对应 YAML 使用显式占位符：

```yaml
computer: {}
agent:
  groupName: air-tickets-demo
  groupDescription: 完成单程航班搜索
  generateReport: true
tasks:
  - name: step-001 | click
    flow:
      - aiTap: 点击 Chrome 浏览器顶部的地址栏/搜索栏区域以聚焦输入框
  - name: step-002 | input
    flow:
      - sleep: 4101
      - KeyboardTypeText:
          locate: Chrome 地址栏/搜索栏
          value: '{{step-002-input}}'
          mode: replace
  - name: step-003 | keyboard
    flow:
      - KeyboardPress:
          keyName: Enter
  - name: step-004 | doubleClick
    flow:
      - aiDoubleClick: 双击页面中部文件列表里名称为 report.xlsx 的文件行，以打开该文件
```

调用时只能覆盖已声明 ID。未提供输入使用 `task.json` 的 `default`。未知、重复、非字符串、未声明、未使用或格式错误的占位符都会在启动 Midscene 前失败。

每个 trace step 对应一个 Midscene task，名称固定为 `step-NNN | <operation-type>`。步骤编号必须为正整数、唯一并严格递增；前置录制等待和本步动作位于同一 task 的 flow。整体业务目标同时保存在 `task.json.goal` 和 `agent.groupDescription`，不作为某一步的名称。

`operation.type` 支持 click、doubleClick、input、keyboard 和 wait。`doubleClick` 必须映射为 Midscene 原生 `aiDoubleClick`，整体 aiAct 投影也必须明确保留双击语义。

占位符可以嵌入任意 YAML 字符串。同一输入还会影响后续动作时，由人或 Agent 经确认后在相关 prompt 中显式复用该占位符；resolver 不根据业务文字猜测参数关联。

## 校准与重建

Agent 在对话中展示 YAML 片段的原值、新值和原因，无需创建持久化 proposal：

```text
位置: task "step-002 | input" 的 flow[1].KeyboardTypeText.locate
原值: Chrome 地址栏/搜索栏
新值: Chrome 窗口顶部工具栏中、标签栏下方横向延伸的地址栏输入框
原因: 增加区域、锚点和视觉特征，降低定位歧义
```

用户确认后只修改 user catalog 中的 `task.yaml` 并运行 `task validate`。builtin 任务只读，若要派生新流程必须使用新的 user task 标识。校准不得修改 `source/`、`task.json` 或运行产物，也不得为了让上游产物与 YAML 一致而反向修改 trace。

用户明确要求长期改变输入默认值、标签或说明时，应识别为参数契约修改，而不是步骤校准。Agent 必须单独展示 `task.json` 差异并等待确认；若同时涉及 YAML 占位符或动作，应分别展示和确认。

用户明确要求重新生成或修正 trace 时，应识别为重建任务而不是校准。重建前必须展示会替换的 `task.yaml`、`task.json` 或 source 文件并等待确认；初始化命令遇到已有任务资产时直接失败，不得自动删除文件绕过冲突。

## 执行边界

`task run` 由 Python 解析输入并写入 `<CUA_DATA_ROOT>/runs/<run-id>/resolved-task.yaml`。TypeScript runner 只读取该文件、注册 `KeyboardTypeText`、创建 ComputerAgent、调用 `agent.runYaml()`，然后写入同一 run 的 `execution-result.json`。Python 为子进程强制设置绝对 `MIDSCENE_RUN_DIR=<run-dir>/midscene`，因此 Midscene 报告和截图也属于同一次外部运行。

`act run --scene/--task` 使用同一个 resolver 生成 `resolved-task.yaml`，再按 step 和 action 顺序生成 `ai-act-prompt.txt`，最后包装为只有一个 Midscene `ai` action 的 `ai-act-task.yaml` 并复用同一 runner。sleep 不进入最终 prompt；未知动作直接失败。这些文件都只属于本次报告，不会改写 canonical YAML。

`act run --prompt` 直接生成一个仅含 Midscene `ai` action 的临时 YAML并复用同一 runner，它不读取任务资产。

`task inspect` 只解析并展示本次参数对应的 YAML。`task validate` 和执行命令的 `--dry-run` 会生成报告并经过 Midscene YAML parser，但不调用模型、不创建 ComputerAgent，也不验证页面元素定位；它们不是模拟执行。Agent 应优先使用语义明确的 `task validate`，不必在每条命令中重复追加 `--dry-run`。

runner 不读取 `task.json`、source 或 CLI 输入，不解释动作顺序，也不实现兼容与失败兜底。`KeyboardTypeText` 仅支持 ASCII 并通过底层键盘事件输入；不支持字符或定位失败时直接报错，不切换到剪贴板 Input。
