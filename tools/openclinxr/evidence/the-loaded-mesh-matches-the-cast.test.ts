import { describe, expect, it } from "vitest";
import {
  resolveScenarioActorCast,
} from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";
import { resolveHumanoidVariantOrCastPath } from "../../../apps/ui-xr/src/humanoid-runtime-asset-url.js";

/**
 * PLANTED CONTRACTS (#366). Resolution is not loading. The peds patient resolves to MPFB in
 * the casting table but the running scene loads the Anny-rail body.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, LOCATED — two resolution sites, one of them stale
 *
 * `apps/ui-xr/src/main.ts` `runtimeHumanoidVariantAssetPath` is the function the GLTFLoader
 * actually calls (`main.ts:6867`). Its peds branch has a deterministic fallback that predates
 * #335 and was never updated to the MPFB cast:
 *
 *     if (actorId === runtimePatientActorId() || role === 'patient') {
 *       return '/generated-humanoids/peds_patient_child.glb';          // Anny rail, stale
 *     }
 *     ... parent -> body-param lean-female library, nurse -> body-param heavy-male library
 *
 * while the casting SSOT (`resolveScenarioActorCast`) and its mirror
 * (`resolveHumanoidVariantOrCastPath` in humanoid-runtime-asset-url.ts) both resolve all three
 * peds roles to MPFB bodies per #335. The peds branch never falls through to that SSOT, so the
 * loader is handed the Anny child for the patient (and library bodies for parent/nurse) while
 * every other station routes through the SSOT.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) asserts the LIVE loaded path equals the SSOT cast path, so a green cannot be bought by a
 *     pure-function-only fix. (2) forbids the cheap fix — pointing the cast table at the Anny asset
 *     would make (1) green while every MPFB improvement stops reaching the learner. (3) fails loudly
 *     when the live scene loads nothing, so (1) cannot pass vacuously on an empty set.
 *
 * SIGNATURE IS YOURS. These read `inspectLoadedMeshMatchesCast()`. What must not change:
 *  - cast slots are enumerated from `resolveScenarioActorCast`, never hardcoded per-actor.
 *  - loadedFromPath/loadedMeshName come from the LIVE scene graph (userData.openClinXrAssetPath),
 *    never restated from the SSOT.
 */

const PEDS = "peds_asthma_parent_anxiety_v1";

type CastLoadTruthRow = {
  scenarioId: string;
  actorId: string;
  role: string;
  resolvedPath: string;
  loadedFromPath: string | null;
  loadedMeshName: string | null;
  childMeshNames: string[];
  match: boolean;
  staged: boolean;
};

type Inspect = () => Promise<{ scenarioIds: string[]; rows: CastLoadTruthRow[] }>;

const load = () =>
  import("./the-loaded-mesh-matches-the-cast.js") as Promise<Record<string, unknown>>;

describe("the loaded humanoid mesh belongs to the cast path (#366)", () => {
  it("(1) RED: every slotted cast actor loads the GLB its cast chose", async () => {
    const mod = await load();
    const inspect = mod["inspectLoadedMeshMatchesCast"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.rows.length, "no cast slots were measured — enumerate from the cast SSOT").toBeGreaterThan(0);

    const mismatched = report.rows.filter(
      (r) => r.staged && r.resolvedPath !== "" && !r.match,
    );
    expect(
      mismatched.map((r) =>
        `${r.scenarioId}/${r.actorId} loaded=${r.loadedFromPath ?? "null"} but cast says ${r.resolvedPath}`,
      ),
      "actors whose loaded GLB is not the GLB their cast chose:\n",
    ).toHaveLength(0);
  }, 900_000);

  it("(2) COUNTERWEIGHT: the peds cast still resolves to MPFB paths", () => {
    const cast = resolveScenarioActorCast(PEDS);
    expect(cast.length, "peds cast is empty").toBeGreaterThanOrEqual(3);

    for (const entry of cast) {
      expect(
        entry.runtimeAssetPath,
        `${PEDS}/${entry.actorId} left its MPFB cast path`,
      ).toMatch(/^\/generated-humanoids\/mpfb-/);

      // The mirror the runtime SSOT uses must agree — a fix may not downgrade either half.
      const resolved = resolveHumanoidVariantOrCastPath({
        scenarioId: PEDS,
        actorId: entry.actorId,
        role: entry.role,
        fallbackPath: entry.runtimeAssetPath,
      });
      expect(
        resolved,
        `${PEDS}/${entry.actorId}: resolveHumanoidVariantOrCastPath regressed off MPFB`,
      ).toBe(entry.runtimeAssetPath);
    }
  });

  it("(3) VACUITY GUARD: at least three peds slots are staged with a real loaded mesh", async () => {
    const mod = await load();
    const inspect = mod["inspectLoadedMeshMatchesCast"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const peds = report.rows.filter((r) => r.scenarioId === PEDS);

    const staged = peds.filter((r) => r.staged);
    expect(staged.length, `only ${staged.length} peds slots staged — a silent empty load must fail loudly`).toBeGreaterThanOrEqual(3);

    const noMesh = staged.filter((r) => !r.loadedMeshName || r.loadedMeshName.length === 0);
    expect(
      noMesh.map((r) => r.actorId),
      "peds slots with no loaded mesh name (a capture that loads nothing cannot satisfy (1))",
    ).toEqual([]);
  }, 900_000);
});
