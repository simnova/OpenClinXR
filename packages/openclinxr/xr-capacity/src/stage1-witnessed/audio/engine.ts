import { WITNESSED_AUDIO_CONFIG as CONFIG, WITNESSED_AUDIO_MEMORY, WITNESSED_TARGET_WORKLET_SHA256, witnessedAudioConfigHash, sha256AudioBytes } from "./config.js";
import { WitnessRecorder, readWitnessCounters } from "./witness-recorder.js";
import { WITNESS_WORKLET_PROCESSOR } from "./witness-worklet.js";
import { AudioWindowRecorder, AUDIO_ROW_WIDTH, readAudioCounters } from "../../stage1/audio/recorder.js";
import { DUPLEX_WORKLET_PROCESSOR } from "../../stage1/audio/worklet.js";
import type { AudioMarkAck, AudioMarkLabel, AudioNodeLatch } from "../../stage1/audio/types.js";
import type { WitnessedAudioHandle, WitnessedAudioRecord, PrepareWitnessedAudioOptions } from "./types.js";
export class WitnessedAudioPreparationError extends Error {
  constructor(message: string, readonly record: WitnessedAudioRecord) { super(message); this.name = "WitnessedAudioPreparationError"; }
}
const nodes = ["input", "output"] as const;
type NodeName = typeof nodes[number];
interface PendingMark { label: AudioMarkLabel; xrReceiptMs: number; sentMs: number; results: Partial<Record<NodeName, AudioNodeLatch>>; resolve(value: AudioMarkAck): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
interface WorkletWire { type?: unknown; firstEight?:unknown; lastFrameStart?:unknown; gaps?:unknown; attachSeen?:unknown; ordinal?:unknown; sequence?: unknown; counters?: unknown; rows?: unknown; frame?: unknown; id?: unknown; reason?: unknown; expected?: unknown; actual?: unknown; quantum?: unknown; highWater?: unknown; coalesced?: unknown; overflow?: unknown }
const finiteOrNull = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
async function boundedSource(response: Response): Promise<ArrayBuffer> {
  if (Number(response.headers.get("content-length")) > 32768 || !response.body) throw new Error("Worklet source byte budget exceeded");
  const reader = response.body.getReader(), storage = new Uint8Array(32768); let used = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break;
    if (used + part.value.byteLength > storage.byteLength) { await reader.cancel(); throw new Error("Worklet source byte budget exceeded"); }
    storage.set(part.value, used); used += part.value.byteLength;
  } } finally { reader.releaseLock(); }
  return storage.buffer.slice(0, used);
}
/** Trusted media-prepare click only. Permissions finish before the caller requests XR. */
export async function prepareWitnessedDuplexAudio(options: PrepareWitnessedAudioOptions): Promise<WitnessedAudioHandle> {
  const started = performance.now(), created = { tracks: 0, contexts: 0, nodes: 0, ports: 0, oscillators: 0 };
  const witness = new WitnessRecorder(); let witnessNode:AudioWorkletNode|undefined; let primingResolve:(()=>void)|undefined; const priming=new Promise<void>(resolve=>{primingResolve=resolve;}); let witnessFinalResolve:(()=>void)|undefined; const witnessFinal=new Promise<void>(resolve=>{witnessFinalResolve=resolve;});
  const remaining = { ...created }, input = new AudioWindowRecorder(), output = new AudioWindowRecorder();
  const records = { input, output }, timers = new Set<ReturnType<typeof setTimeout>>(), pending = new Map<number, PendingMark>();
  const audioNodes: AudioNode[] = [], processors: Partial<Record<NodeName, AudioWorkletNode>> = {}, listeners: Array<() => void> = [];
  const record: WitnessedAudioRecord = {
    schema: "quest-stage1-witnessed-audio.v1",
    source: { runtime: "actual-browser-webaudio", input: options.inputClass ?? "actual-microphone", output: "generated-sine", physicalOutputVerified: false,
      runNonce: options.runNonce, timeOriginMs: performance.timeOrigin, workletUrl: options.workletUrl, workletSha256: null, expectedWorkletSha256: options.expectedWorkletSha256, configSha256: null, witnessWorkletUrl:options.witnessWorkletUrl, expectedWitnessWorkletSha256:options.expectedWitnessWorkletSha256,witnessWorkletSha256:null },
    config: { ...CONFIG }, witness:witness.snapshot(), ownership: { factoryInvoked: true, created, remaining },
    actual: { sampleRate: null, trackSettings: null, trackConstraints: null, observedAtMs: null, observationMeaning: "latest-pre-stop-state", trackLabel: null, trackLive: false, trackEnabled: false, trackMuted: false, contextState: null },
    preparation: { startedMs: started, setupStartedMs:null,setupDeadlineMs:null, captureGrantedMs: null, contextRunningMs: null, bootstrapStartedMs: null, bootstrapDisconnectedMs: null, graphActivatedMs: null, readyMs: null, inputReadyAck: null, outputReadyAck: null }, timing: { contextCreatedMs: started, stopRequestedMs: null, stoppedMs: null },
    processorErrors: 0, marks: [], input: input.snapshot(), output: output.snapshot(), queue: { highWater: 0, coalesced: 0, dropped: 0, rejected: 0, storageOverflow: 0, maximumPayloadBytes: 0 }, events: [],
    latency: { baseLatencySeconds: null, outputLatencySeconds: null, physicalRttMs: null, outputTimestamps: [] },
    memory: {ownedTypedBytes:WITNESSED_AUDIO_MEMORY.ownedTypedBytes,capBytes:WITNESSED_AUDIO_MEMORY.capBytes,maximumKnownPayloadBytes:WITNESSED_AUDIO_MEMORY.maximumKnownPayloadBytes,rawPcmRetainedBytes:0,totalHeapMeasured:false,ledger:{...WITNESSED_AUDIO_MEMORY}},
    cleanup: { stopAckReceived: false, tracksStopped: false, portsClosed: false, nodesDisconnected: false, contextClosed: false, urlsRevoked: false,
      remaining: { tracks: 0, ports: 0, nodes: 0, contexts: 0, listeners: 0, timers: 0, pendingMarks: 0 } },
    outcome: "preparing", reason: null, windowScope: "prepared-audio-through-post-XR-stop; broader-than-XR-window",
  };
  let context: AudioContext | undefined, stream: MediaStream | undefined, oscillator: OscillatorNode | undefined, gain: GainNode | undefined;
  let moduleUrl: string | undefined, stopPromise: Promise<WitnessedAudioRecord> | undefined, stopping = false, markId = 0;
  let faulting = false; let xrEntryTimer: ReturnType<typeof setTimeout> | undefined; const local = new AbortController();
  const coalescedByNode = { input: 0, output: 0 };
  const first: Partial<Record<NodeName, AudioNodeLatch>> = {}; const finalResolvers: Partial<Record<NodeName, () => void>> = {};
  let readinessResolve: (() => void) | undefined; const readiness = new Promise<void>((resolve) => { readinessResolve = resolve; });
  const finals = nodes.map((name) => new Promise<void>((resolve) => { finalResolvers[name] = resolve; }));
  function timer(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t;
  }
  function clear(t: ReturnType<typeof setTimeout> | undefined): void { if (t) { clearTimeout(t); timers.delete(t); } }
  function event(type: string, detail: string): void {
    if (record.events.length < 128) record.events.push({ atMs: performance.now(), type, detail });
    else if (!stopping && !faulting) fault("Audio lifecycle event budget exhausted");
  }
  function fault(reason: string): void {
    if (faulting) return; faulting = true;
    if (stopping) { record.outcome = "failed"; record.reason = reason; return; } record.outcome = "failed"; record.reason = reason; event("fault", reason);
    try { options.onFault?.(reason); } catch { /* Caller cannot prevent teardown. */ }
    void stop(reason);
  }
  function observe(): void {
    if (!context) return;
    record.actual.observedAtMs = performance.now(); record.actual.contextState = context.state; record.latency.baseLatencySeconds = finiteOrNull(context.baseLatency);
    record.latency.outputLatencySeconds = finiteOrNull(context.outputLatency);
    if (record.latency.outputTimestamps.length < 8) {
      const atMs = performance.now(), currentTime = context.currentTime; let stamp: AudioTimestamp | undefined;
      try { stamp = context.getOutputTimestamp?.(); } catch { /* Unsupported estimate stays null. */ }
      record.latency.outputTimestamps.push({ atMs, afterMs: performance.now(), currentTime,
        contextTime: finiteOrNull(stamp?.contextTime), performanceTime: finiteOrNull(stamp?.performanceTime), state: context.state });
    }
    const track = stream?.getAudioTracks()[0];
    if (track) { record.actual.trackLive = track.readyState === "live"; record.actual.trackEnabled = track.enabled; record.actual.trackMuted = track.muted; }
  }
  function snapshot(): WitnessedAudioRecord {
    record.input = input.snapshot(); record.output = output.snapshot(); record.witness=witness.snapshot();
    record.queue.rejected = input.rejected + output.rejected+witness.record.rejected; record.queue.storageOverflow = input.overflow + output.overflow+witness.record.overflow;
    record.cleanup.remaining = { ...remaining, listeners: listeners.length, timers: timers.size, pendingMarks: pending.size };
    return structuredClone(record);
  }
  function wait<T>(promise: Promise<T>, ms: number, reason: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const abort = () => { clear(t); local.signal.removeEventListener("abort", abort); reject(new Error(record.reason ?? "Audio cancelled")); };
      const t = timer(() => { local.signal.removeEventListener("abort", abort); reject(new Error(reason)); }, ms);
      local.signal.addEventListener("abort", abort, { once: true });
      if (local.signal.aborted) abort();
      promise.then((value) => { clear(t); local.signal.removeEventListener("abort", abort); resolve(value); }, (error: unknown) => { clear(t); local.signal.removeEventListener("abort", abort); reject(error); });
    });
  }
  async function stop(reason = "Stopped by caller"): Promise<WitnessedAudioRecord> {
    if (stopPromise) return stopPromise;
    stopping = true; record.timing.stopRequestedMs = performance.now(); const stopDeadline=record.timing.stopRequestedMs+CONFIG.drainDeadlineMs; record.reason ??= reason; observe(); event("stop-requested", reason);
    local.abort();
    stopPromise = (async () => {
      for (const t of timers) clearTimeout(t); timers.clear();
      for (const command of pending.values()) command.reject(new Error("Audio stopped before required mark ACK")); pending.clear();
      try {
        if (gain && gain.gain.value > 0 && context?.state === "running") { gain.gain.cancelScheduledValues(context.currentTime); gain.gain.setValueAtTime(gain.gain.value, context.currentTime); gain.gain.linearRampToValueAtTime(0, context.currentTime + CONFIG.rampSeconds); await new Promise<void>((resolve) => timer(resolve, 30)); }
        for (const name of nodes) processors[name]?.port.postMessage({ type: "stop" });
        if (nodes.every((name) => processors[name])) {
          let deadline: ReturnType<typeof setTimeout> | undefined;
          const drained = await Promise.race([Promise.all(finals).then(() => true), new Promise<false>((resolve) => { deadline = timer(() => resolve(false), Math.max(1,stopDeadline-performance.now()-600)); })]); clear(deadline);
          record.cleanup.stopAckReceived = drained;
          if (!drained) { if (record.outcome !== "failed") record.reason = "Final worklet drain deadline exceeded"; record.outcome = "failed"; }
        } else record.cleanup.stopAckReceived = nodes.every(name=>!processors[name]);
        if(witnessNode){witnessNode.port.postMessage({type:"stop"});let deadline:ReturnType<typeof setTimeout>|undefined;
          const drained=await Promise.race([witnessFinal.then(()=>true),new Promise<false>(resolve=>{deadline=timer(()=>resolve(false),Math.max(1,stopDeadline-performance.now()-300));})]);clear(deadline);
          record.cleanup.stopAckReceived=record.cleanup.stopAckReceived&&drained;if(!drained){record.outcome="failed";record.reason??="Witness final drain deadline exceeded";}
        }
      } catch (error) { record.outcome = "failed"; record.reason = error instanceof Error ? error.message : "Audio drain failed"; }
      try { oscillator?.stop(); } catch { /* Already stopped. */ } remaining.oscillators = 0;
      for (const track of stream?.getTracks() ?? []) track.stop(); remaining.tracks = (stream?.getTracks() ?? []).filter((t) => t.readyState !== "ended").length;
      record.cleanup.tracksStopped = remaining.tracks === 0;
      for (const remove of listeners.splice(0)) remove();
      for (const node of audioNodes) { try { node.disconnect(); remaining.nodes--; } catch { /* Keep remaining count if disconnect failed. */ } }
      record.cleanup.nodesDisconnected = remaining.nodes === 0;
      for (const name of nodes) { const processor = processors[name]; if (processor) { processor.onprocessorerror = null; processor.port.onmessage = null; processor.port.close(); remaining.ports--; } }
      if(witnessNode){witnessNode.onprocessorerror=null;witnessNode.port.onmessage=null;witnessNode.port.close();remaining.ports--;}
      record.cleanup.portsClosed = remaining.ports === 0;
      if (moduleUrl) { URL.revokeObjectURL(moduleUrl); moduleUrl = undefined; } record.cleanup.urlsRevoked = true;
      if (context) {
        let deadline: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([context.close(), new Promise<void>((resolve) => { deadline = timer(resolve, Math.max(1,Math.min(250,stopDeadline-performance.now()))); })]); } catch { /* State below remains authoritative. */ }
        clear(deadline); remaining.contexts = context.state === "closed" ? 0 : 1;
      }
      record.cleanup.contextClosed = remaining.contexts === 0;
      for (const t of timers) clearTimeout(t); timers.clear();
      if (record.outcome !== "failed") record.outcome = "stopped";
      if (Object.values(remaining).some((n) => n !== 0)) { record.outcome = "failed"; record.reason = "Owned audio resources remain after cleanup"; }
      record.timing.stoppedMs = performance.now(); event("stopped", record.outcome);
      return snapshot();
    })();
    return stopPromise;
  }
  function received(name: NodeName, value: unknown): void {
    if (!value || typeof value !== "object") { records[name].rejected++; fault("Malformed worklet message"); return; }
    const data = value as WorkletWire, recorder = records[name];
    if (data.type === "clock-gap") { event("clock-gap", JSON.stringify({ name, expected: data.expected, actual: data.actual, quantum: data.quantum, atContextTime: context?.currentTime })); return; }
    if (data.type === "fault") { fault(`Worklet ${name}: ${String(data.reason)}`); return; }
    if (data.type === "report") {
      if (!recorder.acceptBatch(data.rows)) { fault("Invalid/overflowed audio health rows"); return; }
      record.queue.maximumPayloadBytes = Math.max(record.queue.maximumPayloadBytes, (data.rows as Float64Array).byteLength);
      record.queue.highWater = Math.max(record.queue.highWater, Number(data.highWater));
      if (!Number.isSafeInteger(data.coalesced) || Number(data.coalesced) < 0 || data.highWater !== 1 || data.overflow !== 0) { fault("Invalid worklet queue accounting"); return; }
      coalescedByNode[name] = Number(data.coalesced); record.queue.coalesced = coalescedByNode.input + coalescedByNode.output+witness.record.coalesced;
      const batch = data.rows as Float64Array;
      for (let at = 0; at < batch.length; at += AUDIO_ROW_WIDTH) { if ((batch[at + 1] === 1 || batch[at + 1] === 2) && batch[at + 2] === 0 && batch[at + 11] === 0) fault(`Audio ${name} complete-bin activity absent`); }
      processors[name]?.port.postMessage({ type: "ack", sequence: data.sequence });
    }
    if (["report", "first", "final"].includes(String(data.type))) {
      const counters = readAudioCounters(data.counters);
      if (!counters) { recorder.rejected++; fault("Invalid worklet counters"); return; }
      recorder.counters = counters;
      if (!stopping) { const t = stream?.getAudioTracks()[0]; if (context?.state !== "running" || !t || t.readyState !== "live" || !t.enabled || t.muted) fault("Capture/context liveness lost"); }
      if (data.type === "first" && (witness.record.receivedFrontierFrameStart===null||counters.frameStart<witness.record.receivedFrontierFrameStart))fault(`Audio ${name} first tag precedes received witness frontier`);
      if (data.type === "first") { recorder.firstWorkReceivedMs = performance.now(); first[name] = { frame: Number(data.frame), counters }; event("first-work", name); }
      if (data.type === "final") { recorder.finalReceived = data.rows === recorder.rows; if (!recorder.finalReceived) { fault("Incomplete final audio rows"); } finalResolvers[name]?.(); }
      if (!stopping && (counters.frameDiscontinuities || counters.sampleRateChanges || counters.nonfiniteSamples || counters.missingInputBlocks || counters.clipSamples || counters.zeroOutputNonzeroSamples)) fault(`Audio ${name} integrity failure`);
      if (!stopping && first.input && first.output && input.counters.nonzeroSamples > 0 && output.counters.nonzeroSamples > 0 && input.rows && output.rows) readinessResolve?.();
    }
    if (data.type === "mark") {
      const command = pending.get(Number(data.id)), counters = readAudioCounters(data.counters);
      if (!command || command.results[name] || !counters || !Number.isSafeInteger(data.frame) || data.frame !== counters.frameEnd) { if (!stopping) fault("Unexpected worklet phase ACK"); return; }
      command.results[name] = { frame: Number(data.frame), counters };
      if (command.results.input && command.results.output) {
        clear(command.timer); pending.delete(Number(data.id));
        const ack: AudioMarkAck = { label: command.label, xrReceiptMs: command.xrReceiptMs, sentMs: command.sentMs, receivedMs: performance.now(), input: command.results.input, output: command.results.output };
        record.marks.push(ack); command.resolve(ack);
      }
    }
  }
  function receivedWitness(value:unknown):void{
    if(!value||typeof value!=="object"){witness.record.rejected++;fault("Malformed witness message");return;}const data=value as WorkletWire;
    if(data.type==="fault"){fault(`Witness: ${String(data.reason)}`);return;}
    if(data.type==="clock-gap"){
      if(witness.record.gaps.length>=8||![data.expected,data.actual,data.quantum,data.ordinal].every(Number.isSafeInteger)){witness.record.rejected++;fault("Witness gap accounting invalid");return;}
      witness.record.gaps.push({expected:Number(data.expected),actual:Number(data.actual),quantum:Number(data.quantum),ordinal:Number(data.ordinal)});event("witness-clock-gap",JSON.stringify(witness.record.gaps.at(-1)));fault("Witness frame continuity failure");return;
    }
    if(data.type==="report"){
      if(!witness.acceptBatch(data.rows)){fault("Invalid/overflowed witness rows");return;}
      if(!Number.isSafeInteger(data.coalesced)||Number(data.coalesced)<0||data.highWater!==1||data.overflow!==0){fault("Invalid witness queue accounting");return;}
      witness.record.coalesced=Number(data.coalesced);witness.record.highWater=1;record.queue.coalesced=coalescedByNode.input+coalescedByNode.output+witness.record.coalesced;
      record.queue.highWater=Math.max(record.queue.highWater,1);record.queue.maximumPayloadBytes=Math.max(record.queue.maximumPayloadBytes,(data.rows as Float64Array).byteLength);witnessNode?.port.postMessage({type:"ack",sequence:data.sequence});
    }
    if(["primed","report","final"].includes(String(data.type))){
      const counters=readWitnessCounters(data.counters);if(!counters){witness.record.rejected++;fault("Invalid witness counters");return;}Object.assign(witness.record,counters);
      if(counters.frameDiscontinuities||counters.sampleRateChanges||counters.nonfiniteOutputSamples||counters.nonzeroOutputSamples)fault("Witness strict processing integrity failure");
      if(data.type==="primed"){
        if(witness.record.primingReceivedMs!==null||!(data.firstEight instanceof Float64Array)||data.firstEight.length!==32){fault("Witness priming shape/repetition");return;}
        const rows:number[][]=[];let previousEnd=counters.frameStart,lastStart=counters.frameStart;
        for(let i=0;i<8;i++){const row=Array.from(data.firstEight.subarray(i*4,i*4+4)),frame=row[1],quantum=row[3];
          if(row[0]!==i||!row.every(Number.isFinite)||typeof frame!=="number"||typeof quantum!=="number"||!Number.isSafeInteger(frame)||!Number.isSafeInteger(quantum)||frame<0||quantum<=0||quantum>16384||frame!==previousEnd){fault("Witness first-eight chronology invalid");return;}
          previousEnd=frame+quantum;lastStart=frame;rows.push(row);
        }
        if(counters.blocks!==8||data.lastFrameStart!==lastStart||counters.frameEnd!==previousEnd){fault("Witness priming frontier mismatch");return;}
        witness.record.firstEight=rows;witness.record.primingReceivedMs=performance.now();witness.record.firstWorkReceivedMs=witness.record.primingReceivedMs;witness.record.receivedFrontierFrameStart=Number(data.lastFrameStart);event("witness-primed",String(data.lastFrameStart));primingResolve?.();
      }
      if(data.type==="final"){
        const gaps=data.gaps;if(!(gaps instanceof Float64Array)||gaps.length!==witness.record.gaps.length*4||gaps.length>32||data.rows!==witness.rows||data.overflow!==0){fault("Witness final accounting mismatch");return;}
        for(let i=0;i<witness.record.gaps.length;i++){const g=witness.record.gaps[i];if(!g||gaps[i*4]!==g.expected||gaps[i*4+1]!==g.actual||gaps[i*4+2]!==g.quantum||gaps[i*4+3]!==g.ordinal){fault("Witness final gap mismatch");return;}}
        const seen=data.attachSeen as {ordinal?:unknown;frame?:unknown}|null;if(seen!==null&&seen!==undefined){if(!Number.isSafeInteger(seen.ordinal)||!Number.isSafeInteger(seen.frame)){fault("Witness attachment latch invalid");return;}witness.record.attachSeen={ordinal:Number(seen.ordinal),frame:Number(seen.frame)};}
        if(witness.record.firstEight.length===0&&data.firstEight instanceof Float64Array){if(data.firstEight.length!==Math.min(8,counters.blocks)*4){fault("Witness partial first-eight shape");return;}for(let i=0;i<data.firstEight.length;i+=4)witness.record.firstEight.push(Array.from(data.firstEight.subarray(i,i+4)));}
        witness.record.finalReceived=true;witness.record.finalReceivedMs=performance.now();witnessFinalResolve?.();
      }
    }
  }
  const externalAbort = () => fault("Audio preparation/run cancelled");
  try {
    if (!options.runNonce || (!/^[a-f0-9]{64}$/i.test(options.expectedWorkletSha256)||!/^[a-f0-9]{64}$/i.test(options.expectedWitnessWorkletSha256))) throw new Error("Audio run nonce and SHA256 are required");
    if(options.expectedWorkletSha256.toLowerCase()!==WITNESSED_TARGET_WORKLET_SHA256)throw new Error("Released target worklet SHA256 required");
    if (options.signal.aborted) throw new Error("Audio cancelled before preparation");
    if (!globalThis.isSecureContext || !globalThis.AudioContext || !globalThis.AudioWorkletNode || !navigator.mediaDevices?.getUserMedia) throw new Error("Secure WebAudio/capture unavailable");
    if (navigator.userActivation?.isActive === false) throw new Error("Explicit media-prepare gesture required");
    context = new AudioContext({ latencyHint: CONFIG.latencyHint, sampleRate: CONFIG.sampleRateRequested }); created.contexts++; remaining.contexts++;
    gain = context.createGain(); gain.gain.value = 0;
    oscillator = context.createOscillator(); oscillator.frequency.value = CONFIG.frequencyHz; oscillator.type = "sine";
    oscillator.connect(gain); gain.connect(context.destination); oscillator.start();
    audioNodes.push(gain, oscillator); created.nodes += 2; remaining.nodes += 2; created.oscillators++; remaining.oscillators++;
    record.preparation.bootstrapStartedMs = performance.now(); event("muted-bootstrap-start", `contextTime=${context.currentTime}; gain=0`);
    const resume = context.resume(); void resume.catch(() => {}); // Before the first await, retaining the trusted gesture.
    timer(() => fault("AudioContext lifetime budget exceeded"), CONFIG.contextLifetimeMs);
    options.signal.addEventListener("abort", externalAbort, { once: true }); listeners.push(() => options.signal.removeEventListener("abort", externalAbort));
    const state = () => { observe(); event("context-state", context?.state ?? "missing"); if (record.preparation.graphActivatedMs !== null && context?.state !== "running" && !stopping) fault("Unexpected AudioContext suspension"); };
    context.addEventListener("statechange", state); listeners.push(() => context?.removeEventListener("statechange", state));
    const hidden = () => { if (document.visibilityState === "hidden") fault("Audio page hidden"); };
    document.addEventListener("visibilitychange", hidden); listeners.push(() => document.removeEventListener("visibilitychange", hidden));
    const capturePromise = navigator.mediaDevices.getUserMedia({ audio: { sampleRate: CONFIG.sampleRateRequested, channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
    void capturePromise.then((late) => { if (stopping) for (const track of late.getTracks()) track.stop(); }, () => {});
    stream = await wait(capturePromise, Math.max(1, CONFIG.mediaPermissionDeadlineMs - (performance.now() - started)), "Microphone permission deadline exceeded");
    if (stopping) { for (const t of stream.getTracks()) t.stop(); throw new Error("Late capture after cancellation"); }
    record.preparation.captureGrantedMs = performance.now();
    created.tracks += stream.getTracks().length; remaining.tracks += stream.getTracks().length;
    if (record.preparation.captureGrantedMs - started > CONFIG.mediaPermissionDeadlineMs) {
      for (const track of stream.getTracks()) track.stop(); throw new Error("Microphone permission resolved after preparation deadline");
    }
    record.preparation.setupStartedMs=record.preparation.captureGrantedMs;record.preparation.setupDeadlineMs=record.preparation.captureGrantedMs+CONFIG.graphReadinessDeadlineMs;
    const setupDeadline=timer(()=>fault("Audio setup/readiness total deadline exceeded"),CONFIG.graphReadinessDeadlineMs);
    await wait(resume, Math.max(1, CONFIG.mediaPermissionDeadlineMs - (performance.now() - started)), "AudioContext resume deadline exceeded");
    record.preparation.contextRunningMs = performance.now();if(record.preparation.contextRunningMs-started>CONFIG.mediaPermissionDeadlineMs)throw new Error("AudioContext resume resolved after preparation deadline");
    const track = stream.getAudioTracks()[0];
    if (!track || stream.getAudioTracks().length !== 1 || track.readyState !== "live" || !track.enabled || track.muted || context.state !== "running") throw new Error("Actual live unmuted audio capture/running context required");
    if (record.source.input === "actual-microphone" && /fake|synthetic/i.test(track.label)) throw new Error("Synthetic capture cannot qualify as actual microphone");
    record.actual.sampleRate = context.sampleRate; record.actual.trackSettings = track.getSettings(); record.actual.trackConstraints = track.getConstraints(); record.actual.trackLabel = track.label; observe();
    for (const type of ["ended", "mute", "unmute"] as const) { const handler = () => { observe(); event(`track-${type}`, track.readyState); if (type !== "unmute" && !stopping) fault(`Capture track ${type}`); }; track.addEventListener(type, handler); listeners.push(() => track.removeEventListener(type, handler)); }
    
    async function loadModule(urlText:string,expected:string,kind:"target"|"witness"):Promise<void>{
      if(stopping||!context)throw new Error("Audio stopped before module load");const url=new URL(urlText,location.href);if(url.origin!==location.origin)throw new Error("Worklet must be same-origin");
      const response=await wait(fetch(url,{signal:local.signal}),CONFIG.graphReadinessDeadlineMs,"Worklet source fetch deadline exceeded");if(!response.ok)throw new Error("Worklet source fetch failed");
      const bytes=await wait(boundedSource(response),CONFIG.graphReadinessDeadlineMs,"Worklet source body deadline exceeded");const hash=await wait(sha256AudioBytes(bytes),1000,"Worklet hash deadline exceeded");
      if(hash!==expected.toLowerCase())throw new Error(`${kind} worklet SHA256 mismatch`);if(kind==="target")record.source.workletSha256=hash;else record.source.witnessWorkletSha256=hash;
      if(stopping)throw new Error("Audio stopped before addModule");moduleUrl=URL.createObjectURL(new Blob([bytes],{type:"text/javascript"}));await wait(context.audioWorklet.addModule(moduleUrl),CONFIG.graphReadinessDeadlineMs,"Worklet module deadline exceeded");URL.revokeObjectURL(moduleUrl);moduleUrl=undefined;
    }
    // Explicit sequential order matches the source-bound successful diagnostic.
    await loadModule(options.workletUrl,options.expectedWorkletSha256,"target");if(stopping)throw new Error("Audio stopped after target module");
    await loadModule(options.witnessWorkletUrl,options.expectedWitnessWorkletSha256,"witness");if(stopping)throw new Error("Audio stopped after witness module");
    record.source.configSha256=await wait(witnessedAudioConfigHash(),1000,"Configuration hash deadline exceeded");if(stopping)throw new Error("Audio stopped before witness construction");
    witness.record.createdMs=performance.now();
    witnessNode=new AudioWorkletNode(context,WITNESS_WORKLET_PROCESSOR,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1]});audioNodes.push(witnessNode);created.nodes++;remaining.nodes++;created.ports++;remaining.ports++;
    witnessNode.port.onmessage=(e:MessageEvent<unknown>)=>receivedWitness(e.data);witnessNode.onprocessorerror=()=>{record.processorErrors++;fault("Witness processor error");};witnessNode.connect(context.destination);witness.record.connectedMs=performance.now();record.preparation.graphActivatedMs=witness.record.connectedMs;timer(()=>fault("Audio graph lifetime budget exceeded"),CONFIG.graphLifetimeMs);event("witness-connected",`contextTime=${context.currentTime}`);
    await wait(priming,CONFIG.witness.primingDeadlineMs,"Witness first-eight ACK deadline exceeded");if(stopping)throw new Error("Audio stopped during witness priming");
    witness.record.creationBeforeMs=performance.now();
    for (const name of nodes) {
      const beforeMs=performance.now();
      const node = new AudioWorkletNode(context, DUPLEX_WORKLET_PROCESSOR, { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit", outputChannelCount: [1], processorOptions: { mode: name } });
      witness.record.targetCreation[name]={beforeMs,afterMs:performance.now()};
      processors[name] = node; audioNodes.push(node); created.nodes++; remaining.nodes++; created.ports++; remaining.ports++;
      node.port.onmessage = (e: MessageEvent<unknown>) => received(name, e.data); node.onprocessorerror = () => { record.processorErrors++; fault(`Audio ${name} processor error`); };
    }
    witness.record.creationAfterMs=performance.now();
    const captureNode = context.createMediaStreamSource(stream); audioNodes.push(captureNode); created.nodes++; remaining.nodes++;
    event("graph-connect-start", `contextTime=${context.currentTime}`);
    const inputProcessor = processors.input, outputProcessor = processors.output;
    if (!inputProcessor || !outputProcessor) throw new Error("Audio processor construction incomplete");
    captureNode.connect(inputProcessor); inputProcessor.connect(context.destination);
    gain.disconnect(context.destination); record.preparation.bootstrapDisconnectedMs = performance.now();
    event("muted-bootstrap-disconnected", `contextTime=${context.currentTime}; gain=0`);
    gain.connect(outputProcessor); outputProcessor.connect(context.destination);
    witness.record.targetConnectedMs=performance.now();
    witness.record.attachedSentMs=performance.now();witnessNode.port.postMessage({type:"attached"});
    gain.gain.setValueAtTime(0, context.currentTime); gain.gain.linearRampToValueAtTime(CONFIG.speakerPeak, context.currentTime + CONFIG.rampSeconds); event("graph-connected-bootstrap-oscillator-running", `contextTime=${context.currentTime}`);
    await wait(readiness, CONFIG.graphReadinessDeadlineMs, "Actual processing/quiet input readiness deadline exceeded");
    if (stopping) throw new Error("Audio stopped during readiness");
    if(performance.now()>record.preparation.setupDeadlineMs)throw new Error("Audio readiness resolved after setup deadline");
    clear(setupDeadline);
    if (!first.input || !first.output) throw new Error("Actual first-work ACKs incomplete");
    record.preparation.inputReadyAck = { frame: input.counters.frameEnd, counters: { ...input.counters } };
    record.preparation.outputReadyAck = { frame: output.counters.frameEnd, counters: { ...output.counters } };
    record.preparation.readyMs = performance.now(); record.outcome = "ready"; event("media-ready", "Actual finite/nonzero input and independent generated output observed");
    xrEntryTimer = timer(() => fault("Media-ready to XR creation deadline exceeded"), CONFIG.readyToXRDeadlineMs);
    const mark = (label: AudioMarkLabel, xrReceiptMs: number): Promise<AudioMarkAck> => {
      if (stopping || !Number.isFinite(xrReceiptMs) || pending.size >= 3 || record.marks.length + pending.size >= 3) return Promise.reject(new Error("Audio mark unavailable/budget exceeded"));
      const sentMs = performance.now(); if (xrReceiptMs > sentMs) return Promise.reject(new Error("XR receipt cannot follow mark dispatch"));
      const id = ++markId, phase = label === "warmup-start" ? 1 : label === "sample-start" ? 2 : 3;
      return new Promise((resolve, reject) => { const t = timer(() => { pending.delete(id); reject(new Error("Audio mark ACK deadline exceeded")); fault("Audio mark ACK deadline exceeded"); }, CONFIG.markDeadlineMs);
        pending.set(id, { label, xrReceiptMs, sentMs, results: {}, resolve, reject, timer: t });
        for (const name of nodes) processors[name]?.port.postMessage({ type: "mark", id, phase });
      });
    };
    return { readyMs: record.preparation.readyMs, configuration: { ...CONFIG }, mark, snapshot, stop,
      notifyXRSessionCreated: () => { clear(xrEntryTimer); if (!stopping) { record.outcome = "running"; event("xr-created", "No lifetime budget reset"); } } };
  } catch (error) {
    record.outcome = "failed"; record.reason = error instanceof Error ? error.message : "Audio preparation failed";
    const result = await stop(record.reason); throw new WitnessedAudioPreparationError(record.reason, result);
  }
}
