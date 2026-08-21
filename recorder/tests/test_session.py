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
    def __init__(self, _sink: object) -> None:
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


def capabilities() -> MediaCapabilities:
    return MediaCapabilities("test", {"libavcodec": (1, 2, 3)}, True, True, True)


def display() -> DisplayInfo:
    return DisplayInfo("display-0", "DISPLAY0", 0, 0, 0, 1920, 1080, 1.0, True)


class RecordingSessionTest(unittest.TestCase):
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
