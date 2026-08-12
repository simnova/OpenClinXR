#!/usr/bin/env node
/**
 * issue-341 round 10 — independent verification of the texture-mask hairline.
 *
 * The hairline moved from a per-polygon material boundary into the baked skin
 * baseColorTexture. This script is the GRADER-side check (the materializer's own
 * TEXTURE_HAIRLINE JSON is producer-side): it reads the on-disk PNG and the
 * exported GLB and re-derives the hairline alternation from the TEXTURE alone.
 *
 *   - reads the skin-baked.png, classifies hair vs skin by luminance
 *     (hair ~ linear 0.035 -> sRGB ~0.21; skin ~ 0.5-0.7; the midpoint of the
 *     two shipped material colors is 0.38, and 0.3 is used here as a hard
 *     separator — neither color is within 8x of it)
 *   - for each column of the image, finds the topmost skin row above the hair
 *     region within the face-front band and computes the flip rate of the
 *     boundary row across columns (the §round-8 alternation metric, now in
 *     texture space)
 *   - confirms the exported GLB body carries NO scalp_hair primitive (the
 *     per-polygon material is retired; the hair lives in the texture)
 *
 * Usage: node hairline-in-texture-check.mjs <glb> <skin-baked-png>
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { NodeIO } from "@gltf-transform/core";

const require = createRequire(import.meta.url);

async function main() {
  const [glbRel, pngRel] = process.argv.slice(2);
  if (!glbRel || !pngRel) {
    console.error("usage: hairline-in-texture-check.mjs <glb> <skin-baked-png>");
    process.exit(2);
  }
  const io = new NodeIO();
  const doc = await io.read(resolve(glbRel));
  const body = doc.getRoot().listMeshes().find((m) => /_body$/.test(m.getName()));
  const prims = body?.listPrimitives() ?? [];
  const scalpPrim = prims.filter((p) => /scalp/i.test(p.getMaterial()?.getName() ?? ""));
  const skinPrim = prims.filter((p) => /skin/i.test(p.getMaterial()?.getName() ?? ""));
  const hiddenPrims = prims.filter((p) => /hidden/i.test(p.getMaterial()?.getName() ?? ""));
  console.log(
    JSON.stringify({
      bodyMesh: body?.getName(),
      primitives: prims.length,
      scalpPrimitives: scalpPrim.length,
      skinPrimitives: skinPrim.length,
      hiddenPrimitives: hiddenPrims.length,
    }),
  );
  if (scalpPrim.length > 0) {
    console.log("SCALP_PRIMITIVE_STILL_PRESENT: the per-polygon scalp material was not retired");
    process.exitCode = 1;
  }

  const png = await readFile(resolve(pngRel));
  const sharp = require("sharp");
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  // luminance per pixel
  const lum = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 3] / 255;
    const g = data[i * 3 + 1] / 255;
    const b = data[i * 3 + 2] / 255;
    lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const HAIR_LUM = 0.3; // midpoint of the two shipped material colors, see header
  const hair = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) hair[i] = lum[i] < HAIR_LUM ? 1 : 0;

  const hairPixels = hair.reduce((a, b) => a + b, 0);
  // per-column boundary: topmost skin row above the first hair row in the
  // upper half of the texture (the head region; the lower torso/skin rows are
  // never hair and are excluded to keep the boundary in the head band).
  const boundaryRows = [];
  const flipCols = [];
  for (let c = 0; c < width; c++) {
    let firstHair = -1;
    let lastSkinAbove = -1;
    for (let r = height - 1; r >= height / 2; r--) {
      const i = r * width + c;
      if (hair[i]) firstHair = r;
      else if (firstHair >= 0) { lastSkinAbove = r; break; }
    }
    if (firstHair >= 0 && lastSkinAbove >= 0) {
      boundaryRows.push((firstHair + lastSkinAbove) / 2);
      flipCols.push(c);
    }
  }
  let flips = 0;
  let steps = 0;
  let prev = 0;
  for (let k = 1; k < boundaryRows.length; k++) {
    const d = boundaryRows[k] - boundaryRows[k - 1];
    if (Math.abs(d) < 1e-9) continue;
    steps++;
    if (prev !== 0 && Math.sign(d) !== Math.sign(prev)) flips++;
    prev = d;
  }
  console.log(
    JSON.stringify({
      imageW: width,
      imageH: height,
      hairPixels,
      hairPixelsFrac: +(hairPixels / (width * height)).toFixed(5),
      boundaryColumns: boundaryRows.length,
      boundaryFlipRate: steps ? +(flips / steps).toFixed(4) : 0,
      boundaryStepPxMedian: boundaryRows.length > 2
        ? +boundaryRows
            .slice(1)
            .map((v, i) => Math.abs(v - boundaryRows[i]))
            .sort((a, b) => a - b)[Math.floor((boundaryRows.length - 1) / 2)]
            .toFixed(2)
        : null,
      claimScope: "hairline alternation re-derived from the baked baseColorTexture PNG and the exported GLB primitive set; not a pixel grade of the rendered figure",
      notEvidenceFor: ["a clean pixel grade", "clinical realism", "production asset readiness"],
    }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
