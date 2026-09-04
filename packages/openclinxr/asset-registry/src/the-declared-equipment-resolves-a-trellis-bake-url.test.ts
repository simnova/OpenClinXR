import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EQUIPMENT_RUNTIME_FREEZE_SCHEMA_VERSION,
  equipmentFreezeRecordPath,
  equipmentRuntimeUrlToPublishedFile,
  isCatalogSafeEquipmentSubjectId,
  resolveDeclaredEquipmentRuntimeAsset,
  runtimeAssetUrlForSubject,
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
 *
 * ## FIXED (review 2026-09-04 — published-target verification)
 * A freeze record alone no longer resolves. The URL it records must be backed by
 * published bytes under the runtime public root (OPENCLINXR_EQUIPMENT_PUBLIC_ROOT,
 * else <repo>/apps/ui-xr/public): the file serving
 * /xr-assets/medical-equipment/<subject>.glb must exist AND its sha256 must equal
 * the freeze's glbSha256. Missing or SHA-mismatched published targets are new typed
 * misses (published_target_missing / published_target_sha_mismatch), so resolution
 * never returns a URL whose bytes are absent or stale.
 *
 * ## FIXED (review 2026-09-04 — traversal closures)
 * Filesystem traversal is closed on every read/write surface: a subject id is
 * validated against the declared catalog-safe grammar (EQUIPMENT_SUBJECT_ID_PATTERN
 * / isCatalogSafeEquipmentSubjectId) before any freeze or public path is built — a
 * non-catalog id (../, percent-encoded, separator-bearing) is a typed
 * subject_id_not_catalog_safe miss that never touches the fs; a freeze record only
 * validates when its runtimeAssetUrl EXACTLY equals runtimeAssetUrlForSubject(
 * subjectId), so a prefix-only match smuggling `..` segments, percent-encoding, or
 * another subject's URL is malformed_freeze_record; and the URL -> published-file
 * mapping (equipmentRuntimeUrlToPublishedFile) asserts the resolved path stays
 * beneath the resolved public root and throws on escape.
 */

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
  return freezeRoot;
}

function tempPublicRoot(): string {
  publicRoot = mkdtempSync(path.join(tmpdir(), "equipment-public-"));
  return publicRoot;
}

function sha256Bytes(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

function publishedFilePath(subjectId: string, pubRoot: string): string {
  return equipmentRuntimeUrlToPublishedFile(`/xr-assets/medical-equipment/${subjectId}.glb`, pubRoot);
}

/** Writes the file that would serve /xr-assets/medical-equipment/<subject>.glb under pubRoot. */
function writePublishedFixture(subjectId: string, pubRoot: string, body: string = `fixture glb bytes for ${subjectId}`): string {
  const file = publishedFilePath(subjectId, pubRoot);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body, "utf8");
  return file;
}

function defaultGlbSha256(subjectId: string): string {
  return sha256Bytes(`fixture glb bytes for ${subjectId}`);
}

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
    glbSha256: defaultGlbSha256(subjectId),
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
  it("(1) declared subjects with freeze records + published bytes resolve to distinct bake URLs", () => {
    const root = tempFreezeRoot();
    const pubRoot = tempPublicRoot();
    writeFreezeFixture("wall-clock", root);
    writeFreezeFixture("bedside-monitor", root);
    writePublishedFixture("wall-clock", pubRoot);
    writePublishedFixture("bedside-monitor", pubRoot);

    const wallClock = resolveDeclaredEquipmentRuntimeAsset("wall-clock", { freezeRoot: root, publicRoot: pubRoot });
    const monitor = resolveDeclaredEquipmentRuntimeAsset("bedside-monitor", { freezeRoot: root, publicRoot: pubRoot });
    expect(wallClock.status).toBe("resolved");
    expect(monitor.status).toBe("resolved");
    if (wallClock.status !== "resolved" || monitor.status !== "resolved") return;
    expect(wallClock.runtimeAssetUrl).toMatch(/^\/xr-assets\/medical-equipment\//);
    expect(monitor.runtimeAssetUrl).toMatch(/^\/xr-assets\/medical-equipment\//);
    expect(wallClock.runtimeAssetUrl).not.toBe(monitor.runtimeAssetUrl);
    expect(wallClock.glbSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(wallClock.freezeRecordPath).toBe(equipmentFreezeRecordPath("wall-clock", root));
    expect(wallClock.publishedAbsPath).toBe(publishedFilePath("wall-clock", pubRoot));
    // The freeze's gitignored bake dir is never consulted — only the published bytes matter.
    expect(existsSync(path.join(root, "bakes", "wall-clock"))).toBe(false);
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

  it("(6) freeze + public root env vars drive resolution when no roots are passed", () => {
    const root = tempFreezeRoot();
    const pubRoot = tempPublicRoot();
    writeFreezeFixture("wall-clock", root);
    writePublishedFixture("wall-clock", pubRoot);
    process.env["OPENCLINXR_EQUIPMENT_FREEZE_DIR"] = root;
    process.env["OPENCLINXR_EQUIPMENT_PUBLIC_ROOT"] = pubRoot;
    const result = resolveDeclaredEquipmentRuntimeAsset("wall-clock");
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.runtimeAssetUrl).toBe("/xr-assets/medical-equipment/wall-clock.glb");
    expect(result.publishedAbsPath).toBe(publishedFilePath("wall-clock", pubRoot));
  });

  it("(7) a valid freeze whose published target is missing is a typed miss", () => {
    const root = tempFreezeRoot();
    const pubRoot = tempPublicRoot();
    writeFreezeFixture("wall-clock", root);
    // No published file under pubRoot — the recorded URL would 404.
    const result = resolveDeclaredEquipmentRuntimeAsset("wall-clock", { freezeRoot: root, publicRoot: pubRoot });
    expect(result.status).toBe("miss");
    if (result.status !== "miss") return;
    expect(result.reason).toBe("published_target_missing");
    expect(result.freezeRecordPath).toBe(equipmentFreezeRecordPath("wall-clock", root));
  });

  it("(8) a valid freeze whose published bytes do not match glbSha256 is a typed miss", () => {
    const root = tempFreezeRoot();
    const pubRoot = tempPublicRoot();
    const staleBody = "stale published bytes that no longer match the freeze";
    writePublishedFixture("wall-clock", pubRoot, staleBody);
    // Freeze records the sha of DIFFERENT bytes — a re-baked or drifted target.
    writeFreezeFixture("wall-clock", root, { glbSha256: sha256Bytes("different bake bytes") });
    const result = resolveDeclaredEquipmentRuntimeAsset("wall-clock", { freezeRoot: root, publicRoot: pubRoot });
    expect(result.status).toBe("miss");
    if (result.status !== "miss") return;
    expect(result.reason).toBe("published_target_sha_mismatch");
  });

  it("(9) a ../ subject id is a typed miss before any freeze path is built, even when a freeze file sits at the escaped location", () => {
    const root = tempFreezeRoot();
    const pubRoot = tempPublicRoot();
    // A schema-shaped record planted where "../registry-escape" would read from
    // (the freeze root's parent). Its subjectId matches the request, so a
    // resolver that built the escaped path and read it would reach validation;
    // the grammar pre-check must short-circuit first.
    const escaped = path.join(root, "..", "registry-escape.freeze.json");
    rmSync(escaped, { force: true });
    writeFileSync(
      escaped,
      `${JSON.stringify(
        {
          schemaVersion: EQUIPMENT_RUNTIME_FREEZE_SCHEMA_VERSION,
          subjectId: "../registry-escape",
          displayName: "escape fixture",
          seed: 1,
          remesh: false,
          decimationTarget: 1,
          bakeOutputDir: "/unused",
          glbExportName: "registry-escape.glb",
          glbSha256: "0".repeat(64),
          runtimeAssetUrl: "/xr-assets/medical-equipment/../registry-escape.glb",
          generatedAt: "2026-09-04T00:00:00.000Z",
          claimScope: [],
          notEvidenceFor: [],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    try {
      const result = resolveDeclaredEquipmentRuntimeAsset("../registry-escape", { freezeRoot: root, publicRoot: pubRoot });
      expect(result.status).toBe("miss");
      if (result.status !== "miss") return;
      expect(result.reason).toBe("subject_id_not_catalog_safe");
      expect(result.freezeRecordPath).toBe("");
    } finally {
      rmSync(escaped, { force: true });
    }
  });

  it("(10) a freeze whose runtimeAssetUrl smuggles .. or percent-encoded segments is malformed even when matching bytes sit at the mapped target", () => {
    const root = tempFreezeRoot();
    const pubRoot = tempPublicRoot();
    const freezeBody = "bytes matching the freeze sha wherever they are planted";
    const freezeSha = sha256Bytes(freezeBody);
    const prefixSmugglingUrls = [
      // Resolves (under the old prefix-only logic) to a file OUTSIDE the public root.
      "/xr-assets/medical-equipment/../../../registry-traversal-target.glb",
      // Percent-encoded dot segments: byte-exact URL equality must refuse them.
      "/xr-assets/medical-equipment/%2e%2e/registry-encoded-target.glb",
    ];
    for (const url of prefixSmugglingUrls) {
      const mapped = path.join(pubRoot, url.replace(/^\/+/, ""));
      try {
        writeFreezeFixture("wall-clock", root, { runtimeAssetUrl: url, glbSha256: freezeSha });
        mkdirSync(path.dirname(mapped), { recursive: true });
        writeFileSync(mapped, freezeBody, "utf8");
        const result = resolveDeclaredEquipmentRuntimeAsset("wall-clock", { freezeRoot: root, publicRoot: pubRoot });
        expect(result.status).toBe("miss");
        if (result.status !== "miss") return;
        expect(result.reason).toBe("malformed_freeze_record");
      } finally {
        rmSync(mapped, { force: true });
      }
    }
  });

  it("(11) a valid freeze whose runtimeAssetUrl names ANOTHER subject is malformed even when that subject's bytes are published and sha-match", () => {
    const root = tempFreezeRoot();
    const pubRoot = tempPublicRoot();
    // wall-clock's freeze records bedside-monitor's URL; glbSha256 is the sha of
    // the wall-clock fixture body, so the bedside-monitor file planted below
    // matches the freeze exactly.
    writeFreezeFixture("wall-clock", root, {
      runtimeAssetUrl: "/xr-assets/medical-equipment/bedside-monitor.glb",
    });
    writePublishedFixture("bedside-monitor", pubRoot, "fixture glb bytes for wall-clock");
    const result = resolveDeclaredEquipmentRuntimeAsset("wall-clock", { freezeRoot: root, publicRoot: pubRoot });
    expect(result.status).toBe("miss");
    if (result.status !== "miss") return;
    expect(result.reason).toBe("malformed_freeze_record");
  });

  it("(12) freeze/public path and URL builders assert the catalog grammar and root containment", () => {
    const root = tempFreezeRoot();
    const pubRoot = tempPublicRoot();
    expect(isCatalogSafeEquipmentSubjectId("wall-clock")).toBe(true);
    expect(isCatalogSafeEquipmentSubjectId("../wall-clock")).toBe(false);
    expect(isCatalogSafeEquipmentSubjectId("..%2fwall-clock")).toBe(false);
    expect(() => equipmentFreezeRecordPath("../wall-clock", root)).toThrow(/not catalog-safe/);
    expect(() => runtimeAssetUrlForSubject("..%2fwall-clock")).toThrow(/not catalog-safe/);
    expect(() =>
      equipmentRuntimeUrlToPublishedFile("/xr-assets/medical-equipment/../../../registry-escape.glb", pubRoot),
    ).toThrow(/escapes public root/);
    // Valid URL mapping is unchanged.
    expect(equipmentRuntimeUrlToPublishedFile("/xr-assets/medical-equipment/wall-clock.glb", pubRoot)).toBe(
      path.join(pubRoot, "xr-assets/medical-equipment/wall-clock.glb"),
    );
  });
});

// NOT TESTED: live TRELLIS GPU bake; UI-XR mesh attach (follow-on); Quest readiness.
