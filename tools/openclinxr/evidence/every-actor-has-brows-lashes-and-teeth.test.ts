import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NodeIO } from "@gltf-transform/core";

/**
 * **Operator build order 2026-08-21: "queue up eyebrows/eyelashes in the factory and apply to all
 * 11 actors", then "queue up teeth/tongue ... apply to all 11 actors".**
 *
 * Measured on shipped bytes before planting: ZERO of the 11 MPFB actors carries an eyebrow, eyelash,
 * teeth or tongue mesh. Present today: body (26,756 tris), fitted hair, `eyes_low_poly` (172 tris),
 * garments.
 *
 * ## TEETH, TONGUE AND EYELASHES NEED NO ACQUISITION — WE DELETE THEM
 *
 * The hm08 basemesh already contains them. `provider-cache/mpfb/extracted/data/3dobjs/base.obj`,
 * distinct helper groups:
 *
 *   helper-genital   helper-hair   helper-skirt   helper-tights      <- fitting cages
 *   helper-l-eye     helper-r-eye
 *   helper-l-eyelashes-1  helper-l-eyelashes-2                       <- REAL FEATURE
 *   helper-r-eyelashes-1  helper-r-eyelashes-2                       <- REAL FEATURE
 *   helper-upper-teeth    helper-lower-teeth    helper-tongue        <- REAL FEATURES
 *
 * And `materialize_mpfb_humanoid_candidate.py:1795` (again at :3200):
 *
 *   ExportService.bake_modifiers_remove_helpers(
 *       human, bake_masks=False, bake_subdiv=False, remove_helpers=True, also_proxy=True)
 *
 * **`remove_helpers=True` deletes the fitting cages AND the teeth, tongue and eyelashes together.**
 * MakeHuman treats all of them as "helpers"; only some of them are scaffolding. This is why the
 * actors have no teeth — not a missing asset, a flag that does not distinguish.
 *
 * **Do NOT simply set `remove_helpers=False`.** The garment rail fits against the #318
 * helper-stripped 13,380-vertex basemesh; retaining `helper-tights` / `helper-skirt` / `helper-hair`
 * would change the fit target for every garment on every actor. The work is SELECTIVE retention:
 * keep teeth, tongue and eyelashes, strip the cages. Clause (3) exists for exactly this.
 *
 * ## EYEBROWS ARE THE ONE THING GENUINELY ABSENT — and the pack is already acquired
 *
 * No `helper-eyebrow` group exists in hm08. Acquired 2026-08-21 under the operator order, both CC0:
 *
 *   facial/sources/makehuman-eyebrows01/eyebrows01_cc0.zip    11 MB, 14 mhclo, Mindfront
 *   facial/sources/makehuman-eyelashes01/eyelashes01_cc0.zip   4 MB,  5 mhclo, Mindfront
 *
 * **Topology verified, which was the named blocker:** every `.mhclo` header reads `basemesh hm08`,
 * the same basemesh our actors use. `ClothesService` will not refuse them.
 *
 * CC0 is stated three times independently — the assetpack index, each pack page, and the filename
 * (`eyebrows01_cc0.zip`). Both need a row in `third-party-asset-licence-ledger.md` at acquisition.
 *
 * ## KNOWN-GOOD COLUMN, and it is the strongest available (SS9h)
 *
 * **Fitted hair already works on all 11 actors through this exact rail.** `HAIR_STYLE_BY_REFERENCE`
 * at `materialize_mpfb_humanoid_candidate.py:56` maps a per-actor `.mhclo` style, `HAIR_STYLE_SEARCH_ROOTS`
 * names the pack dirs (never a glob), and a uuid-scoped licence gate refuses anything unapproved.
 * Every actor ships `openclinxr_fitted_hair_*`. **Extend that pattern; do not invent a second one (D1).**
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                      | (1) all 11 | (2) brows | (3) fit target | (4) licence | result
 *   -----------------------------------------------|------------|-----------|----------------|-------------|--------
 *   a) today                                       |  **FAIL**  | **FAIL**  |      pass      |    pass     | REFUSED
 *   b) remove_helpers=False wholesale              |    pass    | **FAIL**  |   **FAIL**     |    pass     | REFUSED — moves every garment's fit target
 *   c) paint brows/lashes into the skin atlas      |    pass    | **FAIL**  |      pass      |    pass     | REFUSED — geometry was ordered, and #536 showed paint is unmeasurable by mean
 *   d) apply to one actor and declare the rail done|  **FAIL**  |   pass    |      pass      |    pass     | REFUSED — the order says all 11
 *   e) selective retention + eyebrows01 fitted     |    pass    |   pass    |      pass      |    pass     | ALL PASS
 *
 * (b) is the one to watch: it is a one-character change that satisfies the teeth half and silently
 * re-targets every garment fit on every actor.
 *
 * claimScope: presence of eyebrow, eyelash, teeth and tongue meshes on the 11 shipped MPFB actors,
 *   and that the garment fit target is unchanged.
 * notEvidenceFor: whether they LOOK right (orchestrator grades pixels); lip-sync (#423); whether
 *   brows are also painted into the skin atlas; the other packs on the index.
 */

const D = "apps/ui-xr/public/generated-humanoids";
const ACTORS = readdirSync(D).filter((f) => f.startsWith("mpfb-") && f.endsWith(".glb")).sort();

/** Fit target measured on the shipped bake — #318 helper-stripped basemesh. Clause (3) pins it. */
const STRIPPED_BODY_TRIS = 26756;

const io = new NodeIO();
async function meshNames(glb: string): Promise<string[]> {
  const doc = await io.read(`${D}/${glb}`);
  return doc.getRoot().listMeshes().map((m) => m.getName() ?? "");
}
async function bodyTris(glb: string): Promise<number> {
  const doc = await io.read(`${D}/${glb}`);
  for (const m of doc.getRoot().listMeshes()) {
    if (!/_body$/.test(m.getName() ?? "")) continue;
    return m.listPrimitives().reduce((s, p) =>
      s + (p.getIndices()?.getCount() ?? p.getAttribute("POSITION")!.getCount()) / 3, 0);
  }
  return -1;
}
const has = (names: string[], re: RegExp) => names.some((n) => re.test(n));

describe("every actor has brows, lashes and teeth", () => {
  it("(0) VACUITY: the cast is enumerated from disk and is not empty", () => {
    expect(ACTORS.length, "no mpfb actors found — the population is wrong").toBeGreaterThanOrEqual(11);
  });

  it.fails("(1) RED: every actor carries eyelash, teeth and tongue geometry", async () => {
    const missing: string[] = [];
    for (const a of ACTORS) {
      const n = await meshNames(a);
      // Named parts, not a substring sweep — `\beye` fails on `_eyes_` because `_` is a word char,
      // which is how I first mis-measured this cast as having no eye mesh at all.
      if (!has(n, /eyelash/i)) missing.push(`${a}:eyelash`);
      if (!has(n, /teeth/i)) missing.push(`${a}:teeth`);
      if (!has(n, /tongue/i)) missing.push(`${a}:tongue`);
    }
    expect(missing, "actors missing hm08 features that remove_helpers=True deletes").toEqual([]);
  });

  it.fails("(2) RED: every actor carries an eyebrow mesh fitted from the CC0 eyebrows01 pack", async () => {
    const missing: string[] = [];
    for (const a of ACTORS) {
      if (!has(await meshNames(a), /eyebrow/i)) missing.push(a);
    }
    expect(missing, "actors with no eyebrow mesh").toEqual([]);
  });

  it("(3) COUNTERWEIGHT: the garment fit target is unchanged — cages stay stripped", async () => {
    // Refuses treatment (b). `remove_helpers=False` wholesale would retain helper-tights /
    // helper-skirt / helper-hair and silently re-target every garment fit on every actor.
    const drift: string[] = [];
    for (const a of ACTORS) {
      const t = await bodyTris(a);
      if (t !== STRIPPED_BODY_TRIS) drift.push(`${a}:${t}`);
      const n = await meshNames(a);
      for (const cage of [/helper[-_]?tights/i, /helper[-_]?skirt/i, /helper[-_]?hair/i, /helper[-_]?genital/i]) {
        if (has(n, cage)) drift.push(`${a}:CAGE ${cage.source}`);
      }
    }
    expect(drift, `body must stay at ${STRIPPED_BODY_TRIS} tris with no fitting cage retained`).toEqual([]);
  });

  it("(4) COUNTERWEIGHT: nothing already present is lost", async () => {
    // A selective-retention change touches the export path every actor goes through. Eyes, hair and
    // body must survive it — this is the SS6p clause: a change that removes something must say what
    // still holds.
    const lost: string[] = [];
    for (const a of ACTORS) {
      const n = await meshNames(a);
      if (!has(n, /eyes_low_poly/i)) lost.push(`${a}:eyes`);
      if (!has(n, /fitted_hair|_hair_/i)) lost.push(`${a}:hair`);
      if (!has(n, /_body$/)) lost.push(`${a}:body`);
    }
    expect(lost, "features that shipped before this slice must still ship").toEqual([]);
  });
});
