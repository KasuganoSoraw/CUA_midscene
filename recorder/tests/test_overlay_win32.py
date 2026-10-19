"""设置 CUA_TEST_DESKTOP_OVERLAY=1 后运行 Windows 桌面捕获排除检查。"""

from __future__ import annotations

import ctypes
import os
import sys
import time
import unittest

import av
from cua_recorder.overlay_win32 import HEIGHT, WIDTH, PaintStruct, RecorderOverlay, _rgb
from cua_recorder.windows import list_displays


class SolidBackground(RecorderOverlay):
    def _paint(self, hwnd: int) -> None:
        paint = PaintStruct()
        dc = self._user.BeginPaint(hwnd, ctypes.byref(paint))
        try:
            self._shape(dc, _rgb(234, 237, 242), (0, 0, WIDTH, HEIGHT))
        finally:
            self._user.EndPaint(hwnd, ctypes.byref(paint))


def capture_patch(left: int, top: int, width: int, height: int) -> bytes:
    with av.open(
        "desktop",
        format="gdigrab",
        options={
            "offset_x": str(left),
            "offset_y": str(top),
            "video_size": f"{width}x{height}",
            "framerate": "1",
            "draw_mouse": "0",
        },
    ) as source:
        frame = next(source.decode(video=0)).reformat(format="rgb24")
        plane = frame.planes[0]
        raw = bytes(plane)
        return b"".join(
            raw[row * plane.line_size : row * plane.line_size + width * 3]
            for row in range(height)
        )


def average_difference(left: bytes, right: bytes) -> float:
    return sum(abs(a - b) for a, b in zip(left, right, strict=True)) / len(left)


@unittest.skipUnless(
    sys.platform == "win32" and os.environ.get("CUA_TEST_DESKTOP_OVERLAY") == "1",
    "需要显式启用桌面集成测试",
)
class NativeOverlayTest(unittest.TestCase):
    def test_gdigrab_excludes_toolbar_without_black_patch_or_focus_change(self) -> None:
        display = list_displays()[0]
        background = SolidBackground(display, lambda _command: None)
        toolbar = RecorderOverlay(display, lambda _command: None)
        before = ctypes.windll.user32.GetForegroundWindow()
        try:
            background.start()
            self.assertTrue(
                background._user.SetWindowDisplayAffinity(background._hwnd, 0)
            )
            time.sleep(0.2)
            width = round(WIDTH * display.scale_factor)
            height = round(HEIGHT * display.scale_factor)
            left = display.left + (display.width - width) // 2 + 10
            top = display.top + round(20 * display.scale_factor) + 10
            baseline = capture_patch(left, top, width - 20, height - 20)
            toolbar.start()
            toolbar.update("armed")
            time.sleep(0.2)
            toolbar.check()
            excluded = capture_patch(left, top, width - 20, height - 20)
            self.assertLess(average_difference(baseline, excluded), 1.0)
            self.assertTrue(toolbar._user.SetWindowDisplayAffinity(toolbar._hwnd, 0))
            time.sleep(0.2)
            visible = capture_patch(left, top, width - 20, height - 20)
            self.assertGreater(average_difference(baseline, visible), 30.0)
            self.assertTrue(toolbar._user.SetWindowDisplayAffinity(toolbar._hwnd, 0x11))
            time.sleep(0.2)
            restored = capture_patch(left, top, width - 20, height - 20)
            self.assertLess(average_difference(baseline, restored), 1.0)
            self.assertEqual(before, ctypes.windll.user32.GetForegroundWindow())
        finally:
            toolbar.stop()
            background.stop()


if __name__ == "__main__":
    unittest.main()
