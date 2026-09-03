# Record

本目录提供 `cua-record` Python 包，用于把录制资源转换为结构化操作日志和 trace。

ShowUI-Aloha 不承担任务执行或回放；Computer-Use Runtime 位于 `../execution`，执行底座是 Midscene computer use。

## 能力

- 读取录制产生的视频和输入日志。
- 解析鼠标、键盘、窗口切换等原始事件。
- 从录制视频中抽取关键截图；click/doubleClick 同时生成 `256×256` 带红叉 trace crop 和 `96×96` 无标注 PNG reference patch。
- 调用 OpenAI 兼容接口生成语义化 trace，并为每一步输出面向 Midscene 的最小 `operation` 动作结构；`LDoubleClick` 录制事件生成 `doubleClick`，input 操作需要同时输出完整动作 `prompt` 和只用于定位输入框的 `locatePrompt`。
- trace 生成 prompt 会约束 `operation.prompt` 按“目标视觉特征 + 所在区域 + 相对锚点 + 动作意图”组织，以提升弱视觉模型下 Midscene computer use 的定位稳定性。对于红叉下方目标本体是无可见文字标签的紧凑纯图标或符号控件，模型必须额外输出 `useReferenceImage: true`；带文字按钮、链接、列表项及带相邻文字标签的单选框/复选框不自动启用。不得为其他动作设置该字段，也不得让模型生成图片路径。

本目录不包含 Act、Actor、Executor、回放入口或执行演示视频。

从 `execution` 使用 `task create-from-recording` 创建可执行任务。该命令通过宿主 Python 调用 `cua_record`，将生成资产规范化到 `<CUA_DATA_ROOT>/projects/<scene>/<task>/source/`，再生成并验证 `task.yaml` 和 `task.json`。Python CUA Subagent 的私有 Tool 不提供任务创建能力；该命令面向开发者、Review 和维护型 CLI 调用方。

## 环境配置

完整变量契约位于仓库根 `.env.example`。源码开发将其复制为根 `.env.local`，独立运行 record 时通过 `uv --env-file` 注入：

```powershell
Copy-Item ..\.env.example ..\.env.local
uv run --locked --env-file ..\.env.local python -m cua_record process C:\path\to\recording
```

需要提供以下 OpenAI 兼容接口配置：

```text
OPENAI_BASE_URL=https://ark.cn-beijing.volces.com/api/coding/v3
OPENAI_MODEL=minimax-m3
OPENAI_API_KEY=replace-me
ALOHA_TRACE_TEMPERATURE=0.2
```

`OPENAI_BASE_URL`、`OPENAI_MODEL` 和 `OPENAI_API_KEY` 未设置时回退到对应 `MIDSCENE_MODEL_*`。`cua_record` 本身不查找环境文件；Review/Runtime 和产品 Host 均通过进程环境注入。真实密钥只放在被忽略的根 `.env.local` 或 Host 密钥管理中。

## 运行 Learn 流程

安装依赖：

```powershell
uv sync --locked
```

基于示例录制生成结构化日志和 trace：

```powershell
uv run --locked --env-file ..\.env.local python -m cua_record process C:\path\to\recording
```

processor 接收一个录制目录，生成 trace 时不接收业务 goal，避免高层目标干扰逐步视觉证据判断。该 Python 命令用于独立调试 record；开发者、Review 和维护型调用方通过 execution 的单一创建命令生成可执行任务。execution 的可选 `--goal` 只在 trace 生成后写入任务描述。

生成物会落在对应 project 目录下，主要包括：

- `{project}_processed_log.json`
- `{project}_processed_log_sc.json`
- `{project}_trace.json`

点击类步骤的 processed log 还会记录 `screenshot_reference`，指向 `screenshots/*.reference.png`。带红叉 crop 供 trace 模型理解点击点；干净 reference patch 保留目标真实外观，供 Midscene 图片 prompt 使用。两者不能互相替代。

这些产物用于分析和任务初始化，不作为执行入口。trace 包含面向 Midscene 的最小 `operation` 动作结构，由 `execution` 据此初始化任务根目录的 `task.yaml` 和 `task.json`。对于双击操作，trace 使用 `operation.type=doubleClick`；对于 input 操作，`operation.prompt` 表示完整输入动作，`operation.locatePrompt` 表示目标输入框，两者不能混用。

包内的 `resources/default_prompt.json` 要求模型为 Midscene prompt 提供足量定位信息：目标视觉特征、所在区域、相对锚点和动作意图。对于列表项、下拉候选、表格行、多个相似输入框等场景，prompt 应明确可见文本、所在容器和相对位置。

视觉参考不是默认点击策略。模型只判断是否需要视觉参考，`execution` 转换器再按步骤从 processed log 确定性绑定 reference patch；请求参考图但资产无效时转换失败，不回退为纯文字点击。
