import { describe, expect, it } from "vitest";
import type { EncounterRuntimeActorPlacement, EncounterRuntimeSceneManifest } from "./index.js";

//
// OBSERVABLE: `EncounterRuntimeActorPlacement` (runtime-bundles.ts:162-171) lacks a `headingRadians`
// field. A grep for `heading|yawDegrees|facingDegrees|rotationDegrees` across asset-registry,
// xr-runtime-state, shared-schemas and tools/openclinxr/factory returns zero. Every heading in
// the scene today is hardcoded in three places: xr-station-room/src/actor-staging.ts:210,216
// (`spouse.rotation.y = -0.26`), xr-scene/src/encounter-actor-framing.ts:137 (same constant on
// any seated actor), apps/ui-xr/src/main.ts:3512-3513 (per-frame sine sway on patient and nurse).
//
// MEASURED 2026-09-09. `asset-registry/src/runtime-bundles.ts:162-171` declares
// `EncounterRuntimeActorPlacement` as `slotKind`, `position`, `scale`, `verticalOffsetMeters`,
// `labelPrefix`, `posture?`. `createEdChestPainRuntimeSceneManifest` (runtime-bundles.ts:1427)
// builds the hardcoded manifest; its `actorPlacements` literals are at :1456-1459 (patient supine
// at x -0.9, nurse, spouse).
//
// known-good: `posture?` on the same type is set by the builder and read at
// actor-staging.ts:122. The unit is settled by the tree: every existing heading write is RADIANS
// (all three sites use -0.26).
//
// CONTRACTED EXPORT (the honest slice adds exactly this):
//   // asset-registry/src/runtime-bundles.ts — ONE optional field on the existing type:
//   export type EncounterRuntimeActorPlacement = {
//     /* ...existing six fields, unchanged... */
//     //
// //      * Yaw about +Y applied to the OUTER actor slot Group, never the loaded humanoid
// //      * child (the loader zeroes that child at xr-asset-loading/src/generated-loaders.ts:112).
// //      * RADIANS, matching every existing heading writer. Absent means no authored facing;
// //      * 0 is a real heading and is NOT the same as absent.
// //
//     headingRadians?: number;
//   };
//   and `createEdChestPainRuntimeSceneManifest` (:1427) populates `headingRadians` on at least
//   one actor placement literal.
//
// IN-SCOPE: packages/openclinxr/asset-registry/src/runtime-bundles.ts
// OUT-OF-SCOPE: actor-placement.ts, apps/ui-xr, actor-staging.ts, making the field required.
//
describe("A runtime actor placement can express a heading", () => {
  it.fails("(1) The field is named headingRadians (unit in the symbol), reachable on a placement value obtained from a BUILT manifest, not from a literal the test types inline", async () => {
    const mod = await import("./index.js");
    const createManifest = (mod as Record<string, unknown>)["createEdChestPainRuntimeSceneManifest"] as
      undefined | ((input?: Record<string, unknown>) => EncounterRuntimeSceneManifest);
    expect(typeof createManifest).toBe("function");

    const manifest = (createManifest as (input?: Record<string, unknown>) => EncounterRuntimeSceneManifest)();
    const placements = Object.values(manifest.actorPlacements) as EncounterRuntimeActorPlacement[];

    // The field must exist on a placement from a built manifest
    const hasHeadingRadians = placements.some((p) => "headingRadians" in p);
    expect(hasHeadingRadians).toBe(true);
  });

  it.fails("(2) A manifest built by createEdChestPainRuntimeSceneManifest carries a numeric headingRadians on at least one actor placement", async () => {
    const mod = await import("./index.js");
    const createManifest = (mod as Record<string, unknown>)["createEdChestPainRuntimeSceneManifest"] as
      undefined | ((input?: Record<string, unknown>) => EncounterRuntimeSceneManifest);
    expect(typeof createManifest).toBe("function");

    const manifest = (createManifest as (input?: Record<string, unknown>) => EncounterRuntimeSceneManifest)();
    const placements = Object.values(manifest.actorPlacements) as EncounterRuntimeActorPlacement[];

    const placementWithHeading = placements.find((p) =>
      "headingRadians" in p && typeof (p as EncounterRuntimeActorPlacement & { headingRadians?: number }).headingRadians === "number"
    );
    expect(placementWithHeading).toBeDefined();
  });

  it.fails("(3) The field is genuinely optional in practice: the builder emits at least one placement WITH headingRadians and at least one WITHOUT it", async () => {
    const mod = await import("./index.js");
    const createManifest = (mod as Record<string, unknown>)["createEdChestPainRuntimeSceneManifest"] as
      undefined | ((input: unknown) => EncounterRuntimeSceneManifest);
    expect(typeof createManifest).toBe("function");
    const manifest = (createManifest as (input: unknown) => EncounterRuntimeSceneManifest)({});
    const placements = Object.values(manifest.actorPlacements) as Array<
      EncounterRuntimeActorPlacement & { headingRadians?: number }
    >;
    // Optionality is only meaningful once the field EXISTS. Asserting only that a
    // hand-built literal without the field is accepted is a tautology: it passes
    // identically before and after the slice. Both halves are required.
    expect(placements.some((p) => typeof p.headingRadians === "number")).toBe(true);
    expect(placements.some((p) => p.headingRadians === undefined)).toBe(true);
  });

  it.fails("(4) Absent is distinguishable from zero: the placement that carries a heading reports a number, and one with no authored facing reports undefined, never 0", async () => {
    const mod = await import("./index.js");
    const createManifest = (mod as Record<string, unknown>)["createEdChestPainRuntimeSceneManifest"] as
      undefined | ((input: unknown) => EncounterRuntimeSceneManifest);
    expect(typeof createManifest).toBe("function");
    const manifest = (createManifest as (input: unknown) => EncounterRuntimeSceneManifest)({});
    const placements = Object.values(manifest.actorPlacements) as Array<
      EncounterRuntimeActorPlacement & { headingRadians?: number }
    >;
    const withHeading = placements.filter((p) => "headingRadians" in p);
    expect(withHeading.length).toBeGreaterThan(0);
    for (const p of withHeading) expect(typeof p.headingRadians).toBe("number");
    const withoutHeading = placements.filter((p) => !("headingRadians" in p));
    for (const p of withoutHeading) expect(p.headingRadians).toBeUndefined();
  });
});
