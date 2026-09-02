"""验证 Computer-Use Component 的 manifest 与发行目录。"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.component_manifest import (
    ComponentValidationError,
    verify_component,
)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("component", type=Path)
    args = parser.parse_args(argv)
    try:
        manifest = verify_component(args.component)
    except (ComponentValidationError, OSError, ValueError) as error:
        print(f"组件验证失败：{error}", file=sys.stderr)
        return 1
    print(f"{manifest['name']} {manifest['version']} valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
