# 执行专用 SubAgent 与 Workbench 宿主入口

## 职责与配置

GDEClaw Main Agent 选择原生 Skill 并向 CUA 提交完整任务。CUA 执行专用 SubAgent 不发现或重新选择 Skill，不提供录制助手、任务生成或 Workbench 对话入口。Workbench 的录制、生成、复核、参数化与人工调试能力由宿主设置入口使用，服务生命周期由 Keeper 管理。

| 配置 | 模型可见工具 | 策略 |
| --- | --- | --- |
| `tool_mode="execute"`，默认 | `cua_execute` | replay、guided、freeform |
| `tool_mode="discover"`，独立调用方显式启用 | `cua_catalog`、`cua_execute` | replay、guided、freeform |
| `freeform_only=True`，任意工具模式 | `cua_execute` | 仅 freeform |

任何配置均不提供 `cua_workbench` 模型 Tool，未知 Tool 在注册表被拒绝，不到达 Runtime。`freeform_only=True` 不接受结构化绑定，不能用作支持结构化任务的执行专用配置。独立调用方需要模型发现任务时，须显式使用 discover 配置。

Python API 使用 `load_agent_definition(tool_mode="execute")` 和 `CuaAgent(model_client, runtime_client_factory, tool_mode="execute")`。显式 tool_mode 优先于 `CUA_AGENT_TOOL_MODE`，后者缺省为 execute。GDEClaw 单次进程入口注入：

```text
CUA_AGENT_TOOL_MODE=execute
CUA_AGENT_FREEFORM_ONLY=false
```

Catalog Runtime Bridge、CLI、任务解析与 Workbench 不受模型工具模式限制。各 invocation 独立，不保留用户对话或此前的任务绑定。

## 两类执行请求

`InvocationRequest.task` 始终是非空完整任务描述。可选 `execution` 复用同一个 `cua_execute` 的参数形态，不是第二个执行 Tool。Python API 使用 `InvocationRequest(task=..., execution=...)`；JSON/JSONL 使用同名字段。宿主必须使用支持 execution 绑定的组件版本，不应将该字段发送给不支持它的旧组件。

GDEClaw 适配层需要从已经选定的 Skill 构造 execution；不能只把任务名称或结构化信息拼接进 task 文本，再期待 SubAgent 自行找出任务。此适配属于宿主私有仓，本次只提供 CUA 请求契约及转发能力。

### 结构化任务

```json
{
  "task":"执行已选定的告警查询任务，查询设备 device-1",
  "invocationId":"run-1",
  "execution":{
    "strategy":"replay",
    "scene":"ems",
    "task":"query-alarm",
    "inputs":{"step-003-input":"device-1"}
  }
}
```

strategy 必须明确为 replay 或 guided；适用的默认策略由宿主选定后显式传入，不由 SubAgent 猜测。scene/task 是已配置项目目录中的单层目录标识，不是路径。inputs 为字符串键和值的对象，无参数任务可省略 inputs。

Main Agent 提供全部业务输入；SubAgent 不调用 Catalog 来补选任务。底层解析器继续验证真实任务和输入定义。明确绑定会将本次工具集限制为 execute，即使调用方选择了 discover 配置，也不再发现其他任务。

模型调用与宿主绑定比较。任务、场景、策略、输入、目标或显示器不一致，或传入额外字段，均在 Runtime 调用前失败；仅将省略的结构化 inputs 与空对象视为相同。无效绑定属于调用契约错误，缺少必要业务信息可以返回 needs-input；Runtime 失败保持原始诊断及报告规则，不切换任务或策略重试。

### 自由电脑操作

```json
{"task":"打开系统并导出本月销售报表","invocationId":"run-2"}
```

执行专用模式将其绑定为 `{"strategy":"freeform","goal":"打开系统并导出本月销售报表"}`，直接走现有 aiAct / Midscene 自适应执行，不检索任务，不要求用户选择策略。明确屏幕时使用同一契约：

```json
{
  "task":"在指定屏幕打开系统",
  "execution":{"strategy":"freeform","goal":"打开系统","displayId":"display-0"}
}
```

execution 只接受现有模型执行字段，不接受 dataRoot、skillRoot、任意绝对路径、Skill ID 或未经支持的绑定字段。数据根由可信宿主进程配置或 `CuaAgent(data_root=...)` 提供。

执行成功后只进行无 Tool 的终态回复，不执行同一响应中剩余的 Tool；终态回复再次发起 Tool 时拒绝，不产生重复 GUI 操作。执行报告路径原样返回，其他运行路径保留在结构化诊断中。

## 非模型 Workbench 宿主路径

调用链：GDEClaw 设置按钮 → Keeper 持有的 Runtime worker → `method=workbench` → `cuaWorkbench()` → `startReviewServer()`。不经过 Agent invocation、模型客户端或 Python Tool Registry。

```json
{
  "schemaVersion":"1.0",
  "requestId":"settings-workbench-1",
  "method":"workbench",
  "payload":{"mode":"review","dataRoot":"D:\\cua-data"}
}
```

成功响应 result：

```json
{
  "mode":"review",
  "baseUrl":"http://127.0.0.1:47831/",
  "url":"http://127.0.0.1:47831/?mode=review",
  "reused":false
}
```

mode 可为 recording、review、execution；review/execution 可包含 scene/task，提供 task 时同时提供 scene。相同数据根的服务可复用，不同数据根或其他程序占用端口时显式失败。

Python 宿主直接使用已有 `JsonlRuntimeClient.request("workbench", payload)`；Node 宿主可直接调用导出的 `cuaWorkbench()`。Keeper 保持 Runtime worker 存活，不能在设置请求返回后立即关闭 worker。返回 URL 由 GDEClaw 前端或其现有机制打开，CUA 不默认启动系统浏览器。Runtime 的 `cuaRuntimeToolNames` 是底层能力名，不是模型 Tool Schema 清单。

## Skill 目录限制与最小后续接口

当前解析路径仍为 `<CUA_DATA_ROOT>/projects/<scene>/<task>`。未实现从 GDEClaw Skill 目录读取、识别或直接执行任务，不扫描整个 Skill 目录，不写入 skill.json，也不参与 Skill 注册、启用、签名或版本管理。

后续最小接口是宿主到 CUA 的可信绑定解析边界，不是模型文件路径参数：

1. 宿主传入可信 Skill 标识、版本或任务绑定标识；字段须在单独版本化契约中定义，当前 execution 不接受这些字段。
2. 宿主适配层按配置的受信根解析资产，只接受带明确 CUA 标记的任务清单，验证标记、版本、目录边界和必需资产。普通 Skill 不进入 CUA Catalog。
3. 返回执行策略、任务身份、输入定义和只读资产句柄，交给现有解析器；输入验证、YAML/Trace 兼容与报告继续使用现有执行链。
4. 补充无标记、伪造标记、路径穿越、符号链接越界、版本不匹配、缺失资产、输入不足及执行成功/失败测试，再单独声明支持 Skill 目录执行。

## 验证边界

自动化覆盖工具集合、freeform_only 兼容语义、两类执行绑定、拒绝篡改与未知路径字段、成功终态停止，以及宿主无需模型启动和复用真实本地 Review Server。Workbench、录制、复核和执行使用现有回归测试。

测试采用脚本化模型和隔离数据根，不代表已验证真实模型、真实桌面业务或 GDEClaw 私有仓适配。Skill 目录解析及其信任标记需要独立实施。
