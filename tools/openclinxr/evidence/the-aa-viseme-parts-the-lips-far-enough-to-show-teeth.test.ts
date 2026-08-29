import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO, type Primitive } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * **OBSERVABLE: when an actor says "aa", the lips part far enough that the teeth behind them
 * become reachable geometry rather than sealed-in geometry.**
 *
 * ## MEASURED ON HEAD 81d06dd6, 2026-08-23 — do not re-derive
 *
 * Re-measured live from `apps/ui-xr/public/generated-humanoids/mpfb-viseme-inspect.glb` by this
 * file (NodeIO, morph POSITION deltas at weight 1.0), reproducing `open-mouth-interior.json`
 * exactly:
 *
 *     viseme      lipGap (m)              overlap (m)              maxDisp (m)
 *     viseme_aa   0                       0.0002300739288330078    0.018155692904924237
 *     viseme_sil  0.00026988983154296875  0                        0
 *
 *     teeth AABB height        0.04145002365112305 m
 *     thresholdMeters          0.020725011825561523 m   ( = 0.5 x teeth AABB height )
 *     lip verts / anterior     830 / 333
 *
 * The lips DO deform — 18.16 mm of maximum anterior displacement at `aa`. They deform sideways
 * and forward. **The anterior oris/levator rim still OVERLAPS by 0.23 mm, so the aperture is
 * exactly zero and the shipped teeth can never be seen.** #551 Stage A located that mechanism and
 * ruled out the alternatives it could rule out: teeth present, `alphaMode: OPAQUE`, alpha 1.0,
 * posterior to the lip surface (`teethMaxZ 0.15107998251914978 < lipMaxZ 0.16613999009132385`) and
 * Y-overlapping the lip band. Nothing is culled. Nothing is transparent. **Nothing opens.**
 *
 * ## WHERE 20.7 mm COMES FROM — it is not a number I chose
 *
 * `thresholdMeters = 0.5 * aabbHeight(openclinxr_hm08_teeth POSITION)`. The teeth mesh is an INPUT
 * to the causal chain; the lip aperture is its OUTPUT. Half the dental-arcade height is the
 * smallest aperture that can expose any part of the arcade. Derivation and both AABB corners are
 * recorded verbatim in `open-mouth-interior.json.thresholdDerivation`. Per §9s this is the third
 * sound epsilon source (the input of the chain, not a fraction of the effect): the teeth block is
 * 41.45 mm tall whether or not the bake ever opens the mouth, so a bake with a sealed mouth cannot
 * pass by construction.
 *
 * ## RELATIONSHIP TO THE EXISTING #551 GUARD — read this before touching either file
 *
 * `the-open-mouth-reveals-its-interior.test.ts` clause (1) is an INVERTED GUARD asserting the
 * mouth is still sealed. It is a TRIPWIRE for the #551 finding, not a RED anyone can flip. When the
 * bake here lands, that guard FIRES BY DESIGN, and its own header states the correct response:
 * restore the original positive assertion (`lipGapMeters >= thresholdMeters` and
 * `interiorRevealed === true`). **Do not delete it and do not widen it** — merge-kill fires on
 * `deleted-test`. This file is where the positive requirement lives in the meantime; the two are
 * meant to cross over in the same slice.
 *
 * ## THE CAUSE OF THE SEALED APERTURE IS NOT KNOWN TO ME BEYOND THAT MEASUREMENT
 *
 * Candidates, deliberately UNRANKED, and they may all be wrong (§6l) — measure, do not adopt one:
 *   - the `visemes02` source `aa` target is authored with a small jaw component
 *   - the jaw bone contributes the opening at runtime and the morph alone was never meant to open it
 *   - the anterior-rim vertex band is being displaced along Z and X but not Y
 *   - the target is imported at a reduced amplitude by the bake
 * My last several diagnoses in the face area were withdrawn. Do not take a hypothesis of mine as
 * fact. Measure first; the pre-fix artifact this file reads is already on disk.
 *
 * ## IF THE PREMISE IS FALSE, SAY SO AND STOP
 *
 * Named falsifier: if the aperture cannot be raised without also moving the teeth (because the
 * teeth ride the same jaw transform, so opening the mouth carries the arcade down with it and the
 * gap never clears half the arcade height), then clause (1) and clause (4) are in direct conflict
 * and **the contract is wrong, not the product**. Stop and say so.
 *
 * claimScope: whether the `viseme_aa` morph on the shipped inspect GLB parts the anterior lip rim
 *   by at least half the dental-arcade height, measured from the file.
 * notEvidenceFor: whether the teeth are actually VISIBLE in a render (that is a pixel grade, and it
 *   depends on lighting the interior); runtime lip-sync from audio; intelligibility; clinical or
 *   linguistic adequacy of the viseme set; any other actor's bake.
 *
 * ## FIXED (#0)
 *
 * 2026-08-28: `bake-aa-jaw-open-into-viseme-inspect.py` re-baked `viseme_aa` on the inspect GLB.
 * The station SOLVES a jaw-open rotation about the rig's TRS-composed jaw hinge
 * (0.000000, 1.520849, 0.056505 — local X == mesh X) so the exact band metric — the same
 * selector as this file — clears `1.15 * thresholdMeters`. Measured live by this file after
 * the bake (NodeIO, weight 1.0):
 *
 *     viseme_aa  lipGap 0.023834 m (1.15x threshold)  maxDisp 0.045400 m  gap_before 0
 *     viseme_sil gap 0.000270 m (unchanged)           theta 0.245161 rad (14.05 deg)
 *
 * The 47-target set (32 FACS + 15 viseme), the 2232-entry sparse layout, teeth/tongue, and
 * viseme_sil are untouched. Pixel visibility and runtime audio remain out of scope
 * (notEvidenceFor). The #551 guard is restored to the positive assertion in the same slice.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = pathResolve(HERE, "../../..");
const GLB = join(REPO, "apps/ui-xr/public/generated-humanoids/mpfb-viseme-inspect.glb");
const STAGE_A = join(HERE, "open-mouth-interior.json");

/** #551 measured, reproduced live by this file on HEAD 81d06dd6. */
const MEASURED_AA_GAP = 0;
const MEASURED_AA_OVERLAP = 0.0002300739288330078;
const MEASURED_AA_MAX_DISP = 0.018155692904924237;
const MEASURED_SIL_GAP = 0.00026988983154296875;
const MEASURED_TEETH_AABB_HEIGHT = 0.04145002365112305;
const MEASURED_THRESHOLD = 0.020725011825561523;
const MEASURED_LIP_VERTS = 830;
const MEASURED_ANTERIOR_LIP_VERTS = 333;
/** Baked viseme target count on this asset since e9ef9e3f (#542/#432). */
const MEASURED_VISEME_TARGET_COUNT = 15;

/** Same lip-vertex selector as open-mouth-interior-measure.ts:18 — dominant JOINTS_0 on oris / levator bones. */
const LIP_JOINT = /^(oris|levator)/u;

type Vec3 = [number, number, number];
type Attr = { getCount(): number; getElement(i: number, target: number[]): number[] };

function aabbHeight(pos: Attr): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < pos.getCount(); i += 1) {
    const v = pos.getElement(i, [0, 0, 0]) as Vec3;
    lo = Math.min(lo, v[1]);
    hi = Math.max(hi, v[1]);
  }
  return hi - lo;
}

function dominantJoint(joints: Attr | null, weights: Attr | null, names: string[], i: number): string {
  if (!joints || !weights) return "";
  const j = joints.getElement(i, [0, 0, 0, 0]);
  const w = weights.getElement(i, [0, 0, 0, 0]);
  let best = -1;
  let bw = -1;
  for (let k = 0; k < 4; k += 1) if (w[k]! > bw) { bw = w[k]!; best = j[k]!; }
  return names[best] ?? "";
}

type Measurement = {
  threshold: number;
  teethHeight: number;
  teethPresent: boolean;
  teethOpaque: boolean;
  tonguePresent: boolean;
  lipVertexCount: number;
  anteriorLipVertexCount: number;
  visemeTargetCount: number;
  viseme: Record<string, { lipGapMeters: number; lipOverlapMeters: number; maxDisplacementMeters: number }>;
};

let cached: Promise<Measurement> | null = null;

/** Reproduces open-mouth-interior-measure.ts's method against the SHIPPED bytes, in-process. */
async function measure(): Promise<Measurement> {
  if (cached) return cached;
  cached = (async (): Promise<Measurement> => {
    const doc = await new NodeIO().read(GLB);
    const root = doc.getRoot();
    const jointNames = (root.listSkins()[0]?.listJoints() ?? []).map((j) => j.getName() ?? "");

    let teethHeight = 0;
    let teethPresent = false;
    let teethOpaque = false;
    let tonguePresent = false;
    for (const m of root.listMeshes()) {
      const name = m.getName() ?? "";
      for (const p of m.listPrimitives()) {
        const pos = p.getAttribute("POSITION") as Attr | null;
        if (!pos) continue;
        if (/hm08_teeth/iu.test(name)) {
          teethPresent = true;
          teethHeight = aabbHeight(pos);
          const base = p.getMaterial()?.getBaseColorFactor?.() ?? [1, 1, 1, 1];
          teethOpaque = (base[3] ?? 1) > 0.01;
        }
        if (/hm08_tongue/iu.test(name)) tonguePresent = true;
      }
    }

    let bodyPrim: Primitive | null = null;
    let targetNames: string[] = [];
    for (const m of root.listMeshes()) {
      for (const p of m.listPrimitives()) {
        if (p.listTargets().length === 0) continue;
        const fromExtras = (m.getExtras()?.["targetNames"] ?? []) as string[];
        const names = p.listTargets().map((t, i) => t.getName() || fromExtras[i] || "");
        if (names.some((n) => /^viseme_/u.test(n))) { bodyPrim = p; targetNames = names; break; }
      }
      if (bodyPrim) break;
    }
    if (!bodyPrim) throw new Error("no body primitive carries viseme_* morph targets");

    const pos = bodyPrim.getAttribute("POSITION") as Attr;
    const joints = bodyPrim.getAttribute("JOINTS_0") as Attr | null;
    const weights = bodyPrim.getAttribute("WEIGHTS_0") as Attr | null;

    const lipVerts: { i: number; y: number; z: number }[] = [];
    for (let i = 0; i < pos.getCount(); i += 1) {
      if (!LIP_JOINT.test(dominantJoint(joints, weights, jointNames, i))) continue;
      const v = pos.getElement(i, [0, 0, 0]) as Vec3;
      lipVerts.push({ i, y: v[1], z: v[2] });
    }
    const zSorted = lipVerts.map((v) => v.z).sort((a, b) => a - b);
    const zCut = zSorted[Math.floor(zSorted.length * 0.6)]!;
    const midY = lipVerts.reduce((s, v) => s + v.y, 0) / Math.max(1, lipVerts.length);
    const anterior = lipVerts.filter((v) => v.z >= zCut);

    const viseme: Measurement["viseme"] = {};
    for (const name of ["viseme_aa", "viseme_sil"]) {
      const idx = targetNames.indexOf(name);
      if (idx < 0) throw new Error(`missing morph target ${name}`);
      const delta = bodyPrim.listTargets()[idx]!.getAttribute("POSITION") as Attr | null;
      let upperMin = Infinity;
      let lowerMax = -Infinity;
      let maxDisp = 0;
      for (const v of anterior) {
        const d = delta ? delta.getElement(v.i, [0, 0, 0]) : [0, 0, 0];
        const y = v.y + d[1]!;
        maxDisp = Math.max(maxDisp, Math.hypot(d[0]!, d[1]!, d[2]!));
        if (v.y >= midY) upperMin = Math.min(upperMin, y);
        else lowerMax = Math.max(lowerMax, y);
      }
      viseme[name] = {
        lipGapMeters: Math.max(0, upperMin - lowerMax),
        lipOverlapMeters: Math.max(0, lowerMax - upperMin),
        maxDisplacementMeters: maxDisp,
      };
    }

    return {
      threshold: teethHeight * 0.5,
      teethHeight,
      teethPresent,
      teethOpaque,
      tonguePresent,
      lipVertexCount: lipVerts.length,
      anteriorLipVertexCount: anterior.length,
      visemeTargetCount: targetNames.filter((n) => /^viseme_/u.test(n)).length,
      viseme,
    };
  })();
  return cached;
}

describe("the aa viseme parts the lips far enough to show teeth", () => {
  it("(1) viseme_aa opens the anterior lip rim by at least half the dental-arcade height", async () => {
      // FIXED (#0): the bake adds a jaw-open rotation about the TRS-composed jaw hinge to the
      // lower lip band, so the aperture clears the arcade-derived threshold at weight 1.0
      // (pre-bake the rim overlapped by 0.23 mm, aperture 0). The threshold is an input to the
      // causal chain (the arcade's own height), never a fraction of the observed gap.
      const m = await measure();
      expect(m.threshold, "the teeth-derived threshold must not move").toBeCloseTo(MEASURED_THRESHOLD, 9);
      expect(
        m.viseme["viseme_aa"]!.lipGapMeters,
        `viseme_aa aperture ${m.viseme["viseme_aa"]!.lipGapMeters} m must reach the arcade-derived `
          + `${m.threshold} m (Stage A: gap ${MEASURED_AA_GAP}, overlap ${MEASURED_AA_OVERLAP}, `
          + `maxDisp ${MEASURED_AA_MAX_DISP})`,
      ).toBeGreaterThanOrEqual(m.threshold);
    },
  );

  it("(2) KNOWN-GOOD COLUMN: viseme_sil stays shut — opening everything is not a fix", async () => {
    // Green today (sil gap 0.27 mm, far under the 20.725 mm threshold). Without this clause (1)
    // is satisfiable by cranking every target, which produces an actor whose mouth never closes.
    const m = await measure();
    expect(m.viseme["viseme_sil"]!.lipGapMeters, "sil must not reach the arcade threshold").toBeLessThan(m.threshold);
    expect(m.viseme["viseme_sil"]!.maxDisplacementMeters, "sil is the rest pose — it displaces nothing")
      .toBeCloseTo(0, 6);
    expect(m.viseme["viseme_sil"]!.lipGapMeters, "sil rest aperture measured on HEAD 81d06dd6")
      .toBeCloseTo(MEASURED_SIL_GAP, 8);
  });

  it("(3) KNOWN-GOOD COLUMN: the interior geometry the aperture exists to reveal still ships", async () => {
    // Green today. Pins what must survive the bake: both interior meshes, opaque teeth, and the
    // 15 baked viseme targets. Losing any of them makes clause (1) unreachable rather than fixed.
    const m = await measure();
    expect(m.teethPresent, "openclinxr_hm08_teeth must remain in the GLB").toBe(true);
    expect(m.tonguePresent, "openclinxr_hm08_tongue must remain in the GLB").toBe(true);
    expect(m.teethOpaque, "the teeth material must stay opaque — transparency is not an aperture").toBe(true);
    expect(m.visemeTargetCount, "the 15 baked viseme targets must survive")
      .toBeGreaterThanOrEqual(MEASURED_VISEME_TARGET_COUNT);
  });

  it("(4) COUNTERWEIGHT: the threshold's inputs and the lip band itself are not shrunk to reach green", async () => {
    // The three cheapest ways to pass clause (1) without opening a mouth:
    //   (a) shrink the teeth — the threshold is 0.5 x arcade height, so a smaller arcade is a
    //       smaller bar. Refused: the arcade may not lose height.
    //   (b) delete anterior lip vertices — with no lower-lip rim, upperMin - lowerMax is unbounded.
    //       Refused: both vertex counts are pinned.
    //   (c) rewrite open-mouth-interior.json to claim an aperture the bytes do not have. Refused
    //       by construction: every number in this file is measured from the GLB, and the Stage A
    //       artifact is only cross-checked here, never trusted as the source.
    const m = await measure();
    expect(m.teethHeight, "the dental arcade may not shrink — that lowers the bar instead of raising the aperture")
      .toBeGreaterThanOrEqual(MEASURED_TEETH_AABB_HEIGHT);
    expect(m.lipVertexCount, "the oris/levator lip band may not lose vertices").toBeGreaterThanOrEqual(MEASURED_LIP_VERTS);
    expect(m.anteriorLipVertexCount, "the anterior rim may not lose vertices")
      .toBeGreaterThanOrEqual(MEASURED_ANTERIOR_LIP_VERTS);
    // Cross-check: the committed Stage A artifact must still describe the same subject and
    // threshold this file measures. A divergence means one of the two is stale — say which.
    expect(existsSync(STAGE_A), "the #551 Stage A artifact must remain on disk").toBe(true);
    const stageA = JSON.parse(readFileSync(STAGE_A, "utf8")) as {
      thresholdMeters?: number;
      subject?: string;
    };
    expect(stageA.subject, "Stage A must still describe the inspect GLB").toContain("mpfb-viseme-inspect.glb");
    expect(stageA.thresholdMeters, "Stage A and this file must derive the same arcade threshold")
      .toBeCloseTo(m.threshold, 9);
  });
});
