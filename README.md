# CUA 集成源码

本分支是 Computer-Use Component 的源码交付边界，供 GDEClaw 等宿主以 vendor snapshot 导入。包含 Python Agent、Windows 录制器、录制后处理、TypeScript Runtime 与工作台，以及组件构建和验证入口。不携带运行环境、用户数据、示例素材或完整开发测试。

## 交付范围

| 路径 | 保留内容 |
| --- | --- |
| `agent/` | `src/`（含模型 definition）、`pyproject.toml`、`uv.lock`、包 README |
| `recorder/` | `src/`、`pyproject.toml`、`uv.lock` |
| `record/` | `src/`（含默认 prompt 资源）、`pyproject.toml`、`uv.lock`、包 README、`LICENSE` |
| `execution/` | `cua/`、`cli/`、`executors/`、`runtime-bridge/`、`review/`、`schemas/`、npm 声明和 lock、TypeScript/Vite 配置 |
| `scripts/` | `__init__.py`、`build_component.py`、`component_manifest.py`、`verify_component.py`、`smoke_component.py` |
| 根目录 | `component.toml`、`CUA_VERSION`、本说明和 Git 忽略规则 |

工作台提供录制、任务复核和人工执行，也是 `cua_workbench` 的运行依赖。Python 包 README 是 wheel 构建元数据，definition Markdown 和默认 prompt JSON 是运行资源，不能按文件扩展名排除。

`main` 是 CUA 源码开发与完整测试的事实源。本分支只维护交付范围、必要构建配置和集成说明；宿主的注册、会话、事件适配和产品生命周期代码留在宿主仓，不进入 CUA 模型 prompt 或 Runtime。

## 构建与验证

构建环境需要 Python >=3.11、Node.js >=20.18.1、uv 和 npm；Windows 录制能力在 Windows 上使用。依赖版本由三个 `uv.lock` 和 `execution/package-lock.json` 固定，Host 可配置已批准的制品镜像。

从源码根执行：

```powershell
python scripts/build_component.py --output dist/computer-use-component
python scripts/verify_component.py dist/computer-use-component
python scripts/smoke_component.py dist/computer-use-component --python "C:\path\to\host-python.exe" --javascript "C:\path\to\node.exe"
```

构建脚本生成三个 Python wheels 与含生产依赖的 JavaScript Runtime，不携带 Python 或 JavaScript executable。已有输出需显式传入 `--force` 重建。smoke 使用源码仓外的临时目录验证 Python 模块、包内资源和 Runtime bridge；所选 Python 环境必须已具备三个包的运行依赖。

宿主安装组件 `python/` 中的三个 wheels 到同一个 Python 环境，完整保留 `runtime/`，再提供模型、数据目录和 executable 路径。安装/构建阶段准备依赖，执行任务时不运行包管理命令。使用 Electron executable 执行 Node worker 时，宿主需注入 `ELECTRON_RUN_AS_NODE=1`。

## 调用与配置

宿主向 Python `CuaAgent` 提交完整任务，接收通用事件和最终结果，并传入取消检查。内部 catalog、执行策略和工作台调用由 CUA Agent 决策；宿主不注册 CUA 私有工具。不保存跨 invocation 的对话上下文。

进程入口 `python -m cua_agent invoke` 从 stdin 读取一次 JSON 请求，例如 `{"task":"打开指定应用","invocationId":"task-1"}`，stdout 返回事件及最终结果 JSONL，stderr 保存诊断。Python API 支持执行期间取消；该单次 stdin 请求协议不接收取消 frame。

由 Host 注入进程环境，不交付 `.env*`：

- `CUA_AGENT_MODEL_BASE_URL/NAME/API_KEY`：任务级模型；缺省时读取对应 `MIDSCENE_MODEL_*`。
- `MIDSCENE_MODEL_BASE_URL/NAME/API_KEY/FAMILY`：桌面操作模型配置。
- `CUA_DATA_ROOT`：用户任务与运行产物的数据根。
- `CUA_RECORDINGS_ROOT`：原始录制输出及发现目录。
- `CUA_PYTHON_EXECUTABLE`：安装了三个组件包的 Python 绝对路径。
- `CUA_AGENT_JS_RUNTIME_EXECUTABLE`：宿主提供的兼容 JavaScript executable。
- `CUA_AGENT_RUNTIME_BRIDGE`：组件 `runtime/dist/runtime-bridge/worker.js` 的绝对路径。
- `CUA_AGENT_FREEFORM_ONLY=true`：仅开放自然语言执行，禁用 Agent 的录制任务发现、回放和工作台工具；未设置或为 `false` 时提供完整能力。Python API 使用 `CuaAgent(..., freeform_only=True)`，能力说明通过 `load_agent_definition(freeform_only=True)` 获取。宿主需同步隐藏产品侧的录制工作台入口；独立 Review/CLI 不受此开关限制。

真实桌面操作须由宿主串行调用。用户任务写入 `CUA_DATA_ROOT/projects`，运行产物写入 `CUA_DATA_ROOT/runs`。运行历史默认超过 5 GiB 后清理至 4 GiB，保护当前、活动和最近 24 小时的记录；可通过 `CUA_RUNS_MAX_MB`、`CUA_RUNS_TARGET_MB` 和 `CUA_RUNS_MIN_AGE_HOURS` 调整，`CUA_RUNS_MAX_MB=0` 禁用清理。

## 来源与更新

`CUA_VERSION` 记录来自 `main` 的完整提交 SHA。宿主还应记录采用的集成分支提交 SHA，以精确定位交付快照。

更新时先在 `main` 完成源码修改和完整测试，再将目标提交同步到本分支，按交付范围重新检查裁剪，更新 `CUA_VERSION`，并通过组件构建、验证和 smoke。不把完整开发测试、OpenSpec、演示资源、环境文件、依赖缓存或生成物纳入交付。

从已提交的集成分支导出源码快照：

```powershell
git archive --format=zip --output=../cua-integration.zip HEAD
```

归档仅含提交中的文件，不包含 Git 元数据或本地环境。宿主以该快照替换其受管理的 CUA vendor 目录并审查差异；导入工具属于宿主仓，不能覆盖 vendor 目录以外的宿主代码。

`record/LICENSE` 随源码保留。录制器依赖固定的 PyAV wheel；宿主的制品审批与 SBOM 需覆盖 wheel 中捆绑的 FFmpeg 等组件。
