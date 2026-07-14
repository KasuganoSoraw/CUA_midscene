# Execution

该目录是 CUA 执行域。Python 核心负责把 record trace 初始化为本地任务、发现与验证任务、应用本次输入并生成 resolved flow；TypeScript 只通过 `@midscene/computer` 执行该快照。

这里不使用 browser-use、Playwright、Puppeteer 或 CDP。面向堡垒机、远程桌面和企业内网页系统的操作统一使用 Midscene computer use。

## 模块职责

```text
record trace
    ↓
Python cua
├── conversion       trace → canonical midscene-flow.json
├── models           Pydantic 持久化契约
├── task             场景/任务发现、输入解析、执行协议
└── cli              人、Agent 和未来前端的统一入口
    ↓ reports/<run-id>/resolved-flow.json
TypeScript executors
├── JSON Schema 校验
├── Midscene route 映射
└── KeyboardTypeText customAction
```

- `cua/domain/`：Python 进程内部 dataclass 和 VO。
- `cua/models/`：落盘或跨进程的 Pydantic 契约。
- `cua/conversion/`：从 record trace 首次初始化任务 flow。
- `cua/task/`：路径、发现、参数解析、快照和 Python/Node 执行协议。
- `executors/`：TypeScript Midscene 薄适配器，只读取 resolved flow。
- `schemas/`：从 Pydantic 生成，不手工编辑。
- `tests/python/`、`tests/executors/`：按职责分离的测试。

## 任务目录

```text
projects/<scene>/
├── scene.json                       # 场景清单
├── SKILL.md                         # 场景路由规则
└── <task>/
    ├── task.json                    # 任务说明与输入绑定
    ├── SKILL.md                     # 具体任务调用规则
    ├── midscene-flow.json           # 唯一长期执行事实源
    ├── source/                      # trace、日志和截图
    └── reports/<run-id>/            # Git 忽略
        ├── resolved-flow.json
        └── execution-result.json
```

长期修改直接编辑 `midscene-flow.json` 并运行 validate。Agent 修改前必须展示差异并等待确认。`task.json` 不保存默认值；本次没有传入的 input 保持 flow 当前值。

## 环境

```powershell
uv sync
npm install
npm run check
```

从 `.env.example` 创建 `.env.local` 并填写真实密钥。当前实验配置：

```text
MIDSCENE_MODEL_BASE_URL=https://ark.cn-beijing.volces.com/api/coding/v3
MIDSCENE_MODEL_NAME=minimax-m3
MIDSCENE_MODEL_FAMILY=doubao-vision
```

## CLI

所有命令从 `execution` 目录执行。

```powershell
uv run cua scene list --json
uv run cua task list --scene browser-demo --json
uv run cua task describe --scene browser-demo --task air-tickets-demo --json
```

首次初始化已准备好 `source/` 的任务：

```powershell
uv run cua task init-from-trace --scene browser-demo --task <task-name> --goal "<目标>"
```

该命令创建 flow、缺失的清单和最小 Skill；如果 flow 已存在则失败，不提供覆盖兜底。

验证、检查和执行：

```powershell
uv run cua flow validate --scene browser-demo --task air-tickets-demo
uv run cua flow inspect --scene browser-demo --task air-tickets-demo
uv run cua flow inspect --scene browser-demo --task air-tickets-demo --input step-002-value=GOOGLE
uv run cua flow run --scene browser-demo --task air-tickets-demo --dry-run
uv run cua flow run --scene browser-demo --task air-tickets-demo
```

`--input` 可重复；`--inputs <json-file>` 接收字符串值 JSON 对象。两种来源不能重复同一 ID。inspect 与 run 使用完全相同的确定性解析逻辑，不调用模型，不回写任务文件。

## 执行语义

- converter 只使用 trace 的结构化 `operation.type` 和必需字段，不扫描自然语言关键词猜 route。
- input 必须有 `operation.locatePrompt`；不会从完整动作 prompt 自动派生。
- `KeyboardTypeText` 通过 Midscene locate 管线定位输入框并发送键盘事件，不使用 `aiInput` 或剪贴板。
- `KeyboardTypeText` 当前只承诺 ASCII，遇到不支持字符直接失败。
- `timing.waitBeforeMs` 来自录制间隔，低于 200ms 忽略，高于 30 秒截断。
- runner 不在定位失败后默认调用 `aiWaitFor`；只有显式 wait route 才调用。
- `manual-review` 和未知 route 直接失败，不静默跳过、不自动改写任务。

## 验证

```powershell
uv run pytest
uv run python -m cua.models.schema --check
npm test
```

模型变化后重新生成 Schema：

```powershell
uv run python -m cua.models.schema
```
