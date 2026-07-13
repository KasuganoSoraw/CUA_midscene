# Execution

该目录是 CUA 项目的执行域，负责把 record 产物转换为任务 flow，处理校准和参数化调用，并通过当前 Midscene computer use 执行器完成电脑操作。转换时优先消费 trace 中的 `operation.prompt`；对于 input 操作，还会消费 `operation.locatePrompt` 作为输入框定位 prompt。

这里不使用 browser-use、Playwright、Puppeteer 或 CDP。后续面向堡垒机、远程桌面和企业内网页系统的执行能力，都应围绕 Midscene computer use 展开。

## 环境配置

安装依赖：

```bash
npm install
```

从 `.env.example` 复制 `.env.local` 并填写本地密钥。`.env.local` 不提交到 git。

当前实验使用火山 Ark OpenAI 兼容接口：

- `MIDSCENE_MODEL_BASE_URL=https://ark.cn-beijing.volces.com/api/coding/v3`
- `MIDSCENE_MODEL_NAME=minimax-m3`
- `MIDSCENE_MODEL_FAMILY=doubao-vision`

Midscene computer use 需要可用于屏幕理解的视觉模型 family。如果实际模型不具备视觉能力，执行阶段会在定位或视觉动作上失败。

## 项目产物目录

`projects/<project-name>/` 保存具体业务流程的产物。当前样例是 `projects/air-tickets-demo/`。

```text
projects/<project-name>/
  source/                    # ShowUI-Aloha trace、processed log、截图
  ir/midscene-flow.json      # converter 自动生成的基础 IR
  config/project.json        # 任务说明、输入定义和录制默认值
  config/flow-overrides.json # 已确认校准
  calibration/proposals/     # Agent 待确认建议
  calibration/history/       # 已应用建议历史
  generated/                 # 后续生成的脚本产物
  reports/                   # 执行报告和 resolved flow 快照
```

生产代码按通用 flow 能力与具体 executors 分开组织：

- `src/flow/contracts/`：Midscene flow 和任务包 JSON 契约。
- `src/flow/conversion/`：ShowUI-Aloha trace 到基础 IR 的转换。
- `src/flow/task/`：项目发现、参数解析、校准和 resolved flow 构建。
- `src/executors/`：Midscene runner 与 `KeyboardTypeText` action；未来其他执行器也归入该执行域。
- `tests/flow/`：contracts、conversion 和 task 相关测试。
- `tests/executors/`：执行器相关测试。
- `src/env.ts`、`src/check-env.ts`：本地环境检查。

## 常用命令

检查环境：

```bash
npm run check
```

将样例 ShowUI-Aloha trace 转换为 Midscene flow：

```bash
npm run flow:convert -- --project air-tickets-demo --goal "将 Qatar Airways 订票页面设置为 Singapore 到 Los Angeles 的单程航班搜索"
```

执行样例 Midscene flow：

```bash
npm run flow:run -- --project air-tickets-demo
```

发现、验证和检查任务：

```bash
npm run project:list -- --json
npm run flow:validate -- --project air-tickets-demo
npm run flow:inspect -- --project air-tickets-demo
npm run flow:inspect -- --project air-tickets-demo --input step-002-value="GOOGLE"
```

`--input` 可以重复，也可以使用 `--inputs <json-file>`。未传入的 input 使用 `config/project.json` 中的默认值。

校准建议必须先验证、由用户确认，再应用：

```bash
npm run calibration:validate -- --project air-tickets-demo --proposal <proposal-id>
npm run calibration:apply -- --project air-tickets-demo --proposal <proposal-id> --confirmed
```

resolver 只应用 `config/flow-overrides.json` 中已经确认的校准，不读取待确认 proposal。基础 IR、校准和本次输入按固定顺序合并，全程不调用模型。runner 在实际初始化 Midscene 前把 resolved flow 写入 `reports/<run-id>/resolved-flow.json`。

新项目沿用同一套命令体系，只替换项目名和目标：

```bash
npm run flow:convert -- --project <project-name> --goal "<目标描述>"
npm run flow:run -- --project <project-name>
```

注意：`flow:run` 是执行命令，不是 trace 转换命令。trace 到 `midscene-flow.json` 的转换命令是 `flow:convert`。

当前样例 flow 会保留 trace 中的 `operation.prompt`。对于文本输入，trace 还必须提供只描述输入框目标的 `operation.locatePrompt`，converter 会把它写入 input route。真正无法映射为可执行策略的步骤会被标记为 `manual-review` 并 fail fast。

converter 会根据 `processed-log-sc.json` 中相邻动作的 `timestamp` 生成 `timing.waitBeforeMs`，runner 在执行每个 step 前按该时间做确定性等待。当前等待时间会忽略极短间隔，并将长间隔最多截断为 30 秒，避免把录制中的异常长停顿完整带入执行。runner 不再在定位失败后默认调用 `aiWaitFor` 重试；`aiWaitFor` 只应来自显式 `wait` route 或后续明确标记的页面跳转场景。

文本输入的执行方式：

- `input` route 不调用 Midscene 内置 `aiInput`，因为该能力在 computer use 底层可能依赖剪贴板粘贴。
- runner 会调用自定义 `KeyboardTypeText` action，并把 route 的 `locatePrompt` 传给该 action 的 `locate` 字段复用 Midscene 定位管线。
- `KeyboardTypeText` 当前只承诺 ASCII 键盘输入；遇到中文或未支持字符会直接失败，不做剪贴板兜底。

验证键盘输入映射：

```bash
npm run test:keyboard-type
```
