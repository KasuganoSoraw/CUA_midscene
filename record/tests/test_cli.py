import io
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

from cua_record.cli import main
from cua_record.resources import default_prompt_path


class RecordCliTest(unittest.TestCase):
    def test_doctor_validates_packaged_prompt(self):
        stdout = io.StringIO()

        with redirect_stdout(stdout):
            result = main(["doctor"])

        self.assertEqual(0, result)
        self.assertTrue(default_prompt_path().is_file())
        self.assertIn("cua_record ready", stdout.getvalue())

    def test_process_uses_pipeline(self):
        with patch("cua_record.cli.run_pipeline") as run_pipeline:
            result = main(["process", "C:/recording-demo"])

        self.assertEqual(0, result)
        run_pipeline.assert_called_once_with("C:/recording-demo")
