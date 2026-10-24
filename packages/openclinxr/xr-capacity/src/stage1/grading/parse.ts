import type { Stage1Record } from "./types.js";

type JsonObject = Record<string, unknown>;
const fail = (path: string): never => { throw new Error(`Invalid Stage1 record: ${path}`); };
function object(value: unknown, path: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fail(path);
  return value as JsonObject;
}
function array(value: unknown, path: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) return fail(path);
  return value;
}
function exactKeys(o: JsonObject, path: string, names: string) {
  if (Object.keys(o).some(k => !names.split(" ").includes(k))) fail(`${path}.unknown-field`);
}
function fields(value: unknown, path: string, numericFields = "", strings = "", booleans = "", nullableNumbers = "") {
  const o = object(value, path);
  for (const k of numericFields.split(" ").filter(Boolean)) if (typeof o[k] !== "number" || !Number.isFinite(o[k])) fail(`${path}.${k}`);
  for (const k of strings.split(" ").filter(Boolean)) if (typeof o[k] !== "string") fail(`${path}.${k}`);
  for (const k of booleans.split(" ").filter(Boolean)) if (typeof o[k] !== "boolean") fail(`${path}.${k}`);
  for (const k of nullableNumbers.split(" ").filter(Boolean)) if (o[k] !== null && (typeof o[k] !== "number" || !Number.isFinite(o[k]))) fail(`${path}.${k}`);
  return o;
}
function numbers(value: unknown, path: string, maximum: number) {
  if (!array(value, path, maximum).every(n => typeof n === "number" && Number.isFinite(n))) fail(path);
}
function counts(value: unknown, path: string) { fields(value, path, "tracks contexts nodes ports oscillators"); }
const counterFields = "frameStart frameEnd sampleRate blocks frames channelFrames finiteSamples nonfiniteSamples nonzeroSamples sumSquares peak clipSamples missingInputBlocks frameDiscontinuities quantumMin quantumMax sampleRateChanges zeroOutputNonzeroSamples";
function latch(value: unknown, path: string) { const o = fields(value, path, "frame"); exactKeys(o, path, "frame counters"); const c = fields(o["counters"], `${path}.counters`, counterFields); exactKeys(c, `${path}.counters`, counterFields); }
function node(value: unknown, path: string) {
  const o = fields(value, path, counterFields, "", "finalReceived", "firstWorkReceivedMs");
  exactKeys(o, path, `${counterFields} windows finalReceived firstWorkReceivedMs`);
  for (const [i, row] of array(o["windows"], `${path}.windows`, 512).entries()) { const w = fields(row, `${path}.windows[${i}]`, `${counterFields} sequence`, "phase", "partial"); exactKeys(w, path, `${counterFields} sequence phase partial`); }
}
function xr(value: unknown) {
  const o = fields(value, "xr", "", "schema purpose phase status", "", "requestedAt admittedAt watchdogDeadline warmupStart sampleStart sampleEnd endedAt");
  fields(o["identity"], "xr.identity", "", "bundleSha256 protocolSha256 sceneManifestSha256 nonce");
  if (o["releaseId"] !== null && typeof o["releaseId"] !== "string") fail("xr.releaseId");
  if (o["profile"] !== null) {
    const p = fields(o["profile"], "xr.profile", "selectedTargetHz layerWidth layerHeight foveationRequested framebufferScaleRequested", "targetSelection layerKind", "", "rawSessionFrameRate actualSessionFrameRate foveationReadback configuredSamples boundFramebufferSamples");
    numbers(p["supportedFrameRates"], "xr.profile.supportedFrameRates", 32);
    for (const viewport of array(p["viewports"], "xr.profile.viewports", 8)) numbers(viewport, "xr.profile.viewport", 4);
    object(p["contextAttributes"], "xr.profile.contextAttributes");
    if (p["enabledFeatures"] !== null && !array(p["enabledFeatures"], "xr.profile.enabledFeatures", 64).every(v => typeof v === "string")) fail("xr.profile.enabledFeatures");
    if (!array(p["availabilityMask"], "xr.profile.availabilityMask", 64).every(v => typeof v === "string")) fail("xr.profile.availabilityMask");
  }
  for (const [i, row] of array(o["frames"], "xr.frames", 14000).entries()) {
    const f = fields(row, `xr.frames[${i}]`, "receipt xrTimestamp phase updateMs submissionMs collectorMs observedBodyMs viewCount renderCalls triangles programs geometries textures stateFrame", "", "poseValid presenting visible contextLost");
    numbers(f["head"], "xr.frame.head", 7); numbers(f["viewMatrices"], "xr.frame.viewMatrices", 64);
  }
  for (const e of array(o["events"], "xr.events", 128)) fields(e, "xr.event", "at", "type detail");
  if (!array(o["failureReasons"], "xr.failureReasons", 128).every(v => typeof v === "string")) fail("xr.failureReasons");
  const resources = fields(o["resources"], "xr.resources", "ownerBefore ownerAfter");
  for (const k of ["emptyBefore", "roomWarm", "emptyAfter"]) if (resources[k] !== null) fields(resources[k], `xr.resources["$"]{k}`, "geometries textures programs");
  const proofs = object(o["proofs"], "xr.proofs");
  for (const k of ["preview", "afterSample"]) if (proofs[k] !== null) {
    const p = fields(proofs[k], `xr.proofs["$"]{k}`, "at nonBackgroundPixels testedPixels", "source", "", "xrTimestamp");
    if (p["image"] !== null && (typeof p["image"] !== "string" || p["image"].length > 600000)) fail("xr.proof.image");
    if (p["reason"] !== null && typeof p["reason"] !== "string") fail("xr.proof.reason"); numbers(p["viewport"], "xr.proof.viewport", 4);
  }
  fields(o["cleanup"], "xr.cleanup", "workloadListeners workloadTimers controlListeners controlTimers animationCallbacks queries", "", "sessionEnded rendererDisposed layerStable roomResourcesDisposed");
  fields(o["clock"], "xr.clock", "diagnosticReads", "primary secondary", "cpuZerosAreQuantized", "resolutionMs");
  fields(o["storage"], "xr.storage", "maximumFrames preallocatedBytes retainedFrames", "", "overflow released");
  object(o["gpu"], "xr.gpu"); array(o["limitations"], "xr.limitations", 128);
}
function audio(value: unknown) {
  const o = fields(value, "audio", "processorErrors", "schema outcome windowScope");
  exactKeys(o, "audio", "schema source config ownership actual preparation timing processorErrors marks input output queue events latency memory cleanup outcome reason windowScope");
  fields(o["source"], "audio.source", "timeOriginMs", "runtime input output runNonce workletUrl expectedWorkletSha256", "physicalOutputVerified");
  exactKeys(object(o["source"], "audio.source"), "audio.source", "runtime input output physicalOutputVerified runNonce timeOriginMs workletUrl workletSha256 expectedWorkletSha256 configSha256");
  const actual = fields(o["actual"], "audio.actual", "", "observationMeaning", "trackLive trackEnabled trackMuted", "sampleRate observedAtMs");
  if (actual["trackSettings"] !== null) {
    const settings = object(actual["trackSettings"], "audio.actual.trackSettings");
    if (!Object.values(settings).every(v => typeof v === "string" || typeof v === "boolean" || typeof v === "number" && Number.isFinite(v))) fail("audio.actual.trackSettings.scalar-values");
  }
  if (actual["trackConstraints"] !== null) object(actual["trackConstraints"], "audio.actual.trackConstraints");
  object(o["config"], "audio.config");
  const ownership = fields(o["ownership"], "audio.ownership", "", "", "factoryInvoked");
  counts(ownership["created"], "audio.ownership.created"); counts(ownership["remaining"], "audio.ownership.remaining");
  const preparation = fields(o["preparation"], "audio.preparation", "startedMs", "", "", "captureGrantedMs contextRunningMs bootstrapStartedMs bootstrapDisconnectedMs graphActivatedMs readyMs");
  for (const k of ["inputReadyAck", "outputReadyAck"]) if (preparation[k] !== null) latch(preparation[k], `audio.preparation["$"]{k}`);
  fields(o["timing"], "audio.timing", "contextCreatedMs", "", "", "stopRequestedMs stoppedMs");
  for (const row of array(o["marks"], "audio.marks", 3)) { const m = fields(row, "audio.mark", "xrReceiptMs sentMs receivedMs", "label"); latch(m["input"], "audio.mark.input"); latch(m["output"], "audio.mark.output"); }
  node(o["input"], "audio.input"); node(o["output"], "audio.output");
  fields(o["queue"], "audio.queue", "highWater coalesced dropped rejected storageOverflow maximumPayloadBytes");
  for (const e of array(o["events"], "audio.events", 256)) fields(e, "audio.event", "atMs", "type detail");
  const latency = fields(o["latency"], "audio.latency", "", "", "", "baseLatencySeconds outputLatencySeconds");
  for (const t of array(latency["outputTimestamps"], "audio.latency.outputTimestamps", 8)) fields(t, "audio.latency.timestamp", "atMs afterMs currentTime", "state", "", "contextTime performanceTime");
  fields(o["memory"], "audio.memory", "ownedTypedBytes capBytes maximumKnownPayloadBytes rawPcmRetainedBytes", "", "totalHeapMeasured");
  const cleanup = fields(o["cleanup"], "audio.cleanup", "", "", "stopAckReceived tracksStopped portsClosed nodesDisconnected contextClosed urlsRevoked");
  fields(cleanup["remaining"], "audio.cleanup.remaining", "tracks ports nodes contexts listeners timers pendingMarks");
}
/** Structural validation never filters rows, repairs clocks, or trusts a saved verdict. */
export function parseStage1Record(value: unknown): Stage1Record {
  const o = fields(value, "record", "pageTimeOriginMs", "schema mode");
  exactKeys(o, "record", "schema mode slot pageTimeOriginMs xr audio audioOwnership");
  if (o["schema"] !== "quest-stage1-record.v1" || !["off", "duplex"].includes(String(o["mode"]))) fail("schema-or-mode");
  const slot = fields(o["slot"], "slot", "pair position", "nonce");
  if (![1, 2, 3].includes(Number(slot["pair"])) || ![1, 2].includes(Number(slot["position"]))) fail("slot");
  xr(o["xr"]); const ownership = fields(o["audioOwnership"], "audioOwnership", "", "", "factoryInvoked");
  counts(ownership["created"], "audioOwnership.created"); counts(ownership["remaining"], "audioOwnership.remaining");
  if (o["audio"] !== null) audio(o["audio"]);
  return value as Stage1Record;
}
