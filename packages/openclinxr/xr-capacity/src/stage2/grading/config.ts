export const STAGE2_PROTOCOL_SHA256 = "212aada18426eb1c30c5c0b5740b26d28220e361b3456446a9ff05b66ba830a6";
export const STAGE2_CONFIG = Object.freeze({
  schema: "quest-stage2-host-synthetic-config.v1",
  scope: "same-host-synthetic-only",
  recipes: Object.freeze({ uplinkHz: 400, downlinkHz: 700, sourcePeak: .02, downlinkGain: .1, rampMs: 25, sampleRateRequested: 48000 }),
  analysis: Object.freeze({ channel: 0, toneN: "per-channel-audio-frames", allChannelHealth: true, browserOutputChannels: 1, projection: "select-channel-0-without-downmix", minimumExpectedFraction: .5, minimumExpectedToOtherRatio: 4, clippingThreshold: .98 }),
  bins: Object.freeze({ targetMs: 500, maximumMs: 1000, maximumRowsPerDecodedDirection: 512, maximumRowsPerSource: 512, maximumStatsPageRows: 16, targetRounding: "ceil(rate*.5/initialActualQuantum)*initialActualQuantum", emptyBinsRetained: false }),
  timing: Object.freeze({ setupMs: 20000, warmupMs: 10000, qualifiedMs: 70000, drainMs: 5000, peerLifetimeMs: 150000, contextLifetimeMs: 150000, driverDeadlineMs: 165000, earlyCloseQualifiedMs: 5000 }),
  bounds: Object.freeze({ maximumPeers: 1, maximumControlBodyBytes: 65536, maximumConcurrentControls: 4, maximumQueuedControlBytes: 262144, maximumOwnedTypedAndKnownPayloadBytes: 1048576, ownerReservationBytes: Object.freeze({ browser: 655360, python: 327680, gateway: 65536 }) }),
  routes: Object.freeze({ offer: "/stage2/offer", control: "/stage2/control", stats: "/stage2/stats", close: "/stage2/close" }),
});
export const STAGE2_PHASE_FOR_COMMAND = Object.freeze({ ready: "setup", warmup: "warmup", start: "qualified", end: "ended" } as const);
