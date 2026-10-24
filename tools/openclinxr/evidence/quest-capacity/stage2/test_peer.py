"""Lifecycle stubs, never actual SDP/RTCPeerConnection/media execution."""
import asyncio
import unittest
from types import SimpleNamespace
from fractions import Fraction
from health import DecodedHealth
from peer import Peer


class FakePC:
    connectionState = "connected"
    iceConnectionState = "connected"
    calls = 0
    removed = False

    def getTransceivers(self):
        return []

    async def close(self):
        self.calls += 1
        await asyncio.sleep(0)
        self.connectionState = "closed"

    def remove_all_listeners(self):
        self.removed = True


class PeerTests(unittest.IsolatedAsyncioTestCase):
    def stub(self):
        peer = object.__new__(Peer)
        peer.pc, peer.inventory, peer.incoming, peer.tasks = FakePC(), [], [], set()
        peer.closing_task, peer.closed, peer.outcome, peer.reason = None, False, "running", None
        peer.return_track, peer.config, peer.marks, peer.mark_lock = None, {"timing": {"drainMs": 5000, "setupMs": 20000}}, [], asyncio.Lock()
        peer.uplink = DecodedHealth("up", "clock", {"bins": {"maximumRowsPerDecodedDirection": 512}})
        peer.uplink.process(128, 1, 48000, 37, Fraction(1, 48000), lambda i, c: .01, "s16", "mono", False)
        peer.clock_id, peer.envelope = "clock", {"identity": {}, "binding": {}}
        return peer

    async def test_stop_exception_does_not_skip_actual_peer_task_listener_cleanup(self):
        peer = self.stub()
        task = asyncio.create_task(asyncio.sleep(10))
        peer.tasks.add(task)
        source = SimpleNamespace(stopped=False)
        def stop():
            source.stopped = True
            raise ValueError("retained bin overflow")
        source.stop = stop
        peer.return_track = source
        await asyncio.gather(peer.close(), peer.close())
        self.assertTrue(source.stopped)
        self.assertTrue(peer.closed)
        self.assertEqual(peer.pc.calls, 1)
        self.assertTrue(peer.pc.removed)
        self.assertTrue(task.cancelled())
        self.assertEqual(len(peer.tasks), 0)
        self.assertEqual(peer.outcome, "failed")
        self.assertIn("source stop", peer.reason)

    async def test_concurrent_phase_commands_cannot_bypass_order(self):
        peer = self.stub()
        result = await asyncio.gather(peer.mark("first", "ready"), peer.mark("second", "ready"), return_exceptions=True)
        self.assertEqual(sum(isinstance(value, dict) for value in result), 1)
        self.assertEqual(len(peer.marks), 1)
        self.assertTrue(any(isinstance(value, ValueError) for value in result))
        await peer.close()


if __name__ == "__main__":
    unittest.main()
