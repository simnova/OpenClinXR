import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { factoryStationSchemas } from "../catalog.js";
import { planClothingConsume, refitContractFrom } from "./run.js";

/**
 * OBSERVABLE: clothing_consume builds the ACTOR's body from a per-actor body
 * definition instead of the station-default body, so the factory itself produces
 * actor-specific fits (not library artifacts fitted to one default adult body).
 *
 * bodyDefinition is a JSON string: { macros?, statureTargetM?, bodyAssetId? }.
 * Canonical source is the MPFB macro dict + stature target derived from the
 * case-authored phenotype (body_param/phenotype_macros.py); actor-casting maps
 * role->shipped GLB (artifacts, no params), so bodyAssetId is provenance only.
 * Absent bodyDefinition reproduces the current default-body behavior.
 *
 * static deformation only. No sim, animation, Quest, or clinical claims.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

const BODY_A = JSON.stringify({
  macros: { gender: 1.0, weight: 0.15, muscle: 0.5, height: 0.5 },
  statureTargetM: 1.76,
  bodyAssetId: "actor_a_body",
});
const BODY_B = JSON.stringify({
  macros: { gender: 1.0, weight: 0.85, muscle: 0.5, height: 0.5 },
  statureTargetM: 1.76,
  bodyAssetId: "actor_b_body",
});

function macroWeightDelta(aJson: string, bJson: string): number {
  const a = JSON.parse(aJson) as { macros: Record<string, number> };
  const b = JSON.parse(bJson) as { macros: Record<string, number> };
  return Math.abs((b.macros["weight"] ?? 0.5) - (a.macros["weight"] ?? 0.5));
}

describe("the clothing_consume station builds per-actor bodies", () => {
  it("(1) plan() passes bodyDefinition through into the baker plan", () => {
    const planned = planClothingConsume({
      actorId: "actor_a",
      mhcloPath: "library/cargo.mhclo",
      bodyDefinition: BODY_A,
    });
    expect("issues" in planned).toBe(false);
    if ("issues" in planned) return;
    expect(planned.plan["bodyDefinition"]).toBe(BODY_A);
    expect(refitContractFrom(planned.value)["bodyDefinition"]).toBe(BODY_A);
  });

  it("(2) two macro sets route as distinct baker inputs with nontrivial separation", () => {
    const planA = planClothingConsume({ actorId: "a", mhcloPath: "m", bodyDefinition: BODY_A });
    const planB = planClothingConsume({ actorId: "b", mhcloPath: "m", bodyDefinition: BODY_B });
    expect("issues" in planA).toBe(false);
    expect("issues" in planB).toBe(false);
    if ("issues" in planA || "issues" in planB) return;
    expect(planA.plan["bodyDefinition"]).not.toBe(planB.plan["bodyDefinition"]);
    // Weight 0.15 vs 0.85: the same spread the body_param rail measures as
    // 8.76 cm girth displacement at matched stature — nontrivial by construction.
    expect(macroWeightDelta(BODY_A, BODY_B)).toBeGreaterThan(0.5);
  });

  it("(3) absent bodyDefinition keeps default-body behavior", () => {
    const planned = planClothingConsume({ actorId: "actor_a", mhcloPath: "library/scrub.mhclo" });
    expect("issues" in planned).toBe(false);
    if ("issues" in planned) return;
    expect("bodyDefinition" in planned.plan).toBe(false);
    expect(refitContractFrom(planned.value)).toEqual({});
    const fitSrc = readFileSync(join(SRC, "fit_stage.py"), "utf8");
    // Legacy path still present: default create_human with no macro dict.
    expect(fitSrc).toContain("feet_on_ground=True,");
    expect(fitSrc).toContain("body_definition is None");
  });

  it("(4) catalog schema accepts optional bodyDefinition", () => {
    const json = factoryStationSchemas.clothing_consume.jsonSchema.input({ target: "draft-2020-12" });
    expect(json.properties, "bodyDefinition").toHaveProperty("bodyDefinition");
    const checked = factoryStationSchemas.clothing_consume["~standard"].validate({
      actorId: "a",
      mhcloPath: "m",
      bodyDefinition: BODY_A,
    });
    expect("issues" in checked).toBe(false);
  });

  it("(5) fit_stage.py builds the per-actor body and refuses on bad definition or binding", () => {
    const fitSrc = readFileSync(join(SRC, "fit_stage.py"), "utf8");
    // Per-actor build: macro dict + immediate bake + stature solve + grounding
    // (pants-fit-proof.py make_body pattern), verified against THAT body's verts.
    expect(fitSrc).toContain("macro_detail_dict");
    expect(fitSrc).toContain("build_actor_body");
    expect(fitSrc).toContain("bodyDefinition is not valid JSON");
    expect(fitSrc).toContain("binding_topology_mismatch");
    const runSrc = readFileSync(join(SRC, "run.ts"), "utf8");
    expect(runSrc).toContain("--body-definition");
  });
});

// NOT TESTED: live Blender per-actor fit; measured displacement between fitted
// garments; Quest; cloth dynamics; clinical fit.
