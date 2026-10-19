from __future__ import annotations

import ctypes
import os
import sys
import threading
import time
from collections.abc import Callable
from ctypes import wintypes as wt
from typing import Any

from .models import DisplayInfo
from .overlay import ToolbarState
from .protocol import RecorderError

WM_PAINT = 0x000F
WM_CLOSE = 0x0010
WM_DESTROY = 0x0002
WM_TIMER = 0x0113
WM_MOUSEACTIVATE = 0x0021
WM_MOUSEMOVE = 0x0200
WM_LBUTTONDOWN = 0x0201
WM_LBUTTONUP = 0x0202
WM_CAPTURECHANGED = 0x0215
WM_DPICHANGED = 0x02E0
WM_UPDATE = 0x8001
WM_DISPOSE = 0x8002
WS_EX_NOACTIVATE = 0x08000000
WS_EX_TOOLWINDOW = 0x00000080
WS_EX_TOPMOST = 0x00000008
WS_POPUP = 0x80000000
WDA_EXCLUDEFROMCAPTURE = 0x00000011
MA_NOACTIVATE = 3
WIDTH = 208
HEIGHT = 48


class PaintStruct(ctypes.Structure):
    _fields_ = [
        ("hdc", wt.HDC),
        ("erase", wt.BOOL),
        ("rect", wt.RECT),
        ("restore", wt.BOOL),
        ("update", wt.BOOL),
        ("reserved", wt.BYTE * 32),
    ]


def _rgb(red: int, green: int, blue: int) -> int:
    return red | (green << 8) | (blue << 16)


def _configure_api(user: Any, gdi: Any, kernel: Any) -> None:
    declarations = [
        (
            user,
            "CreateWindowExW",
            wt.HWND,
            [
                wt.DWORD,
                wt.LPCWSTR,
                wt.LPCWSTR,
                wt.DWORD,
                ctypes.c_int,
                ctypes.c_int,
                ctypes.c_int,
                ctypes.c_int,
                wt.HWND,
                wt.HMENU,
                wt.HINSTANCE,
                wt.LPVOID,
            ],
        ),
        (
            user,
            "DefWindowProcW",
            ctypes.c_ssize_t,
            [wt.HWND, wt.UINT, ctypes.c_size_t, ctypes.c_ssize_t],
        ),
        (
            user,
            "PostMessageW",
            wt.BOOL,
            [wt.HWND, wt.UINT, ctypes.c_size_t, ctypes.c_ssize_t],
        ),
        (
            user,
            "SetWindowPos",
            wt.BOOL,
            [
                wt.HWND,
                wt.HWND,
                ctypes.c_int,
                ctypes.c_int,
                ctypes.c_int,
                ctypes.c_int,
                wt.UINT,
            ],
        ),
        (user, "SetWindowDisplayAffinity", wt.BOOL, [wt.HWND, wt.DWORD]),
        (user, "SetWindowRgn", ctypes.c_int, [wt.HWND, wt.HANDLE, wt.BOOL]),
        (user, "WindowFromPoint", wt.HWND, [wt.POINT]),
        (user, "GetAncestor", wt.HWND, [wt.HWND, wt.UINT]),
        (user, "GetWindowRect", wt.BOOL, [wt.HWND, ctypes.POINTER(wt.RECT)]),
        (user, "GetCursorPos", wt.BOOL, [ctypes.POINTER(wt.POINT)]),
        (user, "GetAsyncKeyState", ctypes.c_short, [ctypes.c_int]),
        (user, "SetCapture", wt.HWND, [wt.HWND]),
        (user, "ReleaseCapture", wt.BOOL, []),
        (user, "DestroyWindow", wt.BOOL, [wt.HWND]),
        (user, "InvalidateRect", wt.BOOL, [wt.HWND, ctypes.POINTER(wt.RECT), wt.BOOL]),
        (user, "BeginPaint", wt.HDC, [wt.HWND, ctypes.POINTER(PaintStruct)]),
        (user, "EndPaint", wt.BOOL, [wt.HWND, ctypes.POINTER(PaintStruct)]),
        (
            user,
            "DrawTextW",
            ctypes.c_int,
            [wt.HDC, wt.LPCWSTR, ctypes.c_int, ctypes.POINTER(wt.RECT), wt.UINT],
        ),
        (
            user,
            "SetTimer",
            ctypes.c_size_t,
            [wt.HWND, ctypes.c_size_t, wt.UINT, wt.LPVOID],
        ),
        (user, "KillTimer", wt.BOOL, [wt.HWND, ctypes.c_size_t]),
        (user, "LoadCursorW", wt.HANDLE, [wt.HINSTANCE, wt.LPVOID]),
        (
            user,
            "GetMessageW",
            ctypes.c_int,
            [ctypes.POINTER(wt.MSG), wt.HWND, wt.UINT, wt.UINT],
        ),
        (user, "DispatchMessageW", ctypes.c_ssize_t, [ctypes.POINTER(wt.MSG)]),
        (user, "TranslateMessage", wt.BOOL, [ctypes.POINTER(wt.MSG)]),
        (user, "PostQuitMessage", None, [ctypes.c_int]),
        (user, "UnregisterClassW", wt.BOOL, [wt.LPCWSTR, wt.HINSTANCE]),
        (gdi, "CreateSolidBrush", wt.HBRUSH, [wt.DWORD]),
        (gdi, "CreatePen", wt.HANDLE, [ctypes.c_int, ctypes.c_int, wt.DWORD]),
        (gdi, "CreateRoundRectRgn", wt.HANDLE, [ctypes.c_int] * 6),
        (gdi, "SelectObject", wt.HANDLE, [wt.HDC, wt.HANDLE]),
        (gdi, "DeleteObject", wt.BOOL, [wt.HANDLE]),
        (gdi, "RoundRect", wt.BOOL, [wt.HDC] + [ctypes.c_int] * 6),
        (gdi, "Ellipse", wt.BOOL, [wt.HDC] + [ctypes.c_int] * 4),
        (gdi, "Rectangle", wt.BOOL, [wt.HDC] + [ctypes.c_int] * 4),
        (gdi, "Polygon", wt.BOOL, [wt.HDC, ctypes.POINTER(wt.POINT), ctypes.c_int]),
        (gdi, "Polyline", wt.BOOL, [wt.HDC, ctypes.POINTER(wt.POINT), ctypes.c_int]),
        (
            gdi,
            "MoveToEx",
            wt.BOOL,
            [wt.HDC, ctypes.c_int, ctypes.c_int, ctypes.POINTER(wt.POINT)],
        ),
        (gdi, "LineTo", wt.BOOL, [wt.HDC, ctypes.c_int, ctypes.c_int]),
        (gdi, "SetTextColor", wt.DWORD, [wt.HDC, wt.DWORD]),
        (gdi, "SetBkMode", ctypes.c_int, [wt.HDC, ctypes.c_int]),
        (gdi, "CreateCompatibleDC", wt.HDC, [wt.HDC]),
        (
            gdi,
            "CreateCompatibleBitmap",
            wt.HBITMAP,
            [wt.HDC, ctypes.c_int, ctypes.c_int],
        ),
        (gdi, "DeleteDC", wt.BOOL, [wt.HDC]),
        (
            gdi,
            "BitBlt",
            wt.BOOL,
            [
                wt.HDC,
                ctypes.c_int,
                ctypes.c_int,
                ctypes.c_int,
                ctypes.c_int,
                wt.HDC,
                ctypes.c_int,
                ctypes.c_int,
                wt.DWORD,
            ],
        ),
        (
            gdi,
            "CreateFontW",
            wt.HANDLE,
            [ctypes.c_int] * 5 + [wt.DWORD] * 8 + [wt.LPCWSTR],
        ),
        (kernel, "GetModuleHandleW", wt.HMODULE, [wt.LPCWSTR]),
    ]
    for library, name, result, arguments in declarations:
        function = getattr(library, name)
        function.restype = result
        function.argtypes = arguments


class RecorderOverlay:
    """录制 Worker 拥有的非激活、捕获排除桌面工具窗。"""

    def __init__(self, display: DisplayInfo, command: Callable[[str], None]) -> None:
        self._display = display
        self._command = command
        self._state = ToolbarState()
        self._scale = display.scale_factor
        self._ready = threading.Event()
        self._closing = threading.Event()
        self._thread: threading.Thread | None = None
        self._error: BaseException | None = None
        self._hwnd = 0
        self._font = 0
        self._hover = ""
        self._pressed = ""
        self._drag: tuple[int, int, int, int] | None = None
        self._user: Any = None
        self._gdi: Any = None

    def start(self, timeout: float = 5.0) -> None:
        if sys.platform != "win32" or sys.getwindowsversion().build < 19041:
            raise RecorderError(
                "桌面录制悬浮条需要 Windows 10 2004 或更高版本；可使用 --no-overlay 仅通过快捷键录制"
            )
        self._thread = threading.Thread(
            target=self._run, name="cua-recorder-toolbar", daemon=True
        )
        self._thread.start()
        if not self._ready.wait(timeout):
            self.stop()
            raise RecorderError("等待桌面录制悬浮条启动超时")
        self.check()

    def update(self, phase: str, started_ns: int | None = None) -> None:
        self._state.update(phase, started_ns)
        if self._hwnd:
            self._user.PostMessageW(self._hwnd, WM_UPDATE, 0, 0)

    def contains_point(self, x: int, y: int) -> bool:
        hwnd = self._hwnd
        if not hwnd:
            return False
        hit = self._user.WindowFromPoint(wt.POINT(x, y))
        return bool(hit and self._user.GetAncestor(hit, 2) == hwnd)

    def check(self) -> None:
        if self._error is not None:
            raise RecorderError(f"桌面录制悬浮条不可用：{self._error}") from self._error

    def stop(self, timeout: float = 5.0) -> None:
        self._closing.set()
        if self._hwnd:
            self._user.PostMessageW(self._hwnd, WM_DISPOSE, 0, 0)
        if self._thread and self._thread is not threading.current_thread():
            self._thread.join(timeout)
            if self._thread.is_alive():
                raise RecorderError("等待桌面录制悬浮条关闭超时")

    def _px(self, value: int) -> int:
        return round(value * self._scale)

    def _run(self) -> None:
        user = ctypes.WinDLL("user32", use_last_error=True)
        gdi = ctypes.WinDLL("gdi32", use_last_error=True)
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self._user, self._gdi = user, gdi
        class_name = f"CUARecorderToolbar-{os.getpid()}-{id(self)}"
        instance = 0
        registered = False
        try:
            _configure_api(user, gdi, kernel)
            procedure_type = ctypes.WINFUNCTYPE(
                ctypes.c_ssize_t, wt.HWND, wt.UINT, ctypes.c_size_t, ctypes.c_ssize_t
            )

            class WindowClass(ctypes.Structure):
                _fields_ = [
                    ("style", wt.UINT),
                    ("procedure", procedure_type),
                    ("class_extra", ctypes.c_int),
                    ("window_extra", ctypes.c_int),
                    ("instance", wt.HINSTANCE),
                    ("icon", wt.HICON),
                    ("cursor", wt.HANDLE),
                    ("background", wt.HBRUSH),
                    ("menu", wt.LPCWSTR),
                    ("name", wt.LPCWSTR),
                ]

            procedure = procedure_type(self._window_proc)
            instance = kernel.GetModuleHandleW(None)
            window_class = WindowClass(
                0x0003,
                procedure,
                0,
                0,
                instance,
                None,
                user.LoadCursorW(None, 32512),
                None,
                None,
                class_name,
            )
            user.RegisterClassW.argtypes = [ctypes.POINTER(WindowClass)]
            user.RegisterClassW.restype = wt.ATOM
            if not user.RegisterClassW(ctypes.byref(window_class)):
                raise ctypes.WinError(ctypes.get_last_error())
            registered = True
            width, height = self._px(WIDTH), self._px(HEIGHT)
            self._hwnd = user.CreateWindowExW(
                WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TOPMOST,
                class_name,
                "CUA 录制控制",
                WS_POPUP,
                self._display.left + (self._display.width - width) // 2,
                self._display.top + self._display.height * 4 // 5 - height // 2,
                width,
                height,
                None,
                None,
                instance,
                None,
            )
            if not self._hwnd:
                raise ctypes.WinError(ctypes.get_last_error())
            if not user.SetWindowDisplayAffinity(self._hwnd, WDA_EXCLUDEFROMCAPTURE):
                raise RecorderError(
                    f"无法将录制悬浮条排除出画面：{ctypes.WinError(ctypes.get_last_error())}"
                )
            self._resize()
            if not user.SetTimer(self._hwnd, 1, 250, None):
                raise ctypes.WinError(ctypes.get_last_error())
            if not self._closing.is_set():
                if not user.SetWindowPos(
                    self._hwnd, ctypes.c_void_p(-1), 0, 0, 0, 0, 0x0013 | 0x0040
                ):
                    raise ctypes.WinError(ctypes.get_last_error())
            self._ready.set()
            if self._closing.is_set():
                user.DestroyWindow(self._hwnd)
            message = wt.MSG()
            while True:
                result = user.GetMessageW(ctypes.byref(message), None, 0, 0)
                if result == 0:
                    break
                if result == -1:
                    raise ctypes.WinError(ctypes.get_last_error())
                user.TranslateMessage(ctypes.byref(message))
                user.DispatchMessageW(ctypes.byref(message))
        except Exception as error:
            self._error = error
            self._command("overlay-error")
        finally:
            if self._hwnd:
                user.DestroyWindow(self._hwnd)
            if self._font:
                gdi.DeleteObject(self._font)
                self._font = 0
            if registered:
                user.UnregisterClassW(class_name, instance)
            self._ready.set()

    def _resize(self) -> None:
        if self._font:
            self._gdi.DeleteObject(self._font)
        self._font = self._gdi.CreateFontW(
            -self._px(13), 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 5, 0, "Microsoft YaHei UI"
        )
        if not self._font:
            raise RecorderError("无法创建录制悬浮条字体")
        region = self._gdi.CreateRoundRectRgn(
            0, 0, self._px(WIDTH), self._px(HEIGHT), self._px(20), self._px(20)
        )
        if not self._user.SetWindowRgn(self._hwnd, region, True):
            self._gdi.DeleteObject(region)
            raise RecorderError("无法设置录制悬浮条圆角区域")

    def _hit(self, x: int, y: int) -> str:
        if not (0 <= x < WIDTH and 0 <= y < HEIGHT):
            return ""
        if x >= 184:
            return "drag"
        phase = self._state.snapshot().phase
        if phase == "armed":
            if 104 <= x < 140:
                return "start"
            if 144 <= x < 180:
                return "cancel"
        if phase == "recording" and 104 <= x < 140:
            return "stop"
        return ""

    def _window_proc(self, hwnd: int, message: int, wparam: int, lparam: int) -> int:
        try:
            return self._handle_message(hwnd, message, wparam, lparam)
        except Exception as error:
            self._error = error
            self._command("overlay-error")
            self._user.PostMessageW(hwnd, WM_DISPOSE, 0, 0)
            return 0

    def _handle_message(self, hwnd: int, message: int, wparam: int, lparam: int) -> int:
        if message == WM_MOUSEACTIVATE:
            return MA_NOACTIVATE  # 保留点击，不激活窗口。
        if message == 0x0014:
            return 1
        if message == WM_PAINT:
            self._paint(hwnd)
            return 0
        if message == WM_TIMER and self._drag is not None:
            if self._user.GetAsyncKeyState(1) & 0x8000:
                self._move_drag(hwnd)
            else:
                self._pressed, self._drag = "", None
                self._user.ReleaseCapture()
                self._user.SetTimer(hwnd, 1, 250, None)
        if message in (WM_UPDATE, WM_TIMER):
            self._user.InvalidateRect(hwnd, None, False)
            return 0
        if message in (WM_MOUSEMOVE, WM_LBUTTONDOWN, WM_LBUTTONUP):
            self._mouse(hwnd, message, lparam)
            return 0
        if message == WM_CAPTURECHANGED:
            self._pressed, self._drag = "", None
            self._user.SetTimer(hwnd, 1, 250, None)
            return 0
        if message == WM_DPICHANGED:
            self._scale = (wparam & 0xFFFF) / 96.0
            rect = ctypes.cast(lparam, ctypes.POINTER(wt.RECT)).contents
            self._user.SetWindowPos(
                hwnd,
                None,
                rect.left,
                rect.top,
                self._px(WIDTH),
                self._px(HEIGHT),
                0x0014,
            )
            self._resize()
            return 0
        if message == WM_CLOSE:
            self._command("stop")
            return 0
        if message == WM_DISPOSE:
            self._user.DestroyWindow(hwnd)
            return 0
        if message == WM_DESTROY:
            self._user.KillTimer(hwnd, 1)
            self._hwnd = 0
            self._user.PostQuitMessage(0)
            return 0
        return int(self._user.DefWindowProcW(hwnd, message, wparam, lparam))

    def _mouse(self, hwnd: int, message: int, lparam: int) -> None:
        x = ctypes.c_short(lparam & 0xFFFF).value / self._scale
        y = ctypes.c_short((lparam >> 16) & 0xFFFF).value / self._scale
        hit = self._hit(int(x), int(y))
        if message == WM_LBUTTONDOWN:
            self._pressed = hit
            if hit:
                self._user.SetCapture(hwnd)
            if hit == "drag":
                cursor, rect = wt.POINT(), wt.RECT()
                self._user.GetCursorPos(ctypes.byref(cursor))
                self._user.GetWindowRect(hwnd, ctypes.byref(rect))
                self._drag = (cursor.x, cursor.y, rect.left, rect.top)
                self._user.SetTimer(hwnd, 1, 16, None)
        elif message == WM_MOUSEMOVE:
            self._hover = hit
            if self._drag is not None:
                self._move_drag(hwnd)
            self._user.InvalidateRect(hwnd, None, False)
        elif message == WM_LBUTTONUP:
            pressed = self._pressed
            self._pressed, self._drag = "", None
            self._user.ReleaseCapture()
            self._user.SetTimer(hwnd, 1, 250, None)
            if hit and hit == pressed:
                command = self._state.request(hit)
                if command is not None:
                    self._command(command)
            self._user.InvalidateRect(hwnd, None, False)

    def _move_drag(self, hwnd: int) -> None:
        if self._drag is None:
            return
        cursor = wt.POINT()
        self._user.GetCursorPos(ctypes.byref(cursor))
        x0, y0, left, top = self._drag
        self._user.SetWindowPos(
            hwnd, None, left + cursor.x - x0, top + cursor.y - y0, 0, 0, 0x0015
        )

    def _shape(
        self,
        dc: int,
        color: int,
        rect: tuple[int, int, int, int],
        *,
        circle: bool = False,
    ) -> None:
        brush = self._gdi.CreateSolidBrush(color)
        pen = self._gdi.CreatePen(0, 1, color)
        old_brush, old_pen = (
            self._gdi.SelectObject(dc, brush),
            self._gdi.SelectObject(dc, pen),
        )
        coordinates = tuple(self._px(value) for value in rect)
        try:
            if circle:
                self._gdi.Ellipse(dc, *coordinates)
            else:
                self._gdi.RoundRect(dc, *coordinates, self._px(10), self._px(10))
        finally:
            self._gdi.SelectObject(dc, old_pen)
            self._gdi.SelectObject(dc, old_brush)
            self._gdi.DeleteObject(pen)
            self._gdi.DeleteObject(brush)

    def _text(self, dc: int, value: str, left: int, right: int) -> None:
        self._gdi.SetTextColor(dc, _rgb(242, 242, 245))
        rect = wt.RECT(self._px(left), 0, self._px(right), self._px(HEIGHT))
        self._user.DrawTextW(dc, value, -1, ctypes.byref(rect), 0x0024 | 0x0800)

    def _icon(self, dc: int, action: str, center: int, color: int) -> None:
        pen = self._gdi.CreatePen(0, max(1, self._px(1)), color)
        brush = self._gdi.CreateSolidBrush(color)
        old_pen = self._gdi.SelectObject(dc, pen)
        old_brush = self._gdi.SelectObject(dc, brush)
        try:
            if action == "start":
                paths = [[(-4, -7), (-4, 7), (7, 0)]]
            elif action == "stop":
                paths = [[(-6, -6), (6, -6), (6, 6), (-6, 6)]]
            else:
                paths = [
                    [(-7, -5), (7, -5)],
                    [(-3, -5), (-3, -8), (3, -8), (3, -5)],
                    [(-5, -3), (-4, 7), (4, 7), (5, -3)],
                    [(-2, -1), (-2, 4)],
                    [(2, -1), (2, 4)],
                ]
            draw = self._gdi.Polyline if action == "cancel" else self._gdi.Polygon
            for path in paths:
                points = (wt.POINT * len(path))(
                    *(wt.POINT(self._px(center + x), self._px(24 + y)) for x, y in path)
                )
                draw(dc, points, len(path))
        finally:
            self._gdi.SelectObject(dc, old_brush)
            self._gdi.SelectObject(dc, old_pen)
            self._gdi.DeleteObject(brush)
            self._gdi.DeleteObject(pen)

    def _paint(self, hwnd: int) -> None:
        paint = PaintStruct()
        dc = self._user.BeginPaint(hwnd, ctypes.byref(paint))
        buffer = self._gdi.CreateCompatibleDC(dc)
        bitmap = self._gdi.CreateCompatibleBitmap(dc, self._px(WIDTH), self._px(HEIGHT))
        old_bitmap = self._gdi.SelectObject(buffer, bitmap)
        old_font = self._gdi.SelectObject(buffer, self._font)
        try:
            self._gdi.SetBkMode(buffer, 1)
            self._shape(buffer, _rgb(82, 82, 86), (0, 0, WIDTH, HEIGHT))
            self._shape(buffer, _rgb(49, 49, 53), (1, 1, WIDTH - 1, HEIGHT - 1))
            state = self._state.snapshot()
            self._shape(buffer, _rgb(92, 54, 56), (12, 14, 32, 34), circle=True)
            self._shape(buffer, _rgb(240, 92, 94), (17, 19, 27, 29), circle=True)
            self._text(buffer, state.elapsed, 40, 98)
            if state.phase == "armed":
                color = _rgb(94, 62, 64) if self._hover == "start" else _rgb(75, 51, 54)
                self._shape(buffer, color, (104, 8, 140, 40))
                self._icon(buffer, "start", 122, _rgb(240, 92, 94))
                if self._hover == "cancel":
                    self._shape(buffer, _rgb(67, 67, 72), (144, 8, 180, 40))
                self._icon(buffer, "cancel", 162, _rgb(190, 190, 196))
            elif state.phase == "recording":
                color = _rgb(90, 60, 63) if self._hover == "stop" else _rgb(69, 47, 51)
                self._shape(buffer, color, (104, 8, 140, 40))
                self._icon(buffer, "stop", 122, _rgb(240, 92, 94))
            else:
                active = int(time.monotonic() * 4) % 3
                for index in range(3):
                    shade = 220 if index == active else 112
                    x = 113 + index * 7
                    self._shape(
                        buffer,
                        _rgb(shade, shade, shade),
                        (x, 22, x + 3, 25),
                        circle=True,
                    )
            for column in (192, 197):
                for row in (19, 24, 29):
                    self._shape(
                        buffer,
                        _rgb(146, 146, 152),
                        (column, row, column + 2, row + 2),
                        circle=True,
                    )
            self._gdi.BitBlt(
                dc, 0, 0, self._px(WIDTH), self._px(HEIGHT), buffer, 0, 0, 0x00CC0020
            )
        finally:
            self._gdi.SelectObject(buffer, old_font)
            self._gdi.SelectObject(buffer, old_bitmap)
            self._gdi.DeleteObject(bitmap)
            self._gdi.DeleteDC(buffer)
            self._user.EndPaint(hwnd, ctypes.byref(paint))
