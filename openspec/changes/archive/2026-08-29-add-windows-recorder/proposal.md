## Why

当前原始录制依赖不开源的 showui-aloha 二进制，无法审计、维护或稳定集成到后续 Python Agent。项目需要一个 Windows-only、可由现有本地网页和未来 Agent 以子进程方式编排的开源录制实现，并继续生成现有处理链可消费的视频与键鼠日志。

## What Changes

- 新增独立 Python 录制 Worker，以稳定 CLI/stdin/stdout 协议枚举显示器、生成静态预览、开始录制和停止录制。
- 使用固定版本的 PyAV Windows wheel 直接调用其捆绑的 FFmpeg 库，以 `gdigrab` 捕获所选显示器并通过 Windows Media Foundation `h264_mf` 生成 H.264 MP4；用户无需另行安装或配置 `ffmpeg.exe`。
- 使用 Python 标准库 `ctypes` 和 Win32 低级 Hook 记录全局键盘、鼠标、滚轮、双击、拖拽及活动窗口信息，不依赖 pynput。
- 生成与现有录制处理器兼容的一级录制目录、`inputs/*.mp4` 和 `inputs/*.txt`，不增加索引数据库或额外元数据文件。
- 在现有 review Web 页面增加录制控制区：刷新显示器截图、选择目标屏幕、展示由 `CUA_RECORDINGS_ROOT` 配置的录制根并进入准备状态；用户切换到目标应用后通过 Windows 全局快捷键开始和停止实际录制，网页保留取消准备和紧急停止能力。
- 在现有 Fastify 服务增加 Windows 录制器编排 API；首版不实现暂停、音频、跨平台或会话令牌。

## Capabilities

### New Capabilities

- `windows-recorder`: 定义 Windows Python 子进程录制器、显示器选择、PyAV 视频输出、Win32 键鼠日志和生命周期契约。

### Modified Capabilities

- `local-task-review-app`: 增加在现有本地网页中配置、开始、观察和停止录制的用户界面与服务 API。
- `recording-catalog`: 允许录制服务在配置的录制根下创建与现有动态发现规则兼容的新录制目录。

## Impact

- 新增独立 `recorder/` Python 工程和 Windows-only 测试边界。
- `execution/review/server` 增加子进程编排与录制 API，`execution/review/web` 增加录制控制界面。
- 新增并固定一个经审批的 PyAV Windows wheel；其捆绑 FFmpeg 原生库的版本、构建配置和许可证仍须纳入制品审查，但不再单独分发 FFmpeg 可执行制品。
- 现有 `record/Aloha_Learn` 后处理入口、录制 catalog 和任务创建流程继续消费相同资产布局。
