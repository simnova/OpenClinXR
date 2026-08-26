import { describe, expect, it } from "vitest";
import { NodeIO } from "@gltf-transform/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * OBSERVABLE: the station budget gate can tell a 32,000-triangle asset from an 18,000-triangle one.
 *
 * ## MEASURED 2026-08-26 at source — do not re-derive
 *
 * `packages/openclinxr/asset-registry/src/index.ts:2343-2350`:
 *
 *     export function evaluateScenarioAssetBudget(manifests: readonly AssetManifest[]) {
 *       const totals = manifests.reduce((sum, manifest) => ({
 *         totalTriangles: sum.totalTriangles + manifest.geometryBudget.maxTriangles,
 *
 * It sums the number each manifest DECLARES and never opens a GLB. `:2353` compares that sum to
 * `quest3StationBudget.maxVisibleTriangles` (180,000, `:598`).
 *
 * The join from manifest to shipped asset EXISTS and is production code — `runtime-bundles.ts:712`
 * maps `patient_robert_hayes_character` to `ed_chest_pain_adult_cast.glb` and its two siblings
 * likewise. Read through it with NodeIO:
 *
 *     manifest assetId                 runtime glb                      declared   actual   ratio
 *     patient_robert_hayes_character   ed_chest_pain_adult_cast.glb       18,000   32,208   1.79x
 *     nurse_maria_alvarez_character    ed_chest_pain_nurse_adult.glb      18,000   34,572   1.92x
 *     spouse_anna_hayes_character      ed_chest_pain_spouse_adult.glb     18,000   38,828   2.16x
 *     TOTAL                                                               54,000  105,608   1.96x
 *
 * **The gate sums 54,000 and passes.** It governs the right objects with numbers roughly half their
 * true size and has no mechanism to notice.
 *
 * ## A CLAIM WAS WITHDRAWN ON THE WAY HERE AND THE MECHANISM MATTERS
 *
 * A peer reported that `patient_robert_hayes_character` appears nowhere in production code, and
 * concluded the gate governs objects that are not shipped. Its grep ended in `| head -4`, and the
 * test hits came first in walk order, consuming every slot before `runtime-bundles.ts:712`.
 * **Absence cannot be established from a truncated list.** This repo already records that failure
 * once, as a "15 of 15" that was really 17 of 17 behind a `tail -15`.
 *
 * ## WHY THIS ASSERTS ON THE SIGNATURE AND NOT ON THE STATION TOTAL
 *
 * The obvious contract — "the ED station's measured total fits 180,000" — passes today: 105,608 plus
 * environment and equipment is under budget. **A gate that reads bytes and a gate that reads
 * declarations give the same verdict on this station right now**, so a total-based clause would be
 * green while the defect stands, and would go red only when some future asset happened to cross.
 *
 * The discriminating property is that geometry cannot reach the evaluator AT ALL: its only parameter
 * is `readonly AssetManifest[]`, and `AssetManifest.geometryBudget` carries declared maxima. There is
 * no argument, field, or call path by which a measured triangle count could change its answer. That
 * is checkable today and it is what clause (1) asserts.
 *
 * claimScope: whether the station budget evaluator has any input carrying measured geometry.
 * notEvidenceFor: whether the ED station is over budget in truth (it is not, on these three);
 *   whether any manifest resolves to an MPFB asset — the MPFB rail is reached through
 *   `cast-asset-constants.ts` filename constants and NEITHER RAIL'S JOIN TO THE OTHER IS
 *   ESTABLISHED, so one rail is joined and one is not; the environment and equipment manifests'
 *   actual counts, which are unmeasured.
 */

const REPO = join(import.meta.dirname, "../../..");
const REGISTRY = join(REPO, "packages/openclinxr/asset-registry/src/index.ts");
const BUNDLES = join(REPO, "packages/openclinxr/asset-registry/src/runtime-bundles.ts");
const GENERATED = join(REPO, "apps/ui-xr/public/generated-humanoids");

/** The three ED character manifests, their declared maxima, and the GLBs the join resolves. */
const ED_CHARACTERS: ReadonlyArray<{ assetId: string; glb: string; declared: number }> = [
  { assetId: "patient_robert_hayes_character", glb: "ed_chest_pain_adult_cast.glb", declared: 18_000 },
  { assetId: "nurse_maria_alvarez_character", glb: "ed_chest_pain_nurse_adult.glb", declared: 18_000 },
  { assetId: "spouse_anna_hayes_character", glb: "ed_chest_pain_spouse_adult.glb", declared: 18_000 },
];

async function measuredTriangles(glb: string): Promise<number> {
  const doc = await new NodeIO().read(join(GENERATED, glb));
  let total = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      total += (prim.getIndices()?.getCount() ?? prim.getAttribute("POSITION")?.getCount() ?? 0) / 3;
    }
  }
  return Math.round(total);
}

/** The evaluator's parameter list, read from its declaration. */
function budgetEvaluatorSignature(): string {
  const src = readFileSync(REGISTRY, "utf8");
  const hit = /export function evaluateScenarioAssetBudget\(([^)]*)\)/.exec(src);
  if (!hit) throw new Error("evaluateScenarioAssetBudget declaration not found in " + REGISTRY);
  return hit[1]!.trim();
}

describe("the station budget gate can see the geometry (#699)", () => {
  it.fails("(1) the budget evaluator takes an input carrying measured geometry", () => {
    const params = budgetEvaluatorSignature();
    const carriesGeometry = /\bglb\b|\bmeasured\b|\bactual\b|triangleCount|geometryReader|\bbytes\b/i.test(params);
    expect(
      carriesGeometry,
      `evaluateScenarioAssetBudget(${params}) — its only input is the manifest list, whose `
        + "geometryBudget carries DECLARED maxima. No argument, field or call path lets a measured "
        + "triangle count change its answer, so the gate cannot tell an 18,000-triangle asset from "
        + "the 32,208-triangle one that ships in its place. Give it a measured-geometry input; do "
        + "NOT raise the declared numbers to match the bytes (clause 3 refuses that).",
    ).toBe(true);
  });

  it("(2) COUNTERWEIGHT: the declared-vs-measured gap is real, so clause (1) is not hypothetical", async () => {
    // If the shipped assets happened to fit their declarations, clause (1) would be a style
    // complaint about a signature. These numbers are why it is a defect.
    const rows: string[] = [];
    for (const c of ED_CHARACTERS) {
      const actual = await measuredTriangles(c.glb);
      if (actual <= c.declared) rows.push(`${c.assetId}: ${actual} <= ${c.declared}`);
    }
    expect(
      rows,
      "every ED character used to measure OVER its declared maxTriangles (32,208 / 34,572 / 38,828 "
        + "against 18,000 each). If one now fits, say so — the gap shrinking is a real change and "
        + "this clause should be re-derived rather than deleted.",
    ).toEqual([]);
  }, 180_000);

  it("(3) COUNTERWEIGHT: the declared maxima are not raised to match the bytes", () => {
    // The cheapest way to make the numbers agree is to edit the declarations upward. That makes
    // every declaration true and leaves the gate exactly as blind, because it still cannot respond
    // to a GLB that changes underneath a fixed number.
    const src = readFileSync(REGISTRY, "utf8");
    const declared = [...src.matchAll(/maxTriangles:\s*(\d+)/g)].map((m) => Number(m[1]));
    const characterDeclarations = declared.filter((n) => n === 18_000).length;
    expect(
      characterDeclarations,
      `expected the three ED character manifests to still declare maxTriangles: 18000; found `
        + `${characterDeclarations}. Raising them to match the measured bytes satisfies clause (2) `
        + "by moving the goalposts and leaves the gate unable to read geometry. Widening or "
        + "deleting this clause is wrong.",
    ).toBeGreaterThanOrEqual(3);
  });

  it("(4) COUNTERWEIGHT: the manifest-to-GLB join still resolves", () => {
    // Guards the reader. If `runtime-bundles.ts` stopped naming these assetIds, clause (2) would be
    // measuring GLBs that no manifest governs and clause (1) would be a complaint about an
    // evaluator nothing feeds.
    const src = readFileSync(BUNDLES, "utf8");
    const missing = ED_CHARACTERS.filter((c) => !src.includes(c.assetId) || !src.includes(c.glb));
    expect(
      missing.map((c) => c.assetId),
      "runtime-bundles.ts no longer joins these manifest assetIds to their GLBs. That join at :712 "
        + "is what makes declared-vs-measured comparable at all; without it this card's premise is "
        + "gone and the contract must be re-derived, not widened.",
    ).toEqual([]);
  });
});
