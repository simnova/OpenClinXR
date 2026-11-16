import { describe, expect, it } from "vitest";

/**
 * RED (card sweep-station-subset, S4): two shipped-station enumerations disagree.
 *
 * - `ed_chest_pain_priority_v2` is only in the manifest list
 *   (listShippedScenarioManifestIds, scene-manifest dirs under
 *   apps/ui-xr/public/xr-assets/generated): the station ships but the bank
 *   declares no cast for it.
 * - `clinic_knee_pain_return_to_play_v1` is only in the cast list
 *   (listShippedCastScenarioIds, scenarioBank via actor-casting.ts): the bank
 *   declares a cast for a station with no shipped manifest.
 *
 * Making the lists agree is a PRODUCT decision (a station without a cast vs a
 * cast without a shipped manifest), so this card does NOT make it green.
 * Restoration: the fix card converts this it.fails to it() in the same change
 * that resolves whichever side is wrong.
 */

import { listShippedCastScenarioIds } from "@openclinxr/asset-registry";
import { listShippedScenarioManifestIds } from "../station-room-not-empty.js";

describe("the shipped station lists agree", () => {
  it.fails("manifest stations equal cast stations", async () => {
    const manifest = new Set(await listShippedScenarioManifestIds());
    const cast = new Set(listShippedCastScenarioIds());
    const onlyManifest = [...manifest].filter((id) => !cast.has(id)).sort();
    const onlyCast = [...cast].filter((id) => !manifest.has(id)).sort();
    expect(
      { onlyManifest, onlyCast },
      `shipped station lists disagree:\n`
        + `only in manifest (xr-assets/generated): ${onlyManifest.join(", ") || "(none)"}\n`
        + `only in cast (scenarioBank): ${onlyCast.join(", ") || "(none)"}`,
    ).toEqual({ onlyManifest: [], onlyCast: [] });
  });
});
