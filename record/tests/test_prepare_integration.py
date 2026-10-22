import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np
from cua_record.prepare import prepare_recording


def create_recording(root: Path) -> None:
    inputs = root / "inputs"
    inputs.mkdir()
    writer = cv2.VideoWriter(str(inputs / f"{root.name}.mp4"),
                             cv2.VideoWriter_fourcc(*"mp4v"), 10, (640, 360))
    if not writer.isOpened():
        raise RuntimeError("测试视频编码器不可用")
    try:
        for index in range(30):
            frame = np.full((360, 640, 3), 220, dtype=np.uint8)
            cv2.putText(frame, f"CUA fixture {index}", (20, 80),
                        cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 0), 2)
            writer.write(frame)
    finally:
        writer.release()
    config = {"0": {"width": 640, "height": 360, "scale_factor": 1}}
    events = [{"timestamp": "00:00:00.000", "message": json.dumps(config)}]
    for index in range(1, 15):
        events.append({"timestamp": f"00:00:0{index // 5}.{index % 5 * 200:03}",
                       "message": "LClick at (200, 100)", "window": "Fixture"})
    (inputs / f"{root.name}.txt").write_text(
        "\n".join(json.dumps(event) for event in events), encoding="utf-8",
    )


class PrepareIntegrationTest(unittest.TestCase):
    def test_prepare_supports_unicode_recording_and_screenshot_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "source"
            source.mkdir()
            create_recording(source)
            target = Path(temporary) / "普通录制-示教"
            source.rename(target)
            result = prepare_recording(str(target))
            self.assertEqual(str(target), result["recordingRoot"])
            self.assertGreater(result["stepCount"], 0)
            actions = json.loads(Path(result["processedLogPath"]).read_text(encoding="utf-8"))
            screenshot = target / actions[0]["screenshot_full"]
            image = cv2.imdecode(np.frombuffer(screenshot.read_bytes(), dtype=np.uint8), cv2.IMREAD_COLOR)
            self.assertEqual((1080, 1920), image.shape[:2])

    def test_real_video_and_log_prepare_without_model(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            create_recording(root)
            with patch("cua_record.pipeline.TraceGenerator") as trace:
                result = prepare_recording(str(root))
                trace.assert_not_called()
            self.assertGreater(result["stepCount"], 0)
            actions = json.loads(Path(result["processedLogPath"]).read_text(encoding="utf-8"))
            self.assertEqual("Fixture", actions[0]["current_software"])
            self.assertIn("timestamp", actions[0])
            self.assertIn("coords", actions[0])
            print("prepare real-video fixture timings:", json.dumps(result["timingsMs"]))
            self.assertFalse(list(root.glob("*trace*")))
            self.assertFalse((root / "task.yaml").exists())
            completed = subprocess.run(
                [sys.executable, "-m", "cua_record", "prepare", str(root)],
                capture_output=True, text=True, encoding="utf-8", check=True, timeout=30,
            )
            frame = json.loads(completed.stdout)
            self.assertEqual("prepared", frame["event"])
            self.assertIn('"phase": "extracting"', completed.stderr)
