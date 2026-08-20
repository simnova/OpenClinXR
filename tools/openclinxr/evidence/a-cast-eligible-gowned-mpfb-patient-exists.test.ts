import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * Campaign #478 lane **L5**, corrected. *"Bake one MPFB adult patient wearing that gown."*
 *
 * ## THE DEFECT, MEASURED — IMMUTABLE
 *
 * L5 was marked `landed` and it is not. The gown exists on `mpfb-gown-inspect.glb`, which is a
 * HARNESS SUBJECT: `grep -rn "mpfb-gown-inspect" asset-registry/src ui-xr/src` outside tests returns
 * **nothing**. No patient a learner can reach wears it.
 *
 *   body                            gownDeclared  gownShell
 *   --------------------------------|------------|----------
 *   mpfb-ob-patient-aisha.glb        |     n      |    n
 *   mpfb-peds-parent-aisha.glb       |     n      |    n
 *   mpfb-peds-patient-child.glb      |     n      |    n
 *   mpfb-gown-inspect.glb            |   **Y**    |  **Y**   <- cast to nothing
 *
 * Nine landings, and `railTally` is unchanged at **MPFB 32 / ANNY 7**. An orchestration review named
 * it: *"you are instrumenting a migration instead of migrating."* This is the slice that unblocks
 * the tally.
 *
 * ## WHY NOT SIMPLY GOWN AISHA — measured, and it would have been wrong
 *
 * `mpfb-ob-patient-aisha.glb` is LIVE ON STAGE: `resolveScenarioActorCast` casts it as
 * `patient_aisha_khan_v1` in `ob_headache_preeclampsia_triage_v1`. Gowning her changes what a
 * learner sees in a station that is not asking for it, and she is not in `annyRemaining` — so it
 * would not move the tally either. Checked before planting rather than after.
 *
 * ## WHAT THE SEVEN ACTUALLY NEED
 *
 * All seven remaining Anny patients resolve through ONE named constant:
 *
 *   cast-asset-constants.ts:24   export const ED_ADULT_CAST_GLB = "ed_chest_pain_adult_cast.glb";
 *
 * L6 repoints that constant. It cannot, because there is no gowned MPFB adult patient to point at.
 * **L5 builds that asset. L5 does NOT repoint anything** — L6 is frozen by the superagent and
 * clause (2) refuses doing it here.
 *
 * ## KNOWN-GOOD COLUMN (SS9h) — the proven bake, internal to the repo
 *
 * `mpfb-gown-inspect.glb` after #480/#481/#485/#487/#488, pixel-graded clean by the orchestrator:
 *
 *   gown shell        openclinxr_real_garment_peds_upper_v1_mesh   3,009 v
 *   hem fraction      0.320   (mid-thigh; a t-shirt hems at 0.573)
 *   top fraction      0.863   (reaches the shoulder)
 *   below-hip gap     11.5 - 12.7 mm  (was 143.6 mm before #481)
 *   joints / jaw      138 / true
 *   lower garment     NONE    (#487 stripped cargo_pants)
 *
 * The new asset must match that shape. These numbers are the target, not an aspiration.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                        | (1) asset | (2) seven | (3) aisha | (4) inspect | result
 *   -------------------------------------------------|-----------|-----------|-----------|-------------|--------
 *   a) today — gown on a harness subject only         | **FAIL**  |   pass    |   pass    |    pass     | REFUSED
 *   b) repoint ED_ADULT_CAST_GLB at the gowned body   |   pass    | **FAIL**  |   pass    |    pass     | REFUSED
 *   c) bake the gown onto aisha, who is already staged|   pass    |   pass    | **FAIL**  |    pass     | REFUSED
 *   d) rename the inspect GLB and call it cast-ready  |   pass    |   pass    |   pass    |  **FAIL**   | REFUSED
 *   e) bake a NEW gowned adult patient + declare it   |   pass    |   pass    |   pass    |    pass     | ALL PASS
 *
 * **(b) is the one to watch.** Repointing the constant is one line and it IS the migration — which
 * is exactly why it must not happen inside this slice. The superagent froze L6 this week; clause (2)
 * asserts all seven are still Anny-cast when this lands.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1) is the sole RED.** (2), (3) and (4) pass today and
 * exist so (1) cannot be satisfied by doing L6 early, by dressing a staged actor, or by renaming the
 * harness subject out from under the contracts that grade it. (5) is a vacuity guard.
 *
 * NOT TESTED:
 *   - The constant-offset torso. #488 measured it at std 1.5 mm against a 22.4 mm `cloth_offset` and
 *     nobody with authority called it a blocker; I had invented that precondition and withdrew it.
 *   - Whether the seven SHOULD all share one body. They share one today; L6 owns that question.
 *   - Runtime skinning, seated or supine posture, Quest, or any clinical claim.
 *
 * ## FIXED (#490)
 *
 * `bake_mpfb_gown_inspect.py` was re-run with only `--output-glb` overridden to
 * `mpfb-gown-adult-patient.glb` (default input `mpfb-viseme-inspect.glb`, the same base the proven
 * pixel-graded inspect subject was baked from — D1: gown builder reused, no authored geometry).
 * The new GLB is declared by `MPFB_GOWN_ADULT_PATIENT_GLB` in cast-asset-constants.ts and is NOT
 * wired into any pool — L6 owns the recast. Clause (1) flipped `it.fails` -> `it`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids");
const CONSTANTS = join(REPO_ROOT, "packages/openclinxr/asset-registry/src/cast-asset-constants.ts");
const INSPECT = join(GENERATED, "mpfb-gown-inspect.glb");
const AISHA = join(GENERATED, "mpfb-ob-patient-aisha.glb");

/** From the known-good column. A cast-eligible gowned patient must clear all of these. */
const MIN_SHELL_VERTS = 2_000;
const HEM_FRAC_MAX = 0.45;
const TOP_FRAC_MIN = 0.7;
const MPFB_JOINT_FLOOR = 100;
const LOWER_GARMENT_RE = /(cargo_pants|_pants|trouser)/i;

type Shape = {
  file: string;
  joints: number;
  hasJaw: boolean;
  shellVerts: number;
  hemFrac: number;
  topFrac: number;
  lowerGarments: string[];
  gownDeclared: boolean;
};

async function shapeOf(path: string): Promise<Shape | null> {
  if (!existsSync(path)) return null;
  const doc = await new NodeIO().read(path);
  const rows = doc.getRoot().listMeshes().map((m) => {
    let verts = 0;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const prim of m.listPrimitives()) {
      const a = prim.getAttribute("POSITION");
      if (!a) continue;
      verts += a.getCount();
      const e = [0, 0, 0];
      for (let i = 0; i < a.getCount(); i += 1) {
        a.getElement(i, e);
        if (e[1]! < y0) y0 = e[1]!;
        if (e[1]! > y1) y1 = e[1]!;
      }
    }
    return { name: m.getName() ?? "", verts, y0, y1 };
  });
  const body = rows.find((r) => /_body$/.test(r.name));
  // The builder names procedural garments by `gname` (`peds_upper_v1`), never by `kind` — a
  // /gown/i match finds only the 3-vertex declaration marker. That trap cost #480 a clause.
  const shell = rows.filter((r) => /real_garment/.test(r.name)).sort((a, b) => b.verts - a.verts)[0];
  const joints = doc.getRoot().listSkins()[0]?.listJoints().map((j) => j.getName() ?? "") ?? [];
  const h = body ? body.y1 - body.y0 : 1;
  return {
    file: path.split("/").pop()!,
    joints: joints.length,
    hasJaw: joints.includes("jaw"),
    shellVerts: shell?.verts ?? 0,
    hemFrac: body && shell ? (shell.y0 - body.y0) / h : NaN,
    topFrac: body && shell ? (shell.y1 - body.y0) / h : NaN,
    lowerGarments: rows.filter((r) => r.verts >= 100 && LOWER_GARMENT_RE.test(r.name)).map((r) => r.name),
    gownDeclared: rows.some((r) => /declared_upper_layers__.*gown/i.test(r.name)),
  };
}

/** Cast-eligible = declared in the registry constants AND shipped under generated-humanoids. */
async function castEligibleGownedPatients(): Promise<Shape[]> {
  const constants = readFileSync(CONSTANTS, "utf8");
  const out: Shape[] = [];
  for (const file of readdirSync(GENERATED).filter((n) => n.endsWith(".glb"))) {
    if (file === "mpfb-gown-inspect.glb") continue; // the harness subject is what this slice replaces
    if (!constants.includes(file)) continue; // must be a DECLARED cast asset, not a loose bake
    const s = await shapeOf(join(GENERATED, file));
    if (!s || !s.gownDeclared) continue;
    if (s.joints <= MPFB_JOINT_FLOOR) continue; // Anny is 23; this lane is MPFB only
    out.push(s);
  }
  return out;
}

describe("a cast-eligible gowned MPFB adult patient exists", () => {
  it("(1) a DECLARED gowned patient asset ships on the MPFB rail", async () => {
    const found = await castEligibleGownedPatients();
    expect(
      found.map((s) => s.file),
      `no GLB named in cast-asset-constants.ts carries a gown on the MPFB rail; the only gowned MPFB\n`
        + `  body is mpfb-gown-inspect.glb, which is cast to nothing`,
    ).not.toEqual([]);
    const s = found[0]!;
    expect(s.hasJaw, `${s.file} must be MPFB (jaw present); Anny has none`).toBe(true);
    expect(s.shellVerts, `${s.file} gown shell verts — the proven bake is 3,009`).toBeGreaterThanOrEqual(
      MIN_SHELL_VERTS,
    );
    expect(s.hemFrac, `${s.file} hem must reach below mid-thigh (a t-shirt hems at 0.573)`).toBeLessThanOrEqual(
      HEM_FRAC_MAX,
    );
    expect(s.topFrac, `${s.file} shell must reach the shoulder`).toBeGreaterThanOrEqual(TOP_FRAC_MIN);
    expect(s.lowerGarments, `${s.file} must not stack the gown over trousers (#487)`).toEqual([]);
  });

  it("(2) COUNTERWEIGHT: the seven are still cast on the Anny body", async () => {
    // Refuses (b). Repointing ED_ADULT_CAST_GLB is one line and it IS the migration — which is
    // exactly why it must not happen inside this slice. L6 is frozen by the superagent.
    const { resolveScenarioActorCast, listShippedCastScenarioIds } = (await import(
      "../../../packages/openclinxr/asset-registry/src/actor-casting.js"
    )) as typeof import("../../../packages/openclinxr/asset-registry/src/actor-casting.js");
    // resolveScenarioActorCast returns the cast rows DIRECTLY, not { actors: [...] }. My first
    // version assumed the wrapper, got an empty array, and clause (2) failed on the plant run —
    // the fourth wrong-shape assumption in this campaign. Shape taken from the proven enumeration
    // in campaign-track.ts:91, which is the same call this contract must agree with.
    let annyCast = 0;
    for (const id of listShippedCastScenarioIds()) {
      for (const row of resolveScenarioActorCast(id) as unknown as { assetPath?: string }[]) {
        if ((row.assetPath ?? "").includes("ed_chest_pain_adult_cast.glb")) annyCast += 1;
      }
    }
    expect(annyCast, `L6 recasts the seven and is frozen; this slice builds the asset only`).toBe(7);
  });

  it("(3) COUNTERWEIGHT: aisha's OB staging is untouched", async () => {
    // Refuses (c). mpfb-ob-patient-aisha.glb is LIVE as patient_aisha_khan_v1 in
    // ob_headache_preeclampsia_triage_v1. Gowning her changes a station nobody asked to change.
    const s = await shapeOf(AISHA);
    expect(s, "the OB patient body must still ship").not.toBeNull();
    expect(s!.gownDeclared, "the staged OB triage patient must not silently gain a gown").toBe(false);
  });

  it("(4) NET: the harness subject keeps its gown", async () => {
    // Refuses (d). Renaming the inspect GLB into a cast slot would satisfy (1) and orphan every
    // contract that grades it — #487's trouser bound and #488's torso measurement both read it.
    const s = await shapeOf(INSPECT);
    expect(s, "mpfb-gown-inspect.glb must still ship").not.toBeNull();
    expect(s!.gownDeclared, "the graded harness subject keeps its gown").toBe(true);
    expect(s!.shellVerts, "and its measured shell").toBeGreaterThanOrEqual(MIN_SHELL_VERTS);
  });

  it("(5) VACUITY GUARD: the registry and the generated directory are both readable", () => {
    // If either were empty, (1) would be unachievable rather than merely red, and this says which.
    expect(readFileSync(CONSTANTS, "utf8").length, "cast-asset-constants.ts must be readable").toBeGreaterThan(0);
    expect(
      readdirSync(GENERATED).filter((n) => n.endsWith(".glb")).length,
      "generated-humanoids must enumerate",
    ).toBeGreaterThanOrEqual(15);
  });
});
