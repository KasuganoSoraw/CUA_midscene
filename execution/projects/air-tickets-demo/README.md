# air-tickets-demo

该目录是 record 中 air-ticket 教学录制到 Midscene computer use 的完整任务包样例。

## 目录职责

- `source/`：ShowUI-Aloha Learn 生成的 trace、processed log 和截图。
- `ir/midscene-flow.json`：Python converter 可重新生成的基础 IR。
- `config/project.json`：任务说明、三个可调用输入及录制默认值。
- `config/flow-overrides.json`：已经确认的长期校准，当前为空。
- `calibration/proposals/`：Agent 生成并等待用户确认的建议。
- `calibration/history/`：已应用建议的审计记录。
- `generated/`：预留给后续脚本派生产物。
- `reports/`：resolved flow、executor 结果和 Midscene 报告，不提交 Git。

## 产物链路

```text
source/showui-trace.json
  → Python converter
  → ir/midscene-flow.json
  → config/flow-overrides.json
  → 本次输入
  → reports/<run-id>/resolved-flow.json
  → TypeScript Midscene executor
```

生成 trace 会调用 `record/.env` 配置的 OpenAI 兼容模型。trace 到 IR、校准和参数合并均为确定性 Python 逻辑，不调用模型。Midscene 实际执行阶段会调用 `execution/.env.local` 配置的视觉模型。

## 转换与调用

从 `execution` 目录转换：

```powershell
uv run cua flow convert --project air-tickets-demo --goal "将 Qatar Airways 订票页面设置为 Singapore 到 Los Angeles 的单程航班搜索"
```

首次转换初始化 `project.json` 和空 overrides；再次转换只覆盖基础 IR，不覆盖任务配置或已确认校准。converter 会保留 trace 的 operation、source/evidence 和截图引用，并把录制间隔转换为最高 30 秒的 `timing.waitBeforeMs`。

查看默认任务或只改变浏览器搜索词：

```powershell
uv run cua flow validate --project air-tickets-demo
uv run cua flow inspect --project air-tickets-demo --input step-002-value=GOOGLE
```

当前参数及默认值：

- `step-002-value`：`QATAR AIRWAYS`
- `step-008-value`：`SINGAPORE`
- `step-010-value`：`LOS`

未提供的参数保持默认值。执行前建议先 dry-run：

```powershell
uv run cua flow run --project air-tickets-demo --dry-run
uv run cua flow run --project air-tickets-demo
```

input route 由 `KeyboardTypeText` 通过键盘事件输入，不使用剪贴板。点击、复杂动作和显式等待分别映射到 Midscene 的 `aiTap`、`aiAct` 和 `aiWaitFor`。

原始录制视频位于：

```text
record/Aloha_Learn/Examples/air_tickets/Quick-Recording-08-54-17.mp4
```
