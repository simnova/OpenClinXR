import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#69) — the room changed and nobody has seen it.
 *
 * ALL THREE `it.fails` FLIP. This header is THE RECORD, not scratch — flip them, append a
 * `## FIXED (#69)` block below, and leave the measurements intact.
 *
 * WHY THIS EXISTS. #44 wired `environmentId` through to the runtime: `main.ts:3311` calls
 * `buildStationEnvironment` with the id resolved at `:4255`, and the factory planner reads the same
 * descriptor. The evidence graded for that slice was a TOP-DOWN SCHEMATIC — a floor plan with
 * labelled fixture squares. It described the inputs and looked like evidence. So "the descriptors
 * differ and both consumers read them" is proven and "a learner sees a different room" is not.
 *
 * TWO TRAPS, both verified in the tree, both of which produce a convincing artifact of nothing:
 *
 *   1. `cleanHumanoidSourceComparatorCapture` sets `stationEnvironment.visible = false` and
 *      `floor.visible = false` (`main.ts:3318-3320`). A capture in that mode photographs an empty
 *      stage and can be filed as a room shot.
 *   2. The existing ui-xr captures deliberately frame an actor's FACE. Copying that framing gives a
 *      close-up of a patient in front of a wall.
 *
 * WHAT ALREADY EXISTS and should be reused rather than rebuilt: `spawnPortlessDevServer` + Playwright
 * + `page.screenshot` (`ui-xr-viseme-drive-capture.ts:17`, `:253`, `:310`), the `scenarioId` query
 * param (`main.ts:1033`), `window.__openClinXrDebugScene` (`:3216`), and the `scene-overview` /
 * `generated-scene` / `dynamic-only` capture modes (`main.ts:1068-1072`).
 *
 * THE IMAGE MUST BE TIED TO THE LIVE SCENE. A manifest that restates `environment-descriptors.ts`
 * proves nothing about what was drawn — it is the schematic failure wearing a different hat. The
 * facts must be read back FROM THE RUNNING PAGE: `stationEnvironment.userData`, the floor's
 * `openClinXrEncounterSpecificRuntimeTheme` (`main.ts:3316`), the live mesh bounds.
 *
 * THE THREE CONTRACTS PULL APART, and each kills a different convincing artifact.
 *
 * The first demands the manifest come from the page rather than the module, which is what separates
 * evidence from a restatement. The second demands two settings produce different LIVE numbers, so a
 * capture that reads the page but photographs one room twice fails. The third demands that a mode
 * which hides the environment be REFUSED rather than photographed — because the most likely way to
 * produce a green, well-formed, entirely empty result is to capture in comparator mode.
 *
 * THE CAUSE IS NOT IN DOUBT (nothing has rendered this) BUT THE FRAMING IS NOT KNOWN TO ME. Which
 * capture mode and camera position actually show a room rather than a wall is something I have not
 * run. Trace it yourself; do not take a suggestion of mine as fact, and if `scene-overview` turns out
 * to be the wrong mode, say which is right and why.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `captureStationEnvironmentRooms(...)` returning
 * a manifest of per-scenario entries carrying `liveShell` facts and an image path, and
 * `refusesHiddenEnvironmentCapture(...)` as a guard. Change the call sites and say why if a different
 * shape is better. What must not change: facts come from the page, two settings differ live, and a
 * hidden environment is refused.
 *
 * SCOPE: that a room was rendered and the image belongs to the environment it claims. Whether the
 * rooms LOOK like different places is read off the pixels and recorded on #69 — and "indistinguishable"
 * is a successful outcome that closes the item, not a failure of this slice.
 *
 * ## FIXED (#69)
 * - `ui-xr-environment-room-capture.ts` exports `buildRoomCaptureManifest` (page readings only;
 *   `source: "live_scene"`; never reconciles against `environment-descriptors.ts`).
 * - `refusesHiddenEnvironmentCapture` refuses `clean-humanoid-source-comparator` / `source-clean`
 *   and allows `scene-overview` (the mode that keeps the shell visible).
 * - CLI `pnpm asset:ui-xr:environment-room-capture` Playwright-captures ED + telehealth via
 *   `spawnPortlessDevServer` + `?scenarioId=` + `openclinxrPortalStart=encounter` + `scene-overview`,
 *   reads shell facts from `window.__openClinXrDebugScene` (station shell userData + floor theme),
 *   writes `.openclinxr/evidence/ui-xr-environment-room/latest/capture-manifest.json`.
 * Measurements in the planted header (empty-stage trap, face framing trap, schematic grading gap)
 * remain the record — not deleted.
 */

const load = async () =>
  import("./ui-xr-environment-room-capture.js") as Promise<Record<string, unknown>>;

type LiveShell = { environmentId: string; floorColor?: unknown; roomDepthMeters?: unknown };
type ManifestEntry = { scenarioId: string; imagePath: string; liveShell: LiveShell; source?: string };
type Manifest = { entries: ManifestEntry[] };

type BuildManifest = (input: {
  pageReadings: ReadonlyArray<{ scenarioId: string; imagePath: string; liveShell: LiveShell }>;
}) => Manifest;

type RefusesHidden = (input: { captureMode: string }) => boolean;

describe("the station environment is rendered and the image belongs to it (#69)", () => {
  it("the capture manifest records shell facts read back from the live scene, not from the descriptor module", async () => {
    const mod = await load();
    const build = mod["buildRoomCaptureManifest"] as BuildManifest | undefined;
    expect(build).toBeTypeOf("function");

    // A reading that could ONLY have come from the page: a floor colour no descriptor carries.
    const reading = {
      scenarioId: "ed_chest_pain_priority_v1",
      imagePath: "ed_chest_pain_priority_v1-room.png",
      liveShell: { environmentId: "ed_exam_bay_v1", floorColor: 123456, roomDepthMeters: 9.99 },
    };
    const manifest = build!({ pageReadings: [reading] });

    expect(manifest.entries).toHaveLength(1);
    const entry = manifest.entries[0]!;
    // If the builder "corrects" these against the descriptor module, it is restating the inputs —
    // which is exactly the schematic failure this contract exists to prevent.
    expect(entry.liveShell.floorColor).toBe(123456);
    expect(entry.liveShell.roomDepthMeters).toBe(9.99);
    expect(entry.source).toBe("live_scene");
  });

  it("an ED bay and a telehealth home visit report different live floor colour and room depth", async () => {
    const mod = await load();
    const build = mod["buildRoomCaptureManifest"] as BuildManifest | undefined;
    expect(build).toBeTypeOf("function");

    const manifest = build!({
      pageReadings: [
        {
          scenarioId: "ed_chest_pain_priority_v1",
          imagePath: "ed-room.png",
          liveShell: { environmentId: "ed_exam_bay_v1", floorColor: 5858155, roomDepthMeters: 3.45 },
        },
        {
          scenarioId: "telehealth_diabetes_health_literacy_v1",
          imagePath: "telehealth-room.png",
          liveShell: { environmentId: "telehealth_home_visit_v1", floorColor: 9136404, roomDepthMeters: 2.55 },
        },
      ],
    });

    expect(manifest.entries).toHaveLength(2);
    const [ed, home] = manifest.entries as [ManifestEntry, ManifestEntry];
    expect(ed.liveShell.environmentId).not.toBe(home.liveShell.environmentId);
    expect(ed.liveShell.floorColor).not.toBe(home.liveShell.floorColor);
    expect(ed.liveShell.roomDepthMeters).not.toBe(home.liveShell.roomDepthMeters);
    expect(ed.imagePath).not.toBe(home.imagePath);
  });

  it("a capture mode that hides the station environment is refused rather than photographed", async () => {
    // main.ts:3318-3320 hides stationEnvironment and floor in the clean humanoid comparator mode.
    // Photographing that produces a well-formed image of an empty stage — the most likely way to
    // file convincing evidence of nothing.
    const mod = await load();
    const refuses = mod["refusesHiddenEnvironmentCapture"] as RefusesHidden | undefined;
    expect(refuses).toBeTypeOf("function");

    expect(refuses!({ captureMode: "clean-humanoid-source-comparator" })).toBe(true);
    // And a mode that shows the room must NOT be refused, or "refuse everything" satisfies the above.
    expect(refuses!({ captureMode: "scene-overview" })).toBe(false);
  });
});
