# CUA Midscene 任务与执行契约

## 目录

```text
projects/<scene>/
├── scene.json
├── SKILL.md
└── <task>/
    ├── task.json
    ├── SKILL.md
    ├── midscene-flow.json
    ├── source/
    └── reports/<run-id>/
        ├── resolved-flow.json
        ├── execution-result.json          # flow run
        ├── ai-act-prompt.txt              # 任务型 act run
        └── ai-act-result.json             # 任务型 act run
```

`midscene-flow.json` 是唯一长期执行事实源。`task.json` 只声明输入绑定，不保存默认值。`resolved-flow.json` 是 canonical flow 应用本次输入后的运行快照，不是另一份人工维护流程。

## 命令

```powershell
uv run cua scene list --json
uv run cua task list --scene <scene> --json
uv run cua task describe --scene <scene> --task <task> --json
uv run cua task init-from-trace --scene <scene> --task <task> --goal "<目标>"
uv run cua flow validate --scene <scene> --task <task>
uv run cua flow inspect --scene <scene> --task <task>
uv run cua flow inspect --scene <scene> --task <task> --input <input-id>=<value>
uv run cua flow inspect --scene <scene> --task <task> --inputs <inputs.json>
uv run cua flow run --scene <scene> --task <task> --dry-run
uv run cua flow run --scene <scene> --task <task>
uv run cua act run --scene <scene> --task <task> --dry-run
uv run cua act run --scene <scene> --task <task> --input <input-id>=<value>
uv run cua act run --prompt "打开 Chrome 并搜索 GUI agent" --dry-run
uv run cua act run --prompt "打开 Chrome 并搜索 GUI agent"
```

`--input` 可以重复。`--inputs` 必须是字符串值 JSON 对象；两种来源不得重复同一 ID。

## 输入绑定

```json
{
  "schemaVersion": "0.1",
  "scene": "browser-demo",
  "task": "air-tickets-demo",
  "title": "Qatar Airways 航班搜索",
  "description": "设置单程航班搜索条件",
  "goal": "完成单程航班搜索",
  "inputs": {
    "step-002-value": {
      "type": "string",
      "label": "浏览器搜索关键词",
      "binding": {
        "stepId": "step-002",
        "field": "route.value"
      }
    }
  }
}
```

调用时只能覆盖已声明 ID。未提供输入时，从绑定 step 的 `route.value` 读取当前值。用户提出未声明输入时，先澄清是需要新增任务参数还是长期修改 flow。

## 长期修改

Agent 在对话中展示如下信息，无需创建持久化 proposal：

```text
step: step-002
字段: route.locatePrompt
原值: Chrome 地址栏/搜索栏
新值: Chrome 窗口顶部工具栏中、标签栏下方横向延伸的地址栏输入框
原因: 增加区域、锚点和视觉特征，降低定位歧义
```

用户确认后直接修改 `midscene-flow.json` 并运行 validate。canonical flow、source 和 task 清单不会在 inspect/run 中被修改。

## 执行边界

`flow run` 由 Python CLI 生成 `resolved-flow.json`，TypeScript 确定性 executor 只读取该文件并写入 `execution-result.json`。

任务型 `act run` 使用同一 resolver 生成 `resolved-flow.json`，TypeScript 将其中的 route 指令按 step 顺序组合为 `ai-act-prompt.txt`，再调用一次 `agent.aiAct()` 并写入 `ai-act-result.json`。prompt 只包含执行指令，不包含 goal、intent、evidence 或 timing。

自然语言 `act run` 将源要求和报告写入 `execution/reports/<run-id>/`。它不读取任何任务资产。

两种 executor 都不读取 `task.json`、canonical flow、source 或单次参数，也不实现 resolver 或执行模式兜底。`act run` 为 ASCII 输入注册 `KeyboardTypeText`；只有待输入文本包含该动作不支持的字符时，规划上下文才允许默认 `Input`。定位或一般执行失败不得触发输入动作切换。

route 必须来自 trace 的结构化 `caption.operation` 或用户确认后的直接修改。operation 缺失、route 非法或输入绑定失效时直接失败。
