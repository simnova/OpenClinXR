import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { factoryStationSchemas } from "../catalog.js";
import { planClothingConsume, rigRefitContractFrom, runRigRefit } from "./run.js";

/**
 * OBSERVABLE: clothing_consume rigs refitted garments onto animated figures.
 * The refit baker exports unrigged statics (2 mesh nodes, 0 skins); the rig-refit
 * expansion consumes the refit report + GLB and the actor's body definition, binds
 * the garment to the actor's armature (binding weights where the MakeClothes
 * binding covers the mesh, auto-weights recorded where it does not), and extends
 * the station report (rigging block: joint count, weight source per mesh, clips).
 *
 * static bind pose + carried clips only. No new animation authoring, Quest, or
 * clinical claims.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

function rigPy(expression: string): string {
  const script = [
    "import json, sys",
    "sys.path.insert(0, '.')",
    "from rig_refit_stage import *",
    `print(json.dumps(${expression}, sort_keys=True))`,
  ].join("; ");
  return execFileSync("python3", ["-c", script], { encoding: "utf8", cwd: SRC }).trim();
}

const BODY_DEF = JSON.stringify({
  macros: { gender: 1.0, weight: 0.85, muscle: 0.5, height: 0.5 },
  statureTargetM: 1.76,
  bodyAssetId: "actor_a_body",
});

function rigPlan() {
  return planClothingConsume({
    actorId: "actor_a",
    mhcloPath: "library/cargo.mhclo",
    bodyDefinition: BODY_DEF,
    refitGlbPath: "refit/actor_a.glb",
    refitReportPath: "refit/actor_a.report.json",
    clipSourceGlbPath: "clips/idle.glb",
  });
}

describe("the rig-refit expansion lands garments on animated figures", () => {
  it("(1) plan() routes refit inputs to rig_refit_stage, legacy stays fit-only", () => {
    const planned = rigPlan();
    expect(planned.issues !== undefined).toBe(false);
    if (planned.issues !== undefined) return;
    expect(planned.plan["stageId"]).toBe("rig_refit_stage");
    expect(planned.plan["bakerId"]).toBe("rig_refit_stage");
    expect(planned.plan["stageScriptRel"]).toContain("rig_refit_stage.py");
    expect(rigRefitContractFrom(planned.value)).toEqual({
      refitGlbPath: "refit/actor_a.glb",
      refitReportPath: "refit/actor_a.report.json",
      clipSourceGlbPath: "clips/idle.glb",
    });
    const legacy = planClothingConsume({ actorId: "a", mhcloPath: "m" });
    expect(legacy.issues !== undefined).toBe(false);
    if (legacy.issues !== undefined) return;
    expect(legacy.plan["stageId"]).toBe("makeclothes_fit_stage");
    expect(rigRefitContractFrom(legacy.value)).toEqual({});
  });

  it("(2) catalog schema accepts the rig-refit fields as optional", () => {
    const json = factoryStationSchemas.clothing_consume.jsonSchema.input({ target: "draft-2020-12" });
    for (const key of ["refitGlbPath", "refitReportPath", "clipSourceGlbPath"]) {
      expect(json.properties, key).toHaveProperty(key);
    }
    const checked = factoryStationSchemas.clothing_consume["~standard"].validate({
      actorId: "a",
      mhcloPath: "m",
      refitGlbPath: "r.glb",
      refitReportPath: "r.json",
    });
    expect(checked.issues !== undefined).toBe(false);
  });

  it("(3) rig report propagates: refit carried, rigging block has joints/weights/clips", () => {
    const block = JSON.parse(rigPy(
      "build_rigging_block(joint_count=64, bone_names=['mixamorig:Hips','mixamorig:LeftArm']," +
      " mesh_weights=[{'mesh':'body','weightSource':'shipped_cc0_weights','reason':None}," +
      " {'mesh':'shirt','weightSource':'makeclothes_binding','reason':None}]," +
      " animation_clips=[{'name':'openclinxr_retarget_cmu_07_01_walk','channels':42}]," +
      " body_rebuild={'macroKeys':['weight']}, identity='abc')",
    )) as Record<string, unknown>;
    expect(block["jointCount"]).toBe(64);
    expect(block["weightSourcePerMesh"]).toHaveLength(2);
    expect(block["animationClips"]).toHaveLength(1);
    expect(block["bindPose"]).toBe("static");
    const extended = JSON.parse(rigPy(
      "extend_refit_report({'refit':{'active':True},'errors':[]," +
      " 'garmentMeshNames':['shirt'],'bodyMeshNames':['body']}," +
      " {'jointCount':64}, status='completed')",
    )) as Record<string, unknown>;
    expect(extended["status"]).toBe("completed");
    expect(extended["refit"]).toEqual({ active: true });
    expect(extended["garmentMeshNames"]).toEqual(["shirt"]);
    expect((extended["rigging"] as Record<string, unknown>)["jointCount"]).toBe(64);
    const src = readFileSync(join(SRC, "rig_refit_stage.py"), "utf8");
    expect(src).toContain("weightSourcePerMesh");
    expect(src).toContain("animationClips");
    expect(src).toContain("jointCount");
  });

  it("(4) weight source is binding-first and recorded per mesh", () => {
    const binding = JSON.parse(rigPy(
      "describe_garment_weight_source(binding_covers=True, binding_coverage=1.0)",
    )) as Record<string, unknown>;
    expect(binding["weightSource"]).toBe("makeclothes_binding");
    const auto = JSON.parse(rigPy(
      "describe_garment_weight_source(binding_covers=False, binding_coverage=0.31)",
    )) as Record<string, unknown>;
    expect(auto["weightSource"]).toBe("auto_weight");
    expect(String(auto["reason"])).toMatch(/binding lacks/);
    const envelope = JSON.parse(rigPy(
      "describe_garment_weight_source(binding_covers=False, binding_coverage=0.0, auto_mode='envelope')",
    )) as Record<string, unknown>;
    expect(envelope["weightSource"]).toBe("envelope_fallback");
    const src = readFileSync(join(SRC, "rig_refit_stage.py"), "utf8");
    expect(src).toContain("shipped_cc0_weights");
    expect(src).toContain("makeclothes_binding_projection");
    expect(src).toContain("autoWeightFallback");
  });

  it("(5) incompatible skeletons refuse instead of shipping a mislabeled static", async () => {
    const mismatch = JSON.parse(rigPy(
      "check_skeleton_compatible(refit_body_verts=19158, rebuilt_body_verts=19000," +
      " clip_bones=set(), actor_bones=set())",
    )) as string | null;
    expect(mismatch).toMatch(/refit_body_topology_mismatch/);
    const clipMismatch = JSON.parse(rigPy(
      "check_skeleton_compatible(refit_body_verts=19158, rebuilt_body_verts=19158," +
      " clip_bones=['ToeUnknown'], actor_bones=['mixamorig:Hips'])",
    )) as string | null;
    expect(clipMismatch).toMatch(/clip_skeleton_mismatch/);
    const compatible = rigPy(
      "check_skeleton_compatible(refit_body_verts=19158, rebuilt_body_verts=19158," +
      " clip_bones=['mixamorig:Hips'], actor_bones=['mixamorig:Hips'])",
    );
    expect(compatible).toBe("null");
    const src = readFileSync(join(SRC, "rig_refit_stage.py"), "utf8");
    expect(src).toContain("zero_or_partial_skins_would_ship_static");
    expect(src).toContain("refit_report_missing_mesh_names");
    await expect(
      runRigRefit(
        { actorId: "a", mhcloPath: "m" },
        { blender: "blender", refitGlb: "r.glb", refitReport: "r.json", bodyDefinition: BODY_DEF, outGlb: "o.glb", report: "o.json" },
      ),
    ).rejects.toThrow(/rig_refit_stage/);
  });

  it("(6) deterministic identity: same refit + body -> same output", () => {
    const body = JSON.stringify({ macros: { weight: 0.85 } });
    const a = rigPy(`rig_identity(refit_sha256='r', body_definition=${body}, clip_sha256=None)`);
    const b = rigPy(`rig_identity(refit_sha256='r', body_definition=${body}, clip_sha256=None)`);
    const c = rigPy(
      `rig_identity(refit_sha256='r', body_definition=${JSON.stringify({ macros: { weight: 0.15 } })}, clip_sha256=None)`,
    );
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("(7) reuses proven rigging code; static bind pose + carried clips only", () => {
    const src = readFileSync(join(SRC, "rig_refit_stage.py"), "utf8");
    expect(src).toContain("create_mpfb_mixamo_rig");
    expect(src).toContain("bind_meshes_to_canonical_armature");
    expect(src).toContain("build_actor_body");
    expect(src).toContain("parse_body_definition");
    expect(src).toContain("export_skins=True");
    expect(src).toContain("export_animations=True");
    expect(src).toContain("by bone NAME only");
    expect(src).toContain("no new authoring");
    expect(src).toContain("static_bind_pose_plus_carried_clips");
    expect(src).toContain("new_animation_authoring");
  });
});

// NOT TESTED: live Blender rig bake; measured joint counts on shipped GLBs;
// Quest; cloth dynamics; clinical fit.
