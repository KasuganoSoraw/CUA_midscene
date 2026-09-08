## Purpose

定义源码开发使用的仓库根环境文件、统一变量目录、确定优先级和产品态注入边界，避免各子工程维护相互独立或重复的配置入口。

## ADDED Requirements

### Requirement: 仓库只提供一个环境配置入口
源码仓 SHALL 只在仓库根提供 `.env.example`，并 SHALL 只将根 `.env.local`、根 `.env` 作为文件配置入口；子工程 SHALL NOT 提供或读取自己的环境文件。

#### Scenario: 开发者准备源码配置
- **WHEN** 开发者从示例创建本地配置
- **THEN** 所有 Agent、Runtime、Record 和 Recorder 变量 SHALL 能写入根 `.env.local`
- **AND** 子工程 SHALL NOT 要求复制第二份环境文件

### Requirement: 环境配置具有统一优先级
系统 SHALL 按显式调用参数、进程环境、根 `.env.local`、根 `.env` 的顺序选择最高优先级非空值，并 SHALL NOT 使用环境文件覆盖已有进程变量。

#### Scenario: 进程环境覆盖本地文件
- **WHEN** 进程环境与根 `.env.local` 包含同名变量
- **THEN** 系统 SHALL 使用进程环境值

#### Scenario: 本地文件覆盖共享文件
- **WHEN** 根 `.env.local` 与根 `.env` 包含同名变量且没有更高优先级来源
- **THEN** 系统 SHALL 使用根 `.env.local` 的值

### Requirement: 组件产品运行不依赖环境文件
组件发行物 SHALL NOT 携带真实环境文件或密钥，Host SHALL 能只通过进程环境和显式参数启动 Agent 与 Runtime。

#### Scenario: Host 启动已安装组件
- **WHEN** Host 提供运行所需的进程环境和 executable 路径
- **THEN** 组件 SHALL 在不存在 `.env` 或 `.env.local` 时运行
- **AND** 运行阶段 SHALL NOT 搜索子工程源码环境文件
