import { readdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * The MPFB nurse and child wear their trousers on their HANDS. Grey trouser-coloured shards sit on
 * every finger of both of Kevin's hands in the round-17 lit capture, and the geometry agrees.
 *
 * FOUND BY A WORKER, NOT BY ME. #341 round 17 reported it in the out-of-scope slot its brief provides
 * — *"the nurse's lower cover shell still wraps the arms at the top (266 top-band pants tris at
 * |x|>0.35)"* — while working a different subject. Without that slot it would have stayed in the
 * worker's head. It also retro-explains a reading I took two cycles earlier and dismissed: I measured
 * `cargo_pants handBandVerts=2919/3222` and wrote it off as "0.42-0.56 H is thigh height too". The
 * trousers really did have geometry out at the arms and I explained it away.
 *
 * MEASURED 2026-08-12 on the shipped GLBs. The discriminator is body-relative: the furthest lateral
 * reach of trouser geometry in the top band (within 12 cm of the trouser rim), divided by the torso
 * half-width taken from the SHIRT at the same height. No literal coordinates (D1) and no threshold
 * of mine anywhere in the input.
 *
 *   actor            torso half   max |x| of trousers   RATIO    outside-torso tris   verdict
 *   ---------------- ----------   -------------------   ------   ------------------   -------
 *   aisha            0.153 m      0.187 m               1.22x    33 / 2782            hip flare, normal
 *   nurse_kevin      0.146 m      0.547 m               **3.75x**  306 / 3092         on the hands
 *   patient_child    0.108 m      0.383 m               **3.55x**  260 / 2816         on the hands
 *
 * **Aisha is the known-good column** and she is a real one: same generator, same garment library,
 * same slot, clean at 1.22x. So this is not "the lower cover shell cannot be bounded" — it is bounded
 * correctly on one of three actors today.
 *
 * THE THRESHOLD IS DERIVED FROM THE KNOWN-GOOD, NOT FITTED TO THE DEFECT. 1.60x sits 31% above
 * aisha's measured 1.22x — room for a wider-hipped body — and 2.3x below the nearest offender. A
 * threshold fitted to the defect would sit just under 3.55x and would pass a fixed nurse whose
 * trousers still reached the elbow.
 *
 * THE CHEAP FIXES THIS REFUSES, probed 2026-08-12 before planting:
 *
 *   treatment                                     | (1) off arms | (2) known-good intact | (3) legs | (4) rim | result
 *   ----------------------------------------------|--------------|-----------------------|----------|---------|--------
 *   a) today                                      |  **FAIL**    |         pass          |   pass   |  pass   | REFUSED
 *   b) delete every triangle outside the torso    |    pass      |       **FAIL**        |   pass   |  pass   | REFUSED
 *   c) clip the whole top band off the trousers   |    pass      |         pass          |   pass   | **FAIL**| REFUSED
 *   d) bound the cover shell to the leg/hip region|    pass      |         pass          |   pass   |  pass   | ALL PASS
 *
 * (b) is the one to worry about, because it is a two-line filter that makes clause (1) green.
 * **MY FIRST VERSION OF THIS CONTRACT DID NOT REFUSE IT.** I claimed leg-band area would catch the
 * cull; the destructive probe showed leg area barely moves, because legs are narrow and central and
 * a cull at the torso silhouette hardly touches them. The cull's real damage is to aisha's legitimate
 * hip flare — it breaks the one actor that is already correct. Clause (2) now pins the known-good
 * actor inside a band, which is what actually refuses it. Recorded because the probe caught a
 * counterweight of mine that did not counterweight, and a header table that asserted it did.
 * (c) trades the arm shards for a bare waist. Clause (3) pins the shirt/trouser overlap, which is
 * 13.4-19.6 mm today and is the thing #341 round 17 spent a whole slice confirming is healthy.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the RED and fails on 2 of 3. (2), (3) and (4)
 * pass today; (2) is a counterweight and (3)/(4) are regression nets.
 *
 * NOT TESTED, and the scope statement matters here because I have over-read this rail twice this week:
 *   - **Not shown to be the same defect as #350.** That issue's 22-24 orphan 4-vertex skin islands sit
 *     at the sleeve rim, boot top and waistband. These are trouser triangles on the hands. The bands
 *     overlap at the wrist and the two may share a cause; nothing here demonstrates it.
 *   - **No claim about what a fix does to the hands' appearance.** Removing trouser geometry from a
 *     hand does not make the hand right; #295 removed mittens and took the sleeve with them.
 *   - **The ratio bounds LATERAL REACH only.** Trouser geometry that stays within 1.6x torso half-width
 *     but is in the wrong place vertically passes this contract. A quantity, not a shape (§11s).
 *
 * ## FIXED (#351)
 *
 * MECHANISM, measured 2026-08-12 on the shipped GLBs + pre-fix re-bakes: the lower cover shell's
 * band selection wraps the hands because `_LIMB_BONE_RE` (the shared arm-chain vocabulary in
 * `body_param_stage.py`) does not match the MPFB2 standard rig's `wrist` and `metacarpal*` palm
 * bones. The peds bodies' palms are metacarpal-dominant (nurse 177+177 verts at |x| up to 0.547 m in
 * the top band; child 120+120 up to 0.382 m), so their faces were never excluded from the shell band
 * and the shell wrapped the exported A-pose hands; the k-NN bind then carried the shards to the hand
 * bones, so the runtime clinical-idle pose wears them on the fingers. Aisha is clean because her
 * palm vertices are all finger-dominant (already excluded) — zero wrist/metacarpal verts in her band,
 * so the widened regex is a no-op for the known-good. Not the round-9 waistband class: mask/rim and
 * overlap are untouched (17.8/13.4 mm, in the #341 band).
 *
 * FIX: `_LIMB_BONE_RE` now also matches `wrist|metacarpal` (same vocabulary the evidence contract
 * `garment-shells-stop-at-the-wrist` already uses for `wrist`). No-op on the mixamo_unity rail (no
 * such bones). Re-baked all three actors through `materialize_mpfb_humanoid_candidate.py`; the shell
 * no longer contains hand-region faces and no trouser vertex is hand-weighted.
 *
 * MEASURED after the fix (same discriminator, same band):
 *
 *   actor            torso half   max |x| of trousers   RATIO    outside-torso tris   verdict
 *   ---------------- ----------   -------------------   ------   ------------------   -------
 *   aisha            0.153 m      0.187 m               1.218    84 / 2782            unchanged
 *   nurse_kevin      0.146 m      0.184 m               1.261    91 / 2820            hip flare
 *   patient_child    0.108 m      0.139 m               1.287    153 / 2636           hip flare
 *
 * All outlying triangles are now spine/pelvis/upperleg (hip flare) — zero hand/finger/wrist/
 * metacarpal-dominant trouser vertices on any actor. Leg-band area and shirt/trouser overlap are
 * unchanged (aisha 19.6 mm, nurse 17.8 mm, child 13.4 mm). Clause (1) flipped; (2)/(3)/(4) hold.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = "apps/ui-xr/public/generated-humanoids";

/** Derived from aisha's measured 1.22x with 31% headroom. Nearest offender is 3.55x. */
const MAX_LATERAL_RATIO = 1.6;

/** Ambient leg-band trouser area. A cull that deletes the trousers outright must fail. */
const MIN_LEG_AREA_CM2 = 1200;

/**
 * The known-good actor must come out UNCHANGED. Aisha measures 1.22x today and that reach is her
 * legitimate hip flare. A blanket cull of everything outside the torso silhouette is the cheap way
 * to green clause (1), and it is refused HERE rather than by leg area — measured 2026-08-12, such a
 * cull barely touches leg area at all, because legs are narrow and central. What it damages is the
 * actor that was already right.
 */
const KNOWN_GOOD = "mpfb-ob-patient-aisha.glb";
const KNOWN_GOOD_RATIO_BAND = { min: 1.16, max: 1.28 } as const;

/** Shirt/trouser overlap is 13.4-19.6 mm today (#341 round 17). */
const MIN_OVERLAP_MM = 8;

type Row = {
  file: string;
  torsoHalf: number;
  maxLateral: number;
  ratio: number;
  legAreaCm2: number;
  overlapMm: number;
};

const io = new NodeIO();

async function measure(rel: string): Promise<Row | null> {
  const doc = await io.read(join(REPO_ROOT, rel));

  type P = { mesh: string; pos: number[][]; idx: number[] };
  const prims: P[] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      if (mat?.getAlphaMode() === "MASK" && (mat?.getBaseColorFactor()?.[3] ?? 1) === 0) continue;
      const a = prim.getAttribute("POSITION");
      const ix = prim.getIndices();
      if (!a || !ix) continue;
      const pos: number[][] = [];
      for (let i = 0; i < a.getCount(); i++) pos.push(a.getElement(i, [0, 0, 0]) as number[]);
      const idx: number[] = [];
      for (let i = 0; i < ix.getCount(); i++) idx.push(ix.getScalar(i));
      prims.push({ mesh: mesh.getName(), pos, idx });
    }
  }
  const pantsPrims = prims.filter((p) => /cargo_pants/.test(p.mesh));
  // #180: the nurse's upper is now the scrub shirt, not the toigo t-shirt — the upper
  // vocabulary must include it or the nurse drops out of the enumeration (§7t vacuous).
  const shirtPrims = prims.filter((p) => /t_shirt|scrub/.test(p.mesh));
  if (pantsPrims.length === 0 || shirtPrims.length === 0) return null;

  const pantsTop = Math.max(...pantsPrims.flatMap((p) => p.pos.map((v) => v[1]!)));
  const pantsBot = Math.min(...pantsPrims.flatMap((p) => p.pos.map((v) => v[1]!)));
  const shirtBot = Math.min(...shirtPrims.flatMap((p) => p.pos.map((v) => v[1]!)));

  // Torso half-width from the SHIRT at trouser-rim height — a garment landmark, not a constant.
  let torsoHalf = 0;
  for (const p of shirtPrims)
    for (const v of p.pos)
      if (Math.abs(v[1]! - pantsTop) < 0.05) torsoHalf = Math.max(torsoHalf, Math.abs(v[0]!));
  if (torsoHalf <= 0) return null;

  const topBandFloor = pantsTop - 0.12;
  let maxLateral = 0;
  let legArea = 0;
  for (const p of pantsPrims) {
    for (let t = 0; t < p.idx.length; t += 3) {
      const v = [0, 1, 2].map((k) => p.pos[p.idx[t + k]!]!);
      const cx = (v[0]![0]! + v[1]![0]! + v[2]![0]!) / 3;
      const cy = (v[0]![1]! + v[1]![1]! + v[2]![1]!) / 3;
      if (cy >= topBandFloor) maxLateral = Math.max(maxLateral, Math.abs(cx));
      // Leg band: the lower two thirds of the trousers.
      if (cy < pantsBot + (pantsTop - pantsBot) * 0.66) {
        const e1 = [v[1]![0]! - v[0]![0]!, v[1]![1]! - v[0]![1]!, v[1]![2]! - v[0]![2]!];
        const e2 = [v[2]![0]! - v[0]![0]!, v[2]![1]! - v[0]![1]!, v[2]![2]! - v[0]![2]!];
        const cr = [
          e1[1]! * e2[2]! - e1[2]! * e2[1]!,
          e1[2]! * e2[0]! - e1[0]! * e2[2]!,
          e1[0]! * e2[1]! - e1[1]! * e2[0]!,
        ];
        legArea += 0.5 * Math.hypot(cr[0]!, cr[1]!, cr[2]!);
      }
    }
  }

  return {
    file: rel.split("/").pop()!,
    torsoHalf,
    maxLateral,
    ratio: maxLateral / torsoHalf,
    legAreaCm2: legArea * 1e4,
    overlapMm: (pantsTop - shirtBot) * 1000,
  };
}

const files = readdirSync(join(REPO_ROOT, GENERATED))
  .filter((n: string) => n.startsWith("mpfb-") && n.endsWith(".glb") && !/candidate/i.test(n))
  .map((n: string) => `${GENERATED}/${n}`);

const rows = (await Promise.all(files.map((f) => measure(f).catch(() => null)))).filter(
  (r): r is Row => r !== null,
);

/** An empty enumeration must FAIL, never pass vacuously (§7t). */
function requireRows(): void {
  expect(rows.length, `MPFB bodies wearing trousers (scanned ${files.length})`).toBeGreaterThanOrEqual(3);
}

const show = (r: Row): string =>
  `${r.file}: maxLateral=${r.maxLateral.toFixed(3)}m / torsoHalf=${r.torsoHalf.toFixed(3)}m = ${r.ratio.toFixed(2)}x`;

describe("trousers stay on the legs", () => {
  it("(1) RED (FIXED #351): no trouser geometry reaches out to the arms", () => {
    requireRows();
    expect(
      rows.filter((r) => r.ratio > MAX_LATERAL_RATIO).map(show),
      `trousers reaching beyond ${MAX_LATERAL_RATIO}x the torso half-width (aisha, the known-good, is 1.22x)`,
    ).toEqual([]);
  });

  it("(2) COUNTERWEIGHT: the known-good actor is not damaged by the fix", () => {
    // Refuses the blanket cull. Aisha is already correct at 1.22x; clamping every actor to the torso
    // silhouette drags her below her own hip flare. A fix must leave a correct actor where it found it.
    requireRows();
    const kg = rows.find((r) => r.file === KNOWN_GOOD);
    expect(kg, `the known-good actor ${KNOWN_GOOD} must be present`).toBeDefined();
    const ratio = kg!.ratio;
    expect(
      ratio >= KNOWN_GOOD_RATIO_BAND.min && ratio <= KNOWN_GOOD_RATIO_BAND.max,
      `${KNOWN_GOOD} lateral ratio ${ratio.toFixed(3)} left the known-good band ` +
        `${KNOWN_GOOD_RATIO_BAND.min}-${KNOWN_GOOD_RATIO_BAND.max} (hip flare lost or grown)`,
    ).toBe(true);
  });

  it("(3) NET known-good: the trousers still cover the legs", () => {
    // Refuses deleting the trousers outright. NOTE: measured 2026-08-12, this does NOT refuse the
    // blanket cull — clause (2) does. Recorded because the first version of this file claimed it did.
    requireRows();
    const gutted = rows
      .filter((r) => r.legAreaCm2 < MIN_LEG_AREA_CM2)
      .map((r) => `${r.file}: legArea=${r.legAreaCm2.toFixed(0)}cm2`);
    expect(gutted, `trousers with less than ${MIN_LEG_AREA_CM2} cm2 of leg-band area`).toEqual([]);
  });

  it("(4) NET known-good: the waist rim survives", () => {
    // Refuses "clip the whole top band off", which would trade arm shards for a bare waist and undo
    // what #341 round 17 confirmed is healthy.
    requireRows();
    const bare = rows
      .filter((r) => r.overlapMm < MIN_OVERLAP_MM)
      .map((r) => `${r.file}: shirt/trouser overlap=${r.overlapMm.toFixed(1)}mm`);
    expect(bare, `overlap below ${MIN_OVERLAP_MM} mm`).toEqual([]);
  });
});
