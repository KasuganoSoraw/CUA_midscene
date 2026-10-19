from __future__ import annotations

import io
import tempfile
import time
import unittest
from pathlib import Path

from cua_recorder.media import MediaCapabilities
from cua_recorder.models import DisplayInfo
from cua_recorder.protocol import RecorderError
from cua_recorder.session import RecordingSession


class SuccessfulVideo:
    def __init__(self, _capabilities: object, _display: object, output_path: Path, **_options: object) -> None:
        self.output_path = output_path

    def start(self, timeout: float = 20.0) -> int:
        del timeout
        self.output_path.write_bytes(b"fake-mp4")
        return time.perf_counter_ns()

    def stop(self, timeout: float = 15.0) -> None:
        del timeout


class FailedVideo(SuccessfulVideo):
    def start(self, timeout: float = 20.0) -> int:
        del timeout
        raise RecorderError("PyAV 在首帧前失败：encoder failed")


class FakeHook:
    def __init__(self, _sink: object, **_options: object) -> None:
        self.started = False

    def start(self) -> None:
        self.started = True

    def stop(self) -> None:
        self.started = False


class ToggleHotkey:
    def __init__(self, callback: object) -> None:
        self.callback = callback

    def start(self) -> None:
        self.callback()  # type: ignore[operator]

    def stop(self) -> None:
        pass


class WaitingHotkey(ToggleHotkey):
    def start(self) -> None:
        pass


class FakeOverlay:
    def __init__(self, _display: object, command: object) -> None:
        self.command = command
        self.stopped = False
        self.events: list[str] = []
        self.origin: int | None = None
        self.failure = False

    def start(self) -> None:
        pass

    def update(self, phase: str, started_ns: int | None = None) -> None:
        self.events.append(phase)
        self.origin = started_ns
        if phase == "armed":
            self.command("toggle")  # type: ignore[operator]
        if phase == "recording":
            self.command("stop")  # type: ignore[operator]

    def contains_point(self, _x: int, _y: int) -> bool:
        return False

    def check(self) -> None:
        if self.failure:
            raise RecorderError("悬浮条异常")

    def stop(self) -> None:
        self.stopped = True


def capabilities() -> MediaCapabilities:
    return MediaCapabilities("test", {"libavcodec": (1, 2, 3)}, True, True, True)


def display() -> DisplayInfo:
    return DisplayInfo("display-0", "DISPLAY0", 0, 0, 0, 1920, 1080, 1.0, True)


class RecordingSessionTest(unittest.TestCase):
    def test_toolbar_startup_failure_closes_window_without_creating_assets(self) -> None:
        overlays: list[FakeOverlay] = []

        class FailedStartOverlay(FakeOverlay):
            def start(self) -> None:
                raise RecorderError("无法将录制悬浮条排除出画面")

        def factory(display: object, command: object) -> FailedStartOverlay:
            overlay = FailedStartOverlay(display, command)
            overlays.append(overlay)
            return overlay

        with tempfile.TemporaryDirectory() as temporary:
            session = RecordingSession(
                capabilities=capabilities(), display=display(), output_root=Path(temporary),
                video_factory=SuccessfulVideo, hook_factory=FakeHook,
                hotkey_factory=WaitingHotkey, overlay_factory=factory,
            )
            with self.assertRaisesRegex(RecorderError, "排除出画面"):
                session.run(io.StringIO(""), lambda *_args, **_payload: None)
            self.assertTrue(overlays[0].stopped)
            self.assertEqual([], list(Path(temporary).iterdir()))

    def test_cancel_from_toolbar_closes_window_without_creating_assets(self) -> None:
        overlays: list[FakeOverlay] = []

        class CancelOverlay(FakeOverlay):
            def update(self, phase: str, started_ns: int | None = None) -> None:
                self.events.append(phase)
                if phase == "armed":
                    self.command("stop")  # type: ignore[operator]

        def factory(display: object, command: object) -> CancelOverlay:
            overlay = CancelOverlay(display, command)
            overlays.append(overlay)
            return overlay

        with tempfile.TemporaryDirectory() as temporary:
            session = RecordingSession(
                capabilities=capabilities(), display=display(), output_root=Path(temporary),
                hotkey_factory=WaitingHotkey, overlay_factory=factory,
            )
            result = session.run(io.StringIO(""), lambda *_args, **_payload: None)
            self.assertEqual({"cancelled": True}, result)
            self.assertEqual(["armed", "cancelled"], overlays[0].events)
            self.assertTrue(overlays[0].stopped)
            self.assertEqual([], list(Path(temporary).iterdir()))

    def test_hotkey_cleanup_error_still_closes_toolbar(self) -> None:
        overlays: list[FakeOverlay] = []

        class FailedStopHotkey(WaitingHotkey):
            def stop(self) -> None:
                raise RecorderError("快捷键清理失败")

        def factory(display: object, command: object) -> FakeOverlay:
            overlay = FakeOverlay(display, command)
            overlays.append(overlay)
            return overlay

        with tempfile.TemporaryDirectory() as temporary:
            session = RecordingSession(
                capabilities=capabilities(), display=display(), output_root=Path(temporary),
                video_factory=SuccessfulVideo, hook_factory=FakeHook,
                hotkey_factory=FailedStopHotkey, overlay_factory=factory,
            )
            with self.assertRaisesRegex(RecorderError, "快捷键清理失败"):
                session.run(io.StringIO("stop\n"), lambda *_args, **_payload: None)
            self.assertTrue(overlays[0].stopped)

    def test_toolbar_uses_same_session_states_and_is_closed_after_publish(self) -> None:
        overlays: list[FakeOverlay] = []
        def factory(display: object, command: object) -> FakeOverlay:
            overlay = FakeOverlay(display, command)
            overlays.append(overlay)
            return overlay

        with tempfile.TemporaryDirectory() as temporary:
            session = RecordingSession(
                capabilities=capabilities(), display=display(), output_root=Path(temporary),
                video_factory=SuccessfulVideo, hook_factory=FakeHook,
                hotkey_factory=WaitingHotkey, overlay_factory=factory,
            )
            result = session.run(io.StringIO("stop\n"), lambda *_args, **_payload: None)
            self.assertTrue(Path(str(result["video"])).is_file())
            self.assertEqual(["armed", "starting", "recording", "stopping", "completed"], overlays[0].events)
            self.assertIsNotNone(overlays[0].origin)
            self.assertTrue(overlays[0].stopped)

    def test_toolbar_error_stops_without_publishing_assets(self) -> None:
        class FailedOverlay(FakeOverlay):
            def update(self, phase: str, started_ns: int | None = None) -> None:
                super().update(phase, started_ns)
                if phase == "recording":
                    self.failure = True
        with tempfile.TemporaryDirectory() as temporary:
            session = RecordingSession(
                capabilities=capabilities(), display=display(), output_root=Path(temporary),
                video_factory=SuccessfulVideo, hook_factory=FakeHook,
                hotkey_factory=WaitingHotkey, overlay_factory=FailedOverlay,
            )
            with self.assertRaisesRegex(RecorderError, "悬浮条异常"):
                session.run(io.StringIO("stop\n"), lambda *_args, **_payload: None)
            self.assertEqual([], list(Path(temporary).rglob("*.mp4")))
            self.assertEqual([], list(Path(temporary).rglob("*.txt")))

    def test_success_atomically_exposes_final_pair(self) -> None:
        events: list[str] = []
        with tempfile.TemporaryDirectory() as temporary:
            session = RecordingSession(
                capabilities=capabilities(),
                display=display(),
                output_root=Path(temporary),
                video_factory=SuccessfulVideo,
                hook_factory=FakeHook,
                hotkey_factory=ToggleHotkey,
            )
            result = session.run(io.StringIO("stop\n"), lambda event, **_payload: events.append(event))

            self.assertEqual(["armed", "starting", "recording", "stopping", "completed"], events)
            self.assertTrue(Path(str(result["video"])).is_file())
            self.assertTrue(Path(str(result["log"])).is_file())
            self.assertIn("Recording Stopped", Path(str(result["log"])).read_text(encoding="utf-8"))
            inputs = Path(str(result["recording_root"])) / "inputs"
            self.assertEqual(1, len(list(inputs.glob("*.mp4"))))
            self.assertEqual(1, len(list(inputs.glob("*.txt"))))
            self.assertEqual([], list(inputs.glob("*.partial")))

    def test_failure_does_not_expose_final_pair(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            session = RecordingSession(
                capabilities=capabilities(),
                display=display(),
                output_root=Path(temporary),
                video_factory=FailedVideo,
                hook_factory=FakeHook,
                hotkey_factory=ToggleHotkey,
            )
            with self.assertRaisesRegex(RecorderError, "首帧前失败"):
                session.run(io.StringIO("stop\n"), lambda _event, **_payload: None)

            self.assertEqual([], list(Path(temporary).rglob("*.mp4")))
            self.assertEqual([], list(Path(temporary).rglob("*.txt")))

    def test_cancel_while_armed_creates_no_recording_directory(self) -> None:
        events: list[str] = []
        with tempfile.TemporaryDirectory() as temporary:
            session = RecordingSession(
                capabilities=capabilities(),
                display=display(),
                output_root=Path(temporary),
                video_factory=SuccessfulVideo,
                hook_factory=FakeHook,
                hotkey_factory=WaitingHotkey,
            )
            result = session.run(io.StringIO(""), lambda event, **_payload: events.append(event))

            self.assertEqual({"cancelled": True}, result)
            self.assertEqual(["armed", "cancelled"], events)
            self.assertEqual([], list(Path(temporary).iterdir()))


if __name__ == "__main__":
    unittest.main()
