from __future__ import annotations

import time
import threading
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path
from typing import Any, Callable

import av
from av.video.frame import PictureType

from .models import DisplayInfo
from .protocol import RecorderError


H264_MF_BIT_RATE = 5_000_000
H264_MF_QUALITY = 80
H264_MF_GOP_SECONDS = 6
NANOSECONDS_PER_SECOND = 1_000_000_000


def desktop_encoder_options() -> dict[str, str]:
    """使用有约束目标码率的帧间压缩，兼顾桌面细节与文件体积。"""
    return {
        "rate_control": "u_vbr",
        "quality": str(H264_MF_QUALITY),
        "scenario": "archive",
    }


def prepare_video_frame(
    frame: av.VideoFrame,
    *,
    width: int,
    height: int,
    frame_index: int,
    time_base: Fraction,
) -> av.VideoFrame:
    encoded = frame.reformat(width=width, height=height, format="nv12")
    # gdigrab/rawvideo 帧会被标记为 I 帧；若不清除，编码器会把每一帧都当关键帧。
    encoded.pict_type = PictureType.NONE
    encoded.pts = frame_index
    encoded.time_base = time_base
    return encoded


def video_slot_at(elapsed_ns: int, framerate: int, *, round_up: bool) -> int:
    """把统一单调时钟映射到 CFR 帧槽；向上取整可避免未来画面提前出现。"""
    numerator = max(0, elapsed_ns) * framerate
    if round_up:
        return (numerator + NANOSECONDS_PER_SECOND - 1) // NANOSECONDS_PER_SECOND
    return numerator // NANOSECONDS_PER_SECOND


@dataclass(frozen=True, slots=True)
class MediaCapabilities:
    pyav_version: str
    library_versions: dict[str, tuple[int, ...]]
    has_gdigrab: bool
    has_h264_mf: bool
    has_mp4: bool

    @property
    def ready(self) -> bool:
        return self.has_gdigrab and self.has_h264_mf and self.has_mp4


def inspect_media() -> MediaCapabilities:
    return MediaCapabilities(
        pyav_version=av.__version__,
        library_versions={name: tuple(version) for name, version in av.library_versions.items()},
        has_gdigrab="gdigrab" in av.formats_available,
        has_h264_mf="h264_mf" in av.codecs_available,
        has_mp4="mp4" in av.formats_available,
    )


def require_recording_capabilities(capabilities: MediaCapabilities) -> None:
    missing: list[str] = []
    if not capabilities.has_gdigrab:
        missing.append("Windows 捕获器 gdigrab")
    if not capabilities.has_h264_mf:
        missing.append("Media Foundation H.264 编码器 h264_mf")
    if not capabilities.has_mp4:
        missing.append("MP4 muxer")
    if missing:
        raise RecorderError("PyAV 捆绑的 FFmpeg 库缺少录制能力：" + "、".join(missing))


def _capture_options(display: DisplayInfo, *, framerate: int, draw_mouse: bool) -> dict[str, str]:
    return {
        "draw_mouse": "1" if draw_mouse else "0",
        "framerate": str(framerate),
        "offset_x": str(display.left),
        "offset_y": str(display.top),
        "video_size": f"{display.width}x{display.height}",
    }


def capture_preview(
    capabilities: MediaCapabilities,
    display: DisplayInfo,
    output_path: Path,
    *,
    timeout: float = 20.0,
) -> Path:
    require_recording_capabilities(capabilities)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    source: Any = None
    output: Any = None
    try:
        source = av.open(
            "desktop",
            format="gdigrab",
            options=_capture_options(display, framerate=1, draw_mouse=False),
            timeout=(timeout, timeout),
        )
        frame = next(source.decode(video=0))
        width = min(480, frame.width)
        height = max(2, round(frame.height * width / frame.width))
        height -= height % 2
        preview = frame.reformat(width=width, height=height, format="rgb24")

        output = av.open(str(output_path), mode="w", format="image2")
        stream = output.add_stream("png", rate=1)
        stream.width = width
        stream.height = height
        stream.pix_fmt = "rgb24"
        for packet in stream.encode(preview):
            output.mux(packet)
        for packet in stream.encode(None):
            output.mux(packet)
    except (StopIteration, OSError, av.FFmpegError) as error:
        raise RecorderError(f"显示器 {display.id} 预览失败：{error}") from error
    finally:
        if source is not None:
            source.close()
        if output is not None:
            output.close()
    if not output_path.is_file() or output_path.stat().st_size == 0:
        raise RecorderError(f"显示器 {display.id} 预览失败：PyAV 未生成 PNG")
    return output_path.resolve()


class PyAVVideoRecorder:
    def __init__(
        self,
        capabilities: MediaCapabilities,
        display: DisplayInfo,
        output_path: Path,
        *,
        framerate: int = 30,
        clock_ns: Callable[[], int] = time.perf_counter_ns,
    ) -> None:
        require_recording_capabilities(capabilities)
        self._display = display
        self._output_path = output_path
        self._framerate = framerate
        self._clock_ns = clock_ns
        self._stop_requested = threading.Event()
        self._ready = threading.Event()
        self._finished = threading.Event()
        self._thread: threading.Thread | None = None
        self._error: BaseException | None = None
        self._origin_ns: int | None = None
        self._stop_ns: int | None = None

    def start(self, timeout: float = 20.0) -> int:
        if self._thread is not None:
            raise RecorderError("PyAV 视频录制器已启动")
        self._thread = threading.Thread(target=self._run, name="cua-pyav-video", daemon=True)
        self._thread.start()
        if not self._ready.wait(timeout):
            self._stop_requested.set()
            if self._error is not None:
                raise RecorderError(f"PyAV 在首帧前失败：{self._error}") from self._error
            raise RecorderError(f"等待 PyAV 首帧超时（{timeout:g} 秒）")
        if self._error is not None:
            raise RecorderError(f"PyAV 在首帧前失败：{self._error}") from self._error
        if self._origin_ns is None:
            raise RecorderError("PyAV 首帧就绪但未建立视频时钟原点")
        return self._origin_ns

    def stop(self, timeout: float = 15.0) -> None:
        if self._thread is None:
            return
        if self._stop_ns is None:
            self._stop_ns = self._clock_ns()
        self._stop_requested.set()
        if not self._finished.wait(timeout):
            raise RecorderError(f"等待 PyAV 正常停止超时（{timeout:g} 秒）")
        if self._error is not None:
            raise RecorderError(f"PyAV 录制失败：{self._error}") from self._error

    def _run(self) -> None:
        source: Any = None
        output: Any = None
        try:
            source = av.open(
                "desktop",
                format="gdigrab",
                options=_capture_options(self._display, framerate=self._framerate, draw_mouse=True),
                timeout=(20.0, 20.0),
            )
            output = av.open(str(self._output_path), mode="w", format="mp4", options={"movflags": "+faststart"})
            stream = output.add_stream(
                "h264_mf",
                rate=self._framerate,
                options=desktop_encoder_options(),
            )
            stream.width = self._display.width
            stream.height = self._display.height
            stream.pix_fmt = "nv12"
            stream.bit_rate = H264_MF_BIT_RATE
            stream.gop_size = self._framerate * H264_MF_GOP_SECONDS
            time_base = Fraction(1, self._framerate)
            last_slot = -1
            last_frame: av.VideoFrame | None = None

            def encode_at(frame: av.VideoFrame, slot: int) -> None:
                encoded = prepare_video_frame(
                    frame,
                    width=self._display.width,
                    height=self._display.height,
                    frame_index=slot,
                    time_base=time_base,
                )
                for packet in stream.encode(encoded):
                    output.mux(packet)

            for frame in source.decode(video=0):
                if self._stop_requested.is_set():
                    break
                captured_ns = self._clock_ns()
                if self._origin_ns is None:
                    self._origin_ns = captured_ns
                    target_slot = 0
                else:
                    target_slot = video_slot_at(
                        captured_ns - self._origin_ns,
                        self._framerate,
                        round_up=True,
                    )
                if target_slot <= last_slot:
                    continue
                if last_frame is not None:
                    for slot in range(last_slot + 1, target_slot):
                        encode_at(last_frame, slot)
                encode_at(frame, target_slot)
                last_frame = frame
                last_slot = target_slot
                if last_slot == 0:
                    self._ready.set()
            if last_frame is None or self._origin_ns is None:
                raise RecorderError("gdigrab 在结束前未产生视频帧")
            if self._stop_ns is not None:
                stop_slot = video_slot_at(
                    self._stop_ns - self._origin_ns,
                    self._framerate,
                    round_up=False,
                )
                for slot in range(last_slot + 1, stop_slot + 1):
                    encode_at(last_frame, slot)
            for packet in stream.encode(None):
                output.mux(packet)
        except BaseException as error:
            self._error = error
            self._ready.set()
        finally:
            try:
                if source is not None:
                    source.close()
                if output is not None:
                    output.close()
            except BaseException as error:
                if self._error is None:
                    self._error = error
            self._ready.set()
            self._finished.set()
