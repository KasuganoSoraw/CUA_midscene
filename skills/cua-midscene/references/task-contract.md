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
└── reports/<run-id>/resolved-flow.json
```

合并顺序固定为基础 IR、已确认校准、本次输入。待确认 proposal 不参与执行。合并过程完全确定性，不调用模型。

## 常用命令

所有命令从 `execution` 目录执行：

```powershell
npm run project:list -- --json
npm run flow:validate -- --project <project-name>
npm run flow:inspect -- --project <project-name>
npm run flow:inspect -- --project <project-name> --input <input-id>=<value>
npm run flow:inspect -- --project <project-name> --inputs <inputs.json>
npm run flow:run -- --project <project-name> --input <input-id>=<value>
npm run calibration:validate -- --project <project-name> --proposal <proposal-id>
npm run calibration:apply -- --project <project-name> --proposal <proposal-id> --confirmed
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

## 校准建议

先通过 `flow:validate` 获取 `baseFlowFingerprint`，通过 `flow:inspect` 获取 step 当前完整 route 和 timing。proposal 文件名必须与 `id` 一致：

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

人工可以直接编辑 `config/flow-overrides.json`，但必须随后运行 `flow:validate`。允许字段只有已有 step 的 `route` 和 `timing.waitBeforeMs`；source、evidence、intent 和 step id 不可覆盖。

结构性错误不属于 override：缺失步骤、步骤顺序错误和新增步骤应回到 trace 生成阶段修正。
