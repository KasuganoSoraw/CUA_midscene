# PyAV Windows 制品记录

录制器直接依赖 `av==18.1.0`，通过 `pyproject.toml` 和 `uv.lock` 固定。用户执行
`uv sync --locked` 后即可录制，不需要安装或配置 `ffmpeg.exe`。

## Windows x64 wheel

- 文件：`av-18.1.0-cp311-abi3-win_amd64.whl`
- 来源：PyPI `https://files.pythonhosted.org/`
- SHA-256：`ea1480b7a8d5405cb5f382b344731bf125fd2c1c6fae3964f6c48595628387ff`
- 大小：27,595,679 bytes

完整 URL、其他平台 wheel 和各自校验值由 `uv.lock` 保存。发布环境应使用
`uv sync --locked` 或内部镜像中的同一校验制品，不允许在应用运行时下载依赖。

## 本机验证结果

在 Windows x64、PyAV 18.1.0 上验证：

- `gdigrab` 输入格式可打开所选显示器并保留物理矩形；
- `h264_mf` 编码器可在 `nv12`、显式码率及 `rate_control=cbr` 下打开；
- MP4 muxer 可在停止时 flush 并写入可重新解码的 H.264 MP4；
- 静态 PNG 预览、CLI 首帧握手、stdin `stop`、原子完成均可用；
- 现有 recording catalog 将 MP4+TXT 标记为 ready；
- `record/Aloha_Learn` 使用的 OpenCV 可打开视频并读取帧。

运行时报告的 FFmpeg 库版本：

```text
libavutil      60.26.102
libavcodec     62.28.102
libavformat    62.12.102
libavdevice    62.3.102
libavfilter    11.14.102
libswscale     9.5.102
libswresample  6.3.102
```

可执行 `uv run cua-recorder doctor` 在部署目标上重新检查版本和能力。

## 许可证边界

PyAV 源码采用 BSD-3-Clause，但 wheel 同时包含 FFmpeg 及其构建依赖。公司审批和
SBOM 不能只记录 PyAV 的许可证，还必须以固定 wheel 的实际构建清单为准。录制器
只请求 Windows Media Foundation 的 `h264_mf`，不会静默改用 `libx264`；是否批准
该 wheel 及其全部捆绑组件仍由公司开源软件流程决定。
