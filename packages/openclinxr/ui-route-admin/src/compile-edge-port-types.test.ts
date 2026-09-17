import { describe, expect, it } from "vitest";
import {
  COMPILE_EDGE_KINDS,
  derivePortTypeFromNodeId,
  inferCompileEdgeKind,
  resolveCompileEdgeConnection,
  validateCompileEdge,
} from "./compile-edge-port-types.js";

/**
 * World Compile Graph typed ports: a connection is refused unless the output's port
 * type matches the kind's required input port type. This is the operator's specific
 * ask (typed ports, ComfyUI-style interaction model, independently implemented — no
 * ComfyUI code read or copied).
 */
describe("compile edge port types", () => {
  it("(1) derives the port type from a compile-graph node id's own shape", () => {
    expect(derivePortTypeFromNodeId("actor:patient_v1:body")).toBe("body");
    expect(derivePortTypeFromNodeId("actor:patient_v1:wardrobe")).toBe("wardrobe");
    expect(derivePortTypeFromNodeId("actor:patient_v1")).toBe("character_unsplit");
    expect(derivePortTypeFromNodeId("equip:nebulizer")).toBe("equipment");
    expect(derivePortTypeFromNodeId("room:er_bay_1")).toBe("room");
    expect(derivePortTypeFromNodeId("fixture:stretcher")).toBe("fixture_slot");
    expect(derivePortTypeFromNodeId("trellis:model_1")).toBe("trellis_model");
    expect(derivePortTypeFromNodeId("nonsense_id")).toBeNull();
  });

  it("(2) ACCEPTS a matching body -> wardrobe connection", () => {
    const result = validateCompileEdge({ from: "actor:x:body", to: "actor:x:wardrobe", kind: "body_to_clothing" });
    expect(result.ok).toBe(true);
  });

  it("(3) REFUSES a reversed body_to_clothing connection (wardrobe output into a body input)", () => {
    const result = validateCompileEdge({ from: "actor:x:wardrobe", to: "actor:x:body", kind: "body_to_clothing" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/body output port/);
    }
  });

  it("(4) REFUSES body_to_clothing whose \"to\" port is an equipment input, not wardrobe", () => {
    const result = validateCompileEdge({ from: "actor:x:body", to: "equip:nebulizer", kind: "body_to_clothing" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/wardrobe input port/);
    }
  });

  it("(5) ACCEPTS wardrobe -> equipment", () => {
    expect(validateCompileEdge({ from: "actor:x:wardrobe", to: "equip:nebulizer", kind: "wardrobe_to_equipment" }).ok).toBe(true);
  });

  it("(6) REFUSES an unknown edge kind", () => {
    const result = validateCompileEdge({ from: "actor:x:body", to: "actor:x:wardrobe", kind: "ActorVariant" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/unknown compile edge kind/);
    }
  });

  it("(7) REFUSES a reserved edge kind with no backing baker (body_to_hair)", () => {
    const result = validateCompileEdge({ from: "actor:x:body", to: "actor:x:wardrobe", kind: "body_to_hair" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/no backing baker/);
    }
  });

  it("(8) ACCEPTS equip_to_fixture_slot and REFUSES it when \"to\" is not a fixture", () => {
    expect(validateCompileEdge({ from: "equip:nebulizer", to: "fixture:stretcher", kind: "equip_to_fixture_slot" }).ok).toBe(true);
    const bad = validateCompileEdge({ from: "equip:nebulizer", to: "room:er_bay_1", kind: "equip_to_fixture_slot" });
    expect(bad.ok).toBe(false);
  });

  it("(9) ACCEPTS trellis_model_to_room and REFUSES the reversed direction", () => {
    expect(validateCompileEdge({ from: "trellis:model_1", to: "room:equipment", kind: "trellis_model_to_room" }).ok).toBe(true);
    expect(validateCompileEdge({ from: "room:equipment", to: "trellis:model_1", kind: "trellis_model_to_room" }).ok).toBe(false);
  });

  it("(10) standalone_node_declared requires a self-loop", () => {
    expect(validateCompileEdge({ from: "actor:x", to: "actor:x", kind: "standalone_node_declared" }).ok).toBe(true);
    expect(validateCompileEdge({ from: "actor:x", to: "actor:y", kind: "standalone_node_declared" }).ok).toBe(false);
  });

  it("(11) requires_evidence is pattern-checked, not port-checked", () => {
    expect(
      validateCompileEdge({
        from: "actor-materialization-input:nurse_v1",
        to: "actor-materialization-evidence://nurse_v1/clothing_required",
        kind: "requires_evidence",
      }).ok,
    ).toBe(true);
    expect(validateCompileEdge({ from: "actor:x:body", to: "equip:y", kind: "requires_evidence" }).ok).toBe(false);
  });

  it("(12) inferCompileEdgeKind finds the one kind connecting a port pair, or null", () => {
    expect(inferCompileEdgeKind("actor:x:body", "actor:x:wardrobe")).toBe("body_to_clothing");
    expect(inferCompileEdgeKind("actor:x:wardrobe", "equip:y")).toBe("wardrobe_to_equipment");
    expect(inferCompileEdgeKind("actor:x:body", "equip:y")).toBeNull();
    // equip -> body is a real, distinct relationship (independence, not consumption).
    expect(inferCompileEdgeKind("equip:y", "actor:x:body")).toBe("equip_independent");
  });

  it("(13) resolveCompileEdgeConnection: the exact operator-asked scenario — mismatched refused, matching accepted", () => {
    const mismatched = resolveCompileEdgeConnection("actor:x:body", "equip:y");
    expect(mismatched.ok).toBe(false);
    if (!mismatched.ok) {
      expect(mismatched.reason).toMatch(/no compile edge kind connects a body output to an? equipment input/);
    }

    const matching = resolveCompileEdgeConnection("actor:x:wardrobe", "equip:y");
    expect(matching.ok).toBe(true);
    if (matching.ok) {
      expect(matching.edge).toEqual({ from: "actor:x:wardrobe", to: "equip:y", kind: "wardrobe_to_equipment" });
    }
  });

  it("(14) every closed-vocabulary kind is covered by a rule (no silently-unchecked kind)", () => {
    const selfLoopOrPattern = new Set(["standalone_node_declared", "requires_evidence"]);
    for (const kind of COMPILE_EDGE_KINDS) {
      if (selfLoopOrPattern.has(kind)) continue;
      // Every non-self-loop, non-pattern kind must be either explicitly unbuildable or
      // resolve through some node-ref rule when given at least plausible node ids —
      // i.e. validateCompileEdge must never fall through to the "no port-compatibility
      // rule" branch for a kind this module claims to know.
      const probe = validateCompileEdge({ from: "actor:x:body", to: "actor:x:wardrobe", kind });
      if (!probe.ok) {
        expect(probe.reason).not.toMatch(/has no port-compatibility rule/);
      }
    }
  });
});
