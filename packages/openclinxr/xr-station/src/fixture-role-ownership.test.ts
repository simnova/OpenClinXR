/**
 * Counterweight: the fixture retains physical review-prop identity (#209 follow-up).
 *
 * Package-owned by @openclinxr/xr-station (moved from tools/openclinxr/evidence so the
 * architecture boundary test counts only package-owned sources). Imports the stamp
 * helper via the existing public entrypoint (./index.js). Uses a synthetic owned
 * geometry assertions prove identity stamping, not metadata mirroring.
 *
 * A known physical whiteboard (safety-plan-whiteboard: PHYSICAL_PROP_IDS table,
 * semanticRole review_cue) is stamped onto its owned wall_board fixture, so the
 * declared-equipment inspector sees the declaration fulfilled through one real mesh.
 * Unknown/abstract review/objective cues stay excluded; marker-only fixtures cannot
 * fulfill; no geometry added; no semanticRole mutated to cheat the filter.
 */
import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial } from "three";
import { describe, expect, it } from "vitest";
import { stampSuppressedDeclaredEquipmentOntoFixtures } from "./index.js";

// Synthetic owned unit fixture (not a production-fixture claim): a real THREE
// Group + Mesh/BoxGeometry pair carrying the owned wall_board slot id, so the
// geometry child-count/Box3 before-after assertions prove identity stamping on
// actual geometry. The real production fixture is proven later by HOST capture.
function realWallBoardFixture(slotId = "behavioral_health_whiteboard") {
  const root = new Group();
  root.userData["fixtureSlotId"] = slotId;
  const board = new Mesh(new BoxGeometry(1.2, 0.8, 0.05), new MeshBasicMaterial());
  board.position.set(0.4, 1.4, -0.95);
  const tray = new Mesh(new BoxGeometry(1.2, 0.05, 0.1), new MeshBasicMaterial());
  tray.position.set(0.4, 0.95, -0.92);
  root.add(board, tray);
  return { children: [root] };
}

function meshChildCount(shell: { children: unknown[] }): number {
  let count = 0;
  for (const child of shell.children) {
    (child as { traverse: (cb: (o: unknown) => void) => void }).traverse((o) => {
      if (o instanceof Mesh) count += 1;
    });
  }
  return count;
}

function boxSignature(shell: { children: unknown[] }): string {
  const box = new Box3();
  for (const child of shell.children) {
    box.expandByObject(child as never);
  }
  const fmt = (n: number) => n.toFixed(6);
  return [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z]
    .map(fmt)
    .join(",");
}

describe("the fixture retains physical review-prop identity", () => {
  it("stamps the physical review whiteboard once through its owned fixture", () => {
    const shell = realWallBoardFixture();
    const stamped = stampSuppressedDeclaredEquipmentOntoFixtures({
      shell,
      plannedEquipmentIds: [],
      equipmentPlacements: {},
      equipment: [],
      roomProps: [
        { propId: "safety-plan-whiteboard", semanticRole: "review_cue" },
      ],
    });
    expect(stamped).toHaveLength(1);
    expect(stamped[0]!.equipmentId).toBe("safety-plan-whiteboard");
    const ud = (shell.children[0] as { userData: Record<string, unknown> }).userData;
    expect(ud["openClinXrFixtureFulfillsDeclaredEquipmentId"]).toBe("safety-plan-whiteboard");
    // No duplicate geometry claim: evidence row is metadata, mesh count stable.
    expect(stamped[0]!.meshCount).toBe(2);
  });

  it("leaves unknown/abstract review and objective cues unstamped", () => {
    const shell = realWallBoardFixture();
    const stamped = stampSuppressedDeclaredEquipmentOntoFixtures({
      shell,
      plannedEquipmentIds: [],
      equipmentPlacements: {},
      equipment: [],
      roomProps: [
        { propId: "glucometer-log-review", semanticRole: "review_cue" },
        { propId: "mystery-objective-thing", semanticRole: "objective_cue" },
      ],
    });
    expect(stamped).toHaveLength(0);
    const ud = (shell.children[0] as { userData: Record<string, unknown> }).userData;
    expect(ud["openClinXrFixtureFulfillsDeclaredEquipmentId"]).toBeUndefined();
  });

  it("a marker-only fixture cannot fulfill a declaration", () => {
    const stamped = stampSuppressedDeclaredEquipmentOntoFixtures({
      shell: {
        children: [
          { userData: { fixtureSlotId: "behavioral_health_whiteboard", isMarkerCube: true } },
        ],
      },
      plannedEquipmentIds: [],
      equipmentPlacements: {},
      equipment: [],
      roomProps: [{ propId: "safety-plan-whiteboard", semanticRole: "review_cue" }],
    });
    expect(stamped).toHaveLength(0);
  });

  it("does not mutate other roles or stamp the same id twice with new geometry", () => {
    const shell = realWallBoardFixture();
    const first = stampSuppressedDeclaredEquipmentOntoFixtures({
      shell,
      plannedEquipmentIds: [],
      equipmentPlacements: {},
      equipment: [],
      roomProps: [{ propId: "safety-plan-whiteboard", semanticRole: "review_cue" }],
    });
    const before = (shell.children[0] as { userData: Record<string, unknown> }).userData;
    const aliasesBefore = [...(before["openClinXrEquipmentIdAliases"] as string[])];
    // Second pass with an unrelated cue role prop must not add geometry or aliases.
    const second = stampSuppressedDeclaredEquipmentOntoFixtures({
      shell,
      plannedEquipmentIds: [],
      equipmentPlacements: {},
      equipment: [],
      roomProps: [{ propId: "plain-language-plan-card", semanticRole: "communication_cue" }],
    });
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    const after = (shell.children[0] as { userData: Record<string, unknown> }).userData;
    expect(after["openClinXrEquipmentIdAliases"]).toEqual(aliasesBefore);
  });

  it("stamping adds no geometry and keeps the real wallboard Box3 stable", () => {
    const shell = realWallBoardFixture();
    const childrenBefore = meshChildCount(shell);
    expect(childrenBefore).toBeGreaterThan(0);
    const boxBefore = boxSignature(shell);
    stampSuppressedDeclaredEquipmentOntoFixtures({
      shell,
      plannedEquipmentIds: [],
      equipmentPlacements: {},
      equipment: [],
      roomProps: [{ propId: "safety-plan-whiteboard", semanticRole: "review_cue" }],
    });
    // Repeat pass stamps aliases at most once — no geometry or alias growth.
    stampSuppressedDeclaredEquipmentOntoFixtures({
      shell,
      plannedEquipmentIds: [],
      equipmentPlacements: {},
      equipment: [],
      roomProps: [{ propId: "safety-plan-whiteboard", semanticRole: "review_cue" }],
    });
    expect(meshChildCount(shell)).toBe(childrenBefore);
    expect(boxSignature(shell)).toBe(boxBefore);
    const ud = (shell.children[0] as { userData: Record<string, unknown> }).userData;
    const aliases = ud["openClinXrEquipmentIdAliases"] as string[];
    expect(aliases.filter((a) => a === "safety-plan-whiteboard")).toHaveLength(1);
  });
});
