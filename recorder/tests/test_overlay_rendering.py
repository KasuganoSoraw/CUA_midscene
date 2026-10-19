from __future__ import annotations

import ctypes
import sys
import unittest
from ctypes import wintypes as wt

from cua_recorder.models import DisplayInfo
from cua_recorder.overlay_win32 import RecorderOverlay, _configure_api, _rgb


class BitmapInfoHeader(ctypes.Structure):
    _fields_ = [
        ("size", wt.DWORD),
        ("width", wt.LONG),
        ("height", wt.LONG),
        ("planes", wt.WORD),
        ("bit_count", wt.WORD),
        ("compression", wt.DWORD),
        ("image_size", wt.DWORD),
        ("x_resolution", wt.LONG),
        ("y_resolution", wt.LONG),
        ("colors_used", wt.DWORD),
        ("colors_important", wt.DWORD),
    ]


@unittest.skipUnless(sys.platform == "win32", "需要 Windows GDI")
class CircleRenderingTest(unittest.TestCase):
    def test_circles_have_blended_edges_at_multiple_display_scales(self) -> None:
        user = ctypes.WinDLL("user32", use_last_error=True)
        gdi = ctypes.WinDLL("gdi32", use_last_error=True)
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        _configure_api(user, gdi, kernel)
        gdi.CreateDIBSection.restype = wt.HBITMAP
        gdi.CreateDIBSection.argtypes = [
            wt.HDC,
            ctypes.POINTER(BitmapInfoHeader),
            wt.UINT,
            ctypes.POINTER(ctypes.c_void_p),
            wt.HANDLE,
            wt.DWORD,
        ]
        gdi.GetPixel.restype = wt.DWORD
        gdi.GetPixel.argtypes = [wt.HDC, ctypes.c_int, ctypes.c_int]
        background, foreground = _rgb(49, 49, 53), _rgb(240, 82, 90)
        for scale in (1.0, 1.25, 1.5, 2.0):
            for diameter in (2.5, 8.0):
                with self.subTest(scale=scale, diameter=diameter):
                    toolbar = RecorderOverlay(
                        DisplayInfo(
                            "display-0", "DISPLAY0", 0, 0, 0, 1920, 1080, scale, True
                        ),
                        lambda _command: None,
                    )
                    toolbar._gdi = gdi
                    header = BitmapInfoHeader()
                    header.size = ctypes.sizeof(header)
                    header.width, header.height = 64, -64
                    header.planes, header.bit_count = 1, 32
                    pixels = ctypes.c_void_p()
                    dc = gdi.CreateCompatibleDC(None)
                    bitmap = gdi.CreateDIBSection(
                        dc, ctypes.byref(header), 0, ctypes.byref(pixels), None, 0
                    )
                    self.assertTrue(dc and bitmap)
                    old_bitmap = gdi.SelectObject(dc, bitmap)
                    brush = gdi.CreateSolidBrush(background)
                    old_brush = gdi.SelectObject(dc, brush)
                    old_pen = gdi.SelectObject(dc, gdi.GetStockObject(8))
                    try:
                        gdi.Rectangle(dc, 0, 0, 64, 64)
                        toolbar._shape(
                            dc,
                            foreground,
                            (10, 10, 10 + diameter, 10 + diameter),
                            circle=True,
                        )
                        colors = {
                            int(gdi.GetPixel(dc, x, y))
                            for y in range(8, 45)
                            for x in range(8, 45)
                        }
                        self.assertIn(background, colors)
                        self.assertTrue(
                            colors - {background, foreground}, "圆形边缘应有混合像素"
                        )
                        self.assertEqual(background, gdi.GetPixel(dc, 0, 0))
                    finally:
                        gdi.SelectObject(dc, old_pen)
                        gdi.SelectObject(dc, old_brush)
                        gdi.SelectObject(dc, old_bitmap)
                        gdi.DeleteObject(brush)
                        gdi.DeleteObject(bitmap)
                        gdi.DeleteDC(dc)


if __name__ == "__main__":
    unittest.main()
