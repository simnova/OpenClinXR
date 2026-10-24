"""Bounded HTTP/3 WebTransport echo peer; application payloads are never logged."""
import time
from urllib.parse import urlsplit, parse_qs
from aioquic.buffer import Buffer, BufferReadError
from aioquic.asyncio import QuicConnectionProtocol
from aioquic.h3.connection import H3Connection
from aioquic.h3.events import HeadersReceived, DatagramReceived, WebTransportStreamDataReceived, DataReceived
from aioquic.quic.events import ProtocolNegotiated, ConnectionTerminated, StreamReset

MAX_BYTES = 16 * 1024 * 1024
MAX_MESSAGES = 4096
MAX_DATAGRAM = 1024
MAX_STREAMS = 16


class EchoProtocol(QuicConnectionProtocol):
    peers = set()
    token = ""
    origins = set()
    delay_ms = 0
    stats = {"connections": 0, "sessions": 0, "messages": 0, "bytes": 0, "rejected": 0, "observedSessions": [], "streamChunks": 0, "datagrams": 0, "queueHighWaterBytes": 0}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.http = None
        self.last_peer = None
        self.sessions = set()
        self.streams = set()
        self.capsules = {}
        self.count = 0
        self.bytes = 0
        self.created = time.monotonic()
        self.closed = False
        self.pending = set()
        self.pending_bytes = 0
        self.peers.add(self)
        self.deadline = self._loop.call_later(60, self.expire)
        self.stats["connections"] += 1
        if len(self.peers) > 8:
            self.expire()

    def datagram_received(self, data, addr):
        self.last_peer = addr
        super().datagram_received(data, addr)

    def expire(self):
        self.closed = True
        self.close(error_code=0x100, reason_phrase="bounded test session ended")
        self.peers.discard(self)
        self.deadline.cancel()
        for handle in self.pending:
            handle.cancel()
        self.pending.clear()

    def echo(self, data, stream_id, stream_ended=False, datagram=False):
        queued = sum(len(stream.sender._buffer) for stream in self._quic._streams.values())
        if self.pending_bytes + queued + len(data) > 1024 * 1024 or len(self.pending) >= 128:
            self.stats["rejected"] += 1
            self.expire()
            return
        self.pending_bytes += len(data)
        self.stats["queueHighWaterBytes"] = max(self.stats["queueHighWaterBytes"], self.pending_bytes + queued)
        def send():
            self.pending_bytes -= len(data)
            self.pending.discard(handle)
            if self.closed:
                return
            if datagram:
                self.http.send_datagram(stream_id, data)
            else:
                self._quic.send_stream_data(stream_id, data, end_stream=stream_ended)
            self.transmit()
        handle = self._loop.call_later(self.delay_ms / 1000, send)
        self.pending.add(handle)

    def budget(self, data):
        self.count += 1
        self.bytes += len(data)
        if self.count > MAX_MESSAGES or self.bytes > MAX_BYTES:
            self.stats["rejected"] += 1
            self.expire()
            return False
        self.stats["messages"] += 1
        self.stats["bytes"] += len(data)
        return True

    def quic_event_received(self, event):
        if self.closed:
            return
        if isinstance(event, ProtocolNegotiated):
            self.http = H3Connection(self._quic, enable_webtransport=True)
        if isinstance(event, StreamReset) and event.stream_id in self.sessions:
            self.sessions.discard(event.stream_id)
            if not self.sessions:
                self.expire()
            return
        if isinstance(event, ConnectionTerminated):
            self.deadline.cancel()
            self.peers.discard(self)
            self.closed = True
            for pending in self.pending:
                pending.cancel()
            self.pending.clear()
            return
        if self.http:
            for item in self.http.handle_event(event):
                self.h3_event(item)

    def h3_event(self, event):
        if isinstance(event, HeadersReceived):
            h = dict(event.headers)
            url = urlsplit(h.get(b":path", b"").decode("utf8", errors="replace"))
            valid = (h.get(b":method") == b"CONNECT" and h.get(b":protocol") == b"webtransport"
                     and url.path == "/capacity/wt" and parse_qs(url.query).get("token") == [self.token]
                     and h.get(b"origin", b"").decode() in self.origins and len(self.sessions) < 2)
            self.http.send_headers(event.stream_id, [(b":status", b"200" if valid else b"403"),
                                   (b"sec-webtransport-http3-draft", b"draft02")], end_stream=not valid)
            if valid:
                self.sessions.add(event.stream_id)
                self.stats["sessions"] += 1
                local = self._transport.get_extra_info("sockname")
                receipt = {"transport": "udp", "alpn": "h3", "sessionId": event.stream_id,
                           "peer": list(self.last_peer) if self.last_peer else None,
                           "local": list(local) if local else None}
                self.stats["observedSessions"].append(receipt)
                del self.stats["observedSessions"][:-32]
            else:
                self.stats["rejected"] += 1
            self.transmit()
        elif isinstance(event, DataReceived) and event.stream_id in self.sessions:
            capsule = self.capsules.setdefault(event.stream_id, bytearray())
            capsule.extend(event.data)
            if len(capsule) > 4096:
                self.expire()
                return
            while capsule:
                buf = Buffer(data=bytes(capsule))
                try:
                    kind, length = buf.pull_uint_var(), buf.pull_uint_var()
                except BufferReadError:
                    break
                header = buf.tell()
                if header + length > len(capsule):
                    break
                del capsule[:header + length]
                # CLOSE_WEBTRANSPORT_SESSION / WT_CLOSE_SESSION capsule.
                if kind == 0x2843:
                    self.sessions.discard(event.stream_id)
                    self.expire()
                    return
            if event.stream_ended:
                self.sessions.discard(event.stream_id)
                if not self.sessions:
                    self.expire()
        elif isinstance(event, DatagramReceived) and event.stream_id in self.sessions:
            if len(event.data) > MAX_DATAGRAM:
                self.stats["rejected"] += 1
                self.expire()
            elif self.budget(event.data):
                self.stats["datagrams"] += 1
                self.echo(event.data, event.stream_id, datagram=True)
        elif isinstance(event, WebTransportStreamDataReceived) and event.session_id in self.sessions:
            self.streams.add(event.stream_id)
            if len(self.streams) > MAX_STREAMS:
                self.stats["rejected"] += 1
                self.expire()
            elif self.budget(event.data):
                # Echo on the same bidi stream immediately; do not wait for client FIN.
                self.stats["streamChunks"] += 1
                self.echo(event.data, event.stream_id, stream_ended=event.stream_ended)
