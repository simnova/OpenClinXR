/**
 * No shipped garment texture dwarfs its body's other images (gate).
 *
 * FIXED (#0) — tightjeans re-bake 2026-09-12: both aisha bodies re-baked
 * through the materializer bake path with --texture-overrides mapping
 * "tightjeans" to the graded JPEG q85 (1,196,954 B). Post-bake max/median:
 * mpfb-ob-patient-aisha 1.63x, mpfb-peds-parent-aisha 1.63x — both below
 * 3.0x threshold. EXCEPTION_MAP entries deleted.
 *
 * Diagnosis (measured 2026-09-12, GLB JSON chunks, 17 bodies in
 * apps/ui-xr/public/generated-humanoids/):
 *
 * The punkduck mhclo tightjeans now ships a 1,196,954-byte (JPEG q85)
 * diffuse on two aisha bodies where it is 21.2–21.4% of total texture
 * and 1.63x the body's median image. The next-largest garment diffuse
 * in the fleet is jeanstex1 at 1,589,579 bytes (26–30% of body).
 * Per-body max/median for the full population tops out at 2.12x
 * (street male, jeanstex1).
 *
 * Gate: for each multi-image body, no single image exceeds
 * TEXTURE_DWARF_THRESHOLD (3.0x) times the body's median image size.
 * 3.0x is derived from the measured population ceiling of 2.12x rounded
 * with margin; it passes all bodies after the tightjeans re-bake.
 * 2026-11-06 (st-vitbody3 r4c): the median excludes images referenced only
 * by OPENCLINXR_skin_shade because its curvature/cavity and tiled pore-normal
 * data maps are not peer garment images; the max still covers every image,
 * and TEXTURE_DWARF_THRESHOLD itself remains unchanged at 3.0x.
 *
 * Proof the gate still bites: the test plants a violation by temporarily
 * restoring the old 5.44 MB texture size in the scan (via
 * PLANTED_VIOLATION) and asserts the gate FAILS; then verifies the
 * actual shipped bytes PASS.
 *
 * Factory step: clothing_consume.
 * Counterweight: no geometry changes; tightjeans remains CC BY 3.0; gate
 * asserts a budget ratio, not a garment choice.
 */

import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { describe, expect, it } from "vitest";

const GENERATED_HUMANOIDS = path.join(repoRoot(), "apps/ui-xr/public/generated-humanoids");

const TEXTURE_DWARF_THRESHOLD = 3.0;

/**
 * Known exceptions: bodies whose measured max/median ratio currently
 * exceeds TEXTURE_DWARF_THRESHOLD. Each entry records the measured ratio
 * and the image causing it. If the texture is reduced so the ratio drops
 * below threshold, the ratio assertion will FAIL with a message saying to
 * delete this entry — that is the self-retiring mechanism.
 *
 * FIXED (#0) 2026-09-12: both entries deleted after tightjeans re-bake
 * with JPEG q85 (1,196,954 B).
 *
 * 2026-11-06 (st-vitbody3): ONE entry, mpfb-ob-patient-aisha.glb. Its
 * 4096 family albedo (9,557,603 B) ships unre-encoded per operator direction
 * 2026-11-06 ~19:55: "realism first, release size constraints, size
 * optimization becomes separate pipeline steps". The size-optimization stage
 * (separate card) retires this entry. measuredRatio is the r4c-rule ratio
 * read off the shipped GLB (main rule before r4c: 13.30). The entry fails if
 * the ratio rises above measuredRatio or drops to the threshold or below.
 */
const EXCEPTION_MAP: Record<string, { measuredRatio: number; image: string }> = {
  "mpfb-ob-patient-aisha.glb": { measuredRatio: 7.984937599941184, image: "family-albedo-4096" },
};

interface ImageInfo {
  name: string;
  imgBytes: number;
  includedInPeerMedian: boolean;
}

interface BodyInfo {
  file: string;
  totalBytes: number;
  totalTris: number;
  totalTexture: number;
  images: ImageInfo[];
}

interface GltfJson {
  accessors?: Array<{ count: number }>;
  bufferViews?: Array<{ byteLength: number }>;
  images?: Array<{ name?: string; bufferView?: number; uri?: string }>;
  materials?: Array<Record<string, unknown>>;
  meshes?: Array<{ primitives: Array<{ indices?: number }> }>;
  textures?: Array<{ source?: number }>;
}

interface TextureReference {
  skinShade: boolean;
}

function textureReferencesByIndex(gltf: GltfJson): Map<number, TextureReference[]> {
  const references = new Map<number, TextureReference[]>();

  function visit(value: unknown, skinShade: boolean): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, skinShade);
      return;
    }
    if (value === null || typeof value !== "object") return;

    const record = value as Record<string, unknown>;
    if (Number.isInteger(record["index"])) {
      const textureIndex = record["index"] as number;
      const existing = references.get(textureIndex) ?? [];
      existing.push({ skinShade });
      references.set(textureIndex, existing);
    }

    for (const [key, child] of Object.entries(record)) {
      visit(child, skinShade || key === "OPENCLINXR_skin_shade");
    }
  }

  for (const material of gltf.materials ?? []) visit(material, false);
  return references;
}

function peerMedianImageIndexes(gltf: GltfJson): Set<number> {
  const textureReferences = textureReferencesByIndex(gltf);
  const imageReferences = new Map<number, TextureReference[]>();

  for (const [textureIndex, references] of textureReferences) {
    const imageIndex = gltf.textures?.[textureIndex]?.source;
    if (imageIndex === undefined) continue;
    imageReferences.set(imageIndex, [...(imageReferences.get(imageIndex) ?? []), ...references]);
  }

  const included = new Set<number>();
  for (let imageIndex = 0; imageIndex < (gltf.images?.length ?? 0); imageIndex++) {
    const references = imageReferences.get(imageIndex);
    // Preserve the prior behavior for unreferenced images.
    if (references === undefined || references.some((reference) => !reference.skinShade)) {
      included.add(imageIndex);
    }
  }
  return included;
}

function bodyInfoFromGltf(gltf: GltfJson, file: string, totalBytes = 0): BodyInfo {
  const peerMedianIndexes = peerMedianImageIndexes(gltf);
  const accessors = gltf.accessors ?? [];
  const bufferViews = gltf.bufferViews ?? [];

  let totalTris = 0;
  if (gltf.meshes) {
    for (const mesh of gltf.meshes) {
      for (const prim of mesh.primitives) {
        if (prim.indices !== undefined) {
          const acc = accessors[prim.indices];
          if (acc === undefined) throw new Error(`missing accessor ${prim.indices}`);
          totalTris += acc.count / 3;
        }
      }
    }
  }

  const images: ImageInfo[] = [];
  if (gltf.images) {
    for (const [i, img] of gltf.images.entries()) {
      const name = img.name || `image_${i}`;
      let imgBytes = 0;
      if (img.bufferView !== undefined) {
        const bv = bufferViews[img.bufferView];
        if (bv === undefined) throw new Error(`missing buffer view ${img.bufferView}`);
        imgBytes = bv.byteLength;
      } else if (img.uri?.startsWith("data:")) {
        const b64 = img.uri.split(",")[1];
        if (b64 === undefined) throw new Error(`missing data payload for ${name}`);
        imgBytes = Math.ceil(Buffer.byteLength(b64, "base64") * 3 / 4);
      }
      images.push({ name, imgBytes, includedInPeerMedian: peerMedianIndexes.has(i) });
    }
  }

  const totalTexture = images.reduce((s, i) => s + i.imgBytes, 0);
  images.sort((a, b) => b.imgBytes - a.imgBytes);

  return { file, totalBytes, totalTris, totalTexture, images };
}

function parseGlbImages(glbPath: string): BodyInfo {
  const buf = fs.readFileSync(glbPath);
  const magic = buf.readUInt32LE(0);
  if (magic !== 0x46546c67) throw new Error(`Not a GLB: ${glbPath}`);
  const totalBytes = buf.readUInt32LE(8);
  const chunk0Len = buf.readUInt32LE(12);
  const jsonStr = buf.subarray(20, 20 + chunk0Len).toString("utf8");
  const gltf = JSON.parse(jsonStr) as GltfJson;
  return bodyInfoFromGltf(gltf, path.basename(glbPath), totalBytes);
}

function getShippedBodies(): BodyInfo[] {
  if (!fs.existsSync(GENERATED_HUMANOIDS)) throw new Error("missing artifact");
  const files = fs.readdirSync(GENERATED_HUMANOIDS)
    .filter((f) => f.endsWith(".glb") && !f.includes("inspect"))
    .sort();
  return files.map((f) => parseGlbImages(path.join(GENERATED_HUMANOIDS, f)));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) {
    const odd = sorted[mid];
    if (odd === undefined) throw new Error("missing median value");
    return odd;
  }
  const lo = sorted[mid - 1];
  const hi = sorted[mid];
  if (lo === undefined || hi === undefined) throw new Error("missing median values");
  return (lo + hi) / 2;
}

function peerMedianBytes(body: BodyInfo): number[] {
  return body.images.filter((image) => image.includedInPeerMedian).map((image) => image.imgBytes);
}

function maxToPeerMedianRatio(body: BodyInfo): number {
  const maxBytes = Math.max(...body.images.map((image) => image.imgBytes));
  return maxBytes / median(peerMedianBytes(body));
}

describe("no shipped garment texture dwarfs its body's other images", () => {
  const bodies = getShippedBodies();

  it("parses all GLBs in generated-humanoids", () => {
    expect(bodies.length).toBeGreaterThanOrEqual(10);
  });

  it("gate bites: planted 5.44 MB violation fails; shipped 1.20 MB passes", () => {
    // FIXED (#0): the original test asserted the shipped 5.44 MB tightjeans
    // exceeded the threshold. After the re-bake, the shipped texture is
    // 1.20 MB and passes. To prove the gate still catches offenders, we
    // plant a fake body with a 5,441,511-byte image and verify the gate
    // refuses it.
    const PLANTED_VIOLATION: BodyInfo = {
      file: "_planted_violation.glb",
      totalBytes: 0,
      totalTris: 0,
      totalTexture: 10_000_000,
      images: [
        { name: "tightjeans", imgBytes: 5_441_511, includedInPeerMedian: true },
        { name: "skin", imgBytes: 1_000_000, includedInPeerMedian: true },
        { name: "eyes", imgBytes: 600_000, includedInPeerMedian: true },
      ],
    };
    const med = median(peerMedianBytes(PLANTED_VIOLATION));
    const plantedTop = PLANTED_VIOLATION.images[0];
    if (plantedTop === undefined) throw new Error("missing planted violation image");
    const ratio = plantedTop.imgBytes / med;
    // The 5.44 MB planted image should fail the gate
    expect(ratio).toBeGreaterThan(TEXTURE_DWARF_THRESHOLD);
    // The actual shipped aisha bodies now PASS
    const aisha = bodies.find((b) => b.file === "mpfb-ob-patient-aisha.glb");
    expect(aisha).toBeDefined();
    // FIXED (#0) 2026-09-12: image name is now "tightjeans-2048-q85" (from
    // the JPEG filename baked through the materializer), not "tightjeans".
    const aishaTj = aisha!.images.find((i) => i.name.toLowerCase().includes("tightjeans"));
    expect(aishaTj).toBeDefined();
    expect(aishaTj!.imgBytes).toBe(1_196_954);
    const aishaMed = median(peerMedianBytes(aisha!));
    const aishaRatio = aishaTj!.imgBytes / aishaMed;
    expect(aishaRatio).toBeLessThanOrEqual(TEXTURE_DWARF_THRESHOLD);
  });

  it("keeps an image shared by base color and skin shade in the peer median", () => {
    // Synthetic byte lengths are illustrative; only reference classification matters.
    const fixture = bodyInfoFromGltf({
      bufferViews: [{ byteLength: 100 }, { byteLength: 300 }, { byteLength: 500 }],
      images: [
        { name: "shared", bufferView: 0 },
        { name: "peer", bufferView: 1 },
        { name: "top", bufferView: 2 },
      ],
      textures: [{ source: 0 }, { source: 1 }, { source: 2 }],
      materials: [{
        pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
        normalTexture: { index: 1 },
        emissiveTexture: { index: 2 },
        extensions: {
          OPENCLINXR_skin_shade: { curvatureTexture: { index: 0 } },
        },
      }],
    }, "_shared_fixture.glb");

    expect(peerMedianBytes(fixture)).toEqual([500, 300, 100]);
    expect(median(peerMedianBytes(fixture))).toBe(300);
  });

  it("keeps skin-shade-only maps in the max counterweight", () => {
    // Synthetic byte lengths are illustrative; only max/median population matters.
    const fixture = bodyInfoFromGltf({
      bufferViews: [
        { byteLength: 100 },
        { byteLength: 200 },
        { byteLength: 300 },
        { byteLength: 1_000 },
      ],
      images: [
        { name: "peer-low", bufferView: 0 },
        { name: "peer-mid", bufferView: 1 },
        { name: "peer-high", bufferView: 2 },
        { name: "skin-shade-only", bufferView: 3 },
      ],
      textures: [{ source: 0 }, { source: 1 }, { source: 2 }, { source: 3 }],
      materials: [{
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicRoughnessTexture: { index: 1 },
        },
        normalTexture: { index: 2 },
        extensions: {
          OPENCLINXR_skin_shade: { detailNormalTexture: { index: 3 } },
        },
      }],
    }, "_counterweight_fixture.glb");

    expect(peerMedianBytes(fixture)).toEqual([300, 200, 100]);
    expect(maxToPeerMedianRatio(fixture)).toBe(5);
    expect(maxToPeerMedianRatio(fixture)).toBeGreaterThan(TEXTURE_DWARF_THRESHOLD);
  });

  it("every multi-image body passes threshold except the one recorded entry", () => {
    const multiImageBodies = bodies.filter((b) => b.images.length > 1);
    // Widening this list is wrong; the size-optimization stage shrinks it to [].
    expect(Object.keys(EXCEPTION_MAP)).toEqual(["mpfb-ob-patient-aisha.glb"]);

    for (const body of multiImageBodies) {
      const ratio = maxToPeerMedianRatio(body);
      const exception = EXCEPTION_MAP[body.file];
      if (exception === undefined) {
        expect(ratio, body.file).toBeLessThanOrEqual(TEXTURE_DWARF_THRESHOLD);
        continue;
      }
      expect(body.images[0]?.name, `${body.file} top image`).toBe(exception.image);
      expect(
        ratio,
        `${body.file} now passes ${TEXTURE_DWARF_THRESHOLD}x: delete its EXCEPTION_MAP entry`,
      ).toBeGreaterThan(TEXTURE_DWARF_THRESHOLD);
      expect(
        ratio,
        `${body.file} grew past its recorded ${exception.measuredRatio}x: shrink the image, do not raise the entry`,
      ).toBeLessThanOrEqual(exception.measuredRatio + 1e-9);
    }
    for (const file of Object.keys(EXCEPTION_MAP)) {
      expect(multiImageBodies.map((b) => b.file), `stale EXCEPTION_MAP entry ${file}`).toContain(file);
    }
  });

  it("threshold of 3.0x is derived from measured population (not invented)", () => {
    // Multi-image population ceiling: 2.12x (street male, jeanstex1)
    // 3.0x is ~1.4x above ceiling with margin for normal variation.
    // Provenance: measured 2026-09-12 on all multi-image bodies;
    // max ratio was 2.12x. After the tightjeans re-bake (FIXED #0),
    // no exceptions remain. 2026-11-06: EXCEPTION_MAP bodies are excluded
    // here; the test above bounds them separately.
    const multiImageBodies = bodies.filter((b) => b.images.length > 1 && !(b.file in EXCEPTION_MAP));

    let maxRatio = 0;
    for (const body of multiImageBodies) {
      const ratio = maxToPeerMedianRatio(body);
      if (ratio > maxRatio) maxRatio = ratio;
    }

    expect(maxRatio).toBeLessThan(TEXTURE_DWARF_THRESHOLD);
  });

  it("single-image bodies are correctly skipped (no peers)", () => {
    const singleImageBodies = bodies.filter((b) => b.images.length === 1);
    expect(singleImageBodies.length).toBe(8);
    for (const body of singleImageBodies) {
      const only = body.images[0];
      if (only === undefined) throw new Error(`missing single image for ${body.file}`);
      expect(only.name).toBe("openclinxr_skin_micro_normal");
    }
  });
});
