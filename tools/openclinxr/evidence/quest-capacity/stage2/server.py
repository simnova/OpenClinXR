"""Owned 127-only aiortc endpoint. No external ICE services or dependency install."""
import argparse
import asyncio
import hashlib
import json
import os
import signal
import socket
import sys
import time
import uuid
from pathlib import Path

import aiohttp
import aiortc
import av
from aiohttp import web
from bindings import observe_bindings
from peer import Peer
from memory import KnownBudget, ReservationError, json_size


def compact(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


class Service:
    def __init__(self, specification, budget=None):
        self.spec, self.config = specification, specification["config"]
        self.budget = budget or KnownBudget(327680)
        self.budget.reserve("specification", "retained-specification", json_size(specification), True)
        self.budget.reserve("scalar-state", "bounded-scalar-state", 8192, True)
        self.clock_id = f"python-monotonic:{os.getpid()}:{uuid.uuid4()}"
        self.peer, self.envelope, self.close_ack = None, None, None
        self.close_operation, self.close_callers = None, set()
        self.requests, self.queued, self.maximum_controls, self.maximum_bytes = set(), 0, 0, 0
        self.rejected, self.overflow = 0, 0

    def verify(self, body):
        if not isinstance(body, dict) or body.get("identity") != self.spec["identity"] or not isinstance(body.get("binding"), dict):
            raise web.HTTPBadRequest(text="source identity/envelope mismatch")
        binding = body["binding"]
        if set(binding) != {"runNonce", "peerTicket", "uplinkSourceId", "downlinkSourceId"} or any(not isinstance(v, str) or not 1 <= len(v) <= 128 for v in binding.values()):
            raise web.HTTPBadRequest(text="bounded binding required")
        envelope = {"identity": body["identity"], "binding": binding}
        if self.envelope is not None and envelope != self.envelope:
            raise web.HTTPConflict(text="ticket/nonce/source already reserved")
        return envelope

    async def dispatch(self, request):
        bounds = self.config["bounds"]
        if len(self.requests) >= bounds["maximumConcurrentControls"]:
            self.rejected += 1
            raise web.HTTPTooManyRequests(text="control concurrency admission cap")
        if request.content_length is not None and request.content_length > bounds["maximumControlBodyBytes"]:
            self.rejected += 1
            raise web.HTTPRequestEntityTooLarge(max_size=bounds["maximumControlBodyBytes"], actual_size=request.content_length)
        task, admitted = asyncio.current_task(), 0
        self.requests.add(task)
        self.maximum_controls = max(self.maximum_controls, len(self.requests))
        leases = []
        try:
            chunks = []
            async for chunk in request.content.iter_chunked(4096):
                if admitted + len(chunk) > bounds["maximumControlBodyBytes"]:
                    self.rejected += 1
                    raise web.HTTPRequestEntityTooLarge(max_size=bounds["maximumControlBodyBytes"], actual_size=admitted + len(chunk))
                if self.queued + len(chunk) > bounds["maximumQueuedControlBytes"]:
                    self.rejected += 1
                    raise web.HTTPTooManyRequests(text="control queue admission cap")
                leases.append(self.budget.reserve(object(), "request-chunks", len(chunk)))
                chunks.append(chunk)
                admitted += len(chunk)
                self.queued += len(chunk)
                self.maximum_bytes = max(self.maximum_bytes, self.queued)
            joined = self.budget.reserve(object(), "request-joined", admitted)
            leases.append(joined)
            raw = b"".join(chunks)
            chunks.clear()
            for key in leases[:-1]:
                self.budget.release(key)
            leases = [joined]
            decoded_lease = self.budget.reserve(object(), "request-text", admitted)
            leases.append(decoded_lease)
            text = raw.decode("utf8")
            parsed_lease = self.budget.reserve(object(), "request-parsed-known-utf8", admitted)
            leases.append(parsed_lease)
            body = json.loads(text)
            del raw, text
            self.budget.release(joined); self.budget.release(decoded_lease)
            leases = [parsed_lease]
            envelope = self.verify(body)
            route = request.path
            if route == self.config["routes"]["offer"]:
                value = await self.offer(body, envelope)
            elif route == self.config["routes"]["close"]:
                value = await self.close(envelope, task)
            elif route == self.config["routes"]["control"]:
                if self.peer is None or self.close_ack is not None:
                    raise web.HTTPConflict(text="no live peer")
                if not isinstance(body.get("markerId"), str) or len(body["markerId"]) > 128 or body.get("command") not in ("ready", "warmup", "start", "end"):
                    raise web.HTTPBadRequest(text="bounded marker/command required")
                value = await self.peer.mark(body["markerId"], body["command"])
            elif route == self.config["routes"]["stats"]:
                value = await self.snapshot(body, admitted)
            else:
                raise web.HTTPNotFound()
            # Pre-reserve BOTH complete ASCII text and encoded payload copies. Extra512B
            # bounds the audit's updated counter digits/category fields, checked below.
            size = json_size(value) + 512
            response_lease = self.budget.reserve(object(), "response-text-and-bytes", size * 2)
            leases.append(response_lease)
            if "resources" in value:
                value["resources"]["reservation"] = self.budget.audit()
            if json_size(value) > size:
                raise ReservationError("response audit exceeded pre-reserved dimension")
            encoded = compact(value).encode("ascii")
            response = web.StreamResponse(status=200, headers={"Content-Type": "application/json", "Cache-Control": "no-store", "Content-Length": str(len(encoded))})
            await response.prepare(request)
            await response.write(encoded)
            await response.write_eof()
            del encoded
            return response
        except ReservationError as error:
            self.overflow += 1
            if self.peer is not None:
                self.peer.fail(f"known bytes: {error}")
            raise web.HTTPInsufficientStorage(text="known owner reservation rejected") from error
        except (ValueError, TypeError, KeyError, UnicodeDecodeError) as error:
            self.rejected += 1
            raise web.HTTPBadRequest(text=str(error)) from error
        finally:
            for key in leases:
                self.budget.release(key)
            self.requests.discard(task)
            self.queued -= admitted

    async def offer(self, body, envelope):
        if self.peer is not None or self.close_ack is not None or self.envelope is not None:
            raise web.HTTPConflict(text="single-use ticket; allocation/reuse forbidden")
        modes = ("positive", "uplink-only", "relay-instead-of-independent-return", "remote-output-disconnected", "early-peer-close")
        if body.get("mode") not in modes or not isinstance(body.get("description"), dict) or body["description"].get("type") != "offer" or not isinstance(body["description"].get("sdp"), str):
            raise web.HTTPBadRequest(text="mode and actual offer required")
        self.envelope = envelope
        self.peer = Peer(envelope, body["mode"], self.config, self.clock_id, self.spec["inventoryAddresses"], self.budget)
        try:
            async with asyncio.timeout(self.config["timing"]["setupMs"] / 1000):
                description = await self.peer.offer(body["description"])
            return envelope | {"description": description, "allocatedAtServerMs": self.peer.allocated_at, "serverClockId": self.clock_id}
        except BaseException as error:
            self.peer.fail(f"offer incomplete: {type(error).__name__}")
            await self.peer.close()
            raise

    async def close(self, envelope, caller=None):
        if self.envelope is None:
            self.envelope = envelope  # Tombstone BEFORE any await or potential later offer.
        if self.close_ack is not None:
            return self.close_ack
        if caller is not None:
            self.close_callers.add(caller)
        if self.close_operation is None:
            self.close_operation = asyncio.create_task(self._close(envelope))
        try:
            return await asyncio.shield(self.close_operation)
        finally:
            self.close_callers.discard(caller)

    async def _close(self, envelope):
        others = [task for task in self.requests if task not in self.close_callers and not task.done()]
        for task in others:
            task.cancel()
        if others:
            await asyncio.gather(*others, return_exceptions=True)
        if self.peer is not None:
            await self.peer.close()
        self.budget.seal()
        self.close_ack = envelope | {"closed": True, "serverClockId": self.clock_id, "atServerMs": time.monotonic() * 1000,
            "activePeers": 0, "closingPeers": 0, "ownedTasks": 0, "queuedControlBytes": 0, "pendingControls": 0}
        return self.close_ack

    async def snapshot(self, body, current_body_bytes):
        peer = self.peer
        if peer is None:
            raise web.HTTPConflict(text="no allocated peer/history")
        history, after = body.get("history"), body.get("afterSequence")
        if history not in ("uplink-decoded", "downlink-source") or not isinstance(after, int) or isinstance(after, bool) or after < -1:
            raise web.HTTPBadRequest(text="history/cursor required")
        if not peer.closed:
            await observe_bindings(peer)
        up, source = peer.uplink.record, peer.source()
        rows = up["bins"] if history == "uplink-decoded" else source["bins"]
        if after >= len(rows) and after != -1:
            raise web.HTTPBadRequest(text="cursor beyond actual history")
        page = rows[after + 1:after + 1 + min(4, self.config["bins"]["maximumStatsPageRows"])]
        payload_bytes = json_size(up["bins"]) + json_size(source["bins"])
        pending_pcm = 0 if peer.return_track is None else peer.return_track.pending_pcm_bytes
        if payload_bytes + pending_pcm + self.queued > self.budget.limit:
            self.overflow += 1
            raise ValueError("retained scalar history/payload/control cap")
        return peer.envelope | {"schema": "quest-stage2-host-server-snapshot.v1", "serverClockId": self.clock_id,
            "atServerMs": time.monotonic() * 1000, "allocatedAtServerMs": peer.allocated_at, "iceState": peer.last_ice, "dtlsState": peer.last_dtls,
            "uplinkDecoded": {k: v for k, v in up.items() if k != "bins"}, "downlinkSource": {k: v for k, v in source.items() if k != "bins"},
            "positions": {"uplinkDecoded": peer.uplink.position(), "downlinkSource": None if peer.return_track is None else peer.return_track.health.position()},
            "bindings": {"uplinkReceiver": peer.receiver_binding, "downlinkSender": peer.sender_binding}, "selectedPair": peer.last_pair, "marks": peer.marks,
            "page": {"history": history, "afterSequence": after, "nextAfterSequence": page[-1]["sequence"] if page else after,
                "rows": page, "totalAvailableRows": len(rows), "final": peer.closed and self.close_ack is not None},
            "resources": {"activePeers": int(not peer.closed), "closingPeers": int(peer.closing_task is not None and not peer.closing_task.done()),
                "ownedTasks": sum(not task.done() for task in peer.tasks), "pendingControls": max(0, len(self.requests) - 1), "queuedControlBytes": max(0, self.queued - current_body_bytes),
                "maximumConcurrentControls": self.maximum_controls, "maximumQueuedControlBytes": self.maximum_bytes,
                "typedHealthBytes": 0, "knownPendingPayloadBytes": payload_bytes + pending_pcm, "ownedControlBytes": max(0, self.queued - current_body_bytes),
                "dropped": 0, "rejected": self.rejected, "overflow": self.overflow, "reservation": self.budget.audit()},
            "close": self.close_ack, "outcome": peer.outcome, "reason": peer.reason}


async def main(specification_path):
    budget = KnownBudget(327680)
    size = Path(specification_path).stat().st_size
    if size > 65536:
        raise ValueError("specification body cap")
    lease = budget.reserve("specification-read", "startup-specification-copies", size * 3)
    specification = json.loads(Path(specification_path).read_text())
    budget.release(lease)
    source_files = {}
    lease = budget.reserve("source-read", "startup-source-chunk", 4096)
    try:
        for name in specification["serverSourceFiles"]:
            hasher = hashlib.sha256()
            with (Path(__file__).parent / name).open("rb") as source:
                while True:
                    chunk = source.read(4096)
                    if not chunk:
                        break
                    hasher.update(chunk)
                    del chunk
            source_files[name] = hasher.hexdigest()
    finally:
        budget.release(lease)
    digest = hashlib.sha256(compact(source_files).encode()).hexdigest()
    if digest != specification["identity"]["serverSourceSha256"]:
        raise ValueError("actual server source bytes do not match release")
    config_digest = hashlib.sha256(json.dumps(specification["config"], separators=(",", ":")).encode()).hexdigest()
    if config_digest != specification["identity"]["fixtureConfigSha256"]:
        raise ValueError("actual server configuration does not match release")
    service = Service(specification, budget)
    app = web.Application(client_max_size=specification["config"]["bounds"]["maximumControlBodyBytes"])
    for route in specification["config"]["routes"].values():
        app.router.add_post(route, service.dispatch)
    runner = web.AppRunner(app, access_log=None, shutdown_timeout=2)
    await runner.setup()
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    await web.SockSite(runner, sock).start()
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for signum in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(signum, stop.set)
    print(compact({"origin": f"http://127.0.0.1:{sock.getsockname()[1]}", "pid": os.getpid(), "clockId": service.clock_id,
        "pythonVersion": sys.version.split()[0], "aiortcVersion": aiortc.__version__, "avVersion": av.__version__, "aiohttpVersion": aiohttp.__version__, "serverSourceSha256": digest}), flush=True)
    try:
        await stop.wait()
    finally:
        if service.envelope is not None:
            await service.close(service.envelope)
        await runner.cleanup()
        service.budget.seal()
        # The final shutdown JSON is also a bounded serialization lease. Its audit
        # is harvested externally after process exit, superseding earlier stats.
        lease = service.budget.reserve("shutdown-log", "shutdown-log-text-and-bytes", 4096)
        try:
            value = {"closed": True, "ownedPeers": 0 if service.peer is None or service.peer.closed else 1,
                "ownedTasks": 0 if service.peer is None else sum(not t.done() for t in service.peer.tasks), "ownedListeners": 0,
                "pendingControls": len(service.requests), "queuedControlBytes": service.queued, "reservation": service.budget.audit()}
            if json_size(value) > 2048:
                raise ReservationError("shutdown log exceeds pre-reserved dimension")
            print(compact(value), flush=True)
        finally:
            service.budget.release(lease)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--specification", required=True)
    asyncio.run(main(parser.parse_args().specification))
