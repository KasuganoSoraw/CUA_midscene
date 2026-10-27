from __future__ import annotations

import ctypes
import queue
import unittest
from types import SimpleNamespace

from cua_recorder.hooks import (
    HC_ACTION,
    MSLLHOOKSTRUCT,
    WM_LBUTTONDOWN,
    WM_LBUTTONUP,
    WM_MOUSEMOVE,
    Win32HookRecorder,
)
from cua_recorder.models import DisplayInfo
from cua_recorder.overlay_win32 import (
    MA_NOACTIVATE,
    WM_MOUSEACTIVATE,
    RecorderOverlay,
)
from cua_recorder.overlay_win32 import (
    WM_LBUTTONDOWN as WM_DOWN,
)
from cua_recorder.overlay_win32 import (
    WM_LBUTTONUP as WM_UP,
)


class OverlayHookTest(unittest.TestCase):
    def test_ignored_toolbar_mouse_events_still_continue_system_hook_chain(
        self,
    ) -> None:
        continued: list[object] = []
        recorder = Win32HookRecorder(
            lambda _event: None, exclude_point=lambda x, _y: x < 100
        )
        user = SimpleNamespace(CallNextHookEx=lambda *args: continued.append(args) or 0)
        callback = recorder._create_mouse_callback(user)
        for message, x in [
            (WM_LBUTTONDOWN, 20),
            (WM_MOUSEMOVE, 200),
            (WM_LBUTTONUP, 200),
        ]:
            data = MSLLHOOKSTRUCT()
            data.pt.x, data.pt.y = x, 20
            callback(HC_ACTION, message, ctypes.addressof(data))
        self.assertEqual(3, len(continued))
        self.assertRaises(queue.Empty, recorder._events.get_nowait)
        for message, x in [
            (WM_LBUTTONDOWN, 200),
            (WM_MOUSEMOVE, 20),
            (WM_LBUTTONUP, 20),
        ]:
            data = MSLLHOOKSTRUCT()
            data.pt.x, data.pt.y = x, 20
            callback(HC_ACTION, message, ctypes.addressof(data))
        events = [recorder._events.get_nowait() for _ in range(3)]
        self.assertEqual(
            ["mouse_down", "mouse_move", "mouse_up"], [event.kind for event in events]
        )
        self.assertEqual(6, len(continued))


class ToolbarProbe(RecorderOverlay):
    def hit_test(self, x: int, y: int) -> str:
        return self._hit(x, y)

    def prepare_paint(self):
        self._user = SimpleNamespace(BeginPaint=lambda *_args: 1, EndPaint=lambda *_args: 1)
        self._gdi = SimpleNamespace(**{
            name: lambda *_args: 1 for name in (
                "CreateCompatibleDC", "CreateCompatibleBitmap", "SelectObject", "SetBkMode",
                "BitBlt", "DeleteObject", "DeleteDC",
            )
        })
        texts: list[str] = []
        icons: list[str] = []
        circles: list[tuple[float, float, float, float]] = []

        def shape(_dc, _color, rect, *, circle=False):
            if circle:
                circles.append(rect)

        self._shape = shape
        self._text = lambda _dc, text, *_args: texts.append(text)
        self._icon = lambda _dc, action, *_args: icons.append(action)
        return texts, icons, circles

    def paint_phase(self, phase: str) -> None:
        self._state.update(phase)
        self._paint(1)


class ToolbarButtonTest(unittest.TestCase):
    def test_button_requests_are_guarded_and_mouse_activation_does_not_steal_focus(
        self,
    ) -> None:
        commands: list[str] = []
        toolbar = RecorderOverlay(
            DisplayInfo("display-0", "DISPLAY0", 0, 0, 0, 1920, 1080, 1.0, True),
            commands.append,
        )
        toolbar._user = SimpleNamespace(
            SetCapture=lambda *_args: None,
            ReleaseCapture=lambda *_args: None,
            SetTimer=lambda *_args: None,
            InvalidateRect=lambda *_args: None,
        )
        toolbar._state.update("armed")
        for _ in range(2):
            for message in (WM_DOWN, WM_UP):
                toolbar._mouse(1, message, 122 | (24 << 16))
        self.assertEqual(["toggle"], commands)
        self.assertEqual("starting", toolbar._state.snapshot().phase)
        toolbar._state.update("recording", 0)
        for message in (WM_DOWN, WM_UP):
            toolbar._mouse(1, message, 122 | (24 << 16))
        self.assertEqual(["toggle", "stop"], commands)
        self.assertEqual(
            MA_NOACTIVATE, toolbar._handle_message(1, WM_MOUSEACTIVATE, 0, 0)
        )

    def test_cancel_icon_uses_phase_specific_control(self) -> None:
        commands: list[str] = []
        toolbar = ToolbarProbe(
            DisplayInfo("display-0", "DISPLAY0", 0, 0, 0, 1920, 1080, 1.5, True),
            commands.append,
        )
        toolbar._user = SimpleNamespace(
            SetCapture=lambda *_args: None,
            ReleaseCapture=lambda *_args: None,
            SetTimer=lambda *_args: None,
            InvalidateRect=lambda *_args: None,
        )
        toolbar._state.update("armed")
        for message in (WM_DOWN, WM_UP):
            toolbar._mouse(1, message, 243 | (36 << 16))
        self.assertEqual(["stop"], commands)
        toolbar._state.update("recording")
        self.assertEqual("cancel", toolbar.hit_test(162, 24))
        self.assertEqual("stop", toolbar._hit(122, 24))
        self.assertEqual("drag", toolbar._hit(194, 24))
        self.assertEqual("", toolbar._hit(208, 24))
        for _ in range(2):
            for message in (WM_DOWN, WM_UP):
                toolbar._mouse(1, message, 243 | (36 << 16))
        self.assertEqual(["stop", "abort"], commands)
        self.assertEqual("stopping", toolbar._state.snapshot().phase)

    def test_toolbar_only_renders_elapsed_text_and_phase_appropriate_icons(
        self,
    ) -> None:
        toolbar = ToolbarProbe(
            DisplayInfo("display-0", "DISPLAY0", 0, 0, 0, 1920, 1080, 1.0, True),
            lambda _command: None,
        )
        texts, icons, circles = toolbar.prepare_paint()
        for phase, expected in [
            ("arming", []),
            ("armed", ["start", "cancel"]),
            ("starting", []),
            ("recording", ["stop", "cancel"]),
            ("stopping", []),
        ]:
            with self.subTest(phase=phase):
                texts.clear()
                icons.clear()
                circles.clear()
                toolbar.paint_phase(phase)
                self.assertEqual(["00:00"], texts)
                self.assertEqual(expected, icons)
                grip = [rect for rect in circles if rect[0] >= 184]
                self.assertEqual(6, len(grip))
                self.assertEqual(2, len({rect[0] for rect in grip}))
                self.assertEqual(3, len({rect[1] for rect in grip}))
                self.assertIn((18, 20, 26, 28), circles)


if __name__ == "__main__":
    unittest.main()
