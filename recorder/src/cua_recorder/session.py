from __future__ import annotations

import os
import queue
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable, TextIO

from .events import AlohaEventFormatter, write_log_header
from .hooks import Win32HookRecorder
from .hotkey import HOTKEY_LABEL, GlobalHotkeyToggle, HotkeyInputFilter
from .media import MediaCapabilities, PyAVVideoRecorder
from .models import DisplayInfo
from .protocol import RecorderError
from .windows import caps_lock_enabled, foreground_window_label, input_thresholds, require_output_root


StatusSink = Callable[[str, object], None]


def _recording_directory(root: Path, now: datetime) -> tuple[str, Path]:
    base = f"Recording_{now.strftime('%Y%m%d_%H%M%S')}"
    for suffix in range(1000):
        recording_id = base if suffix == 0 else f"{base}_{suffix:03d}"
        target = root / recording_id
        try:
            target.mkdir()
            return recording_id, target
        except FileExistsError:
            continue
    raise RecorderError(f"无法在一秒内分配录制目录：{base}")


class RecordingSession:
    def __init__(
        self,
        *,
        capabilities: MediaCapabilities,
        display: DisplayInfo,
        output_root: Path,
        framerate: int = 30,
        include_injected: bool = True,
        video_factory: Callable[..., PyAVVideoRecorder] = PyAVVideoRecorder,
        hook_factory: Callable[..., Win32HookRecorder] = Win32HookRecorder,
        hotkey_factory: Callable[..., GlobalHotkeyToggle] = GlobalHotkeyToggle,
    ) -> None:
        self._capabilities = capabilities
        self._display = display
        self._output_root = require_output_root(output_root)
        self._framerate = framerate
        self._include_injected = include_injected
        self._video_factory = video_factory
        self._hook_factory = hook_factory
        self._hotkey_factory = hotkey_factory
        self._video: PyAVVideoRecorder | None = None
        self._hook: Win32HookRecorder | None = None
        self._hotkey: GlobalHotkeyToggle | None = None
        self._stopped = False

    def run(self, control_stream: TextIO, status: Callable[..., None]) -> dict[str, object]:
        signals: queue.Queue[str] = queue.Queue()
        self._hotkey = self._hotkey_factory(lambda: signals.put("toggle"))
        try:
            self._hotkey.start()
            status("armed", hotkey=HOTKEY_LABEL)
            threading.Thread(
                target=_read_control,
                args=(control_stream, signals),
                name="cua-recorder-control",
                daemon=True,
            ).start()
            if signals.get() != "toggle":
                status("cancelled")
                return {"cancelled": True}

            return self._record(signals, status)
        finally:
            if self._hotkey:
                self._hotkey.stop()
                self._hotkey = None

    def _record(self, signals: queue.Queue[str], status: Callable[..., None]) -> dict[str, object]:
        now = datetime.now()
        recording_id, recording_root = _recording_directory(self._output_root, now)
        inputs = recording_root / "inputs"
        inputs.mkdir()
        final_video = inputs / f"{recording_id}.mp4"
        final_log = inputs / f"{recording_id}.txt"
        temporary_video = inputs / f"{recording_id}.mp4.partial"
        temporary_log = inputs / f"{recording_id}.txt.partial"
        status("starting", recording_id=recording_id)
        self._video = self._video_factory(
            self._capabilities,
            self._display,
            temporary_video,
            framerate=self._framerate,
        )
        try:
            started_ns = self._video.start()
        except BaseException:
            self._stop_video_after_failure()
            raise

        started_at = datetime.now() - timedelta(
            seconds=max(0, time.perf_counter_ns() - started_ns) / 1_000_000_000,
        )
        try:
            with temporary_log.open("w", encoding="utf-8", newline="\n") as log_stream:
                write_log_header(log_stream, started_at=started_at, display=self._display)
                thresholds = input_thresholds()
                formatter = AlohaEventFormatter(
                    log_stream,
                    started_ns=started_ns,
                    window_provider=foreground_window_label,
                    include_injected=self._include_injected,
                    coordinate_origin=(self._display.left, self._display.top),
                    coordinate_size=(self._display.width, self._display.height),
                    caps_lock_on=caps_lock_enabled(),
                    **thresholds,
                )
                hotkey_filter = HotkeyInputFilter(formatter.handle)
                self._hook = self._hook_factory(hotkey_filter.handle)
                self._hook.start()
                status(
                    "recording",
                    recording_id=recording_id,
                    video=str(final_video),
                    log=str(final_log),
                    started_at=started_at.isoformat(timespec="milliseconds"),
                )
                try:
                    signals.get()
                finally:
                    self._hook.stop()
                    self._hook = None
                    hotkey_filter.finish()
                    formatter.finish(time.perf_counter_ns())

            status("stopping", recording_id=recording_id)
            self._finish_video()
            if not temporary_video.is_file() or temporary_video.stat().st_size == 0:
                raise RecorderError("PyAV 未生成非空视频文件")
            if not temporary_log.is_file() or temporary_log.stat().st_size == 0:
                raise RecorderError("键鼠记录器未生成非空日志文件")
            os.replace(temporary_video, final_video)
            os.replace(temporary_log, final_log)
            result = {
                "recording_id": recording_id,
                "recording_root": str(recording_root),
                "video": str(final_video),
                "log": str(final_log),
                "duration_ms": (time.perf_counter_ns() - started_ns) // 1_000_000,
            }
            status("completed", **result)
            return result
        except BaseException:
            if self._hook:
                self._hook.stop()
                self._hook = None
            self._stop_video_after_failure()
            raise

    def stop(self) -> None:
        if self._stopped:
            return
        self._stopped = True
        if self._hook:
            self._hook.stop()
            self._hook = None
        self._finish_video()

    def _finish_video(self) -> None:
        if self._video is None:
            return
        video = self._video
        self._video = None
        video.stop()

    def _stop_video_after_failure(self) -> None:
        if self._video is None:
            return
        video = self._video
        self._video = None
        try:
            video.stop(timeout=3.0)
        except RecorderError:
            pass


def _read_control(control_stream: TextIO, signals: queue.Queue[str]) -> None:
    try:
        for line in control_stream:
            if line.strip().lower() == "stop":
                return
    finally:
        signals.put("stop")
