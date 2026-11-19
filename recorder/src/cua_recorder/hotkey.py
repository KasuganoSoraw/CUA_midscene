from __future__ import annotations

import ctypes
import sys
import threading
from ctypes import wintypes
from typing import Callable

from .hooks import RawInputEvent
from .protocol import RecorderError


WM_HOTKEY = 0x0312
WM_QUIT = 0x0012
MOD_CONTROL = 0x0002
MOD_SHIFT = 0x0004
MOD_NOREPEAT = 0x4000
VK_F9 = 0x78
HOTKEY_ID = 0x4355
HOTKEY_LABEL = "Ctrl+Shift+F9"

CTRL_KEYS = {0x11, 0xA2, 0xA3}
SHIFT_KEYS = {0x10, 0xA0, 0xA1}


class GlobalHotkeyToggle:
    """在独立的 Win32 消息线程中注册进程级全局快捷键。"""

    def __init__(self, callback: Callable[[], None]) -> None:
        self._callback = callback
        self._thread: threading.Thread | None = None
        self._thread_id = 0
        self._ready = threading.Event()
        self._start_error: BaseException | None = None
        self._running = False

    def start(self, timeout: float = 5.0) -> None:
        if sys.platform != "win32":
            raise RecorderError("全局录制快捷键只能在 Windows 上启动")
        if self._running:
            raise RecorderError("全局录制快捷键已经启动")
        self._running = True
        self._thread = threading.Thread(target=self._run, name="cua-recorder-hotkey", daemon=True)
        self._thread.start()
        if not self._ready.wait(timeout):
            self.stop()
            raise RecorderError("等待全局录制快捷键注册超时")
        if self._start_error:
            error = self._start_error
            self.stop()
            raise RecorderError(f"无法注册全局快捷键 {HOTKEY_LABEL}；它可能已被其他程序占用：{error}") from error

    def stop(self, timeout: float = 5.0) -> None:
        if not self._running:
            return
        self._running = False
        if self._thread_id and sys.platform == "win32":
            ctypes.windll.user32.PostThreadMessageW(self._thread_id, WM_QUIT, 0, 0)
        if self._thread and self._thread is not threading.current_thread():
            self._thread.join(timeout)

    def _run(self) -> None:
        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32
        user32.RegisterHotKey.argtypes = [wintypes.HWND, ctypes.c_int, wintypes.UINT, wintypes.UINT]
        user32.RegisterHotKey.restype = wintypes.BOOL
        user32.UnregisterHotKey.argtypes = [wintypes.HWND, ctypes.c_int]
        user32.UnregisterHotKey.restype = wintypes.BOOL
        kernel32.GetCurrentThreadId.argtypes = []
        kernel32.GetCurrentThreadId.restype = wintypes.DWORD
        self._thread_id = int(kernel32.GetCurrentThreadId())
        registered = False
        try:
            registered = bool(user32.RegisterHotKey(None, HOTKEY_ID, MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT, VK_F9))
            if not registered:
                raise ctypes.WinError(kernel32.GetLastError())
            self._ready.set()
            message = wintypes.MSG()
            while user32.GetMessageW(ctypes.byref(message), None, 0, 0) > 0:
                if message.message == WM_HOTKEY and int(message.wParam) == HOTKEY_ID:
                    self._callback()
        except BaseException as error:
            self._start_error = error
            self._ready.set()
        finally:
            if registered:
                user32.UnregisterHotKey(None, HOTKEY_ID)
            self._thread_id = 0
            self._ready.set()


class HotkeyInputFilter:
    """从录制日志中移除用于停止录制的完整快捷键组合。"""

    def __init__(self, sink: Callable[[RawInputEvent], None]) -> None:
        self._sink = sink
        self._ctrl: set[int] = set()
        self._shift: set[int] = set()
        self._pending_modifiers: list[RawInputEvent] = []
        self._suppressing = False

    def handle(self, event: RawInputEvent) -> None:
        if event.kind not in ("key_down", "key_up") or event.vk_code is None:
            self._flush_modifiers()
            self._sink(event)
            return

        key = event.vk_code
        is_down = event.kind == "key_down"
        modifier_set = self._ctrl if key in CTRL_KEYS else self._shift if key in SHIFT_KEYS else None
        if modifier_set is not None:
            if is_down:
                modifier_set.add(key)
            else:
                modifier_set.discard(key)
            if self._suppressing:
                if not self._ctrl and not self._shift:
                    self._suppressing = False
                return
            self._pending_modifiers.append(event)
            if not is_down and not self._ctrl and not self._shift:
                self._flush_modifiers()
            return

        if key == VK_F9 and is_down and self._ctrl and self._shift:
            self._pending_modifiers.clear()
            self._suppressing = True
            return
        if self._suppressing and key == VK_F9:
            return
        self._flush_modifiers()
        self._sink(event)

    def finish(self) -> None:
        if not self._suppressing:
            self._flush_modifiers()

    def _flush_modifiers(self) -> None:
        pending, self._pending_modifiers = self._pending_modifiers, []
        for event in pending:
            self._sink(event)
