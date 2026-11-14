#!/usr/bin/env node
/**
 * KD verdict driver (card WKD stage 2, S3). The OWNER runs this after capturing
 * all five labels of a run:
 *
 *   node tools/openclinxr/evidence/site/capture/kd-verdict.mjs \
 *     --run /Volumes/files/openclinxr-assets/store/site-reimagine/kd/run-1
 *
 * Reads run/capture.json + run/<label>/{still.png,regions.json}, decodes the
 * stills (shared png-measure decoder), builds the expected region as the UNION
 * of the spouse mask.rect in A1 and B (still pixels, 960x600), runs kdVerdict
 * for B and for C against A1-A3, checks B refusals + A1->B centre shift, writes
 * run/verdict.json, copies run blueprint.diff from the B tree, and refreshes
 * the top-level kd/capture.json + kd/blueprint.diff to this run (copy, not
 * symlink). `--out <file>` writes the verdict there instead of
 * <run>/verdict.json (the owner re-runs run-4 with --out verdict-r2.json;
 * the original stays write-once).
 *
 * Pinned runs (stage 4): capture.json carries pinned:true + cameraFrom. The
 * verdict refuses the run unless every non-A1 arm's live camera position,
 * lookAtWorld and quaternion equal A1's within 1e-6 (P2, fail closed, no
 * verdict written). Gates on a pinned run: INSIDE/OUTSIDE, centre shift >= 40
 * px (recorded either way), C must FAIL INSIDE, refusals clear; claim is
 * "attribution". Unpinned runs record verdict.json with pinned:false and claim
 * "learner-view" and do not claim attribution (exit 0 once recorded).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  checkPadCeiling,
  computeMaskPad,
  growRect,
  kdRefusals,
  kdVerdict,
  KD_PINNED_DRIVER,
  KD_SPOUSE_ACTOR_ID,
  liveCameraDiff,
  spouseCentreShiftPx,
} from "./kd-diff.mjs";
import { decodePng } from "../../../../../packages/openclinxr/png-measure/dist/evidence-png.js";

export const KD_CAMERA_TOLERANCE = 1e-6;
export const KD_PINNED_SHIFT_GATE_PX = 40;

/** "attribution" for pinned runs, "learner-view" otherwise. */
export function claimForRun(capture) {
  return capture?.pinned === true ? "attribution" : "learner-view";
}

/**
 * Pinned-run uniformity (stage 4b, Q2): one path for all five arms. Refuses a
 * pinned run where any label has pinned !== true, a capturePath other than the
 * pinned driver, or a cameraFrom {path, sha256} differing from the run's own.
 * Throws naming the offending label. Unit counterweights: (a) A1 on
 * "inspector-shell-out" is refused naming A1; (b) a label whose cameraFrom sha
 * differs is refused naming it.
 */
export function checkPinnedRunUniformity(capture) {
  const labels = capture?.labels ?? {};
  const first = capture?.cameraFrom;
  for (const label of ["A1", "A2", "A3", "B", "C"]) {
    const entry = labels[label];
    if (entry == null) throw new Error(`kd: pin uniformity: missing label ${label}`);
    if (entry.pinned !== true) {
      throw new Error(`kd: pin uniformity: ${label} pinned !== true`);
    }
    if (entry.capturePath !== KD_PINNED_DRIVER) {
      throw new Error(`kd: pin uniformity: ${label} capturePath is ${entry.capturePath}, want ${KD_PINNED_DRIVER}`);
    }
    const from = entry.pinnedFrom ?? entry.cameraFrom ?? null;
    if (from == null || from.path !== first?.path || from.sha256 !== first?.sha256) {
      throw new Error(`kd: pin uniformity: ${label} cameraFrom differs from the run pin`);
    }
  }
  return { ok: true };
}

/**
 * P2 pin assert (stage 4c, F1): every arm's LIVE camera — position, quaternion,
 * fov read from __openClinXrGazeCamera — must equal the REQUESTED pin values
 * within 1e-6. The old code overwrote interiorPreviewCamera eyeWorld/lookAtWorld
 * with requested values and then checked them (requested == requested); fov was
 * never gated. Now the gate reads only live fields. `liveCameraOf` accepts both
 * shapes: post-F1 runs carry {requestedPin, readBackBefore/After}, run-4's
 * regions carry the live read directly (inspector-still.mjs:155-168). Throws
 * naming the offending label and field (unit counterweight: fov 55 vs 56 refused).
 */
export function checkPinnedCameras(capture, pinCamera) {
  if (pinCamera == null) throw new Error("kd: pin assert: no pin source camera");
  const labels = capture?.labels ?? {};
  for (const label of ["A1", "A2", "A3", "B", "C"]) {
    const entry = labels[label];
    const live = entry?.camera?.readBackAfter ?? entry?.camera ?? null;
    const want = entry?.camera?.requestedPin ?? pinCamera;
    if (live == null) throw new Error(`kd: pin assert: no camera for ${label}`);
    const d = liveCameraDiff(live, want);
    const fields = ["position", "quaternion", "fov"];
    for (const field of fields) {
      if (!(d[field] <= KD_CAMERA_TOLERANCE)) {
        throw new Error(`kd: pin assert: ${label}.${field} differs from requested by ${d[field]} (tol ${KD_CAMERA_TOLERANCE})`);
      }
    }
  }
  return { ok: true };
}

/**
 * Shift gate (stage 4c, F2): recorded as its own gate {px, barPx: 40, pass},
 * reported, never tuned. Unit: >= 40 px passes, below fails.
 */
export function shiftGateFor(distancePx) {
  return { px: distancePx, barPx: KD_PINNED_SHIFT_GATE_PX, pass: distancePx >= KD_PINNED_SHIFT_GATE_PX };
}

const KD_BLUEPRINT_REPO_PATH = "packages/openclinxr/scenario-fixtures/src/ed-chest-pain-mod.ts";
// Stage-3 arm: the runtime reads the generated bundles, so B carries the fixture
// line PLUS the producer refresh (`--refresh-public-placements`) of these 4 files.
const KD_BUNDLE_DIFF_PATHS = [
  "apps/ui-xr/public/xr-assets/generated/ed_chest_pain_priority_v1/learner-runtime-bundle.v1.json",
  "apps/ui-xr/public/xr-assets/generated/ed_chest_pain_priority_v1/scene-manifest.v1.json",
  "apps/ui-xr/public/xr-assets/generated/ed_chest_pain_priority_v2/learner-runtime-bundle.v1.json",
  "apps/ui-xr/public/xr-assets/generated/ed_chest_pain_priority_v2/scene-manifest.v1.json",
];
const KD_VERDICT_SCHEMA = "openclinxr.site-reimagine.kd-verdict.v1";

function fail(why) {
  console.error(`KD-VERDICT BLOCKED ${why}`);
  process.exitCode = 1;
  throw new Error(why);
}

/**
 * Write-once --out (stage 6, P6.5): an explicit --out target that already
 * exists is refused (its bytes stay unchanged); the default verdict.json
 * path stays overwritable for idempotent reruns.
 */
export function resolveVerdictOut(runDir, out) {
  const verdictPath = out ?? join(runDir, "verdict.json");
  if (out != null && existsSync(verdictPath)) {
    throw new Error(`kd: refusing to overwrite existing --out file (bytes unchanged): ${verdictPath}`);
  }
  return verdictPath;
}

function loadRgba(runDir, file) {
  const bytes = readFileSync(join(runDir, file));
  const decoded = decodePng(new Uint8Array(bytes));
  if (!decoded) fail(`undecodable PNG: ${file}`);
  const { w, h, r, g, b, a } = decoded;
  const rgba = Buffer.alloc(w * h * 4);
  for (let p = 0; p < w * h; p += 1) {
    rgba[p * 4] = r[p];
    rgba[p * 4 + 1] = g[p];
    rgba[p * 4 + 2] = b[p];
    rgba[p * 4 + 3] = a[p];
  }
  return { width: w, height: h, rgba };
}

function spouseMask(regionsDoc) {
  const rows = Array.isArray(regionsDoc?.regions) ? regionsDoc.regions : [];
  const row = rows.find((candidate) => candidate?.actorId === KD_SPOUSE_ACTOR_ID);
  return { rows, rect: row?.mask?.rect ?? null };
}

function unionRect(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

export async function runVerdict({ run, out } = {}) {
  if (typeof run !== "string" || run === "") fail("usage: kd-verdict.mjs --run <kd/run-N> [--out <file>]");
  const runDir = resolve(run);
  const capturePath = join(runDir, "capture.json");
  if (!existsSync(capturePath)) fail(`no capture.json in ${runDir}: capture all five labels first`);
  const capture = JSON.parse(readFileSync(capturePath, "utf8"));
  for (const label of ["A1", "A2", "A3", "B", "C"]) {
    if (!capture?.labels?.[label]) fail(`capture.json lacks label ${label}`);
  }

  const seeds = new Set(Object.values(capture.labels).map((entry) => entry.seed));
  const presets = new Set(Object.values(capture.labels).map((entry) => entry.cameraPreset));
  const viewports = new Set(Object.values(capture.labels).map((entry) => JSON.stringify(entry.viewport)));
  const browsers = new Set(Object.values(capture.labels).map((entry) => JSON.stringify(entry.browserArgs)));
  const provenanceEqual = seeds.size === 1 && presets.size === 1 && viewports.size === 1 && browsers.size === 1;
  if (!provenanceEqual) {
    fail(`labels disagree on seed/camera/viewport/browser: ${JSON.stringify({ seeds: [...seeds], presets: [...presets] })}`);
  }

  const pinned = capture.pinned === true;
  const claim = claimForRun(capture);
  let pinCamera = null;
  if (pinned) {
    try {
      checkPinnedRunUniformity(capture);
      const pinPath = capture.cameraFrom?.path;
      const pinBytes = readFileSync(pinPath, "utf8");
      const pinSha = createHash("sha256").update(pinBytes, "utf8").digest("hex");
      if (pinSha !== capture.cameraFrom?.sha256) {
        throw new Error(`pin source moved under capture.json: ${pinPath}`);
      }
      pinCamera = JSON.parse(pinBytes)?.camera ?? null;
      checkPinnedCameras(capture, pinCamera);
    } catch (error) {
      fail(`pinned run refused: ${error?.message ?? String(error)}`);
    }
  }

  const frames = {};
  const regionDocs = {};
  for (const label of ["A1", "A2", "A3", "B", "C"]) {
    const entry = capture.labels[label];
    const actual = createHash("sha256").update(readFileSync(join(runDir, entry.still.file))).digest("hex");
    if (actual !== entry.still.sha256) fail(`still bytes moved under capture.json for ${label}`);
    frames[label] = loadRgba(runDir, entry.still.file);
    regionDocs[label] = JSON.parse(readFileSync(join(runDir, entry.regionsFile), "utf8"));
  }

  const maskA1 = spouseMask(regionDocs.A1);
  const maskB = spouseMask(regionDocs.B);
  if (maskA1.rect == null) fail("spouse mask.rect missing in A1 regions.json");
  if (maskB.rect == null) fail("spouse mask.rect missing in B regions.json");
  const regionUnpadded = unionRect(maskA1.rect, maskB.rect);

  // D1 pad (computed, never typed): A-A pairs only, A-arm rects of every actor
  // (spouse included; B never enters the pad). Pixels inside any A-arm rect
  // score distance 0 and do not raise it.
  const aArmRects = [];
  for (const label of ["A1", "A2", "A3"]) {
    for (const row of regionDocs[label]?.regions ?? []) {
      const rect = row?.mask?.rect ?? null;
      if (rect != null) aArmRects.push({ ...rect });
    }
  }
  const padInfo = computeMaskPad({
    pairs: [
      { name: "A1A2", a: frames.A1, b: frames.A2 },
      { name: "A1A3", a: frames.A1, b: frames.A3 },
      { name: "A2A3", a: frames.A2, b: frames.A3 },
    ],
    rects: aArmRects,
  });
  const padCheck = checkPadCeiling(padInfo.pad);

  // D2 apply: grow every actor rect in all 5 arms by pad (clamped to frame).
  // Spouse region = union of padded spouse rects A1 and B; exclusions = padded
  // non-spouse rects from all 5 arms, still overriding the spouse region where
  // they overlap (r2 rule). Floors and counts recomputed over the same sets.
  const pad = padInfo.pad;
  const region = unionRect(growRect(maskA1.rect, pad), growRect(maskB.rect, pad));
  const paddedRegionAreaPx = region.width * region.height;

  // F4 spouse-exclusive region: every other actor's mask rect in ANY of the
  // five arms is excluded from in-counts AND out-counts, so idle motion of
  // another actor (or a B-local non-spouse change) inside the union counts nowhere.
  const excludedRects = [];
  for (const label of ["A1", "A2", "A3", "B", "C"]) {
    for (const row of regionDocs[label]?.regions ?? []) {
      if (row?.actorId === KD_SPOUSE_ACTOR_ID) continue;
      const rect = row?.mask?.rect ?? null;
      if (rect != null) excludedRects.push({ actorId: row.actorId, label, rect: growRect(rect, pad) });
    }
  }
  const exclude = excludedRects.map((row) => row.rect);
  const bRaw = kdVerdict({ a: [frames.A1, frames.A2, frames.A3], b: frames.B, region, exclude });
  const cRaw = kdVerdict({ a: [frames.A1, frames.A2, frames.A3], b: frames.C, region, exclude });
  // D3 ceiling: pad above 8 px refuses with no INSIDE/OUTSIDE claim on the
  // attribution pair (B); the C counterweight still records.
  const desync = { pad, ceilingPx: 8, refused: padCheck.refused, reason: padCheck.reason };
  const b = padCheck.refused ? { ...bRaw, inside: null, outside: null } : bRaw;
  const c = padCheck.refused ? { ...cRaw, inside: null, outside: null } : cRaw;
  const toMaskRows = (rows) => rows.map((row) => ({ actorId: row.actorId, maskRect: row?.mask?.rect ?? null }));
  const refusalsB = kdRefusals({
    regionsA1: toMaskRows(maskA1.rows),
    regionsB: toMaskRows(maskB.rows),
    frame: { width: 960, height: 600 },
  });
  const shift = spouseCentreShiftPx(toMaskRows(maskA1.rows), toMaskRows(maskB.rows));

  // F3 driver fingerprint: every label must agree; pre-F3 runs carry none.
  const prints = ["A1", "A2", "A3", "B", "C"].map((label) => capture.labels[label]?.driverFingerprint ?? null);
  let driverFingerprint;
  if (prints.every((print) => print == null)) {
    driverFingerprint = "absent (pre-F3 run)";
  } else {
    for (const label of ["A1", "A2", "A3", "B", "C"]) {
      if (capture.labels[label]?.driverFingerprint == null) {
        fail(`kd: driver fingerprint: ${label} carries none while the run does`);
      }
    }
    const unique = new Set(prints.map((print) => JSON.stringify(print)));
    if (unique.size > 1) {
      const bad = ["A1", "A2", "A3", "B", "C"].find((label) => JSON.stringify(capture.labels[label]?.driverFingerprint) !== JSON.stringify(prints[0]));
      fail(`kd: driver fingerprint mismatch naming ${bad}`);
    }
    driverFingerprint = prints[0];
  }

  const bTree = capture.labels.B.tree;
  const diffText = execFileSync("git", ["-C", bTree, "diff", "HEAD", "--", KD_BLUEPRINT_REPO_PATH, ...KD_BUNDLE_DIFF_PATHS], { encoding: "utf8", timeout: 60000 });
  if (diffText.trim() === "") {
    fail("B tree carries no blueprint diff vs HEAD: the fixture edit plus refreshed bundles must be an uncommitted diff in the B tree");
  }
  writeFileSync(join(runDir, "blueprint.diff"), diffText, "utf8");

  // F2 (super-ceo-cap28 2026-11-13 option (i)) + D3: the pinned attribution
  // verdict is INSIDE && OUTSIDE && C fails INSIDE && no refusals. The centre
  // shift is a recorded gate of its own ({px, barPx, pass}) and does NOT enter
  // attribution. pass = attribution. A pad above the D3 ceiling refuses with
  // no INSIDE/OUTSIDE claim on the attribution pair.
  const attribution = padCheck.refused ? false : (b.pass && refusalsB.ok && !c.inside);
  const shiftGate = shiftGateFor(shift.ok === true ? shift.distancePx : NaN);
  // D5: verdict-r3 records what it supersedes, read from r2 at run time.
  // Refuse when --out names verdict-r3.json but r2 is absent for that run.
  let supersedes = null;
  if (out != null && String(out).endsWith("verdict-r3.json")) {
    const r2Path = join(runDir, "verdict-r2.json");
    if (!existsSync(r2Path)) fail(`run names verdict-r3.json but verdict-r2.json is absent in ${runDir}`);
    const r2 = JSON.parse(readFileSync(r2Path, "utf8"));
    supersedes = {
      file: "verdict-r2.json",
      outside: { maxOut: r2?.b?.maxOut ?? null, floor_out: r2?.b?.floor_out ?? null, pass: r2?.b?.outside ?? null },
    };
  }
  const verdict = {
    schema: KD_VERDICT_SCHEMA,
    run: capture.run,
    pinned,
    claim,
    seed: capture.seed,
    cameraPreset: capture.cameraPreset,
    viewport: capture.viewport,
    cameraFrom: capture.cameraFrom ?? null,
    driverFingerprint,
    region: { ...region, source: "union of padded spouse mask.rect in A1 and B" },
    regionUnpadded: { ...regionUnpadded, source: "union of spouse mask.rect in A1 and B (r2 rule)" },
    paddedRegionAreaPx,
    excludedRects,
    countedRegionPx: b.countedRegionPx,
    pad: padInfo,
    desync,
    spouseMaskA1: maskA1.rect,
    spouseMaskB: maskB.rect,
    b,
    c: { ...c, insideMustFail: true, counterweightPass: c.inside === false },
    refusalsB,
    centreShiftPx: shift,
    shiftGate,
    blueprintDiffSha256: createHash("sha256").update(diffText, "utf8").digest("hex"),
    attribution,
    supersedes,
    pass: pinned ? attribution : null,
  };
  let verdictPath;
  try {
    verdictPath = resolveVerdictOut(runDir, out);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  writeFileSync(verdictPath, `${JSON.stringify(verdict, null, 2)}\n`, "utf8");

  const kdRoot = dirname(runDir);
  copyFileSync(join(runDir, "capture.json"), join(kdRoot, "capture.json"));
  copyFileSync(join(runDir, "blueprint.diff"), join(kdRoot, "blueprint.diff"));
  console.log(`kd verdict ${capture.run} claim=${claim} attribution=${verdict.attribution} pass=${verdict.pass} b.inside=${b.inside} b.outside=${b.outside} ratio=${b.ratio} c.inside=${c.inside} refusals=${refusalsB.ok} shift=${shift.distancePx} shiftGate=${JSON.stringify(verdict.shiftGate)}`);
  if (pinned && !verdict.pass) {
    process.exitCode = 1;
    throw new Error(`kd verdict FAIL (recorded in ${verdictPath})`);
  }
  return { runDir, verdictPath };
}

const isEntryScript =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isEntryScript) {
  const argv = process.argv.slice(2);
  const runIdx = argv.indexOf("--run");
  const outIdx = argv.indexOf("--out");
  await runVerdict({
    run: runIdx === -1 ? undefined : argv[runIdx + 1],
    out: outIdx === -1 ? undefined : argv[outIdx + 1],
  }).catch((error) => {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  });
}
