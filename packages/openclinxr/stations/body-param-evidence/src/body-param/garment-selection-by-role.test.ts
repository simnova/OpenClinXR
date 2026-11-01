import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#275), RETIRED BY #479.
 *
 * af8571555 ("#479: cast peds_fever child + ED spouse off MPFB (L1+L2)")
 * deliberately dropped #218's library-rail coverage from casting: the ED spouse
 * moved off the 64-joint library rail (no jaw, no eye mesh) to the 137-joint
 * MPFB family-partner body, and the peds asthma adult slots moved off the hm08
 * library bodies. `hm08BodyClassCastRoles` matches cast assetPaths against
 * /body-param-(adult_*)-library\.glb/ — zero shipped casts match today, so the
 * hm08 rail this file once measured has no rows and the Anny-rail known-good
 * derived from the same cast roles has no nurse row.
 *
 * The library bodies stay on disk as staged candidates and the resolution
 * function stays wired (the constants stay exported for the S2 gowned-patient
 * swap), so this file now asserts the retirement fact plus the counterweights
 * that keep a future re-cast honest.
 */

import { NodeIO } from "@gltf-transform/core";
import {
  listShippedCastScenarioIds,
  resolveScenarioActorCast,
  LIBRARY_ADULT_HEAVY_MALE_GLB,
  LIBRARY_ADULT_LEAN_FEMALE_GLB,
} from "../../../../../../tools/openclinxr/evidence/garment-selection-by-role.js";
import {
  resolveAnnyGarmentLayers,
  resolveHm08UpperGarment,
} from "../../../../../../tools/openclinxr/asset-pipeline/makeclothes/garment-selection-by-role.js";
import { isUpperMeshName } from "../../../../../../tools/openclinxr/evidence/lib/garment-mesh-class.js";
import { CANDIDATES_DIR } from "../../../../../../tools/openclinxr/evidence/garment-selection-by-role.js";
import path from "node:path";
import { existsSync } from "node:fs";

const LIBRARY_GLB_RE = /body-param-.*-library\.glb/;

async function libraryCastHits(): Promise<{ hits: string[]; scanned: number }> {
  const hits: string[] = [];
  let scanned = 0;
  for (const scenarioId of listShippedCastScenarioIds()) {
    scanned += 1;
    for (const actor of resolveScenarioActorCast(scenarioId)) {
      if (LIBRARY_GLB_RE.test(actor.assetPath)) {
        hits.push(`${scenarioId}/${actor.actorId}:${actor.assetPath}`);
      }
    }
  }
  return { hits, scanned };
}

describe("the hm08 library rail is retired from casting (#275/#479)", () => {
  it("RETIRED: no shipped cast resolves to a body-param library body", async () => {
    // af8571555 #479 deliberately dropped #218's library-rail coverage; the
    // spouse rides MPFB_FAMILY_PARTNER_ADULT_GLB and the peds adults ride MPFB.
    const { hits, scanned } = await libraryCastHits();
    expect(scanned, "no shipped cast scenarios scanned — retirement assertion vacuous").toBeGreaterThan(0);
    expect(hits).toEqual([]);
  });

  it("COUNTERWEIGHT: the role->garment resolution still maps both rails", async () => {
    // A future re-cast must still resolve through the case definition. Nurse
    // keeps the library scrub fallback; family keeps a garment id; the two
    // rails still disagree (the predicate #275 planted).
    const nurse = resolveHm08UpperGarment("nurse");
    const family = resolveHm08UpperGarment("family");
    expect(nurse.garmentId).toBeTruthy();
    expect(family.garmentId).toBeTruthy();
    expect(nurse.garmentId).not.toBe(family.garmentId);
    expect(resolveAnnyGarmentLayers("nurse").length).toBeGreaterThan(0);
    expect(resolveAnnyGarmentLayers("family").length).toBeGreaterThan(0);
  });

  it("COUNTERWEIGHT: the retired library bodies still carry an upper garment", async () => {
    // The S2 swap path stays viable: both candidate bodies remain on disk with
    // an upper garment mesh visible through the one shared classifier.
    const { readdirSync } = await import("node:fs");
    const bodies = readdirSync(CANDIDATES_DIR)
      .filter((f) => LIBRARY_GLB_RE.test(f) && f.endsWith(".glb"))
      .sort();
    expect(bodies.length).toBeGreaterThanOrEqual(2);
    for (const body of bodies) {
      const glbPath = path.join(CANDIDATES_DIR, body);
      expect(existsSync(glbPath), `retired library body missing: ${body}`).toBe(true);
      const doc = await new NodeIO().read(glbPath);
      const uppers: string[] = [];
      for (const mesh of doc.getRoot().listMeshes()) {
        const name = mesh.getName() || "";
        if (isUpperMeshName(name)) uppers.push(name);
      }
      expect(uppers, `${body}: retired library body carries no classifier-visible upper`).not.toEqual([]);
    }
  });
});
