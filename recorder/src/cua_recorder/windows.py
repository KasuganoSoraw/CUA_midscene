from __future__ import annotations

import ctypes
import os
import sys
from ctypes import wintypes
from pathlib import Path

from .models import DisplayInfo
from .protocol import RecorderError


MONITORINFOF_PRIMARY = 1
MDT_EFFECTIVE_DPI = 0
PROCESS_PER_MONITOR_DPI_AWARE = 2
DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = ctypes.c_void_p(-4)


class RECT(ctypes.Structure):
    _fields_ = [
        ("left", wintypes.LONG),
        ("top", wintypes.LONG),
        ("right", wintypes.LONG),
        ("bottom", wintypes.LONG),
    ]


class MONITORINFOEXW(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.DWORD),
        ("rcMonitor", RECT),
        ("rcWork", RECT),
        ("dwFlags", wintypes.DWORD),
        ("szDevice", wintypes.WCHAR * 32),
    ]


def require_windows() -> None:
    if sys.platform != "win32":
        raise RecorderError("CUA 录制器首版只支持 Windows 10/11")


def enable_per_monitor_dpi_awareness() -> None:
    require_windows()
    user32 = ctypes.windll.user32
    try:
        user32.SetProcessDpiAwarenessContext.argtypes = [ctypes.c_void_p]
        user32.SetProcessDpiAwarenessContext.restype = wintypes.BOOL
        if user32.SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2):
            return
    except (AttributeError, OSError):
        pass
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(PROCESS_PER_MONITOR_DPI_AWARE)
    except (AttributeError, OSError):
        try:
            user32.SetProcessDPIAware()
        except (AttributeError, OSError):
            return


def _monitor_scale(handle: int) -> float:
    try:
        shcore = ctypes.windll.shcore
        shcore.GetDpiForMonitor.argtypes = [wintypes.HMONITOR, ctypes.c_int, ctypes.POINTER(wintypes.UINT), ctypes.POINTER(wintypes.UINT)]
        shcore.GetDpiForMonitor.restype = ctypes.c_long
        dpi_x = wintypes.UINT()
        dpi_y = wintypes.UINT()
        result = shcore.GetDpiForMonitor(
            wintypes.HMONITOR(handle),
            MDT_EFFECTIVE_DPI,
            ctypes.byref(dpi_x),
            ctypes.byref(dpi_y),
        )
        if result == 0 and dpi_x.value:
            return round(dpi_x.value / 96.0, 4)
    except (AttributeError, OSError):
        pass
    return 1.0


def list_displays() -> list[DisplayInfo]:
    require_windows()
    enable_per_monitor_dpi_awareness()
    user32 = ctypes.windll.user32
    monitor_proc = ctypes.WINFUNCTYPE(
        wintypes.BOOL,
        wintypes.HMONITOR,
        wintypes.HDC,
        ctypes.POINTER(RECT),
        wintypes.LPARAM,
    )
    displays: list[DisplayInfo] = []
    user32.GetMonitorInfoW.argtypes = [wintypes.HMONITOR, ctypes.POINTER(MONITORINFOEXW)]
    user32.GetMonitorInfoW.restype = wintypes.BOOL
    user32.EnumDisplayMonitors.argtypes = [wintypes.HDC, ctypes.POINTER(RECT), monitor_proc, wintypes.LPARAM]
    user32.EnumDisplayMonitors.restype = wintypes.BOOL

    def collect(handle: int, _dc: int, _rect: ctypes.POINTER(RECT), _data: int) -> bool:
        info = MONITORINFOEXW()
        info.cbSize = ctypes.sizeof(MONITORINFOEXW)
        if not user32.GetMonitorInfoW(handle, ctypes.byref(info)):
            return True
        rect = info.rcMonitor
        index = len(displays)
        device_name = str(info.szDevice)
        displays.append(
            DisplayInfo(
                id=device_name or f"display-{index}",
                device_name=device_name,
                index=index,
                left=int(rect.left),
                top=int(rect.top),
                width=int(rect.right - rect.left),
                height=int(rect.bottom - rect.top),
                scale_factor=_monitor_scale(handle),
                primary=bool(info.dwFlags & MONITORINFOF_PRIMARY),
            )
        )
        return True

    callback = monitor_proc(collect)
    if not user32.EnumDisplayMonitors(None, None, callback, 0):
        raise RecorderError(f"无法枚举 Windows 显示器，GetLastError={ctypes.get_last_error()}")
    if not displays:
        raise RecorderError("Windows 未返回可录制显示器")
    return displays


def require_output_root(raw: str | os.PathLike[str]) -> Path:
    root = Path(raw).expanduser().resolve()
    if not root.is_dir():
        raise RecorderError(f"录制输出根不存在或不是目录：{root}")
    probe = root / ".cua-recorder-write-test"
    try:
        probe.write_bytes(b"")
        probe.unlink()
    except OSError as error:
        raise RecorderError(f"录制输出根不可写：{root}（{error}）") from error
    return root


def foreground_window_label() -> str:
    """返回与现有 Aloha 日志接近的“进程名 - 窗口标题”。"""
    require_windows()
    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32
    user32.GetForegroundWindow.argtypes = []
    user32.GetForegroundWindow.restype = wintypes.HWND
    user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
    user32.GetWindowTextLengthW.restype = ctypes.c_int
    user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.GetWindowTextW.restype = ctypes.c_int
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.GetWindowThreadProcessId.restype = wintypes.DWORD
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    kernel32.QueryFullProcessImageNameW.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        return "Unknown"

    length = user32.GetWindowTextLengthW(hwnd)
    title_buffer = ctypes.create_unicode_buffer(max(1, length + 1))
    user32.GetWindowTextW(hwnd, title_buffer, len(title_buffer))
    process_id = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(process_id))

    process_name = "unknown.exe"
    process_query_limited_information = 0x1000
    handle = kernel32.OpenProcess(process_query_limited_information, False, process_id.value)
    if handle:
        try:
            capacity = wintypes.DWORD(32768)
            path_buffer = ctypes.create_unicode_buffer(capacity.value)
            if kernel32.QueryFullProcessImageNameW(handle, 0, path_buffer, ctypes.byref(capacity)):
                process_name = Path(path_buffer.value).name or process_name
        finally:
            kernel32.CloseHandle(handle)

    title = title_buffer.value.strip()
    return f"{process_name} - {title}" if title else process_name


def input_thresholds() -> dict[str, int]:
    require_windows()
    user32 = ctypes.windll.user32
    return {
        "double_click_ms": int(user32.GetDoubleClickTime()) or 500,
        "double_click_distance": max(
            int(user32.GetSystemMetrics(36)),  # SM_CXDOUBLECLK
            int(user32.GetSystemMetrics(37)),  # SM_CYDOUBLECLK
            4,
        ),
        "drag_distance": max(
            int(user32.GetSystemMetrics(68)),  # SM_CXDRAG
            int(user32.GetSystemMetrics(69)),  # SM_CYDRAG
            4,
        ),
    }
