# CUA Agent

无状态的 Computer-Use Subagent，每次接收一个完整任务，在一次 invocation 内完成模型 Tool Calling、录制任务发现和执行策略选择。模型使用的定位与行为说明位于 `src/cua_agent/definition/`，作为包内资源发布。

宿主调用 Python `CuaAgent.invoke(..., event_sink=..., cancelled=...)`，或通过 `python -m cua_agent invoke` 提交一次 stdin JSON 请求。进程 stdout 输出事件和最终结果 JSONL，stderr 输出诊断；stdin 不接收第二次请求或取消 frame。

内部 `cua_catalog`、`cua_execute`、`cua_workbench` 通过 TypeScript Runtime bridge 实现，不由宿主注册。GUI 执行交给 Runtime，本包不保存跨调用 Session 或长期记忆。执行期间支持通过 Python API 的取消检查关闭当前 Runtime worker。

模型及 Runtime executable 路径由宿主注入。依赖只在安装或构建阶段准备，不在 invocation 中安装或重新解析。组件构建、调用环境和交付边界见 [集成说明](../README.md)。

模型 URL 和名称可通过 `CUA_AGENT_MODEL_BASE_URL`、`CUA_AGENT_MODEL_NAME` 指定；未设置时读取相应 `MIDSCENE_MODEL_*`。`CUA_AGENT_MODEL_API_KEY` 可为空，显式设为空值时不发送 Bearer Authorization。`CUA_AGENT_MODEL_HEADERS` 接受 JSON object 格式的自定义 HTTP 请求头，可覆盖同名默认头。

设置 `CUA_AGENT_FREEFORM_ONLY=true` 后，Agent 仅提供 `cua_execute` 的 `freeform` 策略，接收完整自然语言目标和可选屏幕标识；录制任务发现、`replay`、`guided` 和工作台 Tool 不可用，调用入口也会拒绝这些操作。自然语言执行仍保留运行结果和执行报告。未设置或设为 `false` 时提供完整能力。

Python API 使用 `CuaAgent(..., freeform_only=True)`，读取对应能力说明使用 `load_agent_definition(freeform_only=True)`。GDEClaw 应向 Agent 进程注入该变量，并隐藏产品侧的录制工作台入口。本开关不禁用独立启动的 Review/CLI，也不删除已有任务资产。

`cua_execute` 失败时，`reply` 提供简明结果说明，原始错误保存在最终结果和 Tool Trace 的 `error` 中。有可用报告时，本地 HTML 文件绝对路径同时出现在 `reply`、`data.reportPath`、失败 Tool Trace 的 `output.reportPath`、`tool.completed.data.output.reportPath` 和 `failed.data.reportPath` 中；没有可用报告时不返回路径。失败不会触发自动重试或策略切换。
