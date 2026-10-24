export type Stage0Phase = "ready" | "requesting" | "empty-before" | "warmup" | "sampling" | "empty-after" | "closing" | "completed" | "failed" | "stopped" | "unsupported";
export interface ResourceCounts { geometries: number; textures: number; programs: number }
export interface Stage0Profile {
  selectedTargetHz: number; targetSelection: string; rawSessionFrameRate: number | null;
  actualSessionFrameRate: number | null; supportedFrameRates: number[];
  layerKind: string; layerWidth: number; layerHeight: number; viewports: number[][];
  foveationRequested: number; foveationReadback: number | null; framebufferScaleRequested: number;
  contextAttributes: Record<string, unknown>; configuredSamples: number | null; boundFramebufferSamples: number | null;
  enabledFeatures: string[] | null; availabilityMask: string[];
}
export interface Stage0Identity { bundleSha256: string; protocolSha256: string; sceneManifestSha256: string; nonce: string }
export interface Stage0Metadata extends Stage0Identity { protocol: Record<string, unknown>; foveationRequested: number; rendererVersion: string; sourceFiles: Record<string, string> }
export interface Stage0Frame {
  receipt: number; xrTimestamp: number; phase: number; updateMs: number; submissionMs: number;
  collectorMs: number; observedBodyMs: number; poseValid: boolean; viewCount: number;
  presenting: boolean; visible: boolean; contextLost: boolean; renderCalls: number; triangles: number;
  programs: number; geometries: number; textures: number; stateFrame: number; head: number[]; viewMatrices: number[];
}
export interface Stage0Proof { at: number; source: string; xrTimestamp: number | null; viewport: number[]; nonBackgroundPixels: number; testedPixels: number; image: string | null; reason: string | null }
export interface Stage0Record {
  schema: "quest-stage0-record.v1"; identity: Stage0Identity; purpose: "readiness" | "cohort";
  phase: Stage0Phase; status: "ready" | "running" | "completed" | "failed" | "stopped" | "unsupported";
  releaseId: string | null; profile: Stage0Profile | null; requestedAt: number | null; admittedAt: number | null; watchdogDeadline: number | null;
  warmupStart: number | null; sampleStart: number | null; sampleEnd: number | null; endedAt: number | null;
  frames: Stage0Frame[]; events: { at: number; type: string; detail: string }[]; failureReasons: string[];
  resources: { emptyBefore: ResourceCounts | null; roomWarm: ResourceCounts | null; emptyAfter: ResourceCounts | null; ownerBefore: number; ownerAfter: number };
  proofs: { preview: Stage0Proof | null; afterSample: Stage0Proof | null };
  cleanup: { sessionEnded: boolean; rendererDisposed: boolean; workloadListeners: number; workloadTimers: number; controlListeners: number; controlTimers: number; animationCallbacks: number; queries: number; layerStable: boolean; roomResourcesDisposed: boolean };
  clock: { primary: string; secondary: string; resolutionMs: number | null; diagnosticReads: number; cpuZerosAreQuantized: boolean };
  storage: { maximumFrames: number; preallocatedBytes: number; retainedFrames: number; overflow: boolean; released: boolean };
  gpu: { enabled: boolean; available: boolean; elapsedMs: null; reason: string | null; samples: { frame: number; ms: number; valid: boolean }[]; discarded: number; pending: number };
  limitations: string[];
}
export interface Stage0Release { releaseId: string; identity: Omit<Stage0Identity, "nonce">; profile: Stage0Profile; emptyBaseline: ResourceCounts }
