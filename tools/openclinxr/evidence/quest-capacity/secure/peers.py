"""Private loopback signaling and UDP HTTP/3 lifecycle. JSON stdout is readiness only."""
import argparse
import asyncio
import json
import signal
import importlib.metadata
import platform
from aiohttp import web
from aioquic.asyncio import serve
from aioquic.h3.connection import H3_ALPN
from aioquic.quic.configuration import QuicConfiguration
from rtc_peer import RtcPeers
from wt_peer import EchoProtocol


async def main(args):
    peers = RtcPeers(args.echo_delay_ms)
    EchoProtocol.delay_ms = args.echo_delay_ms
    origins = set(json.loads(args.origins))
    EchoProtocol.token, EchoProtocol.origins = args.token, origins

    @web.middleware
    async def auth(request, handler):
        if request.query.get("token") != args.token:
            raise web.HTTPForbidden()
        if request.headers.get("Origin") not in origins:
            raise web.HTTPForbidden()
        return await handler(request)

    app = web.Application(client_max_size=65536, middlewares=[auth])
    app.router.add_post("/capacity/rtc/offer", peers.offer)
    app.router.add_post("/capacity/rtc/close", peers.close_request)
    async def stats(_request):
        return web.json_response({"rtc": peers.stats, "wt": EchoProtocol.stats, "activeRtcPeers": len(peers.peers) + len(peers.closing), "closingRtcPeers": len(peers.closing), "activeWtConnections": len(EchoProtocol.peers), "activeWebTransportSessions": sum(len(peer.sessions) for peer in EchoProtocol.peers)})
    app.router.add_get("/capacity/peer-stats", stats)
    runner = web.AppRunner(app, access_log=None)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    rtc_port = site._server.sockets[0].getsockname()[1]
    config = QuicConfiguration(is_client=False, alpn_protocols=H3_ALPN, max_datagram_frame_size=1200,
                               max_data=1024 * 1024, max_stream_data=131072, idle_timeout=15)
    config.load_cert_chain(args.cert, args.key)
    quic = await serve(args.host, 0, configuration=config, create_protocol=EchoProtocol, retry=True)
    wt_port = quic._transport.get_extra_info("sockname")[1]
    print(json.dumps({"ready": True, "rtcPort": rtc_port, "wtPort": wt_port, "versions": {"python": platform.python_version(), **{name: importlib.metadata.version(name) for name in ("aioquic", "aiortc", "aiohttp", "av", "cryptography", "aioice")}}}), flush=True)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    try:
        await stop.wait()
    finally:
        for peer in list(EchoProtocol.peers):
            peer.expire()
        quic.close()
        await peers.close_all()
        await runner.cleanup()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for name in ("cert", "key", "token", "origins"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--echo-delay-ms", type=int, choices=range(0, 1001), default=0)
    parser.add_argument("--host", default="127.0.0.1")
    asyncio.run(main(parser.parse_args()))
