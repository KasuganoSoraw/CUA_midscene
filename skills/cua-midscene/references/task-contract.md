# CUA Midscene 任务契约

## 目录

- [项目层次](#项目层次)
- [常用命令](#常用命令)
- [项目输入](#项目输入)
- [校准建议](#校准建议)
- [人工维护](#人工维护)

## 项目层次

```text
projects/<project-name>/
├── source/                         # 录制、trace、日志和截图
├── ir/midscene-flow.json           # converter 自动生成
├── config/project.json             # 任务说明、输入和默认值
├── config/flow-overrides.json      # 已确认校准
├── calibration/proposals/          # 待确认建议
├── calibration/history/            # 已应用建议
└── reports/<run-id>/
    ├── resolved-flow.json
    └── execution-result.json
```

合并顺序固定为基础 IR、已确认校准、本次输入。待确认 proposal 不参与执行。合并过程完全确定性，不调用模型。

基础 IR 的 route 只能来自 trace 中完整的结构化 `caption.operation`。转换器不扫描自然语言关键词，也不生成 fallback；operation 缺失、类型未知或必需字段缺失时必须回到 trace 阶段修正。

## 常用命令

所有命令从 `execution` 目录执行：

```powershell
uv run cua project list --json
uv run cua flow convert --project <project-name> --goal "<目标>"
uv run cua flow validate --project <project-name>
uv run cua flow inspect --project <project-name>
uv run cua flow inspect --project <project-name> --input <input-id>=<value>
uv run cua flow inspect --project <project-name> --inputs <inputs.json>
uv run cua flow run --project <project-name> --input <input-id>=<value> --dry-run
uv run cua flow run --project <project-name> --input <input-id>=<value>
uv run cua calibration validate --project <project-name> --proposal <proposal-id>
uv run cua calibration apply --project <project-name> --proposal <proposal-id> --confirmed
```

`--input` 可以重复。`--inputs` 文件必须是字符串值 JSON 对象；两种来源不得重复提供同一 input id。

## 项目输入

`config/project.json` 中的输入绑定已有 input step：

```json
{
  "schemaVersion": "0.1",
  "project": "air-tickets-demo",
  "title": "机票搜索",
  "description": "根据录制流程搜索航班",
  "goal": "完成单程航班搜索",
  "inputs": {
    "step-002-value": {
      "type": "string",
      "label": "浏览器搜索关键词",
      "default": "QATAR AIRWAYS",
      "binding": {
        "stepId": "step-002",
        "field": "route.value"
      }
    }
  }
}
```

只覆盖本次变化的输入。不要为了调用任务修改默认值。

创建任务时，Agent 检查 trace 中的 input operation，并与用户确认需要暴露的业务输入，然后在 `project.json` 中维护稳定 input id、中文标签、录制默认值和 `route.value` 绑定。调用时只能使用这些已声明 id；用户提出未声明输入时，应先澄清或提出任务配置修改，不能从 prompt 猜测并临时注入。

## 校准建议

先通过 `cua flow validate` 获取 `baseFlowFingerprint`，通过 `cua flow inspect` 获取 step 当前完整 route 和 timing。proposal 文件名必须与 `id` 一致：

```json
{
  "schemaVersion": "0.1",
  "id": "fix-step-002-target",
  "project": "air-tickets-demo",
  "baseFlowFingerprint": "<64位SHA-256>",
  "summary": "修正地址栏定位描述",
  "reason": "原描述缺少顶部工具栏和相对位置信息",
  "changes": [
    {
      "stepId": "step-002",
      "before": {
        "route": {
          "strategy": "input",
          "prompt": "在 Chrome 地址栏/搜索栏中输入 {{value}}",
          "locatePrompt": "Chrome 地址栏/搜索栏",
          "value": "QATAR AIRWAYS",
          "mode": "replace",
          "inputMethod": "keyboard-action"
        }
      },
      "after": {
        "route": {
          "locatePrompt": "Chrome 窗口顶部工具栏中、标签栏下方横向延伸的地址栏输入框"
        }
      }
    }
  ]
}
```

同 strategy 可以只提供需要改变的 route 字段。改变 strategy 时必须提供新 route 的所有必填字段。timing 校准只允许 `waitBeforeMs`。

proposal 校验成功后，向用户展示变更并等待确认。只有确认后才能传 `--confirmed` 应用。应用会更新 overrides，并把 proposal 移入 history。

## 人工维护

人工可以直接编辑 `config/flow-overrides.json`，但必须随后运行 `uv run cua flow validate --project <project-name>`。允许字段只有已有 step 的 `route` 和 `timing.waitBeforeMs`；source、evidence、intent 和 step id 不可覆盖。

## 执行边界

Python CLI 负责生成 `resolved-flow.json`，TypeScript executor 只读取该文件并写入 `execution-result.json`。不要让 executor 读取 `project.json`、`flow-overrides.json`、proposal 或单次参数，也不要在 Python 失败后调用旧 TypeScript resolver。

结构性错误不属于 override：缺失步骤、步骤顺序错误和新增步骤应回到 trace 生成阶段修正。
