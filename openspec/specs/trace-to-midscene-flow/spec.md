## Purpose

定义从 `record` 教学录制产物到 `execution` 中 Midscene computer use 执行流程的转换边界、项目产物组织方式、IR 要求和 runner 行为。

## Requirements

### Requirement: 按工作流名称组织项目产物
系统 SHALL 将转换后的 CUA 工作流资产组织为 `execution/projects/<project-name>/` 下的可调用任务包，并为 source 输入、基础 IR、任务配置、校准、生成执行资产和执行报告提供独立区域。

#### Scenario: 为转换创建项目目录
- **WHEN** 项目 `air-tickets-demo` 的 record trace 被转换
- **THEN** 转换输出 SHALL 放在 `execution/projects/air-tickets-demo/` 下
- **AND** 项目目录 SHALL 包含 `source/`、`ir/`、`config/`、`calibration/`、`generated/`、`reports/` 路径或这些路径的文档化占位

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
系统 SHALL 将 record trace 数据转换为结构化基础 `midscene-flow.json`，初始化不存在的任务配置，并保留已经存在的人工任务配置和校准，供 execution 中的 Midscene 执行链路消费。

#### Scenario: Trace 转换成功
- **WHEN** converter 收到一个具名项目的有效 record trace
- **THEN** 它 SHALL 写入 `execution/projects/<project-name>/ir/midscene-flow.json`
- **AND** flow SHALL 包含 `schemaVersion`、`project`、`source` 和 `steps`
- **AND** 每个 step SHALL 包含稳定 `id`、源 trace 引用、intent、timing、evidence、route strategy 和 fallback 信息
- **AND** converter SHALL 仅在任务配置不存在时按 input route 初始化输入定义

#### Scenario: Trace operation 转换为 Midscene prompt
- **WHEN** trace step 包含结构化 `caption.operation`
- **THEN** converter SHALL 优先使用 `operation.type` 选择 Midscene 执行动作
- **AND** converter SHALL 将 `operation.prompt` 作为对应 Midscene 动作的 prompt 来源
- **AND** 当 `operation.type` 为 `input` 时，converter SHALL 将 `operation.locatePrompt` 作为目标输入框定位来源
- **AND** converter SHALL NOT 通过扫描 `caption.action` 中的自然语言关键词作为主路径生成 route

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
系统 SHALL 提供通用 Midscene runner，通过共享 resolver 消费基础 IR、已确认校准和本次输入合并后的 resolved flow。

#### Scenario: Runner 执行受支持策略
- **WHEN** runner 读取到包含受支持 `keyboard`、`input`、`tap`、`act` 或 `wait` strategy 的 resolved flow
- **THEN** 它 SHALL 将这些 step 路由到对应 Midscene computer use 操作
- **AND** 它 SHALL 使用已配置 run directory 生成 Midscene 执行报告
- **AND** 它 SHALL 在初始化 Midscene 前保存本次 resolved flow 快照

#### Scenario: Runner 按 IR timing 执行前等待
- **WHEN** runner 执行包含 `timing.waitBeforeMs` 的 flow step
- **THEN** runner SHALL 在执行该 step 的 route 前等待指定毫秒数
- **AND** runner SHALL NOT 在定位失败后默认调用 `aiWaitFor` 进行兜底重试
- **AND** `aiWaitFor` SHALL 只来自显式 `wait` strategy 或后续明确标记的页面跳转等待策略

#### Scenario: Runner 使用键盘事件执行文本输入
- **WHEN** runner 执行 `input` strategy
- **THEN** 它 SHALL 调用 Midscene 自定义 `KeyboardTypeText` action
- **AND** runner SHALL 将 input route 的 `locatePrompt` 传给 `KeyboardTypeText` 的 `locate` 字段
- **AND** `KeyboardTypeText` SHALL 通过 `locate` 字段复用 Midscene 定位管线来定位目标输入区域
- **AND** 它 SHALL 通过键盘事件输入文本
- **AND** 它 SHALL NOT 使用依赖剪贴板粘贴的 `aiInput` 作为 input route 的执行路径
- **AND** 当输入文本包含当前键盘映射不支持的字符时，它 SHALL 给出清晰错误并停止执行

#### Scenario: Runner 遇到不受支持策略
- **WHEN** runner 读取到不受支持或 `manual-review` strategy 的 flow step
- **THEN** 它 SHALL 给出清晰错误，标识 step id 和原因
- **AND** 它 SHALL NOT 静默跳过或执行猜测出来的桌面动作

#### Scenario: 检查与执行共用解析结果
- **WHEN** 相同项目和输入分别用于 flow inspect 与 flow run
- **THEN** 两者 SHALL 使用相同解析和验证逻辑
- **AND** 基础 IR、任务配置和已确认校准 SHALL NOT 被运行过程修改

### Requirement: 生成脚本是派生产物
系统 SHALL 将未来生成的 Midscene 脚本视为从 `midscene-flow.json` 派生出的产物，而不是源事实。

#### Scenario: 后续生成脚本
- **WHEN** 为某个项目创建生成的 `run.ts`
- **THEN** 它 SHALL 放在 `execution/projects/<project-name>/generated/` 下
- **AND** 它 SHALL 引用生成时使用的 flow 或 metadata 版本
- **AND** 工作流变更 SHALL 先更新 source trace 输入或 `midscene-flow.json`，再重新生成脚本
