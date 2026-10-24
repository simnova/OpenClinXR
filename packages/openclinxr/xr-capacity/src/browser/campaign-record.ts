import { parseRunRecord } from "../schema.js";
import { object, array, text, number, integer, choice, unique } from "../schema-primitives.js";
import type { CapacityRun } from "../types.js";

export const MAX_CAMPAIGN_BYTES = 8 * 1024 * 1024;
export const CAMPAIGN_PROTOCOLS = ["https", "wss", "webrtc-reliable", "webrtc-unordered", "webtransport-stream", "webtransport-datagram"] as const;
export interface CampaignEvent { phase: string; at: number; event: string; detail: string }
export interface CampaignPhase {
  id: string; requestedAt: number; barrierAt: number | null; endedAt: number;
  status: "completed" | "failed" | "aborted"; runIds: string[];
  expected: string[]; worked: string[];
  drain: { state: "confirmed" | "unconfirmed" | "not-requested"; at: number; activeRtcPeers: number | null; activeWebTransportSessions: number | null; reason: string | null };
}
export interface SecureCampaign {
  schema: "quest-capacity-campaign.v1"; id: string; startedAt: string; endedAt: string;
  status: "completed" | "aborted" | "failed";
  clock: "browser-monotonic"; pageOrigin: string; servicesOrigin: string;
  deviceProof: "external-envelope-required"; transportPath: string;
  settings: { level: number; durationMs: number; seed: number; width: number; height: number; protocols: string[] };
  phases: CampaignPhase[]; events: CampaignEvent[]; runs: CapacityRun[];
}
/** Import carries observations only. No supplied pass/outcome or trusted-device assertion is accepted. */
export function importCampaignJson(json: string): SecureCampaign {
  if (new TextEncoder().encode(json).byteLength > MAX_CAMPAIGN_BYTES) throw new Error("Campaign exceeds 8 MiB");
  const parsedInput: unknown = JSON.parse(json);
  const r = object(parsedInput, "campaign", ["schema", "id", "startedAt", "endedAt", "status", "clock", "pageOrigin", "servicesOrigin", "deviceProof", "transportPath", "settings", "phases", "events", "runs"]);
  choice(r['schema'], "schema", ["quest-capacity-campaign.v1"]);
  for (const key of ["id", "startedAt", "endedAt", "pageOrigin", "servicesOrigin", "transportPath"]) text(r[key], key);
  if (!Number.isFinite(Date.parse(String(r['startedAt']))) || !Number.isFinite(Date.parse(String(r['endedAt']))) || Date.parse(String(r['startedAt'])) > Date.parse(String(r['endedAt']))) throw new Error("Invalid campaign date interval");
  choice(r['status'], "status", ["completed", "aborted", "failed"]); choice(r['clock'], "clock", ["browser-monotonic"]); choice(r['deviceProof'], "deviceProof", ["external-envelope-required"]);
  const settings = object(r['settings'], "settings", ["level", "durationMs", "seed", "width", "height", "protocols"]);
  integer(settings['level'], "settings.level", 3); if (Number(settings['level']) < 1) throw new Error("Invalid level");
  integer(settings['durationMs'], "settings.durationMs", 5000); if (Number(settings['durationMs']) < 500) throw new Error("Invalid phase duration");
  integer(settings['seed'], "settings.seed", 0xffff_ffff); integer(settings['width'], "settings.width", 1024); integer(settings['height'], "settings.height", 1024);
  const protocols = array(settings['protocols'], "settings.protocols", 6); protocols.forEach((p) => choice(p, "protocol", CAMPAIGN_PROTOCOLS)); unique(protocols as string[], "protocols");
  const runs = array(r['runs'], "runs", 32).map(parseRunRecord); unique(runs.map((run) => run.id), "runs");
  const runIds = new Set(runs.map((run) => run.id));
  const phaseIds: string[] = [];
  const ownedRunIds = new Set<string>();
  const phases = array(r['phases'], "phases", 16).map((value) => {
    const p = object(value, "phase", ["id", "requestedAt", "barrierAt", "endedAt", "status", "runIds", "expected", "worked", "drain"]);
    text(p['id'], "phase.id", 80); phaseIds.push(p['id']);
    number(p['requestedAt'], "phase.requestedAt"); number(p['endedAt'], "phase.endedAt");
    if (p['barrierAt'] !== null) number(p['barrierAt'], "phase.barrierAt");
    if (Number(p['endedAt']) < Number(p['requestedAt']) || (p['barrierAt'] !== null && (Number(p['barrierAt']) < Number(p['requestedAt']) || Number(p['barrierAt']) > Number(p['endedAt'])))) throw new Error("Invalid phase interval");
    choice(p['status'], "phase.status", ["completed", "failed", "aborted"]);
    const refs = array(p['runIds'], "phase.runIds", 8); for (const id of refs) { text(id, "run id"); if (!runIds.has(id)) throw new Error("Dangling phase run"); if (ownedRunIds.has(id)) throw new Error("Run cannot be reused across phases"); ownedRunIds.add(id); if (runs.find((run) => run.id === id)?.configuration.axes['campaignPhase'] !== p['id']) throw new Error("Run phase attribution mismatch"); } unique(refs as string[], "phase.runIds");
    for (const key of ["expected", "worked"]) { const values = array(p[key], key, 10); for (const axis of values) { text(axis, key, 80); choice(axis, key, ["cadence", "render", "assets", "audio", ...CAMPAIGN_PROTOCOLS]); } unique(values as string[], key); }
    if ((p['worked'] as string[]).some((axis) => !(p['expected'] as string[]).includes(axis))) throw new Error("Unexpected worked axis");
    const drain = object(p['drain'], "phase.drain", ["state", "at", "activeRtcPeers", "activeWebTransportSessions", "reason"]);
    choice(drain['state'], "phase.drain.state", ["confirmed", "unconfirmed", "not-requested"]); number(drain['at'], "phase.drain.at");
    for (const key of ["activeRtcPeers", "activeWebTransportSessions"]) if (drain[key] !== null) integer(drain[key], `phase.drain.${key}`, 64);
    if (drain['reason'] !== null) text(drain['reason'], "phase.drain.reason");
    return p as unknown as CampaignPhase;
  }); unique(phaseIds, "phases");
  for (let i = 1; i < phases.length; i++) if (phases[i]!.requestedAt < phases[i - 1]!.endedAt) throw new Error("Phase intervals overlap or move backwards");
  const events = array(r['events'], "events", 4096).map((value) => {
    const e = object(value, "event", ["phase", "at", "event", "detail"]); text(e['phase'], "event.phase", 80); text(e['event'], "event.event", 80); text(e['detail'], "event.detail", 1024); number(e['at'], "event.at"); if (!phaseIds.includes(e['phase'])) throw new Error("Unknown phase event"); return e as unknown as CampaignEvent;
  });
  const campaign = structuredClone({ ...r, settings, phases, events, runs }) as unknown as SecureCampaign;
  const expectedIds = ["idle", "render-assets", ...campaign.settings.protocols.map((protocol) => `isolated-${protocol}`), "isolated-audio", "combined", "recovery"];
  for (const phase of campaign.phases) {
    if (!expectedIds.includes(phase.id)) throw new Error("Unknown campaign phase");
    const evidence = phaseEvidence(campaign, phase);
    const aborted = phase.status === "aborted" || campaign.runs.some((run) => phase.runIds.includes(run.id) && run.status === "aborted");
    const failed = phase.status === "failed" || evidence.reasons.length > 0;
    phase.expected = evidence.expected; phase.worked = evidence.worked;
    phase.status = aborted ? "aborted" : failed ? "failed" : "completed";
  }
  // Positive completed flags never grant credit; retain explicit failure/abort observations conservatively.
  campaign.status = campaign.status === "aborted" || campaign.phases.some((phase) => phase.status === "aborted") ? "aborted" : campaign.status === "failed" || campaign.phases.some((phase) => phase.status === "failed") || expectedIds.some((id) => !campaign.phases.some((phase) => phase.id === id)) ? "failed" : "completed";
  return campaign;
}
function axisObservations(campaign: SecureCampaign, phase: CampaignPhase, axis: string) {
  if (phase.barrierAt === null) return [];
  const begin = phase.barrierAt, end = phase.endedAt;
  const id = axis === "cadence" ? "campaign.raf-gap" : axis === "render" ? "campaign.render-cpu-submission" : axis === "assets" ? "campaign.asset-imagebitmap-decode" : axis === "audio" ? "audio.worklet.processed-blocks" : `transport.${axis}.rtt`;
  const source = axis === "audio" ? "AudioWorkletProcessor.currentFrame-window" : CAMPAIGN_PROTOCOLS.includes(axis as typeof CAMPAIGN_PROTOCOLS[number]) ? "capacity-browser-transport" : "capacity-campaign-scene";
  const semantic = axis === "cadence" ? "callback-gap" : axis === "render" ? "cpu-duration" : axis === "audio" ? "counter" : axis === "assets" ? "asset-duration" : "network-rtt";
  const granularity = axis === "audio" ? "aggregate-window" : axis === "cadence" || axis === "render" ? "per-frame" : "event";
  return campaign.runs.filter((run) => phase.runIds.includes(run.id) && run.configuration.axes['campaignPhase'] === phase.id && ["desktop-browser", "browser-unverified", "quest-browser"].includes(run.provenance)).flatMap((run) => run.metrics.filter((metric) => metric.id === id && metric.kind === "measured" && metric.source.tool === source && metric.semantic === semantic && metric.unit === (axis === "audio" ? "count" : "ms") && metric.granularity === granularity && metric.clockDomain === "browser-monotonic" && (!CAMPAIGN_PROTOCOLS.includes(axis as typeof CAMPAIGN_PROTOCOLS[number]) || metric.semantic === "network-rtt" && metric.unit === "ms" && metric.transportState === "connected")).flatMap((metric) => metric.samples)).filter((sample) => sample.valid && !sample.disjoint && !sample.placeholder && sample.value !== null && sample.at >= begin && sample.at <= end && (!CAMPAIGN_PROTOCOLS.includes(axis as typeof CAMPAIGN_PROTOCOLS[number]) || sample.at - sample.value >= begin)).sort((a, b) => a.at - b.at);
}
/** Every phase, including idle, needs actual work inside its own window. Readiness is setup only. */
export function phaseEvidence(campaign: SecureCampaign, phase: CampaignPhase): { expected: string[]; worked: string[]; reasons: string[] } {
  const expected = phase.id === "idle" ? ["cadence"] : phase.id === "render-assets" || phase.id === "recovery" ? ["render", "assets"] : phase.id === "isolated-audio" ? ["audio"] : phase.id === "combined" ? ["render", "assets", "audio", ...campaign.settings.protocols] : phase.id.startsWith("isolated-") ? [phase.id.slice(9)] : [];
  const worked = expected.filter((axis) => {
    const samples = axisObservations(campaign, phase, axis);
    if (axis === "audio") return samples.length >= 2 && Number(samples.at(-1)?.value) > Number(samples[0]?.value);
    if (axis === "cadence") return samples.length >= 2;
    if (axis === "render") return samples.length >= 2 && campaign.runs.filter((run) => phase.runIds.includes(run.id)).some((run) => run.metrics.some((metric) => metric.id === "render.verified-nonbackground-pixels" && metric.kind === "measured" && metric.unit === "count" && metric.samples.some((sample) => sample.valid && Number(sample.value) > 0)));
    if (axis === "assets") return samples.length > 0 && campaign.runs.filter((run) => phase.runIds.includes(run.id)).some((run) => run.metrics.some((metric) => metric.id === "campaign.asset-gpu-upload-submit" && metric.kind === "proxy" && metric.clockDomain === "browser-monotonic" && metric.samples.some((sample) => sample.valid && sample.value !== null && sample.at >= (phase.barrierAt ?? Infinity) && sample.at <= phase.endedAt)));
    return samples.length > 0;
  });
  const reasons = expected.filter((axis) => !worked.includes(axis)).map((axis) => `No strict in-window ${axis} observations`);
  if (phase.barrierAt === null || phase.endedAt - phase.barrierAt < campaign.settings.durationMs * .9) reasons.push("Observation window absent or incomplete");
  if (phase.drain.state !== "confirmed" || phase.drain.activeRtcPeers !== 0 || phase.drain.activeWebTransportSessions !== 0 || phase.drain.at < phase.endedAt) reasons.push("Server peer drain not confirmed at zero");
  if (campaign.runs.filter((run) => phase.runIds.includes(run.id)).some((run) => run.metrics.some((metric) => metric.id === "campaign.scene-failure" || metric.transportState === "failed"))) reasons.push("Runtime failure evidence retained");
  return { expected, worked, reasons };
}
/** Evidence of activity in the shared browser-clock window, independently recomputed after import. */
export function campaignOverlap(campaign: SecureCampaign): { observed: boolean; windowMs: number; timingBasis: string; axes: { axis: string; observations: number; delta: number | null }[]; reasons: string[] } {
  const phase = campaign.phases.find((value) => value.id === "combined");
  if (!phase || phase.barrierAt === null) return { observed: false, windowMs: 0, timingBasis: "No shared observation window", axes: [], reasons: ["Combined ready barrier absent"] };
  const begin = phase.barrierAt; const end = phase.endedAt; const runs = campaign.runs.filter((run) => phase.runIds.includes(run.id) && run.configuration.axes['campaignPhase'] === phase.id && ["desktop-browser", "browser-unverified", "quest-browser"].includes(run.provenance));
  const observations = (id: string, measured = true) => runs.flatMap((run) => run.metrics.filter((metric) => metric.id === id && metric.clockDomain === "browser-monotonic" && (!measured || metric.kind === "measured")).flatMap((metric) => metric.samples)).filter((sample) => sample.valid && !sample.disjoint && !sample.placeholder && sample.value !== null && sample.at >= begin && sample.at <= end).sort((a, b) => a.at - b.at);
  const renders = observations("campaign.render-cpu-submission");
  const audio = observations("audio.worklet.processed-blocks");
  const commonStart = Math.max(begin, renders[0]?.at ?? end, audio[0]?.at ?? end);
  const commonEnd = Math.min(end, renders.at(-1)?.at ?? begin, audio.at(-1)?.at ?? begin);
  const expected = phaseEvidence(campaign, phase).expected;
  const axes = expected.map((axis) => {
    const semantic = axis === "render" ? "campaign.render-cpu-submission" : axis === "assets" ? "campaign.asset-imagebitmap-decode" : axis === "audio" ? "audio.worklet.processed-blocks" : `transport.${axis}.rtt`;
    const samples = axisObservations(campaign, phase, axis).filter((sample) => sample.at >= commonStart && sample.at <= commonEnd);
    const delta = axis === "audio" && samples.length > 1 ? Number(samples.at(-1)?.value) - Number(samples[0]?.value) : null;
    return { axis, observations: samples.length, delta };
  });
  const reasons = [...phaseEvidence(campaign, phase).reasons, ...axes.flatMap((axis) => axis.observations < (axis.axis === "audio" || axis.axis === "render" ? 2 : 1) || (axis.axis === "audio" && (axis.delta ?? 0) <= 0) ? [`No in-window ${axis.axis} processing observations`] : [])];
  if (commonEnd <= commonStart) reasons.push("No shared interval between actual render submissions and worklet counter reports");
  if (!observations("campaign.asset-gpu-upload-submit", false).some((sample) => sample.at >= commonStart && sample.at <= commonEnd)) reasons.push("No asset texture upload submitted inside shared interval");
  if (phase.drain.state !== "confirmed") reasons.push("Combined server peer drain unconfirmed");
  if (phase.status !== "completed") reasons.push(`Combined phase ${phase.status}`);
  if (end - begin < campaign.settings.durationMs * 0.9) reasons.push("Combined observation duration incomplete");
  return { observed: reasons.length === 0 && axes.length > 0, windowMs: end - begin, timingBasis: "Browser sample/receipt clock. Worklet render-clock and network one-way intervals are not independently synchronized; this is shared-window software activity, not physical simultaneity or latency.", axes, reasons };
}
