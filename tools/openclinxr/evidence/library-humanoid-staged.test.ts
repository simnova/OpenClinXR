import { describe, expect, it } from "vitest";

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
 */

type StagedActor = {
  scenarioId: string;
  actorId: string;
  resolvedUrl: string;
  fromLibrary: boolean;
  skinnedTriangleCount: number;
  jointCount: number;
  visible: boolean;
};

type Inspect = () => Promise<{
  stagedActors: StagedActor[];
  annyActorsStillResolving: number;
}>;

const load = () =>
  import("./library-humanoid-staged.js") as Promise<Record<string, unknown>>;

describe("a library humanoid is staged by ordinary cast resolution (#218)", () => {
  it("at least one station stages a library body with no comparator flag", async () => {
    const mod = await load();
    const inspect = mod["inspectLibraryHumanoidStaged"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const fromLibrary = report.stagedActors.filter((a) => a.fromLibrary);
    expect(
      fromLibrary.length,
      "no actor resolves to a body-param library GLB — three deterministic stations feed nothing",
    ).toBeGreaterThan(0);

    const bad: string[] = [];
    for (const a of fromLibrary) {
      if (!/body-param-.*-library/.test(a.resolvedUrl)) {
        bad.push(`${a.scenarioId}/${a.actorId}: resolvedUrl "${a.resolvedUrl}" is not a library GLB`);
      }
      if (/generated-humanoids/.test(a.resolvedUrl)) {
        bad.push(`${a.scenarioId}/${a.actorId}: fell back to the Anny cast path`);
      }
      if (!a.visible) bad.push(`${a.scenarioId}/${a.actorId}: staged but visible=false`);
    }
    expect(bad, `library staging that did not happen:\n${bad.join("\n")}`).toEqual([]);
  }, 1_800_000);

  it("the staged figure keeps its rig, and the Anny cast is untouched (COUNTERWEIGHT)", async () => {
    // A path entry is cheap. #187 established a failed load yields a ~1266-triangle primitive dummy,
    // so "an actor rendered" is not "the library figure staged". The rig #216 landed must survive the
    // load: joints present in the LIVE scene, not merely in the file.
    const mod = await load();
    const inspect = mod["inspectLibraryHumanoidStaged"] as Inspect;
    const report = await inspect();

    const broken: string[] = [];
    for (const a of report.stagedActors.filter((x) => x.fromLibrary)) {
      if (a.skinnedTriangleCount < 3000) {
        broken.push(
          `${a.actorId}: ${a.skinnedTriangleCount} skinned triangles — #187's load-failure dummy is ~1266`,
        );
      }
      if (a.jointCount < 20) {
        broken.push(`${a.actorId}: ${a.jointCount} joints in the live scene — the rig did not survive load`);
      }
    }
    if (report.annyActorsStillResolving < 1) {
      broken.push("no Anny actors still resolve — this slice stages ONE role, it does not migrate the cast");
    }
    expect(broken, `the counterweight broke:\n${broken.join("\n")}`).toEqual([]);
  }, 1_800_000);
});
