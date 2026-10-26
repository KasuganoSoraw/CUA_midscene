# CUA 工作台开发与运维指南

普通使用者参阅 [操作指南](workbench-end-user-guide.md)。资产与宿主协议参阅 [GDEClaw Skill 集成](gdeclaw-skill-integration.md)。

## 准备与启动

在仓库根将 .env.example 复制为 .env.local，准备 agent、recorder、record 的锁定 Python 环境，以及 execution 的 npm 依赖。Node.js 要求 >=20.18.1，公司 Node 22.18.0 可用。

```dotenv
CUA_SKILLS_ROOT=D:\GDEClaw\skills
CUA_DATA_ROOT=D:\CUA\data
CUA_RECORDINGS_ROOT=D:\CUA\recordings
CUA_AGENT_TOOL_MODE=execute
CUA_AGENT_FREEFORM_ONLY=false
```

同时配置 Midscene/录制模型。真实密钥和本机路径不提交。

```powershell
cd execution
npm.cmd ci
npm.cmd run build
npm.cmd run cua -- review --no-open
# 开发 Agent 调试：
npm.cmd run cua -- review --dev --no-open
```

PowerShell 可使用 npm.cmd 避免 npm.ps1 执行策略限制。服务监听 127.0.0.1:47831，打印页面 URL；--no-open 仅禁止 CLI 自动打开浏览器。相同数据根、Skill 根及兼容模式可复用，其他服务占用时明确失败。停止拥有服务的终端进程可关闭服务；关闭网页不等于可靠终止服务。

宿主设置入口直接调用 Runtime workbench，不调用 CLI 浏览器打开函数。Keeper 在页面使用期间保持 worker 存活。

## 资产、API 与校验

正式资产直接在 CUA_SKILLS_ROOT 下，没有 Scene/Project 分组。SKILL.md name 是身份，Manifest 和 0.3 task.json 必须匹配，路径及参考图必须留在 Skill 内。不要手工给普通 Skill 添加标记来绕过校验。

Workbench 的新 API 使用 /api/skills/:skillName。录制生成 POST /api/recordings/:recording/skills，body={}；通过 /api/skill-generation 查询后台状态。保存直接写正式 JSON/YAML，不需要发布和宿主更新 API。

原始录制位于 CUA_RECORDINGS_ROOT；生成过程复用 Python 后处理器和模型，并把轨迹及截图复制到 Skill source。临时目录和写锁使用根下隐藏目录，不作为任务展示。

浏览器草稿按数据根、Skill 根和规范名称隔离。保存使用 revision；冲突保留草稿，必须确认后重新加载。四个身份/流程文件都参与 revision。

## CLI 诊断

```powershell
npm.cmd run cua -- skill list --json
npm.cmd run cua -- skill describe --skill-name network-alarm-search
npm.cmd run cua -- skill validate --skill-name network-alarm-search
npm.cmd run cua -- skill run --skill-name network-alarm-search --dry-run
```

默认 guided，显式 --strategy replay 严格回放。dry-run 只校验并保存本次运行产物，不操作电脑。真实操作必须由宿主串行协调。

CUA_DATA_ROOT/runs 保存报告、状态、截图与本次输入，运行历史按空间策略清理，不触碰 Skill 和原始录制。失败时保留真实诊断和可用报告，不自动重试或换任务。

## 验证与兼容

在 execution 执行 npm.cmd run typecheck、npm.cmd test、npm.cmd run build；Agent 执行 pytest、ruff 和 mypy；Record 执行 unittest discover。界面可使用独立测试 Skill 根验证，避免修改正式业务资产。

旧 scene/task CLI 仅用于 CUA_DATA_ROOT/projects 中的兼容数据。新页面不使用这套目录。整体升级 Agent 和 Runtime；旧执行专用 scene/task 请求须改成 skillName，不能混搭组件。迁移策略及尚待内部确认的宿主生命周期见集成契约。
