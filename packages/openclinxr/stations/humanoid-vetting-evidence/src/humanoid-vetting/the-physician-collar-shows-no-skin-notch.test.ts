/**
 * Physician-collar RED + nurse clause on recorded pre-fix masks (phys-neck-h3).
 *
 * Defect (cap16 1:1): the shipped physician's hidden set is the whole scrub V
 * opening + neck-base edge — a hole into the body; the fresh nurse capture shows
 * the same class (dark T-shaped hole at the throat inside the V). Graded on
 * h3/nurse-fresh-hidden-overlay.png + h3/physician-hidden-overlay.png.
 *
 * Pre-fix masks (source: the-physician-collar-shows-no-skin-notch.pre-fix.json,
 * built by h3 from stride-1 censuses):
 * - physician: tracked pair docs/.../mpfb-clinical-physician-adult-front_*,
 *   run 2026-11-11T07-23-12Z, box [1579,1276,2510,2114] (h1/RESULT.md),
 *   hidden 18736 stride-1 / 4667 stride-2, shirt 414488 / 103673 stride-2
 *   (h3/physician-set.json; hidden reproduces h2's 18736 exactly; stride-2
 *   subsets reproduce h2 stride2-check 4667/103673 exactly).
 * - nurse: FRESH pre-fix pair 2026-11-11T08-03-04Z (NOT the tracked Sept pair),
 *   box [1601,1277,2495,2114] (h1/RESULT.md), hidden 816 / 194 stride-2 in
 *   4 components (main T-hole n=806 bbox [2018,1348,2077,1382] + 3 specks),
 *   shirt 323906 / 81090 stride-2 (h3/nurse-fresh-set.json). Fresh struct
 *   silhouette [18,18,2927,3686] equals the recorded tracked silhouette exactly.
 *
 * Clauses (cap16 G2' a+b; region split deleted; no collar-edge clause):
 * (a) every pre-fix hidden pixel (stride-2 subset of the recorded mask) has
 *     after class "skin", never "hidden" — "the V opening must show skin, not
 *     the hide-mask hole".
 * (b) every pre-fix shirt pixel (stride-2 subset) still classifies "shirt"
 *     after — "a global un-hide lets body skin poke through the garments".
 * The S2 fix only flips material indices (hidden<->skin); first-hit FACES are
 * identical pre/post, so any other flip is a wrong fix. A ray with no hit is a
 * named framing failure, not a skip.
 *
 * Site box (amendment A1, second option): the RECORDED pre-fix box, not a live
 * derivation; the capture's framing is asserted instead — struct silhouette
 * bbox must equal the recorded rows below (+/-4px, named failure) or the
 * recorded pixels no longer land on the defect. Recorded: physician
 * [18,18,2978,3684] (h2 stride2-check 2026-11-11); nurse [18,18,2927,3686]
 * (h3 fresh run 2026-11-11 — same as the Sept tracked value).
 * Nurse sha pin (stated choice): the nurse clause reads the TRACKED pair path
 * (post-fix the orchestrator installs fresh post-fix captures there), so it
 * fails with a named message while the tracked lit sha still equals either
 * known pre-fix sha (Sept tracked 7ce43db8… or fresh 23064d7e…) instead of
 * evaluating stale pixels. Physician has no sha pin: on the pre-fix capture
 * (lit 324ffcde…) clause (a) itself fires the RED (A2).
 *
 * Nurse SITES counterweight kept (imported SITES + countSeeThrough): every
 * site hiddenSubject==0, seeThrough==0, torso visibleSkinSubject==0.
 *
 * RED now (shipped bytes; h4/out/phys-test-run.log 2026-11-11): physician (a)
 * fails (after == pre-fix: hidden stays hidden); nurse fails at the sha pin (tracked pair still Sept pre-fix).
 *
 * NOT TESTED: post-fix flip of either clause (fix not installed; captures
 * post-fix not rendered); full-mask (stride-1) evaluation; other bodies.
 *
 * H5 (phys-neck-h4): pre-fix entries gain threeQuarter { box, shirt stride-1
 * RLE } from the three_quarter captures (physician run 2026-11-11T07-23-12Z
 * box [1786,1287,2531,2113] shirt 385626 stride-1 / 96540 stride-2; nurse run
 * 2026-11-11T08-03-04Z box [1812,1284,2486,2113] shirt 285449 / 71411
 * stride-2; h4/three-quarter-set.ts via the instrument loadScene view option).
 * Both it()s gain the three_quarter (b) clause at stride 2 through the
 * three_quarter camera (afterClasses view param, default front unchanged).
 *
 * H5 (phys-neck-h5, ruling super-ceo-cap17): clause (a) uses the V-set masks —
 * front hiddenInBand (physician 18369 stride-1 / 4576 stride-2; nurse 806 /
 * 194 stride-2) and threeQuarter.hiddenV (physician 12600 / 3150; nurse 829 /
 * 210) — after class "skin". Out-of-band pixels are excluded BY the band
 * expression: physician front 367 (91 stride-2), tq 234; nurse front 10 (0
 * stride-2: the left-chest specks, kept by chest card tsk_4b1c60a631bf39c),
 * tq 275. Recorded by h5/band-split.ts (framed-space band expr, frontSign
 * cross-checked against the python dry-run reports). Clause (b) unchanged:
 * full front + tq shirt sets at stride 2.
 *
 * H6 (phys-neck-h6, ruling super-ceo-cap17 C2): entries gain lowerGarment
 * (front) + threeQuarter.lowerGarment (tq) — stride-1 "pants" first-hit sets
 * from h6/lower-census.ts (camera-derived scrub-pants boxes, material
 * mat_makeclothes_library_scrub_pants matched by the imported
 * classifyNurseWaistHit "pants" branch): physician front 100915 / 25210
 * stride-2 box [1735,2377,2361,3581], tq 94568 / 23593 box
 * [1784,2368,2303,3594]; nurse front 232326 / 58064 box
 * [1738,2350,2358,3565], tq 187490 / 46880 box [1778,2334,2280,3583].
 * Both it()s gain the lower clauses at stride 2: every recorded lower pixel
 * still classifies "pants" after ("a global un-hide lets body skin poke
 * through the garments" counterweight for the h6 waistband moves: phys
 * lower.001 prim5 3 tris, nurse lower prim2 27 + lower.001 prim5 30).
 */

import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { join } from "node:path";
import { Raycaster, Vector2 } from "three";
import { describe, expect, it } from "vitest";
import { decodePng } from "../../../../../../tools/openclinxr/evidence/decode-png.js";
import {
  SITES,
  classifyNurseWaistHit,
  countSeeThrough,
  loadScene,
} from "../../../../../../tools/openclinxr/evidence/humanoid-vetting/see-through-pixels.js";

const REPO_ROOT = repoRoot();
const VETTING = join(REPO_ROOT, "packages/openclinxr/stations/humanoid-vetting-evidence/src/humanoid-vetting");
const PRE_FIX = join(VETTING, "the-physician-collar-shows-no-skin-notch.pre-fix.json");
const PHYS_GLB = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb");
const PHYS_LIT = join(REPO_ROOT, "docs/openclinxr/humanoid-vetting-captures/mpfb-clinical-physician-adult-front_lit.png");
const PHYS_STRUCT = join(REPO_ROOT, "docs/openclinxr/humanoid-vetting-captures/mpfb-clinical-physician-adult-front_structure.png");
const NURSE_GLB = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb");
const NURSE_LIT = join(REPO_ROOT, "docs/openclinxr/humanoid-vetting-captures/mpfb-clinical-nurse-adult-front_lit.png");
const NURSE_STRUCT = join(REPO_ROOT, "docs/openclinxr/humanoid-vetting-captures/mpfb-clinical-nurse-adult-front_structure.png");

/** Recorded struct-silhouette bboxes (subject = structLum>40), x0,y0,x1,y1. */
const PHYS_SILHOUETTE = [18, 18, 2978, 3684] as const; // h2 stride2-check heavy run 2026-11-11
const NURSE_SILHOUETTE = [18, 18, 2927, 3686] as const; // h3 nurse-fresh run 2026-11-11 (= Sept tracked value)
/** Framing-pin tolerance in px per edge (see header). */
const FRAMING_TOL = 4;
/** Known pre-fix nurse lit shas (Sept tracked pair + fresh 08-03 pair); the sha pin trips on either. */
const NURSE_PREFIX_LIT_SEPT = "7ce43db824aa7f9f"; // tracked pair 2026-09-12 (38ff3505b lineage)
const NURSE_PREFIX_LIT_FRESH = "23064d7e2986a607"; // fresh pre-fix run 2026-11-11T08-03-04Z (h3/nurse-fresh-set.json)

/** RLE rows, decoded. On disk each mask is base64(zlib(minified JSON rows))
 * (r7 re-encode: 23.7MB -> 1.6MB, lossless — see land/r7/check_equiv.py;
 * r8 adds a top-level "_encoding" header string describing this format).
 * loadEntry expands encoded strings before any consumer runs; it indexes
 * only the physician/nurse entries, so the "_encoding" key is ignored. */
type Mask = { count: number; mask: Array<[number, number, number]> | string };
/** H6 C2: lower-garment set with its own camera-derived box (parity origin). */
type BoxMask = Mask & { box: [number, number, number, number] };
type PreFixEntry = {
  glbSha256: string;
  captureSha256: { lit: string; struct: string };
  captureRun: string;
  box: [number, number, number, number];
  stride: number;
  hidden: Mask;
  /** H5 V set (front): in-band subset of hidden, split by h5/band-split.ts. */
  hiddenInBand: Mask;
  hiddenOutOfBand: Mask;
  shirt: Mask;
  /** H6 C2 lower-garment counterweight (front): stride-1 "pants" RLE. */
  lowerGarment: BoxMask;
  /** H5 three_quarter counterweight data (h4 census 2026-11-11, stride-1 RLE). */
  threeQuarter: {
    box: [number, number, number, number];
    captureRun: string;
    captureSha256: { lit: string; struct: string };
    stride: number;
    shirt: Mask;
    /** H5 V set (tq): in-band subset of the stride-1 tq hidden census. */
    hidden: Mask;
    hiddenV: Mask;
    hiddenOutOfBandCount: number;
    /** H6 C2 lower-garment counterweight (tq): stride-1 "pants" RLE. */
    lowerGarment: BoxMask;
  };
};

/** REMOVED (r6 V2 PRE-RULING i): threeQuarterPaths() built paths under the
 * gitignored .openclinxr/evidence/glb-grade-capture tree and the only reads
 * were existsSync preconditions feeding no assertion value (tq PNG pixels are
 * never decoded; the raycast uses the `view` camera on the shipped GLB).
 * Machine state, not product — deleted instead of fixture-copied. */

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Struct-silhouette bbox of a tracked capture (subject = structLum>40); no raycast. */
function structSilhouette(structPath: string): readonly [number, number, number, number] {
  const struct = decodePng(new Uint8Array(readFileSync(structPath)));
  if (struct === null) throw new Error(`struct PNG decode failed: ${structPath}`);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < struct.h; y++) {
    for (let x = 0; x < struct.w; x++) {
      if (struct.lum[y * struct.w + x]! <= 40) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return [x0, y0, x1, y1];
}

function expectFramingPinned(
  live: readonly [number, number, number, number],
  recorded: readonly [number, number, number, number],
  label: string,
): void {
  for (let i = 0; i < 4; i++) {
    expect(
      Math.abs(live[i]! - recorded[i]!) <= FRAMING_TOL,
      `${label}: capture framing moved (re-record the pre-fix mask), live [${live.join(",")}] vs recorded [${recorded.join(",")}]`,
    ).toBe(true);
  }
}

/** Expand an on-disk mask to RLE rows; asserts the recorded pixel count so a
 * corrupt encoding fails loudly instead of silently shifting assertions. */
function expandMask(m: Mask): Array<[number, number, number]> {
  const rows =
    typeof m.mask === "string"
      ? (JSON.parse(inflateSync(Buffer.from(m.mask, "base64")).toString("utf8")) as Array<
          [number, number, number]
        >)
      : m.mask;
  let n = 0;
  for (const [, x0, x1] of rows) n += x1 - x0 + 1;
  if (n !== m.count) throw new Error(`pre-fix mask pixel sum ${n} != recorded count ${m.count}`);
  return rows;
}

/** Expand an RLE mask to its stride-2 subset (pixels with (x-x0),(y-y0) even). */
function stride2Subset(box: readonly [number, number, number, number], mask: Mask): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [y, x0, x1] of expandMask(mask)) {
    if ((y - box[1]) % 2 !== 0) continue;
    // x0-box[0] can be negative; JS % keeps the sign, so normalize the parity.
    const start = x0 + ((((x0 - box[0]) % 2) + 2) % 2);
    for (let x = start; x <= x1; x += 2) out.push([x, y]);
  }
  return out;
}

/**
 * After-class of recorded pixels through the AFTER scene. Pixel loop mirrors
 * countFirstHitsInBox (same NDC, same camera); scene + classifier are the
 * imported instrument (R1) — only the pixel list is recorded, not re-derived.
 */
async function afterClasses(
  glbPath: string,
  pixels: Array<[number, number]>,
  label: string,
  view: "front" | "three_quarter" = "front",
): Promise<{ classes: Record<string, number>; missed: number }> {
  const { camera, model } = await loadScene(glbPath, view);
  const raycaster = new Raycaster();
  raycaster.far = 100;
  raycaster.near = 0.01;
  const ndc = new Vector2();
  const classes: Record<string, number> = {};
  let missed = 0;
  for (const [x, y] of pixels) {
    ndc.set(((x + 0.5) / 4096) * 2 - 1, -((y + 0.5) / 4096) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(model, true);
    if (hits.length === 0) {
      missed++;
      continue;
    }
    const hit = hits[0];
    if (hit === undefined) throw new Error(`${label}: first raycast hit vanished after length check`);
    const mesh = hit.object as { name: string; userData: Record<string, unknown> };
    const cls = classifyNurseWaistHit(
      mesh.name,
      String(mesh.userData["matName"] ?? ""),
      String(mesh.userData["alphaMode"] ?? "OPAQUE"),
    );
    classes[cls] = (classes[cls] ?? 0) + 1;
  }
  return { classes, missed };
}

function loadEntry(body: "physician" | "nurse"): PreFixEntry {
  const pre = JSON.parse(readFileSync(PRE_FIX, "utf8")) as Record<string, PreFixEntry>;
  const entry = pre[body];
  if (!entry) throw new Error(`pre-fix JSON has no ${body} entry: ${PRE_FIX}`);
  return entry;
}

describe("the physician collar shows no skin notch", () => {
  it("required-behavior", async () => {
    expect(existsSync(PHYS_GLB), `${PHYS_GLB} exists on disk`).toBe(true);
    expect(existsSync(PHYS_LIT) && existsSync(PHYS_STRUCT), "tracked physician front captures exist").toBe(true);
    expect(existsSync(PRE_FIX), "recorded pre-fix masks exist").toBe(true);
    expectFramingPinned(structSilhouette(PHYS_STRUCT), PHYS_SILHOUETTE, "physician struct silhouette");

    const entry = loadEntry("physician");
    // H5 (a): the V set = front hiddenInBand + tq hiddenV (stride-2 subsets of
    // the recorded masks); every pixel must be skin after, never hidden.
    const hiddenPixels = stride2Subset(entry.box, entry.hiddenInBand);
    const shirtPixels = stride2Subset(entry.box, entry.shirt);
    expect(hiddenPixels.length, "recorded physician hidden-inBand stride-2 subset size").toBe(4576); // h5 band-split
    expect(shirtPixels.length, "recorded physician shirt stride-2 subset size").toBe(103673); // h3 pre-fix JSON

    const hiddenAfter = await afterClasses(PHYS_GLB, hiddenPixels, "physician hidden");
    expect(hiddenAfter.missed, "recorded hidden-inBand pixels all still hit geometry (else framing moved)").toBe(0);
    expect(
      hiddenAfter.classes["hidden"] ?? 0,
      `the V opening must show skin, not the hide-mask hole (after classes ${JSON.stringify(hiddenAfter.classes)})`,
    ).toBe(0);
    expect(
      hiddenAfter.classes["skin"] ?? 0,
      `every recorded hidden-inBand pixel is skin after (after classes ${JSON.stringify(hiddenAfter.classes)})`,
    ).toBe(hiddenPixels.length);

    const tqHiddenPixels = stride2Subset(entry.threeQuarter.box, entry.threeQuarter.hiddenV);
    expect(tqHiddenPixels.length, "recorded physician tq hiddenV stride-2 subset size").toBe(3150); // h5 band-split
    const tqHiddenAfter = await afterClasses(PHYS_GLB, tqHiddenPixels, "physician tq hidden", "three_quarter");
    expect(tqHiddenAfter.missed, "recorded tq hiddenV pixels all still hit geometry").toBe(0);
    expect(
      tqHiddenAfter.classes["hidden"] ?? 0,
      `the tq V opening must show skin, not the hide-mask hole (after classes ${JSON.stringify(tqHiddenAfter.classes)})`,
    ).toBe(0);
    expect(
      tqHiddenAfter.classes["skin"] ?? 0,
      `every recorded tq hiddenV pixel is skin after (after classes ${JSON.stringify(tqHiddenAfter.classes)})`,
    ).toBe(tqHiddenPixels.length);

    const shirtAfter = await afterClasses(PHYS_GLB, shirtPixels, "physician shirt");
    expect(shirtAfter.missed, "recorded shirt pixels all still hit geometry (else framing moved)").toBe(0);
    expect(
      shirtAfter.classes["shirt"] ?? 0,
      `a global un-hide lets body skin poke through the garments (after classes ${JSON.stringify(shirtAfter.classes)})`,
    ).toBe(shirtPixels.length);

    // H5 three_quarter (b) clause: the V-band shirt must still classify
    // "shirt" from the three_quarter view (stride-2 subset of the recorded
    // tq mask; box derived by projecting hidden_upper through the tq camera).
    const tqShirtPixels = stride2Subset(entry.threeQuarter.box, entry.threeQuarter.shirt);
    expect(tqShirtPixels.length, "recorded physician tq shirt stride-2 subset size").toBe(96540); // h4 H5 census
    const tqShirtAfter = await afterClasses(PHYS_GLB, tqShirtPixels, "physician tq shirt", "three_quarter");
    expect(tqShirtAfter.missed, "recorded tq shirt pixels all still hit geometry").toBe(0);
    expect(
      tqShirtAfter.classes["shirt"] ?? 0,
      `three_quarter shirt must stay shirt (after classes ${JSON.stringify(tqShirtAfter.classes)})`,
    ).toBe(tqShirtPixels.length);

    // H6 C2 lower-garment counterweight (front + tq, stride 2): the waistband
    // moves (phys report: lower.001 prim5 3 tris) must not flip pants pixels.
    // Parity origin is the LOWER box (the census scanned that box, not the
    // shirt box); same rule as the census stride2Count.
    const lowerPixels = stride2Subset(entry.lowerGarment.box, entry.lowerGarment);
    expect(lowerPixels.length, "recorded physician lower-garment stride-2 subset size").toBe(25210); // h6 lower-census
    const lowerAfter = await afterClasses(PHYS_GLB, lowerPixels, "physician lower");
    expect(lowerAfter.missed, "recorded lower-garment pixels all still hit geometry").toBe(0);
    expect(
      lowerAfter.classes["pants"] ?? 0,
      `lower-garment must stay pants (after classes ${JSON.stringify(lowerAfter.classes)})`,
    ).toBe(lowerPixels.length);

    const tqLowerPixels = stride2Subset(entry.threeQuarter.lowerGarment.box, entry.threeQuarter.lowerGarment);
    expect(tqLowerPixels.length, "recorded physician tq lower-garment stride-2 subset size").toBe(23593); // h6 lower-census
    const tqLowerAfter = await afterClasses(PHYS_GLB, tqLowerPixels, "physician tq lower", "three_quarter");
    expect(tqLowerAfter.missed, "recorded tq lower-garment pixels all still hit geometry").toBe(0);
    expect(
      tqLowerAfter.classes["pants"] ?? 0,
      `three_quarter lower-garment must stay pants (after classes ${JSON.stringify(tqLowerAfter.classes)})`,
    ).toBe(tqLowerPixels.length);
  }, 600_000);

  // it.fails until P2 tsk_5e868fd4492195 regenerates the tracked nurse captures; P2 MUST convert this back to it( in the same change. Never delete or widen it.
  it.fails("nurse stays at 0 on its recorded masks", async () => {
    expect(existsSync(NURSE_GLB) && existsSync(NURSE_LIT) && existsSync(NURSE_STRUCT), "nurse files exist").toBe(true);
    const trackedLitSha = sha256File(NURSE_LIT);
    expect(
      !trackedLitSha.startsWith(NURSE_PREFIX_LIT_SEPT) && !trackedLitSha.startsWith(NURSE_PREFIX_LIT_FRESH),
      `tracked nurse captures still pre-fix (lit sha ${trackedLitSha.slice(0, 16)}…); install post-fix captures`,
    ).toBe(true);
    expectFramingPinned(structSilhouette(NURSE_STRUCT), NURSE_SILHOUETTE, "nurse struct silhouette");

    const entry = loadEntry("nurse");
    const hiddenPixels = stride2Subset(entry.box, entry.hiddenInBand);
    const shirtPixels = stride2Subset(entry.box, entry.shirt);
    expect(hiddenPixels.length, "recorded nurse hidden-inBand stride-2 subset size").toBe(194); // h5 band-split (== h3 full-hidden subset: the 10 out-of-band specks land on no stride-2 pixel)
    expect(shirtPixels.length, "recorded nurse shirt stride-2 subset size").toBe(81090); // h3 pre-fix JSON

    const hiddenAfter = await afterClasses(NURSE_GLB, hiddenPixels, "nurse hidden");
    expect(hiddenAfter.missed, "recorded nurse hidden-inBand pixels all still hit geometry (else framing moved)").toBe(0);
    expect(
      hiddenAfter.classes["hidden"] ?? 0,
      `the V opening must show skin, not the hide-mask hole (after classes ${JSON.stringify(hiddenAfter.classes)})`,
    ).toBe(0);
    expect(
      hiddenAfter.classes["skin"] ?? 0,
      `every recorded nurse hidden-inBand pixel is skin after (after classes ${JSON.stringify(hiddenAfter.classes)})`,
    ).toBe(hiddenPixels.length);

    const shirtAfter = await afterClasses(NURSE_GLB, shirtPixels, "nurse shirt");
    expect(shirtAfter.missed, "recorded nurse shirt pixels all still hit geometry (else framing moved)").toBe(0);
    expect(
      shirtAfter.classes["shirt"] ?? 0,
      `a global un-hide lets body skin poke through the garments (after classes ${JSON.stringify(shirtAfter.classes)})`,
    ).toBe(shirtPixels.length);

    // H5 (a) tq: the nurse V set from the three_quarter view.
    const tqNurseHiddenPixels = stride2Subset(entry.threeQuarter.box, entry.threeQuarter.hiddenV);
    expect(tqNurseHiddenPixels.length, "recorded nurse tq hiddenV stride-2 subset size").toBe(210); // h5 band-split
    const tqNurseHiddenAfter = await afterClasses(NURSE_GLB, tqNurseHiddenPixels, "nurse tq hidden", "three_quarter");
    expect(tqNurseHiddenAfter.missed, "recorded nurse tq hiddenV pixels all still hit geometry").toBe(0);
    expect(
      tqNurseHiddenAfter.classes["hidden"] ?? 0,
      `the nurse tq V opening must show skin, not the hide-mask hole (after classes ${JSON.stringify(tqNurseHiddenAfter.classes)})`,
    ).toBe(0);
    expect(
      tqNurseHiddenAfter.classes["skin"] ?? 0,
      `every recorded nurse tq hiddenV pixel is skin after (after classes ${JSON.stringify(tqNurseHiddenAfter.classes)})`,
    ).toBe(tqNurseHiddenPixels.length);

    // H5 three_quarter (b) clause (nurse counterweight, same pinning).
    const tqShirtPixels = stride2Subset(entry.threeQuarter.box, entry.threeQuarter.shirt);
    expect(tqShirtPixels.length, "recorded nurse tq shirt stride-2 subset size").toBe(71411); // h4 H5 census
    const tqShirtAfter = await afterClasses(NURSE_GLB, tqShirtPixels, "nurse tq shirt", "three_quarter");
    expect(tqShirtAfter.missed, "recorded nurse tq shirt pixels all still hit geometry").toBe(0);
    expect(
      tqShirtAfter.classes["shirt"] ?? 0,
      `three_quarter nurse shirt must stay shirt (after classes ${JSON.stringify(tqShirtAfter.classes)})`,
    ).toBe(tqShirtPixels.length);

    // H6 C2 lower-garment counterweight (front + tq, stride 2): the h6
    // waistband moves (nurse report: lower prim2 27 + lower.001 prim5 30
    // tris) must not flip pants pixels. Parity origin is the LOWER box.
    const nurseLowerPixels = stride2Subset(entry.lowerGarment.box, entry.lowerGarment);
    expect(nurseLowerPixels.length, "recorded nurse lower-garment stride-2 subset size").toBe(58064); // h6 lower-census
    const nurseLowerAfter = await afterClasses(NURSE_GLB, nurseLowerPixels, "nurse lower");
    expect(nurseLowerAfter.missed, "recorded nurse lower-garment pixels all still hit geometry").toBe(0);
    expect(
      nurseLowerAfter.classes["pants"] ?? 0,
      `nurse lower-garment must stay pants (after classes ${JSON.stringify(nurseLowerAfter.classes)})`,
    ).toBe(nurseLowerPixels.length);

    const nurseTqLowerPixels = stride2Subset(entry.threeQuarter.lowerGarment.box, entry.threeQuarter.lowerGarment);
    expect(nurseTqLowerPixels.length, "recorded nurse tq lower-garment stride-2 subset size").toBe(46880); // h6 lower-census
    const nurseTqLowerAfter = await afterClasses(NURSE_GLB, nurseTqLowerPixels, "nurse tq lower", "three_quarter");
    expect(nurseTqLowerAfter.missed, "recorded nurse tq lower-garment pixels all still hit geometry").toBe(0);
    expect(
      nurseTqLowerAfter.classes["pants"] ?? 0,
      `nurse three_quarter lower-garment must stay pants (after classes ${JSON.stringify(nurseTqLowerAfter.classes)})`,
    ).toBe(nurseTqLowerPixels.length);

    // Established SITES counterweight (green on Sept bytes per h2 nurse-probe).
    const live = await countSeeThrough({
      glbPath: NURSE_GLB,
      litPath: NURSE_LIT,
      structPath: NURSE_STRUCT,
      classifySubject: true,
    });
    for (const id of Object.keys(SITES)) {
      expect(live.sites[id]!.hiddenSubject, `nurse ${id}: hiddenSubject stays 0`).toBe(0);
      expect(live.sites[id]!.seeThrough, `nurse ${id}: see-through stays 0`).toBe(0);
    }
    expect(live.torso.visibleSkinSubject, "nurse torso visibleSkinSubject stays 0").toBe(0);
  }, 600_000);
});
