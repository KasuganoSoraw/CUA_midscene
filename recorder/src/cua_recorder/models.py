from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True, slots=True)
class DisplayInfo:
    id: str
    device_name: str
    index: int
    left: int
    top: int
    width: int
    height: int
    scale_factor: float
    primary: bool
    preview_path: Path | None = None

    @property
    def right(self) -> int:
        return self.left + self.width

    @property
    def bottom(self) -> int:
        return self.top + self.height

    def to_json(self) -> dict[str, Any]:
        result = asdict(self)
        result["preview_path"] = str(self.preview_path) if self.preview_path else None
        return result

