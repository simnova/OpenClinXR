"""Bounded scalar health; transient PCM is read in place and never retained."""
import math
import time
from fractions import Fraction
from memory import json_size

HEALTH_KEYS = ("frames", "channelSamples", "finiteSamples", "nonfiniteSamples", "nonzeroSamples", "sumSquares", "clippedSamples", "missingFrames", "frameDiscontinuities", "sampleRateChanges", "channelChanges")
PHASE = {"ready": "setup", "warmup": "warmup", "start": "qualified", "end": "ended"}


def empty_health():
    return dict.fromkeys(HEALTH_KEYS, 0) | {"channels": 0, "peak": 0.0}


def tag(kind, value, base):
    return {"kind": kind, "value": float(value), "timeBaseNumerator": base.numerator, "timeBaseDenominator": base.denominator}


class DecodedHealth:
    def __init__(self, source_id, clock_id, config, kind="decoded-pts", budget=None):
        self.config, self.phase, self.current, self.kind = config, "setup", None, kind
        self.budget, self.current_key, self.archived_bytes = budget, None, 0
        self.expected_time, self.last_position = None, None
        self.record = {"id": "server-uplink-decoded", "sourceId": source_id, "clockId": clock_id, "sampleRate": None, "channels": None,
                       "initialQuantum": None, "targetBinFrames": None, "origin": None, "final": None, "total": empty_health(), "bins": [],
                       "processorErrors": 0, "rejected": 0, "overflow": 0, "firstDecodedAtLocalMs": None, "firstNonzeroAtLocalMs": None,
                       "format": None, "rtp": {"packets": None, "bytes": None, "packetsLost": None, "jitterSeconds": None, "concealedSamples": None}}

    def position(self):
        return None if self.last_position is None else dict(self.last_position)

    def _open(self, rate, channels, quantum, clock_tag):
        n = self.record["total"]["frames"]
        if self.budget is not None:
            self.current_key = self.budget.reserve(object(), "current-bin", 2048)
        self.current = empty_health() | {"channels": channels, "sequence": len(self.record["bins"]), "phase": self.phase,
            "frameStart": n, "frameEnd": n, "sampleRate": rate, "quantumFirst": quantum, "quantumLast": quantum,
            "quantumMin": quantum, "quantumMax": quantum, "tagStart": clock_tag, "tagEndExclusive": clock_tag, "partialReason": None,
            "tone": {"analysisChannel": 0, "N": 0, "sumSquares": 0.0, "real400": 0.0, "imag400": 0.0, "real700": 0.0, "imag700": 0.0, "power400": 0.0, "power700": 0.0}}
        self.osc = {hz: [1.0, 0.0, math.cos(2 * math.pi * hz / rate), math.sin(2 * math.pi * hz / rate)] for hz in (400, 700)}

    def flush(self, reason):
        if not self.current or not self.current["frames"]:
            self.current = None
            if self.current_key is not None:
                self.budget.release(self.current_key)
                self.current_key = None
            return
        row = self.current
        row["partialReason"] = reason
        tone, n = row["tone"], row["tone"]["N"]
        for hz in (400, 700):
            tone[f"power{hz}"] = 2 * (tone[f"real{hz}"] ** 2 + tone[f"imag{hz}"] ** 2) / (n * n)
        if len(self.record["bins"]) >= self.config["bins"]["maximumRowsPerDecodedDirection"]:
            self.record["overflow"] += 1
            raise ValueError("health bin cap")
        size = json_size(row)
        if size > 2048:
            self.record["overflow"] += 1
            raise ValueError("fixed scalar row representation exceeds reserved2048B")
        if self.current_key is not None:
            self.budget.resize(self.current_key, size, "scalar-history", retained=True)
        self.record["bins"].append(row)
        self.archived_bytes += size
        self.current_key = None
        self.current = None

    def latch(self, marker_id, command):
        if command not in PHASE or self.last_position is None:
            raise ValueError("actual processed position required")
        self.flush("phase-boundary")
        self.phase = PHASE[command]
        return {"markerId": marker_id, "command": command, "phase": self.phase, "position": self.position()}

    def process(self, frames, channels, rate, pts, base, sample, format_name, layout, planar):
        """sample(frame, channel) reads normalized PCM from the current callback only."""
        if not isinstance(frames, int) or frames < 1 or not isinstance(channels, int) or channels < 1 or not rate or pts is None or base is None:
            self.record["rejected"] += 1
            raise ValueError("actual frames/rate/channels/PTS required")
        base, receipt_ms = Fraction(base), time.monotonic() * 1000
        pts_step = Fraction(1, rate) / base
        if self.record["sampleRate"] is None:
            target = math.ceil(rate * .5 / frames) * frames
            if target / rate > 1:
                raise ValueError("unsupported quantum")
            self.record.update(sampleRate=rate, channels=channels, initialQuantum=frames, targetBinFrames=target,
                format={"name": format_name, "layout": layout, "planar": planar, "projection": "channel-0", "allChannelsChecked": True})
            self.record["origin"] = {"processedFrames": 0, "sampleRate": rate, "channels": channels, "tag": tag(self.kind, pts, base), "atSourceMonotonicMs": receipt_ms}
            self.record["firstDecodedAtLocalMs"] = receipt_ms
        start_time = Fraction(pts) * base
        bad_clock = self.expected_time is not None and start_time != self.expected_time
        rate_change, channel_change = rate != self.record["sampleRate"], channels != self.record["channels"]
        missing = 0 if self.expected_time is None else max(0, int((start_time - self.expected_time) * rate))
        for i in range(frames):
            if self.current is None:
                self._open(rate, channels, frames, tag(self.kind, pts + i * pts_step, base))
            row, total = self.current, self.record["total"]
            if i == 0:
                for target in (row, total):
                    target["frameDiscontinuities"] += int(bad_clock)
                    target["missingFrames"] += missing
                    target["sampleRateChanges"] += int(rate_change)
                    target["channelChanges"] += int(channel_change)
            total["channels"] = self.record["channels"]
            for target in (row, total):
                target["frames"] += 1
                target["channelSamples"] += channels
            for channel in range(channels):
                value = sample(i, channel)
                finite = math.isfinite(value)
                for target in (row, total):
                    target["finiteSamples"] += int(finite)
                    target["nonfiniteSamples"] += int(not finite)
                    if finite:
                        target["nonzeroSamples"] += int(value != 0)
                        target["sumSquares"] += value * value
                        target["peak"] = max(target["peak"], abs(value))
                        target["clippedSamples"] += int(abs(value) >= .98)
                if channel == 0:
                    x, tone = value if finite else 0.0, row["tone"]
                    tone["N"] += 1
                    tone["sumSquares"] += x * x
                    for hz in (400, 700):
                        c, s, cw, sw = self.osc[hz]
                        tone[f"real{hz}"] += x * c
                        tone[f"imag{hz}"] -= x * s
                        self.osc[hz][0], self.osc[hz][1] = c * cw - s * sw, s * cw + c * sw
            row["frameEnd"] = total["frames"]
            row["quantumLast"] = frames
            row["quantumMin"], row["quantumMax"] = min(row["quantumMin"], frames), max(row["quantumMax"], frames)
            if i == frames - 1 or row["frames"] == self.record["targetBinFrames"]:
                row["tagEndExclusive"] = tag(self.kind, pts + (i + 1) * pts_step, base)
            if row["frames"] == self.record["targetBinFrames"]:
                self.flush(None)
        total = self.record["total"]
        self.last_position = {"processedFrames": total["frames"], "sampleRate": rate, "channels": channels,
            "tag": tag(self.kind, pts + frames * pts_step, base), "atSourceMonotonicMs": receipt_ms}
        if total["nonzeroSamples"] and self.record["firstNonzeroAtLocalMs"] is None:
            self.record["firstNonzeroAtLocalMs"] = receipt_ms
        self.expected_time = start_time + Fraction(frames, rate)
        self.record["final"] = self.position()

    def finish(self):
        self.flush("final-tail")
        self.record["final"] = self.position()
        return self.record
