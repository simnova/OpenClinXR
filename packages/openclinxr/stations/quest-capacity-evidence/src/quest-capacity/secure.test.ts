import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect } from "node:http2";
import type { TLSSocket } from "node:tls";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { WebSocket } from "ws";
import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { startSecureServices } from "../../../../../../tools/openclinxr/evidence/quest-capacity/secure-services.js";
import { localAppOrigin } from "../../../../../../tools/openclinxr/evidence/quest-capacity/secure-routes.js";
import { IMAGE_FIXTURES } from "../../../../../../tools/openclinxr/evidence/quest-capacity/secure-image.js";
// Tests deliberately pin the one self-signed test certificate without modifying system trust.
function request(service: Awaited<ReturnType<typeof startSecureServices>>, path: string, method = "GET", payload?: Buffer) {
  return new Promise<{ status: number; bytes: Buffer; version: string }>((resolve, reject) => {
    const client = connect(service.manifest.httpsOrigin, { rejectUnauthorized: false });
    client.once("error", reject);
    const stream = client.request({ ":path": path, ":method": method }); const chunks: Buffer[] = []; let status = 0;
    stream.on("response", (headers) => { status = Number(headers[":status"]); }); stream.on("data", (data) => chunks.push(Buffer.from(data)));
    stream.once("error", (error) => { client.close(); reject(error); }); stream.once("end", () => { const actual = (client.socket as TLSSocket).getPeerCertificate().raw; const hash = createHash("sha256").update(actual).digest("hex"); const expected = Buffer.from(service.manifest.certificateHashes[0]!.value).toString("hex"); if (hash !== expected) { client.close(); reject(new Error("Unexpected test certificate")); return; } client.close(); resolve({ status, bytes: Buffer.concat(chunks), version: "2.0" }); }); stream.end(payload);
  });
}
describe("bounded secure local services", () => {
  let service: Awaited<ReturnType<typeof startSecureServices>>;
  let identityPeer: Awaited<ReturnType<typeof startSecureServices>>;
  beforeAll(async () => {
    service = await startSecureServices();
    try {
      identityPeer = await startSecureServices();
    } catch (error) {
      await service?.close();
      throw error;
    }
  }, 180_000);
  afterAll(async () => { await identityPeer?.close(); await service?.close(); });
  it("advertises actual separate ports, short-lived ECDSA DER/SPKI pins and loaded versions", () => {
    const m = service.manifest;
    expect(m.bindings.tcpPort).toBeGreaterThan(0); expect(m.bindings.udpPort).toBeGreaterThan(0);
    expect(m.certificateHashes[0]!.value).toHaveLength(32); expect(Buffer.from(m.certificateSpkiSha256Base64, "base64")).toHaveLength(32);
    expect(Buffer.from(m.certificateHashes[0]!.value).toString("base64")).not.toBe(m.certificateSpkiSha256Base64);
    expect(Date.parse(m.certificateValidTo) - Date.now()).toBeLessThan(14 * 86400_000);
    expect(m.serverBuildHash).toMatch(/^[a-f0-9]{64}$/); expect(m.runtimeVersions["aioquic"]).toBe("1.6.1"); expect(m.runtimeVersions["aiortc"]).toBe("1.15.0");
  });
  it("negotiates real HTTP/2 and echoes exact binary bytes", async () => {
    const url = new URL(service.manifest.echoUrl); const bytes = Buffer.from([0, 255, 4, 0, 129]);
    const actual = await request(service, url.pathname + url.search, "POST", bytes);
    expect(actual.status).toBe(200); expect(actual.version).toBe("2.0"); expect(actual.bytes).toEqual(bytes);
  });
  it("rejects missing test token, oversized request, proxy target and asset bounds", async () => {
    expect((await request(service, "/capacity/echo", "POST", Buffer.from("x"))).status).toBe(403);
    const echo = new URL(service.manifest.echoUrl); expect((await request(service, echo.pathname + echo.search, "POST", Buffer.alloc(65537))).status).toBe(413);
    expect((await request(service, "//example.com/secret")).status).toBe(400);
    const asset = new URL(service.manifest.assetUrl); expect((await request(service, asset.pathname + asset.search + "&bytes=8388609")).status).toBe(400);
  });
  it("serves deterministic PNG image fixtures with complete header, checksum and size", async () => {
    const image = new URL(service.manifest.imageAssetUrl); const r = await request(service, image.pathname + image.search);
    expect(r.status).toBe(200); expect(r.bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(createHash("sha256").update(r.bytes).digest("hex")).toBe(IMAGE_FIXTURES.get(256)!.sha256);
  });
  it("performs actual WSS binary ACK and rejects unallowed origins", async () => {
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(service.manifest.wssUrl, { rejectUnauthorized: false, origin: service.manifest.httpsOrigin });
      socket.once("error", reject); socket.once("open", () => socket.send(Buffer.from([0, 255, 7])));
      socket.once("message", (value) => { expect(Buffer.from(value as Buffer)).toEqual(Buffer.from([0, 255, 7])); socket.close(); }); socket.once("close", () => resolve());
    });
    await new Promise<void>((resolve, reject) => { const socket = new WebSocket(service.manifest.wssUrl, { rejectUnauthorized: false, origin: "https://unallowed.example" }); socket.once("open", () => { socket.close(); reject(new Error("Unallowed origin accepted")); }); socket.once("error", () => resolve()); });
  });
  it("pins explicit empty ICE configuration and bounds signaling", async () => {
    const source = await readFile(join(repoRoot(), "tools/openclinxr/evidence/quest-capacity/secure/rtc_peer.py"), "utf8");
    expect(source).toContain("RTCConfiguration(iceServers=[])"); expect(source).toContain("asyncio.wait_for");
    const offer = new URL(service.manifest.rtcOfferUrl); expect((await request(service, offer.pathname + offer.search, "POST", Buffer.from('{"type":"offer","sdp":""}'))).status).toBe(400);
  });
  it("acknowledges close-before-offer and prevents later peer allocation", async () => {
    const peerId = "cancellation-ticket-before-offer"; const close = new URL(service.manifest.rtcCloseUrl);
    const result = await request(service, close.pathname + close.search, "POST", Buffer.from(JSON.stringify({ peerId })));
    expect(result.status).toBe(200); expect(JSON.parse(result.bytes.toString())).toEqual({ closed: true, peerId, cancelled: true });
    const offer = new URL(service.manifest.rtcOfferUrl);
    const cancelled = await request(service, offer.pathname + offer.search, "POST", Buffer.from(JSON.stringify({ peerId, type: "offer", sdp: "v=0\r\nm=application" })));
    expect(cancelled.status).toBe(410);
  });
  it("keeps server identity stable across fresh random ports and certificates", () => {
    expect(identityPeer.manifest.serverBuildHash).toBe(service.manifest.serverBuildHash); expect(identityPeer.manifest.certificateSpkiSha256Base64).not.toBe(service.manifest.certificateSpkiSha256Base64);
  });
  it("accepts only explicit loopback app proxies and current local advertised addresses", async () => {
    expect(() => localAppOrigin("http://example.com/")).toThrow(); expect(() => localAppOrigin("http://127.0.0.1:80/arbitrary")).toThrow();
    await expect(startSecureServices({ bindHost: "127.0.0.1", advertiseHost: "192.0.2.1" })).rejects.toThrow();
    await expect(startSecureServices({ echoDelayMs: 1001 })).rejects.toThrow();
  });
});
