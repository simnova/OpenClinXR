import { describe, expect, it } from "vitest";
import {
  listShippedCastScenarioIds,
  resolveScenarioActorCast,
} from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";
import { LIBRARY_ADULT_LEAN_FEMALE_GLB } from "../../../packages/openclinxr/asset-registry/src/cast-asset-constants-mod.js";

/**
 * PLANTED CONTRACTS (#218). Two REDs. Both flip.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE FOURTH "PROVEN AND UNCONSUMED" — and this time I am catching it before it sets
 *
 * Three deterministic stations have landed:
 *
 *   #215  clothing   ClothesService fits a licensed .mhclo         -> library GLB + provenance
 *   #151  body       MPFB macros move torso girth 0.499 -> 0.586m  -> two body classes
 *   #216  rig        canonical 23-bone armature, body AND garment  -> skins=1 joints=23 skinned=2/2
 *
 * The result is a posable, dressed, phenotype-driven human that **no station can stage**. #216's own
 * NOT TESTED says it: nothing in ui-xr resolves `body-param-*-library.glb`.
 *
 * MEASURED: the cast map is a literal table of `/generated-humanoids/` paths
 * (`humanoid-runtime-asset-url.ts:111-112`). No entry points at the library.
 *
 * A peer round's verdict, verbatim: "**Wiring is not a 180 — leaving posable dressed humans off the
 * cast map IS the 180.**" Three stations that feed nothing are a static gallery.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * A COMPARATOR FLAG DOES NOT COUNT — that is how this slice would fake itself
 *
 * `main.ts` already has comparator slots that resolve library GLBs behind `?comparator=`. #215 used
 * one, correctly, because its scope was "the runtime can reach it". THIS slice is different: the
 * figure must be staged for a station's actor **by ordinary cast resolution**, with no query
 * parameter and no debug switch.
 *
 * Contract (1) therefore asserts on the resolver, not on a comparator branch.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * VERIFIED BEFORE PLANTING, so the brief does not send you down a dead path
 *
 *  - The library GLBs are TRACKED (`git ls-files` confirms both, plus provenance). So #217's
 *    gitignored-evidence hazard does NOT apply to the assets themselves — every worktree has them.
 *  - Both carry skins: `skins=1 joints=23 skinnedMeshes=2/2`, read with NodeIO.
 *  - The cast resolver is a literal map. This is a data change plus whatever the loader needs, not a
 *    new subsystem.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SCOPE — ONE role, ONE body class. A peer argued me down from more.
 *
 *   DO:     stage ONE actor in ONE station from the library, resolved by normal cast lookup.
 *   DO NOT: migrate the cast, convert Anny roles, or change what any other station resolves.
 *   DO NOT: add a comparator branch and call it staging.
 *   DO NOT: touch the MakeClothes/body_param Blender stages. This slice is runtime wiring; if you
 *           find yourself editing a `.py` file, stop and say why.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE MEASUREMENT A "WE ADDED A MAP ENTRY" SLICE CANNOT FAKE
 *
 * A path string in a table proves nothing — the file may 404, the loader may fall back, the figure
 * may arrive as #187's 1266-triangle primitive dummy. So contract (2) requires the LIVE SCENE to
 * show the library figure actually staged: an actor root whose resolved URL names the library
 * basename, carrying real skinned geometry AND its joints — the rig #216 landed must survive load.
 *
 * A fallback to a `/generated-humanoids/` asset satisfies "an actor rendered" and fails this.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * NOT KNOWN TO ME: whether the runtime loader accepts a `candidates/` path for a cast actor without
 * other changes, and whether the hm08 body needs the same vertical-offset handling the Anny bodies
 * get. If staging the library figure requires changes beyond the resolver, say what and stop rather
 * than sprawling — `reject_measured` with a named blocker closes this successfully.
 *
 * The planted header is IMMUTABLE. Flip the assertion and append a `## FIXED (#218)` block below.
 *
 * ## FIXED (#218)
 *
 * Ordinary cast resolution stages ONE library humanoid:
 *   station: ed_chest_pain_priority_v1
 *   actor:   spouse_anna_hayes_v1
 *   body:    adult_lean_female → /xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb
 *
 * Mapping lives in the existing ED literal tables (actor-casting libraryCastEntry +
 * humanoid-runtime-asset-url ED_RUNTIME_CAST_BY_ACTOR). Patient stays Anny gown (#160);
 * nurse stays Anny scrubs. No comparator flag; no .py edits.
 *
 * Unlocked decisions (rejected alternatives):
 *   - Station/actor: ED spouse only — rejected ED patient (breaks #160 gown counterweight),
 *     rejected multi-role migration, rejected comparator-only path.
 *   - Body class: adult_lean_female for female spouse id — rejected adult_heavy_male here;
 *     phenotype-driven pick is future work (hardcoded one-row staging for this slice).
 *   - Mapping layer: extend ED literal tables — rejected new libraryHumanoidByActorId subsystem
 *     until phenotype drives selection across stations.
 *
 * ## RETIRED (#479 — owner decision af8571555, 2026-08-20)
 *
 * #479 deliberately moved the ED spouse OFF the 64-joint library rail (no jaw, no eye mesh)
 * onto the 137-joint MPFB family-partner body the other family-class slots already cast, and
 * moved the peds_fever child onto MPFB the same commit. Zero `body-param-*-library.glb` rows
 * remain in ordinary cast resolution, so the staging this file's #218 clauses demanded no
 * longer exists to assert. `LIBRARY_ADULT_LEAN_FEMALE_GLB` stays exported for the S2
 * gowned-patient swap (per the #479 commit message).
 *
 * The two clauses below therefore assert the RETIREMENT fact instead of the staging fact:
 *   (1) no ordinary-resolution cast row resolves to a `body-param-*-library.glb` — if a
 *       library row ever returns, this fails and the #218 staging clauses must be restored;
 *   (2) COUNTERWEIGHT: the library constant stays exported with its `body-param-*-library`
 *       shape (the S2 reservation), and the non-library cast is untouched (Anny rows still
 *       resolve where the cast keeps them).
 */

type CastRow = { role?: string; actorId?: string; assetPath?: string };

const basename = (p: string | undefined): string => String(p ?? "").split("/").pop() ?? "";

describe("a library humanoid is staged by ordinary cast resolution (#218)", () => {
  it("the library rail stays retired: no station stages a library body (#479)", () => {
    const rows: { scenarioId: string; row: CastRow }[] = [];
    for (const scenarioId of listShippedCastScenarioIds()) {
      for (const row of resolveScenarioActorCast(scenarioId) as unknown as CastRow[]) {
        rows.push({ scenarioId, row });
      }
    }
    const onLibrary = rows
      .filter(({ row }) => /body-param-.*-library/.test(basename(row.assetPath)))
      .map(({ scenarioId, row }) => `${scenarioId}/${row.actorId}: ${basename(row.assetPath)}`);
    expect(
      onLibrary,
      `a library row returned to ordinary cast resolution — #479 af8571555 retired the rail\n`
        + `  (ED spouse + peds child moved to MPFB); restore the #218 staging clauses instead of\n`
        + `  deleting this:\n${onLibrary.join("\n")}`,
    ).toEqual([]);
  });

  it("the S2 reservation and the untouched cast hold (COUNTERWEIGHT)", () => {
    // #479 kept the constant exported for the S2 gowned-patient swap: if the export or its
    // shape goes, the reservation is silently gone.
    expect(LIBRARY_ADULT_LEAN_FEMALE_GLB).toMatch(/body-param-.*-library/);

    // The retirement stages ONE rail off, it does not migrate the cast: rows still resolve
    // across more than one asset family (Anny generated-humanoids rows remain where kept).
    const families = new Set<string>();
    for (const scenarioId of listShippedCastScenarioIds()) {
      for (const row of resolveScenarioActorCast(scenarioId) as unknown as CastRow[]) {
        families.add(basename(row.assetPath));
      }
    }
    expect(
      [...families].filter((b) => /generated-humanoids|ed_chest_pain_adult_cast/.test(b)).length
        + [...families].filter((b) => /^mpfb-/.test(b)).length,
      `expected both Anny-kept and MPFB cast basenames to remain; families now: ${[...families].sort().join(", ")}`,
    ).toBeGreaterThan(1);
  });
});
