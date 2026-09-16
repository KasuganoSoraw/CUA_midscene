## ADDED Requirements

### Requirement: Agent 提供克制且可操作的工具调用说明
canonical instructions SHALL 要求 Agent 仅在有助于理解执行过程时，用简短的中文说明即将执行的动作、工具已确认的结果和下一步；说明 MUST 只包含动作、观察与后续计划，不得输出隐藏推理、思维链或机械复述每一次工具调用。

#### Scenario: 连续调用多个内部 Tool
- **WHEN** Agent 完成一个内部 Tool 调用且还需要继续调用 Tool
- **THEN** Agent SHALL 用一句简短说明概括已确认的结果和下一步
- **AND** 说明 SHALL NOT 展开内部推理过程

#### Scenario: 工具调用无需额外说明
- **WHEN** 工具名称、参数和相邻回复已经足以表达操作意图
- **THEN** Agent MAY 直接调用 Tool
- **AND** Agent SHALL NOT 为满足固定格式而重复同义说明

### Requirement: Agent 在最终回复中提供可用入口与执行报告
canonical instructions SHALL 要求 Agent 在 Workbench Tool 成功后提供返回的 `url` 及其用途，并 SHALL 在成功的 `cua_execute` 返回 `reportPath` 时提供该 HTML 报告路径。

#### Scenario: Workbench 返回访问地址
- **WHEN** `cua_workbench` 返回可用 `url`
- **THEN** Agent 最终回复 SHALL 包含该 URL
- **AND** Agent SHALL 说明该入口用于录制、复核或执行中的对应用途

#### Scenario: 成功执行生成报告
- **WHEN** `cua_execute` 成功且 Tool 结果包含 `reportPath`
- **THEN** Agent 最终回复 SHALL 包含该 HTML 报告路径

#### Scenario: 执行结果没有报告
- **WHEN** `cua_execute` 结果不包含 `reportPath`
- **THEN** Agent SHALL NOT 编造报告路径
