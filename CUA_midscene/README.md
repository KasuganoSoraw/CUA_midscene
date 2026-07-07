# CUA Midscene

该目录是 CUA 项目的主执行器与转换工具目录，负责把 ShowUI-Aloha Learn 产物转换为 Midscene flow，并通过 Midscene computer use 执行。

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
  source/      # ShowUI-Aloha trace、processed log、截图
  ir/          # Midscene flow IR，例如 midscene-flow.json
  generated/   # 后续生成的 run.ts 等脚本产物
  reports/     # 执行报告或报告引用
```

`src/` 保存工具链代码，当前主要包括：

- `src/flow/types.ts`：Midscene flow IR 类型定义。
- `src/flow/convert-showui-trace.ts`：将 ShowUI-Aloha trace 转换为 `midscene-flow.json`。
- `src/flow/run-midscene-flow.ts`：读取 `midscene-flow.json` 并通过 Midscene computer use 执行。
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

新项目沿用同一套命令体系，只替换项目名和目标：

```bash
npm run flow:convert -- --project <project-name> --goal "<目标描述>"
npm run flow:run -- --project <project-name>
```

注意：`flow:run` 是执行命令，不是 trace 转换命令。trace 到 `midscene-flow.json` 的转换命令是 `flow:convert`。

当前样例 flow 中存在 `manual-review` 步骤，runner 会在执行前 fail fast。这是预期行为：不明确的录制动作不能被静默转换为实际桌面操作。
