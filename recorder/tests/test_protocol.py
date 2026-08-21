from __future__ import annotations

import io
import json
import unittest

from cua_recorder.protocol import write_event


class ProtocolTest(unittest.TestCase):
    def test_event_is_single_utf8_safe_json_line(self) -> None:
        stream = io.StringIO()
        write_event("starting", stream=stream, message="正在录制")

        self.assertEqual(
            {"event": "starting", "message": "正在录制"},
            json.loads(stream.getvalue()),
        )
        self.assertTrue(stream.getvalue().endswith("\n"))


if __name__ == "__main__":
    unittest.main()

