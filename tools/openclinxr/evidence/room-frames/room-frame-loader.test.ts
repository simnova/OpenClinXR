import { createHash } from "node:crypto";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
	EXPECTED_COUNT,
	resolveRoomFrameInput,
	validateRoomFixture,
} from "../room-frame-loader.js";

/**
 * source181 — unit tests for the real loader (proposal copy).
 *
 * Valid baseline runs FIRST on a unit fixture cloned from the 15 authentic
 * D PNGs (one labeled unit-only src pin). Every mutation then invokes the
 * SAME public validator and asserts the intended error. Corrupt mutant
 * updates recorded size/hash so the actual PNG decode is the refusal.
 * Stale-source mutant alters the unit src while retaining the old pin.
 * Two own roots checked fresh with no cache.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const D_FRAMES = join(HERE, "..", "fixtures", "room-frames");
const D_PRODUCER = join(D_FRAMES, "producer-capture-manifest.json");
const UNIT_ROOT = mkdtempSync(join(tmpdir(), "room-frame-unit-"));
afterAll(() => rmSync(UNIT_ROOT, { recursive: true, force: true }));

type Ctx = { dir: string; repo: string };

function sha(b: Uint8Array): string {
	return createHash("sha256").update(b).digest("hex");
}

function buildUnit(tag: string): Ctx {
	const base = join(UNIT_ROOT, tag);
	const dir = join(base, "unit-fixture");
	const repo = join(base, "unit-repo");
	rmSync(base, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	mkdirSync(join(repo, "unit-src"), { recursive: true });
	const prod = JSON.parse(readFileSync(D_PRODUCER, "utf8")) as {
		entries: Array<{ scenarioId: string; imagePath: string }>;
	};
	const entries = prod.entries.map((e) => {
		const bytes = readFileSync(join(D_FRAMES, e.imagePath));
		cpSync(join(D_FRAMES, e.imagePath), join(dir, e.imagePath));
		return {
			scenarioId: e.scenarioId,
			file: e.imagePath,
			sha256: sha(bytes),
			size: bytes.length,
		};
	});
	const producerBytes = readFileSync(D_PRODUCER);
	writeFileSync(join(dir, "producer-capture-manifest.json"), producerBytes);
	const pinRel = "unit-src/pin.txt";
	writeFileSync(join(repo, pinRel), "unit-only-src-pin-v1\n");
	const pinSha = sha(readFileSync(join(repo, pinRel)));
	const sourcePins = [{ path: pinRel, sha256: pinSha }];
	const digest = createHash("sha256")
		.update(sourcePins.map((p) => `${p.path}:${p.sha256}\n`).join(""))
		.digest("hex");
	writeFileSync(
		join(dir, "room-frames.manifest.json"),
		JSON.stringify(
			{
				schemaVersion: "openclinxr.room-frames-fixture.v1",
				generatedFrom: {
					captureManifestSha256: sha(producerBytes),
					capturedAt: "2026-10-29T17:25:02.085Z",
					captureCommit: "2bf85fa11f65998255434aa28892efac6e81b67f",
				},
				sourcePins,
				sourcePinsDigest: digest,
				entries,
			},
			null,
			2,
		),
	);
	return { dir, repo };
}

function mutate(ctx: Ctx, tag: string, fn: (dir: string) => void): Ctx {
	const out = join(UNIT_ROOT, tag);
	const dir = join(out, "unit-fixture");
	const repo = join(out, "unit-repo");
	rmSync(out, { recursive: true, force: true });
	cpSync(ctx.dir, dir, { recursive: true });
	cpSync(ctx.repo, repo, { recursive: true });
	fn(dir);
	return { dir, repo };
}

describe("room-frame-loader units", () => {
	it("(1) VALID BASELINE first: same validator accepts the unit fixture", () => {
		const ctx = buildUnit("base");
		const r = validateRoomFixture(ctx.dir, ctx.repo);
		expect(r.kind).toBe("fixture");
		expect(EXPECTED_COUNT).toBe(15);
	});

	it("(2) missing room refuses with count error", () => {
		const ctx = buildUnit("m-missing");
		const first = JSON.parse(
			readFileSync(join(ctx.dir, "room-frames.manifest.json"), "utf8"),
		).entries[0].file as string;
		const m = mutate(ctx, "m-missing-x", (d) => rmSync(join(d, first)));
		const r = validateRoomFixture(m.dir, m.repo);
		expect(r.kind).toBe("error");
		expect((r as { reason: string }).reason).toMatch(/count/);
	});

	it("(3) extra 16th room refuses", () => {
		const ctx = buildUnit("m-extra");
		const m = mutate(ctx, "m-extra-x", (d) =>
			cpSync(
				join(D_FRAMES, "adult_abdominal_pain_v1-room.png"),
				join(d, "intruder-room.png"),
			),
		);
		const r = validateRoomFixture(m.dir, m.repo);
		expect(r.kind).toBe("error");
		expect((r as { reason: string }).reason).toMatch(/count|extra/);
	});

	it("(4) wrong-name refuses with extra error", () => {
		const ctx = buildUnit("m-wrong");
		const man = JSON.parse(
			readFileSync(join(ctx.dir, "room-frames.manifest.json"), "utf8"),
		);
		const m = mutate(ctx, "m-wrong-x", (d) => {
			rmSync(join(d, man.entries[0].file));
			cpSync(join(d, man.entries[1].file), join(d, "renamed-room.png"));
		});
		const r = validateRoomFixture(m.dir, m.repo);
		expect(r.kind).toBe("error");
		expect((r as { reason: string }).reason).toMatch(/extra/);
	});

	it("(5) duplicate refuses", () => {
		const ctx = buildUnit("m-dup");
		const man = JSON.parse(
			readFileSync(join(ctx.dir, "room-frames.manifest.json"), "utf8"),
		);
		const m = mutate(ctx, "m-dup-x", (d) => {
			rmSync(join(d, man.entries[0].file));
			writeFileSync(
				join(d, man.entries[0].file),
				readFileSync(join(d, man.entries[1].file)),
			);
		});
		// Same byte content under two names: manifest id cross-check fails.
		const r = validateRoomFixture(m.dir, m.repo);
		expect(r.kind).toBe("error");
	});

	it("(6) corrupt PNG refuses via actual decode (size/hash updated to reach decode)", () => {
		const ctx = buildUnit("m-corrupt");
		const m = mutate(ctx, "m-corrupt-x", (d) => {
			const man = JSON.parse(
				readFileSync(join(d, "room-frames.manifest.json"), "utf8"),
			);
			const target = join(d, man.entries[0].file);
			const bytes = Buffer.from(readFileSync(target));
			bytes[8] = 0xff;
			bytes[9] = 0xd8;
			writeFileSync(target, bytes);
			man.entries[0].size = bytes.length;
			man.entries[0].sha256 = createHash("sha256").update(bytes).digest("hex");
			writeFileSync(
				join(d, "room-frames.manifest.json"),
				JSON.stringify(man, null, 2),
			);
		});
		const r = validateRoomFixture(m.dir, m.repo);
		expect(r.kind).toBe("error");
		expect((r as { reason: string }).reason).toMatch(/corrupt/);
	});

	it("(7) stale source refuses: unit src altered, old pin retained", () => {
		const ctx = buildUnit("m-stale");
		rmSync(join(UNIT_ROOT, "m-stale-x"), { recursive: true, force: true });
		cpSync(ctx.dir, join(UNIT_ROOT, "m-stale-x", "unit-fixture"), {
			recursive: true,
		});
		cpSync(ctx.repo, join(UNIT_ROOT, "m-stale-x", "unit-repo"), {
			recursive: true,
		});
		writeFileSync(
			join(UNIT_ROOT, "m-stale-x", "unit-repo", "unit-src", "pin.txt"),
			"changed-bytes\n",
		);
		const r = validateRoomFixture(
			join(UNIT_ROOT, "m-stale-x", "unit-fixture"),
			join(UNIT_ROOT, "m-stale-x", "unit-repo"),
		);
		expect(r.kind).toBe("error");
		expect((r as { reason: string }).reason).toMatch(/stale-source/);
	});

	it("(8) explicit branch: valid raw capture accepted, sidecars tolerated, bad explicit never falls back", () => {
		const raw = join(UNIT_ROOT, "explicit-raw");
		rmSync(raw, { recursive: true, force: true });
		mkdirSync(raw, { recursive: true });
		const prod = JSON.parse(readFileSync(D_PRODUCER, "utf8")) as {
			entries: Array<{ imagePath: string }>;
		};
		for (const e of prod.entries)
			cpSync(join(D_FRAMES, e.imagePath), join(raw, e.imagePath));
		cpSync(D_PRODUCER, join(raw, "capture-manifest.json"));
		writeFileSync(join(raw, "notes.json"), "{}");
		cpSync(
			join(D_FRAMES, "adult_abdominal_pain_v1-room.png"),
			join(raw, "adult_abdominal_pain_v1-overhead.png"),
		);
		const ok = resolveRoomFrameInput({
			explicitEnvDir: raw,
			fixtureDir: join(UNIT_ROOT, "does-not-matter"),
			repoRoot: join(UNIT_ROOT, "does-not-matter"),
		});
		expect(ok.kind).toBe("explicit");
		const bad = resolveRoomFrameInput({
			explicitEnvDir: "/nonexistent/dir-xyz",
			fixtureDir: buildUnit("m-explicit-fallback").dir,
			repoRoot: join(UNIT_ROOT, "does-not-matter"),
		});
		expect(bad.kind).toBe("error");
		const extraRoom = join(UNIT_ROOT, "explicit-extra-room");
		rmSync(extraRoom, { recursive: true, force: true });
		cpSync(raw, extraRoom, { recursive: true });
		cpSync(
			join(D_FRAMES, "adult_abdominal_pain_v1-room.png"),
			join(extraRoom, "intruder-room.png"),
		);
		expect(
			resolveRoomFrameInput({
				explicitEnvDir: extraRoom,
				fixtureDir: "",
				repoRoot: "",
			}).kind,
		).toBe("error");
	});

	it("(10) synthetic fixture refuses fake .env/private paths before any read", () => {
		const ctx = buildUnit("m-privacy");
		const man = JSON.parse(
			readFileSync(join(ctx.dir, "room-frames.manifest.json"), "utf8"),
		);
		for (const fake of ["../.env", ".bak/file-room.png"]) {
			void fake;
		}
		man.sourcePins.push({ path: ".env", sha256: "0".repeat(64) });
		man.sourcePins.push({
			path: "secrets/evil-room.png",
			sha256: "0".repeat(64),
		});
		writeFileSync(
			join(ctx.dir, "room-frames.manifest.json"),
			JSON.stringify(man, null, 2),
		);
		const r = validateRoomFixture(ctx.dir, ctx.repo);
		expect(r.kind).toBe("error");
		expect((r as { reason: string }).reason).toMatch(/stale-source-path/);
	});

	it("(9) second root re-evaluated fresh with no cache", () => {
		const a = buildUnit("root-a");
		const b = buildUnit("root-b");
		expect(validateRoomFixture(a.dir, a.repo).kind).toBe("fixture");
		expect(validateRoomFixture(b.dir, b.repo).kind).toBe("fixture");
		writeFileSync(join(b.repo, "unit-src", "pin.txt"), "drifted\n");
		expect(validateRoomFixture(b.dir, b.repo).kind).toBe("error");
		expect(validateRoomFixture(a.dir, a.repo).kind).toBe("fixture");
	});
});
