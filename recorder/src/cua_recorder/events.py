from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Callable, TextIO

from .hooks import RawInputEvent
from .models import DisplayInfo


SPECIAL_KEYS = {
    0x14: "CAPSLOCK",
    0x08: "BACKSPACE",
    0x09: "TAB",
    0x0D: "ENTER",
    0x1B: "ESC",
    0x20: "SPACE",
    0x21: "PAGEUP",
    0x22: "PAGEDOWN",
    0x23: "END",
    0x24: "HOME",
    0x25: "LEFT",
    0x26: "UP",
    0x27: "RIGHT",
    0x28: "DOWN",
    0x2D: "INSERT",
    0x2E: "DELETE",
    0x5B: "WIN",
    0x5C: "WIN",
    0x6A: "NUMPAD_MULTIPLY",
    0x6B: "NUMPAD_ADD",
    0x6D: "NUMPAD_SUBTRACT",
    0x6E: "NUMPAD_DECIMAL",
    0x6F: "NUMPAD_DIVIDE",
    0x90: "NUMLOCK",
    0x91: "SCROLLLOCK",
}
MODIFIERS = {
    0x10: "SHIFT",
    0xA0: "SHIFT",
    0xA1: "SHIFT",
    0x11: "CTRL",
    0xA2: "CTRL",
    0xA3: "CTRL",
    0x12: "ALT",
    0xA4: "ALT",
    0xA5: "ALT",
    0x5B: "WIN",
    0x5C: "WIN",
}
BUTTON_PREFIX = {"left": "L", "right": "R", "middle": "M", "x1": "X1", "x2": "X2", "x": "X"}


def key_name(vk_code: int | None) -> str:
    if vk_code is None:
        return "UNKNOWN"
    if vk_code in MODIFIERS:
        return MODIFIERS[vk_code]
    if vk_code in SPECIAL_KEYS:
        return SPECIAL_KEYS[vk_code]
    if 0x30 <= vk_code <= 0x39 or 0x41 <= vk_code <= 0x5A:
        return chr(vk_code)
    if 0x60 <= vk_code <= 0x69:
        return f"NUMPAD_{vk_code - 0x60}"
    if 0x70 <= vk_code <= 0x87:
        return f"F{vk_code - 0x6F}"
    return f"VK_{vk_code:02X}"


def format_timestamp(elapsed_ns: int) -> str:
    total_ms = max(0, elapsed_ns // 1_000_000)
    hours, remainder = divmod(total_ms, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, milliseconds = divmod(remainder, 1_000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{milliseconds:03d}"


@dataclass(slots=True)
class MouseButtonState:
    down_x: int
    down_y: int
    dragging: bool = False


class AlohaEventFormatter:
    def __init__(
        self,
        stream: TextIO,
        *,
        started_ns: int,
        window_provider: Callable[[], str],
        double_click_ms: int = 500,
        double_click_distance: int = 4,
        drag_distance: int = 4,
        include_injected: bool = True,
        coordinate_origin: tuple[int, int] = (0, 0),
        coordinate_size: tuple[int, int] | None = None,
        caps_lock_on: bool = False,
    ) -> None:
        self._stream = stream
        self._started_ns = started_ns
        self._window_provider = window_provider
        self._double_click_ns = double_click_ms * 1_000_000
        self._double_click_distance = double_click_distance
        self._drag_distance = drag_distance
        self._include_injected = include_injected
        self._coordinate_origin = coordinate_origin
        self._coordinate_size = coordinate_size
        self._caps_lock_on = caps_lock_on
        self._pressed_keys: set[int] = set()
        self._pressed_modifier_keys: set[int] = set()
        self._pressed_key_names: dict[int, str] = {}
        self._buttons: dict[str, MouseButtonState] = {}
        self._last_click: dict[str, tuple[int, int, int]] = {}
        self._lock = threading.Lock()

    def handle(self, event: RawInputEvent) -> None:
        if event.injected and not self._include_injected:
            return
        with self._lock:
            message = self._format_message(event)
            if message:
                self._write(event.time_ns, message)

    def finish(self, time_ns: int) -> None:
        """写入处理器消费的末尾哨兵，确保最后一个真实动作被保留。"""
        with self._lock:
            self._write(time_ns, "Recording Stopped")

    def _format_message(self, event: RawInputEvent) -> str | None:
        if event.kind in ("key_down", "key_up"):
            vk_code = event.vk_code
            physical_name = key_name(vk_code)
            modifier = MODIFIERS.get(vk_code or -1)
            if event.kind == "key_down":
                repeated = vk_code is not None and vk_code in self._pressed_keys
                if vk_code is not None:
                    self._pressed_keys.add(vk_code)
                if vk_code == 0x14 and not repeated:
                    self._caps_lock_on = not self._caps_lock_on
                if modifier:
                    if vk_code is not None:
                        self._pressed_modifier_keys.add(vk_code)
                    name = physical_name
                else:
                    name = self._key_name_for_current_state(vk_code, physical_name)
                    if vk_code is not None:
                        self._pressed_key_names[vk_code] = name
                modifiers = self._pressed_modifier_names()
                if not modifier and modifiers:
                    order = [item for item in ("CTRL", "ALT", "SHIFT", "WIN") if item in modifiers]
                    return f"Hotkey: {'+'.join([*order, name])}"
                return f"Key Press: {name}"
            name = self._pressed_key_names.pop(vk_code, physical_name) if vk_code is not None else physical_name
            if modifier:
                if vk_code is not None:
                    self._pressed_modifier_keys.discard(vk_code)
            if vk_code is not None:
                self._pressed_keys.discard(vk_code)
            return f"Key Release: {name}"

        if event.x is None or event.y is None:
            return None
        x = event.x - self._coordinate_origin[0]
        y = event.y - self._coordinate_origin[1]
        inside = self._coordinate_size is None or (
            0 <= x < self._coordinate_size[0] and 0 <= y < self._coordinate_size[1]
        )
        tracked_button = bool(event.button and event.button in self._buttons)
        if not inside and (
            event.kind in ("mouse_down", "mouse_wheel")
            or (event.kind == "mouse_up" and not tracked_button)
        ):
            return None
        if not inside and self._coordinate_size is not None:
            x = min(max(x, 0), self._coordinate_size[0] - 1)
            y = min(max(y, 0), self._coordinate_size[1] - 1)
        coordinate = f"({x}, {y})"
        if event.kind == "mouse_wheel":
            return f"{'ScrollUp' if (event.wheel_delta or 0) > 0 else 'ScrollDown'} at {coordinate}"
        if event.kind == "mouse_down" and event.button:
            prefix = BUTTON_PREFIX.get(event.button, event.button.upper())
            previous = self._last_click.get(event.button)
            is_double = bool(
                previous
                and event.time_ns - previous[0] <= self._double_click_ns
                and abs(x - previous[1]) <= self._double_click_distance
                and abs(y - previous[2]) <= self._double_click_distance
            )
            self._buttons[event.button] = MouseButtonState(x, y)
            self._last_click[event.button] = (event.time_ns, x, y)
            return f"{prefix}{'DoubleClick' if is_double else 'Click'} at {coordinate}"
        if event.kind == "mouse_move":
            state = self._buttons.get("left")
            if not state:
                return None
            if not state.dragging:
                if max(abs(x - state.down_x), abs(y - state.down_y)) < self._drag_distance:
                    return None
                state.dragging = True
                self._write(event.time_ns, f"DragStart at ({state.down_x}, {state.down_y})")
            return f"DragMove at {coordinate}"
        if event.kind == "mouse_up" and event.button:
            prefix = BUTTON_PREFIX.get(event.button, event.button.upper())
            state = self._buttons.pop(event.button, None)
            if event.button == "left" and state and state.dragging:
                return f"LDragEnd at {coordinate}"
            return f"{prefix}Release at {coordinate}"
        return None

    def _pressed_modifier_names(self) -> set[str]:
        return {MODIFIERS[vk_code] for vk_code in self._pressed_modifier_keys}

    def _key_name_for_current_state(self, vk_code: int | None, physical_name: str) -> str:
        if vk_code is None or not 0x41 <= vk_code <= 0x5A:
            return physical_name
        modifiers = self._pressed_modifier_names()
        if modifiers.intersection({"CTRL", "ALT", "WIN"}):
            return physical_name
        uppercase = ("SHIFT" in modifiers) ^ self._caps_lock_on
        return physical_name if uppercase else physical_name.lower()

    def _write(self, time_ns: int, message: str) -> None:
        document = {
            "timestamp": format_timestamp(time_ns - self._started_ns),
            "message": message,
            "window": self._window_provider(),
        }
        self._stream.write(json.dumps(document, ensure_ascii=False) + "\n")
        self._stream.flush()


def write_log_header(stream: TextIO, *, started_at: datetime, display: DisplayInfo) -> None:
    screen_info = {
        str(display.index): {
            "x0": 0,
            "y0": 0,
            "width": display.width,
            "height": display.height,
            "scale_factor": display.scale_factor,
            "source_x0": display.left,
            "source_y0": display.top,
        }
    }
    started_text = started_at.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    metadata = {
        "video_start_time": started_text,
        "start_message": "Mouse and keyboard monitoring service started",
        "recording_timestamp": started_at.strftime("%Y%m%d_%H%M%S"),
        "screen_info": screen_info,
    }
    stream.write("# Input Recording Log\n")
    stream.write(f"# Started: {started_text}\n")
    stream.write("# Metadata: " + json.dumps(metadata, ensure_ascii=False) + "\n")
    stream.write("# Format: JSON per line\n")
    stream.write("# Fields: timestamp, message, window\n\n")
    stream.write(
        json.dumps(
            {
                "timestamp": "00:00:00.000",
                "message": json.dumps(screen_info, ensure_ascii=False),
                "window": "System Info",
            },
            ensure_ascii=False,
        )
        + "\n"
    )
    stream.flush()
