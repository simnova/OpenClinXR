import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	EXPECTED_COUNT,
	PRODUCER_MANIFEST_NAME,
	ROOM_FRAME_FIXTURE_MANIFEST,
	ROOM_FRAME_SUFFIX,
	computeSourcePinsDigest,
	hashBytes,
	sortSourcePins,
	validateRoomFixture,
	type SourcePin,
} from "./room-frame-loader.js";
import {
	ROOM_CAPTURE_MANIFEST_NAME,
	captureStationEnvironmentRooms,
} from "./ui-xr-environment-room-capture.js";

/**
 * evidence:room-frames:refresh — recapture + re-pin the room-frame fixture.
 *
 * Runs the room capture for every shipped station, copies the 15 `-room.png`
 * frames plus the producer capture manifest into the fixture dir, and rewrites
 * room-frames.manifest.json (per-PNG bytes/size/sha + sourcePins +
 * sourcePinsDigest) with the SAME hashing/sorting code room-frame-loader.ts
 * validates with (imported, not reimplemented).
 *
 * The pin SET is the 88bcbca6d set: every git-tracked file under the scope
 * dirs below (plus the explicit capture-pipeline tools files), minus tests,
 * docs, and factory-stage byproducts. ci-w15 extended the scopes to follow
 * the 27ecbd6e4 (factory-station-core) and 94b5fd630 (stations/face-realism)
 * moves; the same exclusion filters apply. Refuses to write when any capture
 * fails, when the captured population differs from the fixture's, or when a
 * pin path is missing/unreadable.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const DEFAULT_FIXTURE_DIR = join(HERE, "fixtures", "room-frames");

/** Dir scopes whose git-tracked, non-excluded files are pinned. */
const PIN_SCOPE_DIRS: readonly string[] = [
	"apps/ui-xr",
	"packages/cellix/provider-contracts",
	"packages/openclinxr/asset-registry",
	"packages/openclinxr/compute-services-spec",
	"packages/openclinxr/compute-slots",
	"packages/openclinxr/conversation-policy",
	"packages/openclinxr/exam-assembly",
	"packages/openclinxr/factory-station-core",
	"packages/openclinxr/factory-stations",
	"packages/openclinxr/scenario-fixtures",
	"packages/openclinxr/service-local-compute",
	"packages/openclinxr/shared-schemas",
	"packages/openclinxr/stations/face-realism",
	"packages/openclinxr/xr-actor-dialogue",
	"packages/openclinxr/xr-asset-loading",
	"packages/openclinxr/xr-capacity",
	"packages/openclinxr/xr-capture-evidence",
	"packages/openclinxr/xr-dialogue",
	"packages/openclinxr/xr-exam-flow",
	"packages/openclinxr/xr-humanoid-animation",
	"packages/openclinxr/xr-locomotion",
	"packages/openclinxr/xr-pose",
	"packages/openclinxr/xr-runtime-state",
	"packages/openclinxr/xr-runtime-wiring",
	"packages/openclinxr/xr-scene",
	"packages/openclinxr/xr-scene-cues",
	"packages/openclinxr/xr-station",
	"packages/openclinxr/xr-station-room",
	"packages/openclinxr/xr-trace-readiness",
];

/** Root manifests pinned (they pin the browser/build tooling). */
const PIN_ROOT_FILES: readonly string[] = [
	"package.json",
	"pnpm-workspace.yaml",
	"pnpm-lock.yaml",
];

/** Capture-pipeline sources pinned (the tools that produce the pixels). */
const PIN_TOOLS_FILES: readonly string[] = [
	"tools/openclinxr/evidence/decode-png.ts",
	"tools/openclinxr/evidence/doorway-overview-camera.ts",
	"tools/openclinxr/evidence/lib/mhclo-topology.ts",
	"tools/openclinxr/evidence/lib/png-region-luminance.ts",
	"tools/openclinxr/evidence/lib/portless-server.ts",
	"tools/openclinxr/evidence/lib/posed-world-bounds.ts",
	"tools/openclinxr/evidence/lib/skinned-world-sampling.ts",
	"tools/openclinxr/evidence/lib/slotted-playwright.ts",
	"tools/openclinxr/evidence/room-camera/landing-note.ts",
	"tools/openclinxr/evidence/room-camera/read-position.ts",
	"tools/openclinxr/evidence/station-capture/actor-frame-metrics.ts",
	"tools/openclinxr/evidence/station-capture/actor-visibility-page-probe.ts",
	"tools/openclinxr/evidence/station-capture/assemble-station-room-actor-sheet.ts",
	"tools/openclinxr/evidence/station-capture/assemble-station-room-clear-sheet.ts",
	"tools/openclinxr/evidence/station-capture/assemble-station-room-grade-set.ts",
	"tools/openclinxr/evidence/station-capture/assemble-station-room-interior-sheet.ts",
	"tools/openclinxr/evidence/station-capture/assemble-station-room-whole-sheet.ts",
	"tools/openclinxr/evidence/station-capture/camera-candidate-scoring.ts",
	"tools/openclinxr/evidence/station-capture/camera-sweep-scene.ts",
	"tools/openclinxr/evidence/station-capture/camera-sweep-search.ts",
	"tools/openclinxr/evidence/station-capture/classify-one-render.ts",
	"tools/openclinxr/evidence/station-capture/gate-geometry.ts",
	"tools/openclinxr/evidence/station-capture/interior-frame-metrics.ts",
	"tools/openclinxr/evidence/station-capture/near-occlusion-page-probe.ts",
	"tools/openclinxr/evidence/station-capture/occlusion-and-containment-metrics.ts",
	"tools/openclinxr/evidence/station-capture/page-diagnostics.ts",
	"tools/openclinxr/evidence/station-capture/refine-camera-for-occlusion-and-containment.ts",
	"tools/openclinxr/evidence/station-capture/run-camera-sweep.ts",
	"tools/openclinxr/evidence/station-capture/sweep-renders-after-client-graph-fix.ts",
	"tools/openclinxr/evidence/ui-xr-environment-room-capture.ts",
];

const EXCLUDED_BASENAME_SUFFIXES: readonly string[] = [
	".md",
	".py",
	".sh",
	".patch",
	".wav",
];
const EXCLUDED_PATH_PARTS: readonly string[] = [
	"textures/",
	"infinigen_generate/",
	"test-fixtures/",
	"/tests/",
	"fixtures/extract.glb",
];
const EXCLUDED_FILES: ReadonlySet<string> = new Set([
	"apps/ui-xr/consumes.json",
	"apps/ui-xr/isolated-subject.html",
	"apps/ui-xr/turbo.json",
	"apps/ui-xr/vitest.config.ts",
	"packages/openclinxr/xr-scene/src/skin-shader/skin-lut.png",
]);

/** 88bcbca6d exclusion rule: tests, docs, factory-stage byproducts, harnesses. */
function isExcluded(rel: string): boolean {
	const base = rel.split("/").pop() ?? rel;
	if (base.includes(".test.")) return true;
	if (EXCLUDED_BASENAME_SUFFIXES.some((s) => base.endsWith(s))) return true;
	if (EXCLUDED_PATH_PARTS.some((part) => rel.includes(part))) return true;
	if (EXCLUDED_FILES.has(rel)) return true;
	return false;
}

function inScopeDirs(rel: string): boolean {
	return PIN_SCOPE_DIRS.some((dir) => rel === dir || rel.startsWith(`${dir}/`));
}

function git(args: readonly string[]): string {
	return execFileSync("git", [...args], {
		cwd: REPO_ROOT,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
}

type CaptureEntry = {
	scenarioId: string;
	imagePath: string;
	source: string;
};

function readCaptureManifest(raw: unknown): CaptureEntry[] {
	const manifest = raw as {
		schemaVersion?: unknown;
		entries?: unknown;
	};
	if (
		!manifest ||
		manifest.schemaVersion !== "openclinxr.ui-xr-environment-room-capture.v1" ||
		!Array.isArray(manifest.entries)
	) {
		throw new Error("capture manifest unreadable: schema mismatch");
	}
	return manifest.entries as CaptureEntry[];
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	let fixtureDir = DEFAULT_FIXTURE_DIR;
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === "--help" || arg === "-h") {
			process.stdout.write(
				"usage: evidence:room-frames:refresh [--fixture-dir <dir>]\n",
			);
			return;
		}
		if (arg === "--fixture-dir" && args[i + 1]) {
			fixtureDir = pathResolve(args[i + 1] as string);
			i += 1;
		} else {
			throw new Error(`unknown arg: ${arg}`);
		}
	}

	// 1. Compute the pin set from git-tracked files (fail closed on any gap).
	for (const dir of PIN_SCOPE_DIRS) {
		if (!existsSync(join(REPO_ROOT, dir))) {
			throw new Error(`pin scope missing on disk: ${dir}`);
		}
	}
	const tracked = new Set(
		git(["ls-files"]).split("\n").map((line) => line.trim()).filter(Boolean),
	);
	const scoped = [...tracked].filter(
		(rel) => inScopeDirs(rel) || (PIN_ROOT_FILES as readonly string[]).includes(rel),
	);
	const pinPaths = sortSourcePins(
		scoped
			.filter((rel) => !isExcluded(rel))
			.map((path) => ({ path, sha256: "" })),
	).map((pin) => pin.path);
	for (const rel of PIN_TOOLS_FILES) {
		if (!tracked.has(rel)) {
			throw new Error(`pin tools file not git-tracked (update PIN_TOOLS_FILES): ${rel}`);
		}
		if (isExcluded(rel)) {
			throw new Error(`pin tools file hits exclusion rule: ${rel}`);
		}
	}
	const allPinPaths = sortSourcePins(
		[...pinPaths, ...PIN_TOOLS_FILES].map((path) => ({ path, sha256: "" })),
	).map((pin) => pin.path);
	const sourcePins: SourcePin[] = [];
	for (const rel of allPinPaths) {
		let bytes: Buffer;
		try {
			bytes = await readFile(join(REPO_ROOT, rel));
		} catch {
			throw new Error(`pin unreadable (moved without scope update?): ${rel}`);
		}
		sourcePins.push({ path: rel, sha256: hashBytes(bytes) });
	}
	if (sourcePins.length === 0) throw new Error("pin set empty; refusing");
	process.stdout.write(`room-frames-refresh: pinned ${sourcePins.length} sources\n`);

	// 2. Capture all shipped stations into a temp dir (throws on any failure).
	const workDir = await mkdtemp(join(tmpdir(), "room-frames-refresh-"));
	const manifest = await captureStationEnvironmentRooms({ outputDir: workDir });
	const entries = readCaptureManifest(manifest);
	if (entries.length !== EXPECTED_COUNT) {
		throw new Error(
			`capture produced ${entries.length} entries, expected ${EXPECTED_COUNT}; refusing to write`,
		);
	}
	const roomFiles = (await readdir(workDir)).filter((name) => name.endsWith(ROOM_FRAME_SUFFIX));
	const expectedNames = new Set(entries.map((entry) => entry.imagePath));
	if (
		roomFiles.length !== EXPECTED_COUNT ||
		!roomFiles.every((name) => expectedNames.has(name))
	) {
		throw new Error(
			`capture room population mismatch (${roomFiles.length} files); refusing to write`,
		);
	}
	for (const entry of entries) {
		if (!entry.imagePath.endsWith(ROOM_FRAME_SUFFIX)) {
			throw new Error(`capture entry not a room frame: ${entry.imagePath}`);
		}
		if (entry.source !== "live_scene") {
			throw new Error(`capture entry not live_scene: ${entry.scenarioId}`);
		}
		if (!existsSync(join(workDir, entry.imagePath))) {
			throw new Error(`capture entry file missing: ${entry.imagePath}`);
		}
	}

	// 3. Copy frames + producer manifest verbatim, then write the fixture manifest.
	for (const entry of entries) {
		await copyFile(join(workDir, entry.imagePath), join(fixtureDir, entry.imagePath));
	}
	await copyFile(
		join(workDir, ROOM_CAPTURE_MANIFEST_NAME),
		join(fixtureDir, PRODUCER_MANIFEST_NAME),
	);
	const producerBytes = await readFile(join(fixtureDir, PRODUCER_MANIFEST_NAME));
	const captureCommit = git(["rev-parse", "HEAD"]).trim();
	const fixtureEntries = await Promise.all(
		entries.map(async (entry) => {
			const bytes = await readFile(join(fixtureDir, entry.imagePath));
			return {
				scenarioId: entry.scenarioId,
				file: entry.imagePath,
				sha256: hashBytes(bytes),
				size: bytes.length,
			};
		}),
	);
	const fixtureManifest = {
		schemaVersion: "openclinxr.room-frames-fixture.v1",
		generatedFrom: {
			captureManifestSha256: hashBytes(producerBytes),
			capturedAt: new Date().toISOString(),
			captureCommit,
		},
		sourcePins: sortSourcePins(sourcePins),
		sourcePinsDigest: computeSourcePinsDigest(sourcePins),
		entries: fixtureEntries,
	};
	await writeFile(
		join(fixtureDir, ROOM_FRAME_FIXTURE_MANIFEST),
		`${JSON.stringify(fixtureManifest, null, 2)}\n`,
		"utf8",
	);

	// 4. Self-check with the same validator the gate uses.
	const verdict = validateRoomFixture(fixtureDir, REPO_ROOT);
	if (verdict.kind === "error") {
		throw new Error(`self-check failed after write: ${verdict.reason}`);
	}
	process.stdout.write(
		`room-frames-refresh: wrote ${fixtureEntries.length} frames, ` +
			`digest ${fixtureManifest.sourcePinsDigest.slice(0, 12)}… at ${captureCommit.slice(0, 12)}\n`,
	);
}

const isDirectRun =
	typeof process.argv[1] === "string" &&
	process.argv[1].endsWith("room-frames-refresh.ts");

if (isDirectRun) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? (error.stack ?? error.message) : error);
		process.exitCode = 1;
	});
}
