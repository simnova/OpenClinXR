"""Pure DSP/accounting controls only. These do not negotiate or send media."""
import math
import random
import unittest
from fractions import Fraction
from health import DecodedHealth

CONFIG = {"bins": {"maximumRowsPerDecodedDirection": 512}}


def process(h, values, rate, channels=1, pts=0):
    h.process(len(values), channels, rate, pts, Fraction(1, rate), lambda i, c: values[i] if c == 0 else 0,
              "s16", "mono" if channels == 1 else "stereo", False)


def accepts(row, hz):
    tone = row["tone"]
    mean = tone["sumSquares"] / tone["N"]
    expected, other = tone[f"power{hz}"], tone[f"power{1100 - hz}"]
    return mean > 0 and expected > 0 and expected >= .5 * mean and expected >= 4 * other


class HealthTests(unittest.TestCase):
    def test_full_rate_recurrence_matches_independent_direct_oracle(self):
        for rate in (44100, 48000):
            for hz in (400, 700):
                for phase in (.137, 1.73):
                    n = rate // 2 + 37
                    values = [.02 * math.sin(2 * math.pi * hz * i / rate + phase) for i in range(n)]
                    h = DecodedHealth("source", "clock", CONFIG)
                    process(h, values, rate)
                    row = h.finish()["bins"][0]
                    tone = row["tone"]
                    for probe in (400, 700):
                        real = sum(x * math.cos(2 * math.pi * probe * i / rate) for i, x in enumerate(values))
                        imag = -sum(x * math.sin(2 * math.pi * probe * i / rate) for i, x in enumerate(values))
                        self.assertAlmostEqual(tone[f"real{probe}"], real, delta=1e-7)
                        self.assertAlmostEqual(tone[f"imag{probe}"], imag, delta=1e-7)
                    self.assertTrue(accepts(row, hz))
                    self.assertFalse(accepts(row, 1100 - hz))
                    self.assertEqual(row["tone"]["N"], n)

    def test_wrong_silence_noise_and_relay_are_rejected(self):
        rng = random.Random(1537)
        for values in ([0.] * 24000, [rng.uniform(-.02, .02) for _ in range(24000)],
                       [.02 * math.sin(2 * math.pi * 400 * i / 48000) for i in range(24000)]):
            h = DecodedHealth("source", "clock", CONFIG)
            process(h, values, 48000)
            self.assertFalse(accepts(h.finish()["bins"][0], 700))

    def test_channels_do_not_double_duration_or_selected_tone(self):
        h = DecodedHealth("source", "clock", CONFIG)
        process(h, [.02] * 960, 48000, channels=2, pts=317)
        record = h.finish()
        self.assertEqual(record["total"]["frames"], 960)
        self.assertEqual(record["total"]["channelSamples"], 1920)
        self.assertEqual(record["bins"][0]["tone"]["N"], 960)
        self.assertIsNotNone(record["firstNonzeroAtLocalMs"])
        self.assertEqual(record["origin"]["tag"]["value"], 317)
        self.assertEqual(record["final"]["tag"]["value"], 1277)

    def test_phase_latches_preserve_first_bin_and_all_partial_tails(self):
        h = DecodedHealth("source", "clock", CONFIG)
        process(h, [.01] * 960, 48000)
        ready = h.latch("r", "ready")
        process(h, [.01] * 960, 48000, pts=960)
        start = h.latch("s", "start")
        process(h, [.01] * 960, 48000, pts=1920)
        end = h.latch("e", "end")
        record = h.finish()
        self.assertEqual([row["phase"] for row in record["bins"]], ["setup", "setup", "qualified"])
        self.assertEqual([row["sequence"] for row in record["bins"]], [0, 1, 2])
        self.assertEqual(end["position"]["processedFrames"] - start["position"]["processedFrames"], 960)
        self.assertEqual(ready["position"]["processedFrames"], 960)
        self.assertEqual(sum(row["frames"] for row in record["bins"]), 2880)

    def test_clock_nonfinite_clip_and_format_changes_are_retained(self):
        h = DecodedHealth("source", "clock", CONFIG)
        process(h, [.01] * 128, 48000)
        process(h, [float("nan"), .99] + [.01] * 126, 48000, pts=256)
        process(h, [.01] * 128, 44100, channels=2, pts=384)
        total = h.finish()["total"]
        self.assertEqual(total["missingFrames"], 128 + int((Fraction(384, 44100) - Fraction(384, 48000)) * 44100))
        self.assertEqual(total["frameDiscontinuities"], 2)
        self.assertEqual(total["nonfiniteSamples"], 1)
        self.assertEqual(total["clippedSamples"], 1)
        self.assertEqual(total["sampleRateChanges"], 1)
        self.assertEqual(total["channelChanges"], 1)

    def test_bin_cap_fails_without_silent_drop_or_reset(self):
        h = DecodedHealth("source", "clock", {"bins": {"maximumRowsPerDecodedDirection": 1}})
        process(h, [.01] * 128, 48000)
        h.latch("r", "ready")
        process(h, [.01] * 128, 48000, pts=128)
        with self.assertRaisesRegex(ValueError, "cap"):
            h.finish()
        self.assertEqual(len(h.record["bins"]), 1)
        self.assertEqual(h.record["overflow"], 1)


if __name__ == "__main__":
    unittest.main()
