from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from cua_recorder.protocol import RecorderError
from cua_recorder.windows import require_output_root


class OutputRootTest(unittest.TestCase):
    def test_accepts_existing_writable_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            self.assertEqual(Path(temporary).resolve(), require_output_root(temporary))

    def test_rejects_missing_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            missing = Path(temporary) / "missing"
            with self.assertRaisesRegex(RecorderError, "不存在"):
                require_output_root(missing)


if __name__ == "__main__":
    unittest.main()
