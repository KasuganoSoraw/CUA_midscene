import tempfile
import unittest
from pathlib import Path
import sys
from unittest.mock import patch

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from screenshot_processor import VideoScreenshotExtractor


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

    def test_double_click_generates_reference_but_type_does_not(self):
        actions = [
            {
                "timestamp": 1.0,
                "action": "LDoubleClick at",
                "coords": [{"x": 500, "y": 500}],
            },
            {
                "timestamp": 2.0,
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
            self.assertNotIn("screenshot_reference", processed[1])

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


if __name__ == "__main__":
    unittest.main()
