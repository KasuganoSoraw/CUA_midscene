## MODIFIED Requirements

### Requirement: 独立解析录制器环境
执行器 SHALL 使用显式提供或由运行环境配置的 Python executable 执行已安装的 `cua_record` 模块；录制目录仅作为处理输入，创建流程 SHALL NOT 要求 record 源码根、`pyproject.toml`、脚本相对路径或 `uv`，Python 模块 SHALL 从进程环境读取 trace 模型配置。

#### Scenario: 使用安装后的 Skill
- **WHEN** execution 运行于已安装 `cua_record` 的宿主 Python 环境
- **THEN** 创建命令 SHALL 使用该 Python 执行 `-m cua_record process <recording>`
- **AND** execution 与组件发行物 SHALL NOT 包含 Python executable、源码工程或 uv 环境

#### Scenario: 录制器环境无效
- **WHEN** Python executable 不存在、无法启动或未安装 `cua_record`
- **THEN** 系统 SHALL 在创建任务目录前失败并报告原始原因
