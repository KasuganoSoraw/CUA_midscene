# CUA Windows Recorder

Windows-only Python 录制 Worker。当前由 execution Review 服务通过 CLI 与 stdio 控制；视频由 PyAV 调用 wheel 内置的 FFmpeg 库捕获和编码，键鼠由 Python 标准库 `ctypes` 调用 Win32 Hook 记录。Python CUA Agent 当前没有直接录制 Tool，只能通过 `cua_workbench` 打开录制页面。

开发环境：

```powershell
cd recorder
uv sync --locked
uv run python -m unittest discover -s tests -v
uv run cua-recorder doctor
uv run cua-recorder displays --preview-dir .local/previews
```

`uv sync --locked` 会安装固定版本的 PyAV Windows wheel，用户无需另行安装或配置 `ffmpeg.exe`。Worker 自身不会下载媒体制品；当前源码 Review 使用 `uv run` 启动 Worker，因此开发环境必须提前完成 locked sync。未来产品集成应直接调用安装阶段准备好的 `cua-recorder` executable。
当前验证版本、Windows wheel 校验值、捆绑库版本与许可证审查边界见
[`PYAV_ARTIFACT.md`](./PYAV_ARTIFACT.md)。

## 运行要求

- Windows 10/11、Python 3.11+、`uv`。
- 经过公司审批的 `av==18.1.0` Windows wheel；其捆绑库必须包含 `gdigrab`、`h264_mf` 和 MP4 muxer。
- 可通过 `uv run cua-recorder doctor` 在部署前验证 PyAV 与捆绑库版本和能力；诊断信息写入 stderr，机器协议始终写入 stdout JSONL。

## 独立调用

```powershell
uv run cua-recorder displays --preview-dir .local/previews
uv run cua-recorder record --display-id display-0 --output-root C:\recordings
```

Worker 在实际录制开始后收到 stdin 的一行 `stop` 或 EOF，会正常封装 MP4；如果仍处于 `armed`，相同控制则取消且不创建资产。成功产物为
`<output-root>/Recording_YYYYMMDD_HHMMSS/inputs/<same-name>.mp4` 和同 basename 的 `.txt`。
写入期间只存在 `.partial` 文件，失败产物不会被现有 catalog 识别为可处理录制。

Worker 启动后先进入 `armed`，不会立即创建录制目录。用户切换到目标应用并按 `Ctrl+Shift+F9` 开始，再按一次正常停止；准备阶段收到 `stop`/EOF 会取消且不产生录制。输入日志不会包含这组控制快捷键。

输入日志保留 Aloha 的物理按键 press/release、鼠标按下/释放、双击、滚轮与拖拽消息格式。英文字母会在录制时结合 Shift 与 CapsLock 状态写入真实大小写；中文输入法最终提交文本仍不在首版范围内。
鼠标坐标会换算为所选显示器视频的局部坐标；所选屏幕之外的新鼠标动作不会写入日志。

视频与输入以第一张桌面帧的单调时钟为共同原点。MP4 保持配置的固定帧率；实际采集不足时复制上一帧补齐真实经过时间，避免视频被压短后与键鼠事件持续漂移。点击证据截图以第一次鼠标按下前 0.1 秒为准，而动作排序仍可使用松开时间。

## 首版边界与排障

- 不支持暂停、音频、摄像头、跨平台、安全桌面、UAC、锁屏或 `Ctrl+Alt+Delete`。
- 记录的是物理键事件，不尝试还原中文输入法最终提交的文本。
- 网页刷新屏幕截图失败时，先运行 `doctor`；能力缺失错误会明确列出 `gdigrab`、`h264_mf` 或 MP4 muxer，编码器打开失败会保留 PyAV/FFmpeg 原生错误。
- Worker 可被 Fastify 或未来 Python Agent 作为独立子进程拉起；调用方不应导入其内部 Hook 模块。
- Review 默认从 `CUA_RECORDER_ROOT` 或源码相邻 `recorder/` 定位 Worker；录制输出只来自已验证的 `CUA_RECORDINGS_ROOT`，浏览器不能提交任意输出路径。
