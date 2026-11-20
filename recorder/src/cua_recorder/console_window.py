from __future__ import annotations

import ctypes
import time
from ctypes import wintypes as wt
from dataclasses import dataclass
from typing import Any

from .protocol import RecorderError
from .windows import require_windows


def _window_api() -> tuple[Any, Any]:
    require_windows()
    user, kernel = ctypes.windll.user32, ctypes.windll.kernel32
    signatures = [
        (user, "GetForegroundWindow", wt.HWND, []),
        (user, "GetDesktopWindow", wt.HWND, []),
        (user, "GetShellWindow", wt.HWND, []),
        (user, "GetAncestor", wt.HWND, [wt.HWND, wt.UINT]),
        (user, "IsWindow", wt.BOOL, [wt.HWND]),
        (user, "IsWindowVisible", wt.BOOL, [wt.HWND]),
        (user, "IsIconic", wt.BOOL, [wt.HWND]),
        (user, "GetWindowThreadProcessId", wt.DWORD, [wt.HWND, ctypes.POINTER(wt.DWORD)]),
        (user, "ShowWindowAsync", wt.BOOL, [wt.HWND, ctypes.c_int]),
        (user, "AttachThreadInput", wt.BOOL, [wt.DWORD, wt.DWORD, wt.BOOL]),
        (user, "BringWindowToTop", wt.BOOL, [wt.HWND]),
        (user, "SetForegroundWindow", wt.BOOL, [wt.HWND]),
        (user, "SetWindowPos", wt.BOOL,
         [wt.HWND, wt.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wt.UINT]),
        (user, "PeekMessageW", wt.BOOL, [ctypes.POINTER(wt.MSG), wt.HWND, wt.UINT, wt.UINT, wt.UINT]),
        (kernel, "GetCurrentThreadId", wt.DWORD, []),
    ]
    for library, name, result, arguments in signatures:
        function = getattr(library, name)
        function.restype = result
        function.argtypes = arguments
    return user, kernel


@dataclass
class ConsoleWindowReturn:
    """准备录制时记住前台控制台窗口，仅在保存完成后恢复该窗口。"""

    user: Any = None
    kernel: Any = None
    hwnd: int = 0
    process_id: int = 0
    error: str | None = None

    @classmethod
    def capture(cls) -> ConsoleWindowReturn:
        try:
            user, kernel = _window_api()
            foreground = user.GetForegroundWindow()
            hwnd = user.GetAncestor(foreground, 2)  # GA_ROOT
            if not hwnd or hwnd in (user.GetDesktopWindow(), user.GetShellWindow()):
                raise RecorderError("准备录制时未找到控制台窗口")
            if not user.IsWindowVisible(hwnd):
                raise RecorderError("准备录制时控制台窗口不可见")
            process_id = wt.DWORD()
            if not user.GetWindowThreadProcessId(hwnd, ctypes.byref(process_id)) or not process_id.value:
                raise RecorderError("无法读取控制台窗口所属进程")
            return cls(user, kernel, int(hwnd), process_id.value)
        except (RecorderError, OSError, AttributeError) as error:
            return cls(error=str(error))

    def restore(self) -> dict[str, object]:
        try:
            if self.error:
                raise RecorderError(self.error)
            self._activate()
            return {"console_foreground": True}
        except (RecorderError, OSError, AttributeError) as error:
            return {
                "console_foreground": False,
                "focus_warning": f"录制已保存，但未能将控制台切到前台：{error}",
            }

    def _target_thread(self) -> int:
        process_id = wt.DWORD()
        thread = self.user.GetWindowThreadProcessId(self.hwnd, ctypes.byref(process_id))
        if not self.user.IsWindow(self.hwnd) or not thread or process_id.value != self.process_id:
            raise RecorderError("原控制台窗口已关闭或窗口身份已变化")
        return int(thread)

    def _activate(self) -> None:
        self._target_thread()
        if self.user.IsIconic(self.hwnd):
            self.user.ShowWindowAsync(self.hwnd, 9)  # SW_RESTORE
        elif not self.user.IsWindowVisible(self.hwnd):
            self.user.ShowWindowAsync(self.hwnd, 5)  # SW_SHOW
        message = wt.MSG()
        self.user.PeekMessageW(ctypes.byref(message), None, 0, 0, 0)
        for _ in range(20):
            self._activate_once(self._target_thread())
            if (self.user.GetForegroundWindow() == self.hwnd
                    and self.user.IsWindowVisible(self.hwnd) and not self.user.IsIconic(self.hwnd)):
                return
            time.sleep(0.05)
        raise RecorderError("Windows 未允许激活原控制台窗口，请手动切回控制台")

    def _activate_once(self, target_thread: int) -> None:
        current = self.kernel.GetCurrentThreadId()
        foreground = self.user.GetForegroundWindow()
        foreground_thread = self.user.GetWindowThreadProcessId(foreground, None)
        attached: list[int] = []
        try:
            for thread in dict.fromkeys((foreground_thread, target_thread)):
                if thread and thread != current and self.user.AttachThreadInput(current, thread, True):
                    attached.append(thread)
            self.user.BringWindowToTop(self.hwnd)
            self.user.SetWindowPos(self.hwnd, 0, 0, 0, 0, 0, 0x0043)  # TOP / NOSIZE / NOMOVE / SHOWWINDOW
            self.user.SetForegroundWindow(self.hwnd)
        finally:
            for thread in reversed(attached):
                self.user.AttachThreadInput(current, thread, False)
