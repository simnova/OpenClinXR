import { describe, expect, it } from "vitest";
import { scenarioBank } from "@openclinxr/scenario-fixtures/scenario-bank";
import { buildEnvironmentGenerationPacket, createScenarioPlaceholderManifests } from "./index.js";

/**
 * PLANTED CONTRACT (#44) — the factory plans an ED bay for every encounter, whatever it is.
 *
 * THE SINGLE `it.fails` FLIPS. The live guard below it already passes and must keep passing.
 * This header is THE RECORD, not scratch — flip it, append a `## FIXED (#44)` block, and leave the
 * measured output intact.
 *
 * MEASURED across all 14 shipped scenarios: `buildEnvironmentGenerationPacket` (`index.ts:1166`)
 * calls `buildEdBaySpatialZones` (`:2215`), which returns the SAME five zone ids every time —
 * `learner_entry, patient_bedside, nurse_workflow, family_interrupt, diagnostic_equipment` — for
 * `ed_exam_bay_v1`, `telehealth_home_visit_v1`, `behavioral_health_private_room_v1`,
 * `oncology_consult_room_v1` and the rest alike. The function name admits what it does.
 *
 * The anchors are where it stops being merely generic. For
 * `telehealth_diabetes_health_literacy_v1`, environment `telehealth_home_environment`, the planner
 * emits, verbatim:
 *
 *   learner_entry        doorway_panel, hand_hygiene_marker, exam_timer_sightline
 *   patient_bedside      patient_head_position, LEFT_BED_RAIL, examiner_standing_zone
 *   nurse_workflow       NURSE_STANDING_ZONE, monitor_glance_target, handoff_tablet_marker
 *   family_interrupt     doorway_interrupt_position, family_waiting_spot, privacy_boundary_marker
 *   diagnostic_equipment ECG_CART_PARKING_SPOT, IV_STAND_SIDE_POSITION, vital_sign_display_plane
 *
 * A bed rail, a nurse standing zone, an ECG cart and an IV stand — in a patient's home, over video.
 *
 * THE OTHER HALF OF THE LOOP, and why this is not a tidiness complaint: `environmentId` is a
 * required schema field (`shared-schemas/src/schemas.ts:218`) that `apps/ui-xr/src/**` never reads —
 * grep returns nothing. So the factory plans an ED bay whatever the encounter says, and the runtime
 * renders a fixed room whatever the factory says. The runtime half is contracted separately in
 * `apps/ui-xr/src/station-environment.test.ts`; BOTH are required by #44 and neither closes it alone.
 *
 * THE TWO CONTRACTS PULL APART. The planted one demands a telehealth plan stop naming ED furniture.
 * Returning fewer zones, or no zones, satisfies that and fails the live one below, which requires a
 * real ED bay to still get a bedside with a rail. Deleting the ED-ness is not the fix; deriving it
 * from the environment is.
 *
 * THE CAUSE IS KNOWN — the zone table is a literal. WHAT IS NOT KNOWN TO ME is where the per-environment
 * zone descriptions should come from: a table keyed by environmentId here, a field on the scenario, or
 * something the asset manifest already carries. I looked and did not find an existing source. Trace it
 * yourself rather than taking that as fact — if one exists, use it and say so.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. This reads the existing
 * `buildEnvironmentGenerationPacket(scenario, manifests)` and inspects `spatialZones`. What must not
 * change: a plan for a home visit does not describe hospital furniture, and a plan for an ED bay
 * still does.
 *
 * SCOPE: what the factory PLANS. Says nothing about what any room looks like — no asset is generated
 * by this path at all, which its own `claimBoundary` states
 * (`environment_generation_plan_not_generated_asset`, `:264`).
 *
 * ## FIXED (#44)
 * - `buildEdBaySpatialZones` removed; `buildSpatialZonesForEnvironment(environmentId, …)` materialises
 *   zones from `environment-descriptors.ts` (same table the ui-xr shell builder reads).
 * - telehealth_home_visit_v1 zone anchors: video_call_frame, patient_chair_position, medication_bottle_shelf
 *   — no left_bed_rail / ecg_cart_parking_spot / iv_stand_side_position / nurse_standing_zone.
 * - ed_exam_bay_v1 still plans patient_bedside with left_bed_rail (live neighbour below stays green).
 * - The telehealth ED-furniture anchor list above remains the evidence for why this issue existed.
 */

const ED_FURNITURE = ["left_bed_rail", "ecg_cart_parking_spot", "iv_stand_side_position", "nurse_standing_zone"];

function packetFor(scenarioId: string) {
  const scenario = (scenarioBank as ReadonlyArray<{ scenarioId: string }>).find((s) => s.scenarioId === scenarioId);
  if (!scenario) throw new Error(`fixture missing: ${scenarioId}`);
  return buildEnvironmentGenerationPacket(scenario as never, createScenarioPlaceholderManifests(scenario as never));
}

describe("the environment plan describes the encounter's own setting (#44)", () => {
  it("a telehealth environment does not plan an ED stretcher bedside zone", () => {
    const packet = packetFor("telehealth_diabetes_health_literacy_v1");
    const anchors = packet.spatialZones.flatMap((zone) => zone.spatialAnchors);
    const hospitalFurniture = anchors.filter((anchor) => ED_FURNITURE.includes(anchor));
    expect(hospitalFurniture, `${packet.environmentAssetId} planned hospital furniture`).toEqual([]);
  });

  it("an ED bay still plans a bedside with a rail", () => {
    // LIVE, NOT PLANTED — passes today and must keep passing. Returning fewer zones, or dropping the
    // ED-specific anchors everywhere, satisfies the contract above and fails this one.
    const packet = packetFor("ed_chest_pain_priority_v1");
    const bedside = packet.spatialZones.find((zone) => zone.zoneId === "patient_bedside");
    expect(bedside, "an ED bay must still have a bedside zone").toBeDefined();
    expect(bedside?.spatialAnchors).toContain("left_bed_rail");
  });
});
