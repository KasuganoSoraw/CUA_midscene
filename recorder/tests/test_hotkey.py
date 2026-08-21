from __future__ import annotations

import unittest

from cua_recorder.hooks import RawInputEvent
from cua_recorder.hotkey import HotkeyInputFilter


def key(kind: str, vk_code: int, at: int) -> RawInputEvent:
    return RawInputEvent(kind=kind, vk_code=vk_code, scan_code=0, time_ns=at)


class HotkeyInputFilterTest(unittest.TestCase):
    def test_discards_complete_stop_shortcut(self) -> None:
        output: list[RawInputEvent] = []
        filter_ = HotkeyInputFilter(output.append)
        for event in [
            key("key_down", 0xA2, 1),
            key("key_down", 0xA0, 2),
            key("key_down", 0x78, 3),
            key("key_up", 0x78, 4),
            key("key_up", 0xA0, 5),
            key("key_up", 0xA2, 6),
        ]:
            filter_.handle(event)
        filter_.finish()

        self.assertEqual([], output)

    def test_preserves_normal_ctrl_shortcut_in_order(self) -> None:
        output: list[RawInputEvent] = []
        filter_ = HotkeyInputFilter(output.append)
        for event in [
            key("key_down", 0xA2, 1),
            key("key_down", 0x43, 2),
            key("key_up", 0x43, 3),
            key("key_up", 0xA2, 4),
        ]:
            filter_.handle(event)
        filter_.finish()

        self.assertEqual([1, 2, 3, 4], [event.time_ns for event in output])


if __name__ == "__main__":
    unittest.main()
