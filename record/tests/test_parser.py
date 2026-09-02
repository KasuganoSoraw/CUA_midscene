import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from cua_record.pipeline import run_pipeline


class ParserPipelineTest(unittest.TestCase):
    def run_pipeline_fixture(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp) / "recording-demo"
            inputs = project / "inputs"
            inputs.mkdir(parents=True)
            (inputs / "recording.txt").write_text("CONFIG\n", encoding="utf-8")
            screenshots = project / "screenshots"
            screenshots.mkdir()

            with (
                patch("cua_record.pipeline.LogProcessor") as log_processor,
                patch("cua_record.pipeline.VideoScreenshotExtractor") as screenshot_extractor,
                patch("cua_record.pipeline.TraceGenerator") as trace_generator,
            ):
                log_processor.return_value.process_log_file.side_effect = (
                    lambda _source, output, **_kwargs: Path(output).write_text("[]", encoding="utf-8")
                )

                def prepare_screenshots(_project):
                    (project / "recording-demo_processed_log_sc.json").write_text("[]", encoding="utf-8")
                    return [], screenshots, {}

                screenshot_extractor.return_value.process_project.side_effect = prepare_screenshots
                trace_generator.return_value.generate_trace.side_effect = (
                    lambda **kwargs: Path(kwargs["output_trace_path"]).write_text(
                        '{"trajectory": []}',
                        encoding="utf-8",
                    )
                )

                result = run_pipeline(str(project))

                call = trace_generator.return_value.generate_trace.call_args
                return result.name, call.kwargs["overall_task"]

    def test_trace_generation_keeps_empty_overall_task(self):
        trace_name, overall_task = self.run_pipeline_fixture()
        self.assertEqual(trace_name, "recording-demo_trace.json")
        self.assertEqual(overall_task, "")


if __name__ == "__main__":
    unittest.main()
