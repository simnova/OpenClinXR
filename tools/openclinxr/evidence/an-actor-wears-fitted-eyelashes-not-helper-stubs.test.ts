/**
 * Eyelashes ship at 368 triangles from hm08 helper geometry. Eyebrows ship at 35,334 from a fitted
 * library asset. Two adjacent features of one face, 96x apart, and the low-fidelity one was never a
 * decision.
 *
 * MEASURED 2026-08-26 on main, all 11 shipped MPFB humanoids:
 *
 *   lash meshes named hm08 (helper geometry)      11
 *   lash meshes fitted from eyelashes01            0
 *
 *   mpfb-ob-patient-aisha, per mesh:
 *     26,756  mpfb_ob_patient_aisha_body                             <- #542 invariant
 *     35,334  openclinxr_fitted_eyebrow_mindfront_eyebrows_05_...    <- FITTED from eyebrows01
 *        368  openclinxr_hm08_eyelash_...                            <- helper geometry
 *        192  openclinxr_hm08_teeth_...
 *        448  openclinxr_hm08_tongue_...
 *
 * The eyelashes01 pack is staged, CC0, and deliberately unfitted. Five variants, quads:
 *   mindfront_eyelashes_01   8,316 quads = 16,632 tris   <- smallest, still 45x the shipped lash
 *   ..._03  9,396 = 18,792   ..._04  12,186 = 24,372   ..._02  12,744 = 25,488   ..._05  14,850 = 29,700
 *
 * THE MECHANISM IS ALREADY PROVEN, BY THE BROWS, ON THE SAME PATH.
 * materialize_mpfb_humanoid_candidate.py:3522 — "Pack is CC0 on every .mhclo header; ClothesService
 * fits against hm08 basemesh refs. The fitted mesh is a SEPARATE object, so the strip does not touch
 * it. Eyelashes are NOT fitted from eyelashes01 here — they are retained from hm08 helper groups
 * just below (do not do both)."
 *
 * So this is not a failed fit and not a licence block. Brows go through EYEBROW_STYLE_BY_REFERENCE
 * (:105), a per-actor style map. `grep EYELASH_STYLE` returns 0. The lashes came along as a
 * by-product of #542's helper extraction, whose goal was keeping the body at 26,756 tris.
 *
 * WHY THE ASSERTION IS ON SHIPPED BYTES, not on the pipeline: the bake is the layer that decides,
 * and reading the fixture or the manifest answers a different question (the wrong-layer error #568
 * recorded twice in one night). A glTF mesh name is layer-independent.
 *
 * claimScope: which source each shipped actor's lash mesh comes from, and the three counts a lash
 *   refit must not disturb.
 * notEvidenceFor: whether a fitted lash LOOKS better. Every number here is geometry. A fitted lash
 *   that reads no different at conversational distance is a real outcome and closes this card.
 */
import { describe, it, expect } from "vitest";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { readdirSync } from "node:fs";

const DIR = "apps/ui-xr/public/generated-humanoids";
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const assets = (): string[] =>
  readdirSync(DIR).filter((f) => f.startsWith("mpfb") && f.endsWith(".glb")).sort();

type Mesh = { name: string; tris: number };
async function meshes(glb: string): Promise<Mesh[]> {
  const d = await io.read(`${DIR}/${glb}`);
  return d.getRoot().listMeshes().map((m) => ({
    name: m.getName(),
    tris: m.listPrimitives().reduce((t, p) => {
      const i = p.getIndices();
      return t + (i ? i.getCount() / 3 : (p.getAttribute("POSITION")?.getCount() ?? 0) / 3);
    }, 0),
  }));
}

describe("an actor wears fitted eyelashes, not helper stubs (#683)", () => {
  it.fails(
    "(1) every shipped actor's lash mesh is fitted from eyelashes01, not hm08 helper geometry",
    async () => {
      const stubs: string[] = [];
      for (const glb of assets()) {
        for (const m of await meshes(glb)) {
          if (!/lash/i.test(m.name)) continue;
          if (/hm08/.test(m.name)) stubs.push(`${glb}: ${m.name} (${Math.round(m.tris)} tris)`);
        }
      }
      expect(
        stubs,
        "lash meshes still come from hm08 helper geometry. The eyelashes01 pack is staged and CC0; "
          + "the brows prove the ClothesService fit path on the same basemesh refs:\n"
          + stubs.join("\n"),
      ).toHaveLength(0);
    },
    1_800_000,
  );

  // (2) COUNTERWEIGHT — the source warns "do not do both". Fitting eyelashes01 while retaining the
  //     hm08 helper lashes gives an actor two sets. EXACTLY one, never "at least one".
  it("(2) COUNTERWEIGHT: exactly one lash mesh per actor", async () => {
    for (const glb of assets()) {
      const lashes = (await meshes(glb)).filter((m) => /lash/i.test(m.name));
      expect(lashes.length, `${glb} has ${lashes.length} lash meshes: ${lashes.map((l) => l.name).join(", ")}`)
        .toBe(1);
    }
  }, 1_800_000);

  // (3) COUNTERWEIGHT: #542's invariant. Helper extraction exists so the basemesh stays 26,756 tris.
  //     A refit that re-targets the basemesh has broken the thing it was built around.
  it("(3) COUNTERWEIGHT: the body stays 26,756 tris", async () => {
    const bodies: string[] = [];
    for (const glb of assets()) {
      for (const m of await meshes(glb)) {
        if (!/_body$/.test(m.name)) continue;
        if (Math.round(m.tris) !== 26756) bodies.push(`${glb}: ${m.name} = ${Math.round(m.tris)}`);
      }
    }
    expect(bodies, `body triangle count moved from #542's 26,756:\n${bodies.join("\n")}`).toHaveLength(0);
  }, 1_800_000);

  // (4) COUNTERWEIGHT: this slice touches lashes. A brow count that moves means the fit order or the
  //     helper strip was disturbed. Teeth and tongue are in the same extraction and stay helper-held.
  it("(4) COUNTERWEIGHT: brows stay fitted, teeth and tongue stay helper-retained", async () => {
    for (const glb of assets()) {
      const ms = await meshes(glb);
      const brow = ms.find((m) => /brow/i.test(m.name));
      expect(brow?.name ?? "", `${glb} lost its fitted eyebrow`).toMatch(/fitted_eyebrow_mindfront_eyebrows_/);
      for (const feature of ["teeth", "tongue"]) {
        const f = ms.find((m) => new RegExp(feature, "i").test(m.name));
        expect(f?.name ?? "", `${glb} ${feature} left hm08 helper retention`).toMatch(/hm08/);
      }
    }
  }, 1_800_000);
});
