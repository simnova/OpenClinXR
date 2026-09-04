import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  equipmentFreezeRecordPath,
  readEquipmentRuntimeFreeze,
  runtimeAssetUrlForSubject,
  writeEquipmentRuntimeFreeze,
} from "./run.js";
import { planEquipmentGenerate } from "./run.js";

/**
 * OBSERVABLE: equipment_generate publishes a bake result (bake-measure.json with an
 * absolute exportPath under the gitignored OPENCLINXR_TRELLIS_OUT dir) but no runtime
 * asset URL for the declared subject. The result therefore cannot be consumed as the
 * "declared equipment id -> bake URL" contract; only parametric builder names exist.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails -> it and append ## FIXED below — never
 * rewrite the diagnosis.
 *
 * ## FIXED (tsk_7871d5ba79f7997d)
 * The station now records a per-subject freeze JSON (openclinxr.equipment-runtime-freeze.v1)
 * under OPENCLINXR_EQUIPMENT_FREEZE_DIR (default <repo>/tools/openclinxr/asset-pipeline/
 * trellis/equipment-freezes) after a mesh_exported bake. planEquipmentGenerate reflects
 * the freeze: runtimeAssetUrl (/xr-assets/medical-equipment/<subject>.glb) + subjectId +
 * freezeRecordPath on the plan; declared-but-unfrozen subjects stay a typed null (fail
 * closed — no invented URL).
 */

const FIXTURE_SHA = "5ffc60fe8238a4e1acfaed01f519e17d0861f5cc6ecdb5e138c30899eb20e8b6";

let freezeRoot = "";

afterEach(() => {
  delete process.env["OPENCLINXR_EQUIPMENT_FREEZE_DIR"];
  if (freezeRoot) rmSync(freezeRoot, { recursive: true, force: true });
  freezeRoot = "";
});

function tempFreezeRoot(): string {
  freezeRoot = mkdtempSync(path.join(tmpdir(), "equipment-freeze-"));
  process.env["OPENCLINXR_EQUIPMENT_FREEZE_DIR"] = freezeRoot;
  return freezeRoot;
}

function wallClockInput() {
  return {
    subjectId: "wall-clock",
    packId: "wall-clock",
    seed: 0,
    remesh: false,
    viewCount: 0,
    decimationTarget: 1_000_000,
  };
}

describe("the equipment station publishes a runtime asset URL", () => {
  it("(1) dry-run plan for a declared subject with a freeze publishes the freeze-addressed URL", () => {
    const root = tempFreezeRoot();
    const freeze = writeEquipmentRuntimeFreeze({
      subjectId: "wall-clock",
      displayName: "wall clinical / exam-room analog clock",
      seed: 237_802,
      remesh: false,
      decimationTarget: 16_777_216,
      bakeOutputDir: path.join(root, "bakes", "wall-clock"),
      glbExportName: "wall-clock.glb",
      glbSha256: FIXTURE_SHA,
      runtimeAssetUrl: runtimeAssetUrlForSubject("wall-clock"),
      claimScope: ["factory_station_runtime_url_contract"],
      notEvidenceFor: ["quest_readiness", "clinical_validity", "production_asset_readiness"],
    });
    expect(freeze.runtimeAssetUrl).toBe("/xr-assets/medical-equipment/wall-clock.glb");

    const planned = planEquipmentGenerate(wallClockInput());
    expect("issues" in planned).toBe(false);
    if ("issues" in planned) return;
    expect(planned.plan["subjectId"]).toBe("wall-clock");
    expect(planned.plan["runtimeAssetUrl"]).toBe("/xr-assets/medical-equipment/wall-clock.glb");
    expect(planned.plan["freezeRecordPath"]).toBe(equipmentFreezeRecordPath("wall-clock", root));
    expect(planned.plan["glbExportName"]).toBe("wall-clock.glb");
  });

  it("(2) the station publish helper writes a tracked freeze record that reads back", () => {
    const root = tempFreezeRoot();
    const rec = writeEquipmentRuntimeFreeze({
      subjectId: "ecg-cart",
      displayName: "12-lead ECG cart",
      seed: 237_802,
      remesh: false,
      decimationTarget: 16_777_216,
      bakeOutputDir: path.join(root, "bakes", "ecg-cart"),
      glbExportName: "ecg-cart.glb",
      glbSha256: FIXTURE_SHA,
      runtimeAssetUrl: runtimeAssetUrlForSubject("ecg-cart"),
      claimScope: ["factory_station_runtime_url_contract"],
      notEvidenceFor: ["quest_readiness", "clinical_validity", "production_asset_readiness"],
    });
    expect(rec.schemaVersion).toBe("openclinxr.equipment-runtime-freeze.v1");
    expect(rec.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(rec.glbSha256).toMatch(/^[0-9a-f]{64}$/);

    const readBack = readEquipmentRuntimeFreeze("ecg-cart", { root });
    expect(readBack).not.toBeNull();
    expect(readBack?.runtimeAssetUrl).toBe("/xr-assets/medical-equipment/ecg-cart.glb");
    expect(readBack?.glbSha256).toBe(FIXTURE_SHA);
  });

  it("(3) a declared subject with no freeze record stays a typed null URL (fail closed)", () => {
    tempFreezeRoot();
    const planned = planEquipmentGenerate({
      subjectId: "ecg-cart",
      packId: "ecg-cart",
      seed: 0,
      remesh: false,
      viewCount: 0,
      decimationTarget: 1_000_000,
    });
    expect("issues" in planned).toBe(false);
    if ("issues" in planned) return;
    expect(planned.plan["subjectId"]).toBe("ecg-cart");
    expect(planned.plan["runtimeAssetUrl"]).toBeNull();
    expect(String(planned.plan["freezeRecordPath"])).toMatch(/ecg-cart\.freeze\.json$/);
  });
});

// NOT TESTED: live TRELLIS GPU bake; freeze write on a real mesh_exported run (python path).
