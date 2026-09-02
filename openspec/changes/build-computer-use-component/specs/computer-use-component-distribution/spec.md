## Purpose

定义可由 GDEClaw 或其他宿主装配的 Computer-Use Component 发行目录、运行时注入边界以及脱离源码和开发工具的可验证性要求。

## ADDED Requirements

### Requirement: 组件发行物提供稳定且自描述的装配边界
系统 SHALL 产出包含 manifest、Python wheels 和 JavaScript Runtime 的单一 Computer-Use Component 目录；manifest SHALL 使用相对组件根的路径声明兼容版本、Python 包、Runtime 入口和协议版本。

#### Scenario: 宿主读取组件
- **WHEN** 宿主只获得构建后的组件目录
- **THEN** 宿主 SHALL 能从 manifest 找到全部 Python wheels 和 JavaScript Runtime 入口
- **AND** manifest SHALL NOT 包含构建机绝对路径或 GDEClaw 专用安装路径

### Requirement: Python 与 JavaScript 发行内容保持独立所有权
组件 SHALL 提供可安装的 `cua_agent`、`cua_recorder` 和 `cua_record` Python distributions，并 SHALL 提供包含 `package.json`、编译产物和生产 npm 依赖的 JavaScript Runtime；组件 SHALL NOT 携带 Python 或 JavaScript executable。

#### Scenario: GDEClaw 装配组件
- **WHEN** GDEClaw 构建最终产品
- **THEN** 宿主 SHALL 能将组件 wheels 安装到其产品 Python 环境
- **AND** 宿主 SHALL 能将 JavaScript Runtime 整体复制到其资源目录而无需解析 CUA 的源码工程或 npm 依赖图

### Requirement: 运行环境由宿主显式注入
组件运行入口 SHALL 接受宿主提供的 Python executable、JavaScript Runtime executable、JavaScript 环境、组件根和数据根，并 SHALL NOT 自行识别宿主产品目录或读取宿主专用设置。

#### Scenario: 使用普通 Node 验证组件
- **WHEN** 验证程序提供兼容的 Python 与 Node executable 及独立数据根
- **THEN** 同一组件 SHALL 能启动 Python modules 和 Runtime bridge

#### Scenario: 使用兼容 Electron Runtime 装配组件
- **WHEN** 宿主提供支持 Node 模式的 Electron executable 及所需环境
- **THEN** Runtime bridge SHALL 使用该 executable 和环境启动而无需修改 CUA 业务实现

### Requirement: 组件能够在脱离源码的环境中验证
组件构建 SHALL 提供结构校验和 smoke test，并 SHALL 在不访问源码目录、不执行依赖安装或 lock 的验证阶段检查 Python imports、Worker 模块入口、Runtime bridge 协议和组件路径完整性。

#### Scenario: clean staging 验证成功
- **WHEN** 组件被复制到源码仓外的临时目录并提供已准备好的兼容解释器
- **THEN** 验证 SHALL 在没有 `uv`、`npm`、`npx`、`tsx` 和源码相对路径的情况下通过

#### Scenario: 组件泄漏开发路径
- **WHEN** manifest、启动配置或发行文件依赖构建机绝对路径、源码文件或开发命令
- **THEN** 组件验证 SHALL 失败并报告对应路径或入口

