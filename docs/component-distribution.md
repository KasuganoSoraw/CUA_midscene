# Computer-Use Component

Computer-Use Component 是供 GDEClaw 或其他 Host 安装的组件目录。它包含三个 Python wheel、编译后的 JavaScript Runtime、production `node_modules`、schemas 和 manifest；不包含内置任务、Python、Node/Electron executable、环境文件、模型配置或数据目录。正式任务在 Host 配置的 `CUA_SKILLS_ROOT` 中创建和维护，`CUA_DATA_ROOT` 保存运行产物、缓存及隔离的旧版兼容数据。

## 构建与验证

构建机需要 Python 3.11+、`uv`、npm 和 Node.js `>=20.18.1`：

```powershell
uv run --project record --locked python scripts\build_component.py --force
```

默认产物位于 `dist/computer-use-component`：

```text
computer-use-component/
├── manifest.json
├── python/
│   ├── cua_agent-*.whl
│   ├── cua_record-*.whl
│   └── cua_windows_recorder-*.whl
└── runtime/
    ├── package.json
    ├── node_modules/
    ├── dist/
    └── schemas/
```

构建脚本使用独立 staging，不会 prune 源码仓的 `node_modules`。`--output`、`--uv` 和 `--npm` 可覆盖默认路径与构建工具。

验证组件结构：

```powershell
uv run --project record --locked python scripts\verify_component.py `
  dist\computer-use-component
```

在源码仓外验证三个 Python 模块和 Runtime bridge：

```powershell
uv run --project record --locked python scripts\smoke_component.py `
  dist\computer-use-component `
  --python C:\path\to\prepared-python.exe `
  --javascript C:\path\to\node.exe `
  --timeout-seconds 60
```

Smoke test 不调用模型或操作桌面。传入的 Python 必须已经具备组件的第三方依赖。

## Host 安装

Host 安装阶段读取 `manifest.json`，将其中声明的三个 wheel 安装到同一个隔离 Python 环境，并整体复制 `runtime/`。组件不携带 Python 第三方依赖的离线 wheelhouse，安装器通过受控包源或 Host 自有依赖缓存准备这些依赖。

以下命令可用于本地验证 Host 安装流程：

```powershell
$component = (Resolve-Path dist\computer-use-component).Path
$environment = 'C:\path\to\computer-use-python'

uv venv $environment
$python = "$environment\Scripts\python.exe"
$wheels = (Get-ChildItem "$component\python\*.whl").FullName
uv pip install --python $python $wheels
```

依赖安装只发生在 Host 安装或更新阶段。Agent invocation、Recorder、Record processor 和 Runtime bridge 的产品运行路径不调用包管理器。

## 运行 Agent

Host 向 Agent 提供模型变量、可信 Skill 根、数据根、JavaScript executable 和 bridge 绝对路径：

```powershell
$env:CUA_DATA_ROOT = 'C:\path\to\cua-data'
$env:CUA_SKILLS_ROOT = 'C:\path\to\gdeclaw-skills'
$env:CUA_AGENT_TOOL_MODE = 'execute'
$env:CUA_AGENT_JS_RUNTIME_EXECUTABLE = 'C:\Program Files\nodejs\node.exe'
$env:CUA_AGENT_RUNTIME_BRIDGE = "$component\runtime\dist\runtime-bridge\worker.js"

$env:MIDSCENE_MODEL_BASE_URL = 'https://model-endpoint.example/v1'
$env:MIDSCENE_MODEL_NAME = 'vision-model'
$env:MIDSCENE_MODEL_API_KEY = 'replace-me'
$env:MIDSCENE_MODEL_FAMILY = 'doubao-vision'

'{"task":"打开 Chrome 并完成指定操作","invocationId":"local-1"}' |
  & $python -m cua_agent invoke
```

`CUA_AGENT_MODEL_*` 可为 Subagent 单独配置任务级模型；未设置时读取对应的 `MIDSCENE_MODEL_*`。stdin 只接收一个 invocation，stdout 输出事件与最终结果 JSONL，随后进程退出。

仓库根 `.env.example` 只用于源码开发。组件运行时不查找或复制环境文件，Host 通过进程环境或自身密钥管理注入全部配置。

需要启动打包后的普通 Review 时，额外设置统一 Python 并调用组件 CLI：

```powershell
$env:CUA_PYTHON_EXECUTABLE = $python
& $env:CUA_AGENT_JS_RUNTIME_EXECUTABLE `
  "$component\runtime\dist\cli\main.js" review --no-open
```

`review --dev` 是源码开发入口，不属于组件产品运行路径。

## GDEClaw 适配

GDEClaw Main Agent 选择原生 Skill，提交完整任务及可选 `execution: { skillName, inputs, strategy }` 绑定并接收事件与结果。Skill 策略缺省为 guided，明确严格回放时为 replay；没有 Skill 绑定时直接 freeform。Host Adapter 负责组件安装、用户 Session、任务取消、真实 computer use 串行化和运行时路径注入，不注册 CUA 的私有 Tool。

Agent 与 Runtime 必须整体升级到支持 `skillName` 的组件。JSONL envelope 为 1.0，Skill 资产契约由 Runtime 导出 `skillAssetContractVersion=1.0`；不能仅凭 envelope 版本判定旧组件支持 Skill 绑定。

Workbench 由设置按钮通过 Keeper 持有的 Runtime worker 调用 `workbench` 方法，返回 URL 与 reused 后由宿主前端打开；页面使用期间保持 worker 存活。正式目录、绑定与迁移契约见 [CUA Skill 集成](gdeclaw-skill-integration.md)。目录写入不代表已验证宿主的注册、启用、签名或分发。

使用兼容 Electron executable 时，Host 还需提供 Node 模式环境，例如：

```text
CUA_AGENT_JS_RUNTIME_EXECUTABLE=<GDEClaw executable>
CUA_AGENT_RUNTIME_BRIDGE=<component>/runtime/dist/runtime-bridge/worker.js
ELECTRON_RUN_AS_NODE=1
```

采用 Electron 前必须验证其内置 Node 版本和 fuse；不满足条件时使用独立 Node，无需修改组件业务代码。
