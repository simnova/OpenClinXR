import { Group, Mesh } from "three";
import { describe, expect, it } from "vitest";
import { resolveStationEnvironment } from "./station-environment.js";

/**
 * Compiled room GLB from encounter materialization is the learner-visible shell.
 * Parametric `buildStationEnvironment` is the fallback when the URL is absent.
 *
 * claimScope: simulated_actor_or_factory_behavior
 * notEvidenceFor: clinical validity, licensure, exam equivalence, Quest readiness
 */

const ED_BAY = "ed_exam_bay_v1";
const TELEHEALTH = "telehealth_home_visit_v1";

function mockLoadGltf(url: string): Promise<Group> {
  const root = new Group();
  root.userData.mockSourceUrl = url;
  return Promise.resolve(root);
}

function hasParametricFloor(root: Group): boolean {
  let found = false;
  root.traverse((obj) => {
    if (obj.name === "openclinxr.station-environment.floor") found = true;
  });
  return found;
}

describe("the compiled room GLB replaces the parametric shell", () => {
  it("two environmentIds produce two compileNodeId tags and do not spawn the parametric box", async () => {
    const ed = await resolveStationEnvironment({
      environmentId: ED_BAY,
      compiledRoomAssetUrl: "/compiled/rooms/ed_exam_bay_v1.glb",
      compileNodeId: "room:ed_exam_bay_v1",
      loadGltf: mockLoadGltf,
    });
    const home = await resolveStationEnvironment({
      environmentId: TELEHEALTH,
      compiledRoomAssetUrl: "/compiled/rooms/telehealth_home_visit_v1.glb",
      compileNodeId: "room:telehealth_home_visit_v1",
      loadGltf: mockLoadGltf,
    });

    expect(ed.userData.openClinXrCompiledRoom).toBe(true);
    expect(home.userData.openClinXrCompiledRoom).toBe(true);
    expect(ed.userData.environmentId).toBe(ED_BAY);
    expect(home.userData.environmentId).toBe(TELEHEALTH);
    expect(ed.userData.compileNodeId).toBe("room:ed_exam_bay_v1");
    expect(home.userData.compileNodeId).toBe("room:telehealth_home_visit_v1");
    expect(ed.userData.compileNodeId).not.toBe(home.userData.compileNodeId);
    expect(ed.userData.compiledRoomAssetUrl).toBe("/compiled/rooms/ed_exam_bay_v1.glb");
    expect(home.userData.compiledRoomAssetUrl).toBe(
      "/compiled/rooms/telehealth_home_visit_v1.glb",
    );

    expect(ed.name).toBe("openclinxr.compiled-room-shell");
    expect(home.name).toBe("openclinxr.compiled-room-shell");
    expect(hasParametricFloor(ed)).toBe(false);
    expect(hasParametricFloor(home)).toBe(false);
    expect(ed.children.some((c) => c instanceof Mesh)).toBe(false);
  });

  it("missing URL keeps the parametric path", async () => {
    const shell = await resolveStationEnvironment({ environmentId: ED_BAY });
    expect(shell.userData.openClinXrCompiledRoom).not.toBe(true);
    expect(shell.userData.compileNodeId).toBeUndefined();
    expect(shell.name).toBe("openclinxr.station-environment-shell");
    expect(shell.userData.environmentId).toBe(ED_BAY);
    expect(hasParametricFloor(shell)).toBe(true);
  });
});
