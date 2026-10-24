import type { Stage2PreInjectionCheckpoint, Stage2ReceiverDecodeEvidence } from "./receiver-contract.js";

/** Timeframes are per-channel temporal frames. Channel samples NEVER measure duration. */
export type Stage2Phase = "setup" | "warmup" | "qualified" | "ended";
export type Stage2Command = "ready" | "warmup" | "start" | "end";
export type Stage2Mode = "positive" | "uplink-only" | "relay-instead-of-independent-return" | "remote-output-disconnected" | "early-peer-close";
export interface Stage2Identity { browserBundleSha256: string; serverSourceSha256: string; protocolSha256: string; fixtureConfigSha256: string; graderSourceSha256: string }
export interface Stage2Binding { runNonce: string; peerTicket: string; uplinkSourceId: string; downlinkSourceId: string }
export interface Stage2Envelope { identity: Stage2Identity; binding: Stage2Binding }
export interface Stage2ClockTag { kind: "worklet-currentFrame" | "decoded-pts" | "generated-pts"; value: number; timeBaseNumerator: number; timeBaseDenominator: number }
/** Origin is FIRST actual process start (processedFrames=0); final is end-exclusive. Raw tags are observed, never inferred from construction. */
export interface Stage2AudioPosition { processedFrames: number; sampleRate: number; channels: number; tag: Stage2ClockTag; atSourceMonotonicMs: number | null }
export interface Stage2Tone {
  analysisChannel: 0; N: number; sumSquares: number;
  real400: number; imag400: number; real700: number; imag700: number; power400: number; power700: number;
}
export interface Stage2Health {
  frames: number; channels: number; channelSamples: number; finiteSamples: number; nonfiniteSamples: number;
  nonzeroSamples: number; sumSquares: number; peak: number; clippedSamples: number; missingFrames: number;
  frameDiscontinuities: number; sampleRateChanges: number; channelChanges: number;
}
export interface Stage2HealthBin extends Stage2Health {
  sequence: number; phase: Stage2Phase; frameStart: number; frameEnd: number; sampleRate: number;
  quantumFirst: number; quantumLast: number; quantumMin: number; quantumMax: number;
  tagStart: Stage2ClockTag; tagEndExclusive: Stage2ClockTag;
  partialReason: null | "phase-boundary" | "final-tail"; tone: Stage2Tone;
}
export interface Stage2RtpDiagnostics { packets: number | null; bytes: number | null; packetsLost: number | null; jitterSeconds: number | null; concealedSamples: number | null }
export interface Stage2DecodedConsumer {
  id: "server-uplink-decoded" | "browser-downlink-monitor"; sourceId: string; clockId: string;
  sampleRate: number | null; channels: number | null; initialQuantum: number | null; targetBinFrames: number | null;
  origin: Stage2AudioPosition | null; final: Stage2AudioPosition | null; total: Stage2Health;
  bins: Stage2HealthBin[]; processorErrors: number; rejected: number; overflow: number;
  firstDecodedAtLocalMs: number | null; firstNonzeroAtLocalMs: number | null;
  format: { name: string; layout: string; planar: boolean | null; projection: "channel-0"; allChannelsChecked: boolean } | null;
  rtp: Stage2RtpDiagnostics;
}
export interface Stage2Source {
  id: string; kind: "browser-generated-worklet" | "server-independent-generator" | "relay" | "absent";
  trackId: string | null; senderTrackId: string | null;
  /** Server generator recv observations ONLY; browser render callbacks use null, never a fictitious sender-pull count. */
  senderDrivenCalls: number | null; unboundCalls: number | null;
  clockId: string | null; initialQuantum: number | null; targetBinFrames: number | null;
  bins: Stage2HealthBin[];
  origin: Stage2AudioPosition | null; final: Stage2AudioPosition | null; total: Stage2Health;
  generatorErrors: number; stopped: boolean;
}
export interface Stage2Latch { markerId: string; command: Stage2Command; phase: Stage2Phase; position: Stage2AudioPosition }
export interface Stage2ServerMarkAck extends Stage2Envelope {
  markerId: string; command: Stage2Command; serverClockId: string; serverAtMs: number;
  uplinkDecoded: Stage2Latch | null; downlinkSource: Stage2Latch | null;
}
export interface Stage2BrowserMarkAck {
  markerId: string; command: Stage2Command; downlinkMonitor: Stage2Latch | null; uplinkSource: Stage2Latch | null;
}
/** sentMs/receivedMs use the SAME browser performance.now/timeOrigin as the client window. */
export interface Stage2MarkExchange {
  markerId: string; command: Stage2Command;
  server: { sentMs: number; receivedMs: number | null; ack: Stage2ServerMarkAck | null };
  browser: { sentMs: number; receivedMs: number | null; ack: Stage2BrowserMarkAck | null };
}
export interface Stage2Codec { mimeType: string; clockRate: number; channels: number | null; payloadType: number | null; sdpFmtpLine: string | null }
export interface Stage2TrackMapping {
  sourceId: string; sourceTrackId: string; senderTrackId: string; senderMid: string | null;
  senderSsrc: number | null; receiverTrackId: string; receiverSdpTrackId: string | null;
  receiverMid: string | null; receiverSsrc: number | null; monitoredTrackId: string | null;
  codec: Stage2Codec | null; senderBindingObserved: boolean; receiverBindingObserved: boolean;
}
export interface Stage2CandidateEndpoint { address: string | null; port: number | null; protocol: string | null; candidateId: string | null; inventoryAddress: string | null }
export interface Stage2SelectedPair { observer: "browser-getStats" | "server-ice-transport"; id: string; state: string; nominated: boolean; local: Stage2CandidateEndpoint; remote: Stage2CandidateEndpoint; observationSource: string }
export interface Stage2Environment {
  browser: { executablePath: string; version: string; launchFlags: string[]; timeOriginMs: number };
  /** driverStartedMs/driverEndedMs are Node performance.now on this independent clock, never browser/server timestamps. */
  driver: { processId: number; clockId: string; timeOriginMs: number };
  runtime: { nodeVersion: string; pythonVersion: string; aiortcVersion: string; avVersion: string; aiohttpVersion: string; serverProcessId: number; serverClockId: string };
  signalingOrigins: string[]; iceServers: [];
  localInterfaces: Array<{ name: string; address: string; family: string }>;
}
export interface Stage2RunRelease extends Stage2Envelope { schema: "quest-stage2-host-release.v1"; mode: Stage2Mode; expectedEnvironment: Stage2Environment }
export interface Stage2Ownership { peers: number; tracks: number; generators: number; nodes: number; ports: number; contexts: number; listeners: number; timers: number; pendingCommands: number }
export interface Stage2ServerCloseAck extends Stage2Envelope { closed: boolean; serverClockId: string; atServerMs: number; activePeers: number; closingPeers: number; ownedTasks: number; queuedControlBytes: number; pendingControls: number }
/** Fixed owner reservation capacity, not actual JS/native/Python resident memory. Category peaks need not coincide.
 * Each category maximum <= owner peak <= sum of category maxima; that sum is NOT a simultaneous peak.
 * closed seals retained-growth admission; final read-only serialization leases remain bounded by the SAME cap.
 * Final run audit keeps latest peak after paging; heldBytesAtClose is retained bytes when growth was sealed.
 */
export interface ReservationAudit {
  limitBytes: number; peakBytes: number; heldBytesAtClose: number; rejectedReservations: number;
  closed: boolean; categoryPeaks: Record<string, number>;
}
export interface Stage2ResourceRecord {
  /** Null audits remain honest failed-setup evidence, and never qualify a run. */
  ownerReservations: { browser: ReservationAudit | null; python: ReservationAudit | null; gateway: ReservationAudit | null };
  typedHealthBytes: number; knownPendingPayloadBytes: number; ownedControlBytes: number; capBytes: number;
  healthRows: { uplink: number; downlink: number; uplinkSource: number; downlinkSource: number }; maximumConcurrentControls: number; maximumQueuedControlBytes: number;
  dropped: number; rejected: number; overflow: number; rawPcmRetainedBytes: 0; totalHeapMeasured: false;
  ledger: Array<{ owner: string; description: string; count: number; itemBytes: number; kind: "typed-health" | "known-payload" | "control" }>;
}
export interface Stage2NegativeExercise {
  intendedFault: Exclude<Stage2Mode, "positive">; injectedAtBrowserMs: number | null;
  observed: boolean; prerequisites: { uplinkDecoded: boolean; remoteRtp: boolean; remoteDecoded: boolean; bothDirectionsReady: boolean; qualifiedFiveSeconds: boolean; actualRelay400Hz: boolean };
  evidence: string[];
  preInjectionCheckpoint?: Stage2PreInjectionCheckpoint;
}
export interface Stage2RunRecord extends Stage2Envelope {
  schema: "quest-stage2-host-run.v1"; mode: Stage2Mode; environment: Stage2Environment;
  lifecycle: { contextCreatedMs: number; peerAllocatedServerMs: number | null; readyMs: number | null; warmupStartedMs: number | null; warmupEndedMs: number | null; contextClosedMs: number | null; peerClosedServerMs: number | null; driverStartedMs: number; driverEndedMs: number | null };
  connection: { iceState: string; dtlsState: string; browserPair: Stage2SelectedPair | null; serverPair: Stage2SelectedPair | null };
  mappings: { uplink: Stage2TrackMapping | null; downlink: Stage2TrackMapping | null };
  sources: { uplink: Stage2Source; downlink: Stage2Source };
  decoded: { uplink: Stage2DecodedConsumer; downlink: Stage2DecodedConsumer };
  marks: Stage2MarkExchange[]; clientWindow: { startMs: number | null; terminalMs: number | null };
  resources: Stage2ResourceRecord;
  events: Array<{ atBrowserMs: number | null; atServerMs: number | null; type: string; detail: string }>;
  negative: Stage2NegativeExercise | null;
  receiverDecodeEvidence?: Stage2ReceiverDecodeEvidence;
  /** closeSentMs/closeReceivedMs are browser performance.now, with environment.browser.timeOriginMs. */
  cleanup: { browserRemaining: Stage2Ownership; serverClose: Stage2ServerCloseAck | null; closeSentMs: number | null; closeReceivedMs: number | null; browserDrained: boolean; driver: { ownedProcesses: number; ownedListeners: number; confirmed: boolean } };
  outcome: "preparing" | "running" | "completed" | "failed" | "unsupported"; reason: string | null;
  notEvidenceFor: string[];
}
export interface Stage2OfferRequest extends Stage2Envelope { mode: Stage2Mode; description: { type: "offer"; sdp: string } }
export interface Stage2OfferAnswer extends Stage2Envelope { description: { type: "answer"; sdp: string }; allocatedAtServerMs: number; serverClockId: string }
export interface Stage2ControlRequest extends Stage2Envelope { markerId: string; command: Stage2Command }
export interface Stage2CloseRequest extends Stage2Envelope {}
