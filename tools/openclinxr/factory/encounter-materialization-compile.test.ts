import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTENT_HASH_STUB_LITERAL,
  WCG_BAKER_VERSION,
  type CompilePlanNode,
  compileCacheKey,
  compileEncounterMaterialization,
} from "./encounter-materialization-compile.js";
import {
  type CompileGraphNode,
  type EncounterMaterializationEvidenceReport,
  validateEncounterMaterializationEvidenceReport,
} from "./encounter-materialization-evidence.js";
import { persistFacultyCompileLocks, readFacultyCompileLocksFile } from "./encounter-materialization-faculty-locks.js";
import type { GeneratedEdStationRuntimeBundleReport } from "./generated-ed-station-runtime-bundle.js";

const MAY_BODY = "actor:patient_maya_johnson_v1:body";
const MAY_WARDROBE = "actor:patient_maya_johnson_v1:wardrobe";
const EQUIP_NEB = "equip:nebulizer_mask_equipment";
const ROOM_PEDS = "room:pediatric_urgent_care_bay_v1";
const IMAGINE = "ecg-cart-imagine-box";
const BODY_A = "sha256:body-A";
const BODY_B = "sha256:body-B";
const WARDROBE_BAKED = "sha256:wardrobe-baked";
const EQUIP_BAKED = "sha256:equip-baked";
const ROOM_BAKED = "sha256:room-baked";

const DATED_EVIDENCE_PATH = "docs/openclinxr/encounter-materialization-evidence-peds-asthma-parent-anxiety-2026-05-28.json";

describe("compileEncounterMaterialization", () => {
  it("two compiles of the same caseDef increment compileVersion 1 then 2", async () => {
    const first = await compileEncounterMaterialization({ bundleReport: twoActorBundleFixture() });
    expect(first.compileVersion).toBe(1);
    expect(first.report.compileVersion).toBe(1);
    expect(first.report.schemaVersion).toBe("openclinxr.encounter-materialization-evidence.v1");
    expect(first.report.scenarioId).toBe("peds_asthma_parent_anxiety_v1");

    const second = await compileEncounterMaterialization({ prior: first.report });
    expect(second.compileVersion).toBe(2);
    expect(second.report.compileVersion).toBe(2);
    expect(second.report.scenarioId).toBe(first.report.scenarioId);
    // Same caseDef compile keeps per-node identity and never fabricates hashes.
    expect(second.report.compileNodes).toHaveLength(first.report.compileNodes?.length ?? -1);
    expect(second.report.compileNodes?.every((n) => n.contentHash !== CONTENT_HASH_STUB_LITERAL)).toBe(true);
    expect(validateEncounterMaterializationEvidenceReport(second.report)).toEqual({ ok: true, errors: [] });
  });

  it("locked wardrobe + unchanged body hash -> wardrobe baker skipped; blender not invoked", async () => {
    const first = await compileEncounterMaterialization({
      bundleReport: twoActorBundleFixture(),
    });
    // Fresh compile bakes every split wardrobe (first_bake).
    const firstWardrobe = nodeOf(first.report, MAY_WARDROBE);
    expect(firstWardrobe?.wouldInvoke).toBe("blender");
    expect(first.skippedBakers).toEqual([]);

    // Faculty locks the wardrobe; the body output hash is unchanged.
    const lockedPrior = withNodeState(first.report, {
      [MAY_BODY]: { contentHash: BODY_A },
      [MAY_WARDROBE]: { contentHash: WARDROBE_BAKED, lock: { locked: true, lockKind: "faculty_keep_artifact" } },
    });
    const second = await compileEncounterMaterialization({
      prior: lockedPrior,
      bodyHashNowByNodeId: { [MAY_BODY]: BODY_A },
    });

    expect(second.skippedBakers).toContain(MAY_WARDROBE);
    const wardrobe = nodeOf(second.report, MAY_WARDROBE);
    expect(wardrobe?.wouldInvoke).toBeNull();
    expect(wardrobe?.bakeDecision).toMatchObject({ bake: false, reason: "locked_skip", stale: false });
    expect(JSON.stringify(second.report)).not.toContain("blender ran");
  });

  it("unlocked wardrobe + changed body hash -> blender invoked", async () => {
    const first = await compileEncounterMaterialization({ bundleReport: twoActorBundleFixture() });
    const lockedPrior = withNodeState(first.report, {
      [MAY_BODY]: { contentHash: BODY_A },
      [MAY_WARDROBE]: { contentHash: WARDROBE_BAKED, lock: { locked: true, lockKind: "faculty_keep_artifact" } },
    });
    const locked = await compileEncounterMaterialization({
      prior: lockedPrior,
      bodyHashNowByNodeId: { [MAY_BODY]: BODY_A },
    });
    expect(locked.skippedBakers).toContain(MAY_WARDROBE);

    // Faculty unlocks; the body output hash now differs from the bake the wardrobe was made against.
    const unlockedPrior = withNodeState(locked.report, {
      [MAY_WARDROBE]: { lock: { locked: false } },
    });
    const third = await compileEncounterMaterialization({
      prior: unlockedPrior,
      bodyHashNowByNodeId: { [MAY_BODY]: BODY_B },
    });

    expect(third.skippedBakers).not.toContain(MAY_WARDROBE);
    const wardrobe = nodeOf(third.report, MAY_WARDROBE);
    expect(wardrobe?.wouldInvoke).toBe("blender");
    expect(wardrobe?.bakeDecision).toMatchObject({ bake: true, reason: "body_changed", stale: false });
  });

  /**
   * OBSERVABLE (immutable diagnosis): unlocked wardrobe with a baked
   * contentHash, unchanged body hash, and a faculty `/garmentLayers` override
   * currently records `cache_hit` / `wouldInvoke: null`. `compileCacheKey`
   * already hashes spec-after-override; `wouldInvoke` is set from
   * `planWardrobeBake` which only compares faculty lock + body contentHash.
   * Measured on main 2e691d4b.
   *
   * ## FIXED: compile passes planned vs prior cacheKey into planWardrobeBake;
   * unlocked spec/override change with the same body hash is recipe_changed
   * (wouldInvoke blender). Lock skip and same-recipe cache_hit still win.
   */
  it("unlocked faculty garment override rebakes when body hash is unchanged", async () => {
    const first = await compileEncounterMaterialization({ bundleReport: twoActorBundleFixture() });
    expect(nodeOf(first.report, MAY_WARDROBE)?.wouldInvoke).toBe("blender");
    expect(nodeOf(first.report, MAY_WARDROBE)?.bakeDecision).toMatchObject({ bake: true, reason: "first_bake" });

    // Faculty override lands on overridePatch while the wardrobe stays unlocked
    // and baked. Persist/facultyLocks re-emit unsplit nodes (wipe split
    // contentHash + cacheKey → first_bake); copy the patch onto the prior
    // split node so the skip table is what is under test.
    const bakedUnlocked = withNodeState(first.report, {
      [MAY_BODY]: { contentHash: BODY_A },
      [MAY_WARDROBE]: {
        contentHash: WARDROBE_BAKED,
        overridePatch: {
          op: "replace",
          path: "/garmentLayers",
          value: ["makeclothes_library_scrub_shirt"],
        },
      },
    });
    const second = await compileEncounterMaterialization({
      prior: bakedUnlocked,
      bodyHashNowByNodeId: { [MAY_BODY]: BODY_A },
    });

    const wardrobe = nodeOf(second.report, MAY_WARDROBE);
    expect(wardrobe?.lock.locked).toBe(false);
    expect(wardrobe?.overridePatch).toEqual({
      op: "replace",
      path: "/garmentLayers",
      value: ["makeclothes_library_scrub_shirt"],
    });
    expect(wardrobe?.wouldInvoke).toBe("blender");
    expect(wardrobe?.bakeDecision?.bake).toBe(true);
    expect(wardrobe?.bakeDecision?.reason).not.toBe("cache_hit");
    expect(wardrobe?.bakeDecision?.reason).toBe("recipe_changed");
  });

  it("unlocked wardrobe + baked + unchanged body hash + same recipe -> cache_hit", async () => {
    const first = await compileEncounterMaterialization({ bundleReport: twoActorBundleFixture() });
    const bakedUnlocked = withNodeState(first.report, {
      [MAY_BODY]: { contentHash: BODY_A },
      [MAY_WARDROBE]: { contentHash: WARDROBE_BAKED },
    });
    const second = await compileEncounterMaterialization({
      prior: bakedUnlocked,
      bodyHashNowByNodeId: { [MAY_BODY]: BODY_A },
    });
    const wardrobe = nodeOf(second.report, MAY_WARDROBE);
    expect(wardrobe?.wouldInvoke).toBeNull();
    expect(wardrobe?.bakeDecision).toMatchObject({ bake: false, reason: "cache_hit", stale: false });
  });

  it("dated 2026-05-28 evidence JSON still validates after compile attaches optional fields", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wcg-compile-"));
    try {
      const outPath = path.join(dir, "compiled.json");
      const result = await compileEncounterMaterialization({
        priorPath: DATED_EVIDENCE_PATH,
        outPath,
        bodyHashNowByNodeId: { [MAY_BODY]: BODY_A },
      });
      expect(result.compileVersion).toBe(1);
      expect(result.report.schemaVersion).toBe("openclinxr.encounter-materialization-evidence.v1");
      expect(result.report.compileVersion).toBe(1);
      expect(result.report.compileNodes?.length).toBeGreaterThan(0);
      expect(validateEncounterMaterializationEvidenceReport(result.report)).toEqual({ ok: true, errors: [] });

      const written = JSON.parse(await readFile(outPath, "utf8")) as unknown;
      expect((written as { schemaVersion: string }).schemaVersion).toBe("openclinxr.encounter-materialization-evidence.v1");
      expect((written as { compileVersion: number }).compileVersion).toBe(1);
      expect(validateEncounterMaterializationEvidenceReport(written)).toEqual({ ok: true, errors: [] });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writes the compiled JSON as a dated sibling when only priorPath is given", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wcg-sibling-"));
    try {
      const priorPath = path.join(dir, "encounter-materialization-evidence-peds-asthma-parent-anxiety-2026-05-28.json");
      await copyFile(DATED_EVIDENCE_PATH, priorPath);
      const result = await compileEncounterMaterialization({ priorPath });
      const expectedName = `encounter-materialization-evidence-peds_asthma_parent_anxiety_v1-${new Date().toISOString().slice(0, 10)}.json`;
      const sibling = path.join(dir, expectedName);
      expect(path.dirname(sibling)).toBe(path.dirname(priorPath));
      expect(result.compileVersion).toBe(1);
      expect(validateEncounterMaterializationEvidenceReport(JSON.parse(await readFile(sibling, "utf8")))).toEqual({ ok: true, errors: [] });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("never emits the queue stub contentHash literal as a bake identity", async () => {
    const first = await compileEncounterMaterialization({ bundleReport: twoActorBundleFixture() });
    const stubbedPrior = withNodeState(first.report, {
      [MAY_BODY]: { contentHash: CONTENT_HASH_STUB_LITERAL },
      [MAY_WARDROBE]: { contentHash: CONTENT_HASH_STUB_LITERAL },
    });
    const result = await compileEncounterMaterialization({ prior: stubbedPrior });
    expect(result.report.compileNodes?.some((n) => n.contentHash === CONTENT_HASH_STUB_LITERAL)).toBe(false);
    expect(JSON.stringify(result.report)).not.toContain(CONTENT_HASH_STUB_LITERAL);
  });

  it("persist then compile twice: compileVersion 1 then 2; locked wardrobe keeps skipping on the same body hash", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wcg-persist-"));
    try {
      const priorPath = path.join(dir, "evidence.json");
      await copyFile(DATED_EVIDENCE_PATH, priorPath);

      // Baked wardrobe + body artifacts whose hashes the compile reads from disk.
      const bodyPath = path.join(dir, "body.glb");
      const wardrobePath = path.join(dir, "wardrobe.glb");
      await writeFile(bodyPath, "body bytes for hash\n");
      await writeFile(wardrobePath, "wardrobe baked bytes\n");
      const bodyHash = createHash("sha256").update(await readFile(bodyPath)).digest("hex");

      const persisted = await persistFacultyCompileLocks({
        priorPath,
        locks: [{ nodeId: MAY_WARDROBE, locked: true, overridePath: "/garmentLayers" }],
      });
      // A lock write is not a compile: the dated JSON has no compileVersion yet.
      expect(persisted.compileVersion).toBeUndefined();
      expect(validateEncounterMaterializationEvidenceReport(persisted)).toEqual({ ok: true, errors: [] });
      expect(nodeOf(persisted, MAY_WARDROBE)?.lock).toMatchObject({ locked: true, lockKind: "faculty_compile_lock" });
      expect(nodeOf(persisted, MAY_WARDROBE)?.overridePatch).toEqual({ op: "replace", path: "/garmentLayers" });

      const first = await compileEncounterMaterialization({
        priorPath,
        bodyHashNowByNodeId: { [MAY_BODY]: bodyHash },
        artifactPathsByNodeId: { [MAY_BODY]: bodyPath, [MAY_WARDROBE]: wardrobePath },
      });
      expect(first.compileVersion).toBe(1);
      expect(first.skippedBakers).toContain(MAY_WARDROBE);
      expect(nodeOf(first.report, MAY_WARDROBE)?.bakeDecision).toMatchObject({ bake: false });

      const second = await compileEncounterMaterialization({
        prior: first.report,
        bodyHashNowByNodeId: { [MAY_BODY]: bodyHash },
        artifactPathsByNodeId: { [MAY_BODY]: bodyPath, [MAY_WARDROBE]: wardrobePath },
      });
      expect(second.compileVersion).toBe(2);
      expect(second.skippedBakers).toContain(MAY_WARDROBE);
      expect(nodeOf(second.report, MAY_WARDROBE)?.bakeDecision).toMatchObject({ bake: false, reason: "locked_skip", stale: false });
      // The faculty lock survives across compiles via the copy-prior rule.
      expect(nodeOf(second.report, MAY_WARDROBE)?.lock).toMatchObject({ locked: true });
      expect(nodeOf(second.report, MAY_WARDROBE)?.overridePatch).toEqual({ op: "replace", path: "/garmentLayers" });
      expect(validateEncounterMaterializationEvidenceReport(second.report)).toEqual({ ok: true, errors: [] });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("persist refuses an overridePath outside the ActorPhenotypeSchema pointers", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wcg-badpath-"));
    try {
      const priorPath = path.join(dir, "evidence.json");
      await copyFile(DATED_EVIDENCE_PATH, priorPath);
      await expect(
        persistFacultyCompileLocks({
          priorPath,
          locks: [{ nodeId: MAY_WARDROBE, locked: true, overridePath: "/hairColor" }],
        }),
      ).rejects.toThrow("invalid overridePath /hairColor");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("dated 2026-05-28 evidence JSON still validates after a persist writes locks", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wcg-persist-validate-"));
    try {
      const priorPath = path.join(dir, "evidence.json");
      await copyFile(DATED_EVIDENCE_PATH, priorPath);
      await persistFacultyCompileLocks({
        priorPath,
        locks: [
          { nodeId: MAY_WARDROBE, locked: true, overridePath: "/garmentLayers" },
          { nodeId: "equip:nebulizer_mask_equipment", locked: true },
        ],
      });
      const written = JSON.parse(await readFile(priorPath, "utf8")) as EncounterMaterializationEvidenceReport;
      expect(written.schemaVersion).toBe("openclinxr.encounter-materialization-evidence.v1");
      expect(validateEncounterMaterializationEvidenceReport(written)).toEqual({ ok: true, errors: [] });
      const nodes = written.compileNodes ?? [];
      expect(nodes.some((n) => n.nodeId === MAY_WARDROBE && n.lock.locked)).toBe(true);
      expect(nodes.some((n) => n.nodeId === "equip:nebulizer_mask_equipment" && n.lock.locked)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reads the admin-persisted compile-locks file when present (WCG persist hole round-trip)", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wcg-locks-file-"));
    try {
      // Baked wardrobe + body artifacts whose hashes the compile reads from disk.
      const bodyPath = path.join(dir, "body.glb");
      const wardrobePath = path.join(dir, "wardrobe.glb");
      await writeFile(bodyPath, "body bytes for hash\n");
      await writeFile(wardrobePath, "wardrobe baked bytes\n");
      const bodyHash = createHash("sha256").update(await readFile(bodyPath)).digest("hex");

      // The admin faculty lock API wrote the per-scenario compile-locks file.
      const compileLocksPath = path.join(dir, "compile-locks.json");
      await writeFile(
        compileLocksPath,
        `${JSON.stringify(
          {
            scenarioId: "peds_asthma_parent_anxiety_v1",
            updatedAt: new Date().toISOString(),
            claimBoundary: "faculty_compile_lock_review_metadata_only",
            notEvidenceFor: ["review_packet_promotion", "production_asset_readiness", "quest_readiness"],
            locks: [{ nodeId: "actor:patient_maya_johnson_v1:wardrobe", locked: true, overridePath: "/garmentLayers" }],
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const result = await compileEncounterMaterialization({
        bundleReport: twoActorBundleFixture(),
        compileLocksPath,
        bodyHashNowByNodeId: { [MAY_BODY]: bodyHash },
        artifactPathsByNodeId: { [MAY_BODY]: bodyPath, [MAY_WARDROBE]: wardrobePath },
      });

      expect(result.skippedBakers).toContain(MAY_WARDROBE);
      const wardrobe = nodeOf(result.report, MAY_WARDROBE);
      expect(wardrobe?.wouldInvoke).toBeNull();
      expect(wardrobe?.bakeDecision).toMatchObject({ bake: false });
      expect(wardrobe?.lock).toMatchObject({ locked: true, lockKind: "faculty_compile_lock" });
      expect(wardrobe?.overridePatch).toEqual({ op: "replace", path: "/garmentLayers" });
      expect(validateEncounterMaterializationEvidenceReport(result.report)).toEqual({ ok: true, errors: [] });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses a compile-locks file carrying an overridePath outside the ActorPhenotypeSchema pointers", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wcg-locks-badpath-"));
    try {
      const compileLocksPath = path.join(dir, "compile-locks.json");
      await writeFile(
        compileLocksPath,
        `${JSON.stringify({
          scenarioId: "peds_asthma_parent_anxiety_v1",
          claimBoundary: "faculty_compile_lock_review_metadata_only",
          locks: [{ nodeId: "actor:patient_maya_johnson_v1", locked: true, overridePath: "/hairColor" }],
        })}\n`,
        "utf8",
      );
      await expect(
        compileEncounterMaterialization({
          bundleReport: twoActorBundleFixture(),
          compileLocksPath,
        }),
      ).rejects.toThrow("invalid overridePath /hairColor");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skipped wardrobe baker writes the wcg-wardrobe-lock sidecar next to its GLB", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wcg-sidecar-"));
    try {
      const wardrobePath = path.join(dir, "peds_patient_child.glb");
      await writeFile(wardrobePath, "wardrobe baked bytes\n");
      const first = await compileEncounterMaterialization({ bundleReport: twoActorBundleFixture() });
      const base = withNodeState(first.report, {
        [MAY_BODY]: { contentHash: BODY_A },
        [MAY_WARDROBE]: { contentHash: WARDROBE_BAKED, lock: { locked: true, lockKind: "faculty_keep_artifact" } },
      });
      const result = await compileEncounterMaterialization({
        prior: base,
        bodyHashNowByNodeId: { [MAY_BODY]: BODY_A },
        artifactPathsByNodeId: { [MAY_WARDROBE]: wardrobePath },
      });
      expect(result.skippedBakers).toContain(MAY_WARDROBE);
      const sidecarPath = path.join(dir, "peds_patient_child.wcg-wardrobe-lock.json");
      const payload = JSON.parse(await readFile(sidecarPath, "utf8")) as { skipBlender: boolean; bodyHashNow?: string };
      expect(payload.skipBlender).toBe(true);
      expect(payload.bodyHashNow).toBe(BODY_A);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  /**
   * OBSERVABLE (immutable diagnosis): compile stamps cacheKey only on split
   * body/wardrobe. EquipVariant / Room get wouldInvoke from
   * planEquipmentWouldInvoke (lock or valid TRELLIS payload) with no cacheKey
   * on the planned node (falls through as prior null). Room nodes never get
   * wouldInvoke: "blender" even on first bake. Measured on main f79663b5
   * (`stamps deterministic cacheKeys for body + wardrobe bakers; equipment
   * nodes stay null`).
   *
   * ## FIXED: EquipVariant and Room stamp recipeKeyFor cacheKey; wouldInvoke
   * is trellis/blender on first bake / recipe change, null on cache hit and lock.
   */
  it("stamps deterministic cacheKeys for body + wardrobe bakers; equipment and room stamp too", async () => {
    const first = await compileEncounterMaterialization({ bundleReport: twoActorBundleFixture() });
    const second = await compileEncounterMaterialization({ prior: first.report });

    const bodyFirst = nodeOf(first.report, MAY_BODY);
    const bodySecond = nodeOf(second.report, MAY_BODY);
    const wardrobeFirst = nodeOf(first.report, MAY_WARDROBE);
    const wardrobeSecond = nodeOf(second.report, MAY_WARDROBE);
    const equip = nodeOf(first.report, EQUIP_NEB);

    expect(bodyFirst?.cacheKey).toBeTypeOf("string");
    expect(wardrobeFirst?.cacheKey).toBeTypeOf("string");
    // Recipe keys are pure functions of baker inputs: two compiles of the same
    // spec + parent output hashes stamp identical keys.
    expect(bodySecond?.cacheKey).toBe(bodyFirst?.cacheKey);
    expect(wardrobeSecond?.cacheKey).toBe(wardrobeFirst?.cacheKey);
    // bakerId + parentOutputHashes keep body and wardrobe recipes distinct.
    expect(wardrobeFirst?.cacheKey).not.toBe(bodyFirst?.cacheKey);
    // Skip-capable bakers (body, wardrobe, equipment, room) stamp a recipe key.
    expect(equip?.cacheKey).toBeTypeOf("string");
    expect(nodeOf(first.report, ROOM_PEDS)?.cacheKey).toBeTypeOf("string");
    expect(validateEncounterMaterializationEvidenceReport(second.report)).toEqual({ ok: true, errors: [] });
  });

  /**
   * OBSERVABLE (immutable diagnosis): EquipVariant planned nodes leave
   * cacheKey null; wouldInvoke is trellis whenever the payload is valid, even
   * when a prior compile already stamped a matching recipe and a non-null
   * contentHash (artifact exists). Measured on main f79663b5.
   */
  it("equipment stamps cacheKey and skips TRELLIS on recipe match", async () => {
    const payload = (seed: number) => ({
      equipment_generate: {
        subjectId: IMAGINE,
        packId: IMAGINE,
        seed,
        remesh: false,
        viewCount: 4,
        decimationTarget: 1_000_000,
      },
    });
    const first = await compileEncounterMaterialization({
      bundleReport: twoActorBundleFixture(),
      stationPayloads: payload(7),
    });
    const equip = nodeOf(first.report, EQUIP_NEB);
    expect(equip?.cacheKey).toBeTypeOf("string");
    expect(equip?.wouldInvoke).toBe("trellis");
    expect(first.skippedBakers).not.toContain(EQUIP_NEB);

    const bakedPrior = withNodeState(first.report, {
      [EQUIP_NEB]: { contentHash: EQUIP_BAKED },
    });
    const second = await compileEncounterMaterialization({
      prior: bakedPrior,
      stationPayloads: payload(7),
    });
    const cached = nodeOf(second.report, EQUIP_NEB);
    expect(cached?.cacheKey).toBe(equip?.cacheKey);
    expect(cached?.wouldInvoke).toBeNull();
    expect(second.skippedBakers).toContain(EQUIP_NEB);

    const third = await compileEncounterMaterialization({
      prior: bakedPrior,
      stationPayloads: payload(8),
    });
    const changed = nodeOf(third.report, EQUIP_NEB);
    expect(changed?.cacheKey).not.toBe(equip?.cacheKey);
    expect(changed?.wouldInvoke).toBe("trellis");
    expect(third.skippedBakers).not.toContain(EQUIP_NEB);

    const lockedPrior = withNodeState(first.report, {
      [EQUIP_NEB]: {
        contentHash: EQUIP_BAKED,
        lock: { locked: true, lockKind: "faculty_keep_artifact" },
      },
    });
    const locked = await compileEncounterMaterialization({
      prior: lockedPrior,
      stationPayloads: payload(8),
    });
    expect(nodeOf(locked.report, EQUIP_NEB)?.wouldInvoke).toBeNull();
    expect(locked.skippedBakers).toContain(EQUIP_NEB);
  });

  /**
   * OBSERVABLE (immutable diagnosis): invalid equipment payload still must
   * not invent trellis; cacheKey was never stamped so skip cannot key off it.
   * Measured on main f79663b5.
   */
  it("invalid equipment payload does not invent trellis; still stamps cacheKey", async () => {
    const first = await compileEncounterMaterialization({ bundleReport: twoActorBundleFixture() });
    const equip = nodeOf(first.report, EQUIP_NEB);
    expect(equip?.family).toBe("EquipVariant");
    expect(equip?.cacheKey).toBeTypeOf("string");
    expect(equip?.wouldInvoke).toBeNull();
    expect(first.skippedBakers).not.toContain(EQUIP_NEB);
  });

  /**
   * OBSERVABLE (immutable diagnosis): Room nodes (`emitCompileNodes`, family
   * "Room", bakerId `room_environment`) never get wouldInvoke: "blender" even
   * on first bake, and cacheKey stays null. Measured on main f79663b5.
   */
  it("room stamps cacheKey and skips blender on recipe match", async () => {
    const first = await compileEncounterMaterialization({
      bundleReport: twoActorBundleFixture(),
      infinigenPrompt: "exam bay, pediatric",
    });
    const room = nodeOf(first.report, ROOM_PEDS);
    expect(room?.family).toBe("Room");
    expect(room?.bakerId).toBe("room_environment");
    expect(room?.cacheKey).toBeTypeOf("string");
    expect(room?.wouldInvoke).toBe("blender");
    expect(first.skippedBakers).not.toContain(ROOM_PEDS);
    const dialogue = first.report.compileNodes?.find((n) => n.family === "DialoguePolicy") as CompilePlanNode | undefined;
    expect(dialogue?.wouldInvoke ?? null).toBeNull();

    const bakedPrior = withNodeState(first.report, {
      [ROOM_PEDS]: { contentHash: ROOM_BAKED },
    });
    const second = await compileEncounterMaterialization({
      prior: bakedPrior,
      infinigenPrompt: "exam bay, pediatric",
    });
    const cached = nodeOf(second.report, ROOM_PEDS);
    expect(cached?.cacheKey).toBe(room?.cacheKey);
    expect(cached?.wouldInvoke).toBeNull();
    expect(second.skippedBakers).toContain(ROOM_PEDS);

    const third = await compileEncounterMaterialization({
      prior: bakedPrior,
      infinigenPrompt: "exam bay, pediatric, window on left",
    });
    const changed = nodeOf(third.report, ROOM_PEDS);
    expect(changed?.cacheKey).not.toBe(room?.cacheKey);
    expect(changed?.wouldInvoke).toBe("blender");
    expect(third.skippedBakers).not.toContain(ROOM_PEDS);

    const lockedPrior = withNodeState(first.report, {
      [ROOM_PEDS]: {
        contentHash: ROOM_BAKED,
        lock: { locked: true, lockKind: "faculty_keep_artifact" },
      },
    });
    const locked = await compileEncounterMaterialization({
      prior: lockedPrior,
      infinigenPrompt: "exam bay, pediatric, window on left",
    });
    expect(nodeOf(locked.report, ROOM_PEDS)?.wouldInvoke).toBeNull();
    expect(locked.skippedBakers).toContain(ROOM_PEDS);
  });

  it("body contentHash change changes the wardrobe cacheKey via parentOutputHashes", async () => {
    const first = await compileEncounterMaterialization({ bundleReport: twoActorBundleFixture() });
    const baked = withNodeState(first.report, {
      [MAY_BODY]: { contentHash: BODY_A },
      [MAY_WARDROBE]: { contentHash: WARDROBE_BAKED, lock: { locked: true, lockKind: "faculty_keep_artifact" } },
    });
    const withBodyA = await compileEncounterMaterialization({
      prior: baked,
      bodyHashNowByNodeId: { [MAY_BODY]: BODY_A },
    });
    const keyWithBodyA = nodeOf(withBodyA.report, MAY_WARDROBE)?.cacheKey;
    expect(keyWithBodyA).toBeTypeOf("string");

    // The body artifact was rebaked between compiles: the body's OUTPUT hash
    // changed while the wardrobe spec did not.
    const bodyRebaked = withNodeState(withBodyA.report, { [MAY_BODY]: { contentHash: BODY_B } });
    const withBodyB = await compileEncounterMaterialization({
      prior: bodyRebaked,
      bodyHashNowByNodeId: { [MAY_BODY]: BODY_B },
    });

    expect(nodeOf(withBodyB.report, MAY_WARDROBE)?.cacheKey).not.toBe(keyWithBodyA);
    expect(nodeOf(withBodyB.report, MAY_WARDROBE)?.spec).toEqual(nodeOf(withBodyA.report, MAY_WARDROBE)?.spec);
  });

  it("faculty overrideValue copies onto overridePatch.value and changes the wardrobe recipe key", async () => {
    const first = await compileEncounterMaterialization({ bundleReport: twoActorBundleFixture() });
    const persistedA = await persistFacultyCompileLocks({
      prior: first.report,
      locks: [{ nodeId: MAY_WARDROBE, locked: true, overridePath: "/garmentLayers", overrideValue: ["makeclothes_library_scrub_shirt"] }],
    });
    expect(nodeOf(persistedA, MAY_WARDROBE)?.overridePatch).toEqual({
      op: "replace",
      path: "/garmentLayers",
      value: ["makeclothes_library_scrub_shirt"],
    });

    const compileA = await compileEncounterMaterialization({ prior: persistedA, bodyHashNowByNodeId: { [MAY_BODY]: BODY_A } });
    const keyA = nodeOf(compileA.report, MAY_WARDROBE)?.cacheKey;
    expect(keyA).toBeTypeOf("string");

    // Faculty changes the phenotype value: the spec slice the baker reads
    // (specAfterOverride) differs, so the recipe key must differ.
    const persistedB = await persistFacultyCompileLocks({
      prior: compileA.report,
      locks: [{ nodeId: MAY_WARDROBE, locked: true, overridePath: "/garmentLayers", overrideValue: ["makeclothes_library_scrub_pants"] }],
    });
    const compileB = await compileEncounterMaterialization({ prior: persistedB, bodyHashNowByNodeId: { [MAY_BODY]: BODY_A } });
    expect(nodeOf(compileB.report, MAY_WARDROBE)?.cacheKey).not.toBe(keyA);
    expect(validateEncounterMaterializationEvidenceReport(compileB.report)).toEqual({ ok: true, errors: [] });
  });

  it("locked wardrobe + recipe key change does not invoke blender", async () => {
    const first = await compileEncounterMaterialization({ bundleReport: twoActorBundleFixture() });
    const lockedOverride = withNodeState(first.report, {
      [MAY_BODY]: { contentHash: BODY_A },
      [MAY_WARDROBE]: {
        contentHash: WARDROBE_BAKED,
        lock: { locked: true, lockKind: "faculty_keep_artifact" },
        overridePatch: {
          op: "replace",
          path: "/garmentLayers",
          value: ["makeclothes_library_scrub_shirt"],
        },
      },
    });
    const result = await compileEncounterMaterialization({
      prior: lockedOverride,
      bodyHashNowByNodeId: { [MAY_BODY]: BODY_A },
    });
    const wardrobe = nodeOf(result.report, MAY_WARDROBE);
    expect(wardrobe?.wouldInvoke).toBeNull();
    expect(wardrobe?.bakeDecision?.bake).toBe(false);
    expect(wardrobe?.bakeDecision?.reason).toBe("locked_stale");
  });

  it("readFacultyCompileLocksFile parses overrideValue from the persisted lock JSON", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wcg-lock-read-"));
    try {
      const filePath = path.join(dir, "peds_asthma_parent_anxiety_v1.json");
      await writeFile(
        filePath,
        JSON.stringify({
          scenarioId: "peds_asthma_parent_anxiety_v1",
          locks: [
            { nodeId: MAY_WARDROBE, locked: true, overridePath: "/garmentLayers", overrideValue: "scrub_shirt" },
          ],
        }),
        "utf8",
      );
      const locks = await readFacultyCompileLocksFile(filePath, "peds_asthma_parent_anxiety_v1");
      expect(locks).toEqual([
        { nodeId: MAY_WARDROBE, locked: true, overridePath: "/garmentLayers", overrideValue: "scrub_shirt" },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("bake=false wardrobe still stamps its cacheKey while wouldInvoke stays null", async () => {
    const first = await compileEncounterMaterialization({ bundleReport: twoActorBundleFixture() });
    const baked = withNodeState(first.report, {
      [MAY_BODY]: { contentHash: BODY_A },
      [MAY_WARDROBE]: { contentHash: WARDROBE_BAKED, lock: { locked: true, lockKind: "faculty_keep_artifact" } },
    });
    const result = await compileEncounterMaterialization({
      prior: baked,
      bodyHashNowByNodeId: { [MAY_BODY]: BODY_A },
    });

    const wardrobe = nodeOf(result.report, MAY_WARDROBE);
    expect(wardrobe?.bakeDecision).toMatchObject({ bake: false, reason: "locked_skip", stale: false });
    expect(wardrobe?.wouldInvoke).toBeNull();
    expect(wardrobe?.cacheKey).toBeTypeOf("string");
    // The recipe key is stamped identically whether or not the compile invokes
    // the baker — it is a pure function of the baker's inputs.
    const again = await compileEncounterMaterialization({ prior: result.report, bodyHashNowByNodeId: { [MAY_BODY]: BODY_A } });
    expect(nodeOf(again.report, MAY_WARDROBE)?.cacheKey).toBe(wardrobe?.cacheKey);
  });

  it("compileCacheKey is canonical on spec key order and order-sensitive on parent hashes", () => {
    const base = {
      bakerId: "wardrobe_character",
      bakerVersion: WCG_BAKER_VERSION,
      spec: { scenarioId: "s1", actorId: "a1", variantSemanticKey: "v", sourceBlobName: "b" },
      parentOutputHashes: ["h1", "h2"],
      seed: "s1",
    };
    const key1 = compileCacheKey(base);
    const key2 = compileCacheKey({
      ...base,
      spec: { sourceBlobName: "b", variantSemanticKey: "v", actorId: "a1", scenarioId: "s1" },
    });
    const key3 = compileCacheKey({ ...base, parentOutputHashes: ["h2", "h1"] });
    expect(key2).toBe(key1); // canonical: object key order is irrelevant
    expect(key3).not.toBe(key1); // parent hash ORDER is part of the recipe
  });

  it("W5: removedNodeIds tombstone the node instead of splicing it; node_tombstoned events recorded", async () => {
    const first = await compileEncounterMaterialization({ bundleReport: twoActorBundleFixture() });
    const baked = withNodeState(first.report, {
      [MAY_BODY]: { contentHash: BODY_A },
      [MAY_WARDROBE]: { contentHash: WARDROBE_BAKED },
    });
    const result = await compileEncounterMaterialization({
      prior: baked,
      bodyHashNowByNodeId: { [MAY_BODY]: BODY_A },
      removedNodeIds: ["actor:patient_maya_johnson_v1"],
    });

    // The actor's split children are tombstoned, NOT spliced out of the graph.
    const body = nodeOf(result.report, MAY_BODY);
    const wardrobe = nodeOf(result.report, MAY_WARDROBE);
    expect(body?.tombstone).toMatchObject({ removedBy: "faculty_remove", removedNodeId: "actor:patient_maya_johnson_v1" });
    expect(wardrobe?.tombstone).toMatchObject({ removedBy: "faculty_remove", removedNodeId: "actor:patient_maya_johnson_v1" });
    // A tombstoned wardrobe refuses to bake: no blender, tombstoned decision.
    expect(wardrobe?.wouldInvoke).toBeNull();
    expect(wardrobe?.bakeDecision).toMatchObject({ bake: false, reason: "tombstoned", stale: true });
    // Delete is a compile event, not an array splice.
    expect(result.report.compileEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "node_tombstoned", nodeId: MAY_BODY, removedBy: "faculty_remove" }),
        expect.objectContaining({ kind: "node_tombstoned", nodeId: MAY_WARDROBE, removedBy: "faculty_remove" }),
      ]),
    );
    expect(validateEncounterMaterializationEvidenceReport(result.report)).toEqual({ ok: true, errors: [] });
  });

  it("W5: a locked removed node REFUSES the delete — no tombstone, no event", async () => {
    const first = await compileEncounterMaterialization({ bundleReport: twoActorBundleFixture() });
    const baked = withNodeState(first.report, {
      [MAY_BODY]: { contentHash: BODY_A, lock: { locked: true, lockKind: "faculty_keep_artifact" } },
      [MAY_WARDROBE]: { contentHash: WARDROBE_BAKED, lock: { locked: true, lockKind: "faculty_keep_artifact" } },
    });
    const result = await compileEncounterMaterialization({
      prior: baked,
      bodyHashNowByNodeId: { [MAY_BODY]: BODY_A },
      removedNodeIds: ["actor:patient_maya_johnson_v1"],
    });

    // The lock won on every node of the actor: nothing was tombstoned, no
    // node_tombstoned event was emitted, and the locked wardrobe still skips.
    expect(nodeOf(result.report, MAY_BODY)?.tombstone).toBeUndefined();
    expect(nodeOf(result.report, MAY_WARDROBE)?.tombstone).toBeUndefined();
    expect(nodeOf(result.report, MAY_WARDROBE)?.bakeDecision).toMatchObject({ bake: false, reason: "locked_skip", stale: false });
    expect(result.report.compileEvents ?? []).toEqual([]);
  });

  it("W5: split-level body removal stales the wardrobe descendant (parent_tombstoned + descendant_staled)", async () => {
    const first = await compileEncounterMaterialization({ bundleReport: twoActorBundleFixture() });
    const baked = withNodeState(first.report, {
      [MAY_BODY]: { contentHash: BODY_A },
      [MAY_WARDROBE]: { contentHash: WARDROBE_BAKED },
    });
    const result = await compileEncounterMaterialization({
      prior: baked,
      bodyHashNowByNodeId: { [MAY_BODY]: BODY_A },
      removedNodeIds: [MAY_BODY],
    });

    const body = nodeOf(result.report, MAY_BODY);
    const wardrobe = nodeOf(result.report, MAY_WARDROBE);
    expect(body?.tombstone).toBeDefined();
    expect(wardrobe?.tombstone).toBeUndefined(); // the wardrobe itself is not removed
    expect(wardrobe?.bakeDecision).toMatchObject({ bake: false, reason: "parent_tombstoned", stale: true });
    expect(result.report.compileEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "node_tombstoned", nodeId: MAY_BODY }),
        expect.objectContaining({ kind: "descendant_staled", nodeId: MAY_WARDROBE, ancestorNodeId: MAY_BODY }),
      ]),
    );
    expect(validateEncounterMaterializationEvidenceReport(result.report)).toEqual({ ok: true, errors: [] });
  });

  it("W5: a tombstone survives the copy-prior rule — the next compile still sees the delete", async () => {
    const first = await compileEncounterMaterialization({ bundleReport: twoActorBundleFixture() });
    const baked = withNodeState(first.report, {
      [MAY_BODY]: { contentHash: BODY_A },
      [MAY_WARDROBE]: { contentHash: WARDROBE_BAKED },
    });
    const removed = await compileEncounterMaterialization({
      prior: baked,
      bodyHashNowByNodeId: { [MAY_BODY]: BODY_A },
      removedNodeIds: ["actor:patient_maya_johnson_v1"],
    });
    // A second compile with NO removal does not resurrect the deleted node:
    // the tombstone is copied forward by nodeId.
    const again = await compileEncounterMaterialization({
      prior: removed.report,
      bodyHashNowByNodeId: { [MAY_BODY]: BODY_A },
    });
    expect(nodeOf(again.report, MAY_WARDROBE)?.tombstone).toMatchObject({ removedBy: "faculty_remove" });
    expect(nodeOf(again.report, MAY_WARDROBE)?.bakeDecision).toMatchObject({ bake: false, reason: "tombstoned", stale: true });
    // The event ledger is cumulative across compiles.
    expect(again.report.compileEvents?.filter((e) => e.kind === "node_tombstoned")).toHaveLength(2);
    expect(validateEncounterMaterializationEvidenceReport(again.report)).toEqual({ ok: true, errors: [] });
  });
});

function nodeOf(report: EncounterMaterializationEvidenceReport, nodeId: string): CompilePlanNode | undefined {
  return report.compileNodes?.find((n) => n.nodeId === nodeId) as CompilePlanNode | undefined;
}

function withNodeState(report: EncounterMaterializationEvidenceReport, patchByNodeId: Record<string, Partial<CompileGraphNode>>): EncounterMaterializationEvidenceReport {
  return {
    ...report,
    compileNodes: (report.compileNodes ?? []).map((node) =>
      patchByNodeId[node.nodeId] ? { ...node, ...patchByNodeId[node.nodeId] } : node,
    ),
  };
}

function twoActorBundleFixture(): GeneratedEdStationRuntimeBundleReport {
  const base = bundleReportFixture();
  const patient = base.actorHumanoidMaterializationContract!.actorVariants[0]!;
  return {
    ...base,
    actorHumanoidMaterializationContract: {
      ...base.actorHumanoidMaterializationContract!,
      sharedNeutralMeshReuseActorIds: ["patient_maya_johnson_v1", "parent_tara_johnson_v1"],
      actorVariants: [
        patient,
        {
          ...patient,
          actorId: "parent_tara_johnson_v1",
          actorRole: "family",
          variantSemanticKey: "peds_asthma_parent_anxiety_v1:parent_tara_johnson_v1:family:anny_humanoid_variant",
        },
      ],
    },
  };
}

function bundleReportFixture(): GeneratedEdStationRuntimeBundleReport {
  return {
    schemaVersion: "openclinxr.generated-ed-station-runtime-bundle.v1",
    generatedAt: "2026-05-28T00:00:00.000Z",
    status: "bundle_ready",
    bundle: null,
    learnerBundle: null,
    actorHumanoidMaterializationContract: {
      schemaVersion: "openclinxr.actor-humanoid-materialization-contract.v1",
      scenarioId: "peds_asthma_parent_anxiety_v1",
      source: "generated_station_runtime_bundle",
      actorSpecificVariantKeysRequired: true,
      sharedNeutralMeshReuseDetected: true,
      sharedNeutralMeshReuseActorIds: ["patient_maya_johnson_v1"],
      actorVariants: [{
        actorId: "patient_maya_johnson_v1",
        actorRole: "patient",
        modelAssetId: "openclinxr.peds.patient.generated-humanoid",
        variantSemanticKey: "peds_asthma_parent_anxiety_v1:patient_maya_johnson_v1:patient:anny_humanoid_variant",
        sourceBlobName: ".openclinxr/asset-production/ed-chest-pain/generated-human-rigging/neutral-generated-human.glb",
        humanoidVariantProfile: {
          ageBand: "child",
          bodyScale: "small_child",
          hairFaceRequired: true,
          clothingLayer: "patient_gown",
          faceEyeLipRigRequired: true,
          idlePoseRequired: true,
          locomotionRequired: true,
        },
        requiredMaterializationCueIds: [
          "actor_specific_body_profile_required",
          "actor_specific_clothing_required",
          "actor_specific_hair_face_required",
          "actor_specific_rig_preservation_required",
        ],
      }],
      materializationBlockers: ["shared_neutral_humanoid_reuse_blocks_actor_specific_asset_readiness"],
      caveats: ["Shared neutral humanoid reuse is local runtime scaffolding only."],
      recommendedNextAction: "materialize actor-specific Anny humanoid GLBs before treating visual role distinction as asset-level progress",
      notEvidenceFor: [...notEvidenceFor, "animation_quality"],
    },
    equipmentMaterializationContract: {
      schemaVersion: "openclinxr.equipment-materialization-contract.v1",
      scenarioId: "peds_asthma_parent_anxiety_v1",
      source: "generated_station_runtime_bundle",
      equipmentSpecificVariantKeysRequired: true,
      genericEquipmentReuseDetected: true,
      genericEquipmentReuseEquipmentIds: ["nebulizer_mask_equipment"],
      equipmentVariants: [{
        equipmentId: "nebulizer_mask_equipment",
        modelAssetId: "openclinxr.peds.nebulizer.generated-equipment",
        variantSemanticKey: "peds_asthma_parent_anxiety_v1:nebulizer_mask_equipment:equipment_materialization_variant",
        sourceBlobName: ".openclinxr/asset-production/ed-chest-pain/medical-equipment/ecg-cart-12-lead.glb",
        equipmentVariantProfile: {
          equipmentFamily: "nebulizer_mask",
          pediatricUseRequired: true,
          scenarioPlacementRequired: true,
          scaleValidationRequired: true,
          interactionAffordanceRequired: true,
        },
        requiredMaterializationCueIds: [
          "equipment_specific_mesh_required",
          "equipment_specific_scale_required",
          "equipment_specific_placement_required",
          "equipment_specific_affordance_required",
        ],
        requiredEvidenceRefs: [
          "scenario_specific_equipment_variant_evidence",
          "equipment_scale_validation_evidence",
          "equipment_placement_anchor_evidence",
          "clinical_affordance_evidence",
        ],
      }],
      materializationBlockers: ["generic_equipment_reuse_blocks_equipment_specific_asset_readiness"],
      caveats: ["Generic equipment reuse is local runtime scaffolding only."],
      recommendedNextAction: "materialize equipment-specific generated GLBs or prefabs before treating pediatric equipment as Quest, clinical, scoring, or production-ready",
      notEvidenceFor,
    },
    bundleBlobName: null,
    runtimeAssetReviewDecisions: [],
    blockers: [],
    productionCloudCall: false,
    notEvidenceFor,
  };
}

const notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"] = [
  "production_asset_readiness",
  "quest_readiness",
  "clinical_validity",
  "scoring_validity",
];
