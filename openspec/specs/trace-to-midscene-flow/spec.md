## Purpose

定义从 `record` 教学录制产物到 `execution` 中 Midscene computer use 执行流程的转换边界、项目产物组织方式、IR 要求和 runner 行为。
## Requirements
### Requirement: 按工作流名称组织项目产物
系统 SHALL 将转换后的 CUA 工作流组织为 `execution/projects/<scene>/<task>/` 下的本地任务包，并在任务根目录提供 flow、任务清单、任务 Skill、source 和 reports。

#### Scenario: 为转换创建项目目录
- **WHEN** 场景 `browser-demo` 中的任务 `air-tickets-demo` 首次转换 record trace
- **THEN** 转换输出 SHALL 放在 `execution/projects/browser-demo/air-tickets-demo/` 中
- **AND** 任务目录 SHALL 包含 `source/`、`midscene-flow.json`、`task.json`、`SKILL.md` 和 `reports/` 路径或这些路径的文档化占位
- **AND** 场景目录 SHALL 包含 `scene.json` 和场景 `SKILL.md`

### Requirement: ShowUI-Aloha 保持为录制处理器
系统 SHALL 将 `record/` 视为录制派生日志、截图和 trace 产物的上游生产方，而不是 Midscene 执行或回放组件。

#### Scenario: Converter 消费录制处理输出
- **WHEN** execution converter 处理一次教学录制
- **THEN** 它 SHALL 将 `record/` 中的 ShowUI-Aloha Learn 输出作为 source artifact 读取
- **AND** 它 SHALL 在 `execution/` 下写入执行侧产物
- **AND** 它 SHALL NOT 依赖 `Aloha_Act`、ShowUI-Aloha Actor、ShowUI-Aloha Executor 或 ShowUI-Aloha replay 代码

#### Scenario: Trace prompt 约束 Midscene 定位描述
- **WHEN** ShowUI-Aloha Learn 生成 trace
- **THEN** trace 生成 prompt SHALL 要求 `operation.prompt` 包含目标视觉特征、所在区域、相对锚点和动作意图中的至少 3 类信息
- **AND** 对 `input` 操作，`operation.locatePrompt` SHALL 只描述目标输入框本身，但也应包含足量视觉定位信息
- **AND** 系统 SHALL NOT 为该定位增强新增额外 operation schema 字段

### Requirement: Converter 生成 Midscene flow IR
Python converter SHALL 将 ShowUI-Aloha trace 数据初始化为任务根目录的结构化 `midscene-flow.json`，并禁止静默覆盖已有任务 flow。

#### Scenario: Trace 转换成功
- **WHEN** converter 收到有效 scene、task、goal 和 ShowUI-Aloha trace，且目标 flow 尚不存在
- **THEN** 它 SHALL 写入 `execution/projects/<scene>/<task>/midscene-flow.json`
- **AND** flow SHALL 包含 `schemaVersion`、`scene`、`task`、`source` 和 `steps`
- **AND** 每个 step SHALL 包含稳定 `id`、源 trace 引用、intent、timing、evidence 和 route strategy
- **AND** 输出 SHALL 通过 Python Pydantic 模型和生成的 JSON Schema 验证

#### Scenario: 目标 flow 已存在
- **WHEN** converter 目标任务已经存在 `midscene-flow.json`
- **THEN** converter SHALL 清晰失败并保留现有文件
- **AND** converter SHALL NOT 自动覆盖、合并或创建兼容副本

#### Scenario: Trace operation 转换为 Midscene prompt
- **WHEN** trace step 包含结构化 `caption.operation`
- **THEN** converter SHALL 仅使用 `operation.type` 选择 Midscene 执行动作
- **AND** converter SHALL 将 `operation.prompt` 作为对应 Midscene 动作的 prompt 来源
- **AND** 当 `operation.type` 为 `input` 时，converter SHALL 将 `operation.locatePrompt` 作为目标输入框定位来源
- **AND** converter SHALL NOT 通过扫描 `caption.action`、`expectation` 或原始录制动作中的自然语言关键词生成 route
- **AND** 当 `caption.operation` 缺失、类型未知或必需字段缺失时，converter SHALL 标明 trace step 并直接失败

#### Scenario: Trace 生成失败暴露
- **WHEN** 模型在一次纠错重试后仍未生成完整可执行 operation，或某个录制动作缺少可读取截图
- **THEN** trace 生成 SHALL 标明 step 或录制动作并直接失败
- **AND** trace 生成 SHALL NOT 写入 unknown operation、静默跳过该动作或猜测替代动作

### Requirement: Flow step 保留源证据
系统 SHALL 在每个 Midscene flow step 中保留足够的源上下文，用于解释该 step 为什么存在以及如何被推导出来。

#### Scenario: 转换后的 step 引用源 trace 上下文
- **WHEN** 一个 trace step 被转换为 Midscene flow step
- **THEN** flow step SHALL 包含原始 trace step index 或 identifier
- **AND** 它 SHALL 包含用于推导该 step 的 trace observation、action 或 expectation
- **AND** 当相关 screenshot 或 crop 路径可用时，它 SHALL 引用这些路径

#### Scenario: 录制步骤间隔转换为执行前等待
- **WHEN** processed log 中相邻步骤包含有效 `timestamp`
- **THEN** converter SHALL 计算相邻步骤的录制时间差
- **AND** converter SHALL 将该时间差写入 step 的 `timing.recordedGapMs`
- **AND** converter SHALL 写入经过下限忽略和 30 秒上限截断后的 `timing.waitBeforeMs`

### Requirement: Flow step 被路由到执行策略
系统 SHALL 在执行前将每个转换后的 step 分类为明确的 Midscene 执行策略。

#### Scenario: 确定性文本输入被路由
- **WHEN** trace step 明确表示向已知字段输入文本
- **THEN** 转换后的 step SHALL 使用 `input` strategy，并携带完整动作 prompt、目标输入框 locatePrompt 和文本值
- **AND** `locatePrompt` SHALL 只描述输入框目标，不包含要输入的文本值，也不包含“输入/键入/录入”等动作词

#### Scenario: 语义点击被路由
- **WHEN** trace step 明确表示点击一个可见 UI 目标
- **THEN** 转换后的 step SHALL 使用 `tap` 或 `act` strategy，并携带自然语言目标指令

#### Scenario: 点击动作保留执行路径
- **WHEN** trace step 明确表示一次 click 动作
- **THEN** converter SHALL 将该 step 路由为可执行的 `tap` 或 `act` strategy
- **AND** converter SHALL NOT 仅根据 trace 文本中的空白区域、无图标或无文字等描述将 click 动作改写为 `manual-review`

#### Scenario: 无法映射的非点击步骤被标记为需审查
- **WHEN** converter 无法有把握地将非点击 trace step 映射到受支持的执行策略
- **THEN** 转换后的 step SHALL 使用 `manual-review` strategy 或等价的非静默失败标记

### Requirement: 通用 runner 消费 Midscene flow IR
系统 SHALL 先由 Python 核心从 canonical Midscene flow 和本次参数构建 resolved flow，再由 TypeScript Midscene 执行器消费其中的可执行 steps。

#### Scenario: Runner 执行受支持策略
- **WHEN** TypeScript 执行器读取到包含受支持 `keyboard`、`input`、`tap`、`act` 或 `wait` strategy 的 resolved flow
- **THEN** 它 SHALL 将这些 step 路由到对应 Midscene computer use 操作
- **AND** 它 SHALL 使用已配置 run directory 生成 Midscene 执行报告
- **AND** 它 SHALL NOT 自行读取 canonical flow、任务清单或本次参数

#### Scenario: Runner 按 IR timing 执行前等待
- **WHEN** runner 执行包含 `timing.waitBeforeMs` 的 resolved flow step
- **THEN** runner SHALL 在执行该 step 的 route 前等待指定毫秒数
- **AND** runner SHALL NOT 在定位失败后默认调用 `aiWaitFor` 进行兜底重试
- **AND** `aiWaitFor` SHALL 只来自显式 `wait` strategy 或后续明确标记的页面跳转等待策略

#### Scenario: Runner 使用键盘事件执行文本输入
- **WHEN** runner 执行 `input` strategy
- **THEN** 它 SHALL 调用 Midscene 自定义 `KeyboardTypeText` action
- **AND** runner SHALL 将 input route 的 `locatePrompt` 传给 `KeyboardTypeText` 的 `locate` 字段
- **AND** `KeyboardTypeText` SHALL 通过 Midscene 定位管线定位目标输入区域并通过键盘事件输入文本
- **AND** 它 SHALL NOT 使用依赖剪贴板粘贴的 `aiInput`
- **AND** 当输入文本包含当前键盘映射不支持的字符时，它 SHALL 给出清晰错误并停止执行

#### Scenario: Runner 遇到不受支持策略
- **WHEN** runner 读取到不受支持或 `manual-review` strategy 的 resolved flow step
- **THEN** 它 SHALL 给出清晰错误，标识 step id 和原因
- **AND** 它 SHALL NOT 静默跳过或执行猜测出来的桌面动作

#### Scenario: 检查与执行共用解析结果
- **WHEN** 相同场景、任务和输入分别用于 flow inspect 与 flow run
- **THEN** 两者 SHALL 使用相同解析和验证逻辑
- **AND** canonical flow 和任务清单 SHALL NOT 被运行过程修改
