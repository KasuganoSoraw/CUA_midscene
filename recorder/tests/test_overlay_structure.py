from __future__ import annotations

import ast
import unittest
from collections.abc import Callable
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, call, patch

from cua_recorder import overlay_win32
from cua_recorder.models import DisplayInfo
from cua_recorder.protocol import RecorderError


def toolbar(command: Callable[[str], None] | None = None) -> overlay_win32.RecorderOverlay:
    return overlay_win32.RecorderOverlay(
        DisplayInfo("display-0", "DISPLAY0", 0, 0, 0, 1920, 1080, 1.0, True),
        command if command is not None else lambda _command: None,
    )


def drawing_api() -> SimpleNamespace:
    return SimpleNamespace(
        CreateCompatibleDC=Mock(return_value=10),
        CreateCompatibleBitmap=Mock(return_value=20),
        CreateSolidBrush=Mock(return_value=30),
        SelectObject=Mock(side_effect=[101, 102, 103, 1, 1, 1]),
        SetStretchBltMode=Mock(return_value=3),
        StretchBlt=Mock(),
        GetStockObject=Mock(return_value=8),
        Ellipse=Mock(),
        SetBrushOrgEx=Mock(),
        DeleteObject=Mock(),
        DeleteDC=Mock(),
    )


class OverlayStructureTest(unittest.TestCase):
    def test_every_overlay_function_has_at_most_fifty_lines(self) -> None:
        source = Path(overlay_win32.__file__).read_text(encoding="utf-8")
        for node in ast.walk(ast.parse(source)):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                with self.subTest(function=node.name):
                    self.assertLessEqual(node.end_lineno - node.lineno + 1, 50)

    def test_circle_copy_and_composition_failures_release_selected_objects(
        self,
    ) -> None:
        for results in ([False], [True, False]):
            with self.subTest(results=results):
                overlay = toolbar()
                gdi = drawing_api()
                overlay._gdi = gdi
                gdi.StretchBlt.side_effect = results
                with self.assertRaises(RecorderError):
                    overlay._circle(1, 0, (18, 20, 26, 28))
                self.assertEqual([call(30), call(20)], gdi.DeleteObject.call_args_list)
                gdi.DeleteDC.assert_called_once_with(10)
                self.assertEqual(call(10, 101), gdi.SelectObject.call_args_list[-1])
                if len(results) == 2:
                    self.assertEqual(
                        call(1, 3), gdi.SetStretchBltMode.call_args_list[-1]
                    )
                    self.assertEqual(
                        call(1, 0, 0, None), gdi.SetBrushOrgEx.call_args_list[-1]
                    )

    def test_circle_allocation_failure_releases_available_resources(self) -> None:
        overlay = toolbar()
        gdi = drawing_api()
        overlay._gdi = gdi
        gdi.CreateCompatibleBitmap.return_value = 0
        with self.assertRaisesRegex(RecorderError, "绘制缓冲区"):
            overlay._circle(1, 0, (18, 20, 26, 28))
        gdi.DeleteObject.assert_called_once_with(30)
        gdi.DeleteDC.assert_called_once_with(10)
        gdi.SelectObject.assert_not_called()

    def test_startup_failure_releases_window_font_class_and_callback(self) -> None:
        commands: list[str] = []
        overlay = toolbar(commands.append)
        user = SimpleNamespace(DestroyWindow=Mock(), UnregisterClassW=Mock())
        gdi = SimpleNamespace(DeleteObject=Mock())
        overlay._procedure = object()
        overlay._register_window_class = Mock(return_value=99)

        def create_window(*_args: object) -> None:
            overlay._hwnd, overlay._font = 11, 22

        overlay._create_window = create_window
        overlay._show_window = Mock(side_effect=RecorderError("窗口显示失败"))
        overlay._message_loop = Mock()
        with patch.object(
            overlay_win32.ctypes,
            "WinDLL",
            create=True,
            side_effect=[user, gdi, object()],
        ):
            with patch.object(overlay_win32, "_configure_api"):
                overlay._run()
        self.assertEqual(["overlay-error"], commands)
        self.assertIsInstance(overlay._error, RecorderError)
        user.DestroyWindow.assert_called_once_with(11)
        gdi.DeleteObject.assert_called_once_with(22)
        self.assertEqual(99, user.UnregisterClassW.call_args.args[1])
        self.assertIsNone(overlay._procedure)
        self.assertTrue(overlay._ready.is_set())
        overlay._message_loop.assert_not_called()


if __name__ == "__main__":
    unittest.main()
