from __future__ import annotations

import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .hooks import RawInputEvent


@dataclass(frozen=True, slots=True)
class ToolbarSnapshot:
    phase: str
    elapsed: str


class ToolbarState:
    """录制会话驱动状态；按钮请求期间立即禁用重复操作。"""

    def __init__(self, clock: Callable[[], int] = time.perf_counter_ns) -> None:
        self._lock = threading.Lock()
        self._clock = clock
        self._phase = "arming"
        self._started_ns: int | None = None
        self._finished_ns: int | None = None

    def update(self, phase: str, started_ns: int | None = None) -> None:
        with self._lock:
            self._phase = phase
            if started_ns is not None:
                self._started_ns = started_ns
            if (
                phase in ("stopping", "completed", "cancelled", "failed")
                and self._finished_ns is None
            ):
                self._finished_ns = self._clock()

    def request(self, action: str) -> str | None:
        with self._lock:
            if action == "start" and self._phase == "armed":
                self._phase = "starting"
                return "toggle"
            if action == "stop" and self._phase == "recording":
                self._phase = "stopping"
                self._finished_ns = self._clock()
                return "stop"
            if action == "cancel" and self._phase == "armed":
                self._phase = "stopping"
                return "stop"
            if action == "cancel" and self._phase == "recording":
                self._phase = "stopping"
                self._finished_ns = self._clock()
                return "abort"
            return None

    def snapshot(self) -> ToolbarSnapshot:
        with self._lock:
            seconds = 0
            if self._started_ns is not None:
                end = (
                    self._finished_ns
                    if self._finished_ns is not None
                    else self._clock()
                )
                seconds = max(0, (end - self._started_ns) // 1_000_000_000)
            return ToolbarSnapshot(
                self._phase, f"{seconds // 60:02d}:{seconds % 60:02d}"
            )


class MouseGestureExclusion:
    """排除悬浮条上的完整鼠标手势，保留从业务窗口开始的拖拽。"""

    def __init__(self, contains_point: Callable[[int, int], bool]) -> None:
        self._contains_point = contains_point
        self._excluded: set[str] = set()
        self._recorded: set[str] = set()

    def excludes(self, event: RawInputEvent) -> bool:
        if event.x is None or event.y is None:
            return False
        over_toolbar = self._contains_point(event.x, event.y)
        button = event.button or "unknown"
        if event.kind == "mouse_down":
            if self._excluded or (over_toolbar and not self._recorded):
                self._excluded.add(button)
                return True
            self._recorded.add(button)
            return False
        if event.kind == "mouse_up":
            if button in self._excluded:
                self._excluded.discard(button)
                return True
            if button in self._recorded:
                self._recorded.discard(button)
                return False
        if self._excluded:
            return True
        if self._recorded:
            return False
        return over_toolbar
