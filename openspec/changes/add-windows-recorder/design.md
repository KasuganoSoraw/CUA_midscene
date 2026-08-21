## Context

现有 review 应用由本地 Fastify 服务和 Vue 页面组成，已经能够动态发现 `CUA_RECORDINGS_ROOT` 下包含一个 MP4 与一个输入日志的录制目录，并通过 `uv run python` 子进程调用 `record/` 后处理器。原始采集仍依赖不开源的 showui-aloha，因此新实现必须保持现有资产和进程边界，同时为未来 Python Agent 提供独立、稳定的调用入口。

首版只支持 Windows 10/11。公司对开源依赖引入严格，因此录制器不引入 pynput、DXcam、Electron 或 GUI 工具包；视频侧只引入一个经审批并固定版本的 PyAV Windows wheel，并审查其捆绑的 FFmpeg 原生库。

## Goals / Non-Goals

**Goals:**

- 在现有 review 网页中完成显示器预览、环境变量输出根展示和录制准备，并允许用户在目标应用中通过全局快捷键开始和停止实际录制。
- 以独立 Python Worker 生成现有处理器可消费的 H.264 MP4 与 JSONL 风格 TXT 输入日志。
- 以 PyAV 对 FFmpeg 原生库的进程内绑定承担屏幕捕获、编码和 MP4 封装，以 Python `ctypes` 承担 Windows 键鼠 Hook。
- 保持 Worker 可由当前 TypeScript 服务或未来 Python Agent 通过同一 CLI/stdio 协议拉起。
- 对子进程失败、重复启动、非法显示器、非法输出路径和未完成文件显式失败并保留诊断信息。

**Non-Goals:**

- 暂停/恢复、音频、摄像头、跨平台、录制回放或输入注入。
- 捕获安全桌面、UAC、锁屏、`Ctrl+Alt+Delete` 或保证游戏 Raw Input 完整性。
- 解析中文输入法最终提交文本；首版记录与现有 Aloha 日志一致的物理按键 press/release。
- 新增独立桌面 GUI、录制数据库、索引文件或会话令牌。

## Decisions

### Python Worker 保持独立进程和无 GUI 边界

新增独立 `recorder/` Python 3.11+ 工程。CLI 提供显示器查询/预览与长生命周期录制命令；录制命令通过 stdout 输出 JSONL 状态、stderr 输出诊断、stdin 接收 `stop` 或 EOF。当前 Fastify 使用 `spawn` 且关闭 shell，未来 Python Agent 使用等价的 subprocess API，不要求调用方导入录制内部模块。

选择独立进程而不是把 Hook 放入 Fastify 或 Agent，是为了隔离全局 Hook、PyAV 原生库和消息循环故障，并允许录制器独立打包升级。

### PyAV 作为唯一直接第三方录制组件

Worker 导入固定且可验证的 PyAV wheel，通过 `libavdevice` 的 `gdigrab` 按所选显示器物理矩形捕获，并通过 `h264_mf` 输出 H.264 MP4。PyAV 在独立 Python Worker 内运行，视频帧不跨越 Worker 进程边界。启动时探测 `gdigrab`、`h264_mf` 和 MP4 muxer，缺少能力时显式失败，不静默改用不同编码格式。

桌面内容包含小字号文字、图标和高频边缘。`gdigrab` 解码得到的原始帧会携带 I-frame 类型，送入 H.264 编码器前必须重置为 `PictureType.NONE`，否则每一帧都会被强制编码为关键帧，既破坏压缩效率，也会在低码率时产生严重宏块。`h264_mf` 使用目标 5 Mbps 的 unconstrained VBR、质量 80、`archive` 场景和 6 秒 GOP，使静态桌面主要依靠帧间压缩，并允许复杂变化短时增加码率。

用户无需安装或配置 `ffmpeg.exe`。实现不得在运行时联网下载二进制；发布流程固定 PyAV wheel 版本和校验值，并记录其捆绑 FFmpeg 的版本、构建配置和许可证信息。

### Win32 低级 Hook 由 Python 标准库实现

通过 `ctypes` 安装 `WH_KEYBOARD_LL` 与 `WH_MOUSE_LL`。Hook 运行在专用消息循环线程，回调只复制结构体、读取单调时间并写入有界内存队列，然后立即调用 `CallNextHookEx`。写盘、活动窗口查询、键名格式化和双击/拖拽派生在消费线程完成。

事件日志继续输出 `timestamp`、`message`、`window` 三字段，并兼容当前 `Key Press/Release`、`LClick/LRelease/LDoubleClick`、`DragStart/DragMove/DragEnd` 与 `ScrollUp/ScrollDown` 文本。双击和拖拽阈值读取 Windows 系统设置；原始 down/up 状态始终保留在派生规则内部。

### 单一时钟和启动握手

Worker 使用 `time.perf_counter_ns()` 作为视频/输入共享的单调基准。只有 PyAV 捕获首帧并成功提交编码后才安装输入 Hook 并输出 `recording` 状态，避免把捕获器和编码器启动延迟算入键鼠时间轴。停止时先冻结输入、排空队列，再结束捕获循环、flush 编码器并关闭 MP4 container；关闭失败时以失败退出。

### 网页只负责准备，全局快捷键控制实际录制边界

网页提交显示器和输出根后，Worker 先以 `RegisterHotKey` 注册带 `MOD_NOREPEAT` 的 `Ctrl+Shift+F9`，进入 `armed`，但此时不创建录制目录、不启动视频也不记录键鼠。用户切换到目标应用后第一次按快捷键才进入 `starting`，完成首帧握手后进入 `recording`；再次按相同快捷键则进入 `stopping`。录制器不播放系统提示音，状态反馈由网页轮询提供；网页停止 API 在 `armed` 时取消准备、在实际录制时作为紧急停止兜底。

停止快捷键本身不得进入 Aloha 输入日志。录制 Hook 在消费线程对 Ctrl/Shift/F9 序列做有界延迟识别：命中完整快捷键时丢弃该序列，普通组合键则按原时间戳和顺序继续输出。快捷键注册冲突必须在 `armed` 之前显式失败。

### 复用现有文件系统 catalog 契约

每次录制创建 `<root>/<recording-id>/inputs/`，其中恰好写入同 basename 的 `.mp4` 与 `.txt`。录制中使用临时后缀，成功完成后原子改名；失败保留诊断但不得留下会被 catalog 识别为 ready 的完整文件对。不新增 metadata/index 文件，日志头部继续携带 `video_start_time` 与 `screen_info`。

### Fastify 作为控制面和唯一会话所有者

review server 维护单个录制会话状态 `idle | arming | armed | starting | recording | stopping | failed`，提供状态、刷新显示器、读取配置输出根、准备、取消/停止和预览资源 API。首版拒绝并发录制。服务退出或 stdin 断开时，`armed` 状态取消准备，实际录制状态正常停止，超时后终止进程树。

输出根唯一使用现有配置优先级解析的 `CUA_RECORDINGS_ROOT`（进程环境、`execution/.env.local`、`execution/.env`）；浏览器不打开系统目录对话框，也不能提交任意文件写入路径。服务启动时解析目录，开始录制前再次校验其存在、为绝对路径且可写。

### 现有网页内提供轻量录制控制区

Vue 页面展示每个显示器的一次性截图、编号、尺寸、缩放与主屏标记；刷新按钮显式重新截图。用户选择显示器且服务已解析到 `CUA_RECORDINGS_ROOT` 后才能进入准备状态，页面只读展示该目录。`armed` 后控制区收起并明确提示用户切换到目标应用、按全局快捷键开始；`recording` 时展示计时、快捷键和紧急停止按钮；首版不显示暂停。

## Risks / Trade-offs

- [PyAV wheel 捆绑的 FFmpeg 缺少 `gdigrab`、`h264_mf` 或 MP4 muxer] → 启动前能力探测并在 UI 显示明确缺失项；目标 Windows 使用固定 wheel 做真实 smoke test。
- [低级 Hook 回调超时后被系统静默移除] → 专用线程和常数时间入队，禁止在回调中写盘或查询窗口，并通过长时间输入压力测试验证。
- [视频首帧与输入时间轴偏移] → 启动握手后才开始记录输入，保存启动诊断并在 smoke test 中测量可接受偏差。
- [多屏负坐标和 DPI 导致坐标错位] → 进程启动即设置 Per-Monitor DPI awareness，日志使用虚拟桌面物理坐标并覆盖左右/上下布局测试。
- [PyAV wheel 与其捆绑 FFmpeg 的许可证边界] → 只接受经过公司审批的固定 wheel，记录运行时 `library_configurations`，录制只请求 `h264_mf` 而不静默使用 `libx264`。
- [Python Hook 不能观察安全桌面或最终 IME 文本] → 在 UI/文档明确首版边界，保持物理按键格式与现有处理器一致。
- [全局快捷键被其他应用占用或停止快捷键污染输入日志] → 准备时检查 `RegisterHotKey` 返回值并明确失败；输入消费层识别并过滤完整控制快捷键，保留其他普通组合键。

## Migration Plan

1. 在分支中加入 Python Worker 和纯单元测试，验证生命周期及资产布局。
2. 在目标 Windows 环境固定 PyAV wheel，完成能力探测以及单屏、双屏、负坐标、DPI 和长时间录制 smoke test。
3. 加入 Fastify API 与 Vue 控制区；不开启自动下载，不改变现有 catalog 和处理器入口。
4. 通过环境配置逐步启用新录制器；出现问题时移除/隐藏录制控制区即可回滚，已有录制和复核能力不受影响。

## Open Questions

- 公司最终批准的 PyAV wheel 版本、来源、校验值及其捆绑 FFmpeg 许可证需在发布前固定。
- 后续是否需要以嵌入式 Python 包形式公开 API，由未来 Agent 集成阶段决定；首版以 CLI/stdio 为唯一稳定边界。
