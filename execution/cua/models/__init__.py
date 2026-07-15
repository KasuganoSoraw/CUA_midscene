"""落盘和跨进程 JSON 的 Pydantic 契约。"""

from .task import ExecutorResult, SceneManifest, TaskManifest

__all__ = [
    "ExecutorResult",
    "SceneManifest",
    "TaskManifest",
]
