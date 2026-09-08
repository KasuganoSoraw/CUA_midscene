## MODIFIED Requirements

### Requirement: Windows 录制器以独立 Python 进程提供稳定控制协议
系统 SHALL 提供 Windows-only Python 录制 Worker，并 SHALL 通过宿主提供的 Python executable 以 `-m cua_recorder` 启动独立无 shell 进程；调用方 SHALL 通过 CLI、stdin、stdout、stderr 和退出码完成显示器查询、预览、开始、状态通知与停止，且 SHALL NOT 要求 Recorder 源码根、`pyproject.toml` 或 `uv`。

#### Scenario: 调用方准备并通过全局快捷键完成录制
- **WHEN** 调用方以合法显示器和输出根启动 Worker，Worker 报告 `armed` 后用户在目标应用中第一次按全局快捷键开始、第二次按快捷键停止
- **THEN** Worker SHALL 只在第一次快捷键之后创建和记录资产，正常完成 MP4 和输入日志、输出 `completed` 状态并以零退出码结束

#### Scenario: 调用方在准备状态取消
- **WHEN** Worker 处于 `armed` 且 stdin 收到 `stop` 或 EOF
- **THEN** Worker SHALL 注销全局快捷键、输出 `cancelled` 并以零退出码结束，且不得创建录制目录

#### Scenario: 父进程关闭控制通道
- **WHEN** Worker 已开始实际录制且其 stdin 到达 EOF
- **THEN** Worker SHALL 尝试正常停止并完成资产，不得继续成为失去所有者的后台录制进程

#### Scenario: 宿主 Python 未提供 Recorder
- **WHEN** Python executable 不存在、无法启动或未安装 `cua_recorder`
- **THEN** 调用方 SHALL 返回可执行诊断且不得创建录制目录

