import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np

from cua_record.screenshot_processor import VideoScreenshotExtractor


class ScreenshotProcessorReferenceImageTest(unittest.TestCase):
    def setUp(self):
        self.frame = np.full((1080, 1920, 3), (40, 80, 120), dtype=np.uint8)
        cv2.rectangle(self.frame, (480, 480), (520, 520), (10, 220, 30), -1)
        self.extractor = VideoScreenshotExtractor()

    def test_click_keeps_marked_crop_and_adds_clean_reference_png(self):
        actions = [
            {
                "timestamp": 1.0,
                "action": "LClick at",
                "coords": [{"x": 500, "y": 500}],
            }
        ]
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp)
            with patch.object(self.extractor, "_get_frame_at", return_value=self.frame.copy()):
                processed = self.extractor.process_actions(
                    actions,
                    "recording.mp4",
                    output,
                    False,
                    1.0,
                    1.0,
                )

            self.assertEqual("screenshots/0.900s.crop.jpg", processed[0]["screenshot_crop"])
            self.assertEqual(
                "screenshots/0.900s.reference.png",
                processed[0]["screenshot_reference"],
            )
            marked = cv2.imread(str(output / "0.900s.crop.jpg"))
            reference = cv2.imread(str(output / "0.900s.reference.png"))
            self.assertEqual((256, 256), marked.shape[:2])
            self.assertEqual((96, 96), reference.shape[:2])
            self.assertTrue(np.array_equal(reference[48, 48], self.frame[500, 500]))
            self.assertFalse(np.array_equal(marked[128, 128], self.frame[500, 500]))

    def test_double_click_saves_all_images_in_unicode_directory(self):
        actions = [{"timestamp": 1.0, "action": "LDoubleClick at", "coords": [{"x": 500, "y": 500}]}]
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "新建文件夹" / "screenshots"
            with patch.object(self.extractor, "_get_frame_at", return_value=self.frame.copy()):
                processed = self.extractor.process_actions(
                    actions, "recording.mp4", output, False, 1.0, 1.0,
                )

            self.assertEqual("screenshots/0.900s.jpg", processed[0]["screenshot_full"])
            self.assertEqual("screenshots/0.900s.crop.jpg", processed[0]["screenshot_crop"])
            self.assertEqual("screenshots/0.900s.reference.png", processed[0]["screenshot_reference"])
            for name in ("0.900s.jpg", "0.900s.crop.jpg", "0.900s.reference.png"):
                data = np.frombuffer((output / name).read_bytes(), dtype=np.uint8)
                self.assertIsNotNone(cv2.imdecode(data, cv2.IMREAD_COLOR))

    def test_paste_uses_full_frame_without_click_coordinates(self):
        actions = [{"timestamp": 1.0, "action": "Paste text", "coords": None, "clipboard_text": "中文"}]
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(self.extractor, "_get_frame_at", return_value=self.frame.copy()):
                processed = self.extractor.process_actions(
                    actions, "recording.mp4", Path(tmp), False, 1.0, 1.0,
                )
            self.assertEqual("中文", processed[0]["clipboard_text"])
            self.assertNotIn("screenshot_reference", processed[0])

    def test_click_marker_is_small_and_translucent(self):
        actions = [
            {
                "timestamp": 1.0,
                "action": "LClick at",
                "coords": [{"x": 500, "y": 500}],
            }
        ]
        saved_crops = {}

        def capture_jpg(path, image):
            if path.endswith(".crop.jpg"):
                saved_crops[Path(path).name] = image.copy()
            return True

        with (
            patch.object(self.extractor, "_get_frame_at", return_value=self.frame.copy()),
            patch.object(self.extractor, "_save_jpg", side_effect=capture_jpg),
            patch.object(self.extractor, "_save_png", return_value=True),
        ):
            self.extractor.process_actions(
                actions, "recording.mp4", Path("screenshots"), False, 1.0, 1.0,
            )

        marked = saved_crops["0.900s.crop.jpg"]
        center = self.frame[500, 500].astype(np.int16)
        center_change = np.abs(marked[128, 128].astype(np.int16) - center)
        self.assertGreater(int(center_change.max()), 40)
        self.assertLess(int(center_change.max()), 75)
        self.assertTrue(np.array_equal(marked[142, 142], center))

    def test_click_uses_press_evidence_timestamp_and_clamps_at_zero(self):
        actions = [
            {
                "timestamp": 1.2,
                "evidence_timestamp": 0.05,
                "action": "LClick at",
                "coords": [{"x": 500, "y": 500}],
            }
        ]
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(self.extractor, "_get_frame_at", return_value=self.frame.copy()) as get_frame:
                processed = self.extractor.process_actions(
                    actions,
                    "recording.mp4",
                    Path(tmp),
                    False,
                    1.0,
                    1.0,
                )

            get_frame.assert_called_once_with("recording.mp4", 0.0)
            self.assertEqual("screenshots/0.000s.jpg", processed[0]["screenshot_full"])

    def test_click_variants_generate_reference_but_type_does_not(self):
        actions = [
            {
                "timestamp": 1.0,
                "action": "LDoubleClick at",
                "coords": [{"x": 500, "y": 500}],
            },
            {
                "timestamp": 2.0,
                "action": "RClick at",
                "coords": [{"x": 500, "y": 500}],
            },
            {
                "timestamp": 3.0,
                "action": "Type: TEST",
                "coords": [{"x": 500, "y": 500}],
            },
        ]
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(self.extractor, "_get_frame_at", return_value=self.frame.copy()):
                processed = self.extractor.process_actions(
                    actions,
                    "recording.mp4",
                    Path(tmp),
                    False,
                    1.0,
                    1.0,
                )

            self.assertIn("screenshot_reference", processed[0])
            self.assertIn("screenshot_reference", processed[1])
            self.assertNotIn("screenshot_reference", processed[2])

    def test_keyboard_action_uses_unmarked_full_frame_crop(self):
        actions = [
            {
                "timestamp": 1.0,
                "action": "Press ENTER",
                "coords": [{"x": 500, "y": 500}],
            }
        ]
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp)
            with patch.object(self.extractor, "_get_frame_at", return_value=self.frame.copy()):
                processed = self.extractor.process_actions(
                    actions,
                    "recording.mp4",
                    output,
                    False,
                    1.0,
                    1.0,
                )

            crop = cv2.imread(str(output / "0.900s.crop.jpg"))
            self.assertEqual(self.frame.shape[:2], crop.shape[:2])
            self.assertNotIn("screenshot_reference", processed[0])

    def test_reference_save_failure_aborts_processing(self):
        actions = [
            {
                "timestamp": 1.0,
                "action": "LClick at",
                "coords": [{"x": 500, "y": 500}],
            }
        ]
        with tempfile.TemporaryDirectory() as tmp:
            with (
                patch.object(self.extractor, "_get_frame_at", return_value=self.frame.copy()),
                patch.object(self.extractor, "_save_png", return_value=False),
            ):
                with self.assertRaisesRegex(RuntimeError, "0.9s: LClick at"):
                    self.extractor.process_actions(
                        actions,
                        "recording.mp4",
                        Path(tmp),
                        False,
                        1.0,
                        1.0,
                    )


class ScreenshotProcessorConfigTest(unittest.TestCase):
    def test_nonzero_selected_display_provides_recording_resolution(self):
        actions = [
            {
                "timestamp": 0.0,
                "action": "CONFIG",
                "coords": {
                    "1": {
                        "width": 2560,
                        "height": 1440,
                        "scale_factor": 1.0,
                    }
                },
            }
        ]

        extractor = VideoScreenshotExtractor()

        self.assertEqual((2560, 1440), extractor._parse_config_resolution(actions))

    def test_high_dpi_recording_scales_pointer_from_video_pixels(self):
        extractor = VideoScreenshotExtractor()
        actions = [
            {"timestamp": 0.0, "action": "CONFIG", "coords": {
                "0": {"width": 2880, "height": 1800, "scale_factor": 1.5},
            }},
            {"timestamp": 1.0, "action": "LClick at", "coords": [{"x": 2700, "y": 600}]},
        ]
        frame = np.zeros((1080, 1920, 3), dtype=np.uint8)
        frame[350:370, 1790:1810] = (20, 80, 200)

        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp) / "dpi-recording"
            inputs = project / "inputs"
            inputs.mkdir(parents=True)
            (inputs / "dpi-recording.mp4").touch()
            (project / "dpi-recording_processed_log.json").write_text(
                json.dumps(actions), encoding="utf-8",
            )
            with patch.object(extractor, "_get_frame_at", return_value=frame):
                processed, screenshots, metadata = extractor.process_project(project)

            self.assertEqual("2880x1800", metadata["original_resolution"])
            self.assertEqual({"x": 1800.0, "y": 360.0}, processed[0]["coords"][0])
            data = np.frombuffer((screenshots / "0.900s.reference.png").read_bytes(), dtype=np.uint8)
            reference = cv2.imdecode(data, cv2.IMREAD_COLOR)
            self.assertTrue(np.array_equal(reference[48, 48], frame[360, 1800]))


if __name__ == "__main__":
    unittest.main()
