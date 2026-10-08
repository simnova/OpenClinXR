import { readFileSync } from "node:fs";
import { buildPatientStretcher } from "@openclinxr/xr-station";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { applyAndPlantSupineOnDeck, applySupinePoseHoldingIncline, holdSupinePlantFrame, reapplySupineHeadToStoredPillow } from "./index.js";
import { Mesh, BoxGeometry, AnimationMixer, AnimationClip, QuaternionKeyframeTrack, Quaternion, Bone, Group, BufferGeometry, Float32BufferAttribute, MeshBasicMaterial, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { makeSupineSupportPlanes, measureSupineSupportRegions, settleSupineSupportRegions, type SupineSupportPlane } from "./supine-support-contact.js";

function rig(rows: Array<{ bone: "pelvis" | "spine03" | "spine01" | "head"; y: number; posterior?: boolean }>): SkinnedMesh {
  const bones = ["pelvis", "spine03", "spine01", "head"].map((name) => {
    const bone = new Bone();
    bone.name = name;
    return bone;
  });
  const positions: number[] = [];
  const normals: number[] = [];
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  for (const row of rows) {
    const boneIndex = row.bone === "pelvis" ? 0 : row.bone === "spine03" ? 1 : row.bone === "spine01" ? 2 : 3;
    for (let index = 0; index < 12; index += 1) {
      positions.push(index * 0.005, row.y, 0);
      normals.push(0, 0, row.posterior ? -1 : 1);
      skinIndices.push(boneIndex, 0, 0, 0);
      skinWeights.push(1, 0, 0, 0);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
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
const planes = { pelvis: horizontal, lumbar: horizontal, thorax: horizontal, heelL: horizontal, heelR: horizontal, occiput: horizontal } as const;

describe("supine multi-region anatomical contact", () => {
  it("does not let a touching face certify a floating posterior skull, while retaining head-weighted penetration", () => {
    const faceTouching = rig([{ bone: "head", y: 0.005 }, { bone: "head", y: 0.08, posterior: true }]);
    expect(measureSupineSupportRegions(faceTouching, planes).occiput.contactGapMeters).toBeCloseTo(0.08, 5);
    const posteriorTouching = rig([{ bone: "head", y: 0.08 }, { bone: "head", y: 0.005, posterior: true }]);
    expect(measureSupineSupportRegions(posteriorTouching, planes).occiput.contactGapMeters).toBeCloseTo(0.005, 5);
    const penetratingFace = rig([{ bone: "head", y: -0.04 }, { bone: "head", y: 0.005, posterior: true }]);
    expect(measureSupineSupportRegions(penetratingFace, planes).occiput.minGapMeters).toBeCloseTo(-0.04, 5);
  });

  it("uses the anatomical body under clothing masks and excludes a lower hanging garment", () => {
    const body = rig([{ bone: "spine01", y: 0.2 }]);
    body.name = "mpfb_reference_body";
    const mask = body.material as MeshBasicMaterial;
    mask.opacity = 0; mask.alphaTest = 0.5;
    const garment = rig([{ bone: "spine01", y: 0 }]);
    garment.name = "clinical_gown";
    const root = new Group(); root.add(body, garment);
    const metric = measureSupineSupportRegions(root, planes).thorax;
    expect(metric.samples).toBe(12);
    expect(metric.contactGapMeters).toBeCloseTo(0.2, 5);
  });

  it("reads the deformed skinned surface rather than bind positions", () => {
    const mesh = rig([{ bone: "spine01", y: 0.01 }]);
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
      { bone: "spine03", y: 0.14 },
      { bone: "spine01", y: 0.18 },
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
    const mesh = rig([{ bone: "spine01", y: 0.01 }]);
    const finite = {
      ...planes,
      thorax: { ...horizontal, contains: () => false },
    };
    expect(measureSupineSupportRegions(mesh, finite).thorax.samples).toBe(0);
  });
});

async function shippedBody(asset = "mpfb-gown-adult-patient.glb"): Promise<Group> {
  const bytes = readFileSync(new URL(`../../../../apps/ui-xr/public/generated-humanoids/${asset}`, import.meta.url));
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const binLength = bytes.readUInt32LE(20 + jsonLength);
  json.buffers[0].uri = `data:application/octet-stream;base64,${bytes.subarray(28 + jsonLength, 28 + jsonLength + binLength).toString("base64")}`;
  // Textures are irrelevant to skinning/contact; retain opacity and alpha masks exactly.
  for (const material of json.materials) {
    delete material.normalTexture; delete material.occlusionTexture; delete material.emissiveTexture;
    delete material.pbrMetallicRoughness?.baseColorTexture;
    delete material.pbrMetallicRoughness?.metallicRoughnessTexture;
  }
  json.images = []; json.textures = [];
  const platform = globalThis as unknown as { ProgressEvent?: typeof Event };
  if (!platform.ProgressEvent) platform.ProgressEvent = class extends Event {};
  return (await new GLTFLoader().parseAsync(JSON.stringify(json), "")).scene;
}

function expectContact(root: Group, bed: Group): void {
  const metrics = measureSupineSupportRegions(root, makeSupineSupportPlanes(bed, 0.55));
  for (const region of ["pelvis", "lumbar", "thorax", "heelL", "heelR", "occiput"] as const) {
    const row = metrics[region];
    expect(row.samples, `${region} coverage`).toBeGreaterThanOrEqual(4);
    expect(row.contactGapMeters, `${region} float`).not.toBeNull();
    expect(row.contactGapMeters!, `${region} float`).toBeLessThanOrEqual(0.025);
    expect(row.minGapMeters!, `${region} penetration`).toBeGreaterThanOrEqual(-0.02);
  }
}

describe("shipped supine body rests on both articulated mattress sections", () => {
  it("preserves the bedless policy and refuses one missing arm without keeping its new finger curl", async () => {
    const bedless = await shippedBody();
    const untouched = bedless.getObjectByName("finger2-2R")!;
    const native = untouched.quaternion.clone().normalize();
    applyAndPlantSupineOnDeck(bedless, { deckTopWorldY: 0.55, deckCenter: { x: 0, z: 0 } });
    expect(bedless.userData.openClinXrSupineHandCandidate).toBeUndefined();
    expect(untouched.quaternion.clone().normalize().angleTo(native)).toBeLessThan(1e-7);
    const root = await shippedBody();
    root.getObjectByName("lowerarm01R")!.name = "missing_canonical_forearm";
    const finger = root.getObjectByName("finger2-2R")!;
    const original = finger.quaternion.clone().normalize();
    const bed = buildPatientStretcher({ slotId: "refusal", position: { x: 0, y: 0, z: 0 }, trimColor: 0, inclineDegrees: 30 });
    const parent = new Group(); parent.scale.setScalar(0.82); parent.add(root);
    applyAndPlantSupineOnDeck(root, { stretcher: bed, deckTopWorldY: 0.55, deckCenter: { x: 0, z: 0 } });
    const right = (root.userData.openClinXrSupineHandCandidate as Array<{ side: string; unresolved: string | null }>).find((row) => row.side === "R")!;
    expect(right.unresolved).toBe("missing real chain or anatomical hand surface");
    expect(finger.quaternion.clone().normalize().angleTo(original), "refused right hand restores native caller fingers").toBeLessThan(1e-7);
    applySupinePoseHoldingIncline(root);
    expect(finger.quaternion.clone().normalize().angleTo(original)).toBeLessThan(1e-7);
  }, 30_000);
  it("moves actual child wrists outboard while retaining body support", async () => {
    const root = await shippedBody("mpfb-peds-patient-child.glb");
    const parent = new Group(); parent.scale.setScalar(0.82); parent.add(root); parent.updateMatrixWorld(true);
    const bed = buildPatientStretcher({ slotId: "patient", position: { x: 0, y: 0, z: 0 }, trimColor: 0, inclineDegrees: 0 });
    const garments: Array<{ mesh: Mesh; visible: boolean }> = [];
    root.traverse((object) => { const mesh = object as Mesh; if (mesh.isMesh && /garment|shirt|pants|gown|trouser/iu.test(mesh.name)) { garments.push({ mesh, visible: mesh.visible }); mesh.visible = false; } });
    applyAndPlantSupineOnDeck(root, { stretcher: bed, deckTopWorldY: 0.55, deckCenter: { x: 0, z: 0 } });
    const baselineWrists = ["wristL", "wristR"].map((name) => root.getObjectByName(name)!.getWorldPosition(new Vector3()));
    for (const garment of garments) garment.mesh.visible = garment.visible;
    applyAndPlantSupineOnDeck(root, { stretcher: bed, deckTopWorldY: 0.55, deckCenter: { x: 0, z: 0 } });
    for (let side = 0; side < 2; side += 1) {
      const wrist = root.getObjectByName(side === 0 ? "wristL" : "wristR")!.getWorldPosition(new Vector3());
      expect(Math.abs(wrist.z), "actual child wrist moves outboard from no-garment supported B").toBeGreaterThan(Math.abs(baselineWrists[side]!.z) + 1e-6);
    }
    expectContact(root, bed);
  }, 30_000);

  it("retains accepted supported B when optional garment clearance is unreachable", async () => {
    const root = await shippedBody("mpfb-peds-patient-child.glb");
    const parent = new Group(); parent.scale.setScalar(0.82); parent.add(root); parent.updateMatrixWorld(true);
    const bed = buildPatientStretcher({ slotId: "patient", position: { x: 0, y: 0, z: 0 }, trimColor: 0, inclineDegrees: 0 });
    const garments: Array<{ mesh: Mesh; visible: boolean }> = [];
    root.traverse((object) => { const mesh = object as Mesh; if (mesh.isMesh && /garment|shirt|pants|gown|trouser/iu.test(mesh.name)) { garments.push({ mesh, visible: mesh.visible }); mesh.visible = false; } });
    applyAndPlantSupineOnDeck(root, { stretcher: bed, deckTopWorldY: 0.55, deckCenter: { x: 0, z: 0 } });
    const saved = root.userData.openClinXrSupineArmFlexBones as Array<{ name: string; quaternion: { x: number; y: number; z: number; w: number } }>;
    const accepted = new Map(saved.map((row) => [row.name, new Quaternion(row.quaternion.x, row.quaternion.y, row.quaternion.z, row.quaternion.w)]));
    const impossibleCloth = new Mesh(new BoxGeometry(10, 10, 10), new MeshBasicMaterial());
    impossibleCloth.name = "diagnostic_trousers";
    root.add(impossibleCloth);
    for (const garment of garments) garment.mesh.visible = garment.visible;
    applyAndPlantSupineOnDeck(root, { stretcher: bed, deckTopWorldY: 0.55, deckCenter: { x: 0, z: 0 } });
    for (const candidate of root.userData.openClinXrSupineHandCandidate) {
      expect(candidate.accepted).toBe(true);
      expect(candidate.garmentLane.status).toBe("infeasible-retained-contact");
      expect(candidate.garmentLane.refusal).toBeTruthy();
      expect(candidate.hand.minGap).toBeGreaterThanOrEqual(0);
      expect(candidate.forearm.minGap).toBeGreaterThanOrEqual(0);
    }
    applySupinePoseHoldingIncline(root);
    for (const [name, quat] of accepted) expect(root.getObjectByName(name)!.quaternion.clone().normalize().angleTo(quat.clone().normalize()), `${name} optional refusal keeps accepted B`).toBeLessThan(1e-6);
    expectContact(root, bed);
  }, 30_000);

  it.each([
    ["mpfb-gown-adult-patient.glb", 30, 0],
    ["mpfb-peds-patient-child.glb", 0, 0],
    ["mpfb-gown-adult-patient.glb", 15, Math.PI / 2],
  ])("keeps %s supported at %s degrees / bed yaw %s after public pose and hold", async (asset, inclineDegrees, yaw) => {
    const root = await shippedBody(asset);
    const bed = buildPatientStretcher({ slotId: "patient", position: { x: 0, y: 0, z: 0 }, trimColor: 0, inclineDegrees });
    bed.rotation.y = yaw;
    const parent = new (await import("three")).Group(); parent.rotation.y = -0.26; parent.scale.setScalar(0.82); parent.add(root); parent.updateMatrixWorld(true);
    const pips = ["finger2-2L", "finger2-2R"].map((name) => root.getObjectByName(name)!);
    const nativePips = pips.map((bone) => bone.quaternion.clone().normalize());
    applyAndPlantSupineOnDeck(root, { stretcher: bed, deckTopWorldY: 0.55, deckCenter: { x: 0, z: 0 } });
    for (let i = 0; i < pips.length; i += 1) expect(pips[i]!.quaternion.clone().normalize().angleTo(nativePips[i]!), `${pips[i]!.name} public plant selected soft curl`).toBeCloseTo(0.4, 5);
    const candidates = root.userData.openClinXrSupineHandCandidate as Array<{ side: string; accepted: boolean; unresolved: string | null; hand: { samples: number; outside: number; minGap: number; contactGap: number }; forearm: { samples: number; outside: number; minGap: number; contactGap: number }; garmentLane: { status: string; before: { separation: number }; after: { separation: number; shift: number } } }>;
    expect(candidates.map((row) => row.side).sort()).toEqual(["L", "R"]);
    for (const row of candidates) {
      expect(row.accepted, `${row.side} production candidate`).toBe(true);
      expect(row.unresolved).toBeNull();
      if (asset === "mpfb-peds-patient-child.glb") {
        expect(row.garmentLane.status, "child normal plant clears projected pants lane").toBe("improved");
        expect(row.garmentLane.before.separation).toBeLessThan(0);
        expect(row.garmentLane.after.separation).toBeGreaterThan(0);
        expect(row.garmentLane.after.shift).toBe(0);
      }
      for (const patch of [row.hand, row.forearm]) {
        expect(patch.samples).toBeGreaterThanOrEqual(4);
        expect(patch.outside).toBe(0);
        expect(patch.minGap).toBeGreaterThanOrEqual(0);
        expect(patch.contactGap).toBeLessThanOrEqual(0.025);
      }
    }
    const owned = ["upperarm01L", "lowerarm01L", "wristL", "finger2-2L", "upperarm01R", "lowerarm01R", "wristR", "finger2-2R"].map((name) => root.getObjectByName(name)!);
    const accepted = owned.map((bone) => bone.quaternion.clone().normalize());
    const overwrite = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1.1).toArray();
    const mixer = new AnimationMixer(root);
    mixer.clipAction(new AnimationClip("real arm wrist finger overwrite", 1, owned.map((bone) => new QuaternionKeyframeTrack(`${bone.name}.quaternion`, [0, 1], [...overwrite, ...overwrite])))).play();
    expectContact(root, bed);
    expect(root.userData.openClinXrSupineArticulatedSupportResolved).toBe(true);
    const base = { ...root.position, scaleX: root.scale.x, scaleY: root.scale.y, scaleZ: root.scale.z };
    for (let frame = 0; frame < 120; frame += 1) {
      mixer.update(1 / 60);
      if (frame === 0) expect(owned[2]!.quaternion.clone().normalize().angleTo(accepted[2]!), "real mixer actually overwrites wrist").toBeGreaterThan(0.1);
      applySupinePoseHoldingIncline(root);
      holdSupinePlantFrame(root, base, Math.sin(frame * 0.1));
      reapplySupineHeadToStoredPillow(root);
      expectContact(root, bed);
      for (let i = 0; i < owned.length; i += 1) expect(owned[i]!.quaternion.clone().normalize().angleTo(accepted[i]!), `${owned[i]!.name} survives real mixer + hold`).toBeLessThan(1e-7);
    }
    mixer.stopAllAction();
    expectContact(root, bed);
    const metrics = measureSupineSupportRegions(root, makeSupineSupportPlanes(bed, 0.55));
    const occiput = metrics.occiput.contactPoint!;
    const pillow = bed.getObjectByName(`${bed.name}.pillow`)!;
    const patch = pillow.worldToLocal(new Vector3(occiput.x, occiput.y, occiput.z));
    expect(Math.abs(patch.x), "occiput lies over pillow footprint").toBeLessThanOrEqual(0.14);
    expect(Math.abs(patch.z), "occiput lies over pillow footprint").toBeLessThanOrEqual(0.21);
    expect(patch.y - 0.04, "occiput pillow-top gap").toBeLessThanOrEqual(0.025);
    expect(patch.y - 0.04, "occiput pillow penetration").toBeGreaterThanOrEqual(-0.02);
    // Simulate absolute animation writes to the solved spine/leg bones, then run the public hold.
    const bones = ["spine03", "upperleg01L", "lowerleg01R"].map((name) => root.getObjectByName(name)!);
    const solved = bones.map((bone) => bone.quaternion.clone());
    for (const bone of bones) bone.rotation.set(0, 0, 0);
    applySupinePoseHoldingIncline(root);
    for (let i = 0; i < bones.length; i += 1) expect(bones[i]!.quaternion.angleTo(solved[i]!)).toBeLessThan(1e-7);
    expectContact(root, bed);
    const original = root.position.clone();
    applyAndPlantSupineOnDeck(root, { stretcher: bed, deckTopWorldY: 0.55, deckCenter: { x: 0, z: 0 } });
    expect(root.position.distanceTo(original), "repeat plant stays stable").toBeLessThan(0.001);
    for (let i = 0; i < owned.length; i += 1) expect(owned[i]!.quaternion.clone().normalize().angleTo(accepted[i]!), `${owned[i]!.name} repeated public plant quaternion`).toBeLessThan(1e-6);
    expectContact(root, bed);
  }, 30_000);
});
