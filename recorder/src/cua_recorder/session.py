from __future__ import annotations

import os
import queue
import shutil
import threading
import time
from collections.abc import Callable
from datetime import datetime, timedelta
from pathlib import Path
from typing import TextIO

from .clipboard import read_clipboard_text
from .events import AlohaEventFormatter, write_log_header
from .hooks import Win32HookRecorder
from .hotkey import HOTKEY_LABEL, GlobalHotkeyToggle, HotkeyInputFilter
from .media import MediaCapabilities, PyAVVideoRecorder
from .models import DisplayInfo
from .overlay_win32 import RecorderOverlay
from .protocol import RecorderError
from .windows import (
    caps_lock_enabled,
    foreground_window_label,
    input_thresholds,
    require_output_root,
)

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
        overlay_factory: Callable[..., RecorderOverlay] | None = None,
    ) -> None:
        self._capabilities = capabilities
        self._display = display
        self._output_root = require_output_root(output_root)
        self._framerate = framerate
        self._include_injected = include_injected
        self._video_factory = video_factory
        self._hook_factory = hook_factory
        self._hotkey_factory = hotkey_factory
        self._overlay_factory = overlay_factory
        self._overlay: RecorderOverlay | None = None
        self._started_ns: int | None = None
        self._video: PyAVVideoRecorder | None = None
        self._hook: Win32HookRecorder | None = None
        self._hotkey: GlobalHotkeyToggle | None = None
        self._stopped = False

    def run(self, control_stream: TextIO, status: Callable[..., None]) -> dict[str, object]:
        signals: queue.Queue[str] = queue.Queue()
        self._hotkey = self._hotkey_factory(lambda: signals.put("toggle"))
        try:
            if self._overlay_factory:
                self._overlay = self._overlay_factory(self._display, signals.put)
                self._overlay.start()
            self._hotkey.start()
            self._emit(status, "armed", hotkey=HOTKEY_LABEL)
            threading.Thread(
                target=_read_control,
                args=(control_stream, signals),
                name="cua-recorder-control",
                daemon=True,
            ).start()
            if self._next_signal(signals) != "toggle":
                self._emit(status, "cancelled")
                return {"cancelled": True}

            return self._record(signals, status)
        finally:
            try:
                if self._hotkey:
                    self._hotkey.stop()
                    self._hotkey = None
            finally:
                if self._overlay:
                    self._overlay.stop()
                    self._overlay = None

    def _emit(self, status: Callable[..., None], event: str, **payload: object) -> None:
        if self._overlay:
            self._overlay.update(event, self._started_ns)
        status(event, **payload)

    def _next_signal(self, signals: queue.Queue[str]) -> str:
        signal = signals.get()
        if self._overlay:
            self._overlay.check()
        return signal

    def _record(self, signals: queue.Queue[str], status: Callable[..., None]) -> dict[str, object]:
        now = datetime.now()
        recording_id, recording_root = _recording_directory(self._output_root, now)
        inputs = recording_root / "inputs"
        inputs.mkdir()
        final_video = inputs / f"{recording_id}.mp4"
        final_log = inputs / f"{recording_id}.txt"
        temporary_video = inputs / f"{recording_id}.mp4.partial"
        temporary_log = inputs / f"{recording_id}.txt.partial"
        self._emit(status, "starting", recording_id=recording_id)
        started_ns = self._start_video(temporary_video)

        started_at = datetime.now() - timedelta(
            seconds=max(0, time.perf_counter_ns() - started_ns) / 1_000_000_000,
        )
        try:
            signal = self._capture_log(
                temporary_log, started_at, started_ns, recording_id, final_video, final_log,
                signals, status,
            )

            self._emit(status, "stopping", recording_id=recording_id)
            if signal == "abort":
                return self._discard_recording(recording_root, status)
            self._finish_video()
            result = self._publish_recording(
                recording_id, recording_root, temporary_video, temporary_log,
                final_video, final_log, started_ns,
            )
            self._emit(status, "completed", **result)
            return result
        except BaseException:
            if self._hook:
                self._hook.stop()
                self._hook = None
            self._stop_video_after_failure()
            raise

    def _start_video(self, temporary_video: Path) -> int:
        self._video = self._video_factory(
            self._capabilities, self._display, temporary_video, framerate=self._framerate,
        )
        try:
            self._started_ns = self._video.start()
            return self._started_ns
        except BaseException:
            self._stop_video_after_failure()
            raise

    def _discard_recording(self, root: Path, status: Callable[..., None]) -> dict[str, object]:
        try:
            self._finish_video()
        finally:
            if root.parent.resolve() != self._output_root.resolve():
                raise RecorderError("录制清理目录越界")
            shutil.rmtree(root)
        self._emit(status, "cancelled", reason="user_aborted")
        return {"cancelled": True}

    def _publish_recording(
        self, recording_id: str, recording_root: Path,
        temporary_video: Path, temporary_log: Path,
        final_video: Path, final_log: Path, started_ns: int,
    ) -> dict[str, object]:
        if not temporary_video.is_file() or temporary_video.stat().st_size == 0:
            raise RecorderError("PyAV 未生成非空视频文件")
        if not temporary_log.is_file() or temporary_log.stat().st_size == 0:
            raise RecorderError("键鼠记录器未生成非空日志文件")
        os.replace(temporary_video, final_video)
        os.replace(temporary_log, final_log)
        return {
            "recording_id": recording_id,
            "recording_root": str(recording_root),
            "video": str(final_video),
            "log": str(final_log),
            "duration_ms": (time.perf_counter_ns() - started_ns) // 1_000_000,
        }

    def _capture_log(
        self, temporary_log: Path, started_at: datetime, started_ns: int,
        recording_id: str, final_video: Path, final_log: Path,
        signals: queue.Queue[str], status: Callable[..., None],
    ) -> str:
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
                clipboard_provider=read_clipboard_text,
                **thresholds,
            )
            hotkey_filter = HotkeyInputFilter(formatter.handle)
            hook_options: dict[str, object] = {}
            if self._overlay:
                hook_options["exclude_point"] = self._overlay.contains_point
            self._hook = self._hook_factory(hotkey_filter.handle, **hook_options)
            self._hook.start()
            self._emit(
                status, "recording", recording_id=recording_id,
                video=str(final_video), log=str(final_log),
                started_at=started_at.isoformat(timespec="milliseconds"),
            )
            try:
                return self._next_signal(signals)
            finally:
                self._hook.stop()
                self._hook = None
                hotkey_filter.finish()
                formatter.finish(time.perf_counter_ns())

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
    for line in control_stream:
        command = line.strip().lower()
        if command in ("stop", "finish", "abort"):
            signals.put("stop" if command == "finish" else command)
            return
    signals.put("stop")
