# CUA Agent

无状态的 Computer-Use Subagent，每次接收一个完整任务，在一次 invocation 内完成模型 Tool Calling、录制任务发现和执行策略选择。模型使用的定位与行为说明位于 `src/cua_agent/definition/`，作为包内资源发布。

宿主调用 Python `CuaAgent.invoke(..., event_sink=..., cancelled=...)`，或通过 `python -m cua_agent invoke` 提交一次 stdin JSON 请求。进程 stdout 输出事件和最终结果 JSONL，stderr 输出诊断；stdin 不接收第二次请求或取消 frame。

普通和专业入口共享 `cua_catalog`、`cua_execute/replay/guided/freeform`、`cua_record`，通过 TypeScript Runtime bridge 实现，不由宿主注册。不提供 `cua_workbench` 模型工具。GUI 执行交给 Runtime，本包不保存跨调用 Session 或长期记忆。执行期间支持通过 Python API 的取消检查关闭当前 Runtime worker。

模型及 Runtime executable 路径由宿主注入。依赖只在安装或构建阶段准备，不在 invocation 中安装或重新解析。组件构建、调用环境和交付边界见 [集成说明](../README.md)。

模型 URL 和名称可通过 `CUA_AGENT_MODEL_BASE_URL`、`CUA_AGENT_MODEL_NAME` 指定；未设置时读取相应 `MIDSCENE_MODEL_*`。`CUA_AGENT_MODEL_API_KEY` 可为空，显式设为空值时不发送 Bearer Authorization。`CUA_AGENT_MODEL_HEADERS` 接受 JSON object 格式的自定义 HTTP 请求头，可覆盖同名默认头。

完整自然语言操作流程和纯业务目标直接 freeform，不主动检索；只有明确要求执行一个任务名或提供 task 标识时，才检索专业工作台任务。若只有任务名且未找到任务，应请求补充目标或流程。普通 Skill 由调用方展开完整流程后提交，不能仅传名称。自然语言执行保留运行结果和执行报告。

Python API 使用 `CuaAgent(...)`，能力说明使用 `load_agent_definition()`。兼容配置 tool_mode、freeform_only、CUA_AGENT_TOOL_MODE、CUA_AGENT_FREEFORM_ONLY 按顺序校验有效值；normal/professional 均使用统一提示词及工具集，不限制工具能力。工作台由宿主设置入口打开，不通过对话唤起。

`cua_record` 通过 Keeper 的共享 Review Service 等待用户完成或取消录制，使用 `recording.progress` 传递阶段，终态及资产原样放入 `InvocationResult.data`。Host 须保留该字段，并确保 Main Agent 的文件和图片工具能读取录制目录。录制结束不再调用模型总结路径，Skill 生成由 Main Agent 完成。服务配置、独立 invocation worker 及取消约定见 [集成说明](../README.md)。

`cua_execute` 失败时，`reply` 提供简明结果说明，原始错误保存在最终结果和 Tool Trace 的 `error` 中。有可用报告时，本地 HTML 文件绝对路径同时出现在 `reply`、`data.reportPath`、失败 Tool Trace 的 `output.reportPath`、`tool.completed.data.output.reportPath` 和 `failed.data.reportPath` 中；没有可用报告时不返回路径。失败不会触发自动重试或策略切换。
