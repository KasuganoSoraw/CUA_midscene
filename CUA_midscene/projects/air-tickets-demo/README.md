# air-tickets-demo

该目录是 ShowUI-Aloha air-ticket 教学录制到 Midscene flow 的第一个样例项目。

## 目录职责

- `source/`：保存来自 ShowUI-Aloha Learn 的源产物，包括 trace、processed log 和截图。
- `ir/`：保存转换后的 Midscene flow，例如 `midscene-flow.json`。
- `generated/`：预留给后续从 flow 派生出的 Midscene 脚本，例如 `run.ts`。
- `reports/`：保存该项目执行时产生的报告或报告引用。

## Source 产物

- `source/showui-trace.json`：ShowUI-Aloha Learn 生成的语义 trace。
- `source/processed-log.json`：录制输入日志经过合并后的结构化操作日志。
- `source/processed-log-sc.json`：带截图引用的结构化操作日志。
- `source/screenshots/`：ShowUI-Aloha Learn 抽取的全屏截图与 crop。

## 生成命令与模型使用

生成 ShowUI-Aloha trace：

```powershell
cd showui-aloha
uv run python Aloha_Learn\parser.py Aloha_Learn\projects\air_tickets
```

这一步会调用 `showui-aloha/.env` 中配置的 OpenAI 兼容模型，用于从截图和操作日志生成语义 trace。

生成 Midscene flow：

```powershell
cd CUA_midscene
npm run flow:convert:air
```

这一步当前不调用模型，只进行确定性规则映射：读取 `source/showui-trace.json` 和 `source/processed-log-sc.json`，输出 `ir/midscene-flow.json`。

执行 Midscene flow：

```powershell
cd CUA_midscene
npm run flow:run:air
```

这一步会通过 Midscene computer use 调用视觉模型执行 `aiInput`、`aiTap`、`aiAct`、`aiWaitFor` 等操作。当前样例包含 `manual-review` 步骤，runner 会在执行前 fail fast。

原始录制视频较大，不在该项目目录重复复制。当前来源为：

```text
showui-aloha/Aloha_Learn/Examples/air_tickets/Quick-Recording-08-54-17.mp4
```

## 执行边界

本目录不使用 ShowUI-Aloha 的回放器。后续执行路径应为：

```text
source/showui-trace.json
  -> ir/midscene-flow.json
  -> CUA_midscene 通用 runner
  -> Midscene computer use
```
