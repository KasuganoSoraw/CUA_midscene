# 普通录制与 GDEClaw 集成

## 能力边界

普通模式从聊天接收完整自然语言任务。执行请求直接交给 Midscene freeform，不检索 CUA 专业任务；示教请求调用 `cua_record`，返回整理好的日志和截图。主 Agent 读取资产、生成并保存正式 Skill。CUA 不生成 SkillDraft、SKILL.md、普通 Skill 管理目录或 YAML Task。

专业模式保留专业项目检索、replay、guided、freeform 以及完整的 Trace/YAML 生成流程。工作台由设置页打开，模型工具列表中不存在 `cua_workbench`；内部 Runtime bridge 的 `workbench` 方法仍供 Keeper 使用。

| 模式 | 模型可见工具 |
| --- | --- |
| `normal` | `cua_execute`（仅 freeform）、`cua_record` |
| `professional` | `cua_catalog`、`cua_execute`（replay/guided/freeform） |

## 宿主配置与调用

宿主先通过应用级 Keeper 启动或复用 Review Service，不打开网页。服务绑定 loopback；`CUA_REVIEW_URL` 指向其根地址，默认 `http://127.0.0.1:47831/`。录制 Tool 会检查服务身份、协议版本和 `CUA_DATA_ROOT`；未启动或不匹配时显式失败，不自行创建第二套服务或录制器。

进程入口注入：

```text
CUA_AGENT_TOOL_MODE=normal
CUA_REVIEW_URL=http://127.0.0.1:47831/
CUA_RECORDINGS_ROOT=C:\Users\user\.gdeclaw\computer_use\recordings
CUA_DATA_ROOT=C:\Users\user\.gdeclaw\computer_use\data
CUA_PYTHON_EXECUTABLE=C:\path\to\component-python.exe
```

录制根目录必须存在且可写。统一 Python 环境须安装三个组件包及其依赖。模型、Runtime executable 和 bridge 路径沿用组件配置。进程入口仍只接收一次 `{"task":"录制一个查询配置的流程"}` 请求。

Python API：

```python
from cua_agent import CuaAgent, InvocationRequest, load_agent_definition

definition = load_agent_definition(tool_mode="normal")
agent = CuaAgent(model_client, runtime_client_factory, tool_mode="normal")
result = await agent.invoke(
    InvocationRequest(task="录制一个查询配置的流程"),
    event_sink=forward_event,
    cancelled=is_invocation_cancelled,
)
```

API 与 CLI 共用能力配置：显式 `tool_mode` 优先，其次显式兼容参数 `freeform_only`，再读取 `CUA_AGENT_TOOL_MODE`，最后读取 `CUA_AGENT_FREEFORM_ONLY`。兼容值 `true` 表示 normal、`false` 表示 professional；全部省略时为 professional。显式参数不被环境变量覆盖。专业任务调用使用 `tool_mode="professional"`。

Main Agent 将录制意图路由到普通 computer-use SubAgent；执行已有普通 Skill 时，把完整自然语言流程作为 task 派发，而不是只传 Skill 名称。主 Agent 使用自身的文件和图片读取工具访问返回资产，并交给自身 SkillService 保存。不要注册 CUA 私有工具到 Main Agent。

## `cua_record` 契约

唯一模型参数：

```json
{"goal":"录制一个查询网元 QoS 配置的操作流程"}
```

不接受 scene、task、displayId。默认主屏幕，只启动悬浮条，不打开工作台页面。一次调用等待用户完成或放弃，期间不运行模型轮询。完成后自动执行 prepare。

Tool 成功结果及 `InvocationResult.data`：

```json
{
  "status": "completed",
  "message": "录制已完成，操作记录与截图已准备好",
  "recordingId": "Recording_20261022_103000",
  "assets": {
    "recordingRoot": "C:\\recordings\\Recording_20261022_103000",
    "processedLogPath": "C:\\recordings\\Recording_20261022_103000\\Recording_20261022_103000_processed_log_sc.json",
    "screenshotsDir": "C:\\recordings\\Recording_20261022_103000\\screenshots",
    "stepCount": 24,
    "timingsMs": {"log": 20, "screenshots": 800, "total": 850}
  },
  "timingsMs": {"receivedToPrepare": 10}
}
```

上述耗时是字段示例，不是性能承诺。`receivedToPrepare` 从 Worker 发布完成事件到调用 prepare，包含等待 Worker 关闭的时间；其他阶段分别统计日志整理、截图提取和含校验的 prepare 总耗时。

用户放弃的结果：

```json
{
  "status": "cancelled",
  "message": "用户取消了录制，本次未生成操作资产",
  "assets": null,
  "reason": "user_aborted"
}
```

未开始录制时取消的 reason 为 `user_cancelled`。以上两种情况下 invocation 正常完成，`InvocationResult.status="completed"`，用 `data.status="cancelled"` 表示用户决定不生成资产，不重新录制。

录制器、预处理或传输失败时：

```json
{
  "status": "failed",
  "message": "录制处理失败，未生成完整操作资产",
  "assets": null,
  "error": "实际诊断原因"
}
```

此时 invocation 为 failed，原始错误保存在结构化诊断。终态及资产路径直接来自 Tool，不经过模型改写；完成或取消后不再调用执行工具，也不再调用模型生成录制总结。返回路径指向同机持久录制目录，不返回截图 Base64 或专业任务 source 临时目录。

## `prepare` 命令

```powershell
python -m cua_record prepare C:\recordings\Recording_20261022_103000
```

输入目录包含 `inputs/`、一个原始日志和对应 MP4。输出：

```text
Recording_xxx/
  inputs/Recording_xxx.mp4
  inputs/Recording_xxx.txt
  Recording_xxx_processed_log.json
  Recording_xxx_processed_log_sc.json
  screenshots/
```

处理复用 LogProcessor 和 VideoScreenshotExtractor，保留当前操作顺序、时间、输入、窗口和截图字段，图片引用相对录制根目录。必需截图存在性、非空和目录边界均须通过校验。stdout 只返回 `{"event":"prepared","assets":{...}}`；阶段信息和诊断位于 stderr。失败退出非零，不返回成功资产清单。失败时原始录制可供诊断；取消录制则不发布正式视频和日志，并移除本次录制目录。

`python -m cua_record process <directory>` 复用 prepare 后继续生成 Trace；专业 Workbench 的完整创建流程继续使用 process。

## 生命周期与取消

```text
应用级 Keeper
  └─ Review Service
       └─ 唯一 Recorder Manager → Python Recorder / 悬浮条

单次 Python CuaAgent
  └─ 单次 Runtime Worker
       └─ HTTP 录制请求 → 同一个 Review Service
```

Review Service 拥有录制和预处理进程。Tool 仅持有 HTTP 等待连接，不创建 Recorder Manager。Recorder Manager 按本次内部会话标识保存终态；晚到的等待者不会拿到其他录制的结果，旧标识取消不会停止新录制。最近 16 次终态暂存在服务内存，不构成持久任务调度系统。已有专业录制或普通录制时不抢占。

录制 Runtime 请求不受默认 GUI 执行的 1800 秒绝对超时限制；其他请求仍保持超时。HTTP 每 15 秒发送传输心跳，不触发 Agent 事件或模型调用。Review 开发入口观察到录制 Tool 启动后停止其普通 invocation 绝对计时。GDEClaw 适配层也须允许录制期间长时间等待，不要用常规 GUI 时限终止示教。

悬浮条“完成”沿用 stop/热键的保存语义；“放弃”使用 abort，清理本次文件。重复按钮操作及完成/放弃竞态仅消费第一个终止信号。

Host 点击停止应设置 invocation 取消检查或取消其 asyncio Task。Python Client 关闭短生命周期 Worker 的 stdin；Worker 中止 HTTP 等待并向服务确认取消当前内部会话。服务停止 Recorder 和预处理进程、关闭悬浮条，不关闭 Keeper。录制请求提供最多 30 秒的 Worker 退出清理窗口；服务停止 Recorder 的默认上限是 20 秒。连接异常中断同样触发本次取消。宿主必须保留事件传递和取消检查，不应仅把 Main Agent 界面标为停止。

Host 主动取消的 invocation 状态为 `cancelled`，与用户在悬浮条放弃后正常返回的 `data.status="cancelled"` 不同。

## 进度事件

宿主通过现有 EventSink 接收 `recording.progress`，示例：

```json
{
  "schemaVersion": "1.0",
  "invocationId": "inv-1",
  "type": "recording.progress",
  "timestamp": "2026-10-22T02:30:00+00:00",
  "message": "正在提取步骤截图",
  "data": {"callId":"record-1","tool":"cua_record","turn":1,"source":"recorder","phase":"extracting"}
}
```

phase 可为 `armed`、`recording`、`received`、`processing`、`extracting`、`completed`、`cancelled`、`failed`。阶段消息来自录制器和处理器，不调用模型。保留现有 execution.progress；录制终态以最终 InvocationResult 为准，不仅依靠进度文案。

## 源码职责

| 模块 | 职责 |
| --- | --- |
| `record/src/cua_record/prepare.py`、`pipeline.py`、`cli.py` | 共用日志整理和截图提取，分别提供 prepare 与完整 process |
| `recorder/src/cua_recorder/session.py`、`overlay.py`、`overlay_win32.py` | 完成/放弃信号、临时文件清理、录制中放弃图标 |
| `execution/review/service/windows-recorder.ts` | 共享 Recorder、按会话保存终态、等待进程资源释放 |
| `execution/review/service/conversation-recording.ts`、`prepare-recording.ts` | 普通录制编排、预处理进程、资产校验 |
| `execution/review/server/recording-routes.ts`、`runtime-bridge/tools/record.ts` | 本地流式等待、心跳及本次录制取消确认 |
| `agent/src/cua_agent/capabilities.py`、`tools/registry.py`、`definition/` | 普通/专业权限和模型说明，不暴露工作台工具 |
| `agent/src/cua_agent/runtime_client.py`、`execution/runtime-bridge/worker-service.ts` | 录制等待策略、事件解析和 stdin 关闭的取消传递 |
| `agent/src/cua_agent/runner.py` | 录制终态直接返回 InvocationResult.data，不额外调用模型 |

## 集成验收

- Keeper 更新到当前协议版本，并在无工作台页面时保持服务可用。
- 正常完成后主 Agent 能读到真实日志和截图，并自行生成正式 Skill。
- 等待开始、录制中和预处理中停止 SubAgent 均释放资源；专业工作台服务仍可使用。
- 专业任务检索和完整 Trace/YAML 创建不受普通模式影响。
- Windows 实机核对开始、完成、放弃、热键、拖动和录屏排除；真实 GDEClaw 验证事件 Adapter、文件访问权限及设置页入口。

自动化性能验证使用本地编码视频和原始事件日志，不调用模型。完整 process 的模型服务不可用时，只报告实际执行的日志、抽帧和校验耗时，不推算模型生成耗时或业务场景加速比例。
