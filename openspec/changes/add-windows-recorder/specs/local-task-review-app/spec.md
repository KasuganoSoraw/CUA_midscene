## ADDED Requirements

### Requirement: 本地 review 应用提供 Windows 录制控制区
本地 review 应用 SHALL 在现有网页中提供录制控制区，并 SHALL 允许用户刷新显示器静态预览、选择一个目标显示器、查看由 `CUA_RECORDINGS_ROOT` 配置的输出根、准备录制和取消/紧急停止；实际开始和正常停止 SHALL 可通过页面提示的 Windows 全局快捷键在目标应用中完成，首版 SHALL NOT 展示暂停操作。

#### Scenario: 用户从双屏预览开始录制
- **WHEN** 用户刷新得到两个显示器预览，在服务已配置有效 `CUA_RECORDINGS_ROOT` 时选择其中一个并点击准备录制
- **THEN** 页面 SHALL 调用本地录制 API，在 Worker 报告 `armed` 后自动收起配置控件，提示用户切换到目标应用并使用全局快捷键开始；进入 `recording` 后展示时长、快捷键和紧急停止按钮

#### Scenario: 必要选择不完整
- **WHEN** 用户未选择显示器、`CUA_RECORDINGS_ROOT` 缺失或无效，或录制器能力检查失败
- **THEN** 页面 SHALL 禁用开始操作并展示可执行的中文诊断

### Requirement: 本地 review 服务串行编排录制 Worker
review server SHALL 作为单个录制会话的所有者提供状态、刷新显示器、读取配置输出根、准备和取消/停止 API，并 SHALL 使用无 shell 子进程协议调用 Python Worker；首版 SHALL 拒绝并发录制。

#### Scenario: 已有录制正在运行
- **WHEN** 服务处于 `arming`、`armed`、`starting`、`recording` 或 `stopping` 且收到另一次准备请求
- **THEN** 服务 SHALL 拒绝请求并返回当前状态，不得拉起第二个 Worker

#### Scenario: Worker 异常退出
- **WHEN** Worker 在完成前以非零状态退出或控制协议非法
- **THEN** 服务 SHALL 转为 `failed`、保留摘要诊断并允许用户在确认状态后重新开始

### Requirement: 本地服务使用环境变量配置录制根
本地 review 服务 SHALL 按现有配置优先级从进程环境、`execution/.env.local` 或 `execution/.env` 读取 `CUA_RECORDINGS_ROOT`，并 SHALL 只向页面返回已验证的绝对目录用于显示和后续准备请求；浏览器 SHALL NOT 打开系统目录选择器或提交任意输出路径。

#### Scenario: 服务读取有效目录
- **WHEN** 服务启动时从配置中解析到存在的绝对录制目录
- **THEN** 页面 SHALL 显示该目录并允许将其作为新录制的输出根

#### Scenario: 未配置录制目录
- **WHEN** 服务未解析到 `CUA_RECORDINGS_ROOT`
- **THEN** 页面 SHALL 禁用准备操作并提示在 `execution/.env.local` 中配置后重启服务
