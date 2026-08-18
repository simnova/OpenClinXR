import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * S2 of the superagent plan, 2026-08-18 — BAKE ONE MPFB INPATIENT WEARING THE STAGED GOWN.
 *
 * S0 (`bf64ff70`) measured the gate: `crudegown.mhclo` max body-vertex ref **13,351** against the
 * 13,380 helper-strip boundary — index-compatible, margin 29.
 * S1 (`364a5b6d`) wired the resolver: `hospital_gown` → `crudegown_hm08`, `kind: library`,
 * mesh prefix `makeclothes_library_crudegown`, and the materializer patient branch names the mhclo.
 *
 * Neither produced a body. This slice does, at a NEW path, and it is the first time a fitted gown
 * reaches a mesh on this rail.
 *
 * ## WHY A NEW PATH AND NOT A REBAKE
 *
 * `.openclinxr/probe/mpfb-midriff/anny-patient-pool.json`: SEVEN of fourteen patients share
 * `ed_chest_pain_adult_cast.glb`. The target is one NEW inpatient body, not a rewrite of a shipped
 * actor — clauses (5) and (6) freeze the two MPFB adults this lane baked last night so a "bake over
 * aisha" can never satisfy this contract.
 *
 * ## THE REFERENCE FLAG IS LOAD-BEARING
 *
 * `derive_macro_dict` hardcodes `gender: 0.5`, so `--reference` cannot emit a male macro and NO sex
 * knob is invented here. What `--reference ed_chest_pain_adult_cast` DOES buy is stature and age
 * solved from Hayes's own tracked `.anny_base.obj` rather than the default-macro Aisha body.
 * OMITTING the flag is the forbidden path: it produces the Aisha default body in a gown and calls it
 * an inpatient. Clause (1) is the guard — a body solved from a different reference cannot be
 * byte-identical to the Anny cast it was solved from.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                              | (1) | (2) | (3) | (4) | (5-6) | result
 *   -------------------------------------------------------|-----|-----|-----|-----|-------|--------
 *   a) today — no such GLB                                 |FAIL |FAIL |FAIL |FAIL | pass  | REFUSED
 *   b) copy ed_chest_pain_adult_cast.glb to the new path   |FAIL |pass |FAIL |FAIL | pass  | REFUSED
 *   c) rename the toigo prim "gown" on an existing bake    |pass |pass |pass |FAIL | pass  | REFUSED
 *   d) paint a gown region instead of fitting one          |pass |FAIL |FAIL |FAIL | pass  | REFUSED
 *   e) bake the gown OVER aisha at her own path            |pass |pass |pass |pass |**FAIL**| REFUSED
 *   f) bake a new body with the fitted crudegown           |pass |pass |pass |pass | pass  | ALL PASS
 *
 * **(c) is the one to watch.** A rename makes the name and the vertex count right while the mesh is
 * still a t-shirt. Clause (4) separates them by reading the inspect JSON's recorded SOURCE basename,
 * which the bake writes from the mhclo it actually consumed.
 *
 * **(b) MEASURED 2026-08-18 — the first version of this table said clause (2) would FAIL and it does
 * NOT.** I copied `ed_chest_pain_adult_cast.glb` to the new path and ran it: (1), (3) and (4) failed,
 * (2) PASSED. The Anny cast is the "male base + hospital_gown" asset, so it already carries
 * gown-named geometry. Corrected above rather than left as predicted. The consequence is worth
 * stating plainly: **clause (2) alone cannot tell a fitted crudegown from the Anny cast's existing
 * painted gown region.** (1), (3) and (4) carry that weight — a name match is not an asset check.
 *
 * **(3) bounds PLACEMENT, not presence** (§11s). A gown primitive with vertices proves geometry
 * exists; it does not prove the geometry is on the torso. The band is derived from the body's own
 * mid-height, never an authored coordinate.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1)–(4) are the REDs** — the GLB does not exist.
 * **(5) and (6) pass today** and exist to refuse treatment (e).
 *
 * NOT TESTED:
 *   - That it LOOKS like a gown. The orchestrator grades pixels after land; no clause asserts it.
 *   - Sex. `gender: 0.5` is unchanged and this body is not claimed to be male-shaped.
 *   - Hair. No `HAIR_STYLE_BY_REFERENCE` row is added, so a scalp placeholder is expected.
 *   - Which actor loads it. `actor-casting.ts` is untouched; Hayes is S4.
 *   - Fit quality, poke-through, coverage, drape, the missing `CrudeGown.png`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GEN = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids");
const NEW_GLB = join(GEN, "mpfb-inpatient-adult-male.glb");
const ANNY_CAST = join(GEN, "ed_chest_pain_adult_cast.glb");
const INSPECT = join(REPO_ROOT, "tools/openclinxr/evidence/mpfb-inpatient-adult-male-inspect.json");

/** Frozen at dispatch (HEAD 364a5b6d). A bake that rewrites either of these fails (5)/(6). */
const FROZEN: Readonly<Record<string, string>> = {
  "mpfb-ob-patient-aisha.glb": "390ee91f722113f9267641f2ebcc5e7ddeaeef3093d288dd908232120f9c5504",
  "mpfb-peds-parent-aisha.glb": "2182b8c6e6186071f45f273d69022bca31291c0cdcb7200f719eae946e5964b6",
};

const sha256 = (p: string): string => createHash("sha256").update(readFileSync(p)).digest("hex");

function requireBaked(): void {
  expect(existsSync(NEW_GLB), `${NEW_GLB} — S2 bakes this; it does not exist today`).toBe(true);
}

describe("the MPFB inpatient wears a fitted crude gown", () => {
  it("(1) RED: a new GLB exists and is not a copy of the Anny cast it was solved from", () => {
    requireBaked();
    expect(existsSync(ANNY_CAST), "the Anny reference cast must be present to compare against").toBe(true);
    expect(
      sha256(NEW_GLB),
      "a body solved from a reference cannot be byte-identical to that reference's own GLB",
    ).not.toBe(sha256(ANNY_CAST));
  });

  it("(2) RED: a gown primitive is present with real geometry", async () => {
    requireBaked();
    const doc = await new NodeIO().read(NEW_GLB);
    const gowns: Array<{ name: string; verts: number }> = [];
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const label = `${mesh.getName()} ${prim.getMaterial()?.getName() ?? ""}`;
        if (!/gown|crudegown/i.test(label)) continue;
        gowns.push({ name: mesh.getName(), verts: prim.getAttribute("POSITION")?.getCount() ?? 0 });
      }
    }
    expect(gowns.length, "primitives whose name or material matches /gown|crudegown/i").toBeGreaterThan(0);
    expect(Math.max(...gowns.map((g) => g.verts)), "the gown primitive must carry vertices").toBeGreaterThan(0);
  });

  it("(3) RED: the gown sits ACROSS the torso, not merely present somewhere", async () => {
    // §11s — presence is a count; this bounds PLACEMENT. The band is the body's own mid-height,
    // derived from the skin primitive, never an authored coordinate (D1).
    requireBaked();
    const doc = await new NodeIO().read(NEW_GLB);
    let bodyLo = Infinity;
    let bodyHi = -Infinity;
    let gownLo = Infinity;
    let gownHi = -Infinity;
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const label = `${mesh.getName()} ${prim.getMaterial()?.getName() ?? ""}`;
        const pos = prim.getAttribute("POSITION");
        if (!pos) continue;
        const isGown = /gown|crudegown/i.test(label);
        const isSkin = /skin|_body/i.test(label);
        if (!isGown && !isSkin) continue;
        const el: [number, number, number] = [0, 0, 0];
        for (let i = 0; i < pos.getCount(); i += 1) {
          const [, y] = pos.getElement(i, el);
          if (isGown) { gownLo = Math.min(gownLo, y!); gownHi = Math.max(gownHi, y!); }
          else { bodyLo = Math.min(bodyLo, y!); bodyHi = Math.max(bodyHi, y!); }
        }
      }
    }
    expect(Number.isFinite(bodyLo) && Number.isFinite(bodyHi), "a skin/body primitive must be measurable").toBe(true);
    expect(Number.isFinite(gownLo) && Number.isFinite(gownHi), "a gown primitive must be measurable").toBe(true);
    const bodyMidY = bodyLo + (bodyHi - bodyLo) / 2;
    expect(
      gownLo < bodyMidY && gownHi > bodyMidY,
      `gown spans ${gownLo.toFixed(3)}..${gownHi.toFixed(3)} and must straddle body mid-height ${bodyMidY.toFixed(3)}`,
    ).toBe(true);
  });

  it("(4) RED: the inspect JSON records crudegown.mhclo as the consumed upper source", () => {
    // Refuses (c) and (d). A rename or a painted region can make a prim called "gown"; only a real
    // fit records the mhclo the bake actually consumed.
    expect(existsSync(INSPECT), `${INSPECT} — written by the bake, recording what it consumed`).toBe(true);
    const report = JSON.parse(readFileSync(INSPECT, "utf8")) as { upperGarmentBasename?: string };
    expect(report.upperGarmentBasename, "the upper garment source the bake consumed").toBe("crudegown.mhclo");
  });

  it("(5) COUNTERWEIGHT: the shipped OB patient GLB is untouched", () => {
    // Refuses (e). This lane baked aisha last night; S2 must ADD a body, never rewrite one.
    const f = "mpfb-ob-patient-aisha.glb";
    expect(sha256(join(GEN, f)), `${f} must be byte-identical to HEAD at dispatch`).toBe(FROZEN[f]);
  });

  it("(6) COUNTERWEIGHT: the shipped peds parent GLB is untouched", () => {
    const f = "mpfb-peds-parent-aisha.glb";
    expect(sha256(join(GEN, f)), `${f} must be byte-identical to HEAD at dispatch`).toBe(FROZEN[f]);
  });
});
