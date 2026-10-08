import { Bone, BufferGeometry, Float32BufferAttribute, MeshBasicMaterial, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { measureSupineSupportRegions, settleSupineSupportRegions, type SupineSupportPlane } from "./supine-support-contact.js";

function rig(rows: Array<{ bone: "pelvis" | "spine01" | "spine04"; y: number }>): SkinnedMesh {
  const bones = ["pelvis", "spine01", "spine04"].map((name) => {
    const bone = new Bone();
    bone.name = name;
    return bone;
  });
  const positions: number[] = [];
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  for (const row of rows) {
    const boneIndex = row.bone === "pelvis" ? 0 : row.bone === "spine01" ? 1 : 2;
    for (let index = 0; index < 12; index += 1) {
      positions.push(index * 0.005, row.y, 0);
      skinIndices.push(boneIndex, 0, 0, 0);
      skinWeights.push(1, 0, 0, 0);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("skinIndex", new Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute("skinWeight", new Float32BufferAttribute(skinWeights, 4));
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
  for (const bone of bones) mesh.add(bone);
  mesh.bind(new Skeleton(bones));
  mesh.updateMatrixWorld(true);
  return mesh;
}

const horizontal: SupineSupportPlane = {
  origin: new Vector3(0, 0, 0),
  normal: new Vector3(0, 1, 0),
};
const planes = { pelvis: horizontal, lumbar: horizontal, thorax: horizontal } as const;

describe("supine multi-region rendered-surface contact", () => {
  it("reads the deformed skinned surface rather than bind positions", () => {
    const mesh = rig([{ bone: "spine04", y: 0.01 }]);
    mesh.skeleton.bones[2]!.position.y = 0.2;
    mesh.updateMatrixWorld(true);
    mesh.skeleton.update();
    const metric = measureSupineSupportRegions(mesh, planes).thorax;
    expect(metric.samples).toBe(12);
    expect(metric.contactGapMeters).toBeCloseTo(0.21, 5);
  });

  it("one touching pelvis region cannot certify floating lumbar and thorax regions", () => {
    const mesh = rig([
      { bone: "pelvis", y: 0.01 },
      { bone: "spine01", y: 0.14 },
      { bone: "spine04", y: 0.18 },
    ]);
    const before = measureSupineSupportRegions(mesh, planes);
    expect(before.pelvis.contactGapMeters).toBeCloseTo(0.01, 5);
    expect(before.lumbar.contactGapMeters).toBeCloseTo(0.14, 5);
    expect(before.thorax.contactGapMeters).toBeCloseTo(0.18, 5);
    expect(settleSupineSupportRegions(mesh, planes, 0.025)).toBeCloseTo(0.03, 5);
    const after = measureSupineSupportRegions(mesh, planes);
    expect(after.pelvis.minGapMeters).toBeCloseTo(-0.02, 5);
    expect(after.thorax.contactGapMeters).toBeCloseTo(0.15, 5);
  });

  it("finite support predicates exclude off-mattress vertices", () => {
    const mesh = rig([{ bone: "spine04", y: 0.01 }]);
    const finite = {
      ...planes,
      thorax: { ...horizontal, contains: () => false },
    };
    expect(measureSupineSupportRegions(mesh, finite).thorax.samples).toBe(0);
  });
});
