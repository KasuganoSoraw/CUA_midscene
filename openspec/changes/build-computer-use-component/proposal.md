## Why

Computer-Use 当前的录制处理与录制器启动仍依赖源码目录、`uv` 和开发环境，无法作为稳定组件由 GDEClaw 或其他宿主装配。项目需要一个不携带解释器、能够脱离源码验证、并明确运行时注入边界的发行形态。

## What Changes

- 将 `record` 转换为可安装的 `cua_record` Python 包，并提供稳定的模块入口。
- 让 Recorder 与 Record Worker 使用宿主提供的 Python executable 启动，不在产品运行路径执行依赖解析、安装或 lock。
- 定义宿主注入的 Python、JavaScript、组件根和数据根运行时契约。
- 增加 Computer-Use Component 构建流程，产出 Python wheels、编译后的 JavaScript Runtime、生产依赖和组件 manifest。
- 增加脱离源码目录的组件结构校验与 smoke test，确保运行不依赖 `uv`、`npm`、`tsx` 或开发目录。
- 保留 Review `--dev` 使用的 Python Agent 子进程入口；该入口不属于 GDEClaw 产品执行链。

## Capabilities

### New Capabilities

- `computer-use-component-distribution`: 定义可由宿主装配的 Computer-Use Component 目录、manifest、运行时注入契约和脱离源码验证要求。

### Modified Capabilities

- `recording-task-creation`: 将录制解析从源码目录中的 `uv run` 调用改为使用宿主 Python 执行已安装的 `cua_record` 模块。
- `windows-recorder`: 将 Windows Recorder 从源码根与 `uv` 启动改为使用宿主 Python 执行已安装的 `cua_recorder` 模块。
- `cua-runtime-bridge`: 将 JavaScript Runtime executable、环境和组件根作为显式宿主配置，并允许 Node 或兼容的 Electron-as-Node Runtime。

## Impact

- Python：`record/` 的包结构、模块入口和资源定位；Recorder/Record Worker 的启动方式。
- TypeScript：Review/Workbench Python Worker launcher、Runtime 配置与产品态路径解析。
- 构建：新增组件 staging、manifest 生成、生产 npm 依赖收集、wheel 构建和 clean-room 校验。
- 集成：GDEClaw 安装 Python wheels、复制 JavaScript Runtime，并注入宿主 executable 与产品路径；CUA 不读取 GDEClaw 专用目录或设置。
