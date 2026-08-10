# agent-runtime-package Specification

## Purpose
TBD - created by archiving change add-agent-runtime-package. Update Purpose after archive.
## Requirements
### Requirement: 系统生成独立 Agent Runtime 精简包
系统 SHALL 通过单一打包命令从完整源码生成可独立安装的 Agent Runtime 包，并且 SHALL NOT 删除或改变完整 `cua-midscene` 工程中的任务、录制和复核能力。

#### Scenario: 构建首期精简包
- **WHEN** 开发者运行 Agent Runtime 打包命令
- **THEN** 系统 SHALL 编译自然语言执行依赖链并生成可安装 npm 包
- **AND** 完整 CLI 与完整工程源码 SHALL 保持可用

### Requirement: 精简包只包含首期运行资产
Agent Runtime 包 SHALL 只包含自然语言 aiAct、Midscene Computer Agent、`KeyboardTypeText`、配置与报告契约、专用 CLI/API、生产依赖和 Agent 文档。

#### Scenario: 审计发布内容
- **WHEN** 开发者检查精简包文件清单
- **THEN** 产物 SHALL NOT 包含录制器、trace 转换、任务执行、项目资产、Review 服务或前端、测试、本地环境文件及运行报告
- **AND** 产物 SHALL 包含 `.env.example`、中文 `SKILL.md` 和中文 README

### Requirement: 精简 CLI 支持自然语言 Computer Use
精简包 SHALL 提供 `cua act run --prompt <要求>` 命令，并通过原生 `agent.aiAct()` 执行自然语言电脑操作。

#### Scenario: dry-run 检查自然语言调用
- **WHEN** Agent 使用绝对数据根执行 `cua act run --prompt <要求> --dry-run`
- **THEN** CLI SHALL 校验 prompt、创建外部运行目录并输出单个机器可读 JSON
- **AND** CLI SHALL NOT 初始化 ComputerDevice 或调用模型

#### Scenario: 实际执行自然语言调用
- **WHEN** Agent 使用有效模型配置执行非 dry-run 命令
- **THEN** 系统 SHALL 注册 `KeyboardTypeText` 并调用一次 Midscene `agent.aiAct()`
- **AND** 系统 SHALL 在结束时销毁 Agent并保留原始执行结果或错误

### Requirement: 精简包提供窄 Node API
Agent Runtime 包根入口 SHALL 导出自然语言执行函数及必要输入输出类型，并且 SHALL NOT 从入口导入任务、录制、转换或 Review 模块。

#### Scenario: 工具宿主直接导入
- **WHEN** Node.js 工具宿主从 `cua-agent-runtime` 导入公开 API
- **THEN** 宿主 SHALL 能以结构化参数执行自然语言 aiAct
- **AND** 导入过程 SHALL NOT 要求任务 catalog、Python 录制器或 Web 前端存在

### Requirement: 数据与凭证保持在发布物外部
精简 CLI SHALL 将运行产物写入显式 `--data-root` 或 `CUA_DATA_ROOT` 对应的外部 `runs` 目录，并 SHALL 通过进程环境或包外本地配置读取模型凭证。

#### Scenario: 缺少数据根
- **WHEN** Agent 未提供 `--data-root` 且环境及本地配置均未设置 `CUA_DATA_ROOT`
- **THEN** CLI SHALL 在创建运行资产或操作电脑前明确失败

#### Scenario: 打包本地配置
- **WHEN** 系统生成 Agent Runtime 包
- **THEN** 产物 SHALL NOT 包含 `.env` 或 `.env.local`
- **AND** 产物 SHALL 只提供不含真实凭证的 `.env.example`

### Requirement: Skill 指导 Agent 安全调用
精简包的 `SKILL.md` SHALL 说明能力范围、CLI/API 用法、长超时、串行电脑操作、dry-run 语义和失败处理，并且 SHALL NOT 描述尚未打包的任务或录制命令为可用能力。

#### Scenario: Agent 阅读首期 Skill
- **WHEN** 外部 Agent 加载精简包的 `SKILL.md`
- **THEN** Agent SHALL 能识别自然语言电脑操作的触发条件和命令
- **AND** Agent SHALL 被要求在长时间无输出但任务仍可能运行时避免过早终止
- **AND** Agent SHALL 被禁止在失败后自动重试、自动切换模式或掩盖错误

### Requirement: 精简包支持后续增量扩展
精简包 SHALL 使用通用 CUA 命令空间和可扩展发布白名单，使后续任务与录制能力能够加入同一发布物，而无需改变首期自然语言命令。

#### Scenario: 后续增加任务命令
- **WHEN** 后续版本将任务执行加入发布范围
- **THEN** `cua act run --prompt` 的既有参数和结果语义 SHALL 保持兼容
- **AND** 新能力 SHALL 通过新的命令域、公开 API、Skill 说明和对应测试加入

