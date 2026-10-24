"""Real aiortc host peer, explicit host ICE and bounded datachannel/media lifetime."""
import asyncio
import secrets
import re
import time
from aiortc import RTCPeerConnection, RTCSessionDescription, RTCConfiguration
from aiortc import MediaStreamTrack
from aiohttp import web


class AudioRelay(MediaStreamTrack):
    kind = "audio"

    def __init__(self, track, stats):
        super().__init__()
        self.source = track
        self.stats = stats

    async def recv(self):
        frame = await self.source.recv()
        self.stats["audioFrames"] += 1
        self.stats["audioSamples"] += frame.samples
        return frame


class RtcPeers:
    def __init__(self, delay_ms=0):
        self.delay_ms = delay_ms
        self.peers = {}
        self.cancelled = {}
        self.closing = {}
        self.stats = {"offers": 0, "messages": 0, "bytes": 0, "audioFrames": 0,
                      "audioSamples": 0, "rejected": 0, "closed": 0, "cancelled": 0, "closeFailures": 0}

    async def close_one(self, peer_id):
        if peer_id in self.closing:
            await asyncio.wait_for(asyncio.shield(self.closing[peer_id]), 5)
            return
        item = self.peers.pop(peer_id, None)
        if item:
            item[1].cancel()
            for pending in item[2]:
                pending.cancel()
            closing = asyncio.create_task(item[0].close())
            self.closing[peer_id] = closing
            try:
                await asyncio.wait_for(asyncio.shield(closing), 5)
            except Exception:
                self.stats["closeFailures"] += 1
                raise
            else:
                self.closing.pop(peer_id, None)
                self.stats["closed"] += 1

    async def close_all(self):
        await asyncio.gather(*(self.close_one(key) for key in list(self.peers)))

    async def offer(self, request):
        if len(self.peers) >= 8:
            raise web.HTTPServiceUnavailable(text="peer limit")
        try:
            data = await request.json()
        except (ValueError, UnicodeError):
            raise web.HTTPBadRequest(text="JSON object required")
        if not isinstance(data, dict):
            raise web.HTTPBadRequest(text="JSON object required")
        if data.get("type") != "offer" or not isinstance(data.get("sdp"), str) or len(data["sdp"]) > 65536 or not data["sdp"].startswith("v=0") or "m=" not in data["sdp"]:
            raise web.HTTPBadRequest(text="bounded offer required")
        peer_id = data.get("peerId", secrets.token_hex(12))
        if not isinstance(peer_id, str) or not re.fullmatch(r"[A-Za-z0-9-]{16,80}", peer_id):
            raise web.HTTPBadRequest(text="bounded peer ticket required")
        self.cancelled = {key: expiry for key, expiry in self.cancelled.items() if expiry > time.monotonic()}
        if peer_id in self.cancelled:
            raise web.HTTPGone(text="cancelled before allocation")
        if peer_id in self.peers:
            raise web.HTTPConflict(text="peer ticket already active")
        response_delay = request.query.get("responseDelayMs", "0")
        if not response_delay.isdigit() or not 0 <= int(response_delay) <= 1000:
            raise web.HTTPBadRequest(text="responseDelayMs must be0..1000 application signaling delay")
        pc = RTCPeerConnection(RTCConfiguration(iceServers=[]))
        deadline = asyncio.get_running_loop().call_later(60, lambda: asyncio.create_task(self.close_one(peer_id)))
        pending = set()
        pending_bytes = 0
        self.peers[peer_id] = (pc, deadline, pending)
        self.stats["offers"] += 1
        local_count = 0
        local_bytes = 0
        channel_count = 0

        @pc.on("connectionstatechange")
        async def changed():
            if pc.connectionState in ["failed", "closed"]:
                await self.close_one(peer_id)

        @pc.on("datachannel")
        def channel_created(channel):
            nonlocal channel_count
            channel_count += 1
            if channel_count > 4:
                channel.close()
                return

            @channel.on("message")
            def message(payload):
                nonlocal local_count, local_bytes, pending_bytes
                encoded = payload.encode() if isinstance(payload, str) else payload
                local_count += 1
                local_bytes += len(encoded)
                if (len(encoded) > 65536 or local_count > 4096 or local_bytes > 16 * 1024 * 1024
                        or channel.bufferedAmount + pending_bytes + len(encoded) > 1024 * 1024 or len(pending) >= 128):
                    self.stats["rejected"] += 1
                    asyncio.create_task(self.close_one(peer_id))
                    return
                self.stats["messages"] += 1
                self.stats["bytes"] += len(encoded)
                pending_bytes += len(encoded)
                def send():
                    nonlocal pending_bytes
                    pending.discard(handle)
                    pending_bytes -= len(encoded)
                    if channel.readyState == "open":
                        channel.send(payload)
                handle = asyncio.get_running_loop().call_later(self.delay_ms / 1000, send)
                pending.add(handle)

        @pc.on("track")
        def track_received(track):
            if track.kind == "audio":
                pc.addTrack(AudioRelay(track, self.stats))

        try:
            await asyncio.wait_for(pc.setRemoteDescription(RTCSessionDescription(sdp=data["sdp"], type="offer")), 10)
            await asyncio.wait_for(pc.setLocalDescription(await pc.createAnswer()), 10)
            if int(response_delay):
                await asyncio.sleep(int(response_delay) / 1000)
            if peer_id not in self.peers or request.transport is None or request.transport.is_closing():
                await self.close_one(peer_id)
                raise web.HTTPGone(text="offer cancelled before answer")
            return web.json_response({"sdp": pc.localDescription.sdp, "type": "answer", "peerId": peer_id})
        except Exception:
            await self.close_one(peer_id)
            raise web.HTTPBadRequest(text="offer negotiation failed")

    async def close_request(self, request):
        try:
            data = await request.json()
        except (ValueError, UnicodeError):
            raise web.HTTPBadRequest(text="JSON object required")
        if not isinstance(data, dict):
            raise web.HTTPBadRequest(text="JSON object required")
        if not isinstance(data.get("peerId"), str) or not re.fullmatch(r"[A-Za-z0-9-]{16,80}", data["peerId"]):
            raise web.HTTPBadRequest(text="peerId required")
        self.cancelled = {key: expiry for key, expiry in self.cancelled.items() if expiry > time.monotonic()}
        if len(self.cancelled) >= 128:
            self.cancelled.pop(next(iter(self.cancelled)))
        self.cancelled[data["peerId"]] = time.monotonic() + 60
        self.stats["cancelled"] += 1
        await self.close_one(data["peerId"])
        return web.json_response({"closed": True, "peerId": data["peerId"], "cancelled": True})
