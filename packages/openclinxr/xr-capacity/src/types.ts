/** Versioned measurement contracts; a record describes evidence, not device certification. */
export type Provenance =
	| "synthetic"
	| "node-host"
	| "desktop-browser"
	| "quest-browser"
	| "browser-unverified"
	| "quest-native";
export type Outcome =
	| "planned"
	| "validated-profile"
	| "failed"
	| "unsupported"
	| "inconclusive"
	| "aborted";
export type Unit = "ms" | "bytes" | "count" | "ratio" | "Hz" | "bytes/s";
export type ClockDomain =
	| "host-monotonic"
	| "browser-monotonic"
	| "xr-session"
	| "compositor"
	| "server-monotonic"
	| "external-acoustic"
	| "external-photon";
export type MetricSemantic =
	| "cpu-duration"
	| "gpu-duration"
	| "callback-gap"
	| "display-gap"
	| "memory"
	| "asset-duration"
	| "bytes"
	| "network-rtt"
	| "network-throughput"
	| "network-jitter"
	| "queue-age"
	| "server-duration"
	| "websocket-buffered"
	| "application-unacked"
	| "audio-software"
	| "audio-acoustic"
	| "motion-to-photon"
	| "counter";
export interface MetricSource {
	tool: string;
	version: string;
	processId: string;
}
export interface TimingDenominator {
	kind: "sessionTarget" | "compositorDisplay" | "callbackMedian";
	periodMs: number;
	source: MetricSource;
}
export interface MetricSample {
	at: number;
	value: number | null;
	valid: boolean;
	disjoint?: boolean;
	placeholder?: boolean;
}
/** Single measured or proxy observation series. Binds samples to their semantic, clock, and provenance. */
export interface CapacityMetric {
	id: string;
	semantic: MetricSemantic;
	unit: Unit;
	kind: "measured" | "proxy" | "unavailable";
	granularity: "per-frame" | "aggregate-window" | "event";
	clockDomain: ClockDomain;
	source: MetricSource;
	samples: MetricSample[];
	sampleCount: number;
	invalidSampleCount: number;
	droppedSamples: number;
	windowMs: number | null;
	timingDenominator: TimingDenominator | null;
	unavailableReason: string | null;
	transportState: "not-applicable" | "pending" | "connected" | "failed";
}
export interface CapacityClaim {
	id: string;
	kind:
		| "threshold"
		| "full-rate"
		| "cadence"
		| "network"
		| "audio-software"
		| "audio-acoustic"
		| "motion-to-photon";
	metricId: string;
	operator: "lte" | "gte";
	threshold: number;
	unit: Unit;
	statistic: "p50" | "p95" | "p99" | "max" | "min";
	requiresMeasured: boolean;
	minimumSamples: number;
}
export interface StopRule {
	id: string;
	version: string;
	metricId: string;
	processId: string;
	source: string;
	watermark: number;
	operator: "gte" | "lte";
}
export interface CapacityProfile {
	id: string;
	version: string;
	status: "provisional" | "frozen";
	scope: "host" | "desktop" | "quest";
	minimumSamples: number;
	minimumDurationMs: number;
	requiredClaims: CapacityClaim[];
	stopRules: StopRule[];
}
export interface NativeSession {
	sessionId: string;
	processId: string;
	browser: string;
	device: string;
	ownershipVerified: boolean;
	worn: boolean;
}
export interface CapacityArtifact {
	id: string;
	kind: string;
	path: string;
	sha256: string;
}
export type AxisValue = string | number | boolean | null;
/** Versioned capacity evidence record. Carries the profile, metrics, and lifecycle status for one run. */
export interface CapacityRun {
	schema: "quest-capacity-run.v1";
	id: string;
	evidenceClass: "smoke" | "capacity";
	provenance: Provenance;
	startedAt: string;
	endedAt: string;
	environment: {
		runtime: string;
		device: string;
		os: string;
		browser: string;
		revision: string;
		buildHash: string;
	};
	configuration: {
		workloadHash: string;
		capabilityHash: string;
		seed: number;
		axes: Record<string, AxisValue>;
	};
	nativeSession: NativeSession | null;
	profile: CapacityProfile;
	metrics: CapacityMetric[];
	artifacts: CapacityArtifact[];
	status: "planned" | "completed" | "aborted" | "unsupported";
	ringDroppedSamples: number;
}
export interface MetricSummary {
	id: string;
	kind: CapacityMetric["kind"];
	granularity: CapacityMetric["granularity"];
	validSamples: number;
	rejectedSamples: number;
	p50: number | null;
	p95: number | null;
	p99: number | null;
	min: number | null;
	max: number | null;
	/** Callback-gap symptoms only. Never an exact missed display-frame count. */
	lateCallbackCount: number | null;
	longestLateBurst: number | null;
	reasons: string[];
}
export interface ClaimEvaluation {
	criterion: string;
	id: string;
	outcome: Outcome;
	reasons: string[];
	summary: MetricSummary | null;
}
export interface RunEvaluation {
	outcome: Outcome;
	scope: CapacityProfile["scope"];
	claims: ClaimEvaluation[];
	reasons: string[];
	notEvidenceFor: string[];
}
/** Legacy call shape only. v1 ignores matching tuples; no trusted native collector is implemented. */
export interface EvaluationContext {
	nativeSessionVerified?: { sessionId: string; processId: string };
}
export type ValidationResult =
	| { ok: true; run: CapacityRun; errors: [] }
	| { ok: false; errors: string[] };
export interface ComparisonResult {
	outcome: "comparable" | "failed";
	compatibility: "compatible" | "incompatible";
	metrics: {
		id: string;
		unit: Unit;
		kind: CapacityMetric["kind"];
		granularity: CapacityMetric["granularity"];
		baseline: { samples: number; max: number | null; p95: number | null };
		candidate: { samples: number; max: number | null; p95: number | null };
		maxDelta: number | null;
		maxRatio: number | null;
		p95Delta: number | null;
		p95Ratio: number | null;
	}[];
	equivalence: {
		id: string;
		allowedEnvironment: ("revision" | "buildHash")[];
	} | null;
	differences: string[];
	allowedDifferences: string[];
	claims: {
		id: string;
		baseline: Outcome;
		candidate: Outcome;
		baselineSamples: number | null;
		candidateSamples: number | null;
		regression: boolean;
	}[];
}
