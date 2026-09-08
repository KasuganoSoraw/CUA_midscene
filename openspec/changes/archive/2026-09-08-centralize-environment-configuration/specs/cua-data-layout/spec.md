## MODIFIED Requirements

### Requirement: 用户数据根具有确定配置优先级
系统 SHALL 按显式 CLI 参数、进程环境变量 `CUA_DATA_ROOT`、组件或仓库根目录 `.env.local`、同一根目录 `.env` 的顺序解析用户数据根，并将其规范化为绝对路径。

#### Scenario: CLI 覆盖环境配置
- **WHEN** 调用方同时提供 `--data-root` 和 `CUA_DATA_ROOT`
- **THEN** 系统 SHALL 仅将 `--data-root` 用作本次调用的数据根
- **AND** 系统 SHALL NOT 修改环境文件

#### Scenario: 使用现场环境配置
- **WHEN** 调用方未提供 `--data-root` 且进程环境或根环境文件包含 `CUA_DATA_ROOT`
- **THEN** 系统 SHALL 使用最高优先级的非空值
- **AND** 相对路径、不可创建路径或不可写路径 SHALL 在写入前失败并给出明确错误

#### Scenario: 缺少用户数据配置
- **WHEN** 命令需要创建用户任务或运行目录但没有可用数据根
- **THEN** 系统 SHALL 在写入 Skill 或当前工作目录前失败
- **AND** 错误 SHALL 指明 `--data-root` 或 `CUA_DATA_ROOT` 配置方式
