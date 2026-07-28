## Context

现有录制处理器位于 `record/`，通过 uv 管理 Python 环境并从 `record/.env` 读取模型配置；任务执行器位于 `execution/`，作为 TypeScript-only Skill 发布并从 `execution/.env.local` 读取数据根和 Midscene 配置。当前用户或 Agent 必须跨目录手工串联两个工具。

## Goals / Non-Goals

**Goals:**

- 由一个 TypeScript CLI 完成录制处理、source 规范化、任务初始化和静态验证。
- 保留录制器与执行器的环境、依赖和发布边界。
- 在已有任务、非法产物或验证失败时明确失败，不留下不可用任务。
- goal 可选且不进行隐式推测，也不改变 trace 生成 prompt。

**Non-Goals:**

- 不把 Python 录制器打包进 execution Skill。
- 不复制原始录制视频和事件日志。
- 不覆盖、重建或兼容读取既有任务。
- 不在创建失败后自动重试或改用其他流程。

## Decisions

### TypeScript 直接编排外部录制器

新增 `cua/recording/` 模块，通过 `spawn` 且不启用 shell，在录制器根目录执行 `uv run python Aloha_Learn/parser.py`。CLI 直接复用 `convertTrace()` 与 `runTask(..., dryRun: true)`，不递归启动自身命令。

录制器根目录按 `--record-root`、进程 `CUA_RECORD_ROOT`、execution `.env.local`、execution `.env`、源码仓相邻 `record/` 的顺序解析，并要求存在 `pyproject.toml` 与 `Aloha_Learn/parser.py`。Python 仍自行加载 `record/.env`。

### 只复制确定的生成资产

parser 继续在原录制目录生成以目录名为前缀的文件。编排器校验后将 trace、两份 processed log 规范化为固定文件名，并仅复制 processed log 的 `screenshot_full`、`screenshot_crop`、`screenshot_reference` 实际引用的相对截图。

### goal 只描述任务，不参与 trace 生成

CLI 与公开 API 接收可选 goal，但录制器始终使用原有 `uv run python Aloha_Learn/parser.py <录制目录>` 调用，不把 goal 传给 trace 模型。goal 仅在 trace 生成后写入任务 `goal`、`description` 与 YAML `groupDescription`；省略或全空白时保存空字符串。

### 先预检，再创建并在失败时清理

模型调用前验证目标 user task 目录完全不存在，且不存在同名 builtin task。parser 成功且生成资产通过校验后才创建 canonical task 目录；复制、转换或静态验证失败时删除本次创建的 task 目录。原录制产物和已生成的 run 报告保留用于排查。

### stdout 保持机器可读

子进程 stdout 与 stderr 均转发到父进程 stderr，CLI stdout 只输出最终 JSON。子进程非零退出时保留退出码、信号和录制器输出摘要，不包装为成功结果。

## Risks / Trade-offs

- [安装后的 Skill 无法自动找到源码仓 record] → 要求配置 `CUA_RECORD_ROOT`，源码相邻目录仅作为开发环境默认值。
- [parser 会在原录制目录写入生成文件] → 明确该目录是录制处理工作区，失败清理不删除这些诊断产物。
- [验证失败后可能已有 run 报告] → 保留报告帮助排查，但删除 canonical task，防止不可用任务被发现。
- [高层 goal 干扰逐步视觉判断] → goal 不进入 trace prompt，只作为生成后任务描述。

## Migration Plan

现有 `task init-from-trace` 与持久化契约不变。新命令上线后，Skill 将其作为原始录制创建任务的默认入口；已有标准 source 仍可继续使用旧入口。

## Open Questions

无。
