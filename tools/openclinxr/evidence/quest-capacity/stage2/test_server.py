"""HTTP/state controls without an RTC allocation, SDP, browser, or media graph."""
import asyncio
import json
import unittest
from types import SimpleNamespace
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from health import DecodedHealth
from peer_media import absent_source
from server import Service

IDENTITY = {key: "0" * 64 for key in ("browserBundleSha256", "serverSourceSha256", "protocolSha256", "fixtureConfigSha256", "graderSourceSha256")}
ENVELOPE = {"identity": IDENTITY, "binding": {"runNonce": "nonce", "peerTicket": "ticket", "uplinkSourceId": "up", "downlinkSourceId": "down"}}
CONFIG = {"bounds": {"maximumControlBodyBytes": 65536, "maximumConcurrentControls": 4, "maximumQueuedControlBytes": 262144, "maximumOwnedTypedAndKnownPayloadBytes": 1048576},
          "routes": {"offer": "/stage2/offer", "control": "/stage2/control", "stats": "/stage2/stats", "close": "/stage2/close"},
          "bins": {"maximumStatsPageRows": 16, "maximumRowsPerDecodedDirection": 512}}


class ServerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.service = Service({"identity": IDENTITY, "config": CONFIG, "inventoryAddresses": ["127.0.0.1"]})
        app = web.Application(client_max_size=65536)
        for route in CONFIG["routes"].values():
            app.router.add_post(route, self.service.dispatch)
        self.client = TestClient(TestServer(app))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        self.assertEqual(len(self.service.requests), 0)
        self.assertEqual(self.service.queued, 0)

    async def test_close_before_offer_tombstones_exact_ticket(self):
        ack = await (await self.client.post("/stage2/close", json=ENVELOPE)).json()
        self.assertTrue(ack["closed"])
        self.assertEqual(ack["activePeers"], 0)
        offer = ENVELOPE | {"mode": "positive", "description": {"type": "offer", "sdp": "not used"}}
        response = await self.client.post("/stage2/offer", json=offer)
        self.assertEqual(response.status, 409)
        self.assertIsNone(self.service.peer)
        repeat = await (await self.client.post("/stage2/close", json=ENVELOPE)).json()
        self.assertEqual(repeat, ack)
        wrong = ENVELOPE | {"binding": ENVELOPE["binding"] | {"runNonce": "different"}}
        self.assertEqual((await self.client.post("/stage2/close", json=wrong)).status, 409)

    async def test_concurrent_close_requests_share_one_actual_close(self):
        responses = await asyncio.gather(*(self.client.post("/stage2/close", json=ENVELOPE) for _ in range(2)))
        values = await asyncio.gather(*(response.json() for response in responses))
        self.assertEqual(values[0], values[1])
        self.assertTrue(values[0]["closed"])
        self.assertIsNotNone(self.service.close_operation)

    async def test_malformed_oversized_and_wrong_identity_fail_before_allocation(self):
        self.assertEqual((await self.client.post("/stage2/offer", data="{")).status, 400)
        self.assertEqual((await self.client.post("/stage2/offer", data=b"a" * 65537)).status, 413)
        self.assertEqual((await self.client.post("/stage2/close", json=ENVELOPE | {"identity": {}})).status, 400)
        self.assertIsNone(self.service.peer)

    async def test_final_pages_retain_every_tail_without_live_resources(self):
        h = DecodedHealth("up", "clock", CONFIG)
        from fractions import Fraction
        for i in range(35):
            h.process(128, 1, 48000, i * 128, Fraction(1, 48000), lambda f, c: .01, "s16", "mono", False)
            h.latch(f"m{i}", "ready")
        h.finish()
        peer = SimpleNamespace(envelope=ENVELOPE, uplink=h, return_track=None, closed=True, closing_task=None,
            tasks=set(), allocated_at=1, last_ice="completed", last_dtls="connected", receiver_binding={}, sender_binding={}, last_pair=None,
            marks=[], outcome="completed", reason=None, source=lambda: absent_source("down"))
        self.service.peer, self.service.envelope = peer, ENVELOPE
        self.service.close_ack = ENVELOPE | {"closed": True}
        rows, cursor = [], -1
        while True:
            snapshot = await (await self.client.post("/stage2/stats", json=ENVELOPE | {"history": "uplink-decoded", "afterSequence": cursor})).json()
            page = snapshot["page"]
            self.assertTrue(page["final"])
            self.assertLessEqual(len(page["rows"]), 16)
            rows.extend(page["rows"])
            cursor = page["nextAfterSequence"]
            if cursor == page["totalAvailableRows"] - 1:
                break
        self.assertEqual([r["sequence"] for r in rows], list(range(35)))
        self.assertEqual(sum(r["frames"] for r in rows), 35 * 128)
        self.assertEqual(snapshot["resources"]["ownedTasks"], 0)
        self.assertEqual(snapshot["resources"]["pendingControls"], 0)
        self.assertEqual(snapshot["resources"]["typedHealthBytes"], 0)
        self.assertGreater(snapshot["resources"]["knownPendingPayloadBytes"], 0)
        self.assertEqual((await self.client.post("/stage2/stats", json=ENVELOPE | {"history": "uplink-decoded", "afterSequence": 999})).status, 400)

    async def test_reservation_rejects_before_request_allocation_and_retains_failure(self):
        budget = self.service.budget
        budget.reserve("fixture-held", "retained-fixture", budget.limit - budget.held - 1, True)
        response = await self.client.post("/stage2/close", json=ENVELOPE)
        self.assertEqual(response.status, 507)
        self.assertIsNone(self.service.peer)
        self.assertIsNone(self.service.envelope)
        self.assertEqual(budget.audit()["rejectedReservations"], 1)
        self.assertEqual(len(self.service.requests), 0)
        self.assertEqual(self.service.queued, 0)

    async def test_control_concurrency_bound_is_admission_failure(self):
        self.service.requests = {asyncio.create_task(asyncio.sleep(10)) for _ in range(4)}
        response = await self.client.post("/stage2/close", json=ENVELOPE)
        self.assertEqual(response.status, 429)
        tasks = list(self.service.requests)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self.service.requests.clear()


if __name__ == "__main__":
    unittest.main()
