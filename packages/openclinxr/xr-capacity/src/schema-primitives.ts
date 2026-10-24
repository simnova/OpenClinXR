import type { MetricSemantic, Unit } from "./types.js";

/** Bounded input ceilings for capacity evidence validation. Keeps every run record inside the reviewed host-ladder envelope. */
export const CAPACITY_LIMITS = Object.freeze({
	inputBytes: 8_388_608,
	metrics: 64,
	samplesPerMetric: 50_000,
	samplesTotal: 200_000,
	claims: 32,
	stopRules: 16,
	artifacts: 64,
	axes: 64,
});

/** Typed failure for capacity record validation. Thrown when a run record violates the strict JSON boundary. */
export class CapacityValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CapacityValidationError";
	}
}

export function fail(path: string, message: string): never {
	throw new CapacityValidationError(`${path}: ${message}`);
}
export function object(
	value: unknown,
	path: string,
	keys: string[],
): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		fail(path, "expected object");
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null)
		fail(path, "expected a plain JSON object");
	const descriptors = Object.getOwnPropertyDescriptors(value);
	for (const key of Object.keys(descriptors)) {
		if (
			!keys.includes(key) ||
			key === "__proto__" ||
			key === "constructor" ||
			key === "prototype"
		)
			fail(`${path}.${key}`, "unknown field");
		if (!Object.hasOwn(descriptors[key] ?? {}, "value"))
			fail(`${path}.${key}`, "accessors are not JSON");
	}
	for (const key of keys)
		if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, "missing field");
	return value as Record<string, unknown>;
}
export function text(
	value: unknown,
	path: string,
	max = 512,
): asserts value is string {
	if (
		typeof value !== "string" ||
		value.length < 1 ||
		value.length > max ||
		/[\u0000-\u001f]/.test(value)
	)
		fail(path, `expected nonempty text of at most ${max} characters`);
}
export function number(
	value: unknown,
	path: string,
	max = Number.MAX_SAFE_INTEGER,
): asserts value is number {
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < 0 ||
		value > max
	)
		fail(path, "expected a finite nonnegative bounded number");
}
export function integer(
	value: unknown,
	path: string,
	max = Number.MAX_SAFE_INTEGER,
): asserts value is number {
	number(value, path, max);
	if (!Number.isSafeInteger(value)) fail(path, "expected an integer");
}
export function bool(value: unknown, path: string): asserts value is boolean {
	if (typeof value !== "boolean") fail(path, "expected boolean");
}
export function choice(
	value: unknown,
	path: string,
	choices: readonly string[],
): void {
	if (typeof value !== "string" || !choices.includes(value))
		fail(path, `expected ${choices.join(" | ")}`);
}
export function array(value: unknown, path: string, max: number): unknown[] {
	if (!Array.isArray(value) || value.length > max)
		fail(path, `expected array of at most ${max} items`);
	return value;
}
export function source(value: unknown, path: string): void {
	const v = object(value, path, ["tool", "version", "processId"]);
	for (const key of ["tool", "version", "processId"])
		text(v[key], `${path}.${key}`);
}
export function date(value: unknown, path: string): number {
	text(value, path, 40);
	const ms = Date.parse(value);
	if (
		!Number.isFinite(ms) ||
		!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value) ||
		new Date(ms).toISOString().replace(".000Z", "Z") !==
			value.replace(".000Z", "Z")
	)
		fail(path, "expected a valid UTC ISO timestamp");
	return ms;
}
export function unique(values: string[], path: string): void {
	if (new Set(values).size !== values.length) fail(path, "duplicate ids");
}
export const semantics: MetricSemantic[] = [
	"cpu-duration",
	"gpu-duration",
	"callback-gap",
	"display-gap",
	"memory",
	"asset-duration",
	"bytes",
	"network-rtt",
	"network-throughput",
	"network-jitter",
	"queue-age",
	"server-duration",
	"websocket-buffered",
	"application-unacked",
	"audio-software",
	"audio-acoustic",
	"motion-to-photon",
	"counter",
];
export const units: Unit[] = ["ms", "bytes", "count", "ratio", "Hz", "bytes/s"];
export const semanticUnits: Record<MetricSemantic, Unit> = {
	"cpu-duration": "ms",
	"gpu-duration": "ms",
	"callback-gap": "ms",
	"display-gap": "ms",
	memory: "bytes",
	"asset-duration": "ms",
	bytes: "bytes",
	"network-rtt": "ms",
	"network-throughput": "bytes/s",
	"network-jitter": "ms",
	"queue-age": "ms",
	"server-duration": "ms",
	"websocket-buffered": "bytes",
	"application-unacked": "bytes",
	"audio-software": "ms",
	"audio-acoustic": "ms",
	"motion-to-photon": "ms",
	counter: "count",
};
