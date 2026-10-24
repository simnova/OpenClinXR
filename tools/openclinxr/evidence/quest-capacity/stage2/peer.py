"""One owned host peer. Final scalar histories survive closure; media does not."""
import asyncio
import time

from aiortc import RTCConfiguration, RTCPeerConnection, RTCRtpSender, RTCSessionDescription
from aiortc.mediastreams import MediaStreamError
from bindings import observe_bindings
from health import DecodedHealth
from peer_media import ReturnTrack, absent_source, inspect_frame


class Peer:
    def __init__(self, envelope, mode, config, clock_id, inventory, budget=None):
        self.envelope, self.mode, self.config, self.clock_id, self.inventory = envelope, mode, config, clock_id, inventory
        self.budget = budget
        self.allocated_at = time.monotonic() * 1000
        self.pc = RTCPeerConnection(RTCConfiguration(iceServers=[]))
        self.uplink = DecodedHealth(envelope["binding"]["uplinkSourceId"], clock_id, config, budget=budget)
        self.return_track, self.tasks, self.incoming, self.marks = None, set(), [], []
        self.closing_task, self.closed, self.reason, self.outcome = None, False, None, "preparing"
        self.mark_lock = asyncio.Lock()
        self.last_pair, self.last_ice, self.last_dtls = None, "new", "new"
        self.receiver_binding = {"sourceId": envelope["binding"]["uplinkSourceId"], "receiverTrackId": None, "receiverSdpTrackId": None, "mid": None, "ssrc": None, "codec": None, "bindingObserved": False}
        self.sender_binding = {"sourceId": envelope["binding"]["downlinkSourceId"], "kind": "absent", "sourceTrackId": None, "senderTrackId": None, "mid": None, "ssrc": None, "codec": None, "bindingObserved": False}
        self.lifetime = self.spawn(self.expire())
        self.pc.on("track", self.on_track)

    def spawn(self, coroutine):
        task = asyncio.create_task(coroutine)
        self.tasks.add(task)
        def completed(done):
            self.tasks.discard(done)
            if not done.cancelled() and done.exception() is not None:
                self.fail(f"owned media task: {done.exception()}")
        task.add_done_callback(completed)
        return task

    async def expire(self):
        await asyncio.sleep(self.config["timing"]["peerLifetimeMs"] / 1000)
        self.fail("peer lifetime exceeded")
        await self.close()

    def fail(self, reason):
        self.reason, self.outcome = self.reason or str(reason), "failed"

    def on_track(self, track):
        if track.kind != "audio" or self.incoming:
            self.fail("unexpected or duplicate incoming track")
            track.stop()
            return
        self.incoming.append(track)
        self.receiver_binding.update(receiverTrackId=track.id)
        self.spawn(self.consume(track))

    async def consume(self, track):
        try:
            while not self.closed:
                if self.return_track is not None and self.return_track.relay:
                    await self.return_track.wait_relay_slot()
                frame = await track.recv()
                lease = None if self.budget is None else self.budget.reserve(object(), "decoded-frame-working", sum(p.buffer_size for p in frame.planes))
                try:
                    inspect_frame(self.uplink, frame)
                    if any(self.uplink.record["total"][key] for key in ("nonfiniteSamples", "clippedSamples", "missingFrames", "frameDiscontinuities", "sampleRateChanges", "channelChanges")):
                        raise ValueError("decoded health hard failure retained from first process")
                    if self.return_track is not None and self.return_track.relay:
                        self.return_track.offer_relay(frame, lease)
                        lease = None  # Queue now owns the SAME reservation through sender recv.
                finally:
                    del frame
                    if lease is not None:
                        self.budget.release(lease)
        except (asyncio.CancelledError, MediaStreamError):
            if not self.closed and self.closing_task is None:
                self.fail("incoming track ended before owned close")
        except Exception as error:
            self.uplink.record["processorErrors"] += 1
            self.fail(f"decoded consumer: {error}")
        finally:
            self.uplink.finish()

    async def offer(self, description):
        await self.pc.setRemoteDescription(RTCSessionDescription(**description))
        self.check_live()
        audio = [t for t in self.pc.getTransceivers() if t.kind == "audio"]
        if len(audio) != 1:
            raise ValueError("exactly one audio transceiver required")
        t = audio[0]
        codecs = [c for c in RTCRtpSender.getCapabilities("audio").codecs if c.mimeType.lower() == "audio/opus"]
        if not codecs:
            raise ValueError("Opus codec unavailable")
        t.setCodecPreferences(codecs)
        if self.mode != "uplink-only":
            self.return_track = ReturnTrack(self.envelope["binding"]["downlinkSourceId"], self.clock_id, self.config, self.mode == "relay-instead-of-independent-return", self.budget)
            t.sender.replaceTrack(self.return_track)
            t.direction = "sendrecv"
            self.return_track.bind(t.sender)
            self.sender_binding["kind"] = self.return_track.source()["kind"]
        else:
            t.direction = "recvonly"
        answer = await self.pc.createAnswer()
        self.check_live()
        await self.pc.setLocalDescription(answer)
        self.check_live()
        self.outcome = "running"
        return {"type": self.pc.localDescription.type, "sdp": self.pc.localDescription.sdp}

    def check_live(self):
        if self.closed or self.closing_task is not None or self.outcome == "failed":
            raise ValueError(self.reason or "peer already closing/closed")

    async def mark(self, marker_id, command):
        async with self.mark_lock:
            return await self._mark(marker_id, command)

    async def _mark(self, marker_id, command):
        if any(mark["markerId"] == marker_id for mark in self.marks):
            raise ValueError("marker ID reused")
        expected = ("ready", "warmup", "start", "end")
        if len(self.marks) >= 4 or command != expected[len(self.marks)]:
            raise ValueError("phase command order")
        deadline = time.monotonic() + self.config["timing"]["setupMs"] / 1000
        while self.uplink.record["firstNonzeroAtLocalMs"] is None or (self.return_track is not None and self.return_track.health.record["firstNonzeroAtLocalMs"] is None):
            self.check_live()
            if time.monotonic() >= deadline:
                raise ValueError("actual processed position unavailable")
            await asyncio.sleep(.01)
        self.check_live()
        # Both latches happen without awaiting between them on this event loop.
        uplink = self.uplink.latch(marker_id, command)
        source = None if self.return_track is None else self.return_track.health.latch(marker_id, command)
        mark = self.envelope | {"markerId": marker_id, "command": command, "serverClockId": self.clock_id,
            "serverAtMs": time.monotonic() * 1000, "uplinkDecoded": uplink, "downlinkSource": source}
        self.marks.append(mark)
        return mark

    async def close(self):
        if self.closing_task is None:
            self.closing_task = asyncio.create_task(self._close())
        await asyncio.shield(self.closing_task)

    async def _close(self):
        try:
            await observe_bindings(self)
        except Exception as error:
            self.fail(f"final binding observation: {error}")
        current = asyncio.current_task()
        tasks = [task for task in self.tasks if task is not current and not task.done()]
        for task in tasks:
            task.cancel()
        if self.return_track is not None:
            try:
                self.return_track.stop()
            except Exception as error:
                self.fail(f"source stop: {error}")
        for track in self.incoming:
            try:
                track.stop()
            except Exception as error:
                self.fail(f"incoming stop: {error}")
        try:
            await asyncio.wait_for(self.pc.close(), self.config["timing"]["drainMs"] / 1000)
        finally:
            await asyncio.gather(*tasks, return_exceptions=True)
            self.tasks.clear()
            try:
                self.uplink.finish()
            except Exception as error:
                self.fail(f"final decoded history: {error}")
            self.pc.remove_all_listeners()
        self.closed = self.pc.connectionState == "closed"
        if not self.closed:
            raise ValueError("actual peer close unconfirmed")
        if self.outcome != "failed":
            self.outcome = "completed"

    def source(self):
        return absent_source(self.envelope["binding"]["downlinkSourceId"]) if self.return_track is None else self.return_track.source()
