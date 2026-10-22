import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from cua_record.prepare import prepare_recording, validate_assets


class PrepareTest(unittest.TestCase):
    def test_prepare_reuses_processors_without_trace_or_task(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "recording"
            (root / "inputs").mkdir(parents=True)
            (root / "inputs" / "input.txt").write_text("raw", encoding="utf-8")
            screenshots = root / "screenshots"
            screenshots.mkdir()
            (screenshots / "1.jpg").write_bytes(b"image")
            actions = [{"action": "Type: 中文", "timestamp": 1,
                        "screenshot_full": "screenshots/1.jpg",
                        "screenshot_crop": "screenshots/1.jpg"}]
            (root / "recording_processed_log_sc.json").write_text(json.dumps(actions))
            with (patch("cua_record.prepare.LogProcessor") as log,
                  patch("cua_record.prepare.VideoScreenshotExtractor") as extractor,
                  patch("cua_record.pipeline.TraceGenerator") as trace):
                extractor.return_value.process_project.return_value = (actions, screenshots, {})
                phases = []
                result = prepare_recording(str(root), phases.append)
                self.assertEqual(["processing", "extracting"], phases)
                self.assertEqual(1, result["stepCount"])
                self.assertEqual(str(root), result["recordingRoot"])
                log.return_value.process_log_file.assert_called_once()
                extractor.return_value.process_project.assert_called_once()
                trace.assert_not_called()
                self.assertFalse((root / "task.yaml").exists())

    def test_asset_references_reject_missing_empty_and_escaping_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            shots = root / "screenshots"
            shots.mkdir()
            log = root / "log.json"
            for value in ("../outside.jpg", "screenshots/missing.jpg", str(root / "absolute.jpg")):
                log.write_text(json.dumps([{"screenshot_full": value}]))
                with self.assertRaises(ValueError):
                    validate_assets(root, log, shots)
