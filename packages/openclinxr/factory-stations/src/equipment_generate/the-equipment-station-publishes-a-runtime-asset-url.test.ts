import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  equipmentFreezeRecordPath,
  equipmentRuntimeUrlToPublishedFile,
  isCatalogSafeEquipmentSubjectId,
  planEquipmentGenerate,
  publishAndFreezeEquipmentBake,
  readEquipmentRuntimeFreeze,
  runtimeAssetUrlForSubject,
  writeEquipmentRuntimeFreeze,
} from "./run.js";
import { KNOWN_EQUIPMENT_SUBJECTS } from "./subjects.js";

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
 *
 * ## FIXED (review 2026-09-04 — publish-then-freeze)
 * The recorded URL must point at bytes that are actually served. runEquipmentGenerate
 * now publishes the hash-verified bake GLB into the configurable runtime public root
 * (OPENCLINXR_EQUIPMENT_PUBLIC_ROOT, else <repo>/apps/ui-xr/public — apps/ui-xr serves
 * its public/ dir at the site root, so /xr-assets/medical-equipment/<subject>.glb maps to
 * <publicRoot>/xr-assets/medical-equipment/<subject>.glb) BEFORE writing the freeze, via
 * publishAndFreezeEquipmentBake: sha-verified source -> same-dir temp copy -> atomic
 * rename -> published-sha re-check -> freeze JSON. A failed publication writes no freeze
 * and returns a typed failure. planEquipmentGenerate now reports runtimeAssetUrl only
 * when the freeze is backed by matching published bytes (equipmentFreezeIsPublishVerified),
 * so no surface advertises a URL whose bytes are missing or stale.
 *
 * ## FIXED (review 2026-09-04 — traversal closures)
 * Filesystem traversal is closed on every write/read surface: a subject id is
 * validated against the declared catalog-safe grammar (EQUIPMENT_SUBJECT_ID_PATTERN
 * / isCatalogSafeEquipmentSubjectId) before any freeze/public path or runtime URL
 * is built (path/URL builders and the publish/freeze writers throw on a non-catalog
 * id before any fs access; readEquipmentRuntimeFreeze returns null); a freeze
 * record only validates when its runtimeAssetUrl EXACTLY equals
 * runtimeAssetUrlForSubject(subjectId), so a prefix-only match smuggling `..`,
 * percent-encoding, or another subject's URL is not a freeze; and the URL ->
 * published-file mapping asserts the resolved path stays beneath the resolved
 * public root and throws on escape.
 */

function sha256Bytes(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

const WALL_CLOCK_GLB_BYTES = "fixture glb bytes for wall-clock bake";
const WALL_CLOCK_GLB_SHA = sha256Bytes(WALL_CLOCK_GLB_BYTES);

let freezeRoot = "";
let publicRoot = "";

afterEach(() => {
  delete process.env["OPENCLINXR_EQUIPMENT_FREEZE_DIR"];
  delete process.env["OPENCLINXR_EQUIPMENT_PUBLIC_ROOT"];
  if (freezeRoot) rmSync(freezeRoot, { recursive: true, force: true });
  freezeRoot = "";
  if (publicRoot) rmSync(publicRoot, { recursive: true, force: true });
  publicRoot = "";
});

function tempFreezeRoot(): string {
  freezeRoot = mkdtempSync(path.join(tmpdir(), "equipment-freeze-"));
  process.env["OPENCLINXR_EQUIPMENT_FREEZE_DIR"] = freezeRoot;
  return freezeRoot;
}

function tempPublicRoot(): string {
  publicRoot = mkdtempSync(path.join(tmpdir(), "equipment-public-"));
  process.env["OPENCLINXR_EQUIPMENT_PUBLIC_ROOT"] = publicRoot;
  return publicRoot;
}

function publishedFilePath(subjectId: string, pubRoot: string): string {
  return equipmentRuntimeUrlToPublishedFile(runtimeAssetUrlForSubject(subjectId), pubRoot);
}

function writePublishedFixture(subjectId: string, pubRoot: string, body: string = WALL_CLOCK_GLB_BYTES): string {
  const file = publishedFilePath(subjectId, pubRoot);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body, "utf8");
  return file;
}

function writeBakeGlb(bakeDir: string, subjectId: string, body: string = WALL_CLOCK_GLB_BYTES): string {
  mkdirSync(bakeDir, { recursive: true });
  const file = path.join(bakeDir, `${subjectId}.glb`);
  writeFileSync(file, body, "utf8");
  return file;
}

function wallClockFreezeInput(bakeDir: string) {
  return {
    subjectId: "wall-clock",
    displayName: "wall clinical / exam-room analog clock",
    seed: 237_802,
    remesh: false,
    decimationTarget: 16_777_216,
    bakeOutputDir: bakeDir,
    glbExportName: "wall-clock.glb",
  };
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
  it("(1) dry-run plan for a declared subject with a publish-backed freeze publishes the freeze-addressed URL", () => {
    const root = tempFreezeRoot();
    const pubRoot = tempPublicRoot();
    const freeze = writeEquipmentRuntimeFreeze({
      ...wallClockFreezeInput(path.join(root, "bakes", "wall-clock")),
      glbSha256: WALL_CLOCK_GLB_SHA,
      runtimeAssetUrl: runtimeAssetUrlForSubject("wall-clock"),
      claimScope: ["factory_station_runtime_url_contract"],
      notEvidenceFor: ["quest_readiness", "clinical_validity", "production_asset_readiness"],
    });
    // The URL is backed by the exact bytes the freeze hashes.
    writePublishedFixture("wall-clock", pubRoot);
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
      ...wallClockFreezeInput(path.join(root, "bakes", "ecg-cart")),
      subjectId: "ecg-cart",
      displayName: "12-lead ECG cart",
      glbSha256: WALL_CLOCK_GLB_SHA,
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
    expect(readBack?.glbSha256).toBe(WALL_CLOCK_GLB_SHA);
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

  it("(4) publishAndFreezeEquipmentBake atomically publishes the hash-verified GLB into the configurable public root and only then freezes", () => {
    const root = tempFreezeRoot();
    const pubRoot = tempPublicRoot();
    const bakeDir = path.join(root, "bakes", "wall-clock");
    writeBakeGlb(bakeDir, "wall-clock");

    const outcome = publishAndFreezeEquipmentBake(wallClockFreezeInput(bakeDir));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.runtimeAssetUrl).toBe("/xr-assets/medical-equipment/wall-clock.glb");
    expect(outcome.publishedAbsPath).toBe(publishedFilePath("wall-clock", pubRoot));
    expect(outcome.freezeRecord.glbSha256).toBe(WALL_CLOCK_GLB_SHA);
    // Published bytes are the bake's bytes, present under the runtime public root.
    expect(readFileSync(publishedFilePath("wall-clock", pubRoot), "utf8")).toBe(WALL_CLOCK_GLB_BYTES);
    // Freeze record exists and matches the published bytes.
    const readBack = readEquipmentRuntimeFreeze("wall-clock", { root });
    expect(readBack).not.toBeNull();
    expect(readBack?.glbSha256).toBe(WALL_CLOCK_GLB_SHA);
  });

  it("(5) a failed publication fails closed — no freeze JSON records a URL that was never published", () => {
    const root = tempFreezeRoot();
    // The configured public root is a FILE, so mkdir of its xr-assets subtree fails.
    const blocker = path.join(tmpdir(), `equipment-public-blocker-${process.pid}`);
    writeFileSync(blocker, "not a directory", "utf8");
    process.env["OPENCLINXR_EQUIPMENT_PUBLIC_ROOT"] = blocker;
    const bakeDir = path.join(root, "bakes", "wall-clock");
    writeBakeGlb(bakeDir, "wall-clock");

    const outcome = publishAndFreezeEquipmentBake(wallClockFreezeInput(bakeDir));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("publish_write_failed");
    expect(readEquipmentRuntimeFreeze("wall-clock", { root })).toBeNull();
    expect(existsSync(path.join(blocker, "xr-assets"))).toBe(false);
    rmSync(blocker, { force: true });
  });

  it("(6) a freeze whose published bytes are missing stays a typed null URL on the plan (fail closed)", () => {
    const root = tempFreezeRoot();
    tempPublicRoot();
    writeEquipmentRuntimeFreeze({
      ...wallClockFreezeInput(path.join(root, "bakes", "wall-clock")),
      glbSha256: WALL_CLOCK_GLB_SHA,
      runtimeAssetUrl: runtimeAssetUrlForSubject("wall-clock"),
      claimScope: ["factory_station_runtime_url_contract"],
      notEvidenceFor: ["quest_readiness", "clinical_validity", "production_asset_readiness"],
    });
    // The freeze exists but nothing was published under the empty public root.
    const planned = planEquipmentGenerate(wallClockInput());
    expect("issues" in planned).toBe(false);
    if ("issues" in planned) return;
    expect(planned.plan["runtimeAssetUrl"]).toBeNull();
    expect(String(planned.plan["freezeRecordPath"])).toMatch(/wall-clock\.freeze\.json$/);
  });

  it("(7) non-catalog subject ids are refused before any freeze/public path or URL is built", () => {
    const root = tempFreezeRoot();
    const pubRoot = tempPublicRoot();
    const bakeDir = path.join(root, "bakes", "wall-clock");
    writeBakeGlb(bakeDir, "wall-clock");

    // ../ segments, percent-encoded traversal, path separators, and dot files
    // all fail the declared catalog-safe grammar.
    const hostileIds = ["../wall-clock", "..%2fwall-clock", "wall/clock", "wall%2fclock", ".hidden"];
    for (const subjectId of hostileIds) {
      expect(isCatalogSafeEquipmentSubjectId(subjectId)).toBe(false);
      expect(() => runtimeAssetUrlForSubject(subjectId)).toThrow(/not catalog-safe/);
      expect(() => equipmentFreezeRecordPath(subjectId, root)).toThrow(/not catalog-safe/);
      expect(() => publishAndFreezeEquipmentBake({ ...wallClockFreezeInput(bakeDir), subjectId })).toThrow(
        /not catalog-safe/,
      );
      expect(() =>
        writeEquipmentRuntimeFreeze({
          ...wallClockFreezeInput(bakeDir),
          subjectId,
          glbSha256: WALL_CLOCK_GLB_SHA,
          runtimeAssetUrl: runtimeAssetUrlForSubject("wall-clock"),
          claimScope: [],
          notEvidenceFor: [],
        }),
      ).toThrow(/not catalog-safe/);
      expect(readEquipmentRuntimeFreeze(subjectId, { root })).toBeNull();
    }
    // No freeze record was written for any hostile id...
    expect(readdirSync(root).filter((name) => name.endsWith(".freeze.json"))).toEqual([]);
    // ...and no publish target escaped into the public root's parents.
    expect(existsSync(path.join(path.dirname(pubRoot), "xr-assets"))).toBe(false);
    expect(existsSync(path.join(path.dirname(pubRoot), "wall-clock.glb"))).toBe(false);
  });

  it("(8) every catalog-declared subject id passes the grammar and maps inside the public root", () => {
    const pubRoot = tempPublicRoot();
    expect(KNOWN_EQUIPMENT_SUBJECTS.length).toBeGreaterThan(0);
    for (const entry of KNOWN_EQUIPMENT_SUBJECTS) {
      expect(isCatalogSafeEquipmentSubjectId(entry.subjectId)).toBe(true);
      const url = runtimeAssetUrlForSubject(entry.subjectId);
      expect(url).toBe(`/xr-assets/medical-equipment/${entry.subjectId}.glb`);
      expect(equipmentRuntimeUrlToPublishedFile(url, pubRoot)).toBe(
        path.join(pubRoot, `xr-assets/medical-equipment/${entry.subjectId}.glb`),
      );
    }
  });

  it("(9) a freeze whose runtimeAssetUrl names another subject is not a valid freeze for its subject", () => {
    const root = tempFreezeRoot();
    const pubRoot = tempPublicRoot();
    // wall-clock's freeze records bedside-monitor's URL...
    writeEquipmentRuntimeFreeze({
      ...wallClockFreezeInput(path.join(root, "bakes", "wall-clock")),
      glbSha256: WALL_CLOCK_GLB_SHA,
      runtimeAssetUrl: runtimeAssetUrlForSubject("bedside-monitor"),
      claimScope: ["factory_station_runtime_url_contract"],
      notEvidenceFor: ["quest_readiness", "clinical_validity", "production_asset_readiness"],
    });
    // ...and bedside-monitor's published bytes exist and match the recorded sha.
    writePublishedFixture("bedside-monitor", pubRoot);
    expect(readEquipmentRuntimeFreeze("wall-clock", { root })).toBeNull();
    const planned = planEquipmentGenerate(wallClockInput());
    expect("issues" in planned).toBe(false);
    if ("issues" in planned) return;
    expect(planned.plan["runtimeAssetUrl"]).toBeNull();
  });

  it("(10) the URL -> published-file mapping asserts containment beneath the public root", () => {
    const pubRoot = tempPublicRoot();
    expect(() =>
      equipmentRuntimeUrlToPublishedFile("/xr-assets/medical-equipment/../../../station-escape.glb", pubRoot),
    ).toThrow(/escapes public root/);
    // Valid URL mapping is unchanged.
    expect(equipmentRuntimeUrlToPublishedFile("/xr-assets/medical-equipment/wall-clock.glb", pubRoot)).toBe(
      path.join(pubRoot, "xr-assets/medical-equipment/wall-clock.glb"),
    );
  });
});

// NOT TESTED: live TRELLIS GPU bake; freeze write on a real mesh_exported run (python path).
