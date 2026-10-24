import { makeMetric } from "../factories.js";
import type { CapacityMetric, CapacityRun } from "../types.js";
import { createDesktopRun, checkAbort } from "./probes.js";
import { startCampaignScene } from "./campaign-scene.js";
import { startAudioStress, type AudioStressHandle } from "./audio-stress.js";
import { startTransportProbe, type ActiveTransportProbe, type TransportEndpoints, type TransportProtocol } from "./transport-probes.js";
import { localEndpoint } from "./transport-probes-state.js";
import { CAMPAIGN_PROTOCOLS, importCampaignJson, type CampaignPhase, type SecureCampaign } from "./campaign-record.js";

export interface CampaignServices extends TransportEndpoints { schema: "quest-capacity-services.v1"; imageAssetUrl?: string; peerStatsUrl?: string }
export interface SecureCampaignOptions { services: CampaignServices; level: number; durationMs: number; protocols?: TransportProtocol[]; signal: AbortSignal; canvas: () => HTMLCanvasElement; capabilityHash: string; transportPath?: string; onPhase?: (id: string) => void }
function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => { const timer = setTimeout(done, ms); function done() { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); } signal.addEventListener("abort", done, { once: true }); if (signal.aborted) done(); });
}
async function observeDrain(url: string | undefined): Promise<CampaignPhase["drain"]> {
  const result: CampaignPhase["drain"] = { state: "unconfirmed", at: performance.now(), activeRtcPeers: null, activeWebTransportSessions: null, reason: "Independent server peer stats unavailable" };
  if (!url) return result;
  const endpoint = localEndpoint(url, "https:"); const deadline = performance.now() + 2500;
  while (performance.now() < deadline) {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 500);
    try {
      const response = await fetch(endpoint, { signal: controller.signal, cache: "no-store", redirect: "error" }); if (!response.ok) throw new Error("Server peer stats failed");
      const json = await response.text(); if (json.length > 65536) throw new Error("Server stats exceeded64KiB");
      const stats = JSON.parse(json) as { activeRtcPeers?: number; activeWebTransportSessions?: number };
      if (!Number.isSafeInteger(stats.activeRtcPeers) || !Number.isSafeInteger(stats.activeWebTransportSessions) || Number(stats.activeRtcPeers) < 0 || Number(stats.activeWebTransportSessions) < 0) throw new Error("Server peer counters invalid");
      result.activeRtcPeers = stats.activeRtcPeers!; result.activeWebTransportSessions = stats.activeWebTransportSessions!; result.at = performance.now();
      if (result.activeRtcPeers === 0 && result.activeWebTransportSessions === 0) return { ...result, state: "confirmed", reason: null };
      result.reason = "Server still reports active RTC or WebTransport peers";
    } catch (error) { result.reason = error instanceof Error ? error.message.slice(0, 512) : "Server drain unavailable"; }
    finally { clearTimeout(timeout); }
    await delay(50, new AbortController().signal);
  }
  return result;
}
function windowMetrics(metrics: CapacityMetric[], begin: number, end: number): CapacityMetric[] {
  // Whole-handle throughput includes setup/drain and is not a phase throughput observation.
  return metrics.filter((metric) => !metric.id.endsWith(".whole-handle-payload-goodput")).map((metric) => {
    const samples = metric.samples.filter((sample) => sample.at >= begin && sample.at <= end && (!/^transport\..+\.rtt$/.test(metric.id) || sample.value !== null && sample.at - sample.value >= begin));
    return makeMetric({ ...metric, samples });
  });
}
/** One fixed scene/seed/resolution throughout. Every started workload has an owned shutdown path. */
export async function startSecureCampaign(input: SecureCampaignOptions): Promise<SecureCampaign> {
  const level = input.level; const durationMs = input.durationMs;
  if (!Number.isSafeInteger(level) || level < 1 || level > 3 || !Number.isSafeInteger(durationMs) || durationMs < 500 || durationMs > 5000) throw new RangeError("Campaign level1..3 and duration500..5000ms required");
  const services = structuredClone(input.services);
  const protocols = [...(input.protocols ?? CAMPAIGN_PROTOCOLS)];
  if (protocols.length > 6 || new Set(protocols).size !== protocols.length || protocols.some((protocol) => !CAMPAIGN_PROTOCOLS.includes(protocol))) throw new Error("Invalid protocol selection");
  const controller = new AbortController(); const abort = () => controller.abort(); input.signal.addEventListener("abort", abort, { once: true }); if (input.signal.aborted) abort();
  const watchdog = setTimeout(abort, 120_000);
  const campaign: SecureCampaign = { schema: "quest-capacity-campaign.v1", id: `campaign-${Date.now()}`, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), status: "completed", clock: "browser-monotonic", pageOrigin: location.origin, servicesOrigin: new URL(services.httpsOrigin ?? services.echoUrl ?? location.href).origin, deviceProof: "external-envelope-required", transportPath: input.transportPath?.slice(0, 200) || "unverified-path", settings: { level, durationMs, seed: 1729, width: 384, height: 384, protocols }, phases: [], events: [], runs: [] };
  const phases: { id: string; render: boolean; assets: boolean; audio: boolean; protocols: TransportProtocol[] }[] = [
    { id: "idle", render: false, assets: false, audio: false, protocols: [] },
    { id: "render-assets", render: true, assets: true, audio: false, protocols: [] },
    ...protocols.map((protocol) => ({ id: `isolated-${protocol}`, render: false, assets: false, audio: false, protocols: [protocol] })),
    { id: "isolated-audio", render: false, assets: false, audio: true, protocols: [] },
    { id: "combined", render: true, assets: true, audio: true, protocols },
    { id: "recovery", render: true, assets: true, audio: false, protocols: [] },
  ];
  const emit = (phase: string, event: string, detail: string, at = performance.now()) => { if (campaign.events.length < 4096) campaign.events.push({ phase, at, event, detail: detail.slice(0, 1024) || "observed" }); };
  try {
    let previousDrainConfirmed = true;
    for (const plan of phases) {
      if (controller.signal.aborted) break;
      input.onPhase?.(plan.id);
      const phaseController = new AbortController(); const stopPhase = () => phaseController.abort(); controller.signal.addEventListener("abort", stopPhase, { once: true });
      const phase: CampaignPhase = { id: plan.id, requestedAt: performance.now(), barrierAt: null, endedAt: performance.now(), status: "completed", runIds: [], drain: { state: "not-requested", at: performance.now(), activeRtcPeers: null, activeWebTransportSessions: null, reason: null }, expected: [...(plan.render ? ["render"] : []), ...(plan.assets ? ["assets"] : []), ...(plan.audio ? ["audio"] : []), ...plan.protocols], worked: [] };
      campaign.phases.push(phase); emit(plan.id, "phase-requested", `Expected ${phase.expected.join(", ") || "idle cadence"}`);
      if (plan.id === "recovery" && !previousDrainConfirmed) { phase.status = "failed"; phase.endedAt = performance.now(); phase.drain = { state: "unconfirmed", at: performance.now(), activeRtcPeers: null, activeWebTransportSessions: null, reason: "Recovery withheld because preceding server peer drain was not confirmed" }; campaign.status = "failed"; emit(plan.id, "recovery-blocked", phase.drain.reason!); continue; }
      const beganDate = new Date().toISOString();
      const scene = startCampaignScene({ canvas: input.canvas(), level, render: plan.render, assets: plan.assets, ...(services.imageAssetUrl ? { imageAssetUrl: services.imageAssetUrl } : {}), signal: phaseController.signal });
      let audio: AudioStressHandle | undefined; let transports: ActiveTransportProbe[] = [];
      let failedReason: string | null = null;
      let sceneBefore: CapacityMetric[] = []; let audioBefore: CapacityMetric[] = []; let transportBefore: CapacityMetric[][] = [];
      try {
        if (plan.audio) audio = await startAudioStress({ level, durationMs: Math.min(30_000, durationMs + 20_000), signal: phaseController.signal, allowPreviouslyActivated: true, syntheticOutputStream: plan.protocols.some((protocol) => protocol.startsWith("webrtc")), capture: false, speakerGain: 0 });
        transports = await Promise.all(plan.protocols.map((protocol) => startTransportProbe({ protocol, phaseId: plan.id, streamId: protocol, endpoints: services, level, durationMs: durationMs + 15_000, signal: phaseController.signal, maxMessages: 1024, maxBytes: 8 * 1024 * 1024, maxInFlight: 8, ackDeadlineMs: 1500, ...(protocol.startsWith("webrtc") && audio?.outputStream ? { mediaStream: audio.outputStream, syntheticRtcAudio: true } : {}) })));
        const readyDeadline = performance.now() + 3000;
        while (!phaseController.signal.aborted && performance.now() < readyDeadline && (!scene.worked || (plan.assets && !scene.events.some((event) => event.event === "first-asset-upload")))) await delay(20, phaseController.signal);
        checkAbort(phaseController.signal);
        phase.barrierAt = performance.now();
        sceneBefore = scene.metrics(); audioBefore = audio?.snapshotMetrics() ?? []; transportBefore = transports.map((transport) => transport.snapshotMetrics());
        emit(plan.id, "measurement-barrier", "Setup completed; observation interval begins now", phase.barrierAt);
        if (plan.render && scene.worked) phase.worked.push("render"); if (plan.assets && scene.events.some((event) => event.event === "first-asset-upload")) phase.worked.push("assets");
        if (plan.audio && audio?.state.worked) phase.worked.push("audio");
        transports.forEach((transport, index) => { if (transport.state.worked) phase.worked.push(plan.protocols[index]!); });
        if (phase.expected.some((axis) => !phase.worked.includes(axis))) failedReason = "One or more requested axes did not reach actual worked barrier";
        await delay(durationMs, phaseController.signal);
        phase.endedAt = performance.now(); emit(plan.id, "measurement-end", "Observation interval ends; resources begin draining", phase.endedAt);
      } catch (error) { failedReason = error instanceof Error ? error.message : "Phase failed"; }
      finally {
        if (phase.endedAt < (phase.barrierAt ?? phase.requestedAt)) phase.endedAt = performance.now();
        if (phaseController.signal.aborted || controller.signal.aborted) phase.status = "aborted"; else if (failedReason) phase.status = "failed";
        let observedEnd = Math.max(phase.endedAt, phase.barrierAt ?? phase.requestedAt);
        // Snapshot before stop so counters retain the observed window; cleanup snapshots below retain stop events.
        const preserveCounterBaseline = (before: CapacityMetric[], after: CapacityMetric[]) => after.map((metric) => {
          if (metric.semantic !== "counter" && metric.semantic !== "bytes") return metric;
          const baseline = before.find((value) => value.id === metric.id)?.samples.at(-1);
          if (!baseline || !baseline.valid || metric.samples.some((sample) => sample.at === baseline.at)) return metric;
          const samples = [baseline, ...metric.samples].sort((a, b) => a.at - b.at);
          return makeMetric({ ...metric, samples });
        });
        const metrics = preserveCounterBaseline(sceneBefore, scene.metrics()); const audioMetrics = audio ? preserveCounterBaseline(audioBefore, audio.snapshotMetrics()) : undefined; const transportMetrics = transports.map((transport, index) => preserveCounterBaseline(transportBefore[index] ?? [], transport.snapshotMetrics()));
        if (metrics.some((metric) => metric.id === "campaign.scene-failure") || transports.some((transport) => transport.state.status === "failed")) { phase.status = phase.status === "aborted" ? "aborted" : "failed"; failedReason ??= "A requested workload failed during the observation interval"; }
        observedEnd = performance.now(); phase.endedAt = observedEnd;
        phaseController.abort(); await Promise.allSettled([scene.stop(), audio?.stop(), ...transports.map((transport) => transport.stop())]); controller.signal.removeEventListener("abort", stopPhase);
        const postStopScene = scene.metrics();
        const sceneDiagnostics = postStopScene.filter((metric) => metric.id === "render.verified-nonbackground-pixels" || metric.id === "campaign.scene-failure").map((metric) => metric.id === "render.verified-nonbackground-pixels" ? { ...metric, source: { ...metric.source, tool: "post-window-untimed-redraw-readPixels" } } : metric);
        if (postStopScene.some((metric) => metric.id === "campaign.scene-failure")) { phase.status = phase.status === "aborted" ? "aborted" : "failed"; failedReason ??= "Post-stop rendering/readback verification failed"; }
        phase.drain = await observeDrain(services.peerStatsUrl);
        if (transports.some((transport, index) => plan.protocols[index]?.startsWith("webrtc") && transport.axes['rtcServerDrainState'] !== "confirmed")) phase.drain = { ...phase.drain, state: "unconfirmed", reason: "RTC handle did not confirm its exact server close acknowledgment" };
        previousDrainConfirmed = phase.drain.state === "confirmed";
        if (!previousDrainConfirmed && phase.status !== "aborted") { phase.status = "failed"; failedReason ??= phase.drain.reason; }
        emit(plan.id, "server-peer-drain", `${phase.drain.state}; RTC ${phase.drain.activeRtcPeers ?? "unknown"}; WebTransport ${phase.drain.activeWebTransportSessions ?? "unknown"}`, phase.drain.at);
        const makePhaseRun = (axis: string, axisMetrics: CapacityMetric[], axes: Record<string, string | number | boolean | null>, status: CapacityRun["status"], postWindowDiagnostics: CapacityMetric[] = []) => {
          const clipped = windowMetrics(axisMetrics, phase.barrierAt ?? phase.requestedAt, observedEnd + 1).filter((metric) => !postWindowDiagnostics.some((diagnostic) => diagnostic.id === metric.id));
          const run = createDesktopRun(`campaign-${axis}`, level, beganDate, [...clipped, ...postWindowDiagnostics], status, input.capabilityHash);
          run.configuration.workloadHash = `secure-campaign-${axis}-v2`;
          // Shared settings remain in the campaign envelope; keep every protocol fact within the unchanged64-axis core cap.
          run.configuration.axes = { ...axes, campaignPhase: phase.id, observationDurationMs: durationMs, transportPath: campaign.transportPath, setupSamplesExcluded: true, phaseObservationsRecountedFromWindow: true, counterTotalsIncludeSetup: true };
          if (axis === "scene") Object.assign(run.configuration.axes, { scene: "matched-triangle-v1", postWindowUntimedRedrawForReadback: true, level, durationMs, renderWidth: 384, renderHeight: 384, renderEnabled: plan.render, assetEnabled: plan.assets, audioEnabled: plan.audio });
          campaign.runs.push(run); phase.runIds.push(run.id);
        };
        const sceneFailed = postStopScene.some((metric) => metric.id === "campaign.scene-failure");
        makePhaseRun("scene", metrics, { axis: "scene", renderBackend: "raw-webgl2", assetSide: [128, 256, 512][level - 1]!, phaseWindowStart: phase.barrierAt, phaseWindowEnd: observedEnd }, phase.status === "aborted" ? "aborted" : sceneFailed ? "unsupported" : "completed", sceneDiagnostics);
        if (audio && audioMetrics) makePhaseRun("audio", audioMetrics, { ...audio.axes, axis: "audio" }, phase.status === "aborted" ? "aborted" : audio.state.worked ? "completed" : "unsupported");
        transports.forEach((transport, index) => makePhaseRun(plan.protocols[index]!, transportMetrics[index]!, { ...transport.axes, axis: plan.protocols[index]!, protocolWorked: transport.state.worked, protocolState: transport.state.status }, phase.status === "aborted" ? "aborted" : transport.state.worked && transport.state.status !== "failed" ? "completed" : "unsupported"));
        for (const event of scene.events) emit(plan.id, event.event, event.detail, event.at);
        for (const event of audio?.events ?? []) emit(plan.id, `audio:${event.type}`, event.detail, event.at);
        for (const transport of transports) for (const event of transport.events) emit(plan.id, `transport:${event.event}`, event.detail, event.at);
        if (failedReason) emit(plan.id, "phase-failure", failedReason);
        emit(plan.id, "phase-drained", "Owned audio, transport, graphics and asset resources stopped");
      }
      if (phase.status === "failed") campaign.status = "failed";
    }
  } catch (error) { campaign.status = controller.signal.aborted ? "aborted" : "failed"; if (campaign.phases.at(-1)) emit(campaign.phases.at(-1)!.id, "campaign-failure", error instanceof Error ? error.message : "Campaign failed"); }
  finally { clearTimeout(watchdog); input.signal.removeEventListener("abort", abort); if (controller.signal.aborted) campaign.status = "aborted"; campaign.endedAt = new Date().toISOString(); }
  return importCampaignJson(JSON.stringify(campaign));
}
