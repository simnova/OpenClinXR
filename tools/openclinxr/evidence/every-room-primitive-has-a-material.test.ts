import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NodeIO } from "@gltf-transform/core";

/**
 * **14 of 15 shipped room shells render roughly a third of their geometry as void, and it has been
 * misread as a lighting problem for this entire campaign.**
 *
 * Measured by the orchestrator 2026-08-21 with NodeIO over `apps/ui-xr/public/xr-assets/environment`:
 *
 *   shell                                  prims  no-mat tris / total   share
 *   ed-exam-bay-shell (hand-built)            67        0 /   792       CLEAN
 *   infinigen-stepdown                         4      168 /   388       43.3%
 *   infinigen-pediatric-fever-urgent-care      5      160 /   380       42.1%
 *   infinigen-telehealth-home-visit            4      202 /   496       40.7%
 *   infinigen-ed-exam-bay                      4      176 /   440       40.0%
 *   infinigen-ed-stroke-bay                    5      189 /   503       37.6%
 *   infinigen-primary-care-clinic              4      200 /   532       37.6%
 *   infinigen-oncology-consult                 4      174 /   464       37.5%
 *   infinigen-ob-triage                        4      162 /   436       37.2%
 *   infinigen-behavioral-health-private        4      168 /   456       36.8%
 *   infinigen-adult-ed-abdominal-bay           4      169 /   475       35.6%
 *   infinigen-pediatric-urgent-care-bay        4      124 /   354       35.0%
 *   infinigen-surgical-ward                    5      177 /   565       31.3%
 *   infinigen-inpatient-ward                   4      176 /   596       29.5%
 *   infinigen-urgent-care-clinic               5      175 /   745       23.5%
 *
 * **Exactly one no-material primitive per shell, every time, in the same size band.** That is one
 * export path dropping one surface, not fourteen accidents. The only clean shell is the hand-built
 * one.
 *
 * ## WHICH SURFACE — resolved, do not re-derive
 *
 * On `infinigen-primary-care-clinic`, per-primitive extents and mean |normal|:
 *
 *   Circle.032  marble hex tile        X6.50 Y2.41 Z6.38   n(.33,.32,.35)  mixed  -> tiled vertical
 *   Circle.043  marble square tile     X6.50 Y0.00 Z6.26   n(.00,1.0,.00)  flat   -> FLOOR
 *   Circle.054  shader_plaster.022     X6.26 Y0.00 Z6.26   n(.00,1.0,.00)  flat   -> CEILING
 *   Circle.065  *** NO MATERIAL ***    X6.50 Y2.65 Z6.50   n(.43,.32,.26)  mixed  -> THE WALLS
 *
 * `Circle.065` spans the full footprint with 2.65 m of height and mixed X/Z normals. **It is the
 * walls.** (Note for readers of #524/#525/#526: what those cards call "the wall band" is sampling
 * the CEILING plus this black primitive. The mechanism findings there stand; the noun does not.)
 *
 * ## WHY IT RENDERS BLACK
 *
 * glTF's default for a missing material is **metallic 1 / roughness 1 / white**. A fully metallic
 * surface with no environment to reflect returns black. Interior geometry with outward normals under
 * `FrontSide` is additionally culled. Neither is fixable by any amount of ambient, fill, or IBL —
 * which is why #525's three lighting candidates all left "the lower half still black" and why I
 * attributed that to the rig.
 *
 * ## THE FIX IS LOADER-SIDE. THE ROOMS CAMPAIGN STAYS CLOSED.
 *
 * After `GLTFLoader`, find primitives with no authored material and assign a **dielectric** derived
 * from that room's own plaster (`DoubleSide` if inward faces stay dark). No new geometry, no shipped
 * GLB replaced, door-leaf `5c81ffd5` untouched.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                     | (1) graph | (2) file intact | (3) visible | (4) not invented | result
 *   ----------------------------------------------|-----------|-----------------|-------------|------------------|--------
 *   a) today — one prim with no material          | **FAIL**  |      pass       |    pass     |       n/a        | REFUSED
 *   b) rewrite the GLB to add the material        |   pass    |    **FAIL**     |    pass     |       pass       | REFUSED — campaign CLOSED
 *   c) hide the prim / drop it at load            |   pass    |      pass       |  **FAIL**   |       n/a        | REFUSED — void becomes absence
 *   d) paint an invented albedo                   |   pass    |      pass       |    pass     |     **FAIL**     | REFUSED
 *   e) clone the room's plaster onto it at load   |   pass    |      pass       |    pass     |       pass       | ALL PASS
 *
 * (c) is the tempting one: hiding the primitive makes every luminance number improve, because a
 * black wall and no wall look identical from inside a box. Clause (3) is the only thing between
 * that and a green.
 *
 * ## NO INVENTED THRESHOLD, AND THE LUMINANCE IS A READING
 *
 * #529 taught this the expensive way: I bounded wall-band `sd`, the premise was false, and the
 * unasserted `HF` column was what answered the question. So here the ASSERTION is the exact
 * structural fact — zero primitives without a material in the live scene graph — and the rendered
 * luminance of the wall region is **recorded, not asserted** (§9d). I grade the pixels.
 *
 * Measured through the loader the runtime uses, never off the file (§6v): a material assigned at
 * load is invisible to NodeIO, and a material present in the file says nothing about what three.js
 * ends up with.
 *
 * claimScope: whether every primitive in the shipped room shells carries a material in the live
 *   three.js scene graph, with the shipped GLBs unmodified.
 * notEvidenceFor: the product lighting default; the AO remedy (#526); R2 albedo variation;
 *   quest_readiness; clinical_validity; whether the walls look CORRECT, only that they are surfaces.
 */

const ENV = "apps/ui-xr/public/xr-assets/environment";
const ARTIFACT = "tools/openclinxr/evidence/room-primitive-material-probe.json";
const PRIMARY = "infinigen-primary-care-clinic.glb";

/** Measured 2026-08-21 on the shipped bytes. The file must KEEP these — clause (2). */
const NO_MATERIAL_IN_FILE: Record<string, number> = {
  "infinigen-adult-ed-abdominal-bay.glb": 1, "infinigen-behavioral-health-private.glb": 1,
  "infinigen-ed-exam-bay.glb": 1, "infinigen-ed-stroke-bay.glb": 1,
  "infinigen-inpatient-ward.glb": 1, "infinigen-ob-triage.glb": 1,
  "infinigen-oncology-consult.glb": 1, "infinigen-pediatric-fever-urgent-care.glb": 1,
  "infinigen-pediatric-urgent-care-bay.glb": 1, "infinigen-primary-care-clinic.glb": 1,
  "infinigen-stepdown.glb": 1, "infinigen-surgical-ward.glb": 1,
  "infinigen-telehealth-home-visit.glb": 1, "infinigen-urgent-care-clinic.glb": 1,
};

type GraphPrim = {
  mesh?: string; material?: string | null; assignedAtLoad?: boolean;
  visible?: boolean; worldExtent?: [number, number, number]; side?: string;
  materialSource?: string; baseColor?: [number, number, number];
};
type Shell = { glb?: string; prims?: GraphPrim[]; wallRegionMeanL?: number; ceilingRegionMeanL?: number };

function probe(): { shells?: Shell[]; glbSha256?: Record<string, string> } {
  if (!existsSync(ARTIFACT)) return {};
  return JSON.parse(readFileSync(ARTIFACT, "utf8")) as { shells?: Shell[]; glbSha256?: Record<string, string> };
}
const shell = (glb: string): Shell | undefined => (probe().shells ?? []).find((s) => s.glb === glb);

describe("every room primitive has a material", () => {
  /**
   * ## FIXED (#534)
   * Loader-side: `assignMissingRoomPrimitiveMaterials` after GLTFLoader clones a DoubleSide
   * dielectric from each room's plaster onto every material-less primitive (enumerated from the
   * live graph, not a name list). GLB bytes unchanged (clause 3). Probe artifact records
   * wallRegionMeanL / ceilingRegionMeanL as readings only.
   */
  it("(1) RED: the primary-care shell has zero material-less primitives in the LIVE scene graph", () => {
    const s = shell(PRIMARY);
    expect(s?.prims, `${PRIMARY} missing from the probe artifact`).toBeTypeOf("object");
    const bare = (s!.prims ?? []).filter((p) => !p.material).map((p) => p.mesh ?? "?").sort();
    expect(bare, "primitives with no material after GLTFLoader").toEqual([]);
  });

  it("(2) RED: all 14 Infinigen shells are clean in the live scene graph", () => {
    const missing = Object.keys(NO_MATERIAL_IN_FILE).filter((g) => !shell(g));
    expect(missing, "shells absent from the probe artifact").toEqual([]);
    const dirty = Object.keys(NO_MATERIAL_IN_FILE)
      .map((g) => ({ g, n: (shell(g)!.prims ?? []).filter((p) => !p.material).length }))
      .filter((x) => x.n > 0).map((x) => `${x.g}:${x.n}`).sort();
    expect(dirty, "shells still carrying a material-less primitive at load").toEqual([]);
  });

  it("(3) COUNTERWEIGHT: the shipped GLBs still CONTAIN the material-less primitive — no asset rewrite", async () => {
    // Rooms campaign is CLOSED. Rewriting the GLB satisfies (1)(2) and is refused here. Read off the
    // FILE with NodeIO deliberately: this is the one clause that must not go through the loader.
    const io = new NodeIO();
    const still: Record<string, number> = {};
    for (const glb of Object.keys(NO_MATERIAL_IN_FILE)) {
      if (!existsSync(`${ENV}/${glb}`)) { still[glb] = -1; continue; }
      const doc = await io.read(`${ENV}/${glb}`);
      let n = 0;
      for (const me of doc.getRoot().listMeshes()) for (const p of me.listPrimitives()) if (!p.getMaterial()) n += 1;
      still[glb] = n;
    }
    expect(still, "the shipped bytes must be untouched — assign at LOAD, never in the asset")
      .toEqual(NO_MATERIAL_IN_FILE);
  });

  it("(4) COUNTERWEIGHT: the wall primitive is VISIBLE with real bounds — void must not become absence", () => {
    // A black wall and a deleted wall are indistinguishable from inside a box, and deleting makes
    // every luminance number improve. This is the cheap fix the slice is most likely to reach for.
    const s = shell(PRIMARY);
    const assigned = (s?.prims ?? []).filter((p) => p.assignedAtLoad);
    expect(assigned.length, "at least one primitive must have been assigned a material at load").toBeGreaterThan(0);
    for (const p of assigned) {
      expect(p.visible, `${p.mesh} was hidden rather than materialised`).toBe(true);
      const e = p.worldExtent ?? [0, 0, 0];
      expect(Math.max(...e), `${p.mesh} has collapsed world bounds ${JSON.stringify(e)}`).toBeGreaterThan(1);
    }
  });

  it("(5) COUNTERWEIGHT: the assigned material is DERIVED from the room, not an invented albedo", () => {
    // "Clone that room's plaster" is the directive. An invented colour is hand-authoring (D1) and
    // will differ from room to room for no reason. Each assignment must name where it came from.
    const s = shell(PRIMARY);
    const assigned = (s?.prims ?? []).filter((p) => p.assignedAtLoad);
    expect(assigned.length, "no assignment recorded").toBeGreaterThan(0);
    for (const p of assigned) {
      expect(typeof p.materialSource, `${p.mesh} must record which room material it was derived from`).toBe("string");
      expect(p.materialSource, `${p.mesh} materialSource must name a real material in the same shell`)
        .toMatch(/shader_|plaster|marble/i);
    }
  });

  it("(6) VACUITY: the probe carries a wall-region luminance READING for the primary-care camera", () => {
    // Recorded, never asserted (§9d). #529: I bounded sd, the premise was false, and the unasserted
    // HF column answered it. The grade of whether the walls read as walls is the orchestrator's.
    // NOTE (#534 worker): when the artifact is absent this clause returns early by design — clause (1)
    // owns the missing-artifact failure. That early return is intentional; do not "fix" it.
    const s = shell(PRIMARY);
    if (!s) return; // clause (1) owns the missing-artifact failure
    expect(typeof s.wallRegionMeanL, "wallRegionMeanL must be recorded as a reading").toBe("number");
    expect(typeof s.ceilingRegionMeanL, "ceilingRegionMeanL must be recorded for comparison").toBe("number");
  });
});
