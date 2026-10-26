import json
import unittest
from unittest.mock import patch

from cua_record.trace_generator import TraceGenerator


class SkillSummaryTests(unittest.TestCase):
    def test_summary_reuses_recording_model_and_validates_semantic_identity(self):
        with patch.dict("os.environ", {"OPENAI_API_KEY": "test"}, clear=False):
            generator = TraceGenerator()
        output = {"name": "network-alarm-search", "description": "查询网络告警", "goal": "显示查询结果"}
        with patch.object(generator, "_call_openai", return_value=json.dumps(output)) as call:
            result = generator.summarize_skill([
                {"step_idx": 1, "caption": {"operation": {"type": "click", "prompt": "查询"}}}
            ])
        self.assertEqual(result, output)
        self.assertEqual(call.call_args.args[1:], (None, None))
        self.assertIn("电脑操作目标", call.call_args.args[0])

    def test_summary_rejects_incomplete_or_path_based_names(self):
        for name in ("../escape", "C:\\skills", "Invalid-Name", "a" * 65):
            with self.subTest(name=name), self.assertRaises(ValueError):
                TraceGenerator._validated_skill_metadata({"name": name, "description": "用途", "goal": "目标"})
        with self.assertRaises(ValueError):
            TraceGenerator._validated_skill_metadata({"name": "valid-name"})


if __name__ == "__main__":
    unittest.main()
