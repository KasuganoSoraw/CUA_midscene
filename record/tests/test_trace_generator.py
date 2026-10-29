import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from cua_record.resources import default_prompt_path
from cua_record.trace_generator import TraceGenerator, env_bool


class StubTraceGenerator(TraceGenerator):
    def _call_openai(self, prompt, crop_b64, full_b64):
        return json.dumps(
            {
                "Observation": "局部图中红色 X 位于按钮上。",
                "Think": "用户需要点击该按钮继续。",
                "Action": "点击继续按钮。",
                "Expectation": "页面进入下一步。",
                "Operation": {
                    "type": "click",
                    "prompt": "点击继续按钮",
                },
            },
            ensure_ascii=False,
        )


class RetryTraceGenerator(TraceGenerator):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.calls = 0

    def _call_openai(self, prompt, crop_b64, full_b64):
        self.calls += 1
        if self.calls == 1:
            return json.dumps(
                {
                    "Observation": "",
                    "Think": "",
                    "Action": "",
                    "Expectation": "",
                    "Operation": {"type": "unknown"},
                },
                ensure_ascii=False,
            )

        return json.dumps(
            {
                "Observation": "局部图中红色 X 位于目的地建议项上。",
                "Think": "用户需要选择该目的地。",
                "Action": "点击 Los Angeles 目的地建议项。",
                "Expectation": "目的地被设置为 Los Angeles。",
                "Operation": {
                    "type": "click",
                    "prompt": "点击 Los Angeles 目的地建议项",
                },
            },
            ensure_ascii=False,
        )


class InvalidTraceGenerator(TraceGenerator):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.calls = 0

    def _call_openai(self, prompt, crop_b64, full_b64):
        self.calls += 1
        return json.dumps(
            {
                "Observation": "无法确定目标。",
                "Think": "信息不足。",
                "Action": "继续操作。",
                "Expectation": "页面变化。",
                "Operation": {"type": "unknown"},
            },
            ensure_ascii=False,
        )


class DoubleClickRetryTraceGenerator(TraceGenerator):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.calls = 0

    def _call_openai(self, prompt, crop_b64, full_b64):
        self.calls += 1
        operation_type = "click" if self.calls == 1 else "doubleClick"
        action = "点击文件行。" if self.calls == 1 else "双击文件行。"
        return json.dumps(
            {
                "Observation": "局部图中红色 X 位于 report.xlsx 文件行上。",
                "Think": "用户需要打开该文件。",
                "Action": action,
                "Expectation": "文件被打开。",
                "Operation": {
                    "type": operation_type,
                    "prompt": "双击文件列表中的 report.xlsx 文件行以打开文件",
                },
            },
            ensure_ascii=False,
        )


class TraceGeneratorOperationTest(unittest.TestCase):
    def test_english_generation_uses_english_prompt_and_summary(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}):
            generator = TraceGenerator(language="en-US")
        prompt = generator._prompt(
            {"action": "ScrollDown at", "timestamp": 1.0}, "", 1, [],
        )
        self.assertIn("Write explanatory values", prompt)
        self.assertIn("Operation.type must be aiAct", prompt)
        self.assertNotIn("字段值必须使用中文", prompt)
        with patch.object(generator, "_call_openai", return_value=json.dumps({
            "name": "sample-search", "description": "Search records", "goal": "Show matching records",
        })) as call:
            result = generator.summarize_skill([])
        self.assertEqual(result["goal"], "Show matching records")
        self.assertIn("Write description and goal in English", call.call_args.args[0])
        self.assertNotIn("description 用中文", call.call_args.args[0])

    def test_recorded_input_and_press_actions_mandate_operation_types(self):
        previous_key = os.environ.get("OPENAI_API_KEY")
        os.environ["OPENAI_API_KEY"] = "test-key"
        try:
            with tempfile.TemporaryDirectory() as tmp:
                prompt_path = Path(tmp) / "default_prompt.json"
                prompt_path.write_text(json.dumps({"Base Prompt": ""}), encoding="utf-8")
                generator = StubTraceGenerator(
                    default_prompt_path=str(prompt_path),
                    api_provider="openai",
                )

                self.assertEqual("input", generator._recorded_operation_type("Type: ADMIN"))
                self.assertEqual("input", generator._recorded_operation_type("Paste text"))
                self.assertEqual("rightClick", generator._recorded_operation_type("RClick at"))
                self.assertEqual("keyboard", generator._recorded_operation_type("Press ENTER"))
                self.assertIsNone(generator._recorded_operation_type("Hotkey: CTRL+S"))
                self.assertIn(
                    "录制事件要求 Operation.type 为 input",
                    generator._operation_error(
                        {"type": "click", "prompt": "点击输入框"},
                        generator._recorded_operation_type("Type: ADMIN"),
                    ),
                )
                self.assertIn(
                    "Operation.type 为 rightClick",
                    generator._operation_error(
                        {"type": "click", "prompt": "点击菜单"},
                        generator._recorded_operation_type("RClick at"),
                    ),
                )
        finally:
            if previous_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = previous_key

    def test_env_bool_is_strict(self):
        with patch.dict(os.environ, {"OPENAI_VERIFY_SSL": "false"}):
            self.assertFalse(env_bool("OPENAI_VERIFY_SSL", True))
        with patch.dict(os.environ, {"OPENAI_VERIFY_SSL": "true"}):
            self.assertTrue(env_bool("OPENAI_VERIFY_SSL", False))
        with patch.dict(os.environ, {"OPENAI_VERIFY_SSL": "invalid"}):
            with self.assertRaisesRegex(ValueError, "OPENAI_VERIFY_SSL 必须是"):
                env_bool("OPENAI_VERIFY_SSL", True)

    def test_paste_uses_exact_clipboard_value(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}):
            generator = TraceGenerator(api_provider="openai")
            item = {"action": "Paste text", "timestamp": 1.0, "clipboard_text": " 中文\n"}
            caption = {
                "action": "向输入框追加文本",
                "operation": {
                    "type": "input", "prompt": "向搜索框追加文本",
                    "locatePrompt": "搜索框", "value": "其他文本",
                },
            }
            with (
                patch.object(generator, "_step_images", return_value=(None, None)),
                patch.object(generator, "_request_caption", return_value=caption),
            ):
                result = generator._trace_step(item, item, "unused", "", [], 1, 1.0, "Paste text")
            self.assertEqual(" 中文\n", result["operation"]["value"])

    def test_openai_request_can_disable_ssl_verification(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            prompt_path = root / "default_prompt.json"
            prompt_path.write_text(json.dumps({"Base Prompt": ""}), encoding="utf-8")
            keys_path = root / "api_keys.json"
            keys_path.write_text("{}", encoding="utf-8")
            response = Mock()
            response.raise_for_status.return_value = None
            response.json.return_value = {"choices": [{"message": {"content": "{}"}}]}

            with (
                patch.dict(
                    os.environ,
                    {"OPENAI_API_KEY": "test-key", "OPENAI_VERIFY_SSL": "false"},
                    clear=False,
                ),
                patch("cua_record.trace_generator.requests.post", return_value=response) as post,
            ):
                generator = TraceGenerator(
                    default_prompt_path=str(prompt_path),
                    api_provider="openai",
                    api_keys_path=str(keys_path),
                )
                generator._call_openai("prompt", None, None)

            self.assertFalse(generator.openai_verify_ssl)
            self.assertFalse(post.call_args.kwargs["verify"])

    def test_sanitize_operation_preserves_input_locate_prompt(self):
        previous_key = os.environ.get("OPENAI_API_KEY")
        os.environ["OPENAI_API_KEY"] = "test-key"
        try:
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                prompt_path = root / "default_prompt.json"
                prompt_path.write_text(json.dumps({"Base Prompt": ""}, ensure_ascii=False), encoding="utf-8")

                generator = StubTraceGenerator(default_prompt_path=str(prompt_path), api_provider="openai")

                self.assertEqual(
                    {
                        "type": "input",
                        "prompt": "在 Chrome 地址栏/搜索栏中输入 {{value}}",
                        "locatePrompt": "Chrome 地址栏/搜索栏",
                        "value": "QATAR AIRWAYS",
                    },
                    generator._sanitize_operation(
                        {
                            "type": "Input",
                            "prompt": " 在 Chrome 地址栏/搜索栏中输入 {{value}} ",
                            "locatePrompt": " Chrome 地址栏/搜索栏 ",
                            "value": " QATAR AIRWAYS ",
                        }
                    ),
                )
        finally:
            if previous_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = previous_key

    def test_sanitize_operation_preserves_required_reference_image(self):
        previous_key = os.environ.get("OPENAI_API_KEY")
        os.environ["OPENAI_API_KEY"] = "test-key"
        try:
            with tempfile.TemporaryDirectory() as tmp:
                prompt_path = Path(tmp) / "default_prompt.json"
                prompt_path.write_text(json.dumps({"Base Prompt": ""}), encoding="utf-8")
                generator = StubTraceGenerator(
                    default_prompt_path=str(prompt_path),
                    api_provider="openai",
                )

                operation = generator._sanitize_operation(
                    {
                        "type": "click",
                        "prompt": "点击页面右上角无文字告警图标",
                        "useReferenceImage": True,
                    }
                )

                self.assertTrue(operation["useReferenceImage"])
                self.assertIsNone(generator._operation_error(operation))
        finally:
            if previous_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = previous_key

    def test_reference_image_false_is_omitted(self):
        previous_key = os.environ.get("OPENAI_API_KEY")
        os.environ["OPENAI_API_KEY"] = "test-key"
        try:
            with tempfile.TemporaryDirectory() as tmp:
                prompt_path = Path(tmp) / "default_prompt.json"
                prompt_path.write_text(json.dumps({"Base Prompt": ""}), encoding="utf-8")
                generator = StubTraceGenerator(
                    default_prompt_path=str(prompt_path),
                    api_provider="openai",
                )

                operation = generator._sanitize_operation(
                    {
                        "type": "click",
                        "prompt": "点击带文字的继续按钮",
                        "useReferenceImage": False,
                    }
                )

                self.assertNotIn("useReferenceImage", operation)
        finally:
            if previous_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = previous_key

    def test_reference_image_rejects_non_boolean_and_non_click_operation(self):
        previous_key = os.environ.get("OPENAI_API_KEY")
        os.environ["OPENAI_API_KEY"] = "test-key"
        try:
            with tempfile.TemporaryDirectory() as tmp:
                prompt_path = Path(tmp) / "default_prompt.json"
                prompt_path.write_text(json.dumps({"Base Prompt": ""}), encoding="utf-8")
                generator = StubTraceGenerator(
                    default_prompt_path=str(prompt_path),
                    api_provider="openai",
                )

                invalid_type = generator._sanitize_operation(
                    {
                        "type": "click",
                        "prompt": "点击告警图标",
                        "useReferenceImage": "true",
                    }
                )
                invalid_operation = generator._sanitize_operation(
                    {
                        "type": "input",
                        "prompt": "输入 {{value}}",
                        "locatePrompt": "搜索框",
                        "value": "告警",
                        "useReferenceImage": True,
                    }
                )

                self.assertIn("只能是布尔值 true", generator._operation_error(invalid_type))
                self.assertIn("只有 click、doubleClick 或 rightClick", generator._operation_error(invalid_operation))
        finally:
            if previous_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = previous_key

    def test_prompt_explains_reference_image_selection(self):
        previous_key = os.environ.get("OPENAI_API_KEY")
        os.environ["OPENAI_API_KEY"] = "test-key"
        try:
            prompt_path = default_prompt_path()
            generator = StubTraceGenerator(
                default_prompt_path=str(prompt_path),
                api_provider="openai",
            )

            prompt = generator._prompt(
                {"action": "LClick at", "current_software": "Chrome", "timestamp": 1.0},
                "打开告警页面",
                1,
                [],
            )

            self.assertIn("useReferenceImage: true", prompt)
            self.assertIn("目标本身没有可见文字标签，必须输出", prompt)
            self.assertIn("不要再额外判断纯文字 prompt 是否已经足够", prompt)
            self.assertIn("设置齿轮", prompt)
            self.assertIn("带相邻可见文字标签的单选框/复选框", prompt)
            self.assertIn("不要输出 false、字符串、路径、Base64", prompt)
        finally:
            if previous_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = previous_key

    def test_generate_trace_preserves_operation_field(self):
        previous_key = os.environ.get("OPENAI_API_KEY")
        os.environ["OPENAI_API_KEY"] = "test-key"
        try:
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                prompt_path = root / "default_prompt.json"
                prompt_path.write_text(json.dumps({"Base Prompt": "只输出 JSON。"}, ensure_ascii=False), encoding="utf-8")

                shots_dir = root / "screenshots"
                shots_dir.mkdir()
                (shots_dir / "step.jpg").write_bytes(b"fake-jpeg")

                recording_path = root / "recording.json"
                recording_path.write_text(
                    json.dumps(
                        [
                            {
                                "timestamp": 1.0,
                                "action": "LClick at",
                                "current_software": "Chrome",
                                "screenshot": "step.jpg",
                            }
                        ],
                        ensure_ascii=False,
                    ),
                    encoding="utf-8",
                )

                output_path = root / "trace.json"
                generator = StubTraceGenerator(default_prompt_path=str(prompt_path), api_provider="openai")
                generator.generate_trace(str(recording_path), str(shots_dir), str(output_path))

                trace = json.loads(output_path.read_text(encoding="utf-8"))

                self.assertEqual(
                    {"type": "click", "prompt": "点击继续按钮"},
                    trace["trajectory"][0]["caption"]["operation"],
                )
        finally:
            if previous_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = previous_key

    def test_sanitize_operation_preserves_double_click(self):
        previous_key = os.environ.get("OPENAI_API_KEY")
        os.environ["OPENAI_API_KEY"] = "test-key"
        try:
            with tempfile.TemporaryDirectory() as tmp:
                prompt_path = Path(tmp) / "default_prompt.json"
                prompt_path.write_text(json.dumps({"Base Prompt": ""}), encoding="utf-8")
                generator = StubTraceGenerator(
                    default_prompt_path=str(prompt_path),
                    api_provider="openai",
                )

                self.assertEqual(
                    {
                        "type": "doubleClick",
                        "prompt": "双击 report.xlsx 文件行",
                    },
                    generator._sanitize_operation(
                        {
                            "type": "DoubleClick",
                            "prompt": " 双击 report.xlsx 文件行 ",
                        }
                    ),
                )
        finally:
            if previous_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = previous_key

    def test_ldoubleclick_retries_when_model_degrades_it_to_click(self):
        previous_key = os.environ.get("OPENAI_API_KEY")
        os.environ["OPENAI_API_KEY"] = "test-key"
        try:
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                prompt_path = root / "default_prompt.json"
                prompt_path.write_text(
                    json.dumps({"Base Prompt": "只输出 JSON。"}, ensure_ascii=False),
                    encoding="utf-8",
                )
                shots_dir = root / "screenshots"
                shots_dir.mkdir()
                (shots_dir / "step.jpg").write_bytes(b"fake-jpeg")
                recording_path = root / "recording.json"
                recording_path.write_text(
                    json.dumps(
                        [
                            {
                                "timestamp": 1.0,
                                "action": "LDoubleClick at",
                                "current_software": "Explorer",
                                "screenshot": "step.jpg",
                            }
                        ]
                    ),
                    encoding="utf-8",
                )
                output_path = root / "trace.json"
                generator = DoubleClickRetryTraceGenerator(
                    default_prompt_path=str(prompt_path),
                    api_provider="openai",
                )

                generator.generate_trace(
                    str(recording_path),
                    str(shots_dir),
                    str(output_path),
                )

                trace = json.loads(output_path.read_text(encoding="utf-8"))
                self.assertEqual(2, generator.calls)
                self.assertEqual(
                    {
                        "type": "doubleClick",
                        "prompt": "双击文件列表中的 report.xlsx 文件行以打开文件",
                    },
                    trace["trajectory"][0]["caption"]["operation"],
                )
        finally:
            if previous_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = previous_key

    def test_generate_trace_retries_when_operation_is_unknown(self):
        previous_key = os.environ.get("OPENAI_API_KEY")
        os.environ["OPENAI_API_KEY"] = "test-key"
        try:
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                prompt_path = root / "default_prompt.json"
                prompt_path.write_text(json.dumps({"Base Prompt": "只输出 JSON。"}, ensure_ascii=False), encoding="utf-8")

                shots_dir = root / "screenshots"
                shots_dir.mkdir()
                (shots_dir / "step.jpg").write_bytes(b"fake-jpeg")

                recording_path = root / "recording.json"
                recording_path.write_text(
                    json.dumps(
                        [
                            {
                                "timestamp": 1.0,
                                "action": "LClick at",
                                "current_software": "Chrome",
                                "screenshot": "step.jpg",
                            }
                        ],
                        ensure_ascii=False,
                    ),
                    encoding="utf-8",
                )

                output_path = root / "trace.json"
                generator = RetryTraceGenerator(default_prompt_path=str(prompt_path), api_provider="openai")
                generator.generate_trace(str(recording_path), str(shots_dir), str(output_path))

                trace = json.loads(output_path.read_text(encoding="utf-8"))

                self.assertEqual(2, generator.calls)
                self.assertEqual(
                    {"type": "click", "prompt": "点击 Los Angeles 目的地建议项"},
                    trace["trajectory"][0]["caption"]["operation"],
                )
        finally:
            if previous_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = previous_key

    def test_generate_trace_fails_when_retry_still_has_no_executable_operation(self):
        previous_key = os.environ.get("OPENAI_API_KEY")
        os.environ["OPENAI_API_KEY"] = "test-key"
        try:
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                prompt_path = root / "default_prompt.json"
                prompt_path.write_text(json.dumps({"Base Prompt": "只输出 JSON。"}), encoding="utf-8")
                shots_dir = root / "screenshots"
                shots_dir.mkdir()
                (shots_dir / "step.jpg").write_bytes(b"fake-jpeg")
                recording_path = root / "recording.json"
                recording_path.write_text(
                    json.dumps(
                        [{"timestamp": 1.0, "action": "LClick at", "screenshot": "step.jpg"}]
                    ),
                    encoding="utf-8",
                )
                output_path = root / "trace.json"
                generator = InvalidTraceGenerator(default_prompt_path=str(prompt_path), api_provider="openai")

                with self.assertRaisesRegex(RuntimeError, "trace step 1.*纠错重试"):
                    generator.generate_trace(str(recording_path), str(shots_dir), str(output_path))

                self.assertEqual(2, generator.calls)
                self.assertFalse(output_path.exists())
        finally:
            if previous_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = previous_key

    def test_generate_trace_fails_instead_of_skipping_step_without_screenshot(self):
        previous_key = os.environ.get("OPENAI_API_KEY")
        os.environ["OPENAI_API_KEY"] = "test-key"
        try:
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                prompt_path = root / "default_prompt.json"
                prompt_path.write_text(json.dumps({"Base Prompt": "只输出 JSON。"}), encoding="utf-8")
                shots_dir = root / "screenshots"
                shots_dir.mkdir()
                recording_path = root / "recording.json"
                recording_path.write_text(
                    json.dumps([{"timestamp": 1.0, "action": "LClick at"}]),
                    encoding="utf-8",
                )
                output_path = root / "trace.json"
                generator = StubTraceGenerator(default_prompt_path=str(prompt_path), api_provider="openai")

                with self.assertRaisesRegex(RuntimeError, "录制动作缺少截图"):
                    generator.generate_trace(str(recording_path), str(shots_dir), str(output_path))

                self.assertFalse(output_path.exists())
        finally:
            if previous_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = previous_key


class AiActTraceTest(unittest.TestCase):
    def setUp(self):
        self.generator = object.__new__(TraceGenerator)
        self.generator._load_default_prompt(None)
        self.generator._step_images = Mock(return_value=("crop", "full"))

    def test_scroll_and_drag_require_ai_act(self):
        base_prompt = self.generator.default_prompt["Base Prompt"]
        self.assertIn('• 滚动：{"type":"aiAct"', base_prompt)
        self.assertIn('• 拖拽：{"type":"aiAct"', base_prompt)
        for action in ("ScrollDown at", "ScrollUp at", "DragStart at"):
            self.assertEqual(self.generator._recorded_operation_type(action), "aiAct")
            self.assertIn("要求 Operation.type 为 aiAct", self.generator._operation_error(
                {"type": "wait", "condition": "滚动完成"}, "aiAct"))
        self.assertIsNone(self.generator._operation_error(
            {"type": "aiAct", "prompt": "在文件列表中向下滚动"}, "aiAct"))
        self.assertIn("prompt", self.generator._operation_error({"type": "aiAct"}, "aiAct"))

    def test_drag_path_is_in_prompt_and_incomplete_drag_is_rejected(self):
        drag = {"timestamp": 1.0, "action": "DragStart at", "current_software": "Editor",
                "path": [{"x": 10, "y": 20}, {"x": 80, "y": 20}]}
        prompt = self.generator._prompt(drag, "移动矩形", 1, [])
        self.assertIn("Recorded drag path", prompt)
        self.assertIn('"x": 80', prompt)
        self.assertIn("Operation.type 必须是 aiAct", prompt)
        self.generator._request_caption = Mock(return_value={
            "action": "拖动矩形", "operation": {"type": "aiAct", "prompt": "按住矩形拖到右侧并释放"}})
        caption = self.generator._trace_step(drag, drag, "shots", "移动矩形", [], 1, 1.0, "DragStart at")
        self.assertEqual(caption["operation"]["type"], "aiAct")
        with self.assertRaisesRegex(RuntimeError, "缺少完整拖拽路径"):
            self.generator._trace_step({**drag, "path": [drag["path"][0]]}, drag,
                                       "shots", "移动矩形", [], 1, 1.0, "DragStart at")

    def test_scroll_model_wait_response_retries_as_ai_act(self):
        scroll = {"timestamp": 1.0, "action": "ScrollDown at", "scroll_count": 8}
        self.generator._request_caption = Mock(side_effect=[
            {"action": "向下滚动", "operation": {"type": "wait", "condition": "滚动完成"}},
            {"action": "向下滚动", "operation": {"type": "aiAct", "prompt": "在网元列表区域向下滚动"}},
        ])
        caption = self.generator._trace_step(scroll, scroll, "shots", "查找网元", [], 1, 1.0, "ScrollDown at")
        self.assertEqual(caption["operation"]["type"], "aiAct")
        self.assertEqual(self.generator._request_caption.call_count, 2)


if __name__ == "__main__":
    unittest.main()
