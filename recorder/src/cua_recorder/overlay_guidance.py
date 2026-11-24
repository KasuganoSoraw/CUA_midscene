from __future__ import annotations

import ctypes
import math
from ctypes import wintypes as wt
from typing import Any

from .models import DisplayInfo
from .protocol import RecorderError


BORDER_WIDTH = 10
BORDER_COLOR = (101, 185, 94)
NOTICE_TEXT = "请将需要录制的窗口放在绿框范围内，并确保后续操作窗口不超出绿框范围。"
NOTICE_TEXT_EN = "Place the window to record inside the green box, and make sure later windows stay within it."
NOTICE_TEXT_BY_LANGUAGE = {"zh-CN": NOTICE_TEXT, "en-US": NOTICE_TEXT_EN}
NOTICE_FONT_SIZE = 14
ACTIVE_PHASES = {"arming", "armed", "starting", "recording", "stopping"}


def _rgb(red: int, green: int, blue: int) -> int:
    return red | (green << 8) | (blue << 16)


class RecordingGuidance:
    """固定在所选屏幕的边框与准备提示；点击穿透并排除出录制画面。"""

    def __init__(self, display: DisplayInfo, user: Any, gdi: Any, paint_type: type[ctypes.Structure], language: str = "zh-CN") -> None:
        self.display, self.user, self.gdi = display, user, gdi
        self.hwnd = 0
        self._font = 0
        self._phase = ""
        self._notice = False
        self._notice_text = NOTICE_TEXT_BY_LANGUAGE.get(language, NOTICE_TEXT)
        self._paint_type = paint_type

    def px(self, value: float) -> int:
        return round(value * self.display.scale_factor)

    def notice_rect(self) -> tuple[int, int, int, int]:
        width = min(self.px(560), self.display.width - self.px(36))
        text_width = max(1, width - self.px(64))
        lines = math.ceil(self.px(NOTICE_FONT_SIZE) * len(self._notice_text) / text_width)
        height = self.px(max(56, lines * 22 + 24))
        left = (self.display.width - width) // 2
        top = self.px(14)
        return left, top, left + width, top + height

    def create(self, class_name: str, instance: int) -> None:
        display = self.display
        self.hwnd = self.user.CreateWindowExW(
            0x08000000 | 0x00000080 | 0x00000008 | 0x00080000 | 0x00000020,
            class_name, "CUA 录制屏幕范围", 0x80000000,
            display.left, display.top, display.width, display.height,
            None, None, instance, None,
        )
        if not self.hwnd:
            raise RecorderError("无法创建录制屏幕边框")
        if not self.user.SetLayeredWindowAttributes(self.hwnd, 0, 255, 2):
            raise RecorderError("无法设置录制屏幕边框的点击穿透")
        if not self.user.SetWindowDisplayAffinity(self.hwnd, 0x11):
            raise RecorderError("无法将录制屏幕边框和提示排除出画面")
        self._font = self.gdi.CreateFontW(
            -self.px(NOTICE_FONT_SIZE), 0, 0, 0, 400,
            0, 0, 0, 1, 0, 0, 5, 0, "Microsoft YaHei UI",
        )
        if not self._font:
            raise RecorderError("无法创建录制屏幕提示字体")
        self.update("arming")

    def update(self, phase: str) -> None:
        if not self.hwnd or phase == self._phase:
            return
        notice = phase in {"arming", "armed"}
        if not self._phase or notice != self._notice:
            self._set_region(notice)
        self._phase, self._notice = phase, notice
        flags = 0x0013 | (0x0040 if phase in ACTIVE_PHASES else 0x0080)
        if not self.user.SetWindowPos(self.hwnd, ctypes.c_void_p(-1), 0, 0, 0, 0, flags):
            raise RecorderError("无法更新录制屏幕边框")
        self.user.InvalidateRect(self.hwnd, None, False)

    def _set_region(self, notice: bool) -> None:
        width, height = self.display.width, self.display.height
        border = self.px(BORDER_WIDTH)
        region = self.gdi.CreateRectRgn(0, 0, width, height)
        inner = self.gdi.CreateRectRgn(border, border, width - border, height - border)
        tip = 0
        try:
            if not region or not inner:
                raise RecorderError("无法创建录制屏幕边框区域")
            if not self.gdi.CombineRgn(region, region, inner, 4):
                raise RecorderError("无法镂空录制屏幕边框")
            if notice:
                tip = self.gdi.CreateRoundRectRgn(*self.notice_rect(), self.px(12), self.px(12))
                if not tip or not self.gdi.CombineRgn(region, region, tip, 2):
                    raise RecorderError("无法创建录制屏幕提示区域")
            if not self.user.SetWindowRgn(self.hwnd, region, True):
                raise RecorderError("无法设置录制屏幕边框区域")
            region = 0  # SetWindowRgn 成功后由系统拥有。
        finally:
            for handle in (tip, inner, region):
                if handle:
                    self.gdi.DeleteObject(handle)

    def handle_message(self, message: int) -> int | None:
        if message == 0x0021:
            return 3  # MA_NOACTIVATE
        if message == 0x0084:
            return -1  # HTTRANSPARENT
        if message == 0x0014:
            return 1
        if message == 0x000F:
            self._paint()
            return 0
        if message == 0x8002:
            self.close()
            return 0
        if message == 0x0002:
            self.hwnd = 0
            return 0
        return None

    def _paint(self) -> None:
        paint = self._paint_type()
        dc = self.user.BeginPaint(self.hwnd, ctypes.byref(paint))
        try:
            width, height = self.display.width, self.display.height
            border = self.px(BORDER_WIDTH)
            for rect in ((0, 0, width, border), (0, height - border, width, height),
                         (0, border, border, height - border),
                         (width - border, border, width, height - border)):
                self._fill(dc, rect, BORDER_COLOR)
            if self._notice:
                self._paint_notice(dc)
        finally:
            self.user.EndPaint(self.hwnd, ctypes.byref(paint))

    def _fill(self, dc: int, rect: tuple[int, int, int, int], color: tuple[int, int, int]) -> None:
        brush = self.gdi.CreateSolidBrush(_rgb(*color))
        if not brush:
            raise RecorderError("无法创建录制屏幕提示画刷")
        try:
            if not self.user.FillRect(dc, ctypes.byref(wt.RECT(*rect)), brush):
                raise RecorderError("无法绘制录制屏幕提示")
        finally:
            self.gdi.DeleteObject(brush)

    def _paint_notice(self, dc: int) -> None:
        left, top, right, bottom = self.notice_rect()
        self._fill(dc, (left, top, right, bottom), (242, 247, 255))
        old_font = self.gdi.SelectObject(dc, self._font)
        try:
            self.gdi.SetBkMode(dc, 1)
            self._paint_info_icon(dc, left + self.px(16), (top + bottom) // 2)
            self.gdi.SetTextColor(dc, _rgb(30, 30, 30))
            rect = wt.RECT(left + self.px(40), top + self.px(12), right - self.px(16), bottom - self.px(12))
            self.user.DrawTextW(dc, self._notice_text, -1, ctypes.byref(rect), 0x0410 | 0x0800)
            text_height = rect.bottom - rect.top
            rect.top = top + (bottom - top - text_height) // 2
            rect.bottom = rect.top + text_height
            self.user.DrawTextW(dc, self._notice_text, -1, ctypes.byref(rect), 0x0010 | 0x0800)
        finally:
            self.gdi.SelectObject(dc, old_font)

    def _paint_info_icon(self, dc: int, left: int, center_y: int) -> None:
        brush = self.gdi.CreateSolidBrush(_rgb(0, 158, 222))
        if not brush:
            raise RecorderError("无法创建录制屏幕提示图标")
        old_brush = self.gdi.SelectObject(dc, brush)
        old_pen = self.gdi.SelectObject(dc, self.gdi.GetStockObject(8))
        try:
            self.gdi.Ellipse(dc, left, center_y - self.px(8), left + self.px(16), center_y + self.px(8))
            self.gdi.SetTextColor(dc, _rgb(255, 255, 255))
            rect = wt.RECT(left, center_y - self.px(8), left + self.px(16), center_y + self.px(8))
            self.user.DrawTextW(dc, "i", -1, ctypes.byref(rect), 0x0025 | 0x0800)
        finally:
            self.gdi.SelectObject(dc, old_pen)
            self.gdi.SelectObject(dc, old_brush)
            self.gdi.DeleteObject(brush)

    def close(self) -> None:
        if self.hwnd:
            self.user.DestroyWindow(self.hwnd)
            self.hwnd = 0
        if self._font:
            self.gdi.DeleteObject(self._font)
            self._font = 0
