import { describe, expect, it } from "vitest";

// A planted RED reads a dynamically imported module whose shape is exactly what the slice
// must define. Narrowing it here would encode the answer the card is supposed to produce.
// biome-ignore lint/suspicious/noExplicitAny: see the two lines above
type Loose = any;

//
// OBSERVABLE: A suppressed placeholder GLB reports status "loaded" with fallbackActive true
// (generated-loaders.ts:447-462) and is incorrectly counted as loaded by loadedCount at
// scene-asset-evidence.ts:65, which filters only by status === "loaded".
//
// MEASURED 2026-09-09. xr-asset-loading/src/generated-loaders.ts:447-462, inside the GLTF
// success callback:
// ```
// if (ctx.shouldSuppressEquipmentModel(options.assetId, options.assetPath)) {
//   recordSceneAssetStatus({ ..., status: "loaded", fallbackActive: true, ... });
//   ctx.recordBootPhase("generated_equipment_placeholder_suppressed");
//   return;
// }
// ```
// The early `return` at `:461` skips `:463-465` (hide the primitive fallback) and `:466`
// (attach the real mesh). The genuine branch at `:472-482` reports `fallbackActive: false`;
// the failure branch at `:485-497` restores fallback visibility and reports `"failed"`.
//
// xr-capture-evidence/src/scene-asset-evidence.ts:65 computes
// `loadedCount: assets.filter((a) => a.status === "loaded").length` — status alone, so a
// suppressed slot counts as loaded. `:68` already computes
// `fallbackActiveCount: assets.filter((a) => a.fallbackActive).length` beside it.
//
// known-good: `fallbackActiveCount` at `:68` is the truthful field, present and unused by the
// aggregate. It must read the SAME for the same input after the fix; the fix adds a predicate
// and corrects `loadedCount`, it does not re-derive the field that was already right.
//
// CONTRACTED EXPORT (the honest slice adds exactly this):
//   // xr-capture-evidence/src/scene-asset-evidence.ts
//   /**
//    * A scene asset slot is READY only when it loaded genuinely: the GLB attached and the
//    * primitive fallback was hidden. A suppressed placeholder reports status "loaded" with
//    * fallbackActive true (generated-loaders.ts:447-462) and is NOT ready.
//    */
//   export function sceneAssetSlotIsReady(
//     asset: Pick<SceneAssetStatusRecord, "status" | "fallbackActive">,
//   ): boolean;
//
// and `loadedCount` at `:65` stops counting a record whose `fallbackActive` is true.
//
// IN-SCOPE: packages/openclinxr/xr-capture-evidence/src/scene-asset-evidence.ts
// packages/openclinxr/xr-asset-loading/src/generated-loaders.ts
// OUT-OF-SCOPE: Adding a scene-readiness phase, changing startup order, the placement chain.
//

// Import from the package entrypoint as required by the contract
const modPromise = import("./index.js");

describe("A suppressed placeholder GLB cannot report itself ready", () => {
  it.fails("(1) A genuine load (status: loaded, fallbackActive: false) satisfies the predicate", async () => {
    const mod = await modPromise;
    const sceneAssetSlotIsReady = (mod as Record<string, unknown>)["sceneAssetSlotIsReady"] as Loose;
    expect(typeof sceneAssetSlotIsReady).toBe("function");

    const genuineAsset = { status: "loaded" as const, fallbackActive: false };
    expect(sceneAssetSlotIsReady(genuineAsset)).toBe(true);
  });

  it.fails("(2) A suppressed slot (status: loaded, fallbackActive: true) does NOT satisfy the predicate", async () => {
    const mod = await modPromise;
    const sceneAssetSlotIsReady = (mod as Record<string, unknown>)["sceneAssetSlotIsReady"] as Loose;
    expect(typeof sceneAssetSlotIsReady).toBe("function");

    const suppressedAsset = { status: "loaded" as const, fallbackActive: true };
    expect(sceneAssetSlotIsReady(suppressedAsset)).toBe(false);
  });

  it.fails("(3) A failed slot (status: failed) does NOT satisfy the predicate", async () => {
    const mod = await modPromise;
    const sceneAssetSlotIsReady = (mod as Record<string, unknown>)["sceneAssetSlotIsReady"] as Loose;
    expect(typeof sceneAssetSlotIsReady).toBe("function");

    const failedAsset = { status: "failed" as const, fallbackActive: true };
    expect(sceneAssetSlotIsReady(failedAsset)).toBe(false);
  });

  it.fails("(4) For an input containing one suppressed slot, loadedCount no longer counts it, AND fallbackActiveCount for that same input is UNCHANGED from what it reports today", async () => {
    const mod = await modPromise;
    const recordSceneAssetStatus = (mod as Record<string, unknown>)["recordSceneAssetStatus"] as Loose;
    const formatSceneAssetEvidenceStatus = (mod as Record<string, unknown>)["formatSceneAssetEvidenceStatus"] as Loose;
    expect(typeof recordSceneAssetStatus).toBe("function");
    expect(typeof formatSceneAssetEvidenceStatus).toBe("function");

    // Clear any existing records by loading fresh module would need re-import
    // We test the aggregate behavior through the public API
    const genuineAsset = {
      assetId: "genuine-equipment",
      assetPath: "/assets/genuine.glb",
      sceneObjectName: "genuine_equipment",
      status: "loaded" as const,
      fallbackActive: false,
    };
    const suppressedAsset = {
      assetId: "suppressed-equipment",
      assetPath: "/assets/suppressed.glb",
      sceneObjectName: "suppressed_equipment",
      status: "loaded" as const,
      fallbackActive: true,
    };

    recordSceneAssetStatus(genuineAsset);
    recordSceneAssetStatus(suppressedAsset);

    const statusString = formatSceneAssetEvidenceStatus(
      (globalThis as unknown as { __openClinXrSceneAssetEvidence?: unknown }).__openClinXrSceneAssetEvidence
    );

    // loadedCount should be 1 (only genuine), not 2
    expect(statusString).toContain("1/2 generated loaded");
    // fallbackActiveCount should be 1 (the suppressed one)
    expect(statusString).toContain("1 fallbacks active");
  });

  it.fails("(5) The three existing status values (pending, loaded, failed) still round-trip", async () => {
    const mod = await modPromise;
    const recordSceneAssetStatus = (mod as Record<string, unknown>)["recordSceneAssetStatus"] as Loose;
    const formatSceneAssetEvidenceStatus = (mod as Record<string, unknown>)["formatSceneAssetEvidenceStatus"] as Loose;
    expect(typeof recordSceneAssetStatus).toBe("function");
    expect(typeof formatSceneAssetEvidenceStatus).toBe("function");

    const pendingAsset = {
      assetId: "pending-test",
      assetPath: "/assets/pending.glb",
      sceneObjectName: "pending_test",
      status: "pending" as const,
      fallbackActive: false,
    };
    const loadedAsset = {
      assetId: "loaded-test",
      assetPath: "/assets/loaded.glb",
      sceneObjectName: "loaded_test",
      status: "loaded" as const,
      fallbackActive: false,
    };
    const failedAsset = {
      assetId: "failed-test",
      assetPath: "/assets/failed.glb",
      sceneObjectName: "failed_test",
      status: "failed" as const,
      fallbackActive: true,
    };

    recordSceneAssetStatus(pendingAsset);
    recordSceneAssetStatus(loadedAsset);
    recordSceneAssetStatus(failedAsset);

    const statusString = formatSceneAssetEvidenceStatus(
      (globalThis as unknown as { __openClinXrSceneAssetEvidence?: unknown }).__openClinXrSceneAssetEvidence
    );

    // All three status values should be reflected in the output
    expect(statusString).toContain("3 generated loaded"); // expectedAssetCount
    expect(statusString).toContain("1/3 generated loaded"); // loadedCount (only loaded with fallbackActive:false)
    expect(statusString).toContain("1 failed");
    expect(statusString).toContain("1 fallbacks active");
  });
});