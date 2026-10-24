export type AudioPhase = "prepared" | "warmup" | "sample" | "ended";
export type AudioMarkLabel = "warmup-start" | "sample-start" | "sample-end";
export interface AudioCounters {
  frameStart: number; frameEnd: number; sampleRate: number; blocks: number; frames: number; channelFrames: number;
  finiteSamples: number; nonfiniteSamples: number; nonzeroSamples: number; sumSquares: number; peak: number;
  clipSamples: number; missingInputBlocks: number; frameDiscontinuities: number; quantumMin: number; quantumMax: number;
  sampleRateChanges: number; zeroOutputNonzeroSamples: number;
}
export interface AudioHealthWindow extends AudioCounters { sequence: number; phase: AudioPhase; partial: boolean }
export interface AudioNodeLatch { frame: number; counters: AudioCounters }
export interface AudioMarkAck {
  label: AudioMarkLabel; xrReceiptMs: number; sentMs: number; receivedMs: number;
  input: AudioNodeLatch; output: AudioNodeLatch;
}
export interface AudioNodeRecord extends AudioCounters {
  windows: AudioHealthWindow[]; finalReceived: boolean; firstWorkReceivedMs: number | null;
}
export interface DuplexAudioRecord {
  schema: "quest-stage1-duplex-audio.v1";
  source: { runtime: "actual-browser-webaudio"; input: "actual-microphone" | "synthetic-host"; output: "generated-sine";
    physicalOutputVerified: false; runNonce: string; timeOriginMs: number; workletUrl: string;
    workletSha256: string | null; expectedWorkletSha256: string; configSha256: string | null };
  config: DuplexAudioConfiguration; ownership: DuplexAudioOwnership;
  actual: { sampleRate: number | null; trackSettings: MediaTrackSettings | null; trackConstraints: MediaTrackConstraints | null;
    observedAtMs: number | null; observationMeaning: "latest-pre-stop-state"; trackLabel: string | null; trackLive: boolean; trackEnabled: boolean; trackMuted: boolean; contextState: string | null };
  preparation: { startedMs: number; captureGrantedMs: number | null; contextRunningMs: number | null; bootstrapStartedMs: number | null; bootstrapDisconnectedMs: number | null; graphActivatedMs: number | null; readyMs: number | null;
    inputReadyAck: AudioNodeLatch | null; outputReadyAck: AudioNodeLatch | null };
  timing: { contextCreatedMs: number; stopRequestedMs: number | null; stoppedMs: number | null };
  processorErrors: number;
  marks: AudioMarkAck[]; input: AudioNodeRecord; output: AudioNodeRecord;
  queue: { highWater: number; coalesced: number; dropped: number; rejected: number; storageOverflow: number; maximumPayloadBytes: number };
  events: Array<{ atMs: number; type: string; detail: string }>;
  latency: { baseLatencySeconds: number | null; outputLatencySeconds: number | null; physicalRttMs: null;
    outputTimestamps: Array<{ atMs: number; afterMs: number; currentTime: number; contextTime: number | null; performanceTime: number | null; state: string }> };
  memory: { ownedTypedBytes: number; capBytes: number; maximumKnownPayloadBytes: number; rawPcmRetainedBytes: 0; totalHeapMeasured: false };
  cleanup: { stopAckReceived: boolean; tracksStopped: boolean; portsClosed: boolean; nodesDisconnected: boolean; contextClosed: boolean; urlsRevoked: boolean;
    remaining: { tracks: number; ports: number; nodes: number; contexts: number; listeners: number; timers: number; pendingMarks: number } };
  outcome: "preparing" | "ready" | "running" | "stopped" | "failed"; reason: string | null;
  windowScope: "prepared-audio-through-post-XR-stop; broader-than-XR-window";
}
export interface DuplexAudioConfiguration {
  construction: "muted-oscillator-bootstrap-before-permission";
  sampleRateRequested: 48000; channelCountRequested: 1; latencyHint: "interactive";
  echoCancellation: false; noiseSuppression: false; autoGainControl: false;
  frequencyHz: 440; speakerPeak: 0.002; rampSeconds: 0.025; reportSeconds: 0.5;
  maximumRowsPerNode: 512; mediaPermissionDeadlineMs: 30000; graphReadinessDeadlineMs: 10000;
  readyToXRDeadlineMs: 30000; graphLifetimeMs: 150000; contextLifetimeMs: 180000; drainDeadlineMs: 5000; markDeadlineMs: 1000;
}
export interface PrepareDuplexAudioOptions {
  signal: AbortSignal; runNonce: string; workletUrl: string; expectedWorkletSha256: string;
  inputClass?: "actual-microphone" | "synthetic-host"; onFault?: (reason: string) => void;
}
export interface DuplexAudioHandle {
  readonly readyMs: number; readonly configuration: DuplexAudioConfiguration;
  mark(label: AudioMarkLabel, xrReceiptMs: number): Promise<AudioMarkAck>;
  /** Call on successful requestSession resolution; it does not reset any watchdog. */
  notifyXRSessionCreated(): void;
  snapshot(): DuplexAudioRecord;
  stop(reason?: string): Promise<DuplexAudioRecord>;
}
export interface DuplexAudioResources { tracks: number; contexts: number; nodes: number; ports: number; oscillators: number }
export interface DuplexAudioOwnership { factoryInvoked: boolean; created: DuplexAudioResources; remaining: DuplexAudioResources }
