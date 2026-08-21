from __future__ import annotations

import io
import json
import unittest

from cua_recorder.events import AlohaEventFormatter, format_timestamp, key_name
from cua_recorder.hooks import RawInputEvent


def messages(stream: io.StringIO) -> list[str]:
    return [json.loads(line)["message"] for line in stream.getvalue().splitlines()]


class EventFormattingTest(unittest.TestCase):
    def create_formatter(self, stream: io.StringIO) -> AlohaEventFormatter:
        return AlohaEventFormatter(
            stream,
            started_ns=1_000_000_000,
            window_provider=lambda: "chrome.exe - Example",
            double_click_ms=500,
            double_click_distance=4,
            drag_distance=4,
        )

    def test_timestamp_uses_milliseconds(self) -> None:
        self.assertEqual("01:02:03.004", format_timestamp(3_723_004_000_000))

    def test_key_press_release_and_hotkey(self) -> None:
        stream = io.StringIO()
        formatter = self.create_formatter(stream)
        formatter.handle(RawInputEvent("key_down", 1_010_000_000, vk_code=0x41))
        formatter.handle(RawInputEvent("key_up", 1_020_000_000, vk_code=0x41))
        formatter.handle(RawInputEvent("key_down", 1_030_000_000, vk_code=0x11))
        formatter.handle(RawInputEvent("key_down", 1_040_000_000, vk_code=0x53))

        self.assertEqual(
            ["Key Press: A", "Key Release: A", "Key Press: CTRL", "Hotkey: CTRL+S"],
            messages(stream),
        )

    def test_double_click_matches_aloha_sequence(self) -> None:
        stream = io.StringIO()
        formatter = self.create_formatter(stream)
        formatter.handle(RawInputEvent("mouse_down", 1_010_000_000, x=10, y=20, button="left"))
        formatter.handle(RawInputEvent("mouse_up", 1_020_000_000, x=10, y=20, button="left"))
        formatter.handle(RawInputEvent("mouse_down", 1_200_000_000, x=11, y=19, button="left"))
        formatter.handle(RawInputEvent("mouse_up", 1_210_000_000, x=11, y=19, button="left"))

        self.assertEqual(
            ["LClick at (10, 20)", "LRelease at (10, 20)", "LDoubleClick at (11, 19)", "LRelease at (11, 19)"],
            messages(stream),
        )

    def test_drag_emits_start_move_end(self) -> None:
        stream = io.StringIO()
        formatter = self.create_formatter(stream)
        formatter.handle(RawInputEvent("mouse_down", 1_010_000_000, x=10, y=20, button="left"))
        formatter.handle(RawInputEvent("mouse_move", 1_020_000_000, x=20, y=30))
        formatter.handle(RawInputEvent("mouse_up", 1_030_000_000, x=30, y=40, button="left"))

        self.assertEqual(
            ["LClick at (10, 20)", "DragStart at (10, 20)", "DragMove at (20, 30)", "LDragEnd at (30, 40)"],
            messages(stream),
        )

    def test_coordinates_are_relative_to_selected_display(self) -> None:
        stream = io.StringIO()
        formatter = AlohaEventFormatter(
            stream,
            started_ns=1_000_000_000,
            window_provider=lambda: "chrome.exe - Example",
            coordinate_origin=(-1920, 200),
            coordinate_size=(1920, 1080),
        )
        formatter.handle(RawInputEvent("mouse_down", 1_010_000_000, x=-1900, y=230, button="left"))
        formatter.handle(RawInputEvent("mouse_down", 1_020_000_000, x=100, y=230, button="right"))
        self.assertEqual(["LClick at (20, 30)"], messages(stream))

    def test_key_names_cover_numpad(self) -> None:
        self.assertEqual("NUMPAD_7", key_name(0x67))
        self.assertEqual("NUMPAD_DECIMAL", key_name(0x6E))

    def test_finish_writes_processor_cleanup_sentinel(self) -> None:
        stream = io.StringIO()
        formatter = self.create_formatter(stream)
        formatter.handle(RawInputEvent("key_down", 1_010_000_000, vk_code=0x41))
        formatter.finish(1_020_000_000)
        self.assertEqual(["Key Press: A", "Recording Stopped"], messages(stream))


if __name__ == "__main__":
    unittest.main()
