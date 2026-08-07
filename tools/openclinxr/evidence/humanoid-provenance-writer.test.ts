/**
 * #142 — pure-function proof that the shared provenance writer runs and emits
 * mode-tagged chains. Does NOT read shipped generated-humanoids artifacts
 * (that path is how #136 went vacuous). No Blender required.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const WRITER = path.resolve("tools/openclinxr/asset-pipeline/anny/humanoid_provenance.py");

describe("humanoid provenance writer (mode-tagged, #142)", () => {
  it("self-test entrypoint: rebake + orchestrate modes write and round-trip", async () => {
    const { stdout, stderr } = await execFileAsync("python3", [WRITER, "self-test"], {
      cwd: process.cwd(),
      env: process.env,
    });
    expect(stderr).toBe("");
    expect(stdout).toContain("humanoid_provenance self-test OK");
  });

  it("writeProvenance mode=rebake → temp dir → derivationMode + inherited licence; no annyCode", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "openclinxr-prov-writer-"));
    try {
      const outPath = path.join(tempDir, "rebake.provenance.json");
      const py = `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.dirname(WRITER))})
from humanoid_provenance import (
    DERIVATION_MODE_BLENDER_ONLY_REBAKE,
    GENERATOR_MODE_BLENDER_ONLY_REBAKE,
    build_provenance_document,
    write_provenance_document,
)
doc = build_provenance_document(
    derivation_mode=DERIVATION_MODE_BLENDER_ONLY_REBAKE,
    scenario_id="peds_asthma_parent_anxiety_v1",
    actor_id="patient_maya_johnson_v1",
    actor_role="patient",
    asset_path="apps/ui-xr/public/generated-humanoids/peds_patient_child.glb",
    generator_mode=GENERATOR_MODE_BLENDER_ONLY_REBAKE,
    source_kind="real_anny_candidate_unverified",
    uses_real_anny_forward_pass=True,
    real_anny_weights_used=False,
    not_evidence_for=["b_plus_visual_realism_gate", "quest_readiness", "production_asset_readiness"],
    source_notes=["unit"],
    params_for_hash={"baseObj": "base.obj", "garmentLayers": ["short_sleeve_exam_tshirt"]},
    base_obj="apps/ui-xr/public/generated-humanoids/peds_patient_child.anny_base.obj",
    garment_layers=["short_sleeve_exam_tshirt"],
    output_sha256="b" * 64,
    output_bytes=2_000_000,
    method="blender_stage_on_existing_real_anny_base_obj_role_wardrobe",
)
write_provenance_document(${JSON.stringify(outPath)}, doc)
print("ok")
`;
      await execFileAsync("python3", ["-c", py], { cwd: process.cwd() });
      const loaded = JSON.parse(await readFile(outPath, "utf8")) as {
        derivationMode: string;
        generatorMode: string;
        licenseChain: Record<string, unknown>;
        derivativeLineage: Record<string, unknown>;
        sourceOriginChain: Record<string, unknown>;
        toolVersion: string;
        promptOrCaseParameterHash: string;
      };
      expect(loaded.derivationMode).toBe("blender_only_rebake");
      expect(loaded.generatorMode).toBe("blender_only_rebake_on_tracked_real_anny_base_obj_v1");
      expect(loaded.licenseChain.status).toBe("inherited_from_base_not_reverified");
      expect(loaded.licenseChain).not.toHaveProperty("annyCode");
      expect(Array.isArray(loaded.licenseChain.notRun)).toBe(true);
      expect(loaded.derivativeLineage.status).toBe("wardrobe_rebake_derivative");
      expect(loaded.sourceOriginChain.sourceTopologyMode).toBe("real_anny_mpfb2_forward_pass_v1");
      expect(typeof loaded.toolVersion).toBe("string");
      expect(loaded.toolVersion.length).toBeGreaterThan(0);
      expect(loaded.promptOrCaseParameterHash).toMatch(/^[a-f0-9]{64}$/u);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("writeProvenance mode=orchestrate emits licence enumeration fields", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "openclinxr-prov-orch-"));
    try {
      const outPath = path.join(tempDir, "orch.provenance.json");
      const py = `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.dirname(WRITER))})
from humanoid_provenance import (
    DERIVATION_MODE_ORCHESTRATE,
    GENERATOR_MODE_ORCHESTRATE_REAL,
    build_provenance_document,
    write_provenance_document,
)
doc = build_provenance_document(
    derivation_mode=DERIVATION_MODE_ORCHESTRATE,
    scenario_id="peds_asthma_parent_anxiety_v1",
    actor_id="patient_maya_johnson_v1",
    actor_role="patient",
    asset_path="apps/ui-xr/public/generated-humanoids/peds_patient_child.glb",
    generator_mode=GENERATOR_MODE_ORCHESTRATE_REAL,
    source_kind="real_anny_candidate_unverified",
    uses_real_anny_forward_pass=True,
    real_anny_weights_used=False,
    not_evidence_for=["b_plus_visual_realism_gate", "quest_readiness", "production_asset_readiness"],
    source_notes=["unit"],
    params_for_hash={"seed": 42},
    source_origin_chain_extra={"sourceRecordPath": "sources/anny-github-2026.json"},
)
write_provenance_document(${JSON.stringify(outPath)}, doc)
print("ok")
`;
      await execFileAsync("python3", ["-c", py], { cwd: process.cwd() });
      const loaded = JSON.parse(await readFile(outPath, "utf8")) as {
        derivationMode: string;
        licenseChain: Record<string, unknown>;
        derivativeLineage: Record<string, unknown>;
      };
      expect(loaded.derivationMode).toBe("orchestrate");
      expect(typeof loaded.licenseChain.annyCode).toBe("string");
      expect(loaded.licenseChain.status).toBe("enumerated_from_source_record_at_orchestrate");
      expect(loaded.derivativeLineage.status).toBe("orchestrate_derivative");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rebake entrypoint calls shared write_blender_only_rebake_provenance", async () => {
    const rebakeSrc = await readFile(
      "tools/openclinxr/asset-pipeline/anny/rebake_role_wardrobe_blender_only.py",
      "utf8",
    );
    expect(rebakeSrc).toContain("from humanoid_provenance import write_blender_only_rebake_provenance");
    expect(rebakeSrc).toContain("write_blender_only_rebake_provenance(");
    // Must not still inline-manufacture only sourceOriginChain without shared writer.
    expect(rebakeSrc).not.toMatch(/"sourceOriginChain"\s*:\s*\{\s*"sourceTopologyMode"/u);
  });
});
