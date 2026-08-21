from __future__ import annotations

import ctypes
import queue
import sys
import threading
import time
from ctypes import wintypes
from dataclasses import dataclass
from typing import Callable

from .protocol import RecorderError


WH_KEYBOARD_LL = 13
WH_MOUSE_LL = 14
HC_ACTION = 0
WM_QUIT = 0x0012
WM_KEYDOWN = 0x0100
WM_KEYUP = 0x0101
WM_SYSKEYDOWN = 0x0104
WM_SYSKEYUP = 0x0105
WM_MOUSEMOVE = 0x0200
WM_LBUTTONDOWN = 0x0201
WM_LBUTTONUP = 0x0202
WM_RBUTTONDOWN = 0x0204
WM_RBUTTONUP = 0x0205
WM_MBUTTONDOWN = 0x0207
WM_MBUTTONUP = 0x0208
WM_MOUSEWHEEL = 0x020A
WM_XBUTTONDOWN = 0x020B
WM_XBUTTONUP = 0x020C
LLKHF_INJECTED = 0x10
LLMHF_INJECTED = 0x01

LRESULT = ctypes.c_ssize_t
WPARAM = ctypes.c_size_t
LPARAM = ctypes.c_ssize_t
ULONG_PTR = ctypes.c_size_t


class POINT(ctypes.Structure):
    _fields_ = [("x", wintypes.LONG), ("y", wintypes.LONG)]


class KBDLLHOOKSTRUCT(ctypes.Structure):
    _fields_ = [
        ("vkCode", wintypes.DWORD),
        ("scanCode", wintypes.DWORD),
        ("flags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]


class MSLLHOOKSTRUCT(ctypes.Structure):
    _fields_ = [
        ("pt", POINT),
        ("mouseData", wintypes.DWORD),
        ("flags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]


@dataclass(frozen=True, slots=True)
class RawInputEvent:
    kind: str
    time_ns: int
    vk_code: int | None = None
    scan_code: int | None = None
    x: int | None = None
    y: int | None = None
    button: str | None = None
    wheel_delta: int | None = None
    injected: bool = False


EventSink = Callable[[RawInputEvent], None]


class Win32HookRecorder:
    """在专用消息线程中安装低级 Hook，回调仅执行非阻塞入队。"""

    def __init__(self, sink: EventSink, *, queue_size: int = 16_384) -> None:
        self._sink = sink
        self._events: queue.Queue[RawInputEvent | None] = queue.Queue(maxsize=queue_size)
        self._hook_thread: threading.Thread | None = None
        self._consumer_thread: threading.Thread | None = None
        self._ready = threading.Event()
        self._thread_id = 0
        self._start_error: BaseException | None = None
        self._keyboard_hook: int | None = None
        self._mouse_hook: int | None = None
        self._keyboard_callback = None
        self._mouse_callback = None
        self._dropped = 0
        self._running = False

    @property
    def dropped_events(self) -> int:
        return self._dropped

    def start(self, timeout: float = 5.0) -> None:
        if sys.platform != "win32":
            raise RecorderError("Win32 键鼠 Hook 只能在 Windows 上启动")
        if self._running:
            raise RecorderError("Win32 键鼠 Hook 已经启动")
        self._running = True
        self._consumer_thread = threading.Thread(target=self._consume, name="cua-input-writer", daemon=True)
        self._hook_thread = threading.Thread(target=self._run_hooks, name="cua-win32-hooks", daemon=True)
        self._consumer_thread.start()
        self._hook_thread.start()
        if not self._ready.wait(timeout):
            self.stop()
            raise RecorderError("等待 Win32 键鼠 Hook 启动超时")
        if self._start_error:
            error = self._start_error
            self.stop()
            raise RecorderError(f"Win32 键鼠 Hook 启动失败：{error}") from error

    def stop(self, timeout: float = 5.0) -> None:
        if not self._running:
            return
        self._running = False
        if self._thread_id and sys.platform == "win32":
            ctypes.windll.user32.PostThreadMessageW(self._thread_id, WM_QUIT, 0, 0)
        if self._hook_thread and self._hook_thread is not threading.current_thread():
            self._hook_thread.join(timeout)
        try:
            self._events.put_nowait(None)
        except queue.Full:
            try:
                self._events.get_nowait()
            except queue.Empty:
                pass
            self._events.put_nowait(None)
        if self._consumer_thread and self._consumer_thread is not threading.current_thread():
            self._consumer_thread.join(timeout)

    def _enqueue(self, event: RawInputEvent) -> None:
        try:
            self._events.put_nowait(event)
        except queue.Full:
            self._dropped += 1

    def _consume(self) -> None:
        while True:
            event = self._events.get()
            try:
                if event is None:
                    return
                self._sink(event)
            finally:
                self._events.task_done()

    def _run_hooks(self) -> None:
        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32
        hook_proc = ctypes.WINFUNCTYPE(LRESULT, ctypes.c_int, WPARAM, LPARAM)
        user32.SetWindowsHookExW.argtypes = [ctypes.c_int, hook_proc, wintypes.HINSTANCE, wintypes.DWORD]
        user32.SetWindowsHookExW.restype = wintypes.HANDLE
        user32.CallNextHookEx.argtypes = [wintypes.HANDLE, ctypes.c_int, WPARAM, LPARAM]
        user32.CallNextHookEx.restype = LRESULT
        user32.UnhookWindowsHookEx.argtypes = [wintypes.HANDLE]
        user32.UnhookWindowsHookEx.restype = wintypes.BOOL
        kernel32.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
        kernel32.GetModuleHandleW.restype = wintypes.HMODULE
        kernel32.GetCurrentThreadId.argtypes = []
        kernel32.GetCurrentThreadId.restype = wintypes.DWORD

        def keyboard_callback(code: int, message: int, data_pointer: int) -> int:
            if code == HC_ACTION and message in (WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP):
                data = ctypes.cast(data_pointer, ctypes.POINTER(KBDLLHOOKSTRUCT)).contents
                self._enqueue(
                    RawInputEvent(
                        kind="key_down" if message in (WM_KEYDOWN, WM_SYSKEYDOWN) else "key_up",
                        time_ns=time.perf_counter_ns(),
                        vk_code=int(data.vkCode),
                        scan_code=int(data.scanCode),
                        injected=bool(data.flags & LLKHF_INJECTED),
                    )
                )
            return int(user32.CallNextHookEx(self._keyboard_hook, code, message, data_pointer))

        mouse_messages = {
            WM_MOUSEMOVE: ("mouse_move", None),
            WM_LBUTTONDOWN: ("mouse_down", "left"),
            WM_LBUTTONUP: ("mouse_up", "left"),
            WM_RBUTTONDOWN: ("mouse_down", "right"),
            WM_RBUTTONUP: ("mouse_up", "right"),
            WM_MBUTTONDOWN: ("mouse_down", "middle"),
            WM_MBUTTONUP: ("mouse_up", "middle"),
            WM_XBUTTONDOWN: ("mouse_down", "x"),
            WM_XBUTTONUP: ("mouse_up", "x"),
            WM_MOUSEWHEEL: ("mouse_wheel", None),
        }

        def mouse_callback(code: int, message: int, data_pointer: int) -> int:
            if code == HC_ACTION and message in mouse_messages:
                data = ctypes.cast(data_pointer, ctypes.POINTER(MSLLHOOKSTRUCT)).contents
                kind, button = mouse_messages[message]
                wheel_delta = None
                if message == WM_MOUSEWHEEL:
                    wheel_delta = ctypes.c_short((int(data.mouseData) >> 16) & 0xFFFF).value
                if message in (WM_XBUTTONDOWN, WM_XBUTTONUP):
                    button = "x1" if ((int(data.mouseData) >> 16) & 0xFFFF) == 1 else "x2"
                self._enqueue(
                    RawInputEvent(
                        kind=kind,
                        time_ns=time.perf_counter_ns(),
                        x=int(data.pt.x),
                        y=int(data.pt.y),
                        button=button,
                        wheel_delta=wheel_delta,
                        injected=bool(data.flags & LLMHF_INJECTED),
                    )
                )
            return int(user32.CallNextHookEx(self._mouse_hook, code, message, data_pointer))

        self._keyboard_callback = hook_proc(keyboard_callback)
        self._mouse_callback = hook_proc(mouse_callback)
        self._thread_id = int(kernel32.GetCurrentThreadId())
        try:
            module = kernel32.GetModuleHandleW(None)
            self._keyboard_hook = user32.SetWindowsHookExW(WH_KEYBOARD_LL, self._keyboard_callback, module, 0)
            if not self._keyboard_hook:
                raise ctypes.WinError(kernel32.GetLastError())
            self._mouse_hook = user32.SetWindowsHookExW(WH_MOUSE_LL, self._mouse_callback, module, 0)
            if not self._mouse_hook:
                raise ctypes.WinError(kernel32.GetLastError())
            self._ready.set()
            message = wintypes.MSG()
            while user32.GetMessageW(ctypes.byref(message), None, 0, 0) > 0:
                user32.TranslateMessage(ctypes.byref(message))
                user32.DispatchMessageW(ctypes.byref(message))
        except BaseException as error:
            self._start_error = error
            self._ready.set()
        finally:
            if self._mouse_hook:
                user32.UnhookWindowsHookEx(self._mouse_hook)
            if self._keyboard_hook:
                user32.UnhookWindowsHookEx(self._keyboard_hook)
            self._mouse_hook = None
            self._keyboard_hook = None
            self._ready.set()
