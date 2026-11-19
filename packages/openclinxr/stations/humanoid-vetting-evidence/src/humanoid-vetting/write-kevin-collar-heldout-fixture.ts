/** Run via pnpm exec tsx <this file> <historical GLB> <kevin-collar evidence dir> <output.fixture.br>. */
import { join } from "node:path";
import { Box3, type Mesh, Vector3 } from "three";
import { loadScene } from "../../../../../../tools/openclinxr/evidence/humanoid-vetting/see-through-pixels.js";
import { fixture, writeFixture } from "./kevin-collar-control-rays.js";
import {
  type Box,
  body,
  type Direction,
  gradeTie,
  type HeldOut,
  type HeldOutFixture,
  heldCamera,
  heldSize,
  hitClass,
  isForwardShirt,
  openingHit,
  pixels,
  posed,
  rayHits,
  readJson,
  shirtFailure,
  tri,
} from "./kevin-collar-probes.js";

const [path, store, output, ...extra] = process.argv.slice(2);
if (!path || !store || !output || extra.length) {
  throw new Error("Expected the historical GLB, Kevin collar evidence directory, and output Brotli fixture path");
}
const frame = await loadScene(path, "front");
const main = await posed(path, frame);
const s5 = await posed(join(store, "s7a/work/s5-7c9545a7.glb"), frame);
const keepL = await posed(join(store, "s9a/work/cw132-chain-out.glb"), frame);
const selection = readJson<Record<string, number[]>>(join(store, "s9a/work/s9-selected.json"));
const { unionOpen } = readJson<{ unionOpen: string[] }>(join(store, "s7a/v-select-65.json"));
const { allowanceSlots } = fixture<{ allowanceSlots: string[] }>(
  "./the-peds-nurse-kevin-collar-s9-allowance.fixture.json",
);
const census = fixture<{ list: { entries: Direction[] }; censusRows: { label: string; site: number }[] }>(
  "./the-peds-nurse-kevin-collar-s10-heldout-census.fixture.json",
);
const { s5: misses } = readJson<{ s5: { key: string; x: number; y: number; why: string }[] }>(
  join(store, "s9a/work/s9-c1-fails.json"),
);

const center = new Box3().setFromObject(main.model, true).getCenter(new Vector3());
const centroids: Vector3[] = [];
const projectionMesh = main.model.children[0];
if (!projectionMesh) throw new Error("Main has no meshes");
for (const mesh of main.model.children as Mesh[]) {
  if (mesh.userData["meshName"] !== body) continue;
  const index = mesh.geometry.getIndex();
  const position = mesh.geometry.getAttribute("position");
  if (!index) continue;
  for (const face of selection[String(mesh.userData["primIndex"])] ?? []) {
    const point = new Vector3();
    for (let corner = 0; corner < 3; corner++) {
      const i = index.getX(3 * face + corner);
      point.add(new Vector3(position.getX(i), position.getY(i), position.getZ(i)));
    }
    point.set(point.x / 3, point.y / 3, point.z / 3);
    centroids.push(point.applyMatrix4(projectionMesh.matrixWorld));
  }
}
if (centroids.length !== 126 || unionOpen.length !== 132) throw new Error("Unexpected S9 or S7 selection");

const directions: HeldOut[] = [];
for (const direction of census.list.entries) {
  const expected = census.censusRows.find((row) => row.label === direction.label)?.site;
  if (expected === 0) continue;
  const camera = heldCamera(direction, center);
  const projected = centroids.map((point) => point.clone().project(camera)).filter(({ z }) => z >= -1 && z <= 1);
  const xs = projected.map(({ x }) => Math.floor(((1 + x) / 2) * heldSize));
  const ys = projected.map(({ y }) => Math.floor(((1 - y) / 2) * heldSize));
  // S10e projected bounds plus 40 pixels, converted to half-open bounds.
  const box: Box = [
    Math.max(0, Math.min(heldSize, ...xs) - 40),
    Math.max(0, Math.min(heldSize, ...ys) - 40),
    Math.min(heldSize, Math.max(-1, ...xs) + 41),
    Math.min(heldSize, Math.max(-1, ...ys) + 41),
  ];
  const result: HeldOut = {
    ...direction, box, site: 0, shirt: 0, fill: [], exclusions: [],
    keepL: { c1Failures: 0, gradeFailures: 0 },
  };
  const exclusions = new Map<string, HeldOut["exclusions"][number]>();
  main.camera = s5.camera = keepL.camera = camera;
  for (const px of pixels(box, 4)) {
    const first = rayHits(main.model, camera, px, heldSize).hits[0]?.object;
    if (hitClass(first) === "hidden" && first?.userData["meshName"] === body) {
      result.site++;
      const known = openingHit(s5, px, heldSize);
      if (openingHit(keepL, px, heldSize).failure) result.keepL.c1Failures++;
      if (known.failure) continue;
      const pixel = px[1] * heldSize + px[0];
      const owner = tri(known.hit);
      result.fill.push(pixel);
      const rule = allowanceSlots.includes(owner) ? "a" : unionOpen.includes(owner) ? null : "b";
      if (rule) {
        let group = exclusions.get(owner);
        if (!group) {
          group = { tri: owner, rule, pixels: [] };
          exclusions.set(owner, group);
        }
        group.pixels.push(pixel);
      }
    } else if (isForwardShirt(main, px, heldSize)) {
      result.shirt++;
      if (shirtFailure(keepL, px, heldSize, gradeTie)) result.keepL.gradeFailures++;
    }
  }
  if (result.site !== expected) throw new Error(`${direction.label}: main census ${result.site} != ${expected}`);
  result.exclusions = [...exclusions.values()];
  directions.push(result);
}
const held: HeldOutFixture = {
  center: center.toArray(),
  rim: misses.filter((miss) => !miss.why.startsWith("cls=hidden")).map(({ key, x, y }) => `${key}@${x},${y}`),
  directions,
};
// Delta-encode in scan order and retain the source S5 exclusion owners.
const deltas = (ids: number[]) => ids.map((id, i) => id - (ids[i - 1] ?? 0));
const owners = new Set<string>();
for (const direction of directions) {
  direction.fill = deltas(direction.fill);
  for (const exclusion of direction.exclusions) {
    owners.add(exclusion.tri);
    exclusion.pixels = deltas(exclusion.pixels);
  }
}
writeFixture(output, Buffer.from(JSON.stringify(held)), [...owners]);
