# air-tickets-demo

该目录是 ShowUI-Aloha air-ticket 教学录制到 Midscene flow 的第一个样例项目。

## 目录职责

- `source/`：保存来自 ShowUI-Aloha Learn 的源产物，包括 trace、processed log 和截图。
- `ir/`：保存 converter 可重新生成的基础 Midscene flow。
- `config/project.json`：任务说明、三个可调用输入及其录制默认值。
- `config/flow-overrides.json`：已经确认的长期校准；当前为空。
- `calibration/proposals/`：Agent 生成、等待用户确认的建议。
- `calibration/history/`：已应用建议的审计记录。
- `generated/`：预留给后续从 flow 派生出的 Midscene 脚本，例如 `run.ts`。
- `reports/`：保存执行报告和本次 resolved flow 快照，不提交 Git。

## Source 产物

- `source/showui-trace.json`：ShowUI-Aloha Learn 生成的语义 trace，包含 Observation、Think、Action、Expectation 和面向 Midscene 的 `operation` 动作结构。
- `source/processed-log.json`：录制输入日志经过合并后的结构化操作日志。
- `source/processed-log-sc.json`：带截图引用的结构化操作日志。
- `source/screenshots/`：ShowUI-Aloha Learn 抽取的全屏截图与 crop。

## 生成命令与模型使用

准备录制资源：

```powershell
将 ShowUI-Aloha 录制视频和输入日志放入 record\Aloha_Learn\projects\air_tickets\inputs
```

这一步只是整理录制输入，不调用模型。

生成 ShowUI-Aloha trace：

```powershell
cd record
uv run python Aloha_Learn\parser.py Aloha_Learn\projects\air_tickets
```

这一步会调用 `record/.env` 中配置的 OpenAI 兼容模型，用于从截图和操作日志生成语义 trace。

生成 Midscene flow：

```powershell
cd execution
npm run flow:convert -- --project air-tickets-demo --goal "将 Qatar Airways 订票页面设置为 Singapore 到 Los Angeles 的单程航班搜索"
```

这一步当前不调用模型，只进行确定性映射：读取 `source/showui-trace.json` 中的 `operation.prompt`、input 操作的 `operation.locatePrompt`，以及 `source/processed-log-sc.json` 中的截图引用和时间戳，输出 `ir/midscene-flow.json`。相邻录制动作的时间差会转换为每个 step 的 `timing.waitBeforeMs`，供 runner 执行前等待使用；极短间隔会被忽略，长间隔最多截断为 30 秒。

首次转换还会初始化 `config/project.json` 和空的 `config/flow-overrides.json`；再次转换只覆盖基础 IR，不覆盖任务配置或校准。

检查默认任务或只改变搜索关键词：

```powershell
npm run flow:validate -- --project air-tickets-demo
npm run flow:inspect -- --project air-tickets-demo --input step-002-value="GOOGLE"
```

当前参数 ID 为 `step-002-value`、`step-008-value` 和 `step-010-value`。未传参数继续使用 `QATAR AIRWAYS`、`SINGAPORE` 和 `LOS`。

执行 Midscene flow：

```powershell
cd execution
npm run flow:run -- --project air-tickets-demo
```

这一步会通过 Midscene computer use 调用视觉模型执行 `aiTap`、`aiAct`、显式 `aiWaitFor` 等操作。runner 会先读取当前 step 的 `timing.waitBeforeMs` 做确定性等待，再执行 route。对于 `input` route，runner 会调用自定义 `KeyboardTypeText` action，并把 route 的 `locatePrompt` 传给该 action 的 `locate` 字段复用 Midscene 定位管线，再用键盘事件逐键输入；该路径不使用 Midscene 内置 `aiInput`，也不依赖剪贴板粘贴。

注意：`npm run flow:run -- --project air-tickets-demo` 是执行命令，不是 trace 转换命令。trace 转换为 Midscene flow 的命令是 `npm run flow:convert -- --project air-tickets-demo --goal "..."`。

原始录制视频较大，不在该项目目录重复复制。当前来源为：

```text
record/Aloha_Learn/Examples/air_tickets/Quick-Recording-08-54-17.mp4
```

## 执行边界

本目录不使用 ShowUI-Aloha 的回放器。后续执行路径应为：

```text
source/showui-trace.json
  -> ir/midscene-flow.json
  -> config/flow-overrides.json
  -> 本次输入
  -> resolved flow
  -> execution 通用 runner
  -> Midscene computer use
```
