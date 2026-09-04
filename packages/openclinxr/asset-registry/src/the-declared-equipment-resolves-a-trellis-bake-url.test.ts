import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EQUIPMENT_RUNTIME_FREEZE_SCHEMA_VERSION,
  equipmentFreezeRecordPath,
  resolveDeclaredEquipmentRuntimeAsset,
} from "./equipment-runtime-asset.js";

/**
 * OBSERVABLE: asset-registry resolution for a declared equipment id has no
 * runtime-asset resolver — nothing returns a TRELLIS bake URL. Equipment ids can
 * only fall back to a parametric builder name (apps/ui-xr station-equipment-builders).
 *
 * Diagnosis header IMMUTABLE. Flip it.fails -> it and append ## FIXED below — never
 * rewrite the diagnosis.
 *
 * ## FIXED (tsk_7871d5ba79f7997d)
 * resolveDeclaredEquipmentRuntimeAsset(subjectId) now reads the per-subject tracked
 * freeze JSON (openclinxr.equipment-runtime-freeze.v1) written by the equipment_generate
 * station under OPENCLINXR_EQUIPMENT_FREEZE_DIR (default <repo>/tools/openclinxr/
 * asset-pipeline/trellis/equipment-freezes). A present, schema-valid freeze resolves to
 * its recorded bake URL; missing or malformed records are a TYPED miss (no throw, no
 * GLB stat — a gitignored-only GLB without a freeze JSON fails closed).
 */

let freezeRoot = "";

afterEach(() => {
  delete process.env["OPENCLINXR_EQUIPMENT_FREEZE_DIR"];
  if (freezeRoot) rmSync(freezeRoot, { recursive: true, force: true });
  freezeRoot = "";
});

function tempFreezeRoot(): string {
  freezeRoot = mkdtempSync(path.join(tmpdir(), "equipment-freeze-"));
  return freezeRoot;
}

const FIXTURE_SHA_A = "5ffc60fe8238a4e1acfaed01f519e17d0861f5cc6ecdb5e138c30899eb20e8b6";
const FIXTURE_SHA_B = "cff08df0a94ee25651d02c4667fe94232aff659d2702b04084c99c7440953f3b";

function writeFreezeFixture(subjectId: string, root: string, overrides: Record<string, unknown> = {}): string {
  const over = { ...overrides };
  const displayName = typeof over["displayName"] === "string" ? over["displayName"] : undefined;
  delete over["displayName"];
  const record = {
    schemaVersion: EQUIPMENT_RUNTIME_FREEZE_SCHEMA_VERSION,
    subjectId,
    displayName: displayName ?? `fixture ${subjectId}`,
    seed: 237_802,
    remesh: false,
    decimationTarget: 16_777_216,
    bakeOutputDir: path.join(root, "bakes", subjectId),
    glbExportName: `${subjectId}.glb`,
    glbSha256: subjectId === "wall-clock" ? FIXTURE_SHA_A : FIXTURE_SHA_B,
    runtimeAssetUrl: `/xr-assets/medical-equipment/${subjectId}.glb`,
    generatedAt: "2026-09-04T00:00:00.000Z",
    claimScope: ["factory_station_runtime_url_contract"],
    notEvidenceFor: ["quest_readiness", "clinical_validity", "production_asset_readiness"],
    ...over,
  };
  const file = equipmentFreezeRecordPath(subjectId, root);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return file;
}

describe("the declared equipment resolves a TRELLIS bake URL", () => {
  it("(1) declared subjects with freeze records resolve to distinct bake URLs", () => {
    const root = tempFreezeRoot();
    writeFreezeFixture("wall-clock", root);
    writeFreezeFixture("bedside-monitor", root);

    const wallClock = resolveDeclaredEquipmentRuntimeAsset("wall-clock", { freezeRoot: root });
    const monitor = resolveDeclaredEquipmentRuntimeAsset("bedside-monitor", { freezeRoot: root });
    expect(wallClock.status).toBe("resolved");
    expect(monitor.status).toBe("resolved");
    if (wallClock.status !== "resolved" || monitor.status !== "resolved") return;
    expect(wallClock.runtimeAssetUrl).toMatch(/^\/xr-assets\/medical-equipment\//);
    expect(monitor.runtimeAssetUrl).toMatch(/^\/xr-assets\/medical-equipment\//);
    expect(wallClock.runtimeAssetUrl).not.toBe(monitor.runtimeAssetUrl);
    expect(wallClock.glbSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(wallClock.freezeRecordPath).toBe(equipmentFreezeRecordPath("wall-clock", root));
  });

  it("(2) an unknown subject is a typed miss, not a throw", () => {
    const root = tempFreezeRoot();
    const result = resolveDeclaredEquipmentRuntimeAsset("does-not-exist-equipment", { freezeRoot: root });
    expect(result.status).toBe("miss");
    if (result.status !== "miss") return;
    expect(result.reason).toBe("no_freeze_record");
  });

  it("(3) a tracked GLB without a freeze JSON fails closed (ecg-cart land path)", () => {
    // ecg-cart-12-lead.glb IS tracked under apps/ui-xr/public/xr-assets/medical-equipment,
    // but no per-subject freeze JSON exists. GLB presence must not resolve.
    const root = tempFreezeRoot();
    const result = resolveDeclaredEquipmentRuntimeAsset("ecg-cart", { freezeRoot: root });
    expect(result.status).toBe("miss");
    if (result.status !== "miss") return;
    expect(result.reason).toBe("no_freeze_record");
  });

  it("(4) a malformed freeze record is a typed miss, not a throw", () => {
    const root = tempFreezeRoot();
    const file = writeFreezeFixture("wall-clock", root, { schemaVersion: "openclinxr.old-schema.v0" });
    expect(file.length).toBeGreaterThan(0);
    const result = resolveDeclaredEquipmentRuntimeAsset("wall-clock", { freezeRoot: root });
    expect(result.status).toBe("miss");
    if (result.status !== "miss") return;
    expect(result.reason).toBe("malformed_freeze_record");
  });

  it("(5) a gitignored-only bake GLB without a freeze JSON fails closed", () => {
    const root = tempFreezeRoot();
    // Simulate a bake that exported a GLB but never froze/promoted it.
    mkdirSync(path.join(root, "trellis-bake", "iv-pole"), { recursive: true });
    writeFileSync(path.join(root, "trellis-bake", "iv-pole", "iv-pole.glb"), "not a real glb", "utf8");
    const result = resolveDeclaredEquipmentRuntimeAsset("iv-pole", { freezeRoot: root });
    expect(result.status).toBe("miss");
    if (result.status !== "miss") return;
    expect(result.reason).toBe("no_freeze_record");
  });

  it("(6) OPENCLINXR_EQUIPMENT_FREEZE_DIR drives resolution when no root is passed", () => {
    const root = tempFreezeRoot();
    writeFreezeFixture("wall-clock", root);
    process.env["OPENCLINXR_EQUIPMENT_FREEZE_DIR"] = root;
    const result = resolveDeclaredEquipmentRuntimeAsset("wall-clock");
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.runtimeAssetUrl).toBe("/xr-assets/medical-equipment/wall-clock.glb");
  });
});

// NOT TESTED: live TRELLIS GPU bake; UI-XR mesh attach (follow-on); Quest readiness.
