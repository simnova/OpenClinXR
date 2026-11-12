/**
 * H6: the post-stage neckline skin follows the runtime viseme drive (phys-neck-h6).
 *
 * Same driver contract as h4/h5 (imported, not reimplemented):
 * `applyDialogueVisemeTimelineToRoot` from ./viseme-runtime-wire.js traverses
 * every mesh with a morph dictionary, so a material-name-resolving driver that
 * skipped the new primitives would leave their influences at 0 and fail.
 *
 * SHIPPED GLB under test (apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb):
 * upper prim1 197 tris -> new prim 8, upper.001 prim4 14 -> new prim 9,
 * lower.001 prim5 3 -> new prim 10, orphan prim7 7 -> new prim 11; all four
 * carry the body SKIN material with full JOINTS_0/WEIGHTS_0 + 47 targets.
 * The nurse is NOT covered here (it is not landing on this card).
 * Every new prim incl. orphan- and lower-moved prims is asserted (h6 g4).
 *
 * Headless GLB load idiom (embedded buffer, textures stripped, ProgressEvent
 * polyfill) follows a-glb-face-hides-the-placeholder-face-cues.test.ts in
 * @openclinxr/xr-asset-loading.
 *
 * NOT TESTED: GPU-side vertex displacement (no WebGL headless); equality of
 * influences + dictionaries + morphAttributes + bind pose is the CPU-visible
 * proof of identical motion. Post-fix captures.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Group, SkinnedMesh } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import { applyDialogueVisemeTimelineToRoot } from "./viseme-runtime.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/* Shipped bytes (installed by the neck card; no .openclinxr stage path is read). */
const SHIPPED_PHYSICIAN_GLB = path.resolve(
  HERE,
  "../../../../apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb",
);

type Body = {
  key: string;
  glb: string;
  skinPrefix: string;
  /** Sorted moved-tri counts, one per new skin primitive (from the h6 report newPrimitives). */
  movedCounts: number[];
};

/* Moved counts from h6/out/physician-report.json newPrimitives; the shipped
 * physician bytes are the committed-tool output (8c3ab05c), byte-identical
 * to h6/out/mpfb-clinical-physician-adult.glb. Nurse dropped: not landing. */
const BODIES: Body[] = [
  {
    key: "physician",
    glb: SHIPPED_PHYSICIAN_GLB,
    skinPrefix: "mpfb_skin_ward_delirium_senior_resident_adult",
    movedCounts: [3, 7, 14, 197],
  },
];

async function loadPostStage(glbPath: string): Promise<Group> {
  const bytes = readFileSync(glbPath);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
  const binLength = bytes.readUInt32LE(20 + jsonLength);
  json.buffers[0].uri = `data:application/octet-stream;base64,${bytes.subarray(28 + jsonLength, 28 + jsonLength + binLength).toString("base64")}`;
  for (const material of json.materials ?? []) {
    delete material.normalTexture;
    delete material.occlusionTexture;
    delete material.emissiveTexture;
    delete material.pbrMetallicRoughness?.baseColorTexture;
    delete material.pbrMetallicRoughness?.metallicRoughnessTexture;
  }
  json.images = [];
  json.textures = [];
  const platform = globalThis as unknown as { ProgressEvent?: typeof Event };
  if (!platform.ProgressEvent) platform.ProgressEvent = class extends Event {};
  return (await new GLTFLoader().parseAsync(JSON.stringify(json), "")).scene;
}

function skinMeshesOf(scene: Group, skinPrefix: string): SkinnedMesh[] {
  const out: SkinnedMesh[] = [];
  scene.traverse((object) => {
    if (!(object instanceof SkinnedMesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.some((m) => m?.name.startsWith(skinPrefix))) out.push(object);
  });
  return out;
}

function hiddenMeshesOf(scene: Group): SkinnedMesh[] {
  const out: SkinnedMesh[] = [];
  scene.traverse((object) => {
    if (!(object instanceof SkinnedMesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    // Every openclinxr_hidden_* prim is a possible donor: upper prims,
    // lower prims (h6 waistband moves), AND the orphan prim.
    if (materials.some((m) => m?.name.startsWith("openclinxr_hidden"))) out.push(object);
  });
  return out;
}

describe("post-stage neckline primitives follow the runtime viseme drive", () => {
  for (const body of BODIES) {
    it(`drives the new skin primitives through applyDialogueVisemeTimelineToRoot (${body.key})`, async () => {
      const scene = await loadPostStage(body.glb);
      const skins = skinMeshesOf(scene, body.skinPrefix);
      // Post-stage output has 1 body skin mesh plus one moved-triangle
      // primitive per affected hidden prim (report newPrimitives).
      expect(skins.length).toBe(1 + body.movedCounts.length);
      const byIndexCount = [...skins].sort(
        (a, b) => (b.geometry.index?.count ?? 0) - (a.geometry.index?.count ?? 0),
      );
      const [bodySkin, ...moved] = byIndexCount as [SkinnedMesh, ...SkinnedMesh[]];
      // EVERY new prim is asserted, incl. orphan- and lower-moved prims.
      expect(moved.length).toBe(body.movedCounts.length);
      const movedCounts = moved.map((m) => (m.geometry.index?.count ?? 0) / 3).sort((a, b) => a - b);
      expect(movedCounts).toEqual(body.movedCounts);
      for (const mesh of moved) {
        expect(mesh.geometry.index!.count).toBeLessThan(bodySkin.geometry.index!.count);
      }

      const result = applyDialogueVisemeTimelineToRoot(scene, {
        phonemeSequence: ["AA"],
        progress: 0.5,
      });
      // The driver touched morph meshes (appliedMeshCount counts every mesh it
      // wrote through lipVisemeWeights); zero would mean a material-name filter.
      expect(result.appliedMeshCount).toBeGreaterThan(0);
      expect(result.activeTargetName?.toLowerCase().startsWith("viseme_")).toBe(true);

      for (const mesh of moved) {
        // Same dictionary: GLTFLoader builds both from the shared mesh.extras
        // targetNames (47 entries on the body mesh).
        expect(mesh.morphTargetDictionary).toEqual(bodySkin.morphTargetDictionary);
        // Same drive: lipVisemeWeights gain keys off mesh names containing
        // "teeth"; neither body mesh does, so equal weights must land equally.
        // A driver that skipped the new primitive leaves its influences at 0:
        // that divergence is the A3 RED.
        expect(mesh.morphTargetInfluences).toEqual(bodySkin.morphTargetInfluences);
        const influences = mesh.morphTargetInfluences;
        if (influences === undefined) throw new Error("moved prim missing morphTargetInfluences");
        expect(influences.some((v) => v !== 0)).toBe(true);
        // Same morph topology, so equal influences displace shared vertices
        // identically on the GPU.
        expect(Object.keys(mesh.geometry.morphAttributes)).toEqual(
          Object.keys(bodySkin.geometry.morphAttributes),
        );
        // Same skeleton binding: identical bone name chains over the reused
        // JOINTS_0/WEIGHTS_0 accessors (index-only change, no bytes altered).
        expect(mesh.skeleton.bones.map((b) => b.name)).toEqual(
          bodySkin.skeleton.bones.map((b) => b.name),
        );
        // Shared position buffer: each new primitive reuses its SOURCE
        // hidden prim's POSITION accessor, so GLTFLoader decodes the identical
        // array — no vertex duplication. The donor must match in length AND in
        // first/last element (h6 has several same-material donors).
        const posAttr = mesh.geometry.attributes["position"];
        if (posAttr === undefined) throw new Error("moved prim missing position attribute");
        const a = posAttr.array as Float32Array;
        const donor = hiddenMeshesOf(scene).find((h) => {
          const dAttr = h.geometry.attributes["position"];
          if (dAttr === undefined) return false;
          const d = dAttr.array as Float32Array;
          return d.length === a.length && d[0] === a[0] && d[d.length - 1] === a[a.length - 1];
        });
        expect(donor).toBeDefined();
      }
    }, 120000);
  }
});
