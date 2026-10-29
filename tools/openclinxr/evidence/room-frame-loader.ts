import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyCaptureFrame } from "./lib/png-region-luminance.js";

/**
 * source181 — real room-frame fixture loader (proposal copy).
 *
 * validateRoomFixture(fixtureDir, repoRoot): unconditional default checks —
 * exact-15 names vs fixture-local producer-capture-manifest.json, per-PNG
 * bytes/hash/decode via the actual C classifier, sourcePinsDigest
 * recomputation over actual repo sources with per-source SHA comparison.
 * No optional readers, no callbacks, no cache.
 *
 * resolveRoomFrameInput: explicit raw-capture branch validates its own
 * capture-manifest.json + complete 15 room PNG membership + decode;
 * legitimate overhead/isometric/JSON sidecars tolerated, extra *-room.png
 * refused, bad explicit never falls back. No-env default is the durable
 * fixture only, never an ignored-latest fallback.
 */

export const ROOM_FRAME_SUFFIX = "-room.png";
export const ROOM_FRAME_FIXTURE_MANIFEST = "room-frames.manifest.json";
export const PRODUCER_MANIFEST_NAME = "producer-capture-manifest.json";
export const EXPECTED_COUNT = 15;

export type ValidateOk = {
	readonly kind: "explicit" | "fixture";
	readonly dir: string;
};
export type ValidateErr = { readonly kind: "error"; readonly reason: string };

type ProducerEntry = { scenarioId: string; imagePath: string; source: string };
type ProducerManifest = {
	schemaVersion: string;
	generatedAt?: string;
	captureMode?: string;
	entries: ProducerEntry[];
};
type FixtureEntry = {
	scenarioId: string;
	file: string;
	sha256: string;
	size: number;
};
type FixtureManifest = {
	schemaVersion: string;
	generatedFrom: {
		captureManifestSha256: string;
		capturedAt: string;
		captureCommit: string;
	};
	sourcePins: Array<{ path: string; sha256: string }>;
	sourcePinsDigest: string;
	entries: FixtureEntry[];
};

function sha256Hex(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function isRoomFile(name: string): boolean {
	return name.endsWith(ROOM_FRAME_SUFFIX);
}

function isLegitimateSidecar(name: string): boolean {
	if (name === ROOM_FRAME_FIXTURE_MANIFEST) return true;
	if (name === PRODUCER_MANIFEST_NAME) return true;
	if (name === "capture-manifest.json") return true;
	if (name.endsWith("-overhead.png") || name.endsWith("-isometric.png"))
		return true;
	if (name.endsWith(".json") && !name.includes("/") && !name.includes("\\"))
		return true;
	return false;
}

function traversalRefused(name: string): boolean {
	return (
		name === "" ||
		name === "." ||
		name === ".." ||
		name.includes("/") ||
		name.includes("\\")
	);
}

const PRIVATE_PATH_PARTS = new Set([
	".env",
	".grok",
	".codex",
	".claude",
	".cursor",
	".private",
	"secrets",
	"node_modules",
]);

function isPrivatePath(rel: string): boolean {
	const lower = rel.toLowerCase();
	if (lower === ".env" || lower.startsWith(".env.")) return true;
	if (lower.endsWith(".bak")) return true;
	const parts = lower.split("/");
	for (const part of parts) {
		if (part === ".env" || part.startsWith(".env.")) return true;
		if (PRIVATE_PATH_PARTS.has(part)) return true;
	}
	return false;
}

function sourcePathRefused(rel: string): boolean {
	if (isPrivatePath(rel)) return true;
	return (
		rel === "" ||
		rel.startsWith("/") ||
		rel.includes("\\") ||
		rel.split("/").includes("") ||
		rel.split("/").includes(".") ||
		rel.split("/").includes("..")
	);
}

function checkProducerManifest(raw: unknown): ProducerManifest | ValidateErr {
	const p = raw as ProducerManifest;
	if (
		!p ||
		p.schemaVersion !== "openclinxr.ui-xr-environment-room-capture.v1"
	) {
		return { kind: "error", reason: "producer-manifest-schema" };
	}
	if (!Array.isArray(p.entries) || p.entries.length !== EXPECTED_COUNT) {
		return {
			kind: "error",
			reason: `producer-count:${Array.isArray(p.entries) ? p.entries.length : "?"}`,
		};
	}
	const names = p.entries.map((e) => e.imagePath);
	if (new Set(names).size !== EXPECTED_COUNT)
		return { kind: "error", reason: "producer-duplicate" };
	const ids = p.entries.map((e) => e.scenarioId);
	if (new Set(ids).size !== EXPECTED_COUNT)
		return { kind: "error", reason: "scenario-duplicate" };
	for (const e of p.entries) {
		if (traversalRefused(e.imagePath) || !isRoomFile(e.imagePath)) {
			return { kind: "error", reason: `producer-traversal:${e.imagePath}` };
		}
		if (e.imagePath !== `${e.scenarioId}-room.png`) {
			return { kind: "error", reason: `producer-id:${e.imagePath}` };
		}
		if (e.source !== "live_scene")
			return { kind: "error", reason: `producer-source:${e.scenarioId}` };
	}
	return p;
}

/** Default durable-fixture validation: unconditional hash/source/decode checks. */
export function validateRoomFixture(
	fixtureDir: string,
	repoRoot: string,
): ValidateOk | ValidateErr {
	if (!existsSync(fixtureDir))
		return { kind: "error", reason: "fixture-missing" };
	let producerRaw: unknown;
	try {
		producerRaw = JSON.parse(
			readFileSync(join(fixtureDir, PRODUCER_MANIFEST_NAME), "utf8"),
		);
	} catch {
		return { kind: "error", reason: "producer-manifest-unreadable" };
	}
	const producer = checkProducerManifest(producerRaw);
	if ((producer as ValidateErr).kind === "error")
		return producer as ValidateErr;
	const prod = producer as ProducerManifest;
	const expectedNames = prod.entries.map((e) => e.imagePath);
	const expectedSet = new Set(expectedNames);

	const onDisk = readdirSync(fixtureDir);
	const rooms = onDisk.filter(isRoomFile);
	if (rooms.length !== EXPECTED_COUNT)
		return { kind: "error", reason: `count:${rooms.length}/${EXPECTED_COUNT}` };
	if (new Set(rooms).size !== rooms.length)
		return { kind: "error", reason: "duplicate" };
	for (const f of rooms) {
		if (traversalRefused(f))
			return { kind: "error", reason: `traversal-refused:${f}` };
		if (!expectedSet.has(f)) return { kind: "error", reason: `extra:${f}` };
	}
	for (const f of onDisk) {
		if (!isRoomFile(f) && !isLegitimateSidecar(f))
			return { kind: "error", reason: `extra:${f}` };
	}

	let manifest: FixtureManifest;
	try {
		manifest = JSON.parse(
			readFileSync(join(fixtureDir, ROOM_FRAME_FIXTURE_MANIFEST), "utf8"),
		) as FixtureManifest;
	} catch {
		return { kind: "error", reason: "manifest-unreadable" };
	}
	if (manifest.schemaVersion !== "openclinxr.room-frames-fixture.v1") {
		return { kind: "error", reason: "manifest-schema" };
	}
	if (
		!Array.isArray(manifest.entries) ||
		manifest.entries.length !== EXPECTED_COUNT
	) {
		return { kind: "error", reason: "manifest-count" };
	}
	const byFile = new Map(manifest.entries.map((e) => [e.file, e]));
	if (byFile.size !== EXPECTED_COUNT)
		return { kind: "error", reason: "manifest-duplicate" };

	// Producer-manifest bytes must match the recorded captureManifestSha256.
	const producerBytes = readFileSync(join(fixtureDir, PRODUCER_MANIFEST_NAME));
	if (
		sha256Hex(producerBytes) !== manifest.generatedFrom.captureManifestSha256
	) {
		return { kind: "error", reason: "producer-bytes-mismatch" };
	}

	// Source pins: nonempty; deny private paths BEFORE any hashing or reads.
	if (!Array.isArray(manifest.sourcePins) || manifest.sourcePins.length === 0) {
		return { kind: "error", reason: "stale-source-empty" };
	}
	for (const pin of manifest.sourcePins) {
		if (sourcePathRefused(pin.path)) {
			return { kind: "error", reason: `stale-source-path:${pin.path}` };
		}
	}
	const sorted = [...manifest.sourcePins].sort((a, b) =>
		a.path < b.path ? -1 : 1,
	);
	const recomputed = createHash("sha256")
		.update(sorted.map((p) => `${p.path}:${p.sha256}\n`).join(""))
		.digest("hex");
	if (recomputed !== manifest.sourcePinsDigest)
		return { kind: "error", reason: "stale-source-digest" };
	for (const pin of sorted) {
		const abs = join(repoRoot, pin.path);
		if (!existsSync(abs))
			return { kind: "error", reason: `stale-source-missing:${pin.path}` };
		const actual = sha256Hex(readFileSync(abs));
		if (actual !== pin.sha256)
			return { kind: "error", reason: `stale-source:${pin.path}` };
	}

	// Per-PNG bytes/size/hash/decode with the actual classifier.
	for (const e of prod.entries) {
		const m = byFile.get(e.imagePath);
		if (!m || m.scenarioId !== e.scenarioId) {
			return { kind: "error", reason: `manifest-id:${e.imagePath}` };
		}
		const bytes = readFileSync(join(fixtureDir, e.imagePath));
		if (bytes.length !== m.size)
			return { kind: "error", reason: `size:${e.imagePath}` };
		if (sha256Hex(bytes) !== m.sha256)
			return { kind: "error", reason: `hash:${e.imagePath}` };
		if (classifyCaptureFrame(bytes) === null)
			return { kind: "error", reason: `corrupt:${e.imagePath}` };
	}
	return { kind: "fixture", dir: fixtureDir };
}

/** Explicit raw-capture branch: own capture-manifest.json + 15 rooms + decode. */
function validateExplicitDir(dir: string): ValidateOk | ValidateErr {
	if (!existsSync(dir))
		return { kind: "error", reason: `explicit-missing:${dir}` };
	let producerRaw: unknown;
	try {
		producerRaw = JSON.parse(
			readFileSync(join(dir, "capture-manifest.json"), "utf8"),
		);
	} catch {
		return { kind: "error", reason: "explicit-manifest-unreadable" };
	}
	const producer = checkProducerManifest(producerRaw);
	if ((producer as ValidateErr).kind === "error") {
		const err = producer as ValidateErr;
		return { kind: "error", reason: `explicit-${err.reason}` };
	}
	const prod = producer as ProducerManifest;
	const expectedSet = new Set(prod.entries.map((e) => e.imagePath));
	const onDisk = readdirSync(dir);
	const rooms = onDisk.filter(isRoomFile);
	if (rooms.length !== EXPECTED_COUNT) {
		return {
			kind: "error",
			reason: `explicit-count:${rooms.length}/${EXPECTED_COUNT}`,
		};
	}
	if (new Set(rooms).size !== rooms.length)
		return { kind: "error", reason: "explicit-duplicate" };
	for (const f of rooms) {
		if (traversalRefused(f))
			return { kind: "error", reason: `explicit-traversal-refused:${f}` };
		if (!expectedSet.has(f))
			return { kind: "error", reason: `explicit-extra:${f}` };
	}
	for (const f of onDisk) {
		if (
			!isRoomFile(f) &&
			!isLegitimateSidecar(f) &&
			f !== "capture-manifest.json"
		) {
			return { kind: "error", reason: `explicit-extra:${f}` };
		}
	}
	for (const f of rooms) {
		const bytes = readFileSync(join(dir, f));
		if (classifyCaptureFrame(bytes) === null)
			return { kind: "error", reason: `explicit-corrupt:${f}` };
	}
	return { kind: "explicit", dir };
}

/** Input router: explicit raw capture when env is set, durable fixture otherwise. */
export function resolveRoomFrameInput(opts: {
	readonly explicitEnvDir: string | undefined;
	readonly fixtureDir: string;
	readonly repoRoot: string;
}): ValidateOk | ValidateErr {
	if (opts.explicitEnvDir !== undefined)
		return validateExplicitDir(opts.explicitEnvDir);
	return validateRoomFixture(opts.fixtureDir, opts.repoRoot);
}
