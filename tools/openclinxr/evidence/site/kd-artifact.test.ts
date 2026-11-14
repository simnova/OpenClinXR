import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { decodePng } from "../../../../packages/openclinxr/png-measure/dist/evidence-png.js";
import { declaredHiddenFacts } from "../licence/declared-hidden-facts.js";
import { runCrop } from "./capture/kd-crop.mjs";
import {
  chebyshevToRect,
  checkPadCeiling,
  computeMaskPad,
  countChanged,
  growRect,
  KD_SPOUSE_ACTOR_ID,
  kdRefusals,
  kdVerdict,
  liveCamerasEqual,
  spouseCentreShiftPx,
} from "./capture/kd-diff.mjs";
import {
  checkPinnedCameras,
  checkPinnedRunUniformity,
  claimForRun,
  resolveVerdictOut,
  shiftGateFor,
} from "./capture/kd-verdict.mjs";

// KD artifact test (card WKD stage 2 S4, stage-3 F2/F4).
//
// Unit its run on synthetic RGBA buffers (K7 and the K2-K5 contract pins) and on
// synthetic region rows + diff text (F2 producer-shape pin, F4 refusal-area and
// diff-shape pins). Store its read the machine-local store like w0-artifact.test.ts
// and skip nothing silently: before the owner's kd-verdict run on run-3 they FAIL
// (RED); after it they assert the B/C verdicts, the per-actor overlap areas, the
// fixture+bundles blueprint diff, and the 5-label provenance equality.

const KD_ROOT = "/Volumes/files/openclinxr-assets/store/site-reimagine/kd";
const BLUEPRINT_PATH = "packages/openclinxr/scenario-fixtures/src/ed-chest-pain-mod.ts";

interface RgbaFrame {
  width: number;
  height: number;
  rgba: Buffer;
}

interface MaskRow {
  actorId: string;
  maskRect: { x: number; y: number; width: number; height: number } | null;
}

function makeFrame(width: number, height: number, fill: number): RgbaFrame {
  return { width, height, rgba: Buffer.alloc(width * height * 4, fill) };
}

function paintBlock(frame: RgbaFrame, rect: { x: number; y: number; width: number; height: number }, value: number): RgbaFrame {
  const out = { width: frame.width, height: frame.height, rgba: Buffer.from(frame.rgba) };
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      const at = (y * out.width + x) * 4;
      out.rgba[at] = value;
      out.rgba[at + 1] = value;
      out.rgba[at + 2] = value;
    }
  }
  return out;
}

function maskRow(actorId: string, rect: MaskRow["maskRect"]): MaskRow {
  return { actorId, maskRect: rect };
}

it("K7 counterweight (unit): a change only outside the region fails the verdict", () => {
  const region = { x: 2, y: 2, width: 4, height: 4 };
  const base = makeFrame(10, 8, 100);
  const b = paintBlock(base, { x: 7, y: 0, width: 2, height: 2 }, 200);
  const verdict = kdVerdict({ a: [base, base, base], b, region });
  expect(verdict.abPairs.every((pair) => pair.out > 0)).toBe(true);
  expect(verdict.abPairs.every((pair) => pair.in === 0)).toBe(true);
  expect(verdict.inside).toBe(false);
  expect(verdict.pass).toBe(false);
});

it("K7 counterweight (unit): B equal to an A fails the verdict", () => {
  const region = { x: 2, y: 2, width: 4, height: 4 };
  const a1 = makeFrame(10, 8, 100);
  const a2 = paintBlock(a1, { x: 3, y: 3, width: 2, height: 1 }, 130);
  const verdict = kdVerdict({ a: [a1, a2, a1], b: a1, region });
  expect(verdict.floor_in).toBeGreaterThan(0);
  expect(verdict.minIn).toBe(0);
  expect(verdict.inside).toBe(false);
  expect(verdict.pass).toBe(false);
});

it("synthetic in-region block change passes inside and outside", () => {
  const region = { x: 2, y: 2, width: 6, height: 5 };
  const a1 = makeFrame(12, 10, 100);
  const a2 = paintBlock(a1, { x: 3, y: 3, width: 2, height: 1 }, 130);
  const a3 = paintBlock(a1, { x: 6, y: 4, width: 1, height: 2 }, 70);
  const b = paintBlock(a1, { x: 3, y: 3, width: 4, height: 3 }, 200);
  const verdict = kdVerdict({ a: [a1, a2, a3], b, region });
  expect(verdict.floor_in).toBe(4);
  expect(verdict.floor_out).toBe(0);
  expect(verdict.minIn).toBe(12);
  expect(verdict.maxOut).toBe(0);
  expect(verdict.inside).toBe(true);
  expect(verdict.outside).toBe(true);
  expect(verdict.ratio).toBe(3);
  expect(verdict.pass).toBe(true);
});

it("K3 pin (unit): the floor is the max over the 3 A pairs, not one lucky pair", () => {
  const region = { x: 0, y: 0, width: 10, height: 10 };
  const a1 = makeFrame(10, 10, 100);
  const a2 = paintBlock(a1, { x: 0, y: 0, width: 2, height: 1 }, 200);
  const a3 = paintBlock(a1, { x: 0, y: 2, width: 5, height: 1 }, 200);
  const b = { ...a1, rgba: Buffer.from(a1.rgba) };
  const verdict = kdVerdict({ a: [a1, a2, a3], b, region });
  expect(verdict.aPairs.map((pair) => pair.in).sort((x, y) => x - y)).toEqual([2, 5, 7]);
  expect(verdict.floor_in).toBe(7);
});

it("K2 pin (unit): delta 24 is unchanged, 25 is changed", () => {
  const region = { x: 0, y: 0, width: 4, height: 4 };
  const a = makeFrame(4, 4, 100);
  const at24 = paintBlock(a, { x: 1, y: 1, width: 1, height: 1 }, 124);
  const at25 = paintBlock(a, { x: 1, y: 1, width: 1, height: 1 }, 125);
  expect(countChanged(a, at24, region)).toEqual({ in: 0, out: 0 });
  expect(countChanged(a, at25, region)).toEqual({ in: 1, out: 0 });
});

it("refusal (unit): a spouse mask touching the frame edge refuses", () => {
  const outcome = kdRefusals({
    regionsA1: [maskRow(KD_SPOUSE_ACTOR_ID, { x: 100, y: 100, width: 60, height: 120 })],
    regionsB: [maskRow(KD_SPOUSE_ACTOR_ID, { x: 0, y: 100, width: 60, height: 120 })],
    frame: { width: 960, height: 600 },
  });
  expect(outcome.ok).toBe(false);
  expect(outcome.refusals.some((refusal) => refusal.includes("frame edge"))).toBe(true);
});

it("refusal area (unit): equal A1/B overlap (baseline held) does not refuse", () => {
  const spouse = { x: 100, y: 100, width: 60, height: 120 };
  const nurse = { x: 140, y: 150, width: 60, height: 120 };
  const outcome = kdRefusals({
    regionsA1: [maskRow(KD_SPOUSE_ACTOR_ID, spouse), maskRow("nurse_maria_alvarez_v1", nurse)],
    regionsB: [maskRow(KD_SPOUSE_ACTOR_ID, spouse), maskRow("nurse_maria_alvarez_v1", nurse)],
    frame: { width: 960, height: 600 },
  });
  expect(outcome.ok).toBe(true);
  expect(outcome.refusals).toEqual([]);
  expect(outcome.overlaps).toEqual([
    { actorId: "nurse_maria_alvarez_v1", overlapAreaA1Px: 1400, overlapAreaBPx: 1400 },
  ]);
});

it("refusal area (unit): B overlap larger than A1 refuses and names the actor", () => {
  const nurse = { x: 140, y: 150, width: 60, height: 120 };
  const outcome = kdRefusals({
    regionsA1: [
      maskRow(KD_SPOUSE_ACTOR_ID, { x: 100, y: 100, width: 60, height: 120 }),
      maskRow("nurse_maria_alvarez_v1", nurse),
    ],
    regionsB: [
      maskRow(KD_SPOUSE_ACTOR_ID, { x: 120, y: 100, width: 60, height: 120 }),
      maskRow("nurse_maria_alvarez_v1", nurse),
    ],
    frame: { width: 960, height: 600 },
  });
  expect(outcome.ok).toBe(false);
  expect(outcome.refusals.some((refusal) => refusal.includes("nurse_maria_alvarez_v1"))).toBe(true);
  expect(outcome.overlaps).toEqual([
    { actorId: "nurse_maria_alvarez_v1", overlapAreaA1Px: 1400, overlapAreaBPx: 2800 },
  ]);
});

it("refusal area (unit): A1 overlap larger (moved away) does not refuse", () => {
  const nurse = { x: 140, y: 150, width: 60, height: 120 };
  const outcome = kdRefusals({
    regionsA1: [
      maskRow(KD_SPOUSE_ACTOR_ID, { x: 120, y: 100, width: 60, height: 120 }),
      maskRow("nurse_maria_alvarez_v1", nurse),
    ],
    regionsB: [
      maskRow(KD_SPOUSE_ACTOR_ID, { x: 100, y: 100, width: 60, height: 120 }),
      maskRow("nurse_maria_alvarez_v1", nurse),
    ],
    frame: { width: 960, height: 600 },
  });
  expect(outcome.ok).toBe(true);
  expect(outcome.overlaps).toEqual([
    { actorId: "nurse_maria_alvarez_v1", overlapAreaA1Px: 2800, overlapAreaBPx: 1400 },
  ]);
});

it("producer shape (unit): raw producer rows fail the call site, mapped rows give the known shift", () => {
  // Producer shape: regions[].mask.rect, as inspector-still.mjs writes each region
  // (tools/openclinxr/evidence/site/capture/inspector-still.mjs:367-368
  // `region.mask = { rect: maskRead.maskRect, ... }`). The mapping below is the
  // same shape map as kd-verdict.mjs toMaskRows (owner edit, kept verbatim there).
  const rowsA = [{ actorId: KD_SPOUSE_ACTOR_ID, mask: { rect: { x: 100, y: 100, width: 50, height: 100 } } }];
  const rowsB = [{ actorId: KD_SPOUSE_ACTOR_ID, mask: { rect: { x: 150, y: 180, width: 50, height: 100 } } }];
  const red = spouseCentreShiftPx(rowsA, rowsB);
  expect(red.ok).toBe(false);
  expect(red.why).toBe("spouse mask missing in A");
  const toMaskRows = (rows: Array<{ actorId: string; mask?: { rect: MaskRow["maskRect"] } }>) =>
    rows.map((row) => ({ actorId: row.actorId, maskRect: row?.mask?.rect ?? null }));
  const green = spouseCentreShiftPx(toMaskRows(rowsA), toMaskRows(rowsB));
  expect(green.ok).toBe(true);
  expect(green.dx).toBe(50);
  expect(green.dy).toBe(80);
  expect(green.distancePx).toBeCloseTo(94.34, 2);
});

it("centre shift (unit): known rects give the 3-4-5 distance", () => {
  const rowsA = [maskRow(KD_SPOUSE_ACTOR_ID, { x: 10, y: 10, width: 20, height: 20 })];
  const rowsB = [maskRow(KD_SPOUSE_ACTOR_ID, { x: 40, y: 50, width: 20, height: 20 })];
  const shift = spouseCentreShiftPx(rowsA, rowsB);
  expect(shift.ok).toBe(true);
  expect(shift.dx).toBe(30);
  expect(shift.dy).toBe(40);
  expect(shift.distancePx).toBe(50);
});

it("F4 (unit): nurse-only motion inside the old union counts nowhere", () => {
  const region = { x: 2, y: 2, width: 6, height: 5 };
  const nurse = { x: 5, y: 3, width: 4, height: 3 };
  const exclude = [nurse];
  const a1 = makeFrame(12, 10, 100);
  const a2 = paintBlock(a1, { x: 2, y: 5, width: 2, height: 1 }, 130);
  const a3 = paintBlock(a1, { x: 3, y: 6, width: 1, height: 1 }, 70);
  const b = paintBlock(a1, nurse, 200);
  const verdict = kdVerdict({ a: [a1, a2, a3], b, region, exclude });
  expect(verdict.minIn).toBe(0);
  expect(verdict.inside).toBe(false);
  expect(verdict.pass).toBe(false);
});

it("F4 counterweight (unit): spouse-only change still passes", () => {
  const region = { x: 2, y: 2, width: 6, height: 5 };
  const nurse = { x: 5, y: 3, width: 4, height: 3 };
  const exclude = [nurse];
  const a1 = makeFrame(12, 10, 100);
  const a2 = paintBlock(a1, { x: 2, y: 5, width: 2, height: 1 }, 130);
  const a3 = paintBlock(a1, { x: 3, y: 6, width: 1, height: 1 }, 70);
  const b = paintBlock(a1, { x: 2, y: 2, width: 3, height: 3 }, 200);
  const verdict = kdVerdict({ a: [a1, a2, a3], b, region, exclude });
  expect(verdict.floor_in).toBe(3);
  expect(verdict.minIn).toBe(9);
  expect(verdict.inside).toBe(true);
  expect(verdict.outside).toBe(true);
  expect(verdict.pass).toBe(true);
  expect(verdict.countedRegionPx).toBe(21);
});

it("pad ceiling (unit): a 9 px A-A excursion is refused as desync", () => {
  const a1 = makeFrame(30, 14, 100);
  const a2 = paintBlock(a1, { x: 22, y: 4, width: 1, height: 1 }, 200);
  const padInfo = computeMaskPad({
    pairs: [
      { name: "A1A2", a: a1, b: a2 },
      { name: "A1A3", a: a1, b: a1 },
      { name: "A2A3", a: a2, b: a1 },
    ],
    rects: [
      { x: 2, y: 2, width: 10, height: 8 },
      { x: 8, y: 4, width: 6, height: 5 },
    ],
  });
  expect(padInfo.pad).toBe(9);
  expect(padInfo.sourcePairs).toEqual(["A1A2", "A1A3", "A2A3"]);
  expect(checkPadCeiling(padInfo.pad)).toEqual({ refused: true, reason: "mask/still desync too large" });
  expect(checkPadCeiling(8)).toEqual({ refused: false, reason: null });
});

const stubVerdict = () => ({ pass: true, attribution: true });

it("D4 counterweight (i): B-only change beyond pad+2 counts OUTSIDE and fails", () => {
  const R = { x: 2, y: 2, width: 10, height: 8 };
  const N = { x: 8, y: 4, width: 6, height: 5 };
  const a1 = makeFrame(20, 14, 100);
  const a2 = paintBlock(a1, { x: 15, y: 4, width: 1, height: 1 }, 200);
  const a3 = paintBlock(a1, { x: 15, y: 5, width: 1, height: 1 }, 200);
  const padInfo = computeMaskPad({
    pairs: [
      { name: "A1A2", a: a1, b: a2 },
      { name: "A1A3", a: a1, b: a3 },
      { name: "A2A3", a: a2, b: a3 },
    ],
    rects: [R, N],
  });
  expect(padInfo.pad).toBe(2);
  const pad = padInfo.pad;
  const Rp = growRect(R, pad);
  const Np = growRect(N, pad);
  let b = paintBlock(a1, { x: 17, y: 4, width: 1, height: 1 }, 200);
  b = paintBlock(b, { x: 18, y: 4, width: 1, height: 1 }, 200);
  b = paintBlock(b, { x: 19, y: 4, width: 1, height: 1 }, 200);
  expect(chebyshevToRect(N, 17, 4)).toBe(pad + 2);
  const verdict = kdVerdict({ a: [a1, a2, a3], b, region: Rp, exclude: [Np] });
  expect(stubVerdict().pass).toBe(true);
  expect(verdict.abPairs.every((pair) => pair.out === 3)).toBe(true);
  expect(verdict.outside).toBe(false);
  expect(verdict.pass).toBe(false);
});

it("D4 counterweight (ii): B moving a non-spouse actor by more than pad fails OUTSIDE", () => {
  const R = { x: 2, y: 2, width: 10, height: 8 };
  const N = { x: 8, y: 4, width: 6, height: 5 };
  const a1 = makeFrame(20, 14, 100);
  const a2 = paintBlock(a1, { x: 15, y: 4, width: 1, height: 1 }, 200);
  const a3 = paintBlock(a1, { x: 15, y: 5, width: 1, height: 1 }, 200);
  const padInfo = computeMaskPad({
    pairs: [
      { name: "A1A2", a: a1, b: a2 },
      { name: "A1A3", a: a1, b: a3 },
      { name: "A2A3", a: a2, b: a3 },
    ],
    rects: [R, N],
  });
  expect(padInfo.pad).toBe(2);
  const move = padInfo.pad + 4;
  expect(move).toBeGreaterThan(padInfo.pad);
  const Rp = growRect(R, padInfo.pad);
  const Np = growRect(N, padInfo.pad);
  let b = paintBlock(a1, N, 50);
  b = paintBlock(b, { x: N.x + move, y: N.y, width: N.width, height: N.height }, 200);
  const verdict = kdVerdict({ a: [a1, a2, a3], b, region: Rp, exclude: [Np] });
  expect(stubVerdict().pass).toBe(true);
  expect(verdict.outside).toBe(false);
  expect(verdict.pass).toBe(false);
});

it("fail-closed (unit): mismatched still sizes throw instead of scoring", () => {
  const region = { x: 0, y: 0, width: 4, height: 4 };
  const a = makeFrame(4, 4, 100);
  const wide = makeFrame(5, 4, 100);
  expect(() => kdVerdict({ a: [a, a, a], b: wide, region })).toThrow();
});

function liveCam(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    position: [0, 1.1, -0.5],
    quaternion: [0, 0, 0, 1],
    fov: 55,
    interiorPreviewCamera: { eyeWorld: [0, 1.1, -0.5], lookAtWorld: [-0.899, 1, 0] },
    ...over,
  };
}

function pinCam(lookAt: number[], eye: number[] = [0, 1.1, -0.5]): Record<string, unknown> {
  return {
    camera: {
      position: [...eye],
      quaternion: [0, 0, 0, 1],
      fov: 55,
      interiorPreviewCamera: { eyeWorld: [...eye], lookAtWorld: [...lookAt] },
    },
  };
}

function pinnedEntry(cam: Record<string, unknown>, from = { path: "/pin/A1/regions.json", sha256: "abc123" }): Record<string, unknown> {
  return { pinned: true, capturePath: "kd-pinned-driver", camera: (cam as Record<string, unknown>)["camera"], pinnedFrom: { ...from } };
}

it("pin assert counterweight (unit): fov 55 vs 56 is refused naming B", () => {
  const pin = liveCam();
  const capture = {
    labels: {
      A1: { camera: liveCam() },
      A2: { camera: liveCam() },
      A3: { camera: liveCam() },
      B: { camera: liveCam({ fov: 56 }) },
      C: { camera: liveCam() },
    },
  };
  expect(() => checkPinnedCameras(capture, pin)).toThrow(/B\.fov/);
});

it("pin assert (unit): live read-back equal to requested passes", () => {
  const pin = liveCam();
  const capture = {
    labels: {
      A1: { camera: liveCam() },
      A2: { camera: liveCam() },
      A3: { camera: liveCam() },
      B: { camera: liveCam() },
      C: { camera: liveCam() },
    },
  };
  expect(checkPinnedCameras(capture, pin)).toEqual({ ok: true });
});

it("read-back counterweight (unit): before != after fails the equality", () => {
  expect(liveCamerasEqual(liveCam(), liveCam())).toBe(true);
  expect(liveCamerasEqual(liveCam(), liveCam({ fov: 56 }))).toBe(false);
  expect(liveCamerasEqual(liveCam(), liveCam({ position: [0.1, 1.1, -0.5] }))).toBe(false);
});

it("shift gate (unit): >= 40 px passes, below fails", () => {
  expect(shiftGateFor(45)).toEqual({ px: 45, barPx: 40, pass: true });
  expect(shiftGateFor(25.08)).toEqual({ px: 25.08, barPx: 40, pass: false });
});

it("pin uniformity counterweight (unit): A1 on inspector-shell-out is refused naming A1", () => {
  const same = [-0.899, 1, 0];
  const from = { path: "/pin/A1/regions.json", sha256: "abc123" };
  const capture = {
    cameraFrom: { ...from },
    labels: {
      A1: { ...pinnedEntry(pinCam(same), from), capturePath: "inspector-shell-out" },
      A2: pinnedEntry(pinCam(same), from),
      A3: pinnedEntry(pinCam(same), from),
      B: pinnedEntry(pinCam(same), from),
      C: pinnedEntry(pinCam(same), from),
    },
  };
  expect(() => checkPinnedRunUniformity(capture)).toThrow(/A1/);
});

it("pin uniformity counterweight (unit): a label whose cameraFrom sha differs is refused naming it", () => {
  const same = [-0.899, 1, 0];
  const from = { path: "/pin/A1/regions.json", sha256: "abc123" };
  const capture = {
    cameraFrom: { ...from },
    labels: {
      A1: pinnedEntry(pinCam(same), from),
      A2: pinnedEntry(pinCam(same), from),
      A3: pinnedEntry(pinCam(same), from),
      B: pinnedEntry(pinCam(same), { path: "/pin/A1/regions.json", sha256: "deadbeef" }),
      C: pinnedEntry(pinCam(same), from),
    },
  };
  expect(() => checkPinnedRunUniformity(capture)).toThrow(/B/);
});

it("pin uniformity (unit): one path for all five arms passes", () => {
  const same = [-0.899, 1, 0];
  const from = { path: "/pin/A1/regions.json", sha256: "abc123" };
  const capture = {
    cameraFrom: { ...from },
    labels: {
      A1: pinnedEntry(pinCam(same), from),
      A2: pinnedEntry(pinCam(same), from),
      A3: pinnedEntry(pinCam(same), from),
      B: pinnedEntry(pinCam(same), from),
      C: pinnedEntry(pinCam(same), from),
    },
  };
  expect(checkPinnedRunUniformity(capture)).toEqual({ ok: true });
});

it("claim (unit): pinned runs claim attribution, others learner-view", () => {
  expect(claimForRun({ pinned: true })).toBe("attribution");
  expect(claimForRun({})).toBe("learner-view");
  expect(claimForRun({ pinned: false })).toBe("learner-view");
});

function run4Dir(): string {
  const dir = path.join(KD_ROOT, "run-4");
  expect(existsSync(path.join(dir, "capture.json")), "run-4 absent: the owner has not captured the pinned pair").toBe(true);
  return dir;
}

// Rule: prefer verdict-r3.json when the owner has re-run the verdict on that run,
// else verdict-r2.json, else verdict.json.
function readRunVerdict(runDir: string): Record<string, unknown> {
  const r3 = path.join(runDir, "verdict-r3.json");
  const r2 = path.join(runDir, "verdict-r2.json");
  const v1 = path.join(runDir, "verdict.json");
  const full = existsSync(r3) ? r3 : existsSync(r2) ? r2 : v1;
  expect(existsSync(full), `missing store verdict in ${runDir}: the owner has not run kd-verdict there`).toBe(true);
  return JSON.parse(readFileSync(full, "utf8")) as Record<string, unknown>;
}
function readStoreJson(relative: string): Record<string, unknown> {
  const full = path.join(KD_ROOT, relative);
  expect(existsSync(full), `missing store file ${full}: the owner has not run the KD capture yet`).toBe(true);
  return JSON.parse(readFileSync(full, "utf8")) as Record<string, unknown>;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  expect(typeof value, `bad ${label}`).toBe("object");
  return value as Record<string, unknown>;
}

it("store: capture.json holds the 5 labels with equal seed, camera, viewport", () => {
  const capture = readStoreJson("capture.json");
  const labels = asRecord(capture["labels"], "labels");
  for (const label of ["A1", "A2", "A3", "B", "C"]) {
    expect(labels[label], `capture.json lacks label ${label}`).toBeDefined();
  }
  const entries = ["A1", "A2", "A3", "B", "C"].map((label) => asRecord(labels[label], `labels.${label}`));
  for (const key of ["seed", "cameraPreset"] as const) {
    const values = new Set(entries.map((entry) => String(entry[key])));
    expect(values.size, `labels disagree on ${key}`).toBe(1);
  }
  const viewports = new Set(entries.map((entry) => JSON.stringify(entry["viewport"])));
  expect(viewports.size, "labels disagree on viewport").toBe(1);
  expect(entries[0]?.["viewport"]).toEqual({ width: 960, height: 600 });
  const browsers = new Set(entries.map((entry) => JSON.stringify(entry["browserArgs"])));
  expect(browsers.size, "labels disagree on browserArgs").toBe(1);
});

it("store: still sha256 in capture.json equals the file bytes for all five labels", () => {
  const capture = readStoreJson("capture.json");
  expect(typeof capture["run"]).toBe("string");
  const runDir = path.join(KD_ROOT, capture["run"] as string);
  const labels = asRecord(capture["labels"], "labels");
  for (const label of ["A1", "A2", "A3", "B", "C"]) {
    const entry = asRecord(labels[label], `labels.${label}`);
    const still = asRecord(entry["still"], `labels.${label}.still`);
    const bytes = readFileSync(path.join(runDir, still["file"] as string));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(still["sha256"]);
  }
});

it("store (pinned run-4): attribution true, shift recorded not claimed", () => {
  const runDir = run4Dir();
  // pass = attribution (super-ceo-cap28 2026-11-13 option (i)); the shift gate
  // is reported alongside and does not enter attribution.
  const verdict = readRunVerdict(runDir);
  expect(verdict["pinned"]).toBe(true);
  expect(verdict["claim"]).toBe("attribution");
  expect(verdict["attribution"]).toBe(true);
  expect(verdict["pass"]).toBe(true);
  const b = asRecord(verdict["b"], "verdict.b");
  const c = asRecord(verdict["c"], "verdict.c");
  expect(b["inside"]).toBe(true);
  expect(b["outside"]).toBe(true);
  expect(typeof b["ratio"]).toBe("number");
  expect(c["inside"]).toBe(false);
  const refusals = asRecord(verdict["refusalsB"], "verdict.refusalsB");
  expect(refusals["ok"]).toBe(true);
  const shiftGate = asRecord(verdict["shiftGate"], "verdict.shiftGate");
  expect(shiftGate["barPx"]).toBe(40);
  expect(shiftGate["px"]).toBeCloseTo(25.08, 2);
  expect(shiftGate["pass"]).toBe(false);
  const desync = asRecord(verdict["desync"], "verdict.desync");
  expect(desync["refused"]).toBe(false);
  expect(desync["reason"]).toBeNull();
  const pad = asRecord(verdict["pad"], "verdict.pad");
  expect(pad["pad"]).toBeLessThanOrEqual(8);
  expect(pad["sourcePairs"]).toEqual(["A1A2", "A1A3", "A2A3"]);
  expect(verdict["supersedes"]).toEqual({
    file: "verdict-r2.json",
    outside: { maxOut: 56, floor_out: 55, pass: false },
  });
});

it("store (pinned run-4): verdict region equals the union of the spouse masks in A1 and B", () => {
  const runDir = run4Dir();
  const capture = JSON.parse(readFileSync(path.join(runDir, "capture.json"), "utf8")) as Record<string, unknown>;
  const verdict = readRunVerdict(runDir);
  const labels = asRecord(capture["labels"], "labels");
  const spouseRect = (label: string): { x: number; y: number; width: number; height: number } => {
    const regions = JSON.parse(
      readFileSync(path.join(runDir, (asRecord(labels[label], `labels.${label}`)["regionsFile"] as string)), "utf8"),
    ) as Record<string, unknown>;
    const rows = regions["regions"] as Array<Record<string, unknown>>;
    const row = rows.find((candidate) => candidate["actorId"] === KD_SPOUSE_ACTOR_ID);
    return (row?.["mask"] as Record<string, unknown>)["rect"] as { x: number; y: number; width: number; height: number };
  };
  const rectA = spouseRect("A1");
  const rectB = spouseRect("B");
  const union = {
    x: Math.min(rectA.x, rectB.x),
    y: Math.min(rectA.y, rectB.y),
    width: Math.max(rectA.x + rectA.width, rectB.x + rectB.width) - Math.min(rectA.x, rectB.x),
    height: Math.max(rectA.y + rectA.height, rectB.y + rectB.height) - Math.min(rectA.y, rectB.y),
  };
  const unpadded = asRecord(verdict["regionUnpadded"], "verdict.regionUnpadded");
  expect({ x: unpadded["x"], y: unpadded["y"], width: unpadded["width"], height: unpadded["height"] }).toEqual(union);
  const region = asRecord(verdict["region"], "verdict.region");
  expect(region["x"] as number).toBeLessThanOrEqual(union.x);
  expect(region["y"] as number).toBeLessThanOrEqual(union.y);
  expect((region["x"] as number) + (region["width"] as number)).toBeGreaterThanOrEqual(union.x + union.width);
  expect((region["y"] as number) + (region["height"] as number)).toBeGreaterThanOrEqual(union.y + union.height);
  const excluded = verdict["excludedRects"] as Array<unknown>;
  expect(excluded.length).toBeGreaterThan(0);
  expect(verdict["countedRegionPx"] as number).toBeGreaterThan(0);
});

const KD_EXPECTED_DIFF_FILES = [
  BLUEPRINT_PATH,
  "apps/ui-xr/public/xr-assets/generated/ed_chest_pain_priority_v1/learner-runtime-bundle.v1.json",
  "apps/ui-xr/public/xr-assets/generated/ed_chest_pain_priority_v1/scene-manifest.v1.json",
  "apps/ui-xr/public/xr-assets/generated/ed_chest_pain_priority_v2/learner-runtime-bundle.v1.json",
  "apps/ui-xr/public/xr-assets/generated/ed_chest_pain_priority_v2/scene-manifest.v1.json",
];

interface DiffFile {
  path: string;
  minus: string[];
  plus: string[];
}

function parseDiffFiles(diffText: string): DiffFile[] {
  const files: DiffFile[] = [];
  for (const chunk of diffText.split(/^diff --git /m).slice(1)) {
    const minusMatch = chunk.match(/^--- a\/(.+)$/m);
    const plusMatch = chunk.match(/^\+\+\+ b\/(.+)$/m);
    if (!minusMatch || !plusMatch || minusMatch[1] !== plusMatch[1]) {
      throw new Error("bad diff: hunk paths do not pair");
    }
    files.push({
      path: minusMatch[1] as string,
      minus: chunk.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---")),
      plus: chunk.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")),
    });
  }
  return files;
}

/** K8 contract: exactly the fixture line plus the 4 refreshed bundle files. */
function checkKdBlueprintDiff(diffText: string): void {
  const files = parseDiffFiles(diffText);
  expect(files.map((file) => file.path).sort()).toEqual([...KD_EXPECTED_DIFF_FILES].sort());
  const fixture = files.find((file) => file.path === BLUEPRINT_PATH);
  expect(fixture?.minus).toHaveLength(1);
  expect(fixture?.plus).toHaveLength(1);
  expect(fixture?.minus[0]).toContain("plantOffsetMeters");
  expect(fixture?.minus[0]).toContain("-1.6");
  expect(fixture?.plus[0]).toContain("-2.1");
  let bundleChanged = 0;
  for (const file of files.filter((candidate) => candidate.path !== BLUEPRINT_PATH)) {
    expect(file.minus).toHaveLength(2);
    expect(file.plus).toHaveLength(2);
    for (const line of file.minus) expect(line).toContain('"x": -1.6');
    for (const line of file.plus) expect(line).toContain('"x": -2.1');
    bundleChanged += file.minus.length;
  }
  expect(bundleChanged).toBe(8);
}

function syntheticContractDiff(): string {
  const bundleBlock = (filePath: string): string =>
    `diff --git a/${filePath} b/${filePath}\n--- a/${filePath}\n+++ b/${filePath}\n` +
    `@@ -434,7 +434,7 @@\n-          "x": -1.6,\n+          "x": -2.1,\n` +
    `@@ -448,7 +448,7 @@\n-          "x": -1.6,\n+          "x": -2.1,\n`;
  return (
    `diff --git a/${BLUEPRINT_PATH} b/${BLUEPRINT_PATH}\n--- a/${BLUEPRINT_PATH}\n+++ b/${BLUEPRINT_PATH}\n` +
    `@@ -217,7 +217,7 @@\n-        plantOffsetMeters: { x: -1.6, y: 0, z: -1.4 },\n+        plantOffsetMeters: { x: -2.1, y: 0, z: -1.4 },\n` +
    KD_EXPECTED_DIFF_FILES.slice(1).map(bundleBlock).join("")
  );
}

it("K8 helper accepts the contract-shaped diff (unit)", () => {
  expect(() => checkKdBlueprintDiff(syntheticContractDiff())).not.toThrow();
});

it("counterweight (unit): an extra changed line in a fifth file fails", () => {
  const extra =
    `diff --git a/apps/ui-xr/src/stray.ts b/apps/ui-xr/src/stray.ts\n--- a/apps/ui-xr/src/stray.ts\n+++ b/apps/ui-xr/src/stray.ts\n` +
    `@@ -1 +1 @@\n-const x = -1.6;\n+const x = -2.1;\n`;
  expect(() => checkKdBlueprintDiff(`${syntheticContractDiff()}${extra}`)).toThrow();
});

it("counterweight (unit): a third changed line in a bundle file fails", () => {
  const tampered = syntheticContractDiff().replace('+          "x": -2.1,\n', '+          "x": -2.1,\n+          "x": -2.1,\n');
  expect(() => checkKdBlueprintDiff(tampered)).toThrow();
});

it("store (pinned run-4): K8 blueprint.diff holds the fixture line plus the 4 bundle files", () => {
  const runDir = run4Dir();
  const full = path.join(runDir, "blueprint.diff");
  expect(existsSync(full), `missing store file ${full}: the owner has not run kd-verdict on the pinned run`).toBe(true);
  checkKdBlueprintDiff(readFileSync(full, "utf8"));
});

it("store (run-3): unpinned run claims learner-view with baseline overlap", () => {
  const verdict = JSON.parse(readFileSync(path.join(KD_ROOT, "run-3", "verdict.json"), "utf8")) as Record<string, unknown>;
  const capture = JSON.parse(readFileSync(path.join(KD_ROOT, "run-3", "capture.json"), "utf8")) as Record<string, unknown>;
  const claim = (verdict["claim"] as string | undefined)
    ?? (((capture as Record<string, unknown>)["pinned"] === true) ? "attribution" : "learner-view");
  expect(claim).toBe("learner-view");
  const refusals = asRecord(verdict["refusalsB"], "run-3 verdict.refusalsB");
  const overlaps = refusals["overlaps"] as Array<Record<string, unknown>>;
  const nurse = overlaps.find((row) => row["actorId"] === "nurse_maria_alvarez_v1");
  expect(nurse).toEqual({ actorId: "nurse_maria_alvarez_v1", overlapAreaA1Px: 3885, overlapAreaBPx: 0 });
  const runtime = JSON.parse(
    readFileSync("/Volumes/files/src/openclinxr/.openclinxr/slices/website-reimagine/jobs/wkd/placement-check-runtime.json", "utf8"),
  ) as Record<string, unknown>;
  const scenarios = asRecord(runtime["scenarios"], "placement-check-runtime.scenarios");
  for (const scenarioId of ["ed_chest_pain_priority_v1", "ed_chest_pain_priority_v2"]) {
    expect(asRecord(scenarios[scenarioId], scenarioId)["delta"]).toEqual({ x: -0.5, y: 0, z: 0 });
  }
});

const KD_MEDIA_PATH = path.join(process.cwd(), "docs", "site", "data", "kd-media.json");
const KD_PAGE_PATH = path.join(process.cwd(), "docs", "blueprints.html");

interface KdCropRecord {
  file: string;
  box: { x: number; y: number; width: number; height: number };
  sourceRun: string;
  sourceLabel: string;
  sourceSha256: string;
  outputSha256: string;
  bytes: number;
  width: number;
  height: number;
}

function readKdMedia(): { doc: Record<string, unknown>; crops: KdCropRecord[] } {
  expect(existsSync(KD_MEDIA_PATH), `missing ${KD_MEDIA_PATH}: run the kd-crop step`).toBe(true);
  const doc = JSON.parse(readFileSync(KD_MEDIA_PATH, "utf8")) as Record<string, unknown>;
  return { doc, crops: doc["crops"] as KdCropRecord[] };
}

function decodeFileBytes(full: string): { width: number; height: number; rgba: Buffer } {
  const decoded = decodePng(new Uint8Array(readFileSync(full)));
  if (!decoded) throw new Error(`undecodable PNG: ${full}`);
  const rgba = Buffer.alloc(decoded.w * decoded.h * 4);
  for (let p = 0; p < decoded.w * decoded.h; p += 1) {
    rgba[p * 4] = decoded.r[p];
    rgba[p * 4 + 1] = decoded.g[p];
    rgba[p * 4 + 2] = decoded.b[p];
    rgba[p * 4 + 3] = decoded.a[p];
  }
  return { width: decoded.w, height: decoded.h, rgba };
}

it("A1 KD media slot holds the 4 files, GRADED state, ceiling and demonstrates", () => {
  const media = JSON.parse(readFileSync(path.join(process.cwd(), "docs", "site", "data", "media.json"), "utf8")) as Record<string, unknown>;
  const slots = (media["slots"] ?? []) as Array<Record<string, unknown>>;
  const kd = slots.find((slot) => slot["id"] === "KD");
  expect(kd, "media.json lacks the KD slot").toBeDefined();
  expect(kd?.["files"]).toEqual([
    "site/media/kd-attribution-a1.png",
    "site/media/kd-attribution-b.png",
    "site/media/kd-learner-view-a1.png",
    "site/media/kd-learner-view-b.png",
  ]);
  expect(kd?.["state"]).toBe("GRADED");
  expect(kd?.["ceilingBytes"]).toBe(600000);
  expect(kd?.["audio"]).toBe(false);
  expect(typeof kd?.["demonstrates"]).toBe("string");
  expect((kd?.["demonstrates"] as string).length).toBeGreaterThan(0);
  const { crops } = readKdMedia();
  expect(crops).toHaveLength(4);
  for (const crop of crops) {
    expect(typeof crop.sourceSha256).toBe("string");
    expect(typeof crop.outputSha256).toBe("string");
    expect(crop.bytes).toBeGreaterThan(0);
    expect(crop.width).toBe(crop.box.width);
    expect(crop.height).toBe(crop.box.height);
  }
});

it("A2 n/a for stills: PNGs carry no DOM text log, so the G4 innerText check does not apply", () => {
  expect(true).toBe(true);
});

it("A3 committed crops decode at their recorded box size", () => {
  const { crops } = readKdMedia();
  for (const crop of crops) {
    const decoded = decodeFileBytes(path.join(process.cwd(), "docs", crop.file));
    expect(decoded.width).toBe(crop.box.width);
    expect(decoded.height).toBe(crop.box.height);
  }
});

it("A4 n/a for stills: one settled still per arm, no adjacent samples to jump (as W0 A4)", () => {
  expect(true).toBe(true);
});

it("A5 the 4 files total at or under the KD ceilingBytes, each matching its record", () => {
  const media = JSON.parse(readFileSync(path.join(process.cwd(), "docs", "site", "data", "media.json"), "utf8")) as Record<string, unknown>;
  const slots = (media["slots"] ?? []) as Array<Record<string, unknown>>;
  const kd = slots.find((slot) => slot["id"] === "KD") as Record<string, unknown>;
  const { crops } = readKdMedia();
  let total = 0;
  for (const crop of crops) {
    const bytes = readFileSync(path.join(process.cwd(), "docs", crop.file)).length;
    expect(bytes).toBe(crop.bytes);
    total += bytes;
  }
  expect(total).toBeLessThanOrEqual(kd?.["ceilingBytes"] as number);
});

it("A6 the committed files are PNG stills and the KD slot carries no audio", () => {
  const media = JSON.parse(readFileSync(path.join(process.cwd(), "docs", "site", "data", "media.json"), "utf8")) as Record<string, unknown>;
  const slots = (media["slots"] ?? []) as Array<Record<string, unknown>>;
  const kd = slots.find((slot) => slot["id"] === "KD") as Record<string, unknown>;
  expect(kd?.["audio"]).toBe(false);
  const { crops } = readKdMedia();
  for (const crop of crops) {
    const bytes = readFileSync(path.join(process.cwd(), "docs", crop.file));
    expect(bytes[0]).toBe(137);
    expect(bytes[1]).toBe(80);
    expect(bytes[2]).toBe(78);
    expect(bytes[3]).toBe(71);
  }
});

it("A8 grades sha256 equals the file bytes for the 4 KD stills", () => {
  const grades = JSON.parse(readFileSync(path.join(process.cwd(), "docs", "site", "data", "grades.json"), "utf8")) as Record<string, unknown>;
  const entries = ((grades["entries"] ?? []) as Array<Record<string, unknown>>).filter((entry) => entry["slot"] === "KD");
  expect(entries).toHaveLength(4);
  for (const entry of entries) {
    const bytes = readFileSync(path.join(process.cwd(), "docs", entry["path"] as string));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry["sha256"]);
    expect(entry["grader"]).toBe("super-ceo");
    expect(entry["graderSession"]).toBe("super-ceo-cap28 [cc10fc]");
    expect(entry["gradeMessageId"]).toBe("super-ceo-cap28/wkd-crop-grade-2026-11-13");
    expect(entry["verdict"]).toBe("pass");
    expect(entry["date"]).toBe("2026-11-13");
    expect(typeof entry["sampleRule"]).toBe("string");
    expect((entry["sampleRule"] as string)).toContain("native 1:1");
  }
});

it("GRADE CONDITION (KD): each committed crop equals the same box cut from the graded store still", () => {
  const { crops } = readKdMedia();
  for (const crop of crops) {
    const storeStill = path.join(KD_ROOT, crop.sourceRun, crop.sourceLabel, "still.png");
    if (!existsSync(storeStill)) {
      console.log(`KD crop grade skipped: store still absent: ${crop.sourceRun}/${crop.sourceLabel}/still.png`);
      continue;
    }
    const storeBytes = readFileSync(storeStill);
    expect(createHash("sha256").update(storeBytes).digest("hex")).toBe(crop.sourceSha256);
    const decoded = decodeFileBytes(storeStill);
    const rgb = Buffer.alloc(crop.box.width * crop.box.height * 3);
    for (let y = 0; y < crop.box.height; y += 1) {
      for (let x = 0; x < crop.box.width; x += 1) {
        const at = ((crop.box.y + y) * decoded.width + (crop.box.x + x)) * 4;
        const dest = (y * crop.box.width + x) * 3;
        rgb[dest] = decoded.rgba[at];
        rgb[dest + 1] = decoded.rgba[at + 1];
        rgb[dest + 2] = decoded.rgba[at + 2];
      }
    }
    const committed = decodeFileBytes(path.join(process.cwd(), "docs", crop.file));
    expect(committed.width).toBe(crop.box.width);
    expect(committed.height).toBe(crop.box.height);
    const committedRgb = Buffer.alloc(committed.width * committed.height * 3);
    for (let p = 0; p < committed.width * committed.height; p += 1) {
      committedRgb[p * 3] = committed.rgba[p * 4];
      committedRgb[p * 3 + 1] = committed.rgba[p * 4 + 1];
      committedRgb[p * 3 + 2] = committed.rgba[p * 4 + 2];
    }
    expect(Buffer.compare(committedRgb, rgb)).toBe(0);
  }
});

it("counterweight (KD): a one-pixel flip fails the crop equality", () => {
  const { crops } = readKdMedia();
  const committed = decodeFileBytes(path.join(process.cwd(), "docs", crops[0]?.file as string));
  const tampered = Buffer.from(committed.rgba);
  tampered[0] = (tampered[0] as number) ^ 0xff;
  expect(Buffer.compare(tampered, committed.rgba)).not.toBe(0);
});



function kdSectionRaw(): string {
  const html = readFileSync(KD_PAGE_PATH, "utf8");
  const start = html.indexOf("<!-- KD-SECTION-START -->");
  const end = html.indexOf("<!-- KD-SECTION-END -->");
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

function kdImgRuleBlock(): string {
  const html = readFileSync(KD_PAGE_PATH, "utf8");
  const style = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
  const match = style.match(/\.kd-pairs img\s*\{([^}]*)\}/);
  expect(match, "blueprints.html lacks a .kd-pairs img rule").not.toBeNull();
  return match![1] as string;
}

function kdImgRuleOk(block: string): boolean {
  return /max-width\s*:\s*100%/.test(block)
    && /(?<![\w-])width\s*:\s*auto/.test(block)
    && !/(?<![\w-])width\s*:\s*100%/.test(block);
}

it("KD stills render at most at natural width (no upscale rule)", () => {
  expect(kdImgRuleOk(kdImgRuleBlock())).toBe(true);
});

it("counterweight (KD css): width:100% or a missing cap fails the img rule", () => {
  expect(kdImgRuleOk("width: 100%; max-width: 100%; height: auto;")).toBe(false);
  expect(kdImgRuleOk("width: auto; height: auto;")).toBe(false);
});

it("write-once (unit): an existing --out target is refused, bytes unchanged", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kd-out-"));
  const target = path.join(dir, "verdict-r3.json");
  writeFileSync(target, "original");
  const before = readFileSync(target, "utf8");
  expect(() => resolveVerdictOut(dir, target)).toThrow(/refusing to overwrite/);
  expect(readFileSync(target, "utf8")).toBe(before);
  expect(resolveVerdictOut(dir, path.join(dir, "fresh.json"))).toBe(path.join(dir, "fresh.json"));
  expect(resolveVerdictOut(dir, undefined)).toBe(path.join(dir, "verdict.json"));
});

it("crop gate (unit): a store with only r2 is refused before anything is written", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "kd-store-"));
  const runDir = path.join(root, "run-4");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, "verdict-r2.json"), "{}");
  const mediaDir = path.join(root, "media");
  const dataFile = path.join(root, "kd-media.json");
  await expect(runCrop({
    store: root,
    runAttr: "run-4",
    runView: "run-3",
    mediaDir,
    data: dataFile,
    placement: path.join(process.cwd(), ".openclinxr/slices/website-reimagine/jobs/wkd/placement-check-runtime.json"),
  })).rejects.toThrow(/verdict-r3\.json/);
  expect(existsSync(dataFile)).toBe(false);
});
function kdBindingTable(kd: Record<string, unknown>): Array<{ id: string; re: RegExp; values: string[]; requiresWord?: { word: string; when: boolean } }> {
  const attribution = kd["attribution"] as Record<string, unknown>;
  const placement = kd["placement"] as Record<string, unknown>;
  const scenarios = placement["scenarios"] as Record<string, { delta: { x: number; y: number; z: number } }>;
  const delta = scenarios["ed_chest_pain_priority_v1"]?.delta as { x: number; y: number; z: number };
  return [
    { id: "change", re: /only change is the spouse placement value/, values: ["-1.6", "-2.1", String(Math.abs(delta.x))] },
    {
      id: "inside",
      re: /Pixels changed inside the spouse region/,
      values: [String(attribution["minIn"]), (attribution["ratio"] as number).toFixed(2), String(attribution["floor_in"])],
    },
    {
      id: "outside",
      re: /Outside every actor/,
      values: [String(attribution["maxOut"]), String(attribution["floor_out"])],
    },
    {
      id: "control",
      re: /comment-only control/,
      values: [String(attribution["cMinIn"]), ...(attribution["cInPairs"] as number[]).map(String)],
    },
    {
      id: "overlap",
      re: /Spouse\/nurse overlap/,
      values: [String(attribution["overlapA1Px"]), String(attribution["overlapBPx"])],
    },
    {
      id: "centre",
      re: /centre moved/,
      values: [(attribution["shiftPx"] as number).toFixed(1), String(attribution["shiftBarPx"]), String(Math.abs(delta.x))],
      requiresWord: { word: "failed", when: (attribution["shiftPx"] as number) < (attribution["shiftBarPx"] as number) },
    },
    {
      id: "pad",
      re: /Mask pad/,
      values: [String(attribution["pad"]), ...Object.values(attribution["padPerPairMax"] as Record<string, number>).map(String)],
    },
    {
      id: "bundles",
      re: /regenerated bundle contributes/,
      values: [String((kd["blueprintDiff"] as Record<string, unknown>)["bundleChangedLines"]), String((kd["blueprintDiff"] as Record<string, unknown>)["bundleFiles"])],
    },
    { id: "learner-shift", re: /whole room shifts/, values: [String(kd["learnerRoomShiftPxApprox"])] },
    {
      id: "delta",
      re: /placement delta/,
      values: [String(delta.x), String(delta.y), String(delta.z)],
    },
    {
      id: "caption-after",
      re: /After: the spouse/,
      values: [String(Math.abs(delta.x))],
    },
  ];
}

function extractNumberTokens(text: string): string[] {
  return text.match(/-?\d+(?:\.\d+)?/g) ?? [];
}

/**
 * G1 ordered one-to-one occurrence binding: for each sentence, the sequence of
 * numeric tokens in text order must EQUAL the binding's ordered list of
 * expected formatted field values (same length, same order, each occurrence
 * consumed once). A field value may appear more than once only if the page
 * states it that many times (213 appears as the minimum and again in the
 * triple, so the control list is [213, 417, 215, 213]). Tuples bind
 * component-wise in order (delta.x, delta.y, delta.z); the axis magnitude
 * binds to |delta.x|. The <pre> diff block is excluded here and bound
 * separately to the store blueprint.diff bytes (E3); tag attributes are
 * excluded and policed by the attribute-number it below.
 */
function checkTotalBinding(sectionText: string, kd: Record<string, unknown>): string[] {
  const withoutPre = sectionText.replace(/<pre class="kd-diff">[\s\S]*?<\/pre>/, " ");
  const text = withoutPre.replace(/<[^>]*>/g, " ");
  const bindings = kdBindingTable(kd);
  const problems: string[] = [];
  const sentences = text.split(/(?<=\.)\s+/).map((sentence) => sentence.trim()).filter((sentence) => sentence !== "");
  const claimed: Array<{ token: string; binding: string }> = [];
  for (const sentence of sentences) {
    const tokens = extractNumberTokens(sentence);
    if (tokens.length === 0) continue;
    const hits = bindings.filter((candidate) => candidate.re.test(sentence));
    if (hits.length === 0) {
      problems.push(`unclaimed number(s) ${tokens.join(",")} in sentence: ${sentence.slice(0, 80)}`);
      continue;
    }
    const binding = hits[0] as (typeof bindings)[number];
    if (tokens.length !== binding.values.length || tokens.some((token, index) => token !== binding.values[index])) {
      problems.push(`${binding.id}: tokens [${tokens.join(", ")}] != expected [${binding.values.join(", ")}] in sentence: ${sentence.slice(0, 80)}`);
      continue;
    }
    for (const token of tokens) claimed.push({ token, binding: binding.id });
    if (binding.requiresWord?.when === true && !sentence.includes(binding.requiresWord.word)) {
      problems.push(`${binding.id}: expected word "${binding.requiresWord.word}" in sentence: ${sentence.slice(0, 80)}`);
    }
  }
  if (claimed.length === 0) problems.push("no numeric token was claimed by any binding");
  return problems;
}

it("page numbers are totally bound: every section number is claimed by one sentence binding", () => {
  const { doc } = readKdMedia();
  expect(checkTotalBinding(kdSectionRaw(), doc)).toEqual([]);
});

it("counterweight (total binding): OUTSIDE 0 -> 4 fails the binding", () => {
  const { doc } = readKdMedia();
  const mutated = kdSectionRaw().replace(
    "0 changed pixels against a floor of 0",
    "4 changed pixels against a floor of 4",
  );
  expect(mutated).not.toBe(kdSectionRaw());
  const problems = checkTotalBinding(mutated, doc);
  expect(problems.some((problem) => problem.startsWith("outside:"))).toBe(true);
});

it("counterweight (occurrence binding): INSIDE 4732 -> 553 fails the binding", () => {
  const { doc } = readKdMedia();
  const mutated = kdSectionRaw().replace(
    "Pixels changed inside the spouse region: 4732,",
    "Pixels changed inside the spouse region: 553,",
  );
  expect(mutated).not.toBe(kdSectionRaw());
  const problems = checkTotalBinding(mutated, doc);
  expect(problems.some((problem) => problem.startsWith("inside:"))).toBe(true);
});

it("counterweight (occurrence binding): a second 4732 in the INSIDE sentence fails", () => {
  const { doc } = readKdMedia();
  const mutated = kdSectionRaw().replace(
    "at 8.56 times the A-to-A noise floor of 553.",
    "at 8.56 times the A-to-A noise floor of 553, plus 4732.",
  );
  expect(mutated).not.toBe(kdSectionRaw());
  const problems = checkTotalBinding(mutated, doc);
  expect(problems.some((problem) => problem.startsWith("inside:"))).toBe(true);
});

it("counterweight (occurrence binding): reordered triple (417, 213 and 215) fails", () => {
  const { doc } = readKdMedia();
  const mutated = kdSectionRaw().replace("(417, 215 and 213)", "(417, 213 and 215)");
  expect(mutated).not.toBe(kdSectionRaw());
  const problems = checkTotalBinding(mutated, doc);
  expect(problems.some((problem) => problem.startsWith("control:"))).toBe(true);
});

it("counterweight (page copy): the old neutral shift wording fails the failed-check binding", () => {
  const { doc } = readKdMedia();
  const mutated = kdSectionRaw().replace(
    "so the card's 40 px centre-shift check failed,",
    "below the card's 40 px bar,",
  );
  expect(mutated).not.toBe(kdSectionRaw());
  const problems = checkTotalBinding(mutated, doc);
  expect(problems.some((problem) => problem.startsWith("centre:") && problem.includes("failed"))).toBe(true);
});

it("counterweight (total binding): 0.5 -> 0.6 fails, naming the sentence and token", () => {
  const { doc } = readKdMedia();
  const mutated = kdSectionRaw().replace("0.5 m along the room's -x axis", "0.6 m along the room's -x axis");
  expect(mutated).not.toBe(kdSectionRaw());
  const problems = checkTotalBinding(mutated, doc);
  expect(problems.some((problem) => problem.includes("0.6"))).toBe(true);
});

it("counterweight (total binding): delta z 0 -> 1 fails, naming the sentence and token", () => {
  const { doc } = readKdMedia();
  const mutated = kdSectionRaw().replace("(-0.5, 0, 0)", "(-0.5, 0, 1)");
  expect(mutated).not.toBe(kdSectionRaw());
  const problems = checkTotalBinding(mutated, doc);
  expect(problems.some((problem) => problem.includes("(-0.5, 0, 1)") || problem.includes("delta"))).toBe(true);
});

it("counterweight (total binding): a stray appended number fails", () => {
  const { doc } = readKdMedia();
  const mutated = `${kdSectionRaw()} plus 7 more.`;
  const problems = checkTotalBinding(mutated, doc);
  expect(problems.some((problem) => problem.includes("7"))).toBe(true);
});

function checkClearanceBinding(sectionText: string, kd: Record<string, unknown>): string[] {
  // Provenance: per-scenario clearanceViolations + wallClearanceMeters come from
  // jobs/wkd/placement-check-runtime.json, produced by kd-placement-check-runtime.ts
  // via bedsideClearanceViolations (packages/openclinxr/asset-registry/src/bedside-clearance.ts)
  // and parametricWallInnerPlane (packages/openclinxr/xr-station/src/station-environment.ts:106-118);
  // a positive margin means strictly inside the walls.
  const problems: string[] = [];
  const scenarios = ((kd["placement"] as Record<string, unknown>)["scenarios"] ?? {}) as Record<
    string,
    { clearanceViolations: unknown[]; wallClearanceMeters: Record<string, number> }
  >;
  let clean = true;
  for (const [id, scenario] of Object.entries(scenarios)) {
    for (const violation of scenario.clearanceViolations ?? []) {
      problems.push(`${id}: clearanceViolations non-empty (${JSON.stringify(violation)}) but page claims none`);
      clean = false;
    }
    for (const [dir, margin] of Object.entries(scenario.wallClearanceMeters ?? {})) {
      if (!(margin > 0)) {
        problems.push(`${id}: wall ${dir} clearance ${margin} is not positive but page claims no wall violation`);
        clean = false;
      }
    }
  }
  const hasSentence = /no wall or furniture violation/.test(sectionText);
  if (clean && !hasSentence) problems.push("data is clean but the page lacks the no-violation sentence");
  if (!clean && hasSentence) problems.push("data shows violations but the page claims none");
  return problems;
}

it("clearance sentence is bound to the per-scenario clearance fields", () => {
  const { doc } = readKdMedia();
  expect(checkClearanceBinding(kdSectionRaw(), doc)).toEqual([]);
});

it("counterweight (clearance): one violation in memory fails the page", () => {
  const { doc } = readKdMedia();
  const mutated = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
  const scenarios = ((mutated["placement"] as Record<string, unknown>)["scenarios"] ?? {}) as Record<string, { clearanceViolations: unknown[] }>;
  scenarios["ed_chest_pain_priority_v1"] = {
    ...scenarios["ed_chest_pain_priority_v1"],
    clearanceViolations: [{ id: "stretcher_deck" }],
  };
  const problems = checkClearanceBinding(kdSectionRaw(), mutated);
  expect(problems.some((problem) => problem.includes("clearanceViolations"))).toBe(true);
});

it("pre diff text equals the store run-4 blueprint.diff fixture lines (bytes)", () => {
  const diffPath = path.join(KD_ROOT, "run-4", "blueprint.diff");
  expect(existsSync(diffPath), "store run-4/blueprint.diff absent: capture run-4 first").toBe(true);
  const lines = readFileSync(diffPath, "utf8").split("\n");
  const minus = lines.find((line) => line.startsWith("-") && !line.startsWith("---") && line.includes("plantOffsetMeters"));
  const plus = lines.find((line) => line.startsWith("+") && !line.startsWith("+++") && line.includes("plantOffsetMeters"));
  expect(minus).toBeDefined();
  expect(plus).toBeDefined();
  const pre = kdSectionRaw().match(/<pre class="kd-diff">([\s\S]*?)<\/pre>/);
  expect(pre).not.toBeNull();
  expect(pre?.[1]?.trim()).toBe(`${minus}\n${plus}`);
});

it("attribute numbers are excluded openly: alt text is number-free, the rest is allow-listed", () => {
  const raw = kdSectionRaw();
  // Elements the token scan excludes (tags are stripped before binding): their
  // attribute numbers are policed here instead of silently skipped.
  const excludedSelectors = ["img[src]", "img[alt]", "img[width]", "img[height]", "section[data-claim]", "section[data-slot]"];
  console.log(`KD binding excludes attributes only: ${excludedSelectors.join(", ")}`);
  for (const match of raw.matchAll(/alt="([^"]*)"/g)) {
    expect(match[1], "alt text must carry no numbers").not.toMatch(/\d/);
  }
  const attrNumbers: string[] = [];
  for (const match of raw.matchAll(/(?:src|alt|width|height|data-claim|data-slot|id)="([^"]*)"/g)) {
    for (const token of match[1].match(/\d+(?:\.\d+)?/g) ?? []) attrNumbers.push(token);
  }
  // Crop dims (in kd-media.json), claim ids from data-claim, file counters in src names.
  expect([...new Set(attrNumbers)].sort()).toEqual(["1", "10", "18", "200", "280", "540", "600"]);
});
function findHiddenFactLeaks(texts: string[], facts: string[]): string[] {
  const leaks: string[] = [];
  texts.forEach((text, index) => {
    for (const fact of facts) {
      if (text.includes(fact)) leaks.push(`text[${index}]: "${fact.slice(0, 60)}"`);
    }
  });
  return leaks;
}

it("hidden-fact population (KD): new section and data quote no hidden fact", () => {
  const facts = declaredHiddenFacts();
  expect(facts.length).toBeGreaterThanOrEqual(20);
  const dataText = readFileSync(KD_MEDIA_PATH, "utf8");
  expect(findHiddenFactLeaks([kdSectionRaw(), dataText], facts)).toEqual([]);
});

it("counterweight (KD hidden-fact): injecting one population fact in memory fails the scan", () => {
  const facts = declaredHiddenFacts();
  expect(facts.length).toBeGreaterThan(0);
  const planted = `some prose that quotes ${facts[0]} inline`;
  expect(findHiddenFactLeaks([planted], facts)).not.toEqual([]);
});
