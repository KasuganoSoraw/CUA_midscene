# CUA Agent

无状态的 Computer-Use Subagent，每次接收一个完整任务，在一次 invocation 内完成模型 Tool Calling、录制任务发现和执行策略选择。模型使用的定位与行为说明位于 `src/cua_agent/definition/`，作为包内资源发布。

宿主调用 Python `CuaAgent.invoke(..., event_sink=..., cancelled=...)`，或通过 `python -m cua_agent invoke` 提交一次 stdin JSON 请求。进程 stdout 输出事件和最终结果 JSONL，stderr 输出诊断；stdin 不接收第二次请求或取消 frame。

内部 `cua_catalog`、`cua_execute`、`cua_workbench` 通过 TypeScript Runtime bridge 实现，不由宿主注册。GUI 执行交给 Runtime，本包不保存跨调用 Session 或长期记忆。执行期间支持通过 Python API 的取消检查关闭当前 Runtime worker。

模型及 Runtime executable 路径由宿主注入。依赖只在安装或构建阶段准备，不在 invocation 中安装或重新解析。组件构建、调用环境和交付边界见 [集成说明](../README.md)。
