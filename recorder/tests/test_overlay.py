from __future__ import annotations

import unittest

from cua_recorder.hooks import RawInputEvent
from cua_recorder.overlay import MouseGestureExclusion, ToolbarState


def mouse(kind: str, x: int, y: int, button: str | None = None) -> RawInputEvent:
    return RawInputEvent(kind=kind, time_ns=1, x=x, y=y, button=button)


class ToolbarStateTest(unittest.TestCase):
    def test_commands_require_actual_phase_and_prevent_duplicate_clicks(self) -> None:
        state = ToolbarState()
        self.assertIsNone(state.request("start"))
        state.update("armed")
        self.assertEqual("toggle", state.request("start"))
        self.assertEqual("starting", state.snapshot().phase)
        self.assertIsNone(state.request("start"))
        self.assertIsNone(state.request("stop"))
        state.update("recording", 1)
        self.assertEqual("stop", state.request("stop"))
        self.assertEqual("stopping", state.snapshot().phase)
        self.assertIsNone(state.request("stop"))
        self.assertIsNone(state.request("cancel"))

    def test_elapsed_uses_video_clock_and_freezes_during_save(self) -> None:
        now = [61_500_000_000]
        state = ToolbarState(lambda: now[0])
        self.assertEqual("00:00", state.snapshot().elapsed)
        state.update("recording", 1_000_000_000)
        self.assertEqual("01:00", state.snapshot().elapsed)
        state.request("stop")
        now[0] += 20_000_000_000
        state.update("stopping", 1_000_000_000)
        self.assertEqual("01:00", state.snapshot().elapsed)

    def test_cancel_armed_session_does_not_start_recording(self) -> None:
        state = ToolbarState()
        state.update("armed")
        self.assertEqual("stop", state.request("cancel"))
        self.assertIsNone(state.request("cancel"))

    def test_discard_recording_freezes_elapsed_and_prevents_duplicate_commands(self) -> None:
        now = [61_500_000_000]
        state = ToolbarState(lambda: now[0])
        state.update("recording", 1_000_000_000)
        self.assertEqual("abort", state.request("cancel"))
        self.assertEqual("stopping", state.snapshot().phase)
        self.assertIsNone(state.request("cancel"))
        self.assertIsNone(state.request("stop"))
        now[0] += 20_000_000_000
        state.update("cancelled")
        self.assertEqual("01:00", state.snapshot().elapsed)


class MouseGestureExclusionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.filter = MouseGestureExclusion(lambda x, y: 10 <= x < 100 and 10 <= y < 50)

    def test_toolbar_click_and_drag_outside_are_excluded_as_complete_gesture(
        self,
    ) -> None:
        for event in [
            mouse("mouse_down", 20, 20, "left"),
            mouse("mouse_move", 200, 200),
            mouse("mouse_up", 200, 200, "left"),
        ]:
            self.assertTrue(self.filter.excludes(event))
        self.assertFalse(self.filter.excludes(mouse("mouse_down", 200, 200, "left")))
        self.assertFalse(self.filter.excludes(mouse("mouse_up", 200, 200, "left")))

    def test_business_drag_over_toolbar_preserves_matching_release(self) -> None:
        for event in [
            mouse("mouse_down", 200, 200, "left"),
            mouse("mouse_move", 20, 20),
            mouse("mouse_up", 20, 20, "left"),
        ]:
            self.assertFalse(self.filter.excludes(event))

    def test_hover_and_wheel_over_toolbar_are_not_recorded(self) -> None:
        self.assertTrue(self.filter.excludes(mouse("mouse_move", 20, 20)))
        self.assertTrue(self.filter.excludes(mouse("mouse_wheel", 20, 20)))
        self.assertFalse(self.filter.excludes(mouse("mouse_move", 200, 200)))
        self.assertFalse(
            self.filter.excludes(RawInputEvent(kind="key_down", time_ns=1, vk_code=65))
        )

    def test_multiple_buttons_do_not_end_exclusion_early(self) -> None:
        for event in [
            mouse("mouse_down", 20, 20, "left"),
            mouse("mouse_down", 200, 200, "right"),
            mouse("mouse_up", 200, 200, "left"),
            mouse("mouse_move", 200, 200),
            mouse("mouse_up", 200, 200, "right"),
        ]:
            self.assertTrue(self.filter.excludes(event))
        self.assertFalse(self.filter.excludes(mouse("mouse_move", 200, 200)))


if __name__ == "__main__":
    unittest.main()
