## Context

`execution` 当前既是完整 CUA 工程，也是 npm 发布根。其统一 CLI 在进程启动时静态导入任务、录制和 Review 模块，`package.json.files` 也包含源码、内置任务、前端和完整契约。直接从该包删除文件会破坏现有完整 Skill，并且只复制现有 CLI 会因静态依赖缺失而无法启动。

首期 GDE Claw 集成尚未确定最终工具注册接口，但已明确需要能够通过命令或 Node API 执行任意自然语言电脑操作，并保留 `KeyboardTypeText` 无剪贴板输入。精简发布物必须与 GDE 实现解耦，同时给后续任务执行和录制创建扩展留下同一命令空间。

## Goals / Non-Goals

**Goals:**

- 从完整源码生成可独立安装的 Agent Runtime 精简包。
- 通过专用 CLI 保留 `cua act run --prompt` 的调用形状。
- 通过窄 Node API 直接暴露自然语言 aiAct 执行。
- 只打包真实依赖链、生产依赖、中文 Skill 和使用说明。
- 使用单一命令完成编译、暂存和 npm 包生成，并可在干净目录验证。
- 保持完整 `cua-midscene` CLI、任务、录制和 Review 功能不变。

**Non-Goals:**

- 不实现未知的 GDE Claw 工具注册适配器。
- 不把录制任务执行、trace 转换、录制器或 Review 前端加入首期精简包。
- 不实现 MCP、HTTP 服务、自动重试、执行模式切换或并发锁。
- 不删除完整仓库中的现有模块和内置任务。

## Decisions

### 使用独立 Agent Runtime 入口而不是裁剪统一 CLI

新增专用 CLI，只导入自然语言 API、数据根解析和原生 Midscene 执行链。它接受 `act run --prompt`、`--data-root`、`--dry-run` 和可选 `--display-id`，stdout 始终输出单个 JSON，错误写入 stderr 并返回非零退出码。

统一 CLI 保持原样。这样精简包不会因为缺少 task、recording 或 review 模块而在加载阶段失败。

### 同时发布 CLI 与窄 Node API

精简包的 `bin.cua` 指向专用 CLI，包根导出只暴露 `runNaturalLanguageAiAct` 及其输入输出类型。未来宿主可直接导入 API，也可以通过 CLI 集成；两条入口复用同一执行函数和报告契约。

### 使用发布暂存目录和唯一白名单

`npm run package:agent` 先执行 Node 编译，再由一个 TypeScript/JavaScript 构建脚本创建干净暂存目录，只复制运行所需的编译文件、`.env.example`、Agent Runtime `SKILL.md`、README 和生成后的生产 `package.json`，最后执行 `npm pack --ignore-scripts`。

暂存目录和 tgz 位于被 Git 忽略的发布目录。打包脚本中的文件清单是精简包唯一发布白名单；测试直接检查最终 tgz/暂存内容，避免与根 `package.json.files` 形成两套隐式规则。

### 复用现有模型配置和运行目录规则

精简 CLI 继续使用 `--data-root`、`CUA_DATA_ROOT`、包根 `.env.local`、包根 `.env` 的优先级，并将报告写入 `<data-root>/runs/<run-id>`。模型变量继续由 `executors/env.ts` 按进程环境优先读取。真实执行不增加兜底或替代输入动作。

### 发布物使用通用名称

精简 npm 包命名为 `cua-agent-runtime`，命令仍为 `cua`。名称不绑定 aiAct-only，以便后续在同一发布物中扩展 `task`、`recording` 等命令；扩展通过增加白名单和 Skill 契约完成。

## Risks / Trade-offs

- [专用 CLI 与统一 CLI 参数可能漂移] → 共享核心执行函数，并用测试固定首期 `act run --prompt` 契约；未来扩展时显式同步测试和文档。
- [手工文件白名单遗漏运行依赖] → 在临时目录安装生成的 tgz并执行 `--help`、API import 和 dry-run smoke test。
- [包内 `.env.local` 可能泄露凭证] → 白名单只复制 `.env.example`，测试禁止 `.env` 与 `.env.local` 出现在产物中。
- [长期分支持续分叉] → 功能分支完成后合回主分支，精简差异由可重复打包命令维护，不以删除源码的长期分支维护。
- [GDE Claw 注册接口未知] → 当前只稳定 CLI/API 边界；具体适配代码延后到获得宿主接口后实现。

## Migration Plan

1. 新增 Agent Runtime CLI、导出和文档，不修改完整入口。
2. 新增打包命令并生成首个 tgz。
3. 在临时目录验证包可安装、可显示帮助、可执行 dry-run、可通过 Node API 导入。
4. 合并后由同一命令持续生成首期发布物；未来扩大能力时按命令域增加编译文件、依赖、Skill 说明和测试。

回滚只需移除新增 Agent Runtime 入口和打包脚本，现有完整发布流程不受影响。

## Open Questions

- GDE Claw 的原生工具注册最终是直接调用 Node API，还是通过子进程调用 CLI，需要取得其接口后决定。
- 录制器后续作为同一发布包的 Python 配套组件还是由宿主环境单独安装，留待二期确定。
