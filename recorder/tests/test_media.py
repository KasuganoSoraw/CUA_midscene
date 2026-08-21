from __future__ import annotations

import unittest
from fractions import Fraction

import av
from av.video.frame import PictureType

from cua_recorder.media import (
    H264_MF_BIT_RATE,
    H264_MF_GOP_SECONDS,
    MediaCapabilities,
    desktop_encoder_options,
    prepare_video_frame,
    require_recording_capabilities,
)
from cua_recorder.protocol import RecorderError


class MediaCapabilitiesTest(unittest.TestCase):
    def test_desktop_encoder_targets_aloha_sized_vbr(self) -> None:
        self.assertEqual({
            "rate_control": "u_vbr",
            "quality": "80",
            "scenario": "archive",
        }, desktop_encoder_options())
        self.assertEqual(5_000_000, H264_MF_BIT_RATE)
        self.assertEqual(6, H264_MF_GOP_SECONDS)

    def test_capture_frame_does_not_force_every_encoded_frame_to_be_keyframe(self) -> None:
        frame = av.VideoFrame(16, 16, "rgb24")
        frame.pict_type = PictureType.I
        prepared = prepare_video_frame(
            frame,
            width=16,
            height=16,
            frame_index=7,
            time_base=Fraction(1, 30),
        )

        self.assertEqual(PictureType.NONE, prepared.pict_type)
        self.assertEqual(7, prepared.pts)
        self.assertEqual(Fraction(1, 30), prepared.time_base)

    def test_ready_requires_capture_encoder_and_muxer(self) -> None:
        capabilities = MediaCapabilities(
            pyav_version="test",
            library_versions={"libavcodec": (1, 2, 3)},
            has_gdigrab=True,
            has_h264_mf=False,
            has_mp4=True,
        )
        with self.assertRaisesRegex(RecorderError, "h264_mf"):
            require_recording_capabilities(capabilities)

    def test_complete_capabilities_are_ready(self) -> None:
        capabilities = MediaCapabilities("test", {}, True, True, True)
        require_recording_capabilities(capabilities)
        self.assertTrue(capabilities.ready)


if __name__ == "__main__":
    unittest.main()
