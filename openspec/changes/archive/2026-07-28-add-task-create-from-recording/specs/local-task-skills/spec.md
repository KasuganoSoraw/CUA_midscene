## MODIFIED Requirements

### Requirement: 任务目录使用精简 YAML 资产
每个任务 SHALL 包含 `task.yaml`、`task.json`、任务指令文件和可选 `source/`；任务目录不得保存运行报告。Skill 内置任务 SHALL 位于只读 builtin catalog，用户任务 SHALL 位于数据根的 user catalog。执行器 Skill SHALL 将单一 `task create-from-recording` 命令作为从原始录制创建任务的默认入口，并仅在 source 已标准化时使用 `task init-from-trace`。

#### Scenario: Agent 发现任务
- **WHEN** Agent 通过 Executor Skill 查询场景或任务
- **THEN** Skill SHALL 从内置与用户 catalog 返回任务清单、canonical YAML 和 task CLI
- **AND** 每个结果 SHALL 标明来源、实际路径和是否可写
- **AND** Skill SHALL NOT 要求维护 route、override、proposal、history 或任务内 reports 文件

#### Scenario: 用户沉淀新任务
- **WHEN** Agent 从原始录制初始化此前不存在的任务
- **THEN** Agent SHALL 调用单一 `task create-from-recording` 命令
- **AND** 系统 SHALL 在用户 catalog 创建精简任务资产
- **AND** 系统 SHALL NOT 向 Skill 内置 catalog 添加或修改文件

#### Scenario: 已有标准 source
- **WHEN** 用户任务 source 已包含标准化 trace、processed log 和截图
- **THEN** Agent MAY 使用 `task init-from-trace` 初始化任务
- **AND** Agent SHALL NOT 再次运行录制处理器

#### Scenario: 内置与用户任务标识冲突
- **WHEN** 相同 scene/task 标识同时存在于内置与用户 catalog
- **THEN** 任务发现和执行 SHALL 显式失败并报告两个来源
- **AND** 系统 SHALL NOT 静默选择任一任务
