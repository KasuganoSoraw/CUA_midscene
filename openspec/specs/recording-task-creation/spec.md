# recording-task-creation Specification

## Purpose
TBD - created by archiving change add-task-create-from-recording. Update Purpose after archive.
## Requirements
### Requirement: 单一命令从原始录制创建任务
执行器 SHALL 提供 `task create-from-recording`，在一次调用中生成 trace、规范化任务 source、初始化 canonical 任务并执行与 `task validate` 相同的静态验证。

#### Scenario: 创建带目标的任务
- **WHEN** 调用者提供不存在的 scene/task、有效录制目录和非空 goal
- **THEN** 系统 SHALL 使用不含 goal 的原有 parser 调用生成 trace
- **AND** 系统 SHALL 将 goal 写入创建后的任务描述
- **AND** 系统 SHALL 创建通过静态验证的用户任务
- **AND** 最终 stdout SHALL 返回机器可读的创建与验证结果

#### Scenario: 保留已有标准 source 入口
- **WHEN** 调用者已经准备好标准化 task source
- **THEN** 原有 `task init-from-trace` SHALL 继续可用且行为不变

### Requirement: goal 为可选任务描述
创建命令 SHALL 接受可选 goal，不得将其传给 trace 生成模型，也不得在 goal 缺失或仅含空白时推测业务目标。

#### Scenario: 提供 goal
- **WHEN** 调用者提供非空 goal
- **THEN** parser 调用 SHALL NOT 包含 goal
- **AND** `task.json` 的 goal、description 与 YAML agent.groupDescription SHALL 保存规范化后的 goal

#### Scenario: 省略 goal
- **WHEN** 调用者未提供 goal 或提供全空白 goal
- **THEN** parser 调用 SHALL 与提供 goal 时保持相同
- **AND** `task.json` 的 goal、description 与 YAML agent.groupDescription SHALL 保存空字符串
- **AND** task title 与 YAML agent.groupName SHALL 继续使用 task 标识

### Requirement: 独立解析录制器环境
执行器 SHALL 从显式参数、进程环境、execution 环境文件或源码相邻目录解析外部录制器根，并在该目录的 uv 环境中运行 Python；Python SHALL 继续从 `record/.env` 读取 trace 模型配置。

#### Scenario: 使用安装后的 Skill
- **WHEN** execution 安装目录旁不存在 record 且 `CUA_RECORD_ROOT` 指向有效录制器
- **THEN** 创建命令 SHALL 使用该目录的 `pyproject.toml` 和 `Aloha_Learn/parser.py`
- **AND** execution 发布物 SHALL NOT 包含 Python 源码或 uv 环境

#### Scenario: 录制器环境无效
- **WHEN** 解析到的目录缺少录制器标记文件或无法启动 uv
- **THEN** 系统 SHALL 在创建任务目录前失败并报告原始原因

### Requirement: 任务 source 只保存规范化生成资产
系统 SHALL 将 parser 生成的 trace、两份 processed log 和被 processed log 引用的截图写入任务 source，并 SHALL NOT 复制原始视频或事件日志。

#### Scenario: 规范化录制产物
- **WHEN** parser 成功生成以录制目录名为前缀的产物
- **THEN** 任务 source SHALL 使用 `showui-trace.json`、`processed-log.json`、`processed-log-sc.json` 和 `screenshots/`
- **AND** 复制的截图 SHALL 仅来自 processed log 的有效相对引用

#### Scenario: 生成资产不完整
- **WHEN** trace、processed log 或被引用截图缺失、非法或越出录制目录
- **THEN** 系统 SHALL 显式失败且不得生成可发现任务

### Requirement: 创建过程拒绝覆盖并清理半成品
系统 SHALL 在运行 trace 模型前拒绝已有 user task 目录和同名 builtin task；在本次创建的复制、转换或验证阶段失败时 SHALL 删除本次新建的 task 目录。

#### Scenario: 目标任务已存在
- **WHEN** user task 目录已有任意内容或 builtin catalog 存在同名任务
- **THEN** 系统 SHALL 在调用 Python 前失败
- **AND** 系统 SHALL NOT 修改已有目录

#### Scenario: 初始化后验证失败
- **WHEN** 本次任务目录已创建但转换或静态验证失败
- **THEN** 系统 SHALL 删除该 task 目录并暴露原始错误
- **AND** 系统 SHALL 保留原录制目录产物与已生成的 run 报告

### Requirement: 录制器进度不得污染 CLI 结果
创建命令 SHALL 将录制器进度输出转发到 stderr，并仅在 stdout 输出最终 JSON。

#### Scenario: Agent 读取命令结果
- **WHEN** Python 在 trace 生成期间持续输出进度
- **THEN** stdout SHALL 仍可被直接解析为单个 JSON 文档
- **AND** Python 非零退出 SHALL 使命令以失败状态结束

