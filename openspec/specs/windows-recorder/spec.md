# windows-recorder Specification

## Purpose
定义 Windows 桌面视频与键鼠录制 Worker 的控制协议、时间轴、媒体编码和资产交付要求。

## Requirements

### Requirement: Windows 录制器以独立 Python 进程提供稳定控制协议
系统 SHALL 提供 Windows-only Python 录制 Worker，并 SHALL 通过无 shell 的 CLI、stdin、stdout、stderr 和退出码完成显示器查询、预览、开始、状态通知与停止，而不要求调用方导入录制内部实现。

#### Scenario: 调用方准备并通过全局快捷键完成录制
- **WHEN** 调用方以合法显示器和输出根启动 Worker，Worker 报告 `armed` 后用户在目标应用中第一次按全局快捷键开始、第二次按快捷键停止
- **THEN** Worker SHALL 只在第一次快捷键之后创建和记录资产，正常完成 MP4 和输入日志、输出 `completed` 状态并以零退出码结束

#### Scenario: 调用方在准备状态取消
- **WHEN** Worker 处于 `armed` 且 stdin 收到 `stop` 或 EOF
- **THEN** Worker SHALL 注销全局快捷键、输出 `cancelled` 并以零退出码结束，且不得创建录制目录

#### Scenario: 父进程关闭控制通道
- **WHEN** Worker 已开始实际录制且其 stdin 到达 EOF
- **THEN** Worker SHALL 尝试正常停止并完成资产，不得继续成为失去所有者的后台录制进程

### Requirement: 全局快捷键定义无浏览器污染的录制边界
Worker SHALL 仅使用 Python 标准库和 Win32 `RegisterHotKey` 注册带防重复标志的全局切换快捷键，并 SHALL 在 `armed` 前验证注册成功；第一次触发 SHALL 开始实际视频和输入时间轴，第二次触发 SHALL 正常停止，控制快捷键自身 SHALL NOT 写入输入日志。

#### Scenario: 用户离开 review 浏览器后开始和停止
- **WHEN** Worker 已报告 `armed`，用户切换到目标应用并按一次快捷键，完成任务后再次按快捷键
- **THEN** 视频和输入日志 SHALL 只覆盖两次快捷键之间的目标应用操作，且 SHALL 不包含开始/停止快捷键的键盘事件

#### Scenario: 快捷键被其他应用占用
- **WHEN** Win32 拒绝注册配置的快捷键
- **THEN** Worker SHALL 在创建录制目录前明确失败，review 页面 SHALL 显示可执行诊断

### Requirement: 录制器枚举并预览 Windows 显示器
系统 SHALL 使用物理像素坐标枚举当前桌面的每个显示器，并 SHALL 返回稳定会话内 ID、矩形、尺寸、DPI 缩放、主屏标记和一次性 PNG 预览；刷新操作 SHALL 重新枚举并重新截图。

#### Scenario: 双屏包含负坐标副屏
- **WHEN** 副屏位于主屏左侧或上方
- **THEN** 系统 SHALL 保留负物理坐标并为两个显示器分别生成与其内容匹配的预览

#### Scenario: 显示器拓扑在刷新前后变化
- **WHEN** 用户连接或断开显示器后执行刷新
- **THEN** 系统 SHALL 返回当前拓扑并使已经不存在的选择失效

### Requirement: PyAV 生成所选显示器的 H.264 MP4
Worker SHALL 使用经过固定和能力验证的 PyAV Windows wheel 及其捆绑 FFmpeg 库捕获所选显示器，并 SHALL 使用 `h264_mf` 生成现有处理链可读取的 MP4；用户 SHALL NOT 需要另行安装 FFmpeg，Worker SHALL NOT 在运行时下载原生制品或静默切换到其他视频编码格式。

编码器 SHALL 保存原生分辨率桌面画面，并 SHALL 在编码前清除捕获帧继承的强制 I-frame 类型，使 `h264_mf` 能使用正常帧间压缩；码率配置 SHALL 以约 5 Mbps 为目标并允许画面复杂时产生 VBR 峰值，兼顾文字可识别性和文件体积。

#### Scenario: PyAV 能力满足要求
- **WHEN** PyAV 捆绑库提供 `gdigrab`、`h264_mf` 和 MP4 muxer
- **THEN** Worker SHALL 只录制所选显示器并在正常停止后生成可播放 MP4

#### Scenario: 复杂桌面内容被录制
- **WHEN** 所选显示器包含复杂壁纸、小字号文字和密集图标
- **THEN** Worker SHALL 清除捕获帧的强制 I-frame 类型，并使用目标 5 Mbps、质量 80、6 秒 GOP 的 `h264_mf` unconstrained VBR 和 archive 场景编码原生分辨率帧

#### Scenario: PyAV 缺失所需能力
- **WHEN** PyAV 不可导入、缺少捕获能力、缺少 `h264_mf` 或缺少 MP4 muxer
- **THEN** Worker SHALL 在录制开始前以明确诊断失败且不得创建可被 catalog 识别的完整录制

### Requirement: Win32 Hook 记录兼容的键鼠事件
Worker SHALL 仅使用 Python 标准库和 Windows API 安装低级键盘与鼠标 Hook，并 SHALL 记录按键 press/release、鼠标按下/释放、移动、滚轮、双击、拖拽和活动窗口；Hook 回调 MUST 将耗时处理移交工作线程并继续 Hook 链。

#### Scenario: 用户输入普通键鼠操作
- **WHEN** 录制期间用户按下并释放按键，点击、双击、拖拽或滚动鼠标
- **THEN** TXT SHALL 按时间顺序包含当前处理器兼容的 `Key Press/Release`、点击/释放、双击、拖拽或滚轮消息及物理坐标

#### Scenario: 用户输入大小写字母
- **WHEN** 用户通过 Shift、CapsLock 或二者组合输入英文字母
- **THEN** TXT SHALL 在录制时按 `Shift XOR CapsLock` 写入真实字母大小写，并 SHALL 分别跟踪左右 Shift，后处理器不得再从大写虚拟键码猜测文本大小写

#### Scenario: 录制器收到注入输入
- **WHEN** Hook 结构标记事件为 injected
- **THEN** Worker SHALL 在内部事件中保留该标记，并 SHALL 按明确配置决定记录或过滤，不得把其误认为无法识别的 Hook 失败

### Requirement: 视频与输入共享单调时间轴
Worker SHALL 以第一张桌面帧的 `perf_counter_ns()` 建立视频与输入共享的单调起点，并 SHALL 将输入事件格式化为相对该起点的毫秒时间戳。视频 SHALL 按真实单调经过时间映射到 CFR 帧槽，采集帧不足时 SHALL 复制上一张已知帧补齐时间，而不得使用采集帧计数压缩视频时长；停止时 SHALL 先停止输入、排空日志，再补齐视频到停止时刻并正常完成视频。

#### Scenario: 编码器启动存在延迟
- **WHEN** PyAV 打开捕获设备后经过一段时间才产生首帧
- **THEN** Worker SHALL 在首帧就绪前保持 `starting` 且不得把用户输入标记为视频时间零之后的有效录制事件

#### Scenario: 实际采集速率低于目标帧率
- **WHEN** 目标为 30fps 但桌面实际只能产生较低或不均匀的采集帧率
- **THEN** MP4 SHALL 通过复制上一张已知帧保持与单调录制时长一致，视频与输入停止时间的误差 SHALL 不超过两个目标帧周期

#### Scenario: 点击动作生成证据截图
- **WHEN** 单击或双击动作由 mouse-down 与 mouse-up 合并并进入截图处理
- **THEN** 动作顺序时间 SHALL 可保留 mouse-up，而证据时间 SHALL 使用该手势第一次 mouse-down 前 0.1 秒并在零处截断

### Requirement: 输出资产兼容现有录制处理链
每次成功录制 SHALL 在调用方从 `CUA_RECORDINGS_ROOT` 解析并传入的根下创建一个一级 recording 目录，并在 `inputs/` 中生成一个 H.264 MP4 和一个同 basename 的 TXT；TXT SHALL 使用 JSON-per-line 的 `timestamp`、`message`、`window` 字段及现有配置头，不要求额外索引或 metadata 文件。

#### Scenario: 录制成功完成
- **WHEN** Worker 正常停止并完成两个资产
- **THEN** 现有 recording catalog SHALL 能在下一次扫描中发现该目录，现有 Python 处理器 SHALL 能读取其日志和视频

#### Scenario: 录制异常中止
- **WHEN** Hook、写盘或 PyAV 在完成前失败
- **THEN** Worker SHALL 以非零退出码和诊断结束，并 SHALL NOT 留下可被误识别为完整录制的最终文件对
