# ShowUI-Aloha Learn

本目录保留 ShowUI-Aloha 中与教学录制处理相关的 Learn 能力，用于把录制资源转换为结构化操作日志和 trace。

在当前 CUA 项目中，ShowUI-Aloha 不作为最终执行器，也不承担回放流程。主执行器是 `../CUA_midscene` 中的 Midscene computer use。

## 当前保留的能力

- 读取录制产生的视频和输入日志。
- 解析鼠标、键盘、窗口切换等原始事件。
- 从录制视频中抽取关键截图和局部 crop。
- 调用 OpenAI 兼容接口生成语义化 trace，并为每一步输出面向 Midscene 的最小 `operation` 动作结构。

## 已移除的能力

原上游项目中的 `Aloha_Act`、Actor、Executor、回放入口和执行演示视频已从本仓库删除。

后续如果需要执行 trace，应先把 Learn 阶段产物转换为 Midscene flow IR，再交由 `CUA_midscene` 的通用 runner 执行。

## 环境配置

复制环境变量示例：

```powershell
Copy-Item .env.example .env
```

`.env` 中配置 OpenAI 兼容接口：

```text
OPENAI_BASE_URL=https://ark.cn-beijing.volces.com/api/coding/v3
OPENAI_MODEL=minimax-m3
OPENAI_API_KEY=replace-me
ALOHA_TRACE_TEMPERATURE=0.2
```

真实 `.env` 不会提交到 git。

## 运行 Learn 流程

安装依赖：

```powershell
uv sync
```

基于示例录制生成结构化日志和 trace：

```powershell
uv run python Aloha_Learn\parser.py Aloha_Learn\projects\air_tickets
```

生成物会落在对应 project 目录下，主要包括：

- `{project}_processed_log.json`
- `{project}_processed_log_sc.json`
- `{project}_trace.json`

这些产物当前用于分析和后续转换实验，不作为最终执行入口。其中 trace 会包含面向 Midscene 的最小 `operation` 动作结构，后续由 `CUA_midscene` 转换为 `midscene-flow.json`。
