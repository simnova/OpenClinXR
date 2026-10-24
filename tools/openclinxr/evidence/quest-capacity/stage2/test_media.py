"""In-memory PyAV/source unit controls; no peer, socket, browser or RTP is created."""
import array
import unittest
from fractions import Fraction
from types import SimpleNamespace
from av import AudioFrame
from aiortc.mediastreams import MediaStreamError
from health import DecodedHealth
from peer_media import ReturnTrack, inspect_frame

CONFIG = {"bins": {"maximumRowsPerDecodedDirection": 512}}


def frame(planar=False):
    result = AudioFrame(format="s16p" if planar else "s16", layout="stereo", samples=128)
    if planar:
        result.planes[0].update(array.array("h", [3277] * 128).tobytes())
        result.planes[1].update(array.array("h", [0] * 128).tobytes())
    else:
        result.planes[0].update(array.array("h", [value for _ in range(128) for value in (3277, 0)]).tobytes())
    result.pts, result.sample_rate, result.time_base = 37, 48000, Fraction(1, 48000)
    return result


class MediaTests(unittest.IsolatedAsyncioTestCase):
    def test_packed_and_planar_channel_reader_checks_every_original_channel(self):
        for planar in (False, True):
            h = DecodedHealth("source", "clock", CONFIG)
            inspect_frame(h, frame(planar))
            r = h.finish()
            self.assertEqual(r["total"]["channelSamples"], 256)
            self.assertEqual(r["total"]["nonzeroSamples"], 128)
            self.assertEqual(r["bins"][0]["tone"]["N"], 128)
            self.assertEqual(r["origin"]["tag"]["value"], 37)
            self.assertEqual(r["final"]["tag"]["value"], 165)
            self.assertEqual(r["format"]["planar"], planar)

    async def test_unbound_source_is_not_allowed_to_generate(self):
        track = ReturnTrack("source", "clock", CONFIG)
        try:
            with self.assertRaises(MediaStreamError):
                await track.recv()
            self.assertEqual(track.unbound, 1)
            self.assertIsNone(track.source()["origin"])
        finally:
            track.stop()

    async def test_generator_unit_callback_has_actual_pts_and_no_retained_pcm(self):
        track = ReturnTrack("source", "clock", CONFIG)
        track.bind(SimpleNamespace(track=track))  # Test stub only, never a negotiated sender receipt.
        try:
            first, second = await track.recv(), await track.recv()
            self.assertEqual((first.pts, second.pts, first.samples), (0, 960, 960))
            self.assertEqual(track.source()["final"]["processedFrames"], 1920)
            self.assertEqual(track.source()["final"]["tag"]["value"], 1920)
            self.assertEqual(track.source()["kind"], "server-independent-generator")
            self.assertGreater(track.source()["total"]["nonzeroSamples"], 0)
        finally:
            track.stop()
        self.assertEqual(track.pending_pcm_bytes, 0)
        self.assertTrue(track.source()["stopped"])

    def test_fault_relay_queue_is_one_frame_and_overflow_is_visible(self):
        track = ReturnTrack("relay", "clock", CONFIG, relay=True)
        try:
            track.offer_relay(frame())
            self.assertGreater(track.pending_pcm_bytes, 0)
            with self.assertRaisesRegex(ValueError, "overflow"):
                track.offer_relay(frame())
            self.assertEqual(track.errors, 1)
            self.assertEqual(track.source()["kind"], "relay")
        finally:
            track.stop()
        self.assertTrue(track.queue.empty())
        self.assertEqual(track.pending_pcm_bytes, 0)


if __name__ == "__main__":
    unittest.main()
