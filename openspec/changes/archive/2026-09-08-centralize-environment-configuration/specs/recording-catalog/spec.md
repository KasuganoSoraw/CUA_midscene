## MODIFIED Requirements

### Requirement: 配置独立原始录制根
系统 SHALL 通过显式参数、进程环境或组件/仓库根环境文件中的 `CUA_RECORDINGS_ROOT` 定位录制器实际输出的原始录制集合，并 SHALL 将其与最终任务数据根区分。

#### Scenario: 配置有效录制根
- **WHEN** 最高优先级配置将 `CUA_RECORDINGS_ROOT` 指向可读绝对目录
- **THEN** 系统 SHALL 使用该目录发现原始录制
- **AND** 系统 SHALL NOT 在该目录中创建额外清单、索引或状态文件

#### Scenario: 未配置录制根
- **WHEN** 启动 review 服务时没有可用的 `CUA_RECORDINGS_ROOT`
- **THEN** 系统 SHALL 保持现有任务复核能力可用
- **AND** 录制创建页面 SHALL 明确提示需要配置的环境变量名称
