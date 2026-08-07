import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#144) — every garment contract in this project measures the six GLB FILES.
 * Nothing measures what a station actually renders, and OB renders torn, substantially unclothed
 * figures from the same cast that psych renders correctly.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT — the stations that render correctly today must keep
 * doing so. It is `it.fails` only because the module is absent.
 *
 * ## FIXED (#144)
 * Discriminator (measured live in pre-fix.json): OB alone short-circuited
 * `runtimeHumanoidVariantAssetPath` to `/xr-assets/humanoids/variants/ob-*-generated-human.glb`
 * while psych (and 13 other stations) used cast SSOT → `/generated-humanoids/ed_chest_pain_*.glb`.
 * OB loadedUrl ≠ cast file; hasGarmentRegionLive=false (no openclinxr_real_garment_*); height ~0.67–0.85 m
 * from sub-unity framing scale. Fix: remove default OB variant returns; keep bake-off comparator
 * overrides only; fall through to resolveHumanoidVariantOrCastPath. Rejected: regenerating GLBs;
 * regenerating bundles; azurite URL chase (withdrawn).
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * MY FIRST DIAGNOSIS WAS WRONG AND IS WITHDRAWN. THE CORRECTED ONE IS FIRST.
 *
 * CORRECTED: `resolveScenarioActorCast` (`packages/openclinxr/asset-registry/src/actor-casting.ts:190`)
 * overrides the bundle's declared blob URL, and `humanoid-runtime-asset-url.ts` maps casts onto
 * `/generated-humanoids/*.glb`. I ran it over the whole bank: **all fourteen stations resolve to the
 * six regenerated humanoids, none returns an empty cast.** OB resolves to three of them — the same
 * three psych resolves to.
 *
 * WITHDRAWN: I previously claimed nine stations load `neutral-generated-human.glb` from a dead
 * azurite URL and that eight garment slices never reached them. **False.** Those nine declarations
 * exist and are stale noise (#104), but they are not what the runtime loads.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, IN PIXELS — and the cause is NOT KNOWN TO ME
 *
 * After #103 landed I captured both stations from the same camera:
 *
 *   psych_suicidal_ideation_safety_v1   three figures, clothed, midriff closed, sleeve ends clothed
 *   ob_headache_preeclampsia_triage_v1  two figures with TORN, SHREDDED SHOULDERS — jagged
 *                                       skin-toned shards where the head meets the torso — and the
 *                                       second figure substantially NUDE. Plus a small malformed
 *                                       figure on the bed. Unchanged by #103.
 *
 * Same cast. Same three GLBs. Same slice landed. Completely different pixels.
 *
 * **THE CAUSE IS NOT KNOWN TO ME BEYOND THAT COMPARISON. Trace it yourself.** My last four
 * diagnoses in this area were each withdrawn, so take nothing below as fact about the mechanism.
 *
 * Unranked candidates, and I have not distinguished between them — they may all be wrong, and the
 * answer may be an interaction rather than any single one:
 *   - the cast resolves but the LOAD fails and something else is substituted
 *   - per-station scale, or a fallback mesh at a different scale
 *   - a material or texture override applied per station
 *   - the small figure on the bed is a fourth actor, a prop, or a failed load
 *   - OB's capture was framed far wider than every other station's, which I noticed and did not explain
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS CONTRACT IS SHAPED PER-STATION AND NOT PER-ASSET
 *
 * §7j: a fix at a shared path generalises, a fix at one station's data does not — and the corollary
 * nobody applied here is that a CONTRACT over six files says nothing about fifteen stations. Every
 * garment gate we have (#46, #73, #75, #76, #82, #121, #124, #103) reads
 * `apps/ui-xr/public/generated-humanoids/*.glb` directly. All of them are green. OB is broken.
 *
 * These read the LIVE scene, per station, which is the only place the two can disagree.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - What "the mesh a station renders is intact" means mechanically. Triangle count against the
 *    source file's, a garment material region present, a bounded number of connected components —
 *    I do not know which discriminates OB from psych and that is the first thing to find out.
 *  - Whether the fix belongs at the loader, the cast resolver, the per-station scale, or the OB
 *    bundle. The trace decides; do not pick before measuring.
 *  - Whether the small figure on the OB bed is in scope. If it is a failed load it is the same bug;
 *    if it is a prop it is not. Say which you found.
 *  - Whether the wider OB camera framing is related. It may be a coincidence and it may be the tell.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands every station's staged actors load a mesh matching the cast-resolved source, and is
 * satisfiable by making every station load one known-good asset — which would delete role-distinct
 * casting (#96, #102). (2) forbids that by requiring the stations to stay distinct. (3) is green
 * today and forbids buying either by regressing the stations that already render correctly.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectPerStationActorIntegrity()`. What must
 * not change: stations are enumerated from what ships, and measurements come from the LIVE scene —
 * not from the GLB files, which every existing garment gate already reads and which are all green.
 *
 * REQUIRED, the observable half: capture `ob_headache_preeclampsia_triage_v1` and
 * `psych_suicidal_ideation_safety_v1` and say what the figures look like in each. Reuse
 * `tools/openclinxr/evidence/ui-xr-environment-room-capture.ts`; do not write a fourth capture
 * script. After the first successful run, re-run it twice more with `FORCE_COLOR=1`.
 *
 * IN-SCOPE VISUAL, as separate slots you must fill:
 *     IN-SCOPE VISUAL: OB figures ___ ; psych figures ___ ; the small figure on the OB bed ___ ;
 *                      anything now broken ___
 * and: CONTRACT_MET_VISUAL: ob_matches_psych | improved_still_torn | unchanged | other:<text>
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS
 * THE OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT.
 *
 * If satisfying a contract here will make the product visibly worse than before, say so in your
 * report and then satisfy it anyway. Naming it is not disobedience.
 *
 * SCOPE: whether the mesh a station renders matches the one its cast resolves to, and whether it is
 * intact. Says NOTHING about garment authoring (the six files are green), room contents (#143), or
 * whether any figure is clinically appropriate.
 */

const load = async () => import("./per-station-actor-integrity.js") as Promise<Record<string, unknown>>;

type StagedActorMesh = {
  scenarioId: string;
  actorId: string;
  /** GLB path `resolveScenarioActorCast` + humanoid-runtime-asset-url produce for this actor. */
  castResolvedPath: string;
  /** URL the loader actually fetched. Empty when nothing loaded. */
  loadedUrl: string;
  /** Triangles in the live scene under this actor's root. */
  liveTriangleCount: number;
  /** Triangles in the cast-resolved source file, read via NodeIO. */
  sourceTriangleCount: number;
  /** True when the live mesh carries a garment material region — what #103 guarantees on the files. */
  hasGarmentRegionLive: boolean;
  /** World height of the skinned mesh, to catch a substituted asset at a different scale. */
  liveMeshHeightMeters: number;
};

type Inspect = () => Promise<{ stations: string[]; actors: StagedActorMesh[] }>;

/** A substituted or half-loaded mesh will not match its source. Generous: LOD or culling may differ. */
const MIN_LIVE_TO_SOURCE_TRIANGLE_RATIO = 0.8;

/** Stations I have graded as rendering correctly today. The counterweight holds these. */
const KNOWN_GOOD = ["psych_suicidal_ideation_safety_v1", "ed_chest_pain_priority_v1"];

describe("what a station renders matches what its cast resolves to (#144)", () => {
  it("every staged actor loads the mesh its cast resolves to", async () => {
    // OB and psych resolve to the same three GLBs and render completely differently, so something
    // between the resolver and the scene graph is diverging. Measured live, not from the files.
    const mod = await load();
    const inspect = mod["inspectPerStationActorIntegrity"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.stations.length, `only ${report.stations.length} stations enumerated`).toBeGreaterThan(8);
    expect(report.actors.length, "no staged actors were measured").toBeGreaterThan(0);

    const diverged: string[] = [];
    for (const a of report.actors) {
      if (a.loadedUrl.length === 0) {
        diverged.push(`${a.scenarioId}/${a.actorId}: nothing loaded (cast said ${a.castResolvedPath})`);
        continue;
      }
      if (!a.loadedUrl.includes(a.castResolvedPath.split("/").pop() ?? " ")) {
        diverged.push(`${a.scenarioId}/${a.actorId}: loaded ${a.loadedUrl} but cast said ${a.castResolvedPath}`);
      }
    }
    expect(diverged, `actors not loading their cast-resolved mesh:\n${diverged.join("\n")}`).toHaveLength(0);
  }, 900_000);

  it("the live mesh is intact relative to its source file", async () => {
    // Kills the cheap satisfaction of the first contract: the right URL can still produce a broken
    // scene if the mesh half-loads, is substituted after load, or is scaled to something else. Every
    // existing garment gate reads the FILE and they are all green while OB renders torn figures.
    const mod = await load();
    const inspect = mod["inspectPerStationActorIntegrity"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const broken: string[] = [];
    for (const a of report.actors) {
      if (a.sourceTriangleCount <= 0) continue;
      const ratio = a.liveTriangleCount / a.sourceTriangleCount;
      if (ratio < MIN_LIVE_TO_SOURCE_TRIANGLE_RATIO) {
        broken.push(
          `${a.scenarioId}/${a.actorId}: live ${a.liveTriangleCount} tris vs source `
          + `${a.sourceTriangleCount} (${(ratio * 100).toFixed(0)}%)`,
        );
      }
      if (!a.hasGarmentRegionLive) {
        broken.push(`${a.scenarioId}/${a.actorId}: no garment region in the live mesh`);
      }
    }
    expect(broken, `live meshes that do not match their source:\n${broken.join("\n")}`).toHaveLength(0);
  }, 900_000);

  it("the stations that render correctly keep doing so (COUNTERWEIGHT)", async () => {
    // Two cheap satisfactions: point every station at one known-good asset, which deletes the
    // role-distinct casting #96 and #102 built; or relax until everything passes. Both are forbidden.
    const mod = await load();
    const inspect = mod["inspectPerStationActorIntegrity"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    for (const scenarioId of KNOWN_GOOD) {
      const here = report.actors.filter((a) => a.scenarioId === scenarioId);
      expect(here.length, `${scenarioId} staged no actors`).toBeGreaterThan(0);
      const distinct = new Set(here.map((a) => a.castResolvedPath));
      expect(distinct.size, `${scenarioId} lost its role-distinct cast`).toBeGreaterThan(1);
      for (const a of here) {
        expect(a.hasGarmentRegionLive, `${scenarioId}/${a.actorId} lost its garment`).toBe(true);
      }
    }
  }, 900_000);
});
