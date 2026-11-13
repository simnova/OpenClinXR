import { afterEach, describe, expect, it, vi } from "vitest";
import { startEncounterSyncFromUrl } from "./headset.js";

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { __openClinXrGazeCamera?: unknown }).__openClinXrGazeCamera;
});

describe("XS-READY learner latch", () => {
  it("RED5: sends ready exactly once and only after the interior camera marker appears", async () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    (globalThis as { __openClinXrGazeCamera?: unknown }).__openClinXrGazeCamera = { userData: {} };
    const joined = await startEncounterSyncFromUrl({
      search: "?encounterSync=ws://127.0.0.1:9",
      actorIds: () => [],
      register: () => undefined,
      play: () => undefined,
      publish: () => undefined,
      nowMs: () => 0,
      connectFn: async () => ({
        sessionId: "learner",
        sendReady: () => { sent.push("ready"); },
        sendIntent: async () => ({ status: "ack", seq: 1, serverTs: 0, rttMs: 0 }),
        onState: () => () => undefined,
        leave: async () => undefined,
      }) as never,
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(sent).toEqual([]);
    const camera = (globalThis as unknown as { __openClinXrGazeCamera: { userData: { openClinXrInteriorPreviewCamera?: unknown } } }).__openClinXrGazeCamera;
    camera.userData.openClinXrInteriorPreviewCamera = {
      eyeWorld: [0, 1.6, 2],
      lookAtWorld: [0, 1.4, 0],
      interiorMin: [-4, 0, -4],
      interiorMax: [4, 3, 4],
      wallThicknessMeters: 0.15,
      nearestActorMeters: 1.8,
      authoredWorldZ: 5.35,
      partialCast: false,
      mixerTimeAtLatch: 0.5,
      policy: "authored_wide_pullback_is_outside_a_closed_generated_shell_so_the_preview_eye_is_derived_from_measured_room_and_cast_bounds",
    };
    await vi.advanceTimersByTimeAsync(100);
    expect(sent).toEqual(["ready"]);
    await vi.advanceTimersByTimeAsync(100);
    expect(sent).toEqual(["ready"]);
    await joined?.leave();
  });
});
