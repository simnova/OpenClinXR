import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Group, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import type {
  AttrScene,
  ProbeSubstitution,
} from "../../../../../../tools/openclinxr/evidence/humanoid-vetting/kevin-collar-skin-probe.js";
import {
  loadAttrScene,
  primTriUvAreasTexelsSq,
  probePixel,
} from "../../../../../../tools/openclinxr/evidence/humanoid-vetting/kevin-collar-skin-probe.js";
import { loadScene } from "../../../../../../tools/openclinxr/evidence/humanoid-vetting/see-through-pixels.js";
import {
  applyControlTransform,
  controlCamera,
  historicalControlPath as historical,
  loadControlFixture,
} from "./kevin-collar-control-fixture.js";
import {
  captures,
  fixture,
  readHeldOut,
  readHistoricalFraming,
  readPreFix,
  sides,
  silhouetteEdges,
  views,
} from "./kevin-collar-control-rays.js";
import {
  body,
  gradeTie,
  heldCamera,
  heldSize,
  hitClass,
  isForwardShirt,
  openBoxes,
  openingHit,
  type Pixel,
  paintedFailure,
  pixels,
  posed,
  productTie,
  rayHits,
  root,
  shippedGlb,
  shirtBoxes,
  shirtFailure,
  skin,
  tri,
  uvArea,
  uvFloor,
  type View,
} from "./kevin-collar-probes.js";

type Scene = Awaited<ReturnType<typeof loadScene>>;
type Residual = { site: string; px: Pixel; candTri: string; mainTri: string; class: string };
const timeout = 180_000;
const subjectGlb = process.env["KEVIN_COLLAR_SUBJECT_GLB"] ?? shippedGlb;
// The fixture override exercises the same behavior predicates on a cropped
// subject. The complete moved-primitive UV check still uses the live GLB.
const subject = process.env["KEVIN_COLLAR_SUBJECT_FIXTURE"] ?? subjectGlb;
const store = process.env["KEVIN_COLLAR_STORE_ROOT"] ?? "/Volumes/files/openclinxr-assets/store/st-teeth/kevin-collar";
const keepL = process.env["KEVIN_S9_CW132_GLB"] ?? join(store, "s9a/work/cw132-chain-out.glb");
const dropOne = process.env["KEVIN_S9_CW125_GLB"] ?? join(store, "s9a/work/cw125-chain-out.glb");
const residual = fixture<{ hidden: Residual[]; interior: Residual[] }>(
  "./the-peds-nurse-kevin-collar-s10h1-classify.fixture.json",
);
const allowance = new Set(fixture<{ allowanceSlots: string[] }>("./the-peds-nurse-kevin-collar-s9-allowance.fixture.json").allowanceSlots);
const restoreOpening = "MADR 0065 inverted guard: restore the zero-notch opening against the historical control by densifying selection rays or selecting 8:70 and clearing C2′ at both ties. Widening or deleting this guard is wrong.";
const restoreHeld = "MADR 0065 inverted guard: restore the held-out opening target against the historical control and the S5/CW132 census. Widening or deleting this guard is wrong.";

const controls = new Map<string, ReturnType<typeof loadControlFixture>>();
function subjectCrop(path: string) {
  if (!path.endsWith(".fixture.br")) return undefined;
  if (!controls.has(path)) controls.set(path, loadControlFixture(path));
  return controls.get(path);
}
const frames = new Map<string, Promise<Scene>>();
const attributes = new Map<string, Promise<AttrScene>>();
const historicalFraming = readHistoricalFraming();
const pre = readPreFix();
const held = readHeldOut();
function frame(path: string, view: View) {
  const key = `${path}:${view}`;
  const crop = subjectCrop(path);
  if (crop) return Promise.resolve(crop.scene(view));
  if (!frames.has(key)) frames.set(key, loadScene(path, view));
  return frames.get(key)!;
}

function attr(path: string, view: View) {
  const key = `${path}:${view}`;
  const crop = subjectCrop(path);
  if (crop) return Promise.resolve(crop.scene(view));
  if (!attributes.has(key)) attributes.set(key, loadAttrScene(path, view));
  return attributes.get(key)!;
}

async function posedSubject(path: string) {
  const crop = subjectCrop(path);
  if (!crop) {
    const model = new Group();
    applyControlTransform(model, historicalFraming);
    return posed(path, { model, camera: controlCamera(historicalFraming, "front") });
  }
  const scene = crop.scene("front", crop.posedModel);
  applyControlTransform(scene.model, historicalFraming);
  scene.camera = controlCamera(historicalFraming, "front");
  return scene;
}

function siteKey(site: string, [x, y]: Pixel) {
  return `${site}@${x},${y}`;
}

function firstClass(scene: Scene, px: Pixel) {
  return hitClass(rayHits(scene.model, scene.camera, px).hits[0]?.object);
}

function coverageClass(path: string, view: View, scene: Scene, px: Pixel) {
  const crop = subjectCrop(path);
  if (!crop) return firstClass(scene, px);
  const [x, y] = px;
  const cls = crop.coverage[view]?.get(4096 * y + x);
  if (!cls) throw new Error(`Missing Kevin coverage sample for ${view}@${x},${y}`);
  return cls;
}

function pixelHash(set: Pixel[]) {
  return createHash("sha256").update(JSON.stringify(set)).digest("hex");
}

const sites = async () => {
  const sets = [];
  for (const [site, records] of Object.entries(pre.sites)) {
    for (const capture of captures) {
      const view = sides[capture];
      const scene = await frame(historical, view);
      const record = records[capture];
      const set = [...pixels(record.box, record.stride)].filter((px) => firstClass(scene, px) === "hidden");
      const label = `${site}/${capture}`;
      expect(set.length, `${label} historical hidden census`).toBe(record.hiddenCount);
      if (record.hiddenCount) expect(pixelHash(set), label).toBe(record.hiddenSha256);
      sets.push({ label, view, set });
    }
  }
  return sets;
};
let openingSites: ReturnType<typeof sites> | undefined;
function openingCensus() {
  openingSites ??= sites();
  return openingSites;
}

function checkResidual(observed: string[], recorded: Residual[], count: number) {
  expect(recorded.length, restoreOpening).toBe(count);
  const listed = recorded.map(({ site, px, candTri, mainTri, class: cls }) => {
    expect([allowance.has(mainTri), cls], restoreOpening).toEqual([true, "S9C1"]);
    return `${siteKey(site, px)}=${mainTri}/${candTri}`;
  });
  expect(observed.length, `${restoreOpening} Observed ${observed.length} residual rays, first ${observed.slice(0, 3).join(" | ")}`).toBe(count);
  expect(observed.sort(), restoreOpening).toEqual(listed.sort());
}

async function c1(path: string) {
  const interior: string[] = [];
  const pad: string[] = [];
  for (const { label, view, set } of await openingCensus()) {
    const scene = await attr(path, view);
    const baseline = await attr(historical, view);
    const keys = new Set(set.map((px) => px.join(",")));
    for (const [x, y] of set) {
      const hit = probePixel(scene, x, y);
      const ref = probePixel(baseline, x, y);
      const facing = hit && !(hit.dotWind < 0 && hit.dotShade > 0);
      // The original stride-1 gate carves grazing rays on the same triangle.
      const failure = facing ? "facing" : paintedFailure(hit, scene);
      if (failure === "padding") pad.push(siteKey(label, [x, y]));
      if (!failure || (facing && hit.triKey === ref?.triKey)) continue;
      if (![[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].every((px) => keys.has(px.join(",")))) continue;
      const reference = ref?.cls === "hidden" && hit?.cls === "hidden" ? tri(ref) : "outside";
      interior.push(`${siteKey(label, [x, y])}=${reference}/${tri(hit)}`);
    }
  }
  return { interior, pad };
}

async function scanOpening(path: string) {
  const result = { count: 0, allowed: [] as string[], rim: [] as string[], outside: [] as string[] };
  const baseline = await posedSubject(historical);
  const candidate = await posedSubject(path);
  for (const view of views) {
    baseline.camera = candidate.camera = controlCamera(historicalFraming, view);
    for (const [label, box] of Object.entries(openBoxes[view])) {
      for (const px of pixels(box, 2)) {
        const owner = openingHit(baseline, px).hit;
        if (owner?.cls !== "hidden" || owner.meshName !== body) continue;
        result.count++;
        const { hit, failure } = openingHit(candidate, px);
        if (!failure) continue;

        const key = siteKey(`${view}/${label}`, px);
        if (hit?.cls === "hidden" && hit.meshName === body && allowance.has(tri(owner))) {
          result.allowed.push(key);
        } else if ((failure === "winding" || failure === "normals") && held.rim.includes(key)) {
          result.rim.push(key);
        } else {
          result.outside.push(`${key} ${failure} candidate=${tri(hit)} main=${tri(owner)}`);
        }
      }
    }
  }
  return result;
}

async function shirtLeaks(path: string, sampleViews: readonly View[]) {
  const baseline = await posedSubject(historical);
  const candidate = await posedSubject(path);
  const leaks: string[] = [];
  let count = 0;
  for (const view of sampleViews) {
    baseline.camera = candidate.camera = controlCamera(historicalFraming, view);
    for (const box of shirtBoxes[view]) {
      for (const px of pixels(box, 2)) {
        if (!isForwardShirt(baseline, px, 4096)) continue;
        count++;
        const failure = shirtFailure(candidate, px, 4096, gradeTie);
        if (failure) leaks.push(`${siteKey(view, px)} ${failure}`);
      }
    }
  }
  return { count, leaks };
}

describe("the peds nurse kevin collar and sleeves show no skin notch", () => {
  it("required-behavior: opening, garment coverage and framing", async () => {
    const hidden: string[] = [];
    const wrong: string[] = [];
    for (const { label, view, set } of await openingCensus()) {
      const scene = await attr(subject, view);
      const baseline = await attr(historical, view);
      for (const px of set) {
        const hit = probePixel(scene, ...px);
        if (hit?.cls === "hidden") {
          const ref = probePixel(baseline, ...px);
          hidden.push(`${siteKey(label, px)}=${ref?.cls === "hidden" ? tri(ref) : "outside"}/${tri(hit)}`);
        } else if (!hit || !["skin", "shirt", "pants"].includes(hit.cls)) wrong.push(siteKey(label, px));
      }
    }
    expect(wrong).toEqual([]);
    checkResidual(hidden, residual.hidden, 50);
    for (const capture of captures) {
      const view = sides[capture];
      const baseline = await frame(historical, view);
      const candidate = await frame(subject, view);
      const records = capture === "front" ? pre : pre.threeQuarter;
      for (const kind of ["shirt", "pants"] as const) {
        const record = records[kind];
        const set = [...pixels(record.box, record.stride)].filter((px) => coverageClass(historical, view, baseline, px) === kind);
        expect(set.length, `${view} ${kind} census`).toBe(record.count);
        expect(pixelHash(set)).toBe(record.sha256);
        expect(set.find((px) => coverageClass(subject, view, candidate, px) !== kind), `${view} ${kind} stays covered`).toBeUndefined();
      }
      for (const [edge, inner, outer] of silhouetteEdges(pre.silhouette[capture])) {
        const hit = (px: Pixel) => coverageClass(subject, view, candidate, px) !== "miss";
        expect([...pixels(edge, 2), ...pixels(inner, 2)].some(hit), `${view} reaches edge ${edge}`).toBe(true);
        expect([...pixels(outer, 2)].some(hit), `${view} stays inside outer edge ${outer}`).toBe(false);
      }
    }
  }, timeout);

  it("C1 NOT PADDING: pre-fix hidden rays resolve to painted, front-facing skin", async () => {
    const { interior, pad } = await c1(subject);
    expect(pad.length, `C1 padding rays: ${pad.slice(0, 5).join(" | ")}`).toBe(0);
    checkResidual(interior, residual.interior, 9);
  }, timeout);

  it("C1 CI negative control: the historical fixture fails the same opening predicate", async () => {
    const { interior } = await c1(historical);
    expect(interior.filter((ray) => ray.includes("=outside/") || !allowance.has(ray.split("=")[1]?.split("/")[0] ?? "")).length).toBeGreaterThan(0);
    expect(interior.length, "The historical control must exceed the exact nine C1 residual rays").toBeGreaterThan(9);
  }, timeout);

  it("C1 counterweights reject flipped winding, black material and negated normals", async () => {
    const clean = await attr(shippedGlb, "front");
    const prims = new Set(clean.prims.filter((p) => p.meshName === body && p.primIndex >= 8).map((p) => p.primIndex));
    expect(prims.size, "shipped control carries moved skin geometry").toBeGreaterThan(0);
    const substitutions: [ProbeSubstitution, string][] = [
      [{ kind: "flipWinding", prims }, "winding"],
      [{ kind: "remapMaterial", prims, matName: "openclinxr_fitted_hair_mhair02_mpfb_peds_nurse_kevin_mat", matIndex: 1, alphaMode: "OPAQUE" }, "material"],
      [{ kind: "negateNormals", prims }, "normals"],
    ];
    const set = (await openingCensus()).find(({ label }) => label === "vneck/front")!.set;
    const witnesses = set.filter((px) => {
      const hit = probePixel(clean, ...px);
      return hit && prims.has(hit.primIndex) && !paintedFailure(hit, clean);
    });
    expect(witnesses.length).toBeGreaterThan(0);
    for (const [substitution, failure] of substitutions) {
      const plant = await loadAttrScene(shippedGlb, "front", { substitutions: [substitution] });
      const observed = witnesses.map((px) => paintedFailure(probePixel(plant, ...px), plant));
      expect(observed.some((reason) => reason?.startsWith(failure)), substitution.kind).toBe(true);
    }
  }, timeout);

  it("C2 FACET: moved Kevin and physician skin cover at least 0.5 texel² per triangle", async () => {
    const physician = join(root, "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb");
    for (const [path, mesh, material] of [
      [subjectGlb, body, skin],
      [physician, "mpfb_ward_delirium_senior_resident_adult_body", "mpfb_skin_ward_delirium_senior_resident_adult"],
    ] as const) {
      const scene = await loadAttrScene(path, "front", { skinMatName: material });
      const moved = scene.prims.filter((p) => p.meshName === mesh && p.matName === material && p.primIndex >= 8);
      expect(moved.length, `${mesh}: moved skin triangles exist`).toBeGreaterThan(0);
      const { areas } = await primTriUvAreasTexelsSq(path, mesh, material, moved.map((p) => p.primIndex));
      expect(Math.min(...areas), mesh).toBeGreaterThanOrEqual(uvFloor);
    }
    const seen = new Map<string, NonNullable<ReturnType<typeof probePixel>>>();
    for (const records of Object.values(pre.sites)) {
      for (const capture of captures) {
        const scene = await attr(historical, sides[capture]);
        for (const px of pixels(records[capture].box, 2)) {
          const hit = probePixel(scene, ...px);
          if (hit && hit.matName === skin && hit.dotWind < 0 && hit.dotShade > 0) seen.set(tri(hit), hit);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(100);
    const baseline = await attr(historical, "front");
    const areas = [...seen.values()].map((hit) => uvArea(baseline, hit));
    expect(Math.min(...areas), "historical visible Kevin skin covers at least 0.5 texel²").toBeGreaterThanOrEqual(uvFloor);
  }, timeout);

  it("C1 OPENING: the selected 126 fill the baseline openings within the dropped-L allowance", async () => {
    const result = await scanOpening(subject);
    expect(result.count).toBe(13028);
    expect(result.outside.length, `C1 failures outside allowance: ${result.outside.slice(0, 5).join(" | ")}`).toBe(0);
    expect(result.rim.sort()).toEqual([...held.rim].sort());
    expect(result.allowed.length).toBeLessThanOrEqual(13);
  }, timeout);

  it("C2′ SHIRT STAYS SHIRT: widened grading boxes have no skin leaks", async () => {
    const { count, leaks } = await shirtLeaks(subject, views);
    expect(count).toBe(4511 + 15487);
    expect(leaks.slice(0, 5)).toEqual([]);
    const candidate = await posedSubject(subject);
    candidate.camera = controlCamera(historicalFraming, "three_quarter");
    expect(shirtFailure(candidate, [2416, 1400], 4096, gradeTie), "C2′ shoulder poke witness").toBeNull();
  }, timeout);

  it("held-out F1b′ fill floor and F3 parity class run from the tracked S5/CW132 fixture", async () => {
    const baseline = await posedSubject(historical);
    const candidate = await posedSubject(subject);
    const parity = fixture<{ parityB: { dir: string; x: number; y: number; s5tri: string }[] }>(
      "./the-peds-nurse-kevin-collar-s10e-f1b-parity.fixture.json",
    );
    expect(held.directions.map(({ label, site, fill }) => [label, site, fill.length]), restoreHeld).toEqual([
      ["H-low-front", 355, 352], ["H-mirrored-tq", 83, 83], ["E-front-low-30", 376, 372],
      ["E-tq45-low-30", 103, 96], ["E-front-high-18", 4, 0],
    ]);
    const excludedB: string[] = [];
    const violations: string[] = [];
    for (const h of held.directions) {
      const reportOnly = h.label === "E-front-high-18";
      baseline.camera = candidate.camera = heldCamera(h, new Vector3(...held.center));
      const expected = new Set(h.fill);
      const exclusions = new Map(h.exclusions.flatMap((e) => e.pixels.map((id) => [id, e] as const)));
      let site = 0;
      let shirt = 0;
      let planted = 0;
      let filled = 0;
      for (const [x, y] of pixels(h.box, 4)) {
        const px: Pixel = [x, y];
        const main = openingHit(baseline, px, heldSize);
        const current = openingHit(candidate, px, heldSize);
        const key = siteKey(h.label, px);
        const isSite = main.hit?.cls === "hidden" && main.hit.meshName === body;
        if (current.hit?.cls === "hidden" && current.hit.meshName === body && !isSite && !reportOnly) {
          violations.push(`F3 ${key}: main first-hit is ${main.hit?.cls ?? "miss"}`);
        }
        if (isForwardShirt(baseline, px, heldSize)) {
          shirt++;
          const reason = shirtFailure(candidate, px, heldSize, productTie) ?? shirtFailure(candidate, px, heldSize, gradeTie);
          if (reason && !reportOnly) violations.push(`C2′ ${key}: ${reason}`);
        }
        if (!isSite) continue;
        site++;
        if (!current.failure) filled++;
        const id = y * heldSize + x;
        if (!expected.delete(id)) continue;
        if (main.failure) planted++;
        if (!current.failure || reportOnly) continue;
        const exclusion = exclusions.get(id);
        if (exclusion?.rule === "a" && allowance.has(exclusion.tri)) continue;
        if (exclusion?.rule === "b" && current.hit?.cls === "hidden" && current.hit.meshName === body) {
          excludedB.push(`${key}=${exclusion.tri}`);
          continue;
        }
        violations.push(`F1 ${key}: ${current.failure}`);
      }
      expect([site, shirt, expected.size], h.label).toEqual([h.site, h.shirt, 0]);
      if (!reportOnly) expect(planted, `${h.label}: the historical control fails the S5 fill floor`).toBe(h.fill.length);
      console.log(`Held-out ${h.label}: site=${site} S5 fill=${h.fill.length} live fill=${filled} CW132 C1 failures=${h.keepL.c1Failures}${reportOnly ? " (report only)" : ""}`);
    }
    expect(violations.length, violations.slice(0, 5).join(" | ")).toBe(0);
    expect(excludedB.length, `${restoreHeld} Rule (b) matched ${excludedB.length} rays instead of two.`).toBe(2);
    expect(excludedB.sort(), restoreHeld).toEqual(parity.parityB.map(({ dir, x, y, s5tri }) => `${siteKey(dir, [x, y])}=${s5tri}`).sort());
    expect(held.directions.slice(0, 4).filter(({ keepL: cw }) => cw.c1Failures || cw.gradeFailures)).toHaveLength(3);
  }, timeout);

  it.runIf(existsSync(keepL) && existsSync(dropOne))("C4 store counterweights: keep-L leaks and drop-one fails outside the allowance", async () => {
    const kept = await shirtLeaks(keepL, ["three_quarter"]);
    expect(kept.count).toBeGreaterThan(0);
    expect(kept.leaks.length, "CW132 retains the leaking L triangles").toBeGreaterThan(0);
    const control = await scanOpening(shippedGlb);
    const dropped = await scanOpening(dropOne);
    expect(control.count).toBe(13028);
    expect(dropped.count).toBe(control.count);
    expect(control.outside).toEqual([]);
    const unowned = dropped.outside.filter((row) => !row.endsWith("main=1:629"));
    const witnessIds = unowned.slice(0, 10).map((row) => row.split(" ", 1)[0]);
    expect(unowned.length, `Drop-one has ${unowned.length} outside witnesses unowned by historical triangle 1:629. First witness IDs: ${witnessIds.join(", ")}`).toBe(0);
    expect(dropped.outside.length, "Drop-one must yield a witness owned by historical triangle 1:629").toBeGreaterThan(0);
    console.log(`C4 126-tri control: ${control.count} rays, outside=${control.outside.length}. Drop 1:629: outside=${dropped.outside.length}, owned by 1:629=${dropped.outside.length} (${dropped.outside[0]}). Keep-L shirt leaks=${kept.leaks.length}.`);
  }, timeout);
});
