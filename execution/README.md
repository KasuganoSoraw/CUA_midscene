# Execution

该目录是 CUA 的执行域。Python 核心负责把 record 产物转换为任务 flow、处理项目配置与人工校准、合并本次参数并提供统一 CLI；TypeScript 只负责通过 `@midscene/computer` 执行已经解析完成的 resolved flow。

这里不使用 browser-use、Playwright、Puppeteer 或 CDP。面向堡垒机、远程桌面和企业内网页系统的操作统一使用 Midscene computer use。

## 技术边界

```text
record trace
    ↓
Python cua
├── conversion       trace → 基础 IR
├── models           Pydantic 持久化契约
├── task             项目、校准、参数、resolved flow
└── cli              人、Agent 和未来前端的统一入口
    ↓ reports/<run-id>/resolved-flow.json
TypeScript executors
├── JSON Schema 校验
├── Midscene route 映射
└── KeyboardTypeText customAction
```

主要目录：

- `cua/domain/`：仅在 Python 内部使用的 dataclass 和 VO，不生成 JSON Schema。
- `cua/models/`：会落盘或跨进程传输的 Pydantic 模型，是公开契约的事实来源。
- `cua/conversion/`：record trace 到基础 Midscene IR 的确定性转换。
- `cua/task/`：任务发现、参数合并、校准和 Python/Node 执行协议。
- `executors/`：TypeScript Midscene 薄适配器，不读取任务包其他文件。
- `schemas/`：从 Pydantic 生成的 JSON Schema，不手工编辑。
- `tests/python/`、`tests/executors/`：按语言和职责分离的测试。

## 环境配置

安装 Python 与 Node 依赖：

```powershell
cd execution
uv sync
npm install
```

从 `.env.example` 复制 `.env.local` 并填写本地密钥。当前实验配置为：

```text
MIDSCENE_MODEL_BASE_URL=https://ark.cn-beijing.volces.com/api/coding/v3
MIDSCENE_MODEL_NAME=minimax-m3
MIDSCENE_MODEL_FAMILY=doubao-vision
```

检查 Midscene 本机环境：

```powershell
npm run check
```

## 项目任务包

```text
projects/<project-name>/
├── source/                         # record trace、日志和截图
├── ir/midscene-flow.json           # converter 可覆盖的基础 IR
├── config/project.json             # 任务说明、输入和录制默认值
├── config/flow-overrides.json      # 已确认长期校准
├── calibration/proposals/          # Agent 待确认建议
├── calibration/history/            # 已应用建议历史
├── generated/                      # 后续脚本派生产物
└── reports/<run-id>/               # Git 忽略
    ├── resolved-flow.json           # Python 生成的执行快照
    └── execution-result.json        # TypeScript executor 结果
```

合并顺序固定为：基础 IR → 已确认校准 → 本次输入。待确认 proposal 不参与执行，整个解析过程不调用模型。

## Python CLI

以下命令都从 `execution` 目录执行。

转换 trace：

```powershell
uv run cua flow convert --project air-tickets-demo --goal "将 Qatar Airways 订票页面设置为 Singapore 到 Los Angeles 的单程航班搜索"
```

发现、验证和检查任务：

```powershell
uv run cua project list --json
uv run cua flow validate --project air-tickets-demo
uv run cua flow inspect --project air-tickets-demo
uv run cua flow inspect --project air-tickets-demo --input step-002-value=GOOGLE
```

`--input` 可以重复，也可以通过 `--inputs <json-file>` 提供字符串值 JSON 对象。只覆盖本次明确提供的参数，其他参数继续使用 `project.json` 中的录制默认值。

dry-run 和实际执行：

```powershell
uv run cua flow run --project air-tickets-demo --dry-run
uv run cua flow run --project air-tickets-demo
```

两者都先生成 resolved flow，再调用同一个 TypeScript executor。dry-run 会完成跨进程契约校验和 route 展示，但不会初始化 Midscene agent；实际执行会调用视觉模型并操作真实桌面。

校准建议必须先验证、等待用户明确确认，再应用：

```powershell
uv run cua calibration validate --project air-tickets-demo --proposal <proposal-id>
uv run cua calibration apply --project air-tickets-demo --proposal <proposal-id> --confirmed
```

人工可以直接编辑 `config/flow-overrides.json`，但编辑后必须运行 `flow validate`。结构性错误，例如缺失、增加或重排 step，应回到 trace 阶段修正。

## 执行语义

- converter 只使用 trace 的 `operation.type` 和对应必需字段，不扫描 Action、Expectation 或原始录制文本来猜测 route。
- 每个 trace step 必须有结构化 operation；input 必须显式提供 `operation.locatePrompt`，不会从完整动作 prompt 自动派生。
- `KeyboardTypeText` 通过 Midscene locate 管线聚焦目标，再发送键盘事件；不使用 `aiInput` 和剪贴板。
- `KeyboardTypeText` 当前只承诺 ASCII，遇到不支持字符直接失败。
- `timing.waitBeforeMs` 来自录制步骤间隔，低于 200ms 忽略，高于 30 秒截断。
- runner 不在定位失败后默认调用 `aiWaitFor`；只有显式 wait route 才调用它。
- `manual-review` 直接失败；未知 route 在 JSON 契约校验阶段失败，不静默跳过、不自动修改任务并重试。

## 开发验证

```powershell
uv run pytest
uv run python -m cua.models.schema --check
npm test
```

更新 Pydantic 边界模型后重新生成 Schema：

```powershell
uv run python -m cua.models.schema
```

TypeScript executor 不生成 resolved flow DTO；它通过 Ajv 按 `resolved-flow.schema.json` 校验唯一运行输入，并只在执行器内部声明动作映射所需的最小类型。
