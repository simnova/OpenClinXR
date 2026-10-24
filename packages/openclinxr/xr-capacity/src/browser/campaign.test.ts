import { describe, expect, it } from "vitest";
import { evaluateRun, makeRun, makeMetric, parseRunRecord } from "../index.js";
import { afterEach, vi } from "vitest";
import { runBrowserProbe } from "@openclinxr/xr-capacity/browser";
afterEach(() => vi.unstubAllGlobals());
import { importCampaignJson, campaignOverlap } from "@openclinxr/xr-capacity/browser";
type SecureCampaign = ReturnType<typeof importCampaignJson>;
function fixture(): SecureCampaign {
  const metric = (id: string, values: [number, number][], semantic: "cpu-duration" | "audio-software" | "asset-duration" | "network-rtt" | "counter" = "counter", kind: "measured" | "proxy" = "measured") => makeMetric({ id, semantic, kind, unit: semantic === "counter" ? "count" : "ms", samples: values.map(([at, value]) => ({ at, value, valid: true })), clockDomain: "browser-monotonic", granularity: id.startsWith("audio.") ? "aggregate-window" : id === "campaign.render-cpu-submission" ? "per-frame" : "event", windowMs: id.startsWith("audio.") ? 85 : null, transportState: semantic === "network-rtt" ? "connected" : "not-applicable", source: { tool: id.startsWith("audio.") ? "AudioWorkletProcessor.currentFrame-window" : id.startsWith("transport.") ? "capacity-browser-transport" : "capacity-campaign-scene", version: "1", processId: "page" } });
  const run = makeRun({ id: "combined", provenance: "desktop-browser", configuration: { workloadHash: "secure-fixture", capabilityHash: "fixture", seed: 1729, axes: { campaignPhase: "combined" } }, metrics: [metric("campaign.render-cpu-submission", [[110, 1], [200, 1], [600, 1], [800, 1]], "cpu-duration"), metric("audio.worklet.processed-blocks", [[120, 32], [300, 64], [750, 96]]), metric("campaign.asset-imagebitmap-decode", [[400, 2]], "asset-duration"), metric("campaign.asset-gpu-upload-submit", [[405, 1]], "asset-duration", "proxy"), metric("transport.https.rtt", [[450, 3]], "network-rtt"), metric("render.verified-nonbackground-pixels", [[1150, 42]])] });
  return { schema: "quest-capacity-campaign.v1", id: "fixture", startedAt: "2026-10-14T00:00:00Z", endedAt: "2026-10-14T00:00:01Z", status: "completed", clock: "browser-monotonic", pageOrigin: "https://localhost:1", servicesOrigin: "https://localhost:2", deviceProof: "external-envelope-required", transportPath: "host-loopback", settings: { level: 1, durationMs: 1000, seed: 1729, width: 384, height: 384, protocols: ["https"] }, phases: [{ id: "combined", requestedAt: 0, barrierAt: 100, endedAt: 1100, status: "completed", drain: { state: "confirmed", at: 1150, activeRtcPeers: 0, activeWebTransportSessions: 0, reason: null }, runIds: ["combined"], expected: ["render", "assets", "audio", "https"], worked: ["render", "assets", "audio", "https"] }], events: [], runs: [run] };
}
describe("secure campaign evidence boundary", () => {
  it("requires actual processing inside a shared render/worklet window", () => {
    expect(campaignOverlap(fixture()).observed).toBe(true);
    const before = fixture(); before.runs[0]!.metrics.find((metric) => metric.id === "transport.https.rtt")!.samples[0]!.at = 105;
    expect(campaignOverlap(before).observed).toBe(false);
    const noUpload = fixture(); noUpload.runs[0]!.metrics = noUpload.runs[0]!.metrics.filter((metric) => metric.id !== "campaign.asset-gpu-upload-submit");
    expect(campaignOverlap(noUpload).observed).toBe(false);
    const noWork = fixture(); for (const sample of noWork.runs[0]!.metrics.find((metric) => metric.id === "audio.worklet.processed-blocks")!.samples) sample.value = 32;
    expect(campaignOverlap(noWork).observed).toBe(false);
    const clock = fixture(); clock.runs[0]!.metrics.find((metric) => metric.id === "transport.https.rtt")!.clockDomain = "server-monotonic"; expect(campaignOverlap(clock).observed).toBe(false);
    const crossPhase = fixture(); crossPhase.runs[0]!.configuration.axes['campaignPhase'] = "isolated-https"; expect(campaignOverlap(crossPhase).observed).toBe(false); expect(() => importCampaignJson(JSON.stringify(crossPhase))).toThrow(/attribution/);
    const synthetic = fixture(); synthetic.runs[0]!.provenance = "synthetic"; expect(campaignOverlap(synthetic).observed).toBe(false);
    const isolated = fixture(); isolated.phases[0]!.id = "isolated-https"; isolated.phases[0]!.expected = ["https"]; isolated.phases[0]!.worked = ["https"]; isolated.runs[0]!.configuration.axes['campaignPhase'] = "isolated-https";
    const ack = isolated.runs[0]!.metrics.find((metric) => metric.id === "transport.https.rtt")!.samples[0]!; ack.at = 150; ack.value = 100; // Received after barrier, but sent during setup.
    const recounted = importCampaignJson(JSON.stringify(isolated)); expect(recounted.phases[0]!.status).toBe("failed"); expect(recounted.phases[0]!.worked).toEqual([]);
    const idle = fixture(); idle.phases[0]!.id = "idle"; idle.phases[0]!.expected = []; idle.phases[0]!.worked = []; idle.runs[0]!.configuration.axes['campaignPhase'] = "idle"; idle.runs[0]!.metrics = [];
    const baseline = importCampaignJson(JSON.stringify(idle)); expect(baseline.phases[0]!.expected).toEqual(["cadence"]); expect(baseline.phases[0]!.status).toBe("failed");
    expect(campaignOverlap(isolated).observed).toBe(false);
    expect(campaignOverlap(fixture()).timingBasis).toContain("not independently synchronized");
  });
  it("rejects forged campaign verdicts, bounds, dangling runs and native authority", () => {
    expect(() => importCampaignJson(JSON.stringify({ ...fixture(), outcome: "validated-profile" }))).toThrow(/unknown field/);
    const dangling = fixture(); dangling.phases[0]!.runIds.push("forged"); expect(() => importCampaignJson(JSON.stringify(dangling))).toThrow(/Dangling/);
    const excessive = fixture(); excessive.runs = Array.from({ length: 33 }, (_, i) => ({ ...excessive.runs[0]!, id: String(i) })); expect(() => importCampaignJson(JSON.stringify(excessive))).toThrow(/at most32|at most 32/);
    const owned = importCampaignJson(JSON.stringify(fixture())); expect(owned.deviceProof).toBe("external-envelope-required"); expect(evaluateRun(owned.runs[0]!).outcome).not.toBe("validated-profile");
  });
  it("accepts throughput/jitter strict units and refuses to authenticate Quest user-agent hints", async () => {
    const run = fixture().runs[0]!; run.metrics = [makeMetric({ semantic: "network-throughput", unit: "bytes/s" }), makeMetric({ id: "jitter", semantic: "network-jitter", unit: "ms" })]; expect(parseRunRecord(run).metrics).toHaveLength(2);
    run.metrics[0]!.unit = "ms"; expect(() => parseRunRecord(run)).toThrow(/unit/);
    vi.stubGlobal("navigator", { userAgent: "Mozilla OculusBrowser Quest 3", platform: "test" });
    vi.stubGlobal("document", { visibilityState: "visible" });
    const controller = new AbortController(); controller.abort();
    const observed = await runBrowserProbe({ suite: "cadence", level: 1, signal: controller.signal, canvas: {} as HTMLCanvasElement, assetCanvas: {} as HTMLCanvasElement, capabilityHash: "test" });
    expect(observed.provenance).toBe("browser-unverified");
    run.metrics = []; run.provenance = "quest-browser"; run.profile.scope = "quest"; expect(evaluateRun(run).outcome).not.toBe("validated-profile");
  });
});
