# Execution

该目录是可独立发布的 `cua-midscene` Skill。Python 核心负责把 record trace 初始化为 Midscene YAML 任务、发现任务、解析本次输入和编排执行；TypeScript 只注册 `KeyboardTypeText`、创建 ComputerAgent 并调用 `agent.runYaml()`。

这里不使用 browser-use、Playwright、Puppeteer 或 CDP。堡垒机、远程桌面和企业内网页系统统一使用 Midscene computer use。

## 模块职责

```text
record trace
  -> cua/conversion：trace operation -> task.yaml + task.json
  -> cua/task：任务发现、YAML 占位符解析、运行快照与子进程协议
  -> cua/cli：人、Agent 和未来前端的统一入口
  -> reports/<run-id>/resolved-task.yaml
  -> executors/run-midscene-yaml.ts
       -> 注册 KeyboardTypeText
       -> agent.runYaml()
```

- `cua/domain/`：Python 进程内部 dataclass。
- `cua/models/`：scene、task 和 execution result 的 Pydantic 契约。
- `cua/conversion/`：只根据结构化 trace operation 初始化任务。
- `cua/task/`：YAML、输入、发现、报告与 Python/Node 执行协议。
- `executors/`：Midscene YAML 薄适配器、环境读取和 customAction。
- `projects/`：本地场景与任务 Skill。
- `schemas/`：从 Pydantic 生成，不手工编辑。
- `tests/python/`、`tests/executors/`：按技术边界分离的测试。

## 任务目录

```text
projects/<scene>/
├── scene.json
├── SKILL.md
└── <task>/
    ├── task.yaml                    # Midscene 原生 YAML，唯一长期事实源
    ├── task.json                    # 元数据、source 命令、输入与默认值
    ├── SKILL.md
    ├── source/
    └── reports/<run-id>/            # Git 忽略
        ├── resolved-task.yaml
        └── execution-result.json
```

长期修改直接编辑 `task.yaml` 并运行 `task validate`。Agent 修改前必须展示差异并等待确认。`task.json` 中未被本次 `--input` 覆盖的值保持录制默认值。

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

从已准备好的 `source/` 初始化任务：

```powershell
uv run cua task init-from-trace --scene <scene> --task <task> --goal "<目标>"
```

若 `task.yaml` 或 `task.json` 已存在，命令直接失败。它不会覆盖、迁移或合并旧资产。

检查与执行录制任务：

```powershell
uv run cua task validate --scene browser-demo --task air-tickets-demo
uv run cua task inspect --scene browser-demo --task air-tickets-demo
uv run cua task inspect --scene browser-demo --task air-tickets-demo --input input-001=GOOGLE
uv run cua task run --scene browser-demo --task air-tickets-demo --dry-run
uv run cua task run --scene browser-demo --task air-tickets-demo
```

无录制自然语言任务：

```powershell
uv run cua act run --prompt "打开 Chrome 并搜索 GUI agent" --dry-run
uv run cua act run --prompt "打开 Chrome 并搜索 GUI agent"
```

`--input` 可重复；`--inputs <json-file>` 接收字符串值 JSON 对象。两种来源不能重复同一 ID。inspect 与 run 使用同一确定性解析函数，不调用模型、不回写任务文件。

录制任务只执行其 YAML。若希望某一步由 Midscene 规划，可直接在 `task.yaml` 使用 Midscene 原生 `ai` action；系统不会再把全部录制步骤拼成第二份 aiAct prompt。

## 执行语义

- converter 只读取 trace 的 `caption.operation` 和 processed log 时间，不扫描其他自然语言字段。
- click、input、keyboard、wait 分别生成 `aiTap`、`KeyboardTypeText`、`KeyboardPress`、`aiWaitFor`。
- 录制间隔生成前置 `sleep`：低于 200ms 忽略，高于 30 秒截断。
- 每个 trace input 依次生成 `input-001`、`input-002` 等 ID，录制值保存在 `task.json`。
- `KeyboardTypeText` 通过 Midscene locate 定位输入框，再用底层键盘 primitive 逐键输入；每个字符不会经过模型规划，也不使用剪贴板。
- `KeyboardTypeText` 只承诺 ASCII，遇到不支持字符直接失败。
- 未知输入、重复输入、非法或未声明占位符、无效 YAML 和执行错误均直接暴露。
- 系统不兼容读取旧 flow，不自动切换模式，不修改任务后重试，也不调用替代输入动作。

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
