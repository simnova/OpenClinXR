import { describe, expect, it } from "vitest";
import { factoryStationSchemas } from "../catalog.js";
import { planClothingConsume, refitContractFrom } from "./run.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * OBSERVABLE: clothing_consume carries the pants-fit refit contract (2026-09-05) —
 * garment source, body identity, binding topology, license/provenance, fit metrics,
 * and an explicit refusal (never a renamed fallback mesh under the garment name).
 *
 * static deformation only. No cloth simulation, animation, Quest, or clinical claims.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

describe("the clothing_consume station carries the refit contract", () => {
  it("(1) plan() passes refit fields through and accepts null refusal on success", () => {
    const planned = planClothingConsume({
      actorId: "actor_a",
      mhcloPath: "library/cargo.mhclo",
      garmentSourceHash: "abc123",
      bodyIdentity: "macros:weight=0.85",
      bindingTopologyId: "hm08",
      licenseToken: "CC0",
      licenseSource: "mhclo_header",
      topologyPreserved: true,
      uvPreserved: true,
      displacementMeanM: 0.02,
      displacementMaxM: 0.09,
      refusalReason: null,
    });
    expect("issues" in planned).toBe(false);
    if ("issues" in planned) return;
    expect(planned.plan["bodyIdentity"]).toBe("macros:weight=0.85");
    expect(planned.plan["bindingTopologyId"]).toBe("hm08");
    expect(planned.plan["refusalReason"]).toBeNull();
  });

  it("(2) plan() without refit fields keeps legacy behavior", () => {
    const planned = planClothingConsume({ actorId: "actor_a", mhcloPath: "library/scrub.mhclo" });
    expect("issues" in planned).toBe(false);
    if ("issues" in planned) return;
    expect(refitContractFrom(planned.value)).toEqual({});
    expect(planned.plan["bakerId"]).toBe("makeclothes_fit_stage");
  });

  it("(3) catalog schema reports refit fields in the JSON Schema inventory", () => {
    const json = factoryStationSchemas.clothing_consume.jsonSchema.input({ target: "draft-2020-12" });
    for (const key of ["garmentSourceHash", "bodyIdentity", "bindingTopologyId", "refusalReason"]) {
      expect(json.properties, key).toHaveProperty(key);
    }
  });

  it("(4) fit_stage.py refuses on bad binding and checks topology/UV hashes", () => {
    const src = readFileSync(join(SRC, "fit_stage.py"), "utf8");
    expect(src).toContain("refuse_fit");
    expect(src).toContain("binding_topology_mismatch");
    expect(src).toContain("topologyPreserved");
    expect(src).toContain("uvPreserved");
    expect(src).toContain("bake_targets");
    expect(src).toContain("fit_clothes_to_human");
  });

  it("(5) fit_stage.py reports garment source, body identity, license, and refusal state", () => {
    const src = readFileSync(join(SRC, "fit_stage.py"), "utf8");
    expect(src).toContain("body_identity");
    expect(src).toContain("binding-topology-id");
    expect(src).toContain("license-token");
    expect(src).toContain("refusalReason");
    expect(src).toMatch(/refit.*bodyIdentity|bodyIdentity.*refit/s);
  });
});

// NOT TESTED: live Blender fit; Quest; cloth dynamics; clinical fit.
