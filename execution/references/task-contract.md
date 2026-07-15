# CUA Midscene 任务与执行契约

## 目录

```text
projects/<scene>/
├── scene.json
├── SKILL.md
└── <task>/
    ├── task.yaml
    ├── task.json
    ├── SKILL.md
    ├── source/
    └── reports/<run-id>/
        ├── resolved-task.yaml
        └── execution-result.json
```

`task.yaml` 是唯一长期执行事实源，语法直接遵循 Midscene YAML。`task.json` 保存任务元数据、trace 来源、输入 ID、中文说明与录制默认值。`resolved-task.yaml` 是应用本次输入后的运行快照，不是另一份人工维护流程。

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
uv run cua act run --prompt "打开 Chrome 并搜索 GUI agent" --dry-run
uv run cua act run --prompt "打开 Chrome 并搜索 GUI agent"
```

`--input` 可以重复。`--inputs` 必须是字符串值 JSON 对象；两种来源不得重复同一 ID。

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
```

调用时只能覆盖已声明 ID。未提供输入使用 `task.json` 的 `default`。未知、重复、非字符串、未声明、未使用或格式错误的占位符都会在启动 Midscene 前失败。

每个 trace step 对应一个 Midscene task，名称固定为 `step-NNN | <operation-type>`。步骤编号必须为正整数、唯一并严格递增；前置录制等待和本步动作位于同一 task 的 flow。整体业务目标同时保存在 `task.json.goal` 和 `agent.groupDescription`，不作为某一步的名称。

占位符可以嵌入任意 YAML 字符串。同一输入还会影响后续动作时，由人或 Agent 经确认后在相关 prompt 中显式复用该占位符；resolver 不根据业务文字猜测参数关联。

## 长期修改

Agent 在对话中展示 YAML 片段的原值、新值和原因，无需创建持久化 proposal：

```text
位置: task "step-002 | input" 的 flow[1].KeyboardTypeText.locate
原值: Chrome 地址栏/搜索栏
新值: Chrome 窗口顶部工具栏中、标签栏下方横向延伸的地址栏输入框
原因: 增加区域、锚点和视觉特征，降低定位歧义
```

用户确认后直接修改 `task.yaml` 并运行 `task validate`。source、task 清单和 canonical YAML 不会在 inspect/run 中被自动修改。

## 执行边界

`task run` 由 Python 解析输入并写入 `resolved-task.yaml`。TypeScript runner 只读取该文件、注册 `KeyboardTypeText`、创建 ComputerAgent、调用 `agent.runYaml()`，然后写入 `execution-result.json`。

`act run --prompt` 生成一个仅含 Midscene `ai` action 的临时 YAML，并复用同一 runner。它不读取任务资产。

runner 不读取 `task.json`、source 或 CLI 输入，不解释动作顺序，也不实现兼容与失败兜底。`KeyboardTypeText` 仅支持 ASCII 并通过底层键盘事件输入；不支持字符或定位失败时直接报错，不切换到剪贴板 Input。
