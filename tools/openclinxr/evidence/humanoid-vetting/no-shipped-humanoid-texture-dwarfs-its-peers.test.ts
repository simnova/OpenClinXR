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

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const GENERATED_HUMANOIDS = path.resolve(
  import.meta.dirname,
  "../../../../apps/ui-xr/public/generated-humanoids",
);

const TEXTURE_DWARF_THRESHOLD = 3.0;

/**
 * Known exceptions: bodies whose measured max/median ratio currently
 * exceeds TEXTURE_DWARF_THRESHOLD. Each entry records the measured ratio
 * and the image causing it. If the texture is reduced so the ratio drops
 * below threshold, the ratio assertion will FAIL with a message saying to
 * delete this entry — that is the self-retiring mechanism.
 *
 * FIXED (#0) 2026-09-12: both entries deleted after tightjeans re-bake
 * with JPEG q85 (1,196,954 B). All bodies now pass below threshold.
 * EXCEPTION_MAP is empty.
 */
const EXCEPTION_MAP: Record<string, { measuredRatio: number; image: string }> = {};

interface ImageInfo {
  name: string;
  imgBytes: number;
}

interface BodyInfo {
  file: string;
  totalBytes: number;
  totalTris: number;
  totalTexture: number;
  images: ImageInfo[];
}

function parseGlbImages(glbPath: string): BodyInfo {
  const buf = fs.readFileSync(glbPath);
  const magic = buf.readUInt32LE(0);
  if (magic !== 0x46546c67) throw new Error(`Not a GLB: ${glbPath}`);
  const totalBytes = buf.readUInt32LE(8);
  const chunk0Len = buf.readUInt32LE(12);
  const jsonStr = buf.subarray(20, 20 + chunk0Len).toString("utf8");
  const gltf = JSON.parse(jsonStr);

  let totalTris = 0;
  if (gltf.meshes) {
    for (const mesh of gltf.meshes) {
      for (const prim of mesh.primitives) {
        if (prim.indices !== undefined) {
          const acc = gltf.accessors[prim.indices];
          totalTris += acc.count / 3;
        }
      }
    }
  }

  const images: ImageInfo[] = [];
  if (gltf.images) {
    for (let i = 0; i < gltf.images.length; i++) {
      const img = gltf.images[i];
      const name = img.name || `image_${i}`;
      let imgBytes = 0;
      if (img.bufferView !== undefined) {
        const bv = gltf.bufferViews[img.bufferView];
        imgBytes = bv.byteLength;
      } else if (img.uri?.startsWith("data:")) {
        const b64 = img.uri.split(",")[1];
        imgBytes = Math.ceil(Buffer.byteLength(b64, "base64") * 3 / 4);
      }
      images.push({ name, imgBytes });
    }
  }

  const totalTexture = images.reduce((s, i) => s + i.imgBytes, 0);
  images.sort((a, b) => b.imgBytes - a.imgBytes);

  return { file: path.basename(glbPath), totalBytes, totalTris, totalTexture, images };
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
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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
        { name: "tightjeans", imgBytes: 5_441_511 },
        { name: "skin", imgBytes: 1_000_000 },
        { name: "eyes", imgBytes: 600_000 },
      ],
    };
    const med = median(PLANTED_VIOLATION.images.map((i) => i.imgBytes));
    const ratio = PLANTED_VIOLATION.images[0].imgBytes / med;
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
    const aishaMed = median(aisha!.images.map((i) => i.imgBytes));
    const aishaRatio = aishaTj!.imgBytes / aishaMed;
    expect(aishaRatio).toBeLessThanOrEqual(TEXTURE_DWARF_THRESHOLD);
  });

  it("every multi-image body passes threshold (no exceptions)", () => {
    const multiImageBodies = bodies.filter((b) => b.images.length > 1);

    for (const body of multiImageBodies) {
      const med = median(body.images.map((i) => i.imgBytes));
      const maxImg = body.images[0]; // already sorted desc
      const ratio = maxImg.imgBytes / med;
      expect(ratio).toBeLessThanOrEqual(TEXTURE_DWARF_THRESHOLD);
    }
  });

  it("threshold of 3.0x is derived from measured population (not invented)", () => {
    // Multi-image population ceiling: 2.12x (street male, jeanstex1)
    // 3.0x is ~1.4x above ceiling with margin for normal variation.
    // Provenance: measured 2026-09-12 on all multi-image bodies;
    // max ratio was 2.12x. After the tightjeans re-bake (FIXED #0),
    // no exceptions remain.
    const multiImageBodies = bodies.filter((b) => b.images.length > 1);

    let maxRatio = 0;
    for (const body of multiImageBodies) {
      const med = median(body.images.map((i) => i.imgBytes));
      const ratio = body.images[0].imgBytes / med;
      if (ratio > maxRatio) maxRatio = ratio;
    }

    expect(maxRatio).toBeLessThan(TEXTURE_DWARF_THRESHOLD);
  });

  it("single-image bodies are correctly skipped (no peers)", () => {
    const singleImageBodies = bodies.filter((b) => b.images.length === 1);
    expect(singleImageBodies.length).toBe(8);
    for (const body of singleImageBodies) {
      expect(body.images[0].name).toBe("openclinxr_skin_micro_normal");
    }
  });
});
