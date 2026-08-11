import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * The only REAL facial morphs in this repo are unreachable by the runtime, because they are named
 * differently from what the runtime asks for. Silent-skip class, same as #306 one layer up.
 *
 * MEASURED 2026-08-11. `main.ts:8930` reads `morphTargetDictionary.openclinxr_mouth_open`, and
 * `viseme-morph-apply.ts:41-47` (`applyVisemeWeights`) looks each requested name up in
 * `morphTargetDictionary` and `continue`s when it is absent — a miss is an `undefined` index, never an
 * error:
 *
 *   rail                                | targets | openclinxr_* | openclinxr_mouth_open
 *   ------------------------------------|---------|--------------|----------------------
 *   all 7 Anny humanoids                |   25    |      3       | HIT
 *   library adult_lean_female / heavy_male |  32   |    **0**     | **MISS**
 *   mpfb-ob-patient-aisha               |   10    |    **0**     | **MISS** (body macros only)
 *
 * The library bodies carry 32 MPFB FACS names instead — `mouth-open`, `mouth-compression`,
 * `mouth-pursing`, `eye-left-closure`, `eyebrows-left-inner-up`, …
 *
 * AND THE RAILS ARE INVERTED FROM HOW THAT TABLE READS. Per-morph displacement statistics:
 *
 *   rail    | morph                     | verts moved | magnitude range   | sd       | directions
 *   --------|---------------------------|-------------|-------------------|----------|-----------
 *   Anny    | openclinxr_mouth_open     |     859     | 0.02200 only      | 0.000000 |     1
 *   Anny    | openclinxr_brow_concern   |  20,491     | 0.01560 only      | 0.000000 |     1
 *   library | mouth-open                |   4,549     | 0.00010 – 0.03886 | 0.012856 |   653
 *   library | eye-left-closure          |     462     | 0.00010 – 0.01020 | 0.002734 |    59
 *
 * Every Anny-rail morph is a CONSTANT-VECTOR RIGID TRANSLATION — identical magnitude on every moved
 * vertex, one direction. `openclinxr_brow_concern` slides the entire figure, garments and shoes
 * included, 1.56 cm sideways. The library's FACS morphs are genuine graded deformations.
 *
 * So the rail the runtime CAN address carries stubs, and the rail with real morphs is unaddressable.
 * That makes #224's "6 MB the runtime cannot drive" the only real facial animation data in the repo.
 *
 * METHOD NOTE — why contract (2) measures spread AND direction count. Coherence (|Σv| / Σ|v|) alone
 * is NOT sufficient: a legitimate jaw-drop is also all-parallel (everything moves down, by varying
 * amounts) and scores 1.0, identically to a stub. What separates them is that a stub has ZERO
 * magnitude spread and ONE direction. I nearly filed a "rigid translation" claim on the coherence
 * number alone, and it would have been right for the wrong reason.
 *
 * SCOPE (D4 — shrink what is under test). This contract covers the two hm08 library bodies only.
 * Two adjacent defects are deliberately OUT of scope and belong to #224:
 *   - the Anny rail's morph targets are stubs (they resolve, and driving them does nothing useful);
 *   - `mpfb-ob-patient-aisha` exports no mouth targets at all — MPFB's install has ~110 and a
 *     `FaceService.load_targets(load_microsoft_visemes=True)` path, they are simply not loaded at
 *     bake time. That is a bake fix, not a resolution fix.
 *
 * A GRADEDNESS-ONLY COUNTERWEIGHT WAS WRITTEN FIRST AND MEASURED VACUOUS. Scanning all 32 library
 * morphs: **32 graded, 0 stubs, 0 empty.** So "the resolved morph must be graded" passes automatically
 * the moment resolution returns any name present on the body — it refuses nothing (§7t). It is kept
 * below only as a cheap guard against someone BAKING a new constant-offset target, and is explicitly
 * NOT the counterweight.
 *
 * THE COUNTERWEIGHT IS ANATOMICAL ORDERING, measured on the library body:
 *
 *   morph                    | verts moved | centroid Y (stature)
 *   -------------------------|-------------|---------------------
 *   mouth-open               |    4,637    |       0.8839
 *   mouth-pursing            |    3,104    |       0.8859
 *   eye-left-closure         |      462    |       0.9248
 *   eyebrows-*-inner-up      |      161    |       0.9365
 *
 * Brow sits 0.053 stature (~9 cm on a 1.76 m body) above mouth. That ordering is WITHIN one face on
 * one body, so — unlike the cross-rail position check #306 had to discard — it carries no pose or
 * rig-scale confound.
 *
 * THE CHEAP FIXES THIS REFUSES, probed 2026-08-11 before planting:
 *
 *   treatment                                | (1) resolve+distinct | (2) brow above mouth | result
 *   -----------------------------------------|----------------------|----------------------|--------
 *   a) today (no resolver)                   |         FAIL         |         FAIL         | REFUSED
 *   b) return the same name for every request|       **FAIL**       |         FAIL         | REFUSED
 *   c) swap mouth and brow                   |         pass         |       **FAIL**       | REFUSED
 *   d) honest FACS map                       |         pass         |         pass         | ALL PASS
 *
 * (b) is the tempting one — returning the first available morph satisfies "a mouth morph resolves"
 * and is caught by distinctness; (c) is caught by ordering.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) and (2) are REDs and fail today on both library
 * bodies. (3) PASSES today and is the known-good column — the Anny rail resolves the canonical name,
 * and a resolver must not break the path that already resolves. **(3) is a NAME-LEVEL net only and
 * is NOT an endorsement of those targets**, which are stubs per the table above.
 *
 * NOT TESTED: nothing is rendered and no morph is driven at runtime. Gradedness says the target
 * deforms rather than translates; it does not say it looks like a mouth opening. Nothing here claims
 * the FACS morphs are anatomically correct, nor that a viseme timeline plays correctly once they are
 * reachable.
 *
 * ## FIXED (#308)
 *
 * `packages/openclinxr/asset-registry/src/morph-target-resolver.ts` now exports
 * `resolveMorphTarget(canonicalName, availableNames)` — identity-first, then the MPFB FACS alias map
 * (`openclinxr_mouth_open` → `mouth-open`, `openclinxr_brow_concern` → `eyebrows-left-inner-up`),
 * both verified present on the two library bodies. Wired (required, not optional): `applyVisemeWeights`
 * (`viseme-morph-apply.ts`) resolves every requested name through the resolver before the dictionary
 * lookup, and the `main.ts` morph cue goes through the same resolution via `resolveMorphIndex`.
 * The `it.fails` markers on (1) and (2) were flipped to `it`; all three contracts pass on both
 * library bodies, and the Anny-rail net (3) stays green.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");

/** What the runtime asks for — `main.ts:8930`, `main.ts:8954`. */
const CANONICAL_MOUTH_MORPH = "openclinxr_mouth_open";
/** The second canonical face morph the runtime drives — `main.ts:8931`. */
const CANONICAL_BROW_MORPH = "openclinxr_brow_concern";

const LIBRARY_BODIES = [
  "apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb",
  "apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_heavy_male-library.glb",
] as const;

/** The known-good rail for NAME RESOLUTION only. Its targets are stubs — see the header and #224. */
const ANNY_BODY = "apps/ui-xr/public/generated-humanoids/peds_anxious_parent.glb";

const io = new NodeIO();

type MorphStats = {
  verticesMoved: number;
  magnitudeSd: number;
  distinctDirections: number;
  /** Displaced-vertex centroid height as a fraction of stature. null when nothing moves. */
  centroidY: number | null;
};

async function morphTargetNames(rel: string): Promise<Set<string>> {
  const doc = await io.read(`${REPO_ROOT}/${rel}`);
  const names = new Set<string>();
  for (const mesh of doc.getRoot().listMeshes()) {
    const extras = (mesh.getExtras() ?? {}) as { targetNames?: string[] };
    for (const n of extras.targetNames ?? []) names.add(n);
  }
  return names;
}

/**
 * Displacement statistics for one named morph, summed across every mesh and primitive.
 *
 * Reading a single primitive is NOT enough: on the Anny rail the first matching primitive carries
 * zero deltas, which reads as an empty morph and is wrong.
 */
async function morphStats(rel: string, targetName: string): Promise<MorphStats> {
  const doc = await io.read(`${REPO_ROOT}/${rel}`);
  const magnitudes: number[] = [];
  const directions = new Set<string>();
  const delta: number[] = [];
  const position: number[] = [];

  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION")!;
      for (let i = 0; i < pos.getCount(); i += 1) {
        pos.getElement(i, position);
        if (position[1]! < minY) minY = position[1]!;
        if (position[1]! > maxY) maxY = position[1]!;
      }
    }
  }
  const stature = maxY - minY;
  let centroidSum = 0;

  for (const mesh of doc.getRoot().listMeshes()) {
    const extras = (mesh.getExtras() ?? {}) as { targetNames?: string[] };
    const index = (extras.targetNames ?? []).indexOf(targetName);
    if (index < 0) continue;
    for (const prim of mesh.listPrimitives()) {
      const target = prim.listTargets()[index];
      const positions = target?.getAttribute("POSITION");
      const base = prim.getAttribute("POSITION");
      if (!positions || !base) continue;
      for (let i = 0; i < positions.getCount(); i += 1) {
        positions.getElement(i, delta);
        const magnitude = Math.hypot(delta[0]!, delta[1]!, delta[2]!);
        if (magnitude <= 1e-5) continue;
        base.getElement(i, position);
        centroidSum += (position[1]! - minY) / stature;
        magnitudes.push(magnitude);
        directions.add(
          [delta[0]! / magnitude, delta[1]! / magnitude, delta[2]! / magnitude]
            .map((v) => v.toFixed(2))
            .join(","),
        );
      }
    }
  }

  if (magnitudes.length === 0) {
    return { verticesMoved: 0, magnitudeSd: 0, distinctDirections: 0, centroidY: null };
  }
  const mean = magnitudes.reduce((a, b) => a + b, 0) / magnitudes.length;
  const sd = Math.sqrt(
    magnitudes.reduce((a, b) => a + (b - mean) ** 2, 0) / magnitudes.length,
  );
  return {
    verticesMoved: magnitudes.length,
    magnitudeSd: sd,
    distinctDirections: directions.size,
    centroidY: centroidSum / magnitudes.length,
  };
}

/**
 * The deliverable. Absent today, so (1) and (2) are red. Expected at
 * `packages/openclinxr/asset-registry/src/morph-target-resolver.ts`, exporting
 * `resolveMorphTarget(canonicalName: string, availableNames: ReadonlySet<string>): string | null`.
 */
async function loadResolver(): Promise<
  ((canonical: string, available: ReadonlySet<string>) => string | null) | null
> {
  const mod = (await import(
    `${REPO_ROOT}/packages/openclinxr/asset-registry/src/morph-target-resolver.ts`
  ).catch(() => null)) as { resolveMorphTarget?: unknown } | null;
  return typeof mod?.resolveMorphTarget === "function"
    ? (mod.resolveMorphTarget as (c: string, a: ReadonlySet<string>) => string | null)
    : null;
}

describe("the runtime can reach a real mouth morph on the MPFB-topology bodies", () => {
  it(
    "(1) RED: mouth AND brow both resolve to DISTINCT targets present on both library bodies",
    async () => {
      const resolveMorphTarget = await loadResolver();
      expect(resolveMorphTarget, "morph-target-resolver.ts must export resolveMorphTarget").not.toBeNull();
      const broken: string[] = [];
      for (const body of LIBRARY_BODIES) {
        const available = await morphTargetNames(body);
        const mouth = resolveMorphTarget!(CANONICAL_MOUTH_MORPH, available);
        const brow = resolveMorphTarget!(CANONICAL_BROW_MORPH, available);
        const label = body.split("/").pop();
        if (!mouth || !available.has(mouth)) broken.push(`${label}: mouth resolved=${mouth ?? "null"}`);
        if (!brow || !available.has(brow)) broken.push(`${label}: brow resolved=${brow ?? "null"}`);
        if (mouth && brow && mouth === brow) {
          broken.push(`${label}: mouth and brow both resolved to "${mouth}"`);
        }
      }
      expect(broken, "library bodies with unreachable or collapsed face morphs").toEqual([]);
    },
  );

  it(
    "(2) RED COUNTERWEIGHT: the resolved brow morph sits ABOVE the resolved mouth morph, and neither is a constant-offset stub",
    async () => {
      const resolveMorphTarget = await loadResolver();
      expect(resolveMorphTarget, "morph-target-resolver.ts must export resolveMorphTarget").not.toBeNull();
      const broken: string[] = [];
      for (const body of LIBRARY_BODIES) {
        const available = await morphTargetNames(body);
        const mouth = resolveMorphTarget!(CANONICAL_MOUTH_MORPH, available);
        const brow = resolveMorphTarget!(CANONICAL_BROW_MORPH, available);
        const label = body.split("/").pop();
        if (!mouth || !brow) {
          broken.push(`${label}: unresolved (mouth=${mouth ?? "null"} brow=${brow ?? "null"})`);
          continue;
        }
        const m = await morphStats(body, mouth);
        const b = await morphStats(body, brow);

        // cheap guard only — every shipped library morph is already graded (32/32), so this
        // refuses a newly BAKED constant-offset target, not a mis-resolution. See the header.
        for (const [name, s] of [[mouth, m], [brow, b]] as const) {
          if (s.magnitudeSd <= 0 || s.distinctDirections <= 1) {
            broken.push(`${label} -> ${name}: constant-offset stub (sd=${s.magnitudeSd.toFixed(6)} dirs=${s.distinctDirections})`);
          }
        }

        // the actual counterweight: anatomical ordering within one face
        if (m.centroidY === null || b.centroidY === null) {
          broken.push(`${label}: a resolved morph moves nothing`);
        } else if (!(b.centroidY > m.centroidY)) {
          broken.push(
            `${label}: brow "${brow}" at Y ${b.centroidY.toFixed(4)} is not above mouth "${mouth}" at Y ${m.centroidY.toFixed(4)}`,
          );
        }
      }
      expect(broken, "resolved face morphs that are stubs or anatomically out of order").toEqual([]);
    },
  );

  it("(3) NET known-good: the Anny rail still resolves the canonical name — name-level only, those targets are stubs (#224)", async () => {
    const available = await morphTargetNames(ANNY_BODY);
    expect(available.has(CANONICAL_MOUTH_MORPH), "anny rail carries the canonical name").toBe(true);

    // and the library bodies genuinely have a real morph to reach — if this fails, the premise died
    const real = await morphStats(LIBRARY_BODIES[0], "mouth-open");
    expect(real.verticesMoved, "library mouth-open moves vertices").toBeGreaterThan(0);
    expect(real.magnitudeSd, "library mouth-open is graded").toBeGreaterThan(0);
    expect(real.distinctDirections, "library mouth-open deforms in many directions").toBeGreaterThan(1);
  });
});
