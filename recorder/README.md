# CUA Windows Recorder

Windows-only Python 录制 Worker。execution Review 服务通过 CLI 与 stdio 控制该进程；视频由 PyAV 调用 wheel 内置的 FFmpeg 库捕获和编码，键鼠由 Python 标准库 `ctypes` 调用 Win32 Hook 记录。Python CUA Agent 不提供直接录制 Tool，通过 `cua_workbench` 打开录制页面。

开发环境：

```powershell
cd recorder
uv sync --locked
uv run python -m unittest discover -s tests -v
uv run cua-recorder doctor
uv run cua-recorder displays --preview-dir .local/previews
```

`uv sync --locked` 会安装固定版本的 PyAV Windows wheel，用户无需另行安装或配置 `ffmpeg.exe`。Worker 不下载媒体制品。组件安装环境把 `cua-recorder` wheel 与其他组件 wheels 安装到统一 Python；源码开发使用本目录已同步的 `.venv`。
验证版本、Windows wheel 校验值、捆绑库版本与许可证审查边界见
[`PYAV_ARTIFACT.md`](./PYAV_ARTIFACT.md)。

## 运行要求

- Windows 10/11、Python 3.11+、`uv`；桌面悬浮条需要 Windows 10 2004 或更高版本。
- 经过公司审批的 `av==18.1.0` Windows wheel；其捆绑库必须包含 `gdigrab`、`h264_mf` 和 MP4 muxer。
- 可通过 `uv run cua-recorder doctor` 在部署前验证 PyAV 与捆绑库版本和能力；诊断信息写入 stderr，机器协议始终写入 stdout JSONL。

## 独立调用

```powershell
uv run cua-recorder displays --preview-dir .local/previews
uv run cua-recorder record --display-id display-0 --output-root C:\recordings
```

Worker 在实际录制开始后收到 stdin 的一行 `stop` 或 EOF，会正常封装 MP4；如果仍处于 `armed`，相同控制则取消且不创建资产。成功产物为
`<output-root>/Recording_YYYYMMDD_HHMMSS/inputs/<same-name>.mp4` 和同 basename 的 `.txt`。
写入期间只存在 `.partial` 文件，失败产物不会被 catalog 识别为可处理录制。

Worker 启动后先进入 `armed`，不会立即创建录制目录。深色圆角悬浮条默认水平居中，位于所选屏幕高度约 80% 的中下部。三角形图标用于开始录制，垃圾桶图标用于放弃准备；录制中显示计时与方形停止图标。启动和保存期间显示动态圆点并禁用重复操作。悬浮条只显示图标和数字计时，右侧拖动区域可以移动悬浮条。用户也可以通过 `Ctrl+Shift+F9` 开始和正常停止；准备阶段收到 `stop`/EOF 会取消且不产生录制。

悬浮条与快捷键共用录制会话，计时以视频首帧时钟为原点。工具窗不主动激活，使用 Windows 捕获排除能力，不进入录制视频；其点击、滚轮和完整拖动手势不会进入键鼠日志。画面排除设置失败时明确报错，不继续录制。独立 CLI 可指定 `--no-overlay` 使用纯快捷键与 stdin 控制。输入日志不会包含录制控制快捷键。

`CUA_TEST_DESKTOP_OVERLAY=1` 可启用 `tests/test_overlay_win32.py` 中的桌面集成测试，验证当前 gdigrab 环境中的画面排除、背景完整性和启动焦点；该测试会短暂显示测试窗口。

输入日志使用 Aloha 的物理按键 press/release、鼠标按下/释放、双击、滚轮与拖拽消息格式。英文字母会在录制时结合 Shift 与 CapsLock 状态写入真实大小写；数字行和 OEM 标点键按照标准美式键盘布局结合 Shift 写入对应字符。该静态映射不还原其他键盘布局或中文输入法最终提交文本。
`Ctrl+V` 事件会附带当时 Windows 剪贴板中的 Unicode 文本快照；非文本或暂时不可读取的剪贴板不附带文本。鼠标右键按下/释放使用独立的 `RClick`/`RRelease` 消息。
鼠标坐标会换算为所选显示器视频的局部坐标；所选屏幕之外的新鼠标动作不会写入日志。

视频与输入以第一张桌面帧的单调时钟为共同原点。MP4 保持配置的固定帧率；实际采集不足时复制上一帧补齐真实经过时间，避免视频被压短后与键鼠事件持续漂移。点击证据截图以第一次鼠标按下前 0.1 秒为准，而动作排序仍可使用松开时间。

## 能力边界与排障

- 不支持暂停、音频、摄像头、跨平台、安全桌面、UAC、锁屏或 `Ctrl+Alt+Delete`。
- 记录的是物理键事件，不尝试还原中文输入法最终提交的文本。
- 网页刷新屏幕截图失败时，先运行 `doctor`；能力缺失错误会明确列出 `gdigrab`、`h264_mf` 或 MP4 muxer，编码器打开失败会保留 PyAV/FFmpeg 原生错误。
- 控制进程通过 CLI 与 stdio 启动 Worker，不导入其内部 Hook 模块。
- Review 通过 `CUA_PYTHON_EXECUTABLE` 使用已经安装 `cua_recorder` 的宿主 Python；源码开发未设置时使用相邻 `recorder/.venv`。录制输出只来自已验证的 `CUA_RECORDINGS_ROOT`，浏览器不能提交任意输出路径。
