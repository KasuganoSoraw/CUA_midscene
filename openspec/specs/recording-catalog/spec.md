# recording-catalog Specification

## Purpose

定义本地 review 服务对原始录制目录的配置、动态发现、安全访问和系统目录打开能力，确保录制资产无需额外索引即可供任务创建页面浏览，同时始终限制在用户显式配置的本地根目录内。

## Requirements

### Requirement: 配置独立原始录制根
系统 SHALL 通过 `CUA_RECORDINGS_ROOT` 定位录制器实际输出的原始录制集合，并 SHALL 将其与 Python 录制处理器根和最终任务数据根区分。

#### Scenario: 配置有效录制根
- **WHEN** 进程环境或 execution 环境文件将 `CUA_RECORDINGS_ROOT` 配置为可读绝对目录
- **THEN** 系统 SHALL 使用该目录发现原始录制
- **AND** 系统 SHALL NOT 在该目录中创建额外清单、索引或状态文件

#### Scenario: 未配置录制根
- **WHEN** 启动 review 服务时没有可用的 `CUA_RECORDINGS_ROOT`
- **THEN** 系统 SHALL 保持现有任务复核能力可用
- **AND** 录制创建页面 SHALL 明确提示需要配置的环境变量名称

### Requirement: 动态发现一级录制目录
系统 SHALL 扫描录制根的一级子目录，并根据 `inputs/` 中的实际文件动态构造录制列表与详情，不得依赖目录名称前缀。

#### Scenario: 发现有效录制
- **WHEN** 一级目录包含 `inputs/` 且其中恰好存在一个 MP4 视频和一个受支持的事件日志
- **THEN** 系统 SHALL 将该目录标记为可生成
- **AND** 详情 SHALL 包含 recording ID、文件名称、文件大小和可解析的日志元数据

#### Scenario: 发现不完整录制
- **WHEN** 一级目录缺少 `inputs/`、视频、事件日志或者存在多个候选文件
- **THEN** 系统 SHALL 保留该目录供用户查看
- **AND** 系统 SHALL 将其标记为不可生成并返回具体原因

### Requirement: 录制目录访问限制在配置根内
系统 SHALL 只接受录制根下合法一级目录的 recording ID，并 SHALL NOT 向 Web 客户端暴露录制绝对路径。

#### Scenario: 请求越界录制 ID
- **WHEN** recording ID 包含绝对路径、路径分隔符、父目录跳转或解析后越出录制根
- **THEN** 系统 SHALL 拒绝打开或创建操作
- **AND** 系统 SHALL NOT 读取或启动该目标

### Requirement: 显式打开录制目录
系统 SHALL 允许用户通过本地 review 页面在系统文件资源管理器中打开已安全解析的录制目录。

#### Scenario: 打开有效录制目录
- **WHEN** 用户点击视频、事件日志占位卡片或打开目录按钮
- **THEN** 服务 SHALL 使用 recording ID 重新解析目录
- **AND** 服务 SHALL 通过无 shell 系统命令打开该目录
