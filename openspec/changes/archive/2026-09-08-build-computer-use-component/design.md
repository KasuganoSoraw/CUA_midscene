## Context

当前 Python Agent 与 Runtime bridge 已具备清晰的高层调用边界，但 Record 与 Recorder 的 TypeScript 启动器仍依赖源码根和 `uv`。`execution` 已能生成编译产物，不过尚无统一的组件 staging、manifest 或脱离源码的产品态验证。参见 proposal.md 与本变更的 delta specs。

## Goals / Non-Goals

**Goals:**

- 形成由 CUA 构建、宿主直接消费的 Computer-Use Component。
- 让产品运行路径只依赖已准备好的 Python/JavaScript executable 与组件内容。
- 保持 CUA Agent、Runtime bridge、Recorder、Record 和任务数据协议只有一套实现。
- 通过 clean staging 证明发行物不依赖源码、开发工具或构建机路径。

**Non-Goals:**

- 不在本仓库实现 GDEClaw 的 `ComputerUseExecutor`、模型适配、Subagent 路由或产品路径探测。
- 不将 Python 或 Node/Electron executable 打入组件。
- 不删除 Review `--dev` 的 Python Agent 调试适配器。
- 不把三个 Python project 合并为单一源码包。

## Decisions

### 1. 使用“三个 wheels，一个组件”的 Python 发行结构

`agent`、`recorder` 和 `record` 分别构建 wheel，组件 manifest 将它们声明为同一能力的安装集合。这样保留各模块的依赖所有权，同时允许 GDEClaw 将全部依赖安装进同一个产品 Python 环境。

替代方案是合并成一个 Python project；该方案会放大现有目录迁移和依赖耦合，且不会改善宿主最终安装后的运行形态。

### 2. 将 Record 转换为标准 `src/cua_record` 包

现有 Aloha 处理逻辑迁入可导入包，包内资源通过 `importlib.resources` 或基于模块文件的位置解析。稳定入口为 `python -m cua_record process <recording>`；模型和证书等运行配置仅从进程环境读取，发行物不依赖项目根 `.env`。

### 3. Recorder 与 Record 共用宿主 Python Worker 启动契约

TypeScript 侧提供只描述 Python executable、module、arguments、cwd 和 env 的无 shell launcher。产品配置显式传入宿主 Python；开发配置可以解析项目 `.venv`，但运行调用本身不执行 `uv`。

`python-agent.ts` 继续作为 Review `--dev` 专用跨语言适配器，不纳入本轮 Worker 重构。GDEClaw 产品链将直接导入 `CuaAgent`。

### 4. Runtime 配置使用通用 JavaScript executable 语义

`RuntimeProcessConfig` 保留直接 command 构造能力，并增加以 `runtime_executable` 命名的路径构造入口。配置完整保留 `cwd` 与 `env`，从而同时支持普通 Node 与设置 `ELECTRON_RUN_AS_NODE=1` 的兼容 Electron executable。

是否采用 Electron-as-Node 由 GDEClaw 在验证 Electron 内置 Node 版本和 fuse 后决定，不进入 CUA 组件逻辑。

### 5. 组件目录由单一构建脚本生成

仓库提供跨平台 Python 构建脚本，将 wheels 写入 `dist/computer-use-component/python`，将 `execution/package.json`、lockfile、编译后的 `dist` 与生产 npm 依赖写入 `runtime`，并生成 manifest。构建阶段可以使用 Python build tooling 与 npm；组件验证和产品运行阶段不得使用这些工具。

构建脚本在独立 staging 中安装生产 npm 依赖，避免对源码仓 `node_modules` 执行破坏性的 prune。

### 6. Manifest 保持声明式和宿主无关

manifest 只声明 schema、组件版本、Python 兼容范围、wheel 相对路径、模块入口、JavaScript 兼容范围、Runtime 根/入口和 bridge 协议版本。Python executable、Electron 路径、数据根和模型配置不写入 manifest。

### 7. 验证分为静态校验与 clean-room smoke test

静态校验检查 manifest schema、相对路径、文件存在性、禁止的源码/开发文件和绝对路径。Smoke test 将组件复制到临时目录，安全展开组件 wheels 到隔离导入路径，使用外部提供且依赖已准备完成的 Python/Node 验证模块导入与 Runtime bridge `catalog` 请求。

需要模型、桌面或 Windows Hook 的完整行为不进入基础 smoke test；其模块入口和启动失败边界由单元测试覆盖。

## Risks / Trade-offs

- [Record 旧模块使用脚本式绝对导入与项目根资源] → 迁移为包内相对导入并为资源定位增加测试。
- [OpenCV/PyAV wheels 使 Python 依赖较大且平台敏感] → manifest 保留兼容声明，实际 wheel 解析与产品环境安装由宿主构建阶段完成。
- [生产 `node_modules` 增大组件体积] → 仅安装 production dependencies，并由组件所有者固定 lockfile。
- [Electron 内置 Node 不满足版本或 fuse 条件] → Runtime 契约保留任意兼容 JavaScript executable，宿主可改用独立 Node 而无需修改 CUA。
- [clean-room wheel 安装可能需要访问索引下载第三方依赖] → 结构验证默认离线；完整 smoke 支持宿主提供预准备 Python 环境或 wheelhouse。

## Migration Plan

1. 建立 `cua_record` 包并保持处理产物格式不变。
2. 将 Record 与 Recorder 的 TypeScript 启动器切换到宿主 Python 模块调用。
3. 泛化 Runtime executable 命名并保持现有 command API 兼容。
4. 增加组件构建、manifest 和静态验证。
5. 在源码仓外执行组件 smoke test并修复全部路径泄漏。
6. GDEClaw 后续仅消费组件产物；回滚时可继续使用本变更前的源码开发启动方式，不影响既有任务数据。
