import unittest

from cua_record.log_processor import LogProcessor


def key_press(timestamp, key):
    return {
        "timestamp": timestamp,
        "action": f"Key Press: {key}",
        "coords": None,
        "current_software": "PcAccess.exe",
    }


def hotkey(timestamp, value):
    return {
        "timestamp": timestamp,
        "action": f"Hotkey: {value}",
        "coords": None,
        "current_software": "PcAccess.exe",
    }


class LogProcessorKeyboardMergeTest(unittest.TestCase):
    def test_paste_without_text_fails_before_task_generation(self):
        with self.assertRaisesRegex(ValueError, "缺少可用的剪贴板文本"):
            LogProcessor().fold_text_paste([hotkey(1.0, "CTRL+V")])

    def test_paste_keeps_preceding_typing_and_drops_copy_selection(self):
        actions = [
            key_press(1.0, "A"),
            {"timestamp": 1.1, "action": "DragStart at", "coords": [{"x": 1, "y": 2}], "current_software": "Editor"},
            hotkey(1.2, "CTRL+C"),
            {**hotkey(1.3, "CTRL+V"), "clipboard_text": "中文\ntext"},
        ]
        processor = LogProcessor()
        merged = processor.merge_keyboard_events(actions)
        folded = processor.fold_text_paste(merged)
        self.assertEqual(["Type: A", "Paste text"], [item["action"] for item in folded])
        self.assertEqual("中文\ntext", folded[-1]["clipboard_text"])

    def test_merge_numpad_digits_into_typing_action(self):
        actions = [
            key_press(58.678, "NUMPAD_4"),
            key_press(59.028, "NUMPAD_7"),
            key_press(59.341, "NUMPAD_4"),
            key_press(59.767, "NUMPAD_0"),
            key_press(60.212, "NUMPAD_5"),
        ]

        merged = LogProcessor().merge_keyboard_events(actions)

        self.assertEqual(
            [{"timestamp": 60.212, "action": "Type: 47405", "coords": None, "current_software": "PcAccess.exe"}],
            merged,
        )

    def test_merge_numpad_decimal_into_typing_action(self):
        actions = [
            key_press(1.0, "NUMPAD_4"),
            key_press(1.1, "NUMPAD_7"),
            key_press(1.2, "NUMPAD_DECIMAL"),
            key_press(1.3, "NUMPAD_0"),
            key_press(1.4, "NUMPAD_5"),
        ]

        merged = LogProcessor().merge_keyboard_events(actions)

        self.assertEqual(
            [{"timestamp": 1.4, "action": "Type: 47.05", "coords": None, "current_software": "PcAccess.exe"}],
            merged,
        )

    def test_merge_static_punctuation_mapping_into_typing_action(self):
        actions = [
            hotkey(1.0, "SHIFT+:"),
            key_press(1.1, "\\"),
            hotkey(1.2, "SHIFT+_"),
        ]

        merged = LogProcessor().merge_keyboard_events(actions)

        self.assertEqual(
            [{"timestamp": 1.2, "action": "Type: :\\_", "coords": None, "current_software": "PcAccess.exe"}],
            merged,
        )


class LogProcessorDoubleClickTest(unittest.TestCase):
    def test_drag_keeps_one_action_after_nearby_click_cleanup(self):
        actions = [
            {"timestamp": 1.0, "action": "LClick at", "coords": [{"x": 10, "y": 20}]},
            {"timestamp": 1.1, "action": "DragStart at", "coords": [{"x": 10, "y": 20}],
             "path": [{"x": 10, "y": 20}, {"x": 80, "y": 20}]},
        ]
        cleaned = LogProcessor().cleanup_click_before_drag(actions)
        self.assertEqual(["DragStart at"], [item["action"] for item in cleaned])
        self.assertEqual(actions[1]["path"], cleaned[0]["path"])

    def test_right_click_keeps_right_button_semantics(self):
        actions = [
            {"timestamp": 1.0, "action": "RClick at", "coords": [{"x": 10, "y": 20}], "current_software": "Explorer"},
            {"timestamp": 1.1, "action": "RRelease at", "coords": [{"x": 10, "y": 20}], "current_software": "Explorer"},
        ]
        merged = LogProcessor().merge_mouse_events(actions)
        self.assertEqual(["RClick at"], [item["action"] for item in merged])

    def test_click_keeps_release_time_but_uses_press_time_for_evidence(self):
        actions = [
            {
                "timestamp": 5.502,
                "action": "LClick at",
                "coords": [{"x": 816, "y": 495}],
                "current_software": "Chrome",
            },
            {
                "timestamp": 5.627,
                "action": "LRelease at",
                "coords": [{"x": 816, "y": 495}],
                "current_software": "Chrome",
            },
        ]

        merged = LogProcessor().merge_mouse_events(actions)

        self.assertEqual(5.627, merged[0]["timestamp"])
        self.assertEqual(5.502, merged[0]["evidence_timestamp"])

    def test_cleanup_keeps_ldoubleclick_and_removes_preceding_single_click(self):
        actions = [
            {
                "timestamp": 1.0,
                "action": "LClick at",
                "coords": [{"x": 320, "y": 240}],
                "current_software": "Explorer",
            },
            {
                "timestamp": 1.1,
                "action": "LDoubleClick at",
                "coords": [{"x": 321, "y": 239}],
                "current_software": "Explorer",
            },
        ]

        cleaned = LogProcessor().cleanup_preceded_double_clicks(actions)

        self.assertEqual(1, len(cleaned))
        self.assertEqual("LDoubleClick at", cleaned[0]["action"])
        self.assertEqual(1.0, cleaned[0]["evidence_timestamp"])

    def test_double_click_uses_first_press_as_evidence_anchor(self):
        actions = [
            {
                "timestamp": 2.622,
                "evidence_timestamp": 2.544,
                "action": "LClick at",
                "coords": [{"x": 320, "y": 240}],
                "current_software": "Explorer",
            },
            {
                "timestamp": 2.801,
                "evidence_timestamp": 2.712,
                "action": "LDoubleClick at",
                "coords": [{"x": 321, "y": 239}],
                "current_software": "Explorer",
            },
        ]

        cleaned = LogProcessor().cleanup_preceded_double_clicks(actions)

        self.assertEqual(2.544, cleaned[0]["evidence_timestamp"])


class LogProcessorScrollTest(unittest.TestCase):
    def test_group_retains_evidence_time_and_last_scroll_time(self):
        actions = [
            {"timestamp": 1.0, "action": "ScrollDown at", "coords": [{"x": 10, "y": 20}],
             "current_software": "Browser"},
            {"timestamp": 4.0, "action": "ScrollDown at", "coords": [{"x": 10, "y": 20}],
             "current_software": "Browser"},
            {"timestamp": 8.0, "action": "ScrollDown at", "coords": [{"x": 10, "y": 20}],
             "current_software": "Browser"},
        ]
        merged = LogProcessor().process_scroll_events(actions)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["timestamp"], 1.0)
        self.assertEqual(merged[0]["scroll_end_timestamp"], 8.0)


if __name__ == "__main__":
    unittest.main()
