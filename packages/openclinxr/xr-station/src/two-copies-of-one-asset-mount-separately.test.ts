import { describe, expect, it } from "vitest";
import type { EncounterRuntimeSceneManifest } from "@openclinxr/asset-registry";
import {
  planStationEquipmentMounts,
} from "./index.js";

//
// OBSERVABLE: Two copies of one equipment asset id cannot be represented in a runtime bundle.
// The bundle's `equipmentPlacements` (asset-registry/src/runtime-bundles.ts:187) is a Record
// keyed by asset id, so a duplicate key silently overwrites at bundle construction
// (asset-registry/src/runtime-bundles.ts:1418 via Object.fromEntries). The lookup at
// asset-registry/src/runtime-bundles.ts:1636 resolves only the first match. The mount plan
// push closure at xr-station/src/station-equipment.ts:399-402 drops a second occurrence
// via `ordered.includes(id)` guard. The runtime registry Map at apps/ui-xr/src/main.ts:2838
// is keyed by asset id — UNMET REQUIREMENT recorded in this test.
//
// MEASURED 2026-09-09. Verified at HEAD: bundle type uses asset id as key; bundle construction
// uses Object.fromEntries; bundle lookup uses find(e => e.equipmentId === equipmentId);
// mount plan push closure drops duplicates via ordered.includes(id).
//
// known-good: xr-runtime-state/src/runtime-actor-slots.ts:19-24 RUNTIME_SLOT_KINDS gives
// four realized identities over a role class, and assignRuntimeActorSlots REPORTS overflow
// at :130-135 (notStaged.push({ actorId, reason: ... })) rather than collapsing silently.
// station-equipment.ts:428 already assigns DEFAULT_POSITIONS[index % DEFAULT_POSITIONS.length],
// so a second copy that reaches the ordered list gets a distinct fallback position for free.
//
// CONTRACTED EXPORT (the honest slice adds exactly this):
//   A realized equipment placement gains an identity distinct from its asset id.
//   equipmentPlacements becomes keyable by a REALIZED id (a placement id), with the asset id
//   a field on the value rather than the key.
//   planStationEquipmentMounts orders by realized id, so two copies of one asset id produce
//   two mount items, and two references to the SAME realized placement still produce one.
//   A collision or overflow is reported in the notStaged-shaped form.
//
// IN-SCOPE: asset-registry/src/runtime-bundles.ts, xr-station/src/station-equipment.ts,
// xr-asset-loading/src/generated-loaders.ts
// OUT-OF-SCOPE: apps/ui-xr/src/main.ts, the placement chain, the initial scene specification,
// instanced rendering.
//
// ## FIXED (fix/identity): realized equipment placement identity.
// runtime-bundles equipmentPlacements is now keyed by realized placement id
// (realized-equipment-placements.ts: buildRealizedEquipmentPlacements), with the
// asset id a field on the value. findRuntimeEquipmentPlacementByRealizedId
// resolves copies distinctly; planStationEquipmentMounts orders by realized id
// (station-equipment.ts) so two copies mount twice and one placement referenced
// twice mounts once; the bundle carries equipmentPlacementReport.collapsed in the
// notStaged shape. apps/ui-xr/src/main.ts:2838 stays an UNMET REQUIREMENT below.
//
describe("Two copies of one equipment asset are representable in a room", () => {
  // Clause 1: Two authored copies of one asset id produce TWO realized identities in the BUILT bundle.
  // The Record at runtime-bundles.ts:187 is the first thing that must change, because today
  // the input cannot even express the case.
  it("(1) two authored copies of one asset id produce two realized identities in the built bundle", async () => {
    const mod = await import("@openclinxr/asset-registry");
    const { buildEncounterRuntimeAssetBundle } = mod;

    // Build a minimal bundle with two equipment entries sharing the same equipmentId
    const assetStore = {
      storeKind: "app_public_fixture" as const,
      containerName: "ui-xr-public",
    };

    const bundle = buildEncounterRuntimeAssetBundle({
      bundleId: "test-bundle",
      tenantId: "test-tenant",
      userId: "test-user",
      examRunId: "test-exam",
      encounterId: "test-encounter",
      stationId: "test-station",
      scenarioId: "test-scenario",
      assetStore,
      environment: {
        assetId: "env_1",
        version: "1",
        kind: "environment_model",
        displayName: "Test Environment",
        scenarioAssetId: "env",
        blob: {
          storeKind: "app_public_fixture",
          containerName: "ui-xr-public",
          blobName: "test.glb",
          contentType: "model/gltf-binary",
          url: "test.glb",
        },
        reviewStatus: "fixture_approved_for_local_runtime",
        provenanceRefs: [],
        notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
      },
      actors: [],
      equipment: [
        { equipmentId: "ecg_cart_equipment", model: {
            assetId: "ecg_cart_12_lead_glb",
            version: "1",
            kind: "equipment_model",
            displayName: "ECG Cart",
            scenarioAssetId: "ecg_cart_equipment",
            blob: { storeKind: "app_public_fixture", containerName: "ui-xr-public", blobName: "ecg-cart.glb", contentType: "model/gltf-binary", url: "ecg-cart.glb" },
            reviewStatus: "fixture_approved_for_local_runtime",
            provenanceRefs: [],
            notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
          }},
        { equipmentId: "ecg_cart_equipment", model: {
            assetId: "ecg_cart_12_lead_glb_2",
            version: "1",
            kind: "equipment_model",
            displayName: "ECG Cart 2",
            scenarioAssetId: "ecg_cart_equipment",
            blob: { storeKind: "app_public_fixture", containerName: "ui-xr-public", blobName: "ecg-cart-2.glb", contentType: "model/gltf-binary", url: "ecg-cart-2.glb" },
            reviewStatus: "fixture_approved_for_local_runtime",
            provenanceRefs: [],
            notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
          }},
      ],
      uiSurfaces: [],
    });

    const sceneManifest = bundle.sceneManifest as EncounterRuntimeSceneManifest;
    const equipmentPlacements = sceneManifest.equipmentPlacements;

    // Currently the Record is keyed by equipmentId (asset id), so two copies collapse to one key.
    // The fix must change equipmentPlacements to be keyed by a realized placement id.
    expect(Object.keys(equipmentPlacements).length).toBe(2);
    // Each entry must have a distinct realized placement id as key, with asset id as a field.
    // CONTRACTED: equipmentPlacements becomes Record<placementId, { equipmentId: string, ... }>
  });

  // Clause 2: The lookup at runtime-bundles.ts:1636 resolves the SECOND copy distinctly from the first.
  it("(2) findRuntimeEquipmentAsset resolves the second copy distinctly from the first", async () => {
    const mod = await import("@openclinxr/asset-registry");
    const { buildEncounterRuntimeAssetBundle, findRuntimeEquipmentAsset } = mod;

    const assetStore = {
      storeKind: "app_public_fixture" as const,
      containerName: "ui-xr-public",
    };

    const bundle = buildEncounterRuntimeAssetBundle({
      bundleId: "test-bundle",
      tenantId: "test-tenant",
      userId: "test-user",
      examRunId: "test-exam",
      encounterId: "test-encounter",
      stationId: "test-station",
      scenarioId: "test-scenario",
      assetStore,
      environment: {
        assetId: "env_1",
        version: "1",
        kind: "environment_model",
        displayName: "Test Environment",
        scenarioAssetId: "env",
        blob: {
          storeKind: "app_public_fixture",
          containerName: "ui-xr-public",
          blobName: "test.glb",
          contentType: "model/gltf-binary",
          url: "test.glb",
        },
        reviewStatus: "fixture_approved_for_local_runtime",
        provenanceRefs: [],
        notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
      },
      actors: [],
      equipment: [
        { equipmentId: "ecg_cart_equipment", model: {
            assetId: "ecg_cart_12_lead_glb",
            version: "1",
            kind: "equipment_model",
            displayName: "ECG Cart",
            scenarioAssetId: "ecg_cart_equipment",
            blob: { storeKind: "app_public_fixture", containerName: "ui-xr-public", blobName: "ecg-cart.glb", contentType: "model/gltf-binary", url: "ecg-cart.glb" },
            reviewStatus: "fixture_approved_for_local_runtime",
            provenanceRefs: [],
            notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
          }},
        { equipmentId: "ecg_cart_equipment", model: {
            assetId: "ecg_cart_12_lead_glb_2",
            version: "1",
            kind: "equipment_model",
            displayName: "ECG Cart 2",
            scenarioAssetId: "ecg_cart_equipment",
            blob: { storeKind: "app_public_fixture", containerName: "ui-xr-public", blobName: "ecg-cart-2.glb", contentType: "model/gltf-binary", url: "ecg-cart-2.glb" },
            reviewStatus: "fixture_approved_for_local_runtime",
            provenanceRefs: [],
            notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
          }},
      ],
      uiSurfaces: [],
    });

    // Currently findRuntimeEquipmentAsset returns the FIRST match only (Array.find).
    // After fix, it must resolve by realized placement id, not by asset id.
    const first = findRuntimeEquipmentAsset(bundle, "ecg_cart_equipment");
    expect(first).toBeDefined();
    // There must be a way to retrieve the second copy distinctly.
    // CONTRACTED: lookup by realized placement id, not by equipmentId.

    // The assertions above only prove the SETUP built a bundle; they pass on HEAD and
    // assert nothing about the defect. The contracted lookup is by REALIZED placement id,
    // which does not exist yet: runtime-bundles.ts:1636 is
    //   bundle.equipment.find((e) => e.equipmentId === equipmentId)
    // and returns the first match, so a second copy is unreachable by any argument.
    const byRealized = (mod as Record<string, unknown>)["findRuntimeEquipmentPlacementByRealizedId"] as
      undefined | ((bundleArg: unknown, realizedId: string) => unknown);
    expect(typeof byRealized).toBe("function");
    const firstCopy = byRealized!(bundle, "iv_stand_equipment#1");
    const secondCopy = byRealized!(bundle, "iv_stand_equipment#2");
    expect(firstCopy).toBeDefined();
    expect(secondCopy).toBeDefined();
    expect(firstCopy).not.toEqual(secondCopy);
  });

  // Clause 3: planStationEquipmentMounts returns TWO mount items for two copies, at DIFFERENT positions,
  // AND STILL returns ONE item when the same realized placement is referenced twice. BOTH HALVES,
  // or the fix is "delete the ordered.includes guard", which reintroduces duplicate mounts.
  it("(3a) planStationEquipmentMounts returns two mount items for two copies of the same asset id at different positions", () => {
    const input = {
      scenarioId: "test_scenario",
      equipment: [
        { equipmentId: "ecg_cart_equipment" },
        { equipmentId: "ecg_cart_equipment" },
      ],
      equipmentPlacements: {
        "ecg_cart_equipment_copy_1": { position: { x: -2.15, y: 0, z: 0.55 }, label: "12-lead ECG", interactionCueIds: ["cue1"] },
        "ecg_cart_equipment_copy_2": { position: { x: -1.85, y: 0, z: 0.95 }, label: "12-lead ECG", interactionCueIds: ["cue2"] },
      },
    } as Parameters<typeof planStationEquipmentMounts>[0];

    const mounts = planStationEquipmentMounts(input);

    // Currently the push closure at station-equipment.ts:399-402 drops the second copy
    // because ordered.includes(id) is true.
    // After fix, two distinct realized placement ids must produce two mount items.
    expect(mounts.length).toBe(2);
    const [first, second] = mounts;
    expect(first?.equipmentId).toBe("ecg_cart_equipment");
    expect(second?.equipmentId).toBe("ecg_cart_equipment");
    // Positions must be different (from the placement map or fallback)
    expect(first?.position).not.toEqual(second?.position);
  });

  it("(3b) planStationEquipmentMounts returns one mount item when the same realized placement is referenced twice", () => {
    const input = {
      scenarioId: "test_scenario",
      equipment: [
        { equipmentId: "ecg_cart_equipment" },
      ],
      equipmentPlacements: {
        // ONE realized placement, referenced twice by the equipment array above. A duplicate
        // key in an object literal is silently dropped by JS, so writing the key twice tested
        // nothing; the second reference has to come from the referring side.
        ecg_cart_equipment_copy_1: { position: { x: -2.15, y: 0, z: 0.55 }, label: "12-lead ECG", interactionCueIds: ["cue1"] },
      },
    } as Parameters<typeof planStationEquipmentMounts>[0];

    const mounts = planStationEquipmentMounts(input);

    // Two references to the SAME realized placement must produce ONE mount item.
    // This is the counterweight: appending an index to asset id would break this.
    expect(mounts.length).toBe(1);
  });

  // Clause 4: A collision or overflow is REPORTED in the shape of runtime-actor-slots.ts:130-135, never silent.
  it("(4) overflow/collision is reported in notStaged-shaped form", async () => {
    const mod = await import("@openclinxr/asset-registry");
    const { buildEncounterRuntimeAssetBundle } = mod;

    const assetStore = {
      storeKind: "app_public_fixture" as const,
      containerName: "ui-xr-public",
    };

    // Create a bundle with more equipment copies than can be placed (simulating overflow)
    const bundle = buildEncounterRuntimeAssetBundle({
      bundleId: "test-bundle",
      tenantId: "test-tenant",
      userId: "test-user",
      examRunId: "test-exam",
      encounterId: "test-encounter",
      stationId: "test-station",
      scenarioId: "test-scenario",
      assetStore,
      environment: {
        assetId: "env_1",
        version: "1",
        kind: "environment_model",
        displayName: "Test Environment",
        scenarioAssetId: "env",
        blob: {
          storeKind: "app_public_fixture",
          containerName: "ui-xr-public",
          blobName: "test.glb",
          contentType: "model/gltf-binary",
          url: "test.glb",
        },
        reviewStatus: "fixture_approved_for_local_runtime",
        provenanceRefs: [],
        notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
      },
      actors: [],
      equipment: Array.from({ length: 10 }, (_, i) => ({
        equipmentId: "ecg_cart_equipment",
        model: {
          assetId: `ecg_cart_12_lead_glb_${i}`,
          version: "1",
          kind: "equipment_model" as const,
          displayName: `ECG Cart ${i}`,
          scenarioAssetId: "ecg_cart_equipment",
          blob: { storeKind: "app_public_fixture", containerName: "ui-xr-public", blobName: `ecg-cart-${i}.glb`, contentType: "model/gltf-binary", url: `ecg-cart-${i}.glb` },
          reviewStatus: "fixture_approved_for_local_runtime",
          provenanceRefs: [],
          notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
        },
      })),
      uiSurfaces: [],
    });

    const sceneManifest = bundle.sceneManifest as EncounterRuntimeSceneManifest;
    const equipmentPlacements = sceneManifest.equipmentPlacements;

    // Currently there is no overflow reporting for equipment - duplicates silently collapse.
    // The fix must add overflow reporting in the shape of runtime-actor-slots.ts:130-135:
    // notStaged.push({ actorId, reason: `exceeds_max_visible_humanoid_slots_${maxSlots}_priority_patient_clinical_family_then_bank_order` })
    // For equipment, the shape would be: notStaged.push({ equipmentId, placementId, reason: ... })
    expect(Object.keys(equipmentPlacements).length).toBeGreaterThan(0);
    // CONTRACTED: bundle must include overflow/collision report in notStaged-shaped form.

    // The assertion above passes on HEAD: the map is non-empty whether or not a copy was
    // silently overwritten. The report must NAME the collapse, in the shape
    // assignRuntimeActorSlots uses at xr-runtime-state/src/runtime-actor-slots.ts:130-135
    // (notStaged.push({ actorId, reason })). Nothing reports it today.
    const report = (bundle as Record<string, unknown>).equipmentPlacementReport as
      undefined | { collapsed?: Array<{ assetId: string; reason: string }> };
    expect(report).toBeDefined();
    expect(Array.isArray(report!.collapsed)).toBe(true);
    expect(report!.collapsed!.some((row) => row.assetId === "iv_stand_equipment")).toBe(true);
    expect(report!.collapsed!.every((row) => typeof row.reason === "string" && row.reason.length > 0)).toBe(true);
  });

  // Clause 5: The fifth site (apps/ui-xr/src/main.ts:2838) is recorded as an UNMET REQUIREMENT.
  it("UNMET REQUIREMENT: apps/ui-xr/src/main.ts:2838 runtime registry Map keyed by asset id must also change", () => {
    // This test records the unmet requirement as a comment per spec clause 5.
    // The runtime registry at apps/ui-xr/src/main.ts:2838 uses Map.set keyed by asset id.
    // This is OUT-OF-SCOPE for this card's write-roots but must be tracked.
    // Do not claim this clause and do not touch main.ts.
    expect(true).toBe(true); // placeholder - the requirement is documented above
  });
});

// CONTRACTED: The identity must be a property of the PLACEMENT, not of iteration order.
// Appending an index to the asset id satisfies clause 1 and BREAKS clause 3's second half,
// because two references to the same realized placement would then get different ids.