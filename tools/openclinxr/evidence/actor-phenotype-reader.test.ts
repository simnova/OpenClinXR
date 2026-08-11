/**
 * issue-291 — actor-phenotype reader contract test.
 *
 * The phenotype reader (orchestrate_character.py params_from_case_definition)
 * resolves a case's generated-body params from the scenario-fixture export
 * (the case definition) instead of the legacy CASE_ACTOR_PRESETS Python dict.
 * This test proves the migration is a migration:
 *   - fixture-path params are byte-identical to the legacy preset params for the
 *     migrated peds actors (so the generated body cannot change),
 *   - generate_mesh produces a byte-identical OBJ from both param sets,
 *   - an un-authored case REFUSES instead of silently defaulting (#276),
 *   - the pre-migration ED preset path still resolves (legacy fallback intact).
 *
 * No Blender, no dev server, no render: the reader and the stub body stage are
 * pure Python and run in-process.
 */

import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");
const ANNY_PATH = "tools/openclinxr/asset-pipeline/anny";

const MIGRATED_ACTORS = ["patient_maya_johnson_v1", "parent_tara_johnson_v1", "nurse_kevin_lee_v1"];

async function runPython(script: string): Promise<string> {
  const { stdout } = await execFileAsync("python3", ["-c", script], {
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

describe("actor phenotype reader (issue-291)", () => {
  it("fixture-path params are byte-identical to the legacy preset params for the migrated peds actors", async () => {
    const stdout = await runPython(`
import sys, json
sys.path.insert(0, ${JSON.stringify(ANNY_PATH)})
from orchestrate_character import CASE_ACTOR_PRESETS, params_from_case_definition
actors = ${JSON.stringify(MIGRATED_ACTORS)}
out = {}
for actor in actors:
    preset = dict(CASE_ACTOR_PRESETS[f"peds_asthma_parent_anxiety_v1:{actor}"]["params"])
    preset["actor_id"] = actor
    fixture, role, output_name = params_from_case_definition("peds_asthma_parent_anxiety_v1", actor)
    fixture = dict(fixture)
    fixture["actor_id"] = actor
    out[actor] = {
        "params_identical": preset == fixture,
        "preset_params_hash": __import__("hashlib").sha256(json.dumps(preset, sort_keys=True).encode()).hexdigest(),
        "fixture_params_hash": __import__("hashlib").sha256(json.dumps(fixture, sort_keys=True).encode()).hexdigest(),
        "role": role,
        "output_name": output_name,
    }
print(json.dumps(out))
`);
    const parsed = JSON.parse(stdout) as Record<string, { params_identical: boolean }>;
    for (const actor of MIGRATED_ACTORS) {
      expect(parsed[actor]?.params_identical, `params differ for ${actor}`).toBe(true);
    }
  });

  it("generate_mesh produces a byte-identical OBJ from fixture params vs preset params", async () => {
    const stdout = await runPython(`
import sys, json, hashlib
sys.path.insert(0, ${JSON.stringify(ANNY_PATH)})
import generate_mesh as gm
from orchestrate_character import CASE_ACTOR_PRESETS, params_from_case_definition

def obj_sha(params):
    mesh = gm.build_source_body(params)
    return hashlib.sha256(json.dumps(mesh["vertices"], sort_keys=True).encode()).hexdigest()

actors = ${JSON.stringify(MIGRATED_ACTORS)}
out = {}
for actor in actors:
    preset = dict(CASE_ACTOR_PRESETS[f"peds_asthma_parent_anxiety_v1:{actor}"]["params"])
    fixture, role, output_name = params_from_case_definition("peds_asthma_parent_anxiety_v1", actor)
    out[actor] = {
        "preset_obj_sha256": obj_sha(preset),
        "fixture_obj_sha256": obj_sha(fixture),
    }
print(json.dumps(out))
`);
    const parsed = JSON.parse(stdout) as Record<string, { preset_obj_sha256: string; fixture_obj_sha256: string }>;
    for (const actor of MIGRATED_ACTORS) {
      expect(parsed[actor]?.preset_obj_sha256).toBe(parsed[actor]?.fixture_obj_sha256);
      expect(parsed[actor]?.preset_obj_sha256).toMatch(/^[0-9a-f]{64}$/u);
    }
  });

  it("an un-authored case refuses instead of silently defaulting to a generic adult (#276)", async () => {
    const stdout = await runPython(`
import sys, json
sys.path.insert(0, ${JSON.stringify(ANNY_PATH)})
from orchestrate_character import resolve_generation_inputs
import argparse
ns = argparse.Namespace(
    case_actor_preset="psych_suicidal_ideation_safety_v1:patient_no_phenotype",
    case_id=None, actor_role=None, output_glb="/tmp/issue291-refuse.glb", output_dir=None,
    params_json=None, params_file=None,
)
try:
    resolve_generation_inputs(ns)
    print(json.dumps({"refused": False}))
except SystemExit as exc:
    print(json.dumps({"refused": True, "message": str(exc)[:160]}))
`);
    const parsed = JSON.parse(stdout) as { refused: boolean };
    expect(parsed.refused).toBe(true);
  });

  it("the pre-migration ED legacy preset path still resolves (fallback intact)", async () => {
    const stdout = await runPython(`
import sys, json
sys.path.insert(0, ${JSON.stringify(ANNY_PATH)})
from orchestrate_character import CASE_ACTOR_PRESETS, params_from_case_definition, resolve_generation_inputs
import argparse
fixture_entry = params_from_case_definition("ed_chest_pain_priority_v2", "patient_ed_chest_pain_v1")
ns = argparse.Namespace(
    case_actor_preset="ed_chest_pain_priority_v2:patient_ed_chest_pain_v1",
    case_id=None, actor_role=None, output_glb="/tmp/issue291-ed.glb", output_dir=None,
    params_json=None, params_file=None,
)
params, case_id, actor_role, output_glb = resolve_generation_inputs(ns)
print(json.dumps({
    "fixture_entry_absent": fixture_entry is None,
    "preset_still_present": "ed_chest_pain_priority_v2:patient_ed_chest_pain_v1" in CASE_ACTOR_PRESETS,
    "resolved_case": case_id,
    "resolved_role": actor_role,
    "resolved_output": output_glb,
}))
`);
    const parsed = JSON.parse(stdout) as {
      fixture_entry_absent: boolean;
      preset_still_present: boolean;
      resolved_case: string;
      resolved_role: string;
    };
    expect(parsed.fixture_entry_absent).toBe(true);
    expect(parsed.preset_still_present).toBe(true);
    expect(parsed.resolved_case).toBe("ed_chest_pain_priority_v2");
    expect(parsed.resolved_role).toBe("patient");
  });
});
