"""Actual PyAV decode reader and sender-driven independent tone; no PCM export."""
import array
import asyncio
import math
import time
from fractions import Fraction

from aiortc import MediaStreamTrack
from aiortc.mediastreams import MediaStreamError
from av import AudioFrame
from health import DecodedHealth


def frame_reader(frame):
    name, planar = frame.format.name, frame.format.is_planar
    root = name[:-1] if planar else name
    formats = {"s16": ("h", 32768.0, 0), "s32": ("i", 2147483648.0, 0), "u8": ("B", 128.0, 128), "flt": ("f", 1.0, 0), "dbl": ("d", 1.0, 0)}
    if root not in formats:
        raise ValueError(f"unsupported observed PyAV format: {name}")
    code, divisor, offset = formats[root]
    views = [memoryview(plane).cast(code) for plane in frame.planes]
    channels = len(frame.layout.channels)
    if planar:
        return channels, lambda i, c: (views[c][i] - offset) / divisor
    return channels, lambda i, c: (views[0][i * channels + c] - offset) / divisor


def inspect_frame(health, frame):
    channels, sample = frame_reader(frame)
    health.process(frame.samples, channels, frame.sample_rate, frame.pts, frame.time_base,
                   sample, frame.format.name, frame.layout.name, frame.format.is_planar)


class ReturnTrack(MediaStreamTrack):
    kind = "audio"

    def __init__(self, source_id, clock_id, config, relay=False, budget=None):
        super().__init__()
        self.health = DecodedHealth(source_id, clock_id, config, "decoded-pts" if relay else "generated-pts", budget)
        self.relay, self.sender, self.calls, self.unbound, self.errors = relay, None, 0, 0, 0
        self.queue = asyncio.Queue(maxsize=1)
        self.slot_available = asyncio.Event()
        self.slot_available.set()
        self.pending_pcm_bytes = 0
        self.budget = budget
        self.started_at, self.pts, self.stopped_explicitly = None, 0, False

    def bind(self, sender):
        self.sender = sender

    async def wait_relay_slot(self):
        await self.slot_available.wait()
        if self.stopped_explicitly:
            raise MediaStreamError

    def offer_relay(self, frame, adopted_lease=None):
        if self.queue.full():
            self.errors += 1
            raise ValueError("relay single-frame queue overflow")
        size = sum(plane.buffer_size for plane in frame.planes)
        key = adopted_lease if adopted_lease is not None else None if self.budget is None else self.budget.reserve(object(), "relay-frame", size)
        self.pending_pcm_bytes = size
        self.queue.put_nowait((frame, key))
        self.slot_available.clear()

    async def recv(self):
        if self.readyState != "live":
            raise MediaStreamError
        if self.sender is None or self.sender.track is not self:
            self.unbound += 1
            raise MediaStreamError
        self.calls += 1
        lease = None
        try:
            if self.relay:
                frame, lease = await self.queue.get()
                self.pending_pcm_bytes = 0
                self.slot_available.set()
            else:
                rate, quantum = 48000, 960
                if self.started_at is None:
                    self.started_at = time.monotonic()
                await asyncio.sleep(max(0, self.started_at + self.pts / rate - time.monotonic()))
                lease = None if self.budget is None else self.budget.reserve(object(), "generated-pcm-working", quantum * 2 * 3)
                pcm = array.array("h", (round(32767 * .02 * min(1, (self.pts + i + 1) / (rate * .025)) * math.sin(2 * math.pi * 700 * (self.pts + i) / rate)) for i in range(quantum)))
                frame = AudioFrame(format="s16", layout="mono", samples=quantum)
                frame.planes[0].update(pcm.tobytes())
                frame.sample_rate, frame.pts, frame.time_base = rate, self.pts, Fraction(1, rate)
                self.pts += quantum
            inspect_frame(self.health, frame)
            return frame
        except asyncio.CancelledError:
            raise
        except Exception:
            self.errors += 1
            raise
        finally:
            if lease is not None:
                self.budget.release(lease)

    def source(self):
        record = self.health.record
        return {"id": record["sourceId"], "kind": "relay" if self.relay else "server-independent-generator", "trackId": self.id,
                "senderTrackId": None if self.sender is None or self.sender.track is None else self.sender.track.id,
                "senderDrivenCalls": self.calls, "unboundCalls": self.unbound, "clockId": record["clockId"],
                "initialQuantum": record["initialQuantum"], "targetBinFrames": record["targetBinFrames"], "bins": record["bins"],
                "origin": record["origin"], "final": record["final"], "total": record["total"],
                "generatorErrors": self.errors + record["processorErrors"], "stopped": self.stopped_explicitly}

    def stop(self):
        if not self.stopped_explicitly:
            self.stopped_explicitly = True
            super().stop()
            while not self.queue.empty():
                _, lease = self.queue.get_nowait()
                if lease is not None:
                    self.budget.release(lease)
            self.pending_pcm_bytes = 0
            self.slot_available.set()
            self.health.finish()


def absent_source(source_id):
    from health import empty_health
    return {"id": source_id, "kind": "absent", "trackId": None, "senderTrackId": None, "senderDrivenCalls": 0, "unboundCalls": 0,
            "clockId": None, "initialQuantum": None, "targetBinFrames": None, "bins": [], "origin": None, "final": None,
            "total": empty_health(), "generatorErrors": 0, "stopped": True}
