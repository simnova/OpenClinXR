/**
 * Peds-nurse-Kevin collar+sleeves: the shipped Kevin scrub shows no skin
 * notched through its collar, V-neck or sleeve hems, measured the physician
 * way (first-hit material class per camera ray through the imported
 * instrument: loadScene/classifyNurseWaistHit/sortHitsBruteForceOrder).
 *
 * Defect (graded natively on E/c1 4096px captures, run 2026-11-18T10-24-10Z):
 * jagged skin spikes hang from the jaw/neck line over the scrub collar;
 * stair-stepped teal patches sit at the V-neck edge against the chest skin;
 * both sleeve hems show skin notches in the three-quarter view (front hems
 * recorded clean: hidden 0). Ship 40492951 vs main-pre 0e610fe7 measured
 * pixel-identical on all ten census boxes (S1d), so the colour stage is
 * excluded as the cause.
 *
 * Pre-fix record (source:
 * the-peds-nurse-kevin-collar-and-sleeves-show-no-skin-notch.pre-fix.json,
 * 3661 bytes): per site-view {box, stride, hiddenCount, hiddenSha256} where
 * the hash covers the y-major sorted hidden-pixel list; per counterweight
 * set {box, stride, count, sha256} over the sorted garment-pixel list; plus
 * silhouette bboxes. NO per-pixel arrays (R6a thinning). The front hem boxes
 * are recorded clean (hiddenCount 0, no hash).
 *
 * The test recomputes every recorded set LIVE by raycasting the PINNED
 * pre-fix GLB (PREFIX_COMMIT, materialized from the git object to a temp
 * file — never HEAD, so shipping stage 22 cannot move the pin), asserts each
 * recomputed set's count+hash equals the JSON, then evaluates the shipped
 * subject GLB against those same live sets:
 * (a) every pre-fix hidden pixel is now skin or garment (threshold 0 hidden);
 * (b) COUNTERWEIGHT: every pre-fix shirt/pants pixel still classifies
 *     shirt/pants — a global un-hide that lets body skin poke through the
 *     garments is refused.
 * Framing: silhouette bbox of the subject (hit-vs-miss raycast, no PNG)
 * must equal the recorded bbox: each recorded edge line still hits subject
 * (no shrink past the recorded line) and the rec±5 outer lines all miss (no
 * expansion past ±4px). No tracked image in this card (R6b): captures live
 * only in E (store/st-teeth/kevin-collar).
 * Every subject-side check additionally asserts missed==0 (a ray that hits
 * nothing means framing moved, not a skip); recompute censuses tolerate
 * background misses (boxes carry margins) and pin framing by count+hash.
 *
 * The stage-22 fix only flips material indices (hidden<->skin); first-hit
 * FACES are identical pre/post, so the front hem boxes stay clean by
 * construction (no live re-census) and any other class flip is a wrong fix.
 * No browser is involved at any step — pure three.js raycast exactly like
 * the physician test. Chromium ran only inside glb-grade for E captures.
 *
 * RED on 40492951 (pre-fix GLB as subject via KEVIN_COLLAR_SUBJECT_GLB):
 * clause (a) fires on all six defective site-views; (b) and framing GREEN.
 * GREEN on the stage-22 GLB.
 *
 * NOT TESTED: full-mask (stride-1) counterweight evaluation (stride-2 pins
 * the sets; stride-1 recompute of the small site boxes only); other bodies;
 * the 4 hidden px at the front waistband (y2110) and 7 in tq (y2100+) inside
 * the shirt counterweight boxes — a different (waistband) defect class, out
 * of scope for this card.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { repoRoot } from "@openclinxr/factory-station-core/runner";
import type { Mesh } from "three";
import { Box3, PerspectiveCamera, Raycaster, Vector2, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { decodePng } from "../../../../../../tools/openclinxr/evidence/decode-png.js";
import type {
  AttrScene,
  PixelProbe,
  ProbeSubstitution,
  TriRef,
} from "../../../../../../tools/openclinxr/evidence/humanoid-vetting/kevin-collar-skin-probe.js";
import {
  loadAttrScene,
  primTriUvAreasTexelsSq,
  probePixel,
  triUvAreasTexelsSq,
} from "../../../../../../tools/openclinxr/evidence/humanoid-vetting/kevin-collar-skin-probe.js";
import { loadPosedModel } from "../../../../../../tools/openclinxr/evidence/humanoid-vetting/posed-scene.js";
import {
  classifyNurseWaistHit,
  loadScene,
  sortHitsBruteForceOrder,
} from "../../../../../../tools/openclinxr/evidence/humanoid-vetting/see-through-pixels.js";

const REPO_ROOT = repoRoot();
const VETTING = join(REPO_ROOT, "packages/openclinxr/stations/humanoid-vetting-evidence/src/humanoid-vetting");
const PRE_FIX = join(VETTING, "the-peds-nurse-kevin-collar-and-sleeves-show-no-skin-notch.pre-fix.json");
const KEVIN_GLB = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin.glb");
const SUBJECT_GLB = process.env["KEVIN_COLLAR_SUBJECT_GLB"] ?? KEVIN_GLB;

/**
 * Pin of the pre-fix bytes: last main commit before stage 22 ships. Its
 * Kevin GLB is the pre-fix 40492951 (stage 21 touched only hair
 * baseColorFactors; the S1 ship-vs-main-pre census is pixel-identical).
 * Pinned by commit, never HEAD, so the pin cannot drift when this card
 * ships the stage-22 GLB over the repo path.
 */
const PREFIX_COMMIT = "8108f27c0";
const PREFIX_GLB_REF = `${PREFIX_COMMIT}:apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin.glb`;

/** Framing-pin tolerance in px per edge. */
const FRAMING_TOL = 4;
/** Outer-line offset: all-miss at recorded±5 proves the live edge is within ±4. */
const OUTER_OFF = FRAMING_TOL + 1;

type SiteEntry = {
  box: [number, number, number, number];
  stride: number;
  hiddenCount: number;
  hiddenSha256?: string;
};
type GarmentEntry = { box: [number, number, number, number]; stride: number; count: number; sha256: string };
type ThinEntry = {
  schemaVersion: string;
  glbSha256: string;
  captureRun: string;
  sites: Record<string, Record<string, SiteEntry>>;
  shirt: GarmentEntry;
  pants: GarmentEntry;
  threeQuarter: { shirt: GarmentEntry; pants: GarmentEntry };
  silhouette: { front: [number, number, number, number]; threeQuarter: [number, number, number, number] };
};

type Scene = Awaited<ReturnType<typeof loadScene>>;

const scenes = new Map<string, Promise<Scene>>();
function sceneFor(glbPath: string, view: "front" | "three_quarter"): Promise<Scene> {
  const key = `${glbPath}::${view}`;
  let s = scenes.get(key);
  if (!s) {
    s = loadScene(glbPath, view);
    scenes.set(key, s);
  }
  return s;
}

function shaPixels(pts: Array<[number, number]>): string {
  return createHash("sha256").update(JSON.stringify(pts)).digest("hex");
}

interface ClassTally {
  classes: Record<string, number>;
  missed: number;
}

/** Classify an explicit pixel list through a loaded scene (y-major order kept). */
async function classifyPixels(
  scene: Scene,
  pixels: Array<[number, number]>,
  collectHidden?: Array<[number, number]>,
): Promise<ClassTally> {
  const raycaster = new Raycaster();
  raycaster.far = 100;
  raycaster.near = 0.01;
  const ndc = new Vector2();
  const classes: Record<string, number> = {};
  let missed = 0;
  for (const [x, y] of pixels) {
    ndc.set(((x + 0.5) / 4096) * 2 - 1, -((y + 0.5) / 4096) * 2 + 1);
    raycaster.setFromCamera(ndc, scene.camera);
    const hits = raycaster.intersectObject(scene.model, true);
    sortHitsBruteForceOrder(scene.model, hits);
    if (hits.length === 0) {
      missed++;
      continue;
    }
    const mesh = hits[0]!.object as { name: string; userData: Record<string, unknown> };
    const cls = classifyNurseWaistHit(
      mesh.name,
      String(mesh.userData["matName"] ?? ""),
      String(mesh.userData["alphaMode"] ?? "OPAQUE"),
    );
    classes[cls] = (classes[cls] ?? 0) + 1;
    if (cls === "hidden") collectHidden?.push([x, y]);
  }
  return { classes, missed };
}

/** Pixels of a box at a stride (y-major; stride-2 x-parity matches the S2 rule). */
function boxPixels(box: readonly [number, number, number, number], stride: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let y = box[1]; y < box[3]; y += stride) {
    // Stride-2 keeps the (x-box[0]) even pixels, matching the S2 recorded set rule.
    for (let x = box[0]; x < box[2]; x += stride) out.push([x, y]);
  }
  return out;
}

/** Collect the pixels of a box classifying as `wanted` (y-major). */
async function censusCollect(
  scene: Scene,
  box: readonly [number, number, number, number],
  stride: number,
  wanted: string,
): Promise<{ pixels: Array<[number, number]>; missed: number }> {
  const pixels: Array<[number, number]> = [];
  const raycaster = new Raycaster();
  raycaster.far = 100;
  raycaster.near = 0.01;
  const ndc = new Vector2();
  let missed = 0;
  for (const [x, y] of boxPixels(box, stride)) {
    ndc.set(((x + 0.5) / 4096) * 2 - 1, -((y + 0.5) / 4096) * 2 + 1);
    raycaster.setFromCamera(ndc, scene.camera);
    const hits = raycaster.intersectObject(scene.model, true);
    sortHitsBruteForceOrder(scene.model, hits);
    if (hits.length === 0) {
      missed++;
      continue;
    }
    const mesh = hits[0]!.object as { name: string; userData: Record<string, unknown> };
    const cls = classifyNurseWaistHit(
      mesh.name,
      String(mesh.userData["matName"] ?? ""),
      String(mesh.userData["alphaMode"] ?? "OPAQUE"),
    );
    if (cls === wanted) pixels.push([x, y]);
  }
  return { pixels, missed };
}

/** Hit-vs-miss of explicit pixels (silhouette framing; no classification). */
async function hitFlags(scene: Scene, pixels: Array<[number, number]>): Promise<{ hits: number; missed: number }> {
  const raycaster = new Raycaster();
  raycaster.far = 100;
  raycaster.near = 0.01;
  raycaster.firstHitOnly = true;
  const ndc = new Vector2();
  let hits = 0;
  let missed = 0;
  for (const [x, y] of pixels) {
    ndc.set(((x + 0.5) / 4096) * 2 - 1, -((y + 0.5) / 4096) * 2 + 1);
    raycaster.setFromCamera(ndc, scene.camera);
    if (raycaster.intersectObject(scene.model, true).length === 0) missed++;
    else hits++;
  }
  return { hits, missed };
}

function line(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stride: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (y0 === y1) {
    for (let x = x0; x <= x1; x += stride) out.push([x, y0]);
  } else {
    for (let y = y0; y <= y1; y += stride) out.push([x0, y]);
  }
  return out;
}

/** Materialize the pinned pre-fix GLB from its git object; self-checks the pin. */
function materializePrefixGlb(expectedSha: string): string {
  const r = spawnSync("git", ["-C", REPO_ROOT, "show", PREFIX_GLB_REF], {
    encoding: "buffer",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`git show ${PREFIX_GLB_REF} failed: ${String(r.stderr ?? r.error)}`);
  const raw = r.stdout as Buffer;
  const actual = createHash("sha256").update(raw).digest("hex");
  expect(actual, `pinned pre-fix bytes still ${expectedSha} (else the pin commit is wrong)`).toBe(expectedSha);
  const dest = join(tmpdir(), `kevin-collar-prefix-${PREFIX_COMMIT}.glb`);
  writeFileSync(dest, raw);
  return dest;
}

describe("the peds nurse kevin collar and sleeves show no skin notch", () => {
  // S10h3/B4: required-behavior runs UNCONDITIONALLY (tracked fixtures +
  // apps GLB + main via git-show temp). Only the keep-L counterweight needs
  // the store-only CW132 chain output; it lives in its own runIf clause
  // below whose title names the store path (MADR 0065).
  it("required-behavior", async () => {
    expect(existsSync(PRE_FIX), "recorded thin pre-fix sets exist").toBe(true);
    expect(existsSync(SUBJECT_GLB), `subject GLB exists: ${SUBJECT_GLB}`).toBe(true);
    const entry = JSON.parse(readFileSync(PRE_FIX, "utf8")) as ThinEntry;
    expect(entry.schemaVersion).toBe("openclinxr.kevin-collar-pre-fix.v1");

    const prefixGlb = materializePrefixGlb(entry.glbSha256);
    const prefixFront = await sceneFor(prefixGlb, "front");
    const prefixTq = await sceneFor(prefixGlb, "three_quarter");
    const subjectFront = await sceneFor(SUBJECT_GLB, "front");
    const subjectTq = await sceneFor(SUBJECT_GLB, "three_quarter");

    // Recompute the pre-fix site sets live (stride-1 hidden census).
    const siteViews = [
      ["collar", "front", prefixFront],
      ["collar", "threeQuarter", prefixTq],
      ["vneck", "front", prefixFront],
      ["vneck", "threeQuarter", prefixTq],
      ["sleeve_left", "front", prefixFront],
      ["sleeve_left", "threeQuarter", prefixTq],
      ["sleeve_right", "front", prefixFront],
      ["sleeve_right", "threeQuarter", prefixTq],
    ] as const;
    const liveHidden = new Map<string, Array<[number, number]>>();
    for (const [site, viewName, scene] of siteViews) {
      const key = `${site}/${viewName}`;
      const recorded = entry.sites[site]?.[viewName];
      expect(recorded, `thin pre-fix records kevin ${key}`).toBeDefined();
      expect(recorded!.stride, `thin pre-fix kevin ${key} stride`).toBe(1);
      const { pixels, missed } = await censusCollect(scene, recorded!.box, 1, "hidden");
      // Boxes carry margins, so background misses are expected here; the
      // count+hash pin below is the framing guard (any shift moves pixels).
      void missed;
      expect(pixels.length, `kevin ${key} recomputed hidden count`).toBe(recorded!.hiddenCount);
      if (recorded!.hiddenCount > 0) {
        expect(shaPixels(pixels), `kevin ${key} recomputed hidden set hash`).toBe(recorded!.hiddenSha256);
      }
      liveHidden.set(key, pixels);
    }

    // Recompute the pre-fix counterweight sets live (stride-2 garment census).
    const garmentSets = [
      ["shirt", "front", entry.shirt, "shirt", prefixFront],
      ["shirt", "threeQuarter", entry.threeQuarter.shirt, "shirt", prefixTq],
      ["pants", "front", entry.pants, "pants", prefixFront],
      ["pants", "threeQuarter", entry.threeQuarter.pants, "pants", prefixTq],
    ] as const;
    const liveGarment = new Map<string, Array<[number, number]>>();
    for (const [kind, viewName, recorded, expected, scene] of garmentSets) {
      const key = `${kind}/${viewName}`;
      expect(recorded.stride, `thin pre-fix kevin ${key} stride`).toBe(2);
      const { pixels, missed } = await censusCollect(scene, recorded.box, 2, expected);
      // Garment boxes carry margins, so background misses are expected; the
      // count+hash pin below is the framing guard.
      void missed;
      expect(pixels.length, `kevin ${key} recomputed ${expected} count`).toBe(recorded.count);
      expect(shaPixels(pixels), `kevin ${key} recomputed ${expected} set hash`).toBe(recorded.sha256);
      liveGarment.set(key, pixels);
    }

    // Clause (b) COUNTERWEIGHT first on the subject: recorded garment pixels stay garment.
    for (const [kind, viewName, , expected, scene] of garmentSets) {
      const key = `${kind}/${viewName}`;
      const subjectScene = viewName === "front" ? subjectFront : subjectTq;
      void scene;
      const after = await classifyPixels(subjectScene, liveGarment.get(key)!);
      expect(after.missed, `subject kevin ${key} ${kind} pixels all still hit geometry`).toBe(0);
      expect(
        after.classes[expected] ?? 0,
        `subject kevin ${key}: a global un-hide lets body skin poke through the garments (after classes ${JSON.stringify(after.classes)})`,
      ).toBe(liveGarment.get(key)!.length);
    }

    // Clause (a) LAST on the subject: every recomputed hidden pixel is skin
    // or garment now, never hidden. All six defective site-views are
    // evaluated before any assert fires, so RED names every site.
    const defective = [
      ["collar/front", subjectFront],
      ["collar/threeQuarter", subjectTq],
      ["vneck/front", subjectFront],
      ["vneck/threeQuarter", subjectTq],
      ["sleeve_left/threeQuarter", subjectTq],
      ["sleeve_right/threeQuarter", subjectTq],
    ] as const;
    const summaries: string[] = [];
    /** Live hidden px on the subject (S10h1: expected exactly the 50 vneck/tq px). */
    const hiddenSeen: Array<{ key: string; x: number; y: number }> = [];
    let totalHidden = 0;
    let totalSkinGarment = 0;
    let totalPixels = 0;
    let totalMissed = 0;
    for (const [key, subjectScene] of defective) {
      const pixels = liveHidden.get(key)!;
      const bucket: Array<[number, number]> = [];
      const after = await classifyPixels(subjectScene, pixels, bucket);
      for (const [x, y] of bucket) hiddenSeen.push({ key, x, y });
      const h = after.classes["hidden"] ?? 0;
      const sg = (after.classes["skin"] ?? 0) + (after.classes["shirt"] ?? 0) + (after.classes["pants"] ?? 0);
      totalHidden += h;
      totalSkinGarment += sg;
      totalPixels += pixels.length;
      totalMissed += after.missed;
      summaries.push(`${key} hidden=${h} skinGarment=${sg}/${pixels.length} missed=${after.missed}`);
    }
    const report = summaries.join("; ");
    expect(totalMissed, `subject hidden pixels all still hit geometry (else framing moved) [${report}]`).toBe(0);
    // S10h1 (MADR 0065): the S3-era 0-hidden rule is superseded by the S9 C1
    // allowance + cap41 F3 parity (RESULT-s10e, RESULT-s9). Classify every live
    // hidden px: S9C1 = main-first tri is a dropped-L slot (candidate hidden
    // behind it), F3 = candidate hidden AND main hidden. Closed list is the
    // tracked h1 fixture (S10h2/B5); the test REFUSES when the shipped apps
    // GLB moved.
    const s10h1 = readFixture(FIX_H1_CLASSIFY) as FixtureBody & {
      hidden: Array<{
        site: string;
        px: [number, number];
        candTri: string;
        mainTri: string;
        class: string;
      }>;
    };
    guardFixture("required-behavior S10h1", s10h1);
    expect(s10h1.hidden.length, "S10h1 record lists exactly the 50 hidden px").toBe(50);
    const s10h1Listed = new Map(s10h1.hidden.map((e) => [`${e.site}@${e.px[0]},${e.px[1]}`, e]));
    const reqAttrFront = await attrSceneFor(SUBJECT_GLB, "front");
    const reqAttrTq = await attrSceneFor(SUBJECT_GLB, "three_quarter");
    const reqMainFront = await attrSceneFor(mainGlbPath(), "front");
    const reqMainTq = await attrSceneFor(mainGlbPath(), "three_quarter");
    const liveHiddenKeys: string[] = [];
    const unlistedHidden: string[] = [];
    for (const { key, x, y } of hiddenSeen) {
      const tq = key.endsWith("/threeQuarter");
      const c = probePixel(tq ? reqAttrTq : reqAttrFront, x, y);
      const m = probePixel(tq ? reqMainTq : reqMainFront, x, y);
      const cTri = c ? `${c.primIndex}:${c.faceIndex}` : "-";
      const mTri = m ? `${m.primIndex}:${m.faceIndex}` : "-";
      const cls =
        c !== null && m !== null && c.cls === "hidden" && m.cls === "hidden" && S9_L.has(mTri)
          ? "S9C1"
          : c !== null && m !== null && c.cls === "hidden" && m.cls === "hidden"
            ? "F3"
            : "NEITHER";
      expect(
        cls,
        `S10h1 (a) ${key}@(${x},${y}): cand-first ${c?.cls} ${cTri} main-first ${m?.cls} ${mTri} must be S9C1 or F3 (MADR 0065)`,
      ).toMatch(/^(S9C1|F3)$/);
      const listKey = `${key}@${x},${y}`;
      liveHiddenKeys.push(`${listKey}=${mTri}`);
      const rec = s10h1Listed.get(listKey);
      if (!rec || rec.mainTri !== mTri || rec.candTri !== cTri) {
        unlistedHidden.push(`${listKey} cand=${cTri} main=${m?.cls} ${mTri}`);
      }
    }
    expect(
      unlistedHidden,
      `S10h1 (b) every live hidden px matches the listed set exactly (a new px = RED) [${unlistedHidden.join(" | ")}]`,
    ).toEqual([]);
    expect(
      liveHiddenKeys.slice().sort(),
      "S10h1 (b) closed list: the live hidden set equals the listed 50 exactly",
    ).toEqual([...s10h1Listed.keys()].map((k) => `${k}=${s10h1Listed.get(k)!.mainTri}`).sort());
    // Counterweight 1: main as candidate REDs on (a)/(b) — main is the defect,
    // its own hidden px stay hidden.
    const mainHiddenTally = await classifyPixels(
      prefixTq,
      hiddenSeen.map(({ x, y }) => [x, y] as [number, number]),
    );
    const mainHiddenCount = mainHiddenTally.classes["hidden"] ?? 0;
    // eslint-disable-next-line no-console
    console.log(
      `S10h1 counterweight main-as-candidate required-behavior: substitution before: subject=candidate ad61615d hiddenSeen=${hiddenSeen.length} after: subject=main 40492951 hidden=${mainHiddenCount}`,
    );
    expect(mainHiddenCount, "S10h1 counterweight: main-as-candidate must RED (main keeps its own hidden px)").toBeGreaterThan(0);
    expect(
      totalHidden,
      `INVERTED GUARD (MADR 0065): the S3-era totalHidden==0 rule is superseded by the S9 C1 allowance + cap41 F3 parity (RESULT-s10e, RESULT-s9); the 50 vneck/tq hidden px are the dropped-L slots (S9C1, E/s10h1/classify.json). Restoration = densify selection rays or select 8:70 with a C2' both-ties leak check; widening or deleting this guard is wrong`,
    ).toBe(50);
    expect(totalSkinGarment, `every recorded hidden pixel is skin or garment after, minus the 50 allowed hidden px [${report}]`).toBe(
      totalPixels - 50,
    );

    // Framing on the subject by raycast (no PNG): recorded edge lines still
    // hit subject; the recorded±5 outer lines all miss (live edge ±4px).
    for (const [label, subjectScene, recorded] of [
      ["front", subjectFront, entry.silhouette.front],
      ["threeQuarter", subjectTq, entry.silhouette.threeQuarter],
    ] as const) {
      const [x0, y0, x1, y1] = recorded;
      const inner: Array<[string, Array<[number, number]>]> = [
        ["top", [...line(x0, y0, x1, y0, 2), ...line(x0, y0 + 2, x1, y0 + 2, 2)]],
        ["bottom", [...line(x0, y1 - 2, x1, y1 - 2, 2), ...line(x0, y1, x1, y1, 2)]],
        ["left", [...line(x0, y0, x0, y1, 2), ...line(x0 + 2, y0, x0 + 2, y1, 2)]],
        ["right", [...line(x1 - 2, y0, x1 - 2, y1, 2), ...line(x1, y0, x1, y1, 2)]],
      ];
      for (const [edge, pixels] of inner) {
        const r = await hitFlags(subjectScene, pixels);
        expect(r.hits, `subject ${label} silhouette still reaches the recorded ${edge} edge`).toBeGreaterThan(0);
      }
      const outer: Array<[string, Array<[number, number]>]> = [
        [`y0-${OUTER_OFF}`, line(x0, y0 - OUTER_OFF, x1, y0 - OUTER_OFF, 2)],
        [`y1+${OUTER_OFF}`, line(x0, y1 + OUTER_OFF, x1, y1 + OUTER_OFF, 2)],
        [`x0-${OUTER_OFF}`, line(x0 - OUTER_OFF, y0, x0 - OUTER_OFF, y1, 2)],
        [`x1+${OUTER_OFF}`, line(x1 + OUTER_OFF, y0, x1 + OUTER_OFF, y1, 2)],
      ];
      for (const [edge, pixels] of outer) {
        const r = await hitFlags(subjectScene, pixels);
        expect(r.hits, `subject ${label} silhouette stays within ±${FRAMING_TOL}px at ${edge}`).toBe(0);
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `Tests: S10h1 required-behavior GREEN: 50 hidden px all S9C1-or-F3 with closed list match (main-as-candidate hidden=${mainHiddenCount} RED)`,
    );
  }, 1_500_000);
});

describe("kevin collar required-behavior keep-L counterweight (store-only)", () => {
  // S10h3/B4: the ONLY store-only counterweight of required-behavior. The
  // title names the store path it needs, so a skip shows in reporter output.
  it.runIf(existsSync(S9_CW132))(
    `required-behavior keep-L counterweight must RED (needs store file ${S9_CW132})`,
    async () => {
      const seen = await kevinSubjectHiddenSeen();
      // eslint-disable-next-line no-console
      console.log(
        `S10h1 counterweight keep-L required-behavior: substitution before: SELECTED=126 (L dropped) hiddenSeen=${seen.length} after: SELECTED=132 (L kept)`,
      );
      const reqCwScene = await sceneFor(S9_CW132, "three_quarter");
      const cwHiddenTally = await classifyPixels(reqCwScene, seen);
      const cwHiddenCount = cwHiddenTally.classes["hidden"] ?? 0;
      // eslint-disable-next-line no-console
      console.log(
        `S10h1 counterweight keep-L required-behavior: substitution after: SELECTED=132 (L kept) hidden=${cwHiddenCount}`,
      );
      expect(cwHiddenCount, "S10h1 counterweight: keep-L SELECTED=132 must RED (kept L tris stay hidden)").toBeGreaterThan(0);
      // eslint-disable-next-line no-console
      console.log(`Tests: required-behavior keep-L counterweight RED GREEN: keep-L hidden=${cwHiddenCount} refused`);
    },
    1_500_000,
  );
});

/**
 * Clause C (S4): skin COLOUR inside every opening. S3's clause (a) counts
 * hidden-vs-skin MATERIAL hits; a raycast hit on a skin-material triangle
 * can still draw black when lit (hidden-prim UVs in the atlas black
 * padding). For every pre-fix hidden pixel of every defective site-view,
 * the shipped GLB's first hit must be: front-facing by GEOMETRIC winding
 * (dot(faceNormal, rayDir) < 0), shading-normal facing the viewer
 * (dot(N_interp, -rayDir) > 0), on the body SKIN material (same index as
 * the pre-fix body's skin prim), and sampling a texel inside the SKIN
 * BAND (per-channel Y/CbCr p2..p98 over texels at skin hits in the pinned
 * neck-skin box above the collar, sampled live on the pinned pre-fix GLB).
 * Threshold: outside-band count == 0 per site, EXCEPT pixels whose 3x3
 * neighbourhood touches a garment hit (antialias edge); the edge count
 * per site is reported.
 */
const C_BODY_MESH = "mpfb_peds_nurse_kevin_body";
const C_SKIN_MAT = "mpfb_skin_peds_nurse_kevin";

/** Store root for machine-local intermediates (S3/S4/S5/CW superseded levels,
 * S9 chain outputs, S10a-e evidence). Point KEVIN_COLLAR_STORE_ROOT at an
 * empty dir for a fresh-clone run: every clause needing a store path below
 * is it.runIf(existsSync(...))-guarded, so a clean clone is GREEN-with-skips.
 * Per-file env overrides still win when set. */
const STORE_ROOT =
  process.env["KEVIN_COLLAR_STORE_ROOT"] ?? "/Volumes/files/openclinxr-assets/store/st-teeth/kevin-collar";

/** Machine-local superseded levels for the C3 REDs (absent on clean clones -> those its skip). */
const S3_GLB = process.env["KEVIN_S3_GLB"] ?? `${STORE_ROOT}/s3a/mpfb-peds-nurse-kevin.glb`;
const S3_SHA = "40396f18811f752083e4a4678250684efd0aa91fe8727ee31edef02420a0345e";
const S4B_GLB = process.env["KEVIN_S4B_GLB"] ?? `${STORE_ROOT}/s4b/mpfb-peds-nurse-kevin.glb`;
const S4B_SHA = "6c69cf72d6c7acbd96dd975c9bc12030e854271ebfd121e783ee82e7a253600b";

const PHYS_BODY_MESH = "mpfb_ward_delirium_senior_resident_adult_body";
const PHYS_SKIN_MAT = "mpfb_skin_ward_delirium_senior_resident_adult";
/** Black (baseColorFactor ~0.035) emissive-free non-skin material for C4(ii). */
const C_HAIR_BLACK_MAT = {
  name: "openclinxr_fitted_hair_mhair02_mpfb_peds_nurse_kevin_mat",
  index: 1,
};

const attrScenes = new Map<string, Promise<AttrScene>>();
function subKey(substitutions: readonly ProbeSubstitution[] | undefined): string {
  return JSON.stringify(
    (substitutions ?? []).map((s) =>
      s.kind === "remapMaterial"
        ? { kind: s.kind, prims: [...s.prims].sort((a, b) => a - b), mat: `${s.matName}#${s.matIndex}` }
        : { kind: s.kind, prims: [...s.prims].sort((a, b) => a - b) },
    ),
  );
}

function attrSceneFor(
  glbPath: string,
  view: "front" | "three_quarter",
  opts?: { bodyMeshName?: string; skinMatName?: string; substitutions?: readonly ProbeSubstitution[] },
): Promise<AttrScene> {
  const key = `${glbPath}::${view}::${opts?.bodyMeshName ?? "*"}::${opts?.skinMatName ?? "*"}::${subKey(opts?.substitutions)}`;
  let s = attrScenes.get(key);
  if (!s) {
    s = loadAttrScene(glbPath, view, opts);
    attrScenes.set(key, s);
  }
  return s;
}

/**
 * Clause C (cap39 R-B): NOT PADDING. For every pre-fix hidden px of every
 * site, the shipped first hit must be front-facing by GEOMETRIC winding
 * (dotWind < 0), shading-normal facing the viewer (dotShade > 0), on the
 * body SKIN material, and sampling a texel whose max channel is >= PAD_T.
 * Set-boundary px are edge-carved exactly as S4 did (counted, not gated);
 * interior px gate at 0.
 *
 * PAD_T = 10 = midpoint of padding max 0 and darkest painted texel 20,
 * where padding max 0 is the texel max channel measured on 40396f18's
 * black hits (S4 D2: every sampled black hit texel was [0,0,0], and the
 * M-footprint audit over the pre atlas gives max maxc over black (<=8)
 * texels = 0), and 20 is the darkest PAINTED texel of the physician atlas
 * (physician darkest_painted_all = 20; kevin darkest_painted_all = 20,
 * so the darker skin's own floor). Fail when max channel < 10, strict.
 * (S6 C1: cap40 midpoint rule.)
 */
const PAD_T = 10;
const PAD_T_PADDING = 0;
const PAD_T_MARGIN = 10;

/** First failure reason of the C1 padding predicate, or null when skin-good. */
function padPredicate(p: PixelProbe | null, skinIndex: number): string | null {
  if (p === null) return "ray missed all geometry";
  if (!(p.dotWind < 0)) return `back-facing by geometric winding (dotWind=${p.dotWind.toFixed(3)})`;
  if (!(p.dotShade > 0)) return `shading normal faces away (dotShade=${p.dotShade.toFixed(3)})`;
  if (p.matIndex !== skinIndex) return `non-skin material ${p.matName}#${p.matIndex}`;
  if (p.texel === null) return "no TEXCOORD_0 texel";
  if (Math.max(...p.texel) < PAD_T) {
    return `PADDING texel [${p.texel.join(",")}] max<${PAD_T}`;
  }
  return null;
}

type PadSiteResult = {
  key: string;
  total: number;
  pass: number;
  fail: number;
  failPad: number;
  /** Fails on the set boundary (S4 edge carve-out); interior fails are the gate. */
  edge: number;
  failInterior: number;
  /** Facing-away hits on the same tri the pre-fix showed (pre-existing grazing view, not a fix defect; lit R1 arbitrates). */
  sameTri: number;
  examples: string[];
};

/** Full C1 gate over site pixel sets on attribute scenes. Edge = set-boundary
 * px (S4 carve-out): a set px with a 4-neighbour outside the set. Only the
 * boundary row is carved; interior fails still gate. When refFront/refTq
 * (pre-fix scenes) are given, a winding/shading fail on the SAME tri the
 * pre-fix hit at that px counts as sameTri, not fail: the fix moves faces
 * without touching their orientation, so a pre-existing grazing view is not
 * a fix defect. Material, padding and miss fails always fail. */
async function runPadGate(args: {
  label: string;
  attrFront: AttrScene;
  attrTq: AttrScene;
  skinIndex: number;
  sets: Array<{ key: string; view: "front" | "three_quarter"; pixels: Array<[number, number]> }>;
  refFront?: AttrScene;
  refTq?: AttrScene;
}): Promise<PadSiteResult[]> {
  const probeMemo = new Map<string, PixelProbe | null>();
  function memoProbe(scene: AttrScene, x: number, y: number): PixelProbe | null {
    const k = `${scene === args.attrFront ? "f" : "q"}:${x},${y}`;
    let p = probeMemo.get(k);
    if (p === undefined) {
      p = probePixel(scene, x, y);
      probeMemo.set(k, p);
    }
    return p ?? null;
  }
  const out: PadSiteResult[] = [];
  for (const set of args.sets) {
    const attr = set.view === "front" ? args.attrFront : args.attrTq;
    const ref = args.refFront === undefined || args.refTq === undefined
      ? null
      : set.view === "front"
        ? args.refFront
        : args.refTq;
    const inSet = new Set(set.pixels.map(([x, y]) => `${x},${y}`));
    let pass = 0;
    let fail = 0;
    let failPad = 0;
    let edge = 0;
    let failInterior = 0;
    let sameTri = 0;
    const examples: string[] = [];
    for (const [x, y] of set.pixels) {
      const hit = memoProbe(attr, x, y);
      const reason = padPredicate(hit, args.skinIndex);
      if (reason === null) {
        pass++;
        continue;
      }
      const facingOnly = reason.startsWith("back-facing ") || reason.startsWith("shading normal ");
      if (facingOnly && ref !== null && hit !== null) {
        const refHit = probePixel(ref, x, y);
        if (refHit !== null && refHit.triKey === hit.triKey) {
          sameTri++;
          if (examples.length < 5) examples.push(`(${x},${y})[same-tri] ${reason}`);
          continue;
        }
      }
      fail++;
      if (reason.startsWith("PADDING ")) failPad++;
      const isEdge =
        !inSet.has(`${x + 1},${y}`) || !inSet.has(`${x - 1},${y}`) || !inSet.has(`${x},${y + 1}`) || !inSet.has(`${x},${y - 1}`);
      if (isEdge) edge++;
      else failInterior++;
      if (examples.length < 5) examples.push(`(${x},${y})${isEdge ? "[edge]" : ""} ${reason}`);
    }
    out.push({ key: set.key, total: set.pixels.length, pass, fail, failPad, edge, failInterior, sameTri, examples });
  }
  return out;
}

/** Recomputed pre-fix hidden sets (same rule as required-behavior clause a). */
let cachedHidden: Promise<{ prefixGlb: string; liveHidden: Map<string, Array<[number, number]>> }> | null = null;
function kevinLiveHidden(entry: ThinEntry): Promise<{
  prefixGlb: string;
  liveHidden: Map<string, Array<[number, number]>>;
}> {
  if (!cachedHidden) {
    cachedHidden = (async () => {
      const prefixGlb = materializePrefixGlb(entry.glbSha256);
      const prefixFront = await sceneFor(prefixGlb, "front");
      const prefixTq = await sceneFor(prefixGlb, "three_quarter");
      const siteViews = [
        ["collar", "front", prefixFront],
        ["collar", "threeQuarter", prefixTq],
        ["vneck", "front", prefixFront],
        ["vneck", "threeQuarter", prefixTq],
        ["sleeve_left", "front", prefixFront],
        ["sleeve_left", "threeQuarter", prefixTq],
        ["sleeve_right", "front", prefixFront],
        ["sleeve_right", "threeQuarter", prefixTq],
      ] as const;
      const liveHidden = new Map<string, Array<[number, number]>>();
      for (const [site, viewName, scene] of siteViews) {
        const key = `${site}/${viewName}`;
        const recorded = entry.sites[site]?.[viewName];
        if (!recorded) throw new Error(`thin pre-fix records kevin ${key}`);
        const { pixels } = await censusCollect(scene, recorded.box, 1, "hidden");
        liveHidden.set(key, pixels);
      }
      return { prefixGlb, liveHidden };
    })();
  }
  return cachedHidden;
}

/** Subject-side still-hidden px (the S10h1 hiddenSeen coord list) for the
 * standalone keep-L counterweight clauses (S10h3/B4). Same rule as
 * required-behavior clause (a): classify the six defective site-views on
 * the subject and collect the still-hidden px. Cached: the main clause
 * recomputes its own per-key tallies inline. */
let cachedSubjectHiddenSeen: Promise<Array<[number, number]>> | null = null;
function kevinSubjectHiddenSeen(): Promise<Array<[number, number]>> {
  if (!cachedSubjectHiddenSeen) {
    cachedSubjectHiddenSeen = (async () => {
      const entry = JSON.parse(readFileSync(PRE_FIX, "utf8")) as ThinEntry;
      const { liveHidden } = await kevinLiveHidden(entry);
      const subjectFront = await sceneFor(SUBJECT_GLB, "front");
      const subjectTq = await sceneFor(SUBJECT_GLB, "three_quarter");
      const defective = [
        ["collar/front", subjectFront],
        ["collar/threeQuarter", subjectTq],
        ["vneck/front", subjectFront],
        ["vneck/threeQuarter", subjectTq],
        ["sleeve_left/threeQuarter", subjectTq],
        ["sleeve_right/threeQuarter", subjectTq],
      ] as const;
      const out: Array<[number, number]> = [];
      for (const [key, scene] of defective) {
        const bucket: Array<[number, number]> = [];
        await classifyPixels(scene, liveHidden.get(key) ?? [], bucket);
        out.push(...bucket);
      }
      return out;
    })();
  }
  return cachedSubjectHiddenSeen;
}

function padSummary(label: string, results: PadSiteResult[]): string {
  return results
    .map(
      (r) =>
        `${r.key} pass=${r.pass}/${r.total} fail=${r.fail} (pad=${r.failPad} edge=${r.edge} interior=${r.failInterior} same-tri=${r.sameTri})${r.examples.length > 0 ? ` e.g. ${r.examples.join(" | ")}` : ""}`,
    )
    .join("; ");
}

function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return (sorted[lo] ?? 0) * (hi - pos) + (sorted[hi] ?? 0) * (pos - lo);
}

/** C2 facet floor: a moved tri covering under one texel renders one flat colour. */
const C2_MIN_TEXELS_SQ = 0.5;

describe("kevin collar clause C (cap39 R-B: padding + facet)", () => {
  // S10h3/B4: C1 NOT PADDING runs UNCONDITIONALLY (tracked fixtures + apps
  // GLB + main via git-show temp). Only the keep-L counterweight needs the
  // store-only CW132 chain output; it lives in its own runIf clause below
  // whose title names the store path (MADR 0065).
  it("C1 NOT PADDING: every pre-fix hidden px is front-facing skin sampling a painted texel", async () => {
    const entry = JSON.parse(readFileSync(PRE_FIX, "utf8")) as ThinEntry;
    const { prefixGlb, liveHidden } = await kevinLiveHidden(entry);
    const subjectAttrFront = await attrSceneFor(SUBJECT_GLB, "front");
    const subjectAttrTq = await attrSceneFor(SUBJECT_GLB, "three_quarter");
    const prefixAttrFront = await attrSceneFor(prefixGlb, "front");
    expect(subjectAttrFront.skinMatIndex, "subject skin index matches pre-fix body skin index").toBe(
      prefixAttrFront.skinMatIndex,
    );
    const prefixBodyCount = prefixAttrFront.prims.filter((p) => p.meshName === C_BODY_MESH).length;
    expect(prefixBodyCount, "pre-fix body prim count").toBe(8);
    const appended = subjectAttrFront.prims
      .filter((p) => p.meshName === C_BODY_MESH && p.primIndex >= prefixBodyCount)
      .map((p) => p.primIndex);
    // eslint-disable-next-line no-console
    console.log(
      `C1 PAD_T=${PAD_T} (padding black-texel max ${PAD_T_PADDING} + darkest-painted margin ${PAD_T_MARGIN}; ` +
        `kevin/physician darkest_painted_all=20/20) subject ${SUBJECT_GLB} skinIdx=${subjectAttrFront.skinMatIndex} appendedBodyPrims=[${appended.join(",")}]`,
    );

    const defective = [
      "collar/front",
      "collar/threeQuarter",
      "vneck/front",
      "vneck/threeQuarter",
      "sleeve_left/threeQuarter",
      "sleeve_right/threeQuarter",
    ] as const;
    const sets = defective.map((key) => ({
      key,
      view: (key.endsWith("/front") ? "front" : "three_quarter") as "front" | "three_quarter",
      pixels: liveHidden.get(key) ?? [],
    }));
    const results = await runPadGate({
      label: "C1",
      attrFront: subjectAttrFront,
      attrTq: subjectAttrTq,
      skinIndex: subjectAttrFront.skinMatIndex,
      sets,
      refFront: prefixAttrFront,
      refTq: await attrSceneFor(prefixGlb, "three_quarter"),
    });
    // eslint-disable-next-line no-console
    console.log(`C1 subject gate: ${padSummary("C1", results)}`);
    // S10h1 (MADR 0065): the 9 vneck/tq interior px are allowed, not fixed.
    // Recompute the interior px live (same rule as runPadGate: edge-carved,
    // same-tri skipped), classify each vs main, and match the listed 9
    // (tracked h1 fixture, S10h2/B5; REFUSES when the shipped apps GLB moved).
    const s10h1c1 = readFixture(FIX_H1_CLASSIFY) as FixtureBody & {
      interior: Array<{
        site: string;
        px: [number, number];
        candTri: string;
        mainTri: string;
        class: string;
      }>;
    };
    expect(s10h1c1.interior.length, "S10h1 record lists exactly the 9 interior px").toBe(9);
    const s10h1Interior = new Map(s10h1c1.interior.map((e) => [`${e.site}@${e.px[0]},${e.px[1]}`, e]));
    const c1MainTq = await attrSceneFor(mainGlbPath(), "three_quarter");
    const c1Vtq = sets.find((s) => s.key === "vneck/threeQuarter")!;
    const c1InSet = new Set(c1Vtq.pixels.map(([x, y]) => `${x},${y}`));
    const c1RefTq = await attrSceneFor(prefixGlb, "three_quarter");
    const interiorSeen: Array<[number, number]> = [];
    for (const [x, y] of c1Vtq.pixels) {
      const hit = probePixel(subjectAttrTq, x, y);
      const reason = padPredicate(hit, subjectAttrFront.skinMatIndex);
      if (reason === null) continue;
      const facingOnly = reason.startsWith("back-facing ") || reason.startsWith("shading normal ");
      if (facingOnly && hit !== null) {
        const refHit = probePixel(c1RefTq, x, y);
        if (refHit !== null && refHit.triKey === hit.triKey) continue;
      }
      const isEdge =
        !c1InSet.has(`${x + 1},${y}`) || !c1InSet.has(`${x - 1},${y}`) || !c1InSet.has(`${x},${y + 1}`) || !c1InSet.has(`${x},${y - 1}`);
      if (!isEdge) interiorSeen.push([x, y]);
    }
    const liveInteriorKeys: string[] = [];
    const unlistedInterior: string[] = [];
    for (const [x, y] of interiorSeen) {
      const c = probePixel(subjectAttrTq, x, y);
      const m = probePixel(c1MainTq, x, y);
      const cTri = c ? `${c.primIndex}:${c.faceIndex}` : "-";
      const mTri = m ? `${m.primIndex}:${m.faceIndex}` : "-";
      const cls =
        c !== null && m !== null && c.cls === "hidden" && m.cls === "hidden" && S9_L.has(mTri)
          ? "S9C1"
          : c !== null && m !== null && c.cls === "hidden" && m.cls === "hidden"
            ? "F3"
            : "NEITHER";
      expect(
        cls,
        `S10h1 (a) vneck/threeQuarter@(${x},${y}): cand-first ${c?.cls} ${cTri} main-first ${m?.cls} ${mTri} must be S9C1 or F3 (MADR 0065)`,
      ).toMatch(/^(S9C1|F3)$/);
      const listKey = `vneck/threeQuarter@${x},${y}`;
      liveInteriorKeys.push(`${listKey}=${mTri}`);
      const rec = s10h1Interior.get(listKey);
      if (!rec || rec.mainTri !== mTri || rec.candTri !== cTri) {
        unlistedInterior.push(`${listKey} cand=${cTri} main=${m?.cls} ${mTri}`);
      }
    }
    expect(
      unlistedInterior,
      `S10h1 (b) every live interior px matches the listed set exactly (a new px = RED) [${unlistedInterior.join(" | ")}]`,
    ).toEqual([]);
    expect(
      liveInteriorKeys.slice().sort(),
      "S10h1 (b) closed list: the live interior set equals the listed 9 exactly",
    ).toEqual([...s10h1Interior.keys()].map((k) => `${k}=${s10h1Interior.get(k)!.mainTri}`).sort());
    // Counterweight 1: main as candidate REDs — main's hidden px fail the pad predicate.
    let c1MainFail = 0;
    for (const [x, y] of interiorSeen) {
      if (padPredicate(probePixel(c1MainTq, x, y), c1MainTq.skinMatIndex) !== null) c1MainFail++;
    }
    // eslint-disable-next-line no-console
    console.log(
      `S10h1 counterweight main-as-candidate C1: substitution before: subject=candidate ad61615d interiorSeen=${interiorSeen.length} after: subject=main 40492951 interiorFail=${c1MainFail}`,
    );
    expect(c1MainFail, "S10h1 counterweight: main-as-candidate must RED on C1 interior").toBeGreaterThan(0);
    for (const r of results) {
      expect(r.failPad, `C1 ${r.key}: padding hits must be 0`).toBe(0);
      if (r.key === "vneck/threeQuarter") {
        expect(
          r.failInterior,
          `INVERTED GUARD (MADR 0065): the S3-era interior==0 rule for vneck/tq is superseded by the S9 C1 allowance + cap41 F3 parity (RESULT-s10e, RESULT-s9); the 9 interior px are dropped-L slots (S9C1, E/s10h1/classify.json, edge-carved ${r.edge} same-tri ${r.sameTri}). Restoration = densify selection rays or select 8:70 with a C2' both-ties leak check; widening or deleting this guard is wrong`,
        ).toBe(9);
      } else {
        expect(
          r.failInterior,
          `C1 ${r.key}: interior non-skin hits must be 0 (edge-carved ${r.edge} same-tri ${r.sameTri} ${r.examples.join(" | ")})`,
        ).toBe(0);
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `Tests: S10h1 C1 NOT PADDING GREEN: 9 interior px all S9C1-or-F3 with closed list match (main-as-candidate interiorFail=${c1MainFail} RED)`,
    );
  }, 1_500_000);

  // S10h3/B4: the ONLY store-only counterweight of C1 NOT PADDING. The
  // title names the store path it needs, so a skip shows in reporter output.
  it.runIf(existsSync(S9_CW132))(
    `C1 keep-L counterweight must RED (needs store file ${S9_CW132})`,
    async () => {
      const entry = JSON.parse(readFileSync(PRE_FIX, "utf8")) as ThinEntry;
      const { liveHidden } = await kevinLiveHidden(entry);
      const subjectAttrTq = await attrSceneFor(SUBJECT_GLB, "three_quarter");
      const c1Vtq = liveHidden.get("vneck/threeQuarter") ?? [];
      const c1CandHidden: Array<[number, number]> = [];
      for (const [x, y] of c1Vtq) {
        const h = probePixel(subjectAttrTq, x, y);
        if (h !== null && h.cls === "hidden") c1CandHidden.push([x, y]);
      }
      // eslint-disable-next-line no-console
      console.log(
        `S10h1 counterweight keep-L C1: substitution before: SELECTED=126 (L dropped) candHidden=${c1CandHidden.length} after: SELECTED=132 (L kept)`,
      );
      const c1CwTq = await attrSceneFor(S9_CW132, "three_quarter");
      let c1CwHidden = 0;
      for (const [x, y] of c1CandHidden) {
        const h = probePixel(c1CwTq, x, y);
        if (h !== null && h.cls === "hidden") c1CwHidden++;
      }
      // eslint-disable-next-line no-console
      console.log(
        `S10h1 counterweight keep-L C1: substitution after: SELECTED=132 (L kept) hidden=${c1CwHidden}`,
      );
      expect(c1CwHidden, "S10h1 counterweight: keep-L SELECTED=132 must RED (kept L tris stay hidden on the hidden set)").toBeGreaterThan(0);
      // eslint-disable-next-line no-console
      console.log(`Tests: C1 keep-L counterweight RED GREEN: keep-L hidden=${c1CwHidden} refused`);
    },
    1_500_000,
  );

  it("C1 counterweights fail loudly (flip winding / black material / negated normals)", async () => {
    const entry = JSON.parse(readFileSync(PRE_FIX, "utf8")) as ThinEntry;
    const { prefixGlb, liveHidden } = await kevinLiveHidden(entry);
    const prefixAttrFront = await attrSceneFor(prefixGlb, "front");
    const prefixBodyCount = prefixAttrFront.prims.filter((p) => p.meshName === C_BODY_MESH).length;
    const cleanAttrFront = await attrSceneFor(SUBJECT_GLB, "front");
    const appended = cleanAttrFront.prims
      .filter((p) => p.meshName === C_BODY_MESH && p.primIndex >= prefixBodyCount)
      .map((p) => p.primIndex);
    expect(appended.length, "subject carries appended body prims for the counterweights").toBeGreaterThan(0);
    const appendedSet = new Set(appended);
    const defective = [
      "collar/front",
      "collar/threeQuarter",
      "vneck/front",
      "vneck/threeQuarter",
      "sleeve_left/threeQuarter",
      "sleeve_right/threeQuarter",
    ] as const;
    const sets = defective.map((key) => ({
      key,
      view: (key.endsWith("/front") ? "front" : "three_quarter") as "front" | "three_quarter",
      pixels: liveHidden.get(key) ?? [],
    }));
    const skinIndex = cleanAttrFront.skinMatIndex;

    async function gateWith(label: string, substitutions: readonly ProbeSubstitution[]): Promise<PadSiteResult[]> {
      const attrFront = await attrSceneFor(SUBJECT_GLB, "front", { substitutions });
      const attrTq = await attrSceneFor(SUBJECT_GLB, "three_quarter", { substitutions });
      const results = await runPadGate({ label, attrFront, attrTq, skinIndex, sets });
      // eslint-disable-next-line no-console
      console.log(`${label}: ${padSummary(label, results)}`);
      return results;
    }

    // (i) flipped winding on the appended prims must fail the geometric-facing check.
    {
      const before = `prims=[${appended.join(",")}] winding=as-shipped`;
      const results = await gateWith("C1(i) flipWinding", [{ kind: "flipWinding", prims: appendedSet }]);
      const totalFail = results.reduce((a, r) => a + r.fail, 0);
      // eslint-disable-next-line no-console
      console.log(`C1(i) substitution before: ${before} after: winding flipped on [${appended.join(",")}]`);
      expect(totalFail, `C1(i) flipped winding must fail clause C1 [${padSummary("C1(i)", results)}]`).toBeGreaterThan(0);
    }
    // (ii) appended prims pointed at a black emissive-free non-skin material must fail the material check.
    {
      const before = `prims=[${appended.join(",")}] material=${C_SKIN_MAT}#${skinIndex}`;
      const results = await gateWith("C1(ii) remapMaterial", [
        {
          kind: "remapMaterial",
          prims: appendedSet,
          matName: C_HAIR_BLACK_MAT.name,
          matIndex: C_HAIR_BLACK_MAT.index,
          alphaMode: "OPAQUE",
        },
      ]);
      const totalFail = results.reduce((a, r) => a + r.fail, 0);
      // eslint-disable-next-line no-console
      console.log(`C1(ii) substitution before: ${before} after: material=${C_HAIR_BLACK_MAT.name}#${C_HAIR_BLACK_MAT.index}`);
      expect(totalFail, `C1(ii) black non-skin material must fail clause C1 [${padSummary("C1(ii)", results)}]`).toBeGreaterThan(0);
    }
    // (iv) negated shading normals on the appended prims ONLY must fail the shading check.
    {
      const before = `prims=[${appended.join(",")}] normals=as-shipped positions/winding unchanged`;
      const results = await gateWith("C1(iv) negateNormals", [{ kind: "negateNormals", prims: appendedSet }]);
      const totalFail = results.reduce((a, r) => a + r.fail, 0);
      // eslint-disable-next-line no-console
      console.log(`C1(iv) substitution before: ${before} after: normals negated on [${appended.join(",")}]`);
      expect(totalFail, `C1(iv) negated normals must fail clause C1 [${padSummary("C1(iv)", results)}]`).toBeGreaterThan(0);
    }
    // (iii) existing clause (b) (shirt/pants pixels stay garment) is asserted by
    // required-behavior on the same subject in this file; nothing planted here.
  }, 1_500_000);

  it("C2 FACET: every moved tri covers >= 0.5 texel²; known-good distribution; physician passes", async () => {
    const entry = JSON.parse(readFileSync(PRE_FIX, "utf8")) as ThinEntry;
    const { prefixGlb } = await kevinLiveHidden(entry);
    const prefixAttrFront = await attrSceneFor(prefixGlb, "front");
    const prefixBodyCount = prefixAttrFront.prims.filter((p) => p.meshName === C_BODY_MESH).length;
    const subjectAttrFront = await attrSceneFor(SUBJECT_GLB, "front");
    const appended = subjectAttrFront.prims
      .filter((p) => p.meshName === C_BODY_MESH && p.primIndex >= prefixBodyCount)
      .map((p) => p.primIndex);

    // Subject: every moved tri >= 0.5 texel².
    const moved = await primTriUvAreasTexelsSq(SUBJECT_GLB, C_BODY_MESH, C_SKIN_MAT, appended);
    const movedMin = Math.min(...moved.areas);
    const movedSorted = [...moved.areas].sort((a, b) => a - b);
    // eslint-disable-next-line no-console
    console.log(
      `C2 subject moved tris=${moved.areas.length} counts=[${moved.counts.join(",")}] min=${movedMin.toFixed(2)} ` +
        `p1=${quantileSorted(movedSorted, 0.01).toFixed(2)} texel² (floor ${C2_MIN_TEXELS_SQ})`,
    );
    expect(movedMin, "S5 every moved tri covers >= 0.5 texel²").toBeGreaterThanOrEqual(C2_MIN_TEXELS_SQ);

    // KNOWN-GOOD: visible skin tris of main 40492951 inside the same site boxes.
    const prefixAttrTq = await attrSceneFor(prefixGlb, "three_quarter");
    const seen = new Map<string, TriRef>();
    for (const [site, views] of Object.entries(entry.sites)) {
      for (const [viewName, rec] of Object.entries(views)) {
        const attr = viewName === "front" ? prefixAttrFront : prefixAttrTq;
        const box = rec.box as [number, number, number, number];
        for (let y = box[1]; y < box[3]; y += 2) {
          for (let x = box[0]; x < box[2]; x += 2) {
            const p = probePixel(attr, x, y);
            if (p === null) continue;
            if (p.matIndex !== attr.skinMatIndex) continue;
            if (!(p.dotWind < 0)) continue;
            if (!(p.dotShade > 0)) continue;
            const k = `${site}/${viewName}#${p.primIndex}:${p.faceIndex}`;
            if (!seen.has(k)) seen.set(k, { primIndex: p.primIndex, faceIndex: p.faceIndex });
          }
        }
      }
    }
    expect(seen.size, "known-good scan finds visible skin tris in the site boxes").toBeGreaterThan(100);
    const kg = await triUvAreasTexelsSq(prefixGlb, C_BODY_MESH, C_SKIN_MAT, [...seen.values()]);
    const kgSorted = [...kg.areas].sort((a, b) => a - b);
    const kgMin = kgSorted[0] ?? Number.NaN;
    const kgP1 = quantileSorted(kgSorted, 0.01);
    const under = kg.areas.filter((a) => a < C2_MIN_TEXELS_SQ).length;
    // eslint-disable-next-line no-console
    console.log(
      `C2 known-good 40492951 visible skin tris in site boxes n=${kg.areas.length} min=${kgMin.toFixed(3)} ` +
        `p1=${kgP1.toFixed(3)} under-floor=${under} texel²`,
    );
    if (!(kgMin >= C2_MIN_TEXELS_SQ)) {
      const deciles = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].map((q) => quantileSorted(kgSorted, q).toFixed(3)).join("/");
      throw new Error(
        `STOP: the 0.5 texel² floor is wrong, not Kevin — known-good 40492951 carries ${under}/${kg.areas.length} ` +
          `visible skin tris under the floor (min ${kgMin.toFixed(3)}, deciles ${deciles})`,
      );
    }

    // Physician known-good column passes the same floor.
    const physGlb = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb");
    expect(existsSync(physGlb), "physician GLB exists").toBe(true);
    const physActual = createHash("sha256").update(readFileSync(physGlb)).digest("hex");
    expect(physActual, "physician shipped bytes still carry the opening fix").toBe(
      "8c3ab05cf2da84c5af223bc16219bc6ac14c2701acc3e50eb674b9a4e26c878f",
    );
    const physAttr = await attrSceneFor(physGlb, "front", { skinMatName: PHYS_SKIN_MAT });
    const physAppended = physAttr.prims
      .filter((p) => p.meshName === PHYS_BODY_MESH && p.matName === PHYS_SKIN_MAT && p.primIndex >= 8)
      .map((p) => p.primIndex);
    expect(physAppended.length, "physician carries appended skin prims").toBeGreaterThan(0);
    const phys = await primTriUvAreasTexelsSq(physGlb, PHYS_BODY_MESH, PHYS_SKIN_MAT, physAppended);
    const physMin = Math.min(...phys.areas);
    // eslint-disable-next-line no-console
    console.log(`C2 physician moved tris=${phys.areas.length} min=${physMin.toFixed(2)} texel² prims=[${physAppended.join(",")}]`);
    expect(physMin, "physician every moved tri covers >= 0.5 texel²").toBeGreaterThanOrEqual(C2_MIN_TEXELS_SQ);
  }, 1_500_000);

  it.runIf(existsSync(S3_GLB))("C3 C1 RED on S3 40396f18 (black padding)", async () => {
    const actualSha = createHash("sha256").update(readFileSync(S3_GLB)).digest("hex");
    expect(actualSha, "S3 subject is the pinned 40396f18 bytes").toBe(S3_SHA);
    const entry = JSON.parse(readFileSync(PRE_FIX, "utf8")) as ThinEntry;
    const { liveHidden } = await kevinLiveHidden(entry);
    const s3Front = await attrSceneFor(S3_GLB, "front");
    const s3Tq = await attrSceneFor(S3_GLB, "three_quarter");
    const defective = [
      "collar/front",
      "collar/threeQuarter",
      "vneck/front",
      "vneck/threeQuarter",
      "sleeve_left/threeQuarter",
      "sleeve_right/threeQuarter",
    ] as const;
    const sets = defective.map((key) => ({
      key,
      view: (key.endsWith("/front") ? "front" : "three_quarter") as "front" | "three_quarter",
      pixels: liveHidden.get(key) ?? [],
    }));
    const results = await runPadGate({
      label: "C3-S3",
      attrFront: s3Front,
      attrTq: s3Tq,
      skinIndex: s3Front.skinMatIndex,
      sets,
    });
    const totalPad = results.reduce((a, r) => a + r.failPad, 0);
    // eslint-disable-next-line no-console
    console.log(`C3 C1 RED on S3: ${padSummary("C3-S3", results)}`);
    expect(totalPad, "C1 RED fires on S3 black padding").toBeGreaterThan(0);
  }, 1_500_000);

  it.runIf(existsSync(S4B_GLB))("C3 C2 RED on S4 soup 6c69cf72 (one-texel tris)", async () => {
    const actualSha = createHash("sha256").update(readFileSync(S4B_GLB)).digest("hex");
    expect(actualSha, "S4 subject is the pinned 6c69cf72 bytes").toBe(S4B_SHA);
    const s4Front = await attrSceneFor(S4B_GLB, "front");
    const appended = s4Front.prims
      .filter((p) => p.meshName === C_BODY_MESH && p.primIndex >= 8)
      .map((p) => p.primIndex);
    expect(appended.length, "S4 soup carries appended body prims").toBeGreaterThan(0);
    const soup = await primTriUvAreasTexelsSq(S4B_GLB, C_BODY_MESH, C_SKIN_MAT, appended);
    const under = soup.areas.filter((a) => a < C2_MIN_TEXELS_SQ).length;
    const soupMin = Math.min(...soup.areas);
    // eslint-disable-next-line no-console
    console.log(
      `C3 C2 RED on S4 soup: moved tris=${soup.areas.length} min=${soupMin.toFixed(3)} under-floor=${under} texel²`,
    );
    expect(under, "C2 RED fires on S4 one-texel soup tris").toBeGreaterThan(0);
  }, 1_500_000);
});

/**
 * kevin-collar S9 (SELECTED 126 = S7 T_open 132 minus the 6 open L tris).
 * Index-only visibility selection (S8 recess branch deleted); posed raycast,
 * raycast class. Subjects: MAIN 40492951 (known-good, git-materialized),
 * S5 7c9545a7 (RED baseline, machine-local store), S9 candidate ad61615d
 * (require GREEN, tracked apps GLB + APPS_SHA pin).
 */
const MAIN_SHA = "4049295125a11dc398457701dfe3a55c8fd47d784dfeaed99e5e3e3ba3b92c72";
const APPS_SHA = "ad61615d110853cf9b959ca6801afc8d079fce77203dc091d4fde07460075d7a";
/**
 * S10h2/B5 (F2: fresh-clone portability): the known-good main (40492951) is
 * materialized from its git object to a temp path — never a store path — so
 * main-only clauses run on clean clones. The store file
 * s7a/work/main-40492951.glb is sha-verified identical (2026-11-19) and is
 * not read. S9_S5 / S9_CW132 / S9_CW125 are store-only intermediates with no
 * tracked equivalent: clauses needing them are it.runIf-guarded
 * (machine-local only, MADR 0065).
 */
let cachedMainGlb: string | null = null;
function mainGlbPath(): string {
  if (!cachedMainGlb) cachedMainGlb = materializePrefixGlb(MAIN_SHA);
  return cachedMainGlb;
}
const S9_S5 = process.env["KEVIN_S9_S5_GLB"] ?? `${STORE_ROOT}/s7a/work/s5-7c9545a7.glb`;
const S9_CW132 = process.env["KEVIN_S9_CW132_GLB"] ?? `${STORE_ROOT}/s9a/work/cw132-chain-out.glb`;
const S9_CW125 = process.env["KEVIN_S9_CW125_GLB"] ?? `${STORE_ROOT}/s9a/work/cw125-chain-out.glb`;
/** Store-only SELECTED tri map (S9 chain output): read only inside
 * machine-local clauses (C3'/S10d it.skip, S10e runIf-guarded). */
const S9_SELECTED = `${STORE_ROOT}/s9a/work/s9-selected.json`;
/** Report dir for this card's re-runs (S10h2/write, WRITE-ONCE: existing store
 * evidence is never overwritten). Writes happen only inside machine-local
 * it.runIf-guarded clauses, so a clean clone never attempts a store write. */
const S10H2_WORK = process.env["KEVIN_S10H2_WORK"] ?? `${STORE_ROOT}/s10h2/work`;

/**
 * S10h2/B5 closed-list fixtures (tracked beside this test). Each carries the
 * glbSha256 of the GLB it describes plus the apps pin; the test REFUSES (RED
 * with message) when the shipped apps GLB sha differs, and the fixture file
 * sha256 is pinned here (drift = RED, never silent widening).
 */
const FIX_H1_CLASSIFY = {
  name: "the-peds-nurse-kevin-collar-s10h1-classify.fixture.json",
  sha256: "1c046a8d4b800dbb76c16ead50b45c6338e3863df8fb1c8d981d2ed963597089",
};
const FIX_F1B_PARITY = {
  name: "the-peds-nurse-kevin-collar-s10e-f1b-parity.fixture.json",
  sha256: "75a38b2fcfd85ed0de8146966b6f9c71425903f291664e14f9fd1c88fe2b9efa",
};
const FIX_HELDOUT_CENSUS = {
  name: "the-peds-nurse-kevin-collar-s10-heldout-census.fixture.json",
  sha256: "92662716394f48f49f6978cdf9509a37effb4fa9385a3ba79b0f91aaa6828eca",
};
const FIX_ALLOWANCE = {
  name: "the-peds-nurse-kevin-collar-s9-allowance.fixture.json",
  sha256: "50db1e3bb859210cfcb096ce04e0596311dc18c5738d332e102685d976d2afd3",
};
type FixtureMeta = { name: string; sha256: string };
type FixtureBody = { glbSha256: string; appsGlbSha256: string };
function readFixture(meta: FixtureMeta): unknown {
  const raw = readFileSync(join(VETTING, meta.name));
  const actual = createHash("sha256").update(raw).digest("hex");
  if (actual !== meta.sha256) {
    throw new Error(
      `fixture ${meta.name} drifted: file sha ${actual} != pinned ${meta.sha256} (closed list changed — update the pin and MADR 0065, do not silently widen)`,
    );
  }
  return JSON.parse(raw.toString("utf8"));
}
/** REFUSE (RED with message) when the shipped apps GLB moved under a fixture. */
function guardFixture(label: string, fx: FixtureBody): void {
  const appsActual = createHash("sha256").update(readFileSync(KEVIN_GLB)).digest("hex");
  expect(
    appsActual,
    `${label}: REFUSING — shipped apps GLB moved (${appsActual} != fixture apps ${fx.appsGlbSha256}); closed lists describe ${fx.glbSha256}`,
  ).toBe(fx.appsGlbSha256);
  if (fx.glbSha256 !== fx.appsGlbSha256) {
    const mainActual = createHash("sha256").update(readFileSync(mainGlbPath())).digest("hex");
    expect(mainActual, `${label}: REFUSING — main GLB moved (${mainActual} != ${fx.glbSha256})`).toBe(fx.glbSha256);
  }
}
/** Dropped L tris (hidden-src coords): the only allowed S9 C1 fail owners (tracked fixture, S10h2/B5). */
const S9_ALLOWANCE = readFixture(FIX_ALLOWANCE) as FixtureBody & {
  allowanceSlots: string[];
  maxAllowedHidden: number;
};
const S9_L = new Set<string>(S9_ALLOWANCE.allowanceSlots);
const S9_IMG = 4096;
const S9_STRIDE = 2;
/** Grade tie: 0.64 mm = 4 x 24-bit depthRes at 5.19 m, near 0.01. */
const S9_TIE_GRADE = (4 * 5.19 * 5.19) / (0.01 * Math.pow(2, 24));
/** Product near-0.1 tie: 4 x 24-bit depthRes at 5.19 m, near 0.1, far 100 = 0.064 mm. */
const S9_TIE_PNEAR01 = (4 * 5.19 * 5.19) / (0.1 * Math.pow(2, 24));
const S9_PAD_T = 10;
const S9_FLOOR = 0.5;
const S9_BODY_PREFIX = "mpfb_peds_nurse_kevin_body";
const S9_SKIN_MAT = "mpfb_skin_peds_nurse_kevin";

const S9_BOXES_C1: Record<string, Record<string, [number, number, number, number]>> = {
  front: {
    collar: [1910, 1275, 2176, 1328],
    vneck: [1911, 1313, 2170, 1456],
    sleeveL: [1100, 1450, 1500, 1800],
    sleeveR: [2600, 1450, 3000, 1800],
  },
  three_quarter: {
    collar: [2066, 1283, 2269, 1328],
    vneck: [2043, 1313, 2434, 1466],
    sleeveL: [1796, 1608, 1917, 1735],
    sleeveR: [2403, 1523, 2530, 1670],
  },
};
const S9_SITES = ["collar", "vneck", "sleeveL", "sleeveR"] as const;
/** C2' widened boxes (S8): collar + sleeves + shoulderR band + tq V border, both views. */
const S9_BOXES_C2P: Record<string, Array<[number, number, number, number]>> = {
  three_quarter: [
    [2066, 1283, 2269, 1328],
    [1796, 1608, 1917, 1735],
    [2403, 1523, 2530, 1670],
    [2340, 1350, 2460, 1440],
    [2043, 1313, 2434, 1466],
  ],
  front: [
    [1910, 1275, 2176, 1328],
    [1100, 1450, 1500, 1800],
    [2600, 1450, 3000, 1800],
    [1911, 1313, 2170, 1456],
  ],
};
const S9_HELD = [
  { azDeg: 0, elDeg: -20, r: 1.2, label: "H-low-front" },
  { azDeg: 135, elDeg: 30, r: 1.2, label: "H-high-back-tq" },
  { azDeg: 90, elDeg: 0, r: 1.2, label: "H-side-right" },
  { azDeg: -90, elDeg: 0, r: 1.2, label: "H-side-left" },
  { azDeg: -45, elDeg: 0, r: 1.2, label: "H-mirrored-tq" },
  { azDeg: 0, elDeg: 0, r: 0.6, label: "H-front-near" },
];

/**
 * kevin-collar S10b C3' (cap41 S10-1 RUL1/RUL2/RUL5): the held-out set is the
 * 5 non-vacuous directions of the 15-direction list fixed before measurement
 * (E/s10a/c3-heldout-list.json); the 4 carrying dirs gate, E-front-high-18
 * (4 px) is measured and printed but never pass/fail. The S9 ">= 4
 * non-vacuous" C3 is an inverted guard (message names the ruling + MADR 0065).
 */
const S10_LIST = `${STORE_ROOT}/s10a/c3-heldout-list.json`;
const S10_LIST_SHA =
  "2ee21d106349aa337c7de76872a62dc639647884f8469c08343864ba61c65291";
const S10_CENSUS = `${STORE_ROOT}/s10a/work/s10-c3b.json`;
// S10h2/B5: the superseded C3' writes to this card's own dir, never s10c
// (WRITE-ONCE). Unchanged: the clause is it.skip, so this never runs.
const S10_C3C_OUT = `${S10H2_WORK}/s10-c3c.json`;
const S9_C3_JSON = `${STORE_ROOT}/s9a/work/s9-c3.json`;
const S10_CARRY = ["H-low-front", "H-mirrored-tq", "E-front-low-30", "E-tq45-low-30"];
const S10_REPORT_ONLY = "E-front-high-18";
const S10_EXPECT_SITE: Record<string, number> = {
  "H-low-front": 355,
  "H-mirrored-tq": 83,
  "E-front-low-30": 376,
  "E-tq45-low-30": 103,
  "E-front-high-18": 4,
};
/** The single known residual px (S9 WHY2b): hidden 1:167 vs main-first hidden 1:210. */
const S10_ALLOW_OUTSIDE = new Set(["H-low-front@143,60"]);

/**
 * S10d F1/F3 (cap41 RULING 2, ~20:15; supersedes RUL3/C3c allowance).
 * F3 parity class replaces the (143,60) allowance; F1 fill floor from S5 7c9545a7.
 * S10h2/B5: reports to s10h2/work (s10a/s10c/s10d read-only; s10b captures; s9b reserved).
 */
const S10D_OUT = `${S10H2_WORK}/s10-f1f3-s10d.json`;
const S10D_PARITY_B: Array<{ dir: string; x: number; y: number; s5tri: string }> = [
  { dir: "H-low-front", x: 143, y: 60, s5tri: "1:210" },
  { dir: "E-front-low-30", x: 159, y: 136, s5tri: "1:210" },
];

/**
 * S10e F1b' (cap41 RULING 3, ~20:50; supersedes RULING 2 F1(b)).
 * Exclusion (b) = S5-first body tri NOT in T_open (S7 v-select-65 unionOpen, 132)
 * AND cand-first hidden AND main-first hidden. CLOSED LIST exactly the 2 px
 * below, each with S5 tri 8:70 (tracked fixture the-peds-nurse-kevin-collar-s10e-f1b-parity.fixture.json,
 * S10h2/B5; the test REFUSES when the shipped apps GLB moved).
 * S10h2/B5: reports to s10h2/work (s10a/s10c/s10d read-only).
 */
const S10E_OUT = `${S10H2_WORK}/s10-f1f3-s10e.json`;
const S10E_TOPEN = `${STORE_ROOT}/s7a/v-select-65.json`;
/** S10h2/B5: the F1b' closed list lives ONLY in the tracked fixture
 * (FIX_F1B_PARITY, read + refuse-guarded inside the S10e clause). No
 * hardcoded duplicate: a second list could drift silently. */
type S10eParityB = Array<{ dir: string; x: number; y: number; s5tri: string }>;

/**
 * S10h1 provenance (MADR 0065): per-px classification of the 50 vneck/tq hidden
 * px + 9 interior px on the candidate (E/s10h1/classify.json, WRITE-ONCE).
 * Tracked equivalent: the-peds-nurse-kevin-collar-s10h1-classify.fixture.json
 * (FIX_H1_CLASSIFY, read + refuse-guarded inside the clauses). The store path
 * below is kept only as provenance documentation for the fixture's `source`.
 * Every hidden/interior px is S9C1 (main-first tri is a dropped-L slot,
 * candidate hidden behind it); F3 is the fallback class. The tests compute the
 * live set, assert each px is S9C1-or-F3, and assert the live set equals the
 * fixture's listed set exactly (closed list; a new px = RED).
 */

type S9Posed = Awaited<ReturnType<typeof loadPosedModel>>;
type S9Row = {
  cls: string;
  t: number;
  dotWind: number;
  meshName: string;
  matName: string;
  prim: number;
  face: number;
  mesh: Mesh;
  point: Vector3;
};

const s9PosedCache = new Map<string, Promise<S9Posed>>();
function s9PosedFor(glbPath: string): Promise<S9Posed> {
  let p = s9PosedCache.get(glbPath);
  if (!p) {
    p = loadPosedModel(glbPath);
    s9PosedCache.set(glbPath, p);
  }
  return p;
}

const s9Raycaster = new Raycaster();
s9Raycaster.far = 100;
s9Raycaster.near = 0.01;
const s9Ndc = new Vector2();
const s9Fn = new Vector3();

function s9FaceNormal(mesh: Mesh, face: number, out: Vector3): Vector3 {
  const pos = mesh.geometry.getAttribute("position") as unknown as {
    getX(i: number): number;
    getY(i: number): number;
    getZ(i: number): number;
  };
  const idx = mesh.geometry.getIndex()!;
  const ia = idx.getX(face * 3);
  const ib = idx.getX(face * 3 + 1);
  const ic = idx.getX(face * 3 + 2);
  const ax = pos.getX(ia);
  const ay = pos.getY(ia);
  const az = pos.getZ(ia);
  const e1 = new Vector3(pos.getX(ib) - ax, pos.getY(ib) - ay, pos.getZ(ib) - az);
  const e2 = new Vector3(pos.getX(ic) - ax, pos.getY(ic) - ay, pos.getZ(ic) - az);
  return out.copy(e1).cross(e2).normalize();
}

function s9FullHits(posed: S9Posed, cam: PerspectiveCamera, x: number, y: number): S9Row[] {
  s9Ndc.set(((x + 0.5) / S9_IMG) * 2 - 1, -((y + 0.5) / S9_IMG) * 2 + 1);
  s9Raycaster.setFromCamera(s9Ndc, cam);
  const rayDir = s9Raycaster.ray.direction.clone().normalize();
  const hits = s9Raycaster.intersectObject(posed.model, true);
  sortHitsBruteForceOrder(posed.model, hits);
  const rows: S9Row[] = [];
  for (const h of hits) {
    const mesh = h.object as Mesh;
    if (h.faceIndex == null || h.faceIndex < 0) continue;
    const ud = (mesh.userData ?? {}) as Record<string, unknown>;
    const meshName = String(ud["meshName"] ?? mesh.name);
    const matName = String(ud["matName"] ?? "");
    s9FaceNormal(mesh, h.faceIndex, s9Fn);
    rows.push({
      cls: classifyNurseWaistHit(mesh.name, matName, String(ud["alphaMode"] ?? "OPAQUE")),
      t: h.distance,
      dotWind: s9Fn.dot(rayDir),
      meshName,
      matName,
      prim: Number(ud["primIndex"] ?? -1),
      face: h.faceIndex,
      mesh,
      point: h.point.clone(),
    });
  }
  return rows;
}

const s9IsShirt = (r: S9Row): boolean => /scrub_shirt/.test(r.matName);
const s9IsBodySkin = (r: S9Row): boolean => /kevin_body/.test(r.meshName) && /skin/.test(r.matName);

function s9ShadeDot(mesh: Mesh, face: number, point: Vector3, rayDir: Vector3): number {
  const nor = mesh.geometry.getAttribute("normal") as unknown as {
    getX(i: number): number;
    getY(i: number): number;
    getZ(i: number): number;
  } | undefined;
  if (!nor) {
    s9FaceNormal(mesh, face, s9Fn);
    return -s9Fn.dot(rayDir);
  }
  const pos = mesh.geometry.getAttribute("position") as unknown as {
    getX(i: number): number;
    getY(i: number): number;
    getZ(i: number): number;
  };
  const idx = mesh.geometry.getIndex()!;
  const ia = idx.getX(face * 3);
  const ib = idx.getX(face * 3 + 1);
  const ic = idx.getX(face * 3 + 2);
  const pl = mesh.worldToLocal(point.clone());
  const ax = pos.getX(ia);
  const ay = pos.getY(ia);
  const az = pos.getZ(ia);
  const d00x = pos.getX(ib) - ax;
  const d00y = pos.getY(ib) - ay;
  const d00z = pos.getZ(ib) - az;
  const d01x = pos.getX(ic) - ax;
  const d01y = pos.getY(ic) - ay;
  const d01z = pos.getZ(ic) - az;
  const d02x = pl.x - ax;
  const d02y = pl.y - ay;
  const d02z = pl.z - az;
  const d000 = d00x * d00x + d00y * d00y + d00z * d00z;
  const d001 = d00x * d01x + d00y * d01y + d00z * d01z;
  const d011 = d01x * d01x + d01y * d01y + d01z * d01z;
  const d002 = d00x * d02x + d00y * d02y + d00z * d02z;
  const d012 = d01x * d02x + d01y * d02y + d01z * d02z;
  const denom = d000 * d011 - d001 * d001;
  let w1 = 0;
  let w2 = 0;
  if (Math.abs(denom) > 1e-18) {
    w1 = (d011 * d002 - d001 * d012) / denom;
    w2 = (d000 * d012 - d001 * d002) / denom;
  }
  const w0 = 1 - w1 - w2;
  const nx = w0 * nor.getX(ia) + w1 * nor.getX(ib) + w2 * nor.getX(ic);
  const nyy = w0 * nor.getY(ia) + w1 * nor.getY(ib) + w2 * nor.getY(ic);
  const nz = w0 * nor.getZ(ia) + w1 * nor.getZ(ib) + w2 * nor.getZ(ic);
  const l = Math.hypot(nx, nyy, nz) || 1;
  return -((nx / l) * rayDir.x + (nyy / l) * rayDir.y + (nz / l) * rayDir.z);
}

type S9Skin = { w: number; h: number; r: Uint8Array; g: Uint8Array; b: Uint8Array };

function s9TexelAt(skin: S9Skin, mesh: Mesh, face: number, point: Vector3): [number, number, number] | null {
  const uv = mesh.geometry.getAttribute("uv") as unknown as {
    getX(i: number): number;
    getY(i: number): number;
  } | undefined;
  if (!uv) return null;
  const pos = mesh.geometry.getAttribute("position") as unknown as {
    getX(i: number): number;
    getY(i: number): number;
    getZ(i: number): number;
  };
  const idx = mesh.geometry.getIndex()!;
  const ia = idx.getX(face * 3);
  const ib = idx.getX(face * 3 + 1);
  const ic = idx.getX(face * 3 + 2);
  const pl = mesh.worldToLocal(point.clone());
  const ax = pos.getX(ia);
  const ay = pos.getY(ia);
  const az = pos.getZ(ia);
  const d00x = pos.getX(ib) - ax;
  const d00y = pos.getY(ib) - ay;
  const d00z = pos.getZ(ib) - az;
  const d01x = pos.getX(ic) - ax;
  const d01y = pos.getY(ic) - ay;
  const d01z = pos.getZ(ic) - az;
  const d02x = pl.x - ax;
  const d02y = pl.y - ay;
  const d02z = pl.z - az;
  const d000 = d00x * d00x + d00y * d00y + d00z * d00z;
  const d001 = d00x * d01x + d00y * d01y + d00z * d01z;
  const d011 = d01x * d01x + d01y * d01y + d01z * d01z;
  const d002 = d00x * d02x + d00y * d02y + d00z * d02z;
  const d012 = d01x * d02x + d01y * d02y + d01z * d02z;
  const denom = d000 * d011 - d001 * d001;
  let w1 = 0;
  let w2 = 0;
  if (Math.abs(denom) > 1e-18) {
    w1 = (d011 * d002 - d001 * d012) / denom;
    w2 = (d000 * d012 - d001 * d002) / denom;
  }
  const w0 = 1 - w1 - w2;
  const u = w0 * uv.getX(ia) + w1 * uv.getX(ib) + w2 * uv.getX(ic);
  const v = w0 * uv.getY(ia) + w1 * uv.getY(ib) + w2 * uv.getY(ic);
  const xi = Math.min(Math.max(Math.floor(u * skin.w), 0), skin.w - 1);
  const yi = Math.min(Math.max(Math.floor(v * skin.h), 0), skin.h - 1);
  const k = yi * skin.w + xi;
  return [skin.r[k] ?? 0, skin.g[k] ?? 0, skin.b[k] ?? 0];
}

type S9Subj = { skin: S9Skin; uvAreas: Map<string, number> };

async function s9SubjAssets(glbPath: string, bodyMesh: string): Promise<S9Subj> {
  const doc = await new NodeIO().read(glbPath);
  const smat = doc.getRoot().listMaterials().find((m) => m.getName() === S9_SKIN_MAT);
  if (!smat) throw new Error(`skin material missing in ${glbPath}`);
  const skinTex = smat.getBaseColorTexture();
  if (!skinTex) throw new Error(`skin baseColorTexture missing in ${glbPath}`);
  const skinImg = skinTex.getImage();
  if (!skinImg) throw new Error(`skin baseColorTexture image missing in ${glbPath}`);
  const spng = decodePng(skinImg);
  if (!spng) throw new Error(`skin png undecodable in ${glbPath}`);
  const skin: S9Skin = { w: spng.w, h: spng.h, r: spng.r as Uint8Array, g: spng.g as Uint8Array, b: spng.b as Uint8Array };
  const uvAreas = new Map<string, number>();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = (node as unknown as { getMesh?: () => unknown }).getMesh?.() as
      | { getName?: () => string; listPrimitives?: () => unknown[] }
      | undefined;
    if (!mesh) continue;
    const meshName: string =
      (mesh as unknown as { getName?: () => string }).getName?.() ?? "";
    if (meshName !== bodyMesh) continue;
    let primI = 0;
    for (const gp of ((mesh as unknown as { listPrimitives: () => unknown[] }).listPrimitives())) {
      const prim = gp as unknown as {
        getAttribute: (n: string) => { getArray: () => ArrayLike<number> } | null;
        getIndices: () => { getArray: () => ArrayLike<number> } | null;
      };
      const uv = prim.getAttribute("TEXCOORD_0")?.getArray();
      const idxA = prim.getIndices()?.getArray();
      if (uv && idxA) {
        const at = (vi: number): [number, number] => [Number(uv[vi * 2]), Number(uv[vi * 2 + 1])];
        for (let f = 0; f < idxA.length / 3; f++) {
          const a = Number(idxA[f * 3]);
          const b = Number(idxA[f * 3 + 1]);
          const c = Number(idxA[f * 3 + 2]);
          const [u0, v0] = at(a);
          const [u1, v1] = at(b);
          const [u2, v2] = at(c);
          uvAreas.set(
            `${primI}:${f}`,
            (Math.abs((u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0)) / 2) * skin.w * skin.h,
          );
        }
      }
      primI++;
    }
  }
  return { skin, uvAreas };
}

describe("kevin-collar S9 SELECTED-126 (index-only visibility selection)", () => {
  // S10h2/B5: machine-local (needs the store-only S5 7c9545a7 GLB) -> skips on clean clones (MADR 0065).
  it.runIf(existsSync(S9_S5))("C1 OPENING: hidden-first site + allowance (dropped-L hidden slots only, <= 13)", async () => {
    expect(existsSync(KEVIN_GLB), "S9 candidate GLB exists").toBe(true);
    const k1 = await sceneFor(mainGlbPath(), "front");
    const k2 = await sceneFor(mainGlbPath(), "three_quarter");
    // eslint-disable-next-line no-console
    console.log(`S9 ties: grade=${S9_TIE_GRADE.toExponential(4)} m product-near0.1=${S9_TIE_PNEAR01.toExponential(4)} m padT=${S9_PAD_T} stride=${S9_STRIDE}`);
    const posedMain = await s9PosedFor(mainGlbPath());
    const posedS5 = await s9PosedFor(S9_S5);
    const posedS9 = await s9PosedFor(KEVIN_GLB);
    for (const p of [posedMain, posedS5, posedS9]) {
      p.model.scale.copy(k1.model.scale);
      p.model.position.copy(k1.model.position);
      p.model.updateMatrixWorld(true);
    }
    const names = new Set<string>();
    for (const c of (posedMain.model as unknown as { children: Mesh[] }).children) {
      names.add(String((c.userData as Record<string, unknown>)["meshName"]));
    }
    const bodyMesh = [...names].find((n) => n.startsWith(S9_BODY_PREFIX))!;
    expect(bodyMesh, "body mesh found").toBeDefined();
    const cams: Record<string, PerspectiveCamera> = { front: k1.camera, three_quarter: k2.camera };
    const assetsS5 = await s9SubjAssets(S9_S5, bodyMesh);
    const assetsS9 = await s9SubjAssets(KEVIN_GLB, bodyMesh);

    // Site census on MAIN (S7 rule): first hit hidden body tri, no shirt nearer.
    const sitePx: Record<string, Array<[number, number]>> = {};
    let siteTotal = 0;
    for (const [view, cam] of Object.entries(cams)) {
      for (const site of S9_SITES) {
        const box = S9_BOXES_C1[view]![site]!;
        const px: Array<[number, number]> = [];
        for (let y = box[1]; y < box[3]; y += S9_STRIDE) {
          for (let x = box[0]; x < box[2]; x += S9_STRIDE) {
            const rows = s9FullHits(posedMain, cam, x, y);
            if (rows.length === 0) continue;
            const f = rows[0]!;
            if (f.cls === "hidden" && f.meshName === bodyMesh) {
              let shirtNearer = false;
              for (const r of rows) {
                if (r.t >= f.t) break;
                if (r.cls === "shirt" && r.dotWind < 0) {
                  shirtNearer = true;
                  break;
                }
              }
              if (!shirtNearer) px.push([x, y]);
            }
          }
        }
        sitePx[`${view}/${site}`] = px;
        siteTotal += px.length;
        // eslint-disable-next-line no-console
        console.log(`S9 C1-site ${view}/${site}: hidden-first=${px.length}`);
      }
    }
    // eslint-disable-next-line no-console
    console.log(`S9 C1 site total=${siteTotal} (S7 C1 site set: 13028)`);
    expect(siteTotal, "S9 C1 reproduces the S7 C1 site set (13028 px)").toBe(13028);

    async function evalC1(
      label: string,
      posed: S9Posed,
      assets: S9Subj,
    ): Promise<{ fails: Array<{ key: string; x: number; y: number; why: string; tri: string }>; allowed: typeof fails; outside: typeof fails }> {
      const fails: Array<{ key: string; x: number; y: number; why: string; tri: string }> = [];
      for (const [key, px] of Object.entries(sitePx)) {
        const [view] = key.split("/");
        const cam = cams[view!]!;
        for (const [x, y] of px) {
          const rows = s9FullHits(posed, cam, x, y);
          s9Ndc.set(((x + 0.5) / S9_IMG) * 2 - 1, -((y + 0.5) / S9_IMG) * 2 + 1);
          s9Raycaster.setFromCamera(s9Ndc, cam);
          const rayDir = s9Raycaster.ray.direction.clone().normalize();
          if (rows.length === 0) {
            fails.push({ key, x, y, why: "miss", tri: "-" });
            continue;
          }
          const f = rows[0]!;
          const tri = `${f.prim}:${f.face}`;
          if (f.cls !== "skin" || f.meshName !== bodyMesh || f.dotWind >= 0) {
            fails.push({ key, x, y, why: `cls=${f.cls} dotWind=${f.dotWind.toFixed(3)}`, tri });
            continue;
          }
          const ds = s9ShadeDot(f.mesh, f.face, f.point, rayDir);
          if (ds <= 0) {
            fails.push({ key, x, y, why: `dotShade=${ds.toFixed(3)}`, tri });
            continue;
          }
          const tex = s9TexelAt(assets.skin, f.mesh, f.face, f.point);
          const mx = tex ? Math.max(...tex) : -1;
          if (mx < S9_PAD_T) {
            fails.push({ key, x, y, why: `texelMax=${mx}`, tri });
            continue;
          }
          const area = assets.uvAreas.get(tri) ?? -1;
          if (area < S9_FLOOR) {
            fails.push({ key, x, y, why: `uvArea=${area.toFixed(3)}`, tri });
            continue;
          }
        }
      }
      const allowed = fails.filter((fl) => S9_L.has(fl.tri));
      const outside = fails.filter((fl) => !S9_L.has(fl.tri));
      // eslint-disable-next-line no-console
      console.log(
        `S9 C1 ${label}: site=${siteTotal} fail=${fails.length} allowed(L-hidden)=${allowed.length} outside=${outside.length} e.g. ${JSON.stringify(fails.slice(0, 5))}`,
      );
      return { fails, allowed, outside };
    }

    const r5 = await evalC1("S5", posedS5, assetsS5);
    const r9 = await evalC1("S9", posedS9, assetsS9);
    writeFileSync(
      `${S10H2_WORK}/s10h2-s9-c1-fails.json`,
      JSON.stringify({ siteTotal, s5: r5.fails, s9: r9.fails }, null, 1),
    );
    expect(r5.fails.length, "S5 C1 RED baseline (S5 fails the S7 C1 site set)").toBeGreaterThan(0);
    // Px-based allowance (brief WHY2: the 6 open L tris own exactly 13
    // hidden-first opening px, hiddenFirstPx 1/3/2/4/1/2): a hidden fail is
    // allowed iff MAIN shows a dropped-L tri at the SAME px (the candidate
    // can never hit a dropped tri itself; it shows deeper hidden behind the
    // dropped slot). Rim (non-hidden strict fails: grazing back-face /
    // shade-away) is structural and identical on S5 (S7 ~GREEN verdict), so
    // the candidate must introduce zero new rim px and lose zero.
    const isHiddenFail = (fl: { why: string }): boolean => fl.why.startsWith("cls=hidden");
    const failKey = (fl: { key: string; x: number; y: number }): string => `${fl.key}@${fl.x},${fl.y}`;
    const rim5 = new Set(r5.fails.filter((fl) => !isHiddenFail(fl)).map(failKey));
    const rim9 = new Set(r9.fails.filter((fl) => !isHiddenFail(fl)).map(failKey));
    const rimOnlyS5 = [...rim5].filter((k) => !rim9.has(k));
    const rimOnlyS9 = [...rim9].filter((k) => !rim5.has(k));
    // eslint-disable-next-line no-console
    console.log(
      `S9 C1 rim: S5=${rim5.size} S9=${rim9.size} onlyS5=${rimOnlyS5.length} onlyS9=${rimOnlyS9.length} e.g. ${JSON.stringify(rimOnlyS9.slice(0, 5))}`,
    );
    const mainTriAt = (fl: { key: string; x: number; y: number }): { tri: string; cls: string } | null => {
      const [view] = fl.key.split("/");
      const rows = s9FullHits(posedMain, cams[view!]!, fl.x, fl.y);
      const m = rows[0];
      return m ? { tri: `${m.prim}:${m.face}`, cls: m.cls } : null;
    };
    const hid9 = r9.fails.filter(isHiddenFail);
    const allowedPx: string[] = [];
    const outsideHidden: string[] = [];
    for (const fl of hid9) {
      const m = mainTriAt(fl);
      const pixelLine = `(${fl.tri}) px=(${fl.x},${fl.y}) main-first=${m ? `${m.cls} ${m.tri}` : "miss"}`;
      if (m && m.cls === "hidden" && S9_L.has(m.tri)) allowedPx.push(pixelLine);
      else outsideHidden.push(pixelLine);
    }
    // eslint-disable-next-line no-console
    console.log(`S9 C1 hidden: fail=${hid9.length} allowed(L-px)=${allowedPx.length} outside=${outsideHidden.length}`);
    for (const l of allowedPx) {
      // eslint-disable-next-line no-console
      console.log(`S9 C1 allowed ${l} (main lit RGB follows in CAP2)`);
    }
    // eslint-disable-next-line no-console
    console.log(`S9 C1 outside-hidden e.g. ${JSON.stringify(outsideHidden.slice(0, 5))}`);
    expect(rimOnlyS9.length, "S9 C1: no new rim px vs S5 (structural set identical)").toBe(0);
    expect(rimOnlyS5.length, "S9 C1: no lost rim px vs S5 (same verts, same framing)").toBe(0);
    expect(outsideHidden.length, "S9 C1: no hidden fail outside dropped-L px").toBe(0);
    expect(allowedPx.length, "S9 C1: allowed L-hidden fails at most 13").toBeLessThanOrEqual(13);
  }, 1_500_000);

  // S10h2/B5: machine-local (needs the store-only S5 7c9545a7 GLB) -> skips on clean clones (MADR 0065).
  it.runIf(existsSync(S9_S5))("C2' SHIRT STAYS SHIRT: widened boxes at grade + product-near0.1 ties, S5 side by side", async () => {
    const k1 = await sceneFor(mainGlbPath(), "front");
    const k2 = await sceneFor(mainGlbPath(), "three_quarter");
    const posedMain = await s9PosedFor(mainGlbPath());
    const posedS5 = await s9PosedFor(S9_S5);
    const posedS9 = await s9PosedFor(KEVIN_GLB);
    for (const p of [posedMain, posedS5, posedS9]) {
      p.model.scale.copy(k1.model.scale);
      p.model.position.copy(k1.model.position);
      p.model.updateMatrixWorld(true);
    }
    const cams: Record<string, PerspectiveCamera> = { front: k1.camera, three_quarter: k2.camera };

    async function shirtSite(view: "three_quarter" | "front"): Promise<Array<[number, number]>> {
      const cam = cams[view]!;
      const out: Array<[number, number]> = [];
      for (const [x0, y0, x1, y1] of S9_BOXES_C2P[view]!) {
        for (let y = y0; y <= y1; y += S9_STRIDE) {
          for (let x = x0; x <= x1; x += S9_STRIDE) {
            const mh = s9FullHits(posedMain, cam, x, y);
            if (mh.length === 0) continue;
            const mFirst = mh.find((h) => s9IsShirt(h) && h.dotWind < 0);
            if (!mFirst) continue;
            if (mh[0] !== mFirst) continue;
            out.push([x, y]);
          }
        }
      }
      return out;
    }

    async function evalC2p(
      label: string,
      posed: S9Posed,
      site: Array<[number, number]>,
      view: "three_quarter" | "front",
      tie: number,
    ): Promise<Array<{ x: number; y: number; why: string; tri: string }>> {
      const cam = cams[view]!;
      const fails: Array<{ x: number; y: number; why: string; tri: string }> = [];
      for (const [x, y] of site) {
        const sh = s9FullHits(posed, cam, x, y);
        if (sh.length === 0) {
          fails.push({ x, y, why: "miss", tri: "-" });
          continue;
        }
        const first = sh[0]!;
        if (!(s9IsShirt(first) && first.dotWind < 0)) {
          fails.push({ x, y, why: `first-not-shirt:${first.meshName}#${first.prim}:${first.face}`, tri: `${first.prim}:${first.face}` });
          continue;
        }
        const near = sh.find((h) => s9IsBodySkin(h) && Math.abs(h.t - first.t) <= tie);
        if (near) {
          fails.push({ x, y, why: `body-near:${near.meshName}#${near.prim}:${near.face}:gap=${(first.t - near.t).toFixed(4)}`, tri: `${near.prim}:${near.face}` });
        }
      }
      // eslint-disable-next-line no-console
      console.log(`S9 C2' ${label} ${view} tie=${tie.toExponential(3)} site=${site.length} fail=${fails.length} e.g. ${JSON.stringify(fails.slice(0, 5))}`);
      return fails;
    }

    const c2Summary: {
      ties: { grade: number; pnear01: number };
      views: Record<string, { site: number; ties: Record<string, { main: number; s5: number; s9: number; s9first5: unknown }> }>;
      lDetail: Array<Record<string, unknown>>;
      poke: Record<string, unknown> | null;
    } = {
      ties: { grade: S9_TIE_GRADE, pnear01: S9_TIE_PNEAR01 },
      views: {},
      lDetail: [],
      poke: null,
    };

    for (const view of ["three_quarter", "front"] as const) {
      const site = await shirtSite(view);
      // eslint-disable-next-line no-console
      console.log(`S9 C2' ${view} shirt-site=${site.length}`);
      c2Summary.views[view] = { site: site.length, ties: {} };
      for (const [tieLabel, tie] of [["grade", S9_TIE_GRADE], ["product-near0.1", S9_TIE_PNEAR01]] as const) {
        const fMain = await evalC2p(`main@${tieLabel}`, posedMain, site, view, tie);
        expect(fMain.length, `known-good main C2' ${view} @${tieLabel} is 0`).toBe(0);
        const fS5 = await evalC2p(`S5@${tieLabel}`, posedS5, site, view, tie);
        const fS9 = await evalC2p(`S9@${tieLabel}`, posedS9, site, view, tie);
        c2Summary.views[view]!.ties[tieLabel] = { main: fMain.length, s5: fS5.length, s9: fS9.length, s9first5: fS9.slice(0, 5) };
        if (view === "three_quarter" && tieLabel === "grade") {
          expect(fS5.length, "S5 C2' RED baseline (36 tq at grade tie)").toBe(36);
        }
        if (view === "front") {
          expect(fS5.length, `S5 C2' front @${tieLabel} is 0`).toBe(0);
        }
        expect(fS9.length, `S9 candidate C2' ${view} @${tieLabel} is 0`).toBe(0);
      }
      // L-owned S5 fails: candidate first hit there must be shirt, no body within either tie.
      if (view === "three_quarter") {
        const siteQ = site;
        const fS5g = await evalC2p("S5@grade-detail", posedS5, siteQ, view, S9_TIE_GRADE);
        for (const fl of fS5g) {
          const cand = s9FullHits(posedS9, cams[view]!, fl.x, fl.y);
          const cFirst = cand[0];
          const cDesc = cFirst
            ? `${cFirst.cls} ${cFirst.meshName}#${cFirst.prim}:${cFirst.face} dotWind=${cFirst.dotWind.toFixed(3)}`
            : "miss";
          const cNearG = cFirst ? cand.find((h) => s9IsBodySkin(h) && Math.abs(h.t - cFirst.t) <= S9_TIE_GRADE) : undefined;
          const cNearP = cFirst ? cand.find((h) => s9IsBodySkin(h) && Math.abs(h.t - cFirst.t) <= S9_TIE_PNEAR01) : undefined;
          // eslint-disable-next-line no-console
          console.log(
            `S9 C2' L-detail S5fail px=(${fl.x},${fl.y}) S5tri=${fl.tri} why=${fl.why} | S9-first=${cDesc} bodyWithinGrade=${cNearG ? `${cNearG.meshName}#${cNearG.prim}:${cNearG.face}` : "none"} bodyWithinPnear01=${cNearP ? `${cNearP.meshName}#${cNearP.prim}:${cNearP.face}` : "none"}`,
          );
          c2Summary.lDetail.push({
            px: [fl.x, fl.y],
            s5tri: fl.tri,
            s5why: fl.why,
            s9first: cDesc,
            bodyWithinGrade: cNearG ? `${cNearG.meshName}#${cNearG.prim}:${cNearG.face}` : null,
            bodyWithinPnear01: cNearP ? `${cNearP.meshName}#${cNearP.prim}:${cNearP.face}` : null,
          });
          expect(cFirst && s9IsShirt(cFirst) && cFirst.dotWind < 0, `S9 first hit at S5-fail px (${fl.x},${fl.y}) is shirt`).toBe(true);
          expect(cNearG, `no body within grade tie at (${fl.x},${fl.y})`).toBe(undefined);
          expect(cNearP, `no body within product-near0.1 tie at (${fl.x},${fl.y})`).toBe(undefined);
        }
      }
    }

    // C2b B1 poke: px (2416,1400) tq must be shirt-first, no body within either tie.
    {
      const cam = cams["three_quarter"]!;
      const cand = s9FullHits(posedS9, cam, 2416, 1400);
      const cFirst = cand[0];
      const cDesc = cFirst
        ? `${cFirst.cls} ${cFirst.meshName}#${cFirst.prim}:${cFirst.face} gap-detail`
        : "miss";
      const cNearG = cFirst ? cand.find((h) => s9IsBodySkin(h) && Math.abs(h.t - cFirst.t) <= S9_TIE_GRADE) : undefined;
      const cNearP = cFirst ? cand.find((h) => s9IsBodySkin(h) && Math.abs(h.t - cFirst.t) <= S9_TIE_PNEAR01) : undefined;
      // eslint-disable-next-line no-console
      console.log(
        `S9 C2b poke (2416,1400) S9-first=${cDesc} bodyWithinGrade=${cNearG ? `${cNearG.meshName}#${cNearG.prim}:${cNearG.face} gap=${((cFirst?.t ?? 0) - cNearG.t).toFixed(4)}` : "none"} bodyWithinPnear01=${cNearP ? `${cNearP.meshName}#${cNearP.prim}:${cNearP.face}` : "none"}`,
      );
      expect(cFirst && s9IsShirt(cFirst) && cFirst.dotWind < 0, "C2b poke px is shirt-first on S9").toBe(true);
      expect(cNearG, "C2b poke px has no body within grade tie").toBe(undefined);
      expect(cNearP, "C2b poke px has no body within product-near0.1 tie").toBe(undefined);
      c2Summary.poke = {
        px: [2416, 1400],
        s9first: cDesc,
        bodyWithinGrade: cNearG ? `${cNearG.meshName}#${cNearG.prim}:${cNearG.face}` : null,
        bodyWithinPnear01: cNearP ? `${cNearP.meshName}#${cNearP.prim}:${cNearP.face}` : null,
      };
      writeFileSync(`${S10H2_WORK}/s10h2-s9-c2p.json`, JSON.stringify(c2Summary, null, 1));
    }
  }, 1_500_000);

  // S10h2/B5: list + census come from the tracked held-out fixture (runs on
  // clean clones); the store-only s9-c3.json record check is the next clause.
  it("C3 HELD-OUT: S9 fixed-count rule VOID (inverted guard per cap41 S10-1 ruling, MADR 0065)", async () => {
    const held = readFixture(FIX_HELDOUT_CENSUS) as FixtureBody & {
      list: { count: number; entries: Array<{ label: string; azDeg: number; elDeg: number; r: number }> };
      censusRows: Array<{ label: string; site: number }>;
      heldOut: string[];
    };
    guardFixture("C3 held-out", held);
    expect(held.list.count, "S10 held-out list has 15 directions").toBe(15);
    expect(held.list.entries.length, "S10 held-out list entries length").toBe(15);
    const byLabel = new Map(held.censusRows.map((r) => [r.label, r.site] as [string, number]));
    for (const [label, site] of Object.entries(S10_EXPECT_SITE)) {
      expect(
        byLabel.get(label),
        `main census ${label} reproduces the S10 C3b main-only count (cap41 S10-1 RUL2)`,
      ).toBe(site);
    }
    // INVERTED GUARD: the S9 ">= 4 non-vacuous" / C3b ">= 6" fixed-count rule is VOID.
    // Per cap41 S10-1 ruling (MADR 0065): the held-out set is the 5 non-vacuous
    // directions of a 15-direction list fixed before measurement; a fixed count of 6
    // had no source, because the population is the forward-facing opening and 10 of
    // 15 directions are vacuous by geometry. E-front-high-18 (4 px) is report-only.
    const nonVac = held.censusRows.filter((r) => r.site > 0);
    expect(
      nonVac.length,
      "INVERTED GUARD (cap41 S10-1 RUL2, MADR 0065): exactly the 5 non-vacuous dirs exist; the S9 >=4 / C3b >=6 fixed-count rule is void and must not be re-imposed",
    ).toBe(5);
    expect(
      held.heldOut,
      "INVERTED GUARD (cap41 S10-1 RUL2, MADR 0065): held-out order is the 4 carrying dirs + report-only E-front-high-18",
    ).toEqual([...S10_CARRY, S10_REPORT_ONLY]);
  }, 60_000);

  // S10h2/B5: the S9 store record stands as a machine-local check (MADR 0065) -> skips on clean clones.
  it.runIf(existsSync(S9_C3_JSON))("C3 store record: S9 s9-c3.json stands at 2/6 non-vacuous (machine-local, MADR 0065)", async () => {
    const s9c3 = JSON.parse(readFileSync(S9_C3_JSON, "utf8")) as { nonVacuous: number };
    expect(
      s9c3.nonVacuous,
      "S9 C3 record stands at 2/6 non-vacuous (RESULT-s9 STOP; superseded by the cap41 S10-1 ruling, not re-measured here)",
    ).toBe(2);
  }, 60_000);

  // S10e SUPERSEDED (cap41 RULING 2 replaced the C3c allowance with F3 parity +
  // F1 fill floor; RULING 3 amended F1(b)): skipped so full-suite runs neither
  // re-litigate the old allowance nor overwrite E/s10c (WRITE-ONCE). RED record
  // stands in RESULT-s10b.md + E/s10c/work/s10-c3c.json.
  it.skip("C3' HELD-OUT (fixed 15-list, 4 carrying dirs) + C3d keep-L counterweight", async () => {
    const list = JSON.parse(readFileSync(S10_LIST, "utf8")) as {
      entries: Array<{ label: string; azDeg: number; elDeg: number; r: number }>;
    };
    const dirs = list.entries.filter(
      (e) => S10_CARRY.includes(e.label) || e.label === S10_REPORT_ONLY,
    );
    expect(dirs.length, "C3' reads the 4 carrying dirs + report-only E-front-high-18 from the fixed list").toBe(5);
    const census = JSON.parse(readFileSync(S10_CENSUS, "utf8")) as {
      rows: Array<{ label: string; site: number }>;
    };
    const censusSite = new Map(census.rows.map((r) => [r.label, r.site]));
    const k1 = await sceneFor(mainGlbPath(), "front");
    const posedMain = await s9PosedFor(mainGlbPath());
    const posedS5 = await s9PosedFor(S9_S5);
    const posedS9 = await s9PosedFor(KEVIN_GLB);
    const posedCW = await s9PosedFor(S9_CW132);
    for (const p of [posedMain, posedS5, posedS9, posedCW]) {
      p.model.scale.copy(k1.model.scale);
      p.model.position.copy(k1.model.position);
      p.model.updateMatrixWorld(true);
    }
    const names = new Set<string>();
    for (const c of (posedMain.model as unknown as { children: Mesh[] }).children) {
      names.add(String((c.userData as Record<string, unknown>)["meshName"]));
    }
    const bodyMesh = [...names].find((n) => n.startsWith(S9_BODY_PREFIX))!;
    const assetsS5 = await s9SubjAssets(S9_S5, bodyMesh);
    const assetsS9 = await s9SubjAssets(KEVIN_GLB, bodyMesh);
    const assetsCW = await s9SubjAssets(S9_CW132, bodyMesh);
    const selMap = JSON.parse(readFileSync(
      S9_SELECTED,
      "utf8",
    )) as Record<string, number[]>;
    const byKey = new Map<number, Mesh>();
    for (const c of (posedMain.model as unknown as { children: Mesh[] }).children) {
      const ud = (c.userData ?? {}) as Record<string, unknown>;
      if (String(ud["meshName"]) === bodyMesh) byKey.set(Number(ud["primIndex"]), c);
    }
    const centroids: Vector3[] = [];
    for (const [pStr, faces] of Object.entries(selMap)) {
      const mesh = byKey.get(Number(pStr));
      if (!mesh) continue;
      const pos = mesh.geometry.getAttribute("position") as unknown as {
        getX(i: number): number;
        getY(i: number): number;
        getZ(i: number): number;
      };
      const idx = mesh.geometry.getIndex()!;
      for (const s of faces) {
        const a = idx.getX(s * 3);
        const b = idx.getX(s * 3 + 1);
        const cc = idx.getX(s * 3 + 2);
        centroids.push(
          new Vector3(
            (pos.getX(a) + pos.getX(b) + pos.getX(cc)) / 3,
            (pos.getY(a) + pos.getY(b) + pos.getY(cc)) / 3,
            (pos.getZ(a) + pos.getZ(b) + pos.getZ(cc)) / 3,
          ),
        );
      }
    }
    expect(centroids.length, "SELECTED centroids").toBe(126);
    const framed = new Box3();
    const tmpV = new Vector3();
    for (const c of (posedMain.model as unknown as { children: Mesh[] }).children) {
      const pos = c.geometry.getAttribute("position") as unknown as {
        count: number;
        getX(i: number): number;
        getY(i: number): number;
        getZ(i: number): number;
      };
      for (let i = 0; i < pos.count; i++) {
        tmpV.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(c.matrixWorld);
        framed.expandByPoint(tmpV);
      }
    }
    const center = framed.getCenter(new Vector3());
    const HIMG = 1024;
    const HSTRIDE = 4;
    const HMARGIN = 40;
    type C1R = { fails: number; hidden: string[]; rim: number; rimEg: unknown };
    async function evalC1(
      posed: S9Posed, assets: S9Subj, cam: PerspectiveCamera, site: Array<[number, number]>,
    ): Promise<C1R> {
      const fails: Array<{ x: number; y: number; why: string; tri: string }> = [];
      for (const [x, y] of site) {
        s9Ndc.set(((x + 0.5) / HIMG) * 2 - 1, -((y + 0.5) / HIMG) * 2 + 1);
        s9Raycaster.setFromCamera(s9Ndc, cam);
        const rayDir = s9Raycaster.ray.direction.clone().normalize();
        const raw = s9Raycaster.intersectObject(posed.model, true);
        sortHitsBruteForceOrder(posed.model, raw);
        if (raw.length === 0) {
          fails.push({ x, y, why: "miss", tri: "-" });
          continue;
        }
        const hit = raw[0]!;
        const mesh = hit.object as Mesh;
        const ud = (mesh.userData ?? {}) as Record<string, unknown>;
        const cls = classifyNurseWaistHit(mesh.name, String(ud["matName"] ?? ""), String(ud["alphaMode"] ?? "OPAQUE"));
        const tri = `${String(ud["primIndex"])}:${String(hit.faceIndex)}`;
        if (hit.faceIndex == null || hit.faceIndex < 0) {
          fails.push({ x, y, why: "no-face", tri });
          continue;
        }
        s9FaceNormal(mesh, hit.faceIndex, s9Fn);
        if (cls !== "skin" || String(ud["meshName"]) !== bodyMesh || s9Fn.dot(rayDir) >= 0) {
          fails.push({ x, y, why: `cls=${cls}`, tri });
          continue;
        }
        const ds = s9ShadeDot(mesh, hit.faceIndex, hit.point.clone(), rayDir);
        if (ds <= 0) {
          fails.push({ x, y, why: `dotShade=${ds.toFixed(3)}`, tri });
          continue;
        }
        const tex = s9TexelAt(assets.skin, mesh, hit.faceIndex, hit.point.clone());
        if (!tex || Math.max(...tex) < S9_PAD_T) {
          fails.push({ x, y, why: `texelMax=${tex ? Math.max(...tex) : -1}`, tri });
          continue;
        }
        const area = assets.uvAreas.get(tri) ?? -1;
        if (area < S9_FLOOR) {
          fails.push({ x, y, why: `uvArea=${area.toFixed(3)}`, tri });
        }
      }
      return {
        fails: fails.length,
        hidden: fails.filter((fl) => fl.why.startsWith("cls=hidden")).map((fl) => `(${fl.tri}) px=(${fl.x},${fl.y})`),
        rim: fails.filter((fl) => !fl.why.startsWith("cls=hidden")).length,
        rimEg: fails.filter((fl) => !fl.why.startsWith("cls=hidden")).slice(0, 3),
      };
    }
    async function evalC2p(
      posed: S9Posed, cam: PerspectiveCamera, shirt: Array<[number, number]>, tie: number,
    ): Promise<number> {
      let fail = 0;
      for (const [x, y] of shirt) {
        s9Ndc.set(((x + 0.5) / HIMG) * 2 - 1, -((y + 0.5) / HIMG) * 2 + 1);
        s9Raycaster.setFromCamera(s9Ndc, cam);
        const raw = s9Raycaster.intersectObject(posed.model, true);
        sortHitsBruteForceOrder(posed.model, raw);
        if (raw.length === 0) {
          fail++;
          continue;
        }
        const hit = raw[0]!;
        const mesh = hit.object as Mesh;
        const ud = (mesh.userData ?? {}) as Record<string, unknown>;
        const cls = classifyNurseWaistHit(mesh.name, String(ud["matName"] ?? ""), String(ud["alphaMode"] ?? "OPAQUE"));
        if (hit.faceIndex == null || hit.faceIndex < 0) {
          fail++;
          continue;
        }
        s9FaceNormal(mesh, hit.faceIndex, s9Fn);
        const rayDir = s9Raycaster.ray.direction.clone().normalize();
        if (cls !== "shirt" || s9Fn.dot(rayDir) >= 0) {
          fail++;
          continue;
        }
        const tS = hit.distance;
        for (const r of raw.slice(1)) {
          const rm = r.object as Mesh;
          const rud = (rm.userData ?? {}) as Record<string, unknown>;
          if (!(/kevin_body/.test(String(rud["meshName"])) && /skin/.test(String(rud["matName"] ?? "")))) continue;
          if (Math.abs(r.distance - tS) <= tie) {
            fail++;
            break;
          }
        }
      }
      return fail;
    }
    const outRows: Array<Record<string, unknown>> = [];
    const c3dRed: string[] = [];
    const c3cRed: string[] = [];
    for (const h of dirs) {
      const reportOnly = h.label === S10_REPORT_ONLY;
      const az = (h.azDeg * Math.PI) / 180;
      const el = (h.elDeg * Math.PI) / 180;
      const dir = new Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
      const cam = new PerspectiveCamera(35, 1, 0.01, 100);
      cam.position.copy(center).add(dir.clone().multiplyScalar(h.r));
      cam.lookAt(center);
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();
      let x0 = HIMG;
      let y0 = HIMG;
      let x1 = -1;
      let y1 = -1;
      const pr = new Vector3();
      const ref = [...(posedMain.model as unknown as { children: Mesh[] }).children][0]!;
      for (const c of centroids) {
        pr.copy(c).applyMatrix4(ref.matrixWorld).project(cam);
        if (pr.z > 1 || pr.z < -1) continue;
        const x = Math.floor(((pr.x + 1) / 2) * HIMG);
        const y = Math.floor(((1 - pr.y) / 2) * HIMG);
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
      x0 = Math.max(0, x0 - HMARGIN);
      y0 = Math.max(0, y0 - HMARGIN);
      x1 = Math.min(HIMG - 1, x1 + HMARGIN);
      y1 = Math.min(HIMG - 1, y1 + HMARGIN);
      expect(x1 >= x0 && y1 >= y0, `C3' ${h.label}: SELECTED bbox projects (non-vacuous by census)`).toBe(true);
      const site: Array<[number, number]> = [];
      const shirt: Array<[number, number]> = [];
      for (let y = y0; y <= y1; y += HSTRIDE) {
        for (let x = x0; x <= x1; x += HSTRIDE) {
          s9Ndc.set(((x + 0.5) / HIMG) * 2 - 1, -((y + 0.5) / HIMG) * 2 + 1);
          s9Raycaster.setFromCamera(s9Ndc, cam);
          const rayDir = s9Raycaster.ray.direction.clone().normalize();
          const raw = s9Raycaster.intersectObject(posedMain.model, true);
          sortHitsBruteForceOrder(posedMain.model, raw);
          if (raw.length === 0) continue;
          const first = raw[0]!;
          const ud = ((first.object as Mesh).userData ?? {}) as Record<string, unknown>;
          const cls = classifyNurseWaistHit(
            (first.object as Mesh).name,
            String(ud["matName"] ?? ""),
            String(ud["alphaMode"] ?? "OPAQUE"),
          );
          if (cls === "hidden" && String(ud["meshName"]) === bodyMesh) {
            site.push([x, y]);
          } else if (cls === "shirt" && first.faceIndex != null && first.faceIndex >= 0) {
            s9FaceNormal(first.object as Mesh, first.faceIndex, s9Fn);
            if (s9Fn.dot(rayDir) < 0) shirt.push([x, y]);
          }
        }
      }
      // eslint-disable-next-line no-console
      console.log(`S10 C3' ${h.label}: main site=${site.length} (census ${String(censusSite.get(h.label))}) shirt=${shirt.length}${reportOnly ? " REPORT-ONLY" : ""}`);
      expect(site.length, `C3' ${h.label}: live main site reproduces the fixed main census`).toBe(censusSite.get(h.label));
      const c1s5 = await evalC1(posedS5, assetsS5, cam, site);
      const c1c = await evalC1(posedS9, assetsS9, cam, site);
      const c2s5g = await evalC2p(posedS5, cam, shirt, S9_TIE_GRADE);
      const c2s5p = await evalC2p(posedS5, cam, shirt, S9_TIE_PNEAR01);
      const c2cg = await evalC2p(posedS9, cam, shirt, S9_TIE_GRADE);
      const c2cp = await evalC2p(posedS9, cam, shirt, S9_TIE_PNEAR01);
      const c1cw = await evalC1(posedCW, assetsCW, cam, site);
      const c2cwg = await evalC2p(posedCW, cam, shirt, S9_TIE_GRADE);
      // eslint-disable-next-line no-console
      console.log(
        `S10 C3' ${h.label}: S5 C1fail=${c1s5.fails} (hidden ${c1s5.hidden.length} rim ${c1s5.rim}) C2' g/pnear=${c2s5g}/${c2s5p} | CAND C1fail=${c1c.fails} (hidden ${c1c.hidden.length} rim ${c1c.rim}) C2' g/pnear=${c2cg}/${c2cp} | CW132 C1fail=${c1cw.fails} C2'g=${c2cwg}`,
      );
      const allowedH: string[] = [];
      const outsideH: string[] = [];
      for (const hiddenLine of c1c.hidden) {
        const m = hiddenLine.match(/px=\((\d+),(\d+)\)/);
        const key = `${h.label}@${m ? `${m[1]},${m[2]}` : "?"}`;
        s9Ndc.set(((Number(m?.[1]) + 0.5) / HIMG) * 2 - 1, -((Number(m?.[2]) + 0.5) / HIMG) * 2 + 1);
        s9Raycaster.setFromCamera(s9Ndc, cam);
        const raw = s9Raycaster.intersectObject(posedMain.model, true);
        sortHitsBruteForceOrder(posedMain.model, raw);
        const mh = raw[0];
        let mOk = false;
        let mLine = "miss";
        if (mh && mh.faceIndex != null && mh.faceIndex >= 0) {
          const mm = mh.object as Mesh;
          const mud = (mm.userData ?? {}) as Record<string, unknown>;
          const mcls = classifyNurseWaistHit(mm.name, String(mud["matName"] ?? ""), String(mud["alphaMode"] ?? "OPAQUE"));
          const mtri = `${String(mud["primIndex"])}:${String(mh.faceIndex)}`;
          mLine = `${mcls} ${mtri}`;
          mOk = mcls === "hidden" && S9_L.has(mtri);
        }
        const full = `${hiddenLine} main-first=${mLine}`;
        if (mOk) allowedH.push(full);
        else if (S10_ALLOW_OUTSIDE.has(key)) allowedH.push(`${full} KNOWN-RESIDUAL`);
        else outsideH.push(full);
      }
      // eslint-disable-next-line no-console
      console.log(`S10 C3' ${h.label}: CAND allowed=${allowedH.length} outside=${outsideH.length} rim=${c1c.rim} rimEg=${JSON.stringify(c1c.rimEg)}`);
      for (const l of allowedH) {
        // eslint-disable-next-line no-console
        console.log(`S10 C3' ${h.label} allowed ${l}`);
      }
      for (const l of outsideH) {
        // eslint-disable-next-line no-console
        console.log(`S10 C3' ${h.label} OUTSIDE-HIDDEN ${l}`);
      }
      outRows.push({
        dir: h.label,
        reportOnly,
        site: site.length,
        shirt: shirt.length,
        s5: { c1fail: c1s5.fails, c1hidden: c1s5.hidden.length, c1rim: c1s5.rim, c2g: c2s5g, c2p: c2s5p },
        cand: { c1fail: c1c.fails, allowed: allowedH, outside: outsideH, rim: c1c.rim, rimEg: c1c.rimEg, c2g: c2cg, c2p: c2cp },
        cw132: { c1fail: c1cw.fails, c1hidden: c1cw.hidden.length, c1rim: c1cw.rim, c2g: c2cwg },
      });
      if (!reportOnly && (c1cw.fails > 0 || c2cwg > 0)) c3dRed.push(`${h.label}(C1fail=${c1cw.fails},C2'g=${c2cwg})`);
      if (!reportOnly) {
        if (outsideH.length > 0) c3cRed.push(`${h.label}: outside-hidden ${outsideH.length} e.g. ${outsideH.slice(0, 3).join(" | ")}`);
        if (allowedH.length > 13) c3cRed.push(`${h.label}: allowed-hidden ${allowedH.length} > 13`);
        if (c2cg > 0) c3cRed.push(`${h.label}: C2' grade-tie fails ${c2cg}`);
        if (c2cp > 0) c3cRed.push(`${h.label}: C2' product-near0.1-tie fails ${c2cp}`);
      }
    }
    writeFileSync(S10_C3C_OUT, JSON.stringify({ rows: outRows, c3dRed, c3cRed }, null, 1));
    // eslint-disable-next-line no-console
    console.log(`S10 C3c: ${c3cRed.length === 0 ? "GREEN on all 4 carrying dirs" : `RED: ${c3cRed.join(" | ")}`}`);
    if (c3dRed.length === 0) {
      // eslint-disable-next-line no-console
      console.log("S10 C3d: C3' does not see L (keep-L SELECTED=132 GREEN on all 4 carrying dirs; C4(i) remains the L guard; report, do not STOP)");
    } else {
      // eslint-disable-next-line no-console
      console.log(`S10 C3d: keep-L SELECTED=132 RED on ${c3dRed.length}/4 carrying dirs: ${c3dRed.join(" | ")}`);
      expect(c3dRed.length, "C3d keep-L SELECTED=132 goes RED on >= 1 of the 4 carrying dirs").toBeGreaterThan(0);
    }
    expect(c3cRed, "C3c: no C1/C2' fail px outside the allowance on the 4 carrying dirs (STOP to cap41 with px, tri, main first-hit class)").toEqual([]);
  }, 1_500_000);

  // S10e SUPERSEDED (cap41 RULING 3 supersedes RULING 2 F1(b): the (b) premise
  // "S5 tri 1:210" was cap41's error, measurement shows S5 fills via 8:70):
  // skipped so full-suite runs neither re-litigate the old exclusion nor
  // overwrite E/s10d (WRITE-ONCE). RED record stands in RESULT-s10c.md +
  // E/s10d/work/s10-f1f3.json. Operative gate is the S10e test below.
  it.skip("S10d F1 fill floor + F3 parity class (cap41 RULING 2; supersedes RUL3/C3c)", async () => {
    const listRaw = readFileSync(S10_LIST);
    expect(createHash("sha256").update(listRaw).digest("hex"), "S10d held-out list sha256 is the pre-measurement fixed list (cap41 S10-1 RUL1)").toBe(S10_LIST_SHA);
    const list = JSON.parse(listRaw.toString("utf8")) as {
      entries: Array<{ label: string; azDeg: number; elDeg: number; r: number }>;
    };
    const dirs = list.entries.filter(
      (e) => S10_CARRY.includes(e.label) || e.label === S10_REPORT_ONLY,
    );
    expect(dirs.length, "S10d reads the 4 carrying dirs + report-only E-front-high-18 from the fixed list").toBe(5);
    const census = JSON.parse(readFileSync(S10_CENSUS, "utf8")) as {
      rows: Array<{ label: string; site: number }>;
    };
    const censusSite = new Map(census.rows.map((r) => [r.label, r.site]));
    const k1 = await sceneFor(mainGlbPath(), "front");
    const posedMain = await s9PosedFor(mainGlbPath());
    const posedS5 = await s9PosedFor(S9_S5);
    const posedS9 = await s9PosedFor(KEVIN_GLB);
    const posedCW = await s9PosedFor(S9_CW132);
    for (const p of [posedMain, posedS5, posedS9, posedCW]) {
      p.model.scale.copy(k1.model.scale);
      p.model.position.copy(k1.model.position);
      p.model.updateMatrixWorld(true);
    }
    const names = new Set<string>();
    for (const c of (posedMain.model as unknown as { children: Mesh[] }).children) {
      names.add(String((c.userData as Record<string, unknown>)["meshName"]));
    }
    const bodyMesh = [...names].find((n) => n.startsWith(S9_BODY_PREFIX))!;
    const assetsS5 = await s9SubjAssets(S9_S5, bodyMesh);
    const assetsS9 = await s9SubjAssets(KEVIN_GLB, bodyMesh);
    const assetsMain = await s9SubjAssets(mainGlbPath(), bodyMesh);
    const assetsCW = await s9SubjAssets(S9_CW132, bodyMesh);
    const selMap = JSON.parse(readFileSync(
      S9_SELECTED,
      "utf8",
    )) as Record<string, number[]>;
    const byKey = new Map<number, Mesh>();
    for (const c of (posedMain.model as unknown as { children: Mesh[] }).children) {
      const ud = (c.userData ?? {}) as Record<string, unknown>;
      if (String(ud["meshName"]) === bodyMesh) byKey.set(Number(ud["primIndex"]), c);
    }
    const centroids: Vector3[] = [];
    for (const [pStr, faces] of Object.entries(selMap)) {
      const mesh = byKey.get(Number(pStr));
      if (!mesh) continue;
      const pos = mesh.geometry.getAttribute("position") as unknown as {
        getX(i: number): number; getY(i: number): number; getZ(i: number): number;
      };
      const idx = mesh.geometry.getIndex()!;
      for (const s of faces) {
        const a = idx.getX(s * 3);
        const b = idx.getX(s * 3 + 1);
        const cc = idx.getX(s * 3 + 2);
        centroids.push(new Vector3((pos.getX(a) + pos.getX(b) + pos.getX(cc)) / 3, (pos.getY(a) + pos.getY(b) + pos.getY(cc)) / 3, (pos.getZ(a) + pos.getZ(b) + pos.getZ(cc)) / 3));
      }
    }
    expect(centroids.length, "SELECTED centroids").toBe(126);
    const framed = new Box3();
    const tmpV = new Vector3();
    for (const c of (posedMain.model as unknown as { children: Mesh[] }).children) {
      const pos = c.geometry.getAttribute("position") as unknown as {
        count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number;
      };
      for (let i = 0; i < pos.count; i++) {
        tmpV.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(c.matrixWorld);
        framed.expandByPoint(tmpV);
      }
    }
    const center = framed.getCenter(new Vector3());
    const HIMG = 1024;
    const HSTRIDE = 4;
    const HMARGIN = 40;
    const fill = (inSite: boolean, c1pass: boolean): boolean => inSite && c1pass;
    type C1Detail = { pass: boolean; firstTri: string; firstCls: string; why: string };
    function evalC1Detail(posed: S9Posed, assets: S9Subj, cam: PerspectiveCamera, x: number, y: number): C1Detail {
      s9Ndc.set(((x + 0.5) / HIMG) * 2 - 1, -((y + 0.5) / HIMG) * 2 + 1);
      s9Raycaster.setFromCamera(s9Ndc, cam);
      const rayDir = s9Raycaster.ray.direction.clone().normalize();
      const raw = s9Raycaster.intersectObject(posed.model, true);
      sortHitsBruteForceOrder(posed.model, raw);
      if (raw.length === 0) return { pass: false, firstTri: "-", firstCls: "miss", why: "miss" };
      const hit = raw[0]!;
      const mesh = hit.object as Mesh;
      const ud = (mesh.userData ?? {}) as Record<string, unknown>;
      const cls = classifyNurseWaistHit(mesh.name, String(ud["matName"] ?? ""), String(ud["alphaMode"] ?? "OPAQUE"));
      const tri = `${String(ud["primIndex"])}:${String(hit.faceIndex)}`;
      if (hit.faceIndex == null || hit.faceIndex < 0) return { pass: false, firstTri: tri, firstCls: cls, why: "no-face" };
      s9FaceNormal(mesh, hit.faceIndex, s9Fn);
      if (cls !== "skin" || String(ud["meshName"]) !== bodyMesh || s9Fn.dot(rayDir) >= 0) {
        return { pass: false, firstTri: tri, firstCls: cls, why: `cls=${cls}` };
      }
      const ds = s9ShadeDot(mesh, hit.faceIndex, hit.point.clone(), rayDir);
      if (ds <= 0) return { pass: false, firstTri: tri, firstCls: cls, why: `dotShade=${ds.toFixed(3)}` };
      const tex = s9TexelAt(assets.skin, mesh, hit.faceIndex, hit.point.clone());
      if (!tex || Math.max(...tex) < S9_PAD_T) return { pass: false, firstTri: tri, firstCls: cls, why: `texelMax=${tex ? Math.max(...tex) : -1}` };
      const area = assets.uvAreas.get(tri) ?? -1;
      if (area < S9_FLOOR) return { pass: false, firstTri: tri, firstCls: cls, why: `uvArea=${area.toFixed(3)}` };
      return { pass: true, firstTri: tri, firstCls: cls, why: "pass" };
    }
    function mainFirst(cam: PerspectiveCamera, x: number, y: number): { cls: string; tri: string } {
      s9Ndc.set(((x + 0.5) / HIMG) * 2 - 1, -((y + 0.5) / HIMG) * 2 + 1);
      s9Raycaster.setFromCamera(s9Ndc, cam);
      const raw = s9Raycaster.intersectObject(posedMain.model, true);
      sortHitsBruteForceOrder(posedMain.model, raw);
      const mh = raw[0];
      if (!mh || mh.faceIndex == null || mh.faceIndex < 0) return { cls: "miss", tri: "-" };
      const mm = mh.object as Mesh;
      const mud = (mm.userData ?? {}) as Record<string, unknown>;
      const mcls = classifyNurseWaistHit(mm.name, String(mud["matName"] ?? ""), String(mud["alphaMode"] ?? "OPAQUE"));
      return { cls: mcls, tri: `${String(mud["primIndex"])}:${String(mh.faceIndex)}` };
    }
    async function evalC2pCount(posed: S9Posed, cam: PerspectiveCamera, shirt: Array<[number, number]>, tie: number): Promise<number> {
      let fail = 0;
      for (const [x, y] of shirt) {
        s9Ndc.set(((x + 0.5) / HIMG) * 2 - 1, -((y + 0.5) / HIMG) * 2 + 1);
        s9Raycaster.setFromCamera(s9Ndc, cam);
        const raw = s9Raycaster.intersectObject(posed.model, true);
        sortHitsBruteForceOrder(posed.model, raw);
        if (raw.length === 0) { fail++; continue; }
        const hit = raw[0]!;
        const mesh = hit.object as Mesh;
        const ud = (mesh.userData ?? {}) as Record<string, unknown>;
        const cls = classifyNurseWaistHit(mesh.name, String(ud["matName"] ?? ""), String(ud["alphaMode"] ?? "OPAQUE"));
        if (hit.faceIndex == null || hit.faceIndex < 0) { fail++; continue; }
        s9FaceNormal(mesh, hit.faceIndex, s9Fn);
        const rayDir = s9Raycaster.ray.direction.clone().normalize();
        if (cls !== "shirt" || s9Fn.dot(rayDir) >= 0) { fail++; continue; }
        const tS = hit.distance;
        for (const r of raw.slice(1)) {
          const rm = r.object as Mesh;
          const rud = (rm.userData ?? {}) as Record<string, unknown>;
          if (!(/kevin_body/.test(String(rud["meshName"])) && /skin/.test(String(rud["matName"] ?? "")))) continue;
          if (Math.abs(r.distance - tS) <= tie) { fail++; break; }
        }
      }
      return fail;
    }
    const outRows: Array<Record<string, unknown>> = [];
    const f3Red: string[] = [];
    const f1Red: string[] = [];
    const c3dRed: string[] = [];
    for (const h of dirs) {
      const reportOnly = h.label === S10_REPORT_ONLY;
      const az = (h.azDeg * Math.PI) / 180;
      const el = (h.elDeg * Math.PI) / 180;
      const dir = new Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
      const cam = new PerspectiveCamera(35, 1, 0.01, 100);
      cam.position.copy(center).add(dir.clone().multiplyScalar(h.r));
      cam.lookAt(center);
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();
      let x0 = HIMG;
      let y0 = HIMG;
      let x1 = -1;
      let y1 = -1;
      const pr = new Vector3();
      const ref = [...(posedMain.model as unknown as { children: Mesh[] }).children][0]!;
      for (const c of centroids) {
        pr.copy(c).applyMatrix4(ref.matrixWorld).project(cam);
        if (pr.z > 1 || pr.z < -1) continue;
        const x = Math.floor(((pr.x + 1) / 2) * HIMG);
        const y = Math.floor(((1 - pr.y) / 2) * HIMG);
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
      x0 = Math.max(0, x0 - HMARGIN);
      y0 = Math.max(0, y0 - HMARGIN);
      x1 = Math.min(HIMG - 1, x1 + HMARGIN);
      y1 = Math.min(HIMG - 1, y1 + HMARGIN);
      expect(x1 >= x0 && y1 >= y0, `S10d F1/F3 ${h.label}: SELECTED bbox projects`).toBe(true);
      const site: Array<[number, number]> = [];
      const shirt: Array<[number, number]> = [];
      for (let y = y0; y <= y1; y += HSTRIDE) {
        for (let x = x0; x <= x1; x += HSTRIDE) {
          s9Ndc.set(((x + 0.5) / HIMG) * 2 - 1, -((y + 0.5) / HIMG) * 2 + 1);
          s9Raycaster.setFromCamera(s9Ndc, cam);
          const rayDir = s9Raycaster.ray.direction.clone().normalize();
          const raw = s9Raycaster.intersectObject(posedMain.model, true);
          sortHitsBruteForceOrder(posedMain.model, raw);
          if (raw.length === 0) continue;
          const first = raw[0]!;
          const ud = ((first.object as Mesh).userData ?? {}) as Record<string, unknown>;
          const cls = classifyNurseWaistHit((first.object as Mesh).name, String(ud["matName"] ?? ""), String(ud["alphaMode"] ?? "OPAQUE"));
          if (cls === "hidden" && String(ud["meshName"]) === bodyMesh) site.push([x, y]);
          else if (cls === "shirt" && first.faceIndex != null && first.faceIndex >= 0) {
            s9FaceNormal(first.object as Mesh, first.faceIndex, s9Fn);
            if (s9Fn.dot(rayDir) < 0) shirt.push([x, y]);
          }
        }
      }
      // eslint-disable-next-line no-console
      console.log(`S10d F1/F3 ${h.label}: main site=${site.length} (census ${String(censusSite.get(h.label))}) shirt=${shirt.length}${reportOnly ? " REPORT-ONLY" : ""}`);
      expect(site.length, `S10d F1/F3 ${h.label}: live main site reproduces the fixed main census`).toBe(censusSite.get(h.label));
      const s5pass = new Map<string, C1Detail>();
      const candpass = new Map<string, C1Detail>();
      const mainpass = new Map<string, C1Detail>();
      for (const [x, y] of site) {
        const key = `${x},${y}`;
        s5pass.set(key, evalC1Detail(posedS5, assetsS5, cam, x, y));
        candpass.set(key, evalC1Detail(posedS9, assetsS9, cam, x, y));
        mainpass.set(key, evalC1Detail(posedMain, assetsMain, cam, x, y));
      }
      const s5fill = [...s5pass.entries()].filter(([, d]) => fill(true, d.pass)).map(([k]) => k);
      const candfill = [...candpass.entries()].filter(([, d]) => fill(true, d.pass)).map(([k]) => k);
      const candfillSet = new Set(candfill);
      const excludedA: string[] = [];
      const excludedB: string[] = [];
      const violations: string[] = [];
      for (const key of s5fill) {
        if (candfillSet.has(key)) continue;
        const s5d = s5pass.get(key)!;
        const candd = candpass.get(key)!;
        const [xs, ys] = key.split(",").map(Number);
        const mf = mainFirst(cam, xs!, ys!);
        if (S9_L.has(s5d.firstTri)) {
          excludedA.push(`(${key}) S5-first=${s5d.firstTri} cand-first=${candd.firstTri} main-first=${mf.cls} ${mf.tri} reason=a`);
          continue;
        }
        const bHit = S10D_PARITY_B.find((b) => b.dir === h.label && b.x === xs && b.y === ys);
        if (bHit && s5d.firstTri === bHit.s5tri) {
          excludedB.push(`(${key}) S5-first=${s5d.firstTri} cand-first=${candd.firstTri} main-first=${mf.cls} ${mf.tri} reason=b`);
          continue;
        }
        violations.push(`(${key}) S5-first=${s5d.firstTri} cand-first=${candd.firstTri}(${candd.why}) main-first=${mf.cls} ${mf.tri}`);
      }
      const f3allowed: string[] = [];
      const f3viol: string[] = [];
      for (const [key, candd] of candpass.entries()) {
        if (candd.pass) continue;
        const isHiddenFail = candd.why.startsWith("cls=hidden");
        if (!isHiddenFail) continue;
        const [xs, ys] = key.split(",").map(Number);
        const mf = mainFirst(cam, xs!, ys!);
        if (mf.cls === "hidden") f3allowed.push(`(${h.label},(${key}),cand ${candd.firstTri},main ${mf.tri})`);
        else f3viol.push(`(${h.label},(${key}),cand ${candd.firstTri},main ${mf.cls} ${mf.tri})`);
      }
      const c2s5g = await evalC2pCount(posedS5, cam, shirt, S9_TIE_GRADE);
      const c2s5p = await evalC2pCount(posedS5, cam, shirt, S9_TIE_PNEAR01);
      const c2cg = await evalC2pCount(posedS9, cam, shirt, S9_TIE_GRADE);
      const c2cp = await evalC2pCount(posedS9, cam, shirt, S9_TIE_PNEAR01);
      const c1cwFails: string[] = [];
      for (const [x, y] of site) {
        const d = evalC1Detail(posedCW, assetsCW, cam, x, y);
        if (!d.pass) c1cwFails.push(`(${x},${y}) ${d.firstTri} ${d.why}`);
      }
      const c2cwg = await evalC2pCount(posedCW, cam, shirt, S9_TIE_GRADE);
      // eslint-disable-next-line no-console
      console.log(`S10d ${h.label}: S5 fill=${s5fill.length} cand fill=${candfill.length} exclA=${excludedA.length} exclB=${excludedB.length} viol=${violations.length} | F3 allowed=${f3allowed.length} viol=${f3viol.length} | C2' S5 g/p=${c2s5g}/${c2s5p} CAND g/p=${c2cg}/${c2cp} | CW132 C1fail=${c1cwFails.length} C2'g=${c2cwg}${reportOnly ? " REPORT-ONLY" : ""}`);
      for (const l of f3allowed) { // eslint-disable-next-line no-console
        console.log(`S10d ${h.label} F3-allowed ${l}`); }
      for (const l of excludedA) { // eslint-disable-next-line no-console
        console.log(`S10d ${h.label} F1-excluded-a ${l}`); }
      for (const l of excludedB) { // eslint-disable-next-line no-console
        console.log(`S10d ${h.label} F1-excluded-b ${l}`); }
      for (const l of violations) { // eslint-disable-next-line no-console
        console.log(`S10d ${h.label} F1-VIOLATION ${l}`); }
      for (const l of f3viol) { // eslint-disable-next-line no-console
        console.log(`S10d ${h.label} F3-VIOLATION ${l}`); }
      const mainFillCount = [...mainpass.values()].filter((d) => fill(true, d.pass)).length;
      // eslint-disable-next-line no-console
      console.log(`S10d F2-plant main-as-candidate ${h.label}: substitution before=candidate ad61615d after=main 40492951 mainFill=${mainFillCount} S5fill=${s5fill.length} F1-RED=${mainFillCount < s5fill.length}`);
      outRows.push({
        dir: h.label, reportOnly, site: site.length, shirt: shirt.length,
        s5fill: s5fill.length, candfill: candfill.length, mainfill: mainFillCount,
        excludedA, excludedB, violations, f3allowed, f3viol,
        c2: { s5g: c2s5g, s5p: c2s5p, candg: c2cg, candp: c2cp },
        cw132: { c1fail: c1cwFails.length, c1eg: c1cwFails.slice(0, 3), c2g: c2cwg },
      });
      if (c1cwFails.length > 0 || c2cwg > 0) c3dRed.push(`${h.label}(C1fail=${c1cwFails.length},C2'g=${c2cwg})`);
      if (!reportOnly) {
        if (f3viol.length > 0) f3Red.push(`${h.label}: F3 violations ${f3viol.slice(0, 3).join(" | ")}`);
        if (c2cg > 0) f3Red.push(`${h.label}: C2' grade-tie fails ${c2cg}`);
        if (c2cp > 0) f3Red.push(`${h.label}: C2' product-near0.1-tie fails ${c2cp}`);
        if (violations.length > 0) f1Red.push(`${h.label}: F1 violations ${violations.slice(0, 3).join(" | ")}`);
        if (s5fill.length > 0 && mainFillCount >= s5fill.length) f1Red.push(`${h.label}: F2-plant main-as-candidate did not RED (mainFill=${mainFillCount} S5fill=${s5fill.length})`);
      }
    }
    // eslint-disable-next-line no-console
    console.log(`S10d F2-plant S5-as-candidate on C2': substitution before=candidate ad61615d after=S5 7c9545a7 (S9 widened boxes, expect RED as in S9 C2')`);
    {
      const k2 = await sceneFor(mainGlbPath(), "three_quarter");
      const posedS5b = await s9PosedFor(S9_S5);
      const posedMainb = await s9PosedFor(mainGlbPath());
      const cam = k2.camera;
      let siteQ = 0;
      let failQ = 0;
      for (const [x0, y0, x1, y1] of S9_BOXES_C2P["three_quarter"]!) {
        for (let y = y0; y <= y1; y += S9_STRIDE) {
          for (let x = x0; x <= x1; x += S9_STRIDE) {
            const mh = s9FullHits(posedMainb, cam, x, y);
            if (mh.length === 0) continue;
            const mFirst = mh.find((hh) => /scrub_shirt/.test(hh.matName) && hh.dotWind < 0);
            if (!mFirst || mh[0] !== mFirst) continue;
            siteQ++;
            const ch = s9FullHits(posedS5b, cam, x, y);
            if (ch.length === 0) { failQ++; continue; }
            const cFirst = ch[0]!;
            const cls0 = classifyNurseWaistHit(cFirst.mesh.name, cFirst.matName, "OPAQUE");
            if (cls0 !== "shirt" || cFirst.dotWind >= 0) { failQ++; continue; }
            const near = ch.find((hh) => /kevin_body/.test(hh.meshName) && /skin/.test(hh.matName) && Math.abs(hh.t - cFirst.t) <= S9_TIE_GRADE);
            if (near) failQ++;
          }
        }
      }
      // eslint-disable-next-line no-console
      console.log(`S10d F2-plant S5-as-candidate C2' tq: site=${siteQ} S5fail=${failQ} (S9 recorded main 0 / S5 36 RED)`);
      expect(failQ, "S10d F2-plant S5-as-candidate must RED on C2' (as in S9/S10b)").toBeGreaterThan(0);
      // eslint-disable-next-line no-console
      console.log(`Tests: S10d F2-plant S5-as-candidate C2' RED with S5fail=${failQ} on tq site=${siteQ}`);
    }
    writeFileSync(S10D_OUT, JSON.stringify({ rows: outRows, f3Red, f1Red, c3dRed }, null, 1));
    // eslint-disable-next-line no-console
    console.log(`S10d F3: ${f3Red.length === 0 ? "GREEN on all 4 carrying dirs" : `RED: ${f3Red.join(" | ")}`}`);
    // eslint-disable-next-line no-console
    console.log(`S10d F1: ${f1Red.length === 0 ? "GREEN on all 4 carrying dirs" : `RED: ${f1Red.join(" | ")}`}`);
    if (c3dRed.length === 0) {
      // eslint-disable-next-line no-console
      console.log("S10d C3d: C3' does not see L (keep-L SELECTED=132 GREEN on all 4 carrying dirs; C4(i) remains the L guard; report, do not STOP)");
    } else {
      // eslint-disable-next-line no-console
      console.log(`S10d C3d: keep-L SELECTED=132 RED on ${c3dRed.length}/4 carrying dirs: ${c3dRed.join(" | ")}`);
      expect(c3dRed.length, "S10d C3d keep-L SELECTED=132 goes RED on >= 1 of the 4 carrying dirs").toBeGreaterThan(0);
    }
    // eslint-disable-next-line no-console
    console.log(`Tests: S10d F1 fill floor GREEN with violations=0 on 4 carrying dirs (S5fill vs candfill per dir in ${S10D_OUT})`);
    // eslint-disable-next-line no-console
    console.log(`Tests: S10d F3 parity class GREEN with C2'=0 both ties on 4 carrying dirs (allowed px listed per dir in ${S10D_OUT})`);
    expect(f3Red, "S10d F3: parity class GREEN (any C1 fail where main first-hit is not hidden = STOP; C2'=0 both ties)").toEqual([]);
    expect(f1Red, "S10d F1: fill floor GREEN (every fill(S5) has fill(cand) except a|b)").toEqual([]);
  }, 1_500_000);

  // S10h2/B5: machine-local (needs store-only S5 7c9545a7 + CW132 GLBs) -> skips
  // on clean clones (MADR 0065). Closed lists come from tracked fixtures.
  it.runIf(existsSync(S9_S5) && existsSync(S9_CW132))("S10e F1b' fill floor + F3 parity class (cap41 RULING 3; supersedes RULING 2 F1(b))", async () => {
    const held = readFixture(FIX_HELDOUT_CENSUS) as FixtureBody & {
      list: { count: number; entries: Array<{ label: string; azDeg: number; elDeg: number; r: number }> };
      censusRows: Array<{ label: string; site: number }>;
    };
    guardFixture("S10e held-out", held);
    const dirs = held.list.entries.filter(
      (e) => S10_CARRY.includes(e.label) || e.label === S10_REPORT_ONLY,
    );
    expect(dirs.length, "S10e reads the 4 carrying dirs + report-only E-front-high-18 from the fixed list").toBe(5);
    const censusSite = new Map(held.censusRows.map((r) => [r.label, r.site]));
    const parity = readFixture(FIX_F1B_PARITY) as FixtureBody & { parityB: S10eParityB };
    guardFixture("S10e F1b'", parity);
    expect(parity.parityB.length, "S10e F1b' closed list is exactly the 2 px").toBe(2);
    const tOpenRaw = JSON.parse(readFileSync(S10E_TOPEN, "utf8")) as { unionOpen: string[] };
    const tOpen = new Set(tOpenRaw.unionOpen);
    expect(tOpen.size, "S10e T_open is the S7 v-select-65 set (132)").toBe(132);
    expect(tOpen.has("8:70"), "S10e T_open must NOT contain skin 8:70 (never selected)").toBe(false);
    const k1 = await sceneFor(mainGlbPath(), "front");
    const posedMain = await s9PosedFor(mainGlbPath());
    const posedS5 = await s9PosedFor(S9_S5);
    const posedS9 = await s9PosedFor(KEVIN_GLB);
    const posedCW = await s9PosedFor(S9_CW132);
    for (const p of [posedMain, posedS5, posedS9, posedCW]) {
      p.model.scale.copy(k1.model.scale);
      p.model.position.copy(k1.model.position);
      p.model.updateMatrixWorld(true);
    }
    const names = new Set<string>();
    for (const c of (posedMain.model as unknown as { children: Mesh[] }).children) {
      names.add(String((c.userData as Record<string, unknown>)["meshName"]));
    }
    const bodyMesh = [...names].find((n) => n.startsWith(S9_BODY_PREFIX))!;
    const assetsS5 = await s9SubjAssets(S9_S5, bodyMesh);
    const assetsS9 = await s9SubjAssets(KEVIN_GLB, bodyMesh);
    const assetsMain = await s9SubjAssets(mainGlbPath(), bodyMesh);
    const assetsCW = await s9SubjAssets(S9_CW132, bodyMesh);
    const selMap = JSON.parse(readFileSync(
      S9_SELECTED,
      "utf8",
    )) as Record<string, number[]>;
    const byKey = new Map<number, Mesh>();
    for (const c of (posedMain.model as unknown as { children: Mesh[] }).children) {
      const ud = (c.userData ?? {}) as Record<string, unknown>;
      if (String(ud["meshName"]) === bodyMesh) byKey.set(Number(ud["primIndex"]), c);
    }
    const centroids: Vector3[] = [];
    for (const [pStr, faces] of Object.entries(selMap)) {
      const mesh = byKey.get(Number(pStr));
      if (!mesh) continue;
      const pos = mesh.geometry.getAttribute("position") as unknown as {
        getX(i: number): number; getY(i: number): number; getZ(i: number): number;
      };
      const idx = mesh.geometry.getIndex()!;
      for (const s of faces) {
        const a = idx.getX(s * 3);
        const b = idx.getX(s * 3 + 1);
        const cc = idx.getX(s * 3 + 2);
        centroids.push(new Vector3((pos.getX(a) + pos.getX(b) + pos.getX(cc)) / 3, (pos.getY(a) + pos.getY(b) + pos.getY(cc)) / 3, (pos.getZ(a) + pos.getZ(b) + pos.getZ(cc)) / 3));
      }
    }
    expect(centroids.length, "SELECTED centroids").toBe(126);
    const framed = new Box3();
    const tmpV = new Vector3();
    for (const c of (posedMain.model as unknown as { children: Mesh[] }).children) {
      const pos = c.geometry.getAttribute("position") as unknown as {
        count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number;
      };
      for (let i = 0; i < pos.count; i++) {
        tmpV.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(c.matrixWorld);
        framed.expandByPoint(tmpV);
      }
    }
    const center = framed.getCenter(new Vector3());
    const HIMG = 1024;
    const HSTRIDE = 4;
    const HMARGIN = 40;
    const fill = (inSite: boolean, c1pass: boolean): boolean => inSite && c1pass;
    type C1Detail = { pass: boolean; firstTri: string; firstCls: string; why: string };
    function evalC1Detail(posed: S9Posed, assets: S9Subj, cam: PerspectiveCamera, x: number, y: number): C1Detail {
      s9Ndc.set(((x + 0.5) / HIMG) * 2 - 1, -((y + 0.5) / HIMG) * 2 + 1);
      s9Raycaster.setFromCamera(s9Ndc, cam);
      const rayDir = s9Raycaster.ray.direction.clone().normalize();
      const raw = s9Raycaster.intersectObject(posed.model, true);
      sortHitsBruteForceOrder(posed.model, raw);
      if (raw.length === 0) return { pass: false, firstTri: "-", firstCls: "miss", why: "miss" };
      const hit = raw[0]!;
      const mesh = hit.object as Mesh;
      const ud = (mesh.userData ?? {}) as Record<string, unknown>;
      const cls = classifyNurseWaistHit(mesh.name, String(ud["matName"] ?? ""), String(ud["alphaMode"] ?? "OPAQUE"));
      const tri = `${String(ud["primIndex"])}:${String(hit.faceIndex)}`;
      if (hit.faceIndex == null || hit.faceIndex < 0) return { pass: false, firstTri: tri, firstCls: cls, why: "no-face" };
      s9FaceNormal(mesh, hit.faceIndex, s9Fn);
      if (cls !== "skin" || String(ud["meshName"]) !== bodyMesh || s9Fn.dot(rayDir) >= 0) {
        return { pass: false, firstTri: tri, firstCls: cls, why: `cls=${cls}` };
      }
      const ds = s9ShadeDot(mesh, hit.faceIndex, hit.point.clone(), rayDir);
      if (ds <= 0) return { pass: false, firstTri: tri, firstCls: cls, why: `dotShade=${ds.toFixed(3)}` };
      const tex = s9TexelAt(assets.skin, mesh, hit.faceIndex, hit.point.clone());
      if (!tex || Math.max(...tex) < S9_PAD_T) return { pass: false, firstTri: tri, firstCls: cls, why: `texelMax=${tex ? Math.max(...tex) : -1}` };
      const area = assets.uvAreas.get(tri) ?? -1;
      if (area < S9_FLOOR) return { pass: false, firstTri: tri, firstCls: cls, why: `uvArea=${area.toFixed(3)}` };
      return { pass: true, firstTri: tri, firstCls: cls, why: "pass" };
    }
    function mainFirst(cam: PerspectiveCamera, x: number, y: number): { cls: string; tri: string } {
      s9Ndc.set(((x + 0.5) / HIMG) * 2 - 1, -((y + 0.5) / HIMG) * 2 + 1);
      s9Raycaster.setFromCamera(s9Ndc, cam);
      const raw = s9Raycaster.intersectObject(posedMain.model, true);
      sortHitsBruteForceOrder(posedMain.model, raw);
      const mh = raw[0];
      if (!mh || mh.faceIndex == null || mh.faceIndex < 0) return { cls: "miss", tri: "-" };
      const mm = mh.object as Mesh;
      const mud = (mm.userData ?? {}) as Record<string, unknown>;
      const mcls = classifyNurseWaistHit(mm.name, String(mud["matName"] ?? ""), String(mud["alphaMode"] ?? "OPAQUE"));
      return { cls: mcls, tri: `${String(mud["primIndex"])}:${String(mh.faceIndex)}` };
    }
    async function evalC2pCount(posed: S9Posed, cam: PerspectiveCamera, shirt: Array<[number, number]>, tie: number): Promise<number> {
      let fail = 0;
      for (const [x, y] of shirt) {
        s9Ndc.set(((x + 0.5) / HIMG) * 2 - 1, -((y + 0.5) / HIMG) * 2 + 1);
        s9Raycaster.setFromCamera(s9Ndc, cam);
        const raw = s9Raycaster.intersectObject(posed.model, true);
        sortHitsBruteForceOrder(posed.model, raw);
        if (raw.length === 0) { fail++; continue; }
        const hit = raw[0]!;
        const mesh = hit.object as Mesh;
        const ud = (mesh.userData ?? {}) as Record<string, unknown>;
        const cls = classifyNurseWaistHit(mesh.name, String(ud["matName"] ?? ""), String(ud["alphaMode"] ?? "OPAQUE"));
        if (hit.faceIndex == null || hit.faceIndex < 0) { fail++; continue; }
        s9FaceNormal(mesh, hit.faceIndex, s9Fn);
        const rayDir = s9Raycaster.ray.direction.clone().normalize();
        if (cls !== "shirt" || s9Fn.dot(rayDir) >= 0) { fail++; continue; }
        const tS = hit.distance;
        for (const r of raw.slice(1)) {
          const rm = r.object as Mesh;
          const rud = (rm.userData ?? {}) as Record<string, unknown>;
          if (!(/kevin_body/.test(String(rud["meshName"])) && /skin/.test(String(rud["matName"] ?? "")))) continue;
          if (Math.abs(r.distance - tS) <= tie) { fail++; break; }
        }
      }
      return fail;
    }
    const outRows: Array<Record<string, unknown>> = [];
    const f3Red: string[] = [];
    const f1Red: string[] = [];
    const c3dRed: string[] = [];
    const bCandidatesAll: string[] = [];
    for (const h of dirs) {
      const reportOnly = h.label === S10_REPORT_ONLY;
      const az = (h.azDeg * Math.PI) / 180;
      const el = (h.elDeg * Math.PI) / 180;
      const dir = new Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
      const cam = new PerspectiveCamera(35, 1, 0.01, 100);
      cam.position.copy(center).add(dir.clone().multiplyScalar(h.r));
      cam.lookAt(center);
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();
      let x0 = HIMG;
      let y0 = HIMG;
      let x1 = -1;
      let y1 = -1;
      const pr = new Vector3();
      const ref = [...(posedMain.model as unknown as { children: Mesh[] }).children][0]!;
      for (const c of centroids) {
        pr.copy(c).applyMatrix4(ref.matrixWorld).project(cam);
        if (pr.z > 1 || pr.z < -1) continue;
        const x = Math.floor(((pr.x + 1) / 2) * HIMG);
        const y = Math.floor(((1 - pr.y) / 2) * HIMG);
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
      x0 = Math.max(0, x0 - HMARGIN);
      y0 = Math.max(0, y0 - HMARGIN);
      x1 = Math.min(HIMG - 1, x1 + HMARGIN);
      y1 = Math.min(HIMG - 1, y1 + HMARGIN);
      expect(x1 >= x0 && y1 >= y0, `S10e F1/F3 ${h.label}: SELECTED bbox projects`).toBe(true);
      const site: Array<[number, number]> = [];
      const shirt: Array<[number, number]> = [];
      for (let y = y0; y <= y1; y += HSTRIDE) {
        for (let x = x0; x <= x1; x += HSTRIDE) {
          s9Ndc.set(((x + 0.5) / HIMG) * 2 - 1, -((y + 0.5) / HIMG) * 2 + 1);
          s9Raycaster.setFromCamera(s9Ndc, cam);
          const rayDir = s9Raycaster.ray.direction.clone().normalize();
          const raw = s9Raycaster.intersectObject(posedMain.model, true);
          sortHitsBruteForceOrder(posedMain.model, raw);
          if (raw.length === 0) continue;
          const first = raw[0]!;
          const ud = ((first.object as Mesh).userData ?? {}) as Record<string, unknown>;
          const cls = classifyNurseWaistHit((first.object as Mesh).name, String(ud["matName"] ?? ""), String(ud["alphaMode"] ?? "OPAQUE"));
          if (cls === "hidden" && String(ud["meshName"]) === bodyMesh) site.push([x, y]);
          else if (cls === "shirt" && first.faceIndex != null && first.faceIndex >= 0) {
            s9FaceNormal(first.object as Mesh, first.faceIndex, s9Fn);
            if (s9Fn.dot(rayDir) < 0) shirt.push([x, y]);
          }
        }
      }
      // eslint-disable-next-line no-console
      console.log(`S10e F1/F3 ${h.label}: main site=${site.length} (census ${String(censusSite.get(h.label))}) shirt=${shirt.length}${reportOnly ? " REPORT-ONLY" : ""}`);
      expect(site.length, `S10e F1/F3 ${h.label}: live main site reproduces the fixed main census`).toBe(censusSite.get(h.label));
      const s5pass = new Map<string, C1Detail>();
      const candpass = new Map<string, C1Detail>();
      const mainpass = new Map<string, C1Detail>();
      for (const [x, y] of site) {
        const key = `${x},${y}`;
        s5pass.set(key, evalC1Detail(posedS5, assetsS5, cam, x, y));
        candpass.set(key, evalC1Detail(posedS9, assetsS9, cam, x, y));
        mainpass.set(key, evalC1Detail(posedMain, assetsMain, cam, x, y));
      }
      const s5fill = [...s5pass.entries()].filter(([, d]) => fill(true, d.pass)).map(([k]) => k);
      const candfill = [...candpass.entries()].filter(([, d]) => fill(true, d.pass)).map(([k]) => k);
      const candfillSet = new Set(candfill);
      const excludedA: string[] = [];
      const excludedB: string[] = [];
      const violations: string[] = [];
      for (const key of s5fill) {
        if (candfillSet.has(key)) continue;
        const s5d = s5pass.get(key)!;
        const candd = candpass.get(key)!;
        const [xs, ys] = key.split(",").map(Number);
        const mf = mainFirst(cam, xs!, ys!);
        if (S9_L.has(s5d.firstTri)) {
          excludedA.push(`(${key}) S5-first=${s5d.firstTri} cand-first=${candd.firstTri} main-first=${mf.cls} ${mf.tri} reason=a`);
          continue;
        }
        const candHidden = candd.firstCls === "hidden" && candd.why.startsWith("cls=hidden");
        const mainHidden = mf.cls === "hidden";
        const s5NotOpen = !tOpen.has(s5d.firstTri);
        if (s5NotOpen && candHidden && mainHidden) {
          bCandidatesAll.push(`${h.label}@${key}=${s5d.firstTri}`);
          excludedB.push(`(${key}) S5-first=${s5d.firstTri} cand-first=${candd.firstTri} main-first=${mf.cls} ${mf.tri} reason=b`);
          continue;
        }
        violations.push(`(${key}) S5-first=${s5d.firstTri} cand-first=${candd.firstTri}(${candd.why}) main-first=${mf.cls} ${mf.tri}`);
      }
      for (const b of parity.parityB.filter((bb) => bb.dir === h.label)) {
        const key = `${b.x},${b.y}`;
        const s5d = s5pass.get(key);
        const candd = candpass.get(key);
        const mf = mainFirst(cam, b.x, b.y);
        const candHidden = !!candd && candd.firstCls === "hidden" && candd.why.startsWith("cls=hidden");
        const ok = !!s5d && fill(true, s5d.pass) && !candfillSet.has(key) && s5d.firstTri === b.s5tri && !tOpen.has(s5d.firstTri) && candHidden && mf.cls === "hidden";
        expect(ok, `S10e F1b' closed list: ${b.dir}@${key} must match (b) with S5 tri ${b.s5tri}`).toBe(true);
      }
      const f3allowed: string[] = [];
      const f3viol: string[] = [];
      for (const [key, candd] of candpass.entries()) {
        if (candd.pass) continue;
        const isHiddenFail = candd.why.startsWith("cls=hidden");
        if (!isHiddenFail) continue;
        const [xs, ys] = key.split(",").map(Number);
        const mf = mainFirst(cam, xs!, ys!);
        if (mf.cls === "hidden") f3allowed.push(`(${h.label},(${key}),cand ${candd.firstTri},main ${mf.tri})`);
        else f3viol.push(`(${h.label},(${key}),cand ${candd.firstTri},main ${mf.cls} ${mf.tri})`);
      }
      const c2s5g = await evalC2pCount(posedS5, cam, shirt, S9_TIE_GRADE);
      const c2s5p = await evalC2pCount(posedS5, cam, shirt, S9_TIE_PNEAR01);
      const c2cg = await evalC2pCount(posedS9, cam, shirt, S9_TIE_GRADE);
      const c2cp = await evalC2pCount(posedS9, cam, shirt, S9_TIE_PNEAR01);
      const c1cwFails: string[] = [];
      for (const [x, y] of site) {
        const d = evalC1Detail(posedCW, assetsCW, cam, x, y);
        if (!d.pass) c1cwFails.push(`(${x},${y}) ${d.firstTri} ${d.why}`);
      }
      const c2cwg = await evalC2pCount(posedCW, cam, shirt, S9_TIE_GRADE);
      // eslint-disable-next-line no-console
      console.log(`S10e ${h.label}: S5 fill=${s5fill.length} cand fill=${candfill.length} exclA=${excludedA.length} exclB=${excludedB.length} viol=${violations.length} | F3 allowed=${f3allowed.length} viol=${f3viol.length} | C2' S5 g/p=${c2s5g}/${c2s5p} CAND g/p=${c2cg}/${c2cp} | CW132 C1fail=${c1cwFails.length} C2'g=${c2cwg}${reportOnly ? " REPORT-ONLY" : ""}`);
      for (const l of f3allowed) { // eslint-disable-next-line no-console
        console.log(`S10e ${h.label} F3-allowed ${l}`); }
      for (const l of excludedA) { // eslint-disable-next-line no-console
        console.log(`S10e ${h.label} F1-excluded-a ${l}`); }
      for (const l of excludedB) { // eslint-disable-next-line no-console
        console.log(`S10e ${h.label} F1-excluded-b ${l}`); }
      for (const l of violations) { // eslint-disable-next-line no-console
        console.log(`S10e ${h.label} F1-VIOLATION ${l}`); }
      for (const l of f3viol) { // eslint-disable-next-line no-console
        console.log(`S10e ${h.label} F3-VIOLATION ${l}`); }
      const mainFillCount = [...mainpass.values()].filter((d) => fill(true, d.pass)).length;
      // eslint-disable-next-line no-console
      console.log(`S10e F2-plant main-as-candidate ${h.label}: substitution before=candidate ad61615d after=main 40492951 mainFill=${mainFillCount} S5fill=${s5fill.length} F1-RED=${mainFillCount < s5fill.length}`);
      outRows.push({
        dir: h.label, reportOnly, site: site.length, shirt: shirt.length,
        s5fill: s5fill.length, candfill: candfill.length, mainfill: mainFillCount,
        excludedA, excludedB, violations, f3allowed, f3viol,
        c2: { s5g: c2s5g, s5p: c2s5p, candg: c2cg, candp: c2cp },
        cw132: { c1fail: c1cwFails.length, c1eg: c1cwFails.slice(0, 3), c2g: c2cwg },
      });
      if (c1cwFails.length > 0 || c2cwg > 0) c3dRed.push(`${h.label}(C1fail=${c1cwFails.length},C2'g=${c2cwg})`);
      if (!reportOnly) {
        if (f3viol.length > 0) f3Red.push(`${h.label}: F3 violations ${f3viol.slice(0, 3).join(" | ")}`);
        if (c2cg > 0) f3Red.push(`${h.label}: C2' grade-tie fails ${c2cg}`);
        if (c2cp > 0) f3Red.push(`${h.label}: C2' product-near0.1-tie fails ${c2cp}`);
        if (violations.length > 0) f1Red.push(`${h.label}: F1 violations ${violations.slice(0, 3).join(" | ")}`);
        if (s5fill.length > 0 && mainFillCount >= s5fill.length) f1Red.push(`${h.label}: F2-plant main-as-candidate did not RED (mainFill=${mainFillCount} S5fill=${s5fill.length})`);
      }
    }
    expect(bCandidatesAll.slice().sort(), "S10e F1b' closed list: (b) matches EXACTLY the 2 listed px").toEqual(parity.parityB.map((b) => `${b.dir}@${b.x},${b.y}=${b.s5tri}`).sort());
    // eslint-disable-next-line no-console
    console.log(`S10e F2-plant S5-as-candidate on C2': substitution before=candidate ad61615d after=S5 7c9545a7 (S9 widened boxes, expect RED as in S9 C2')`);
    {
      const k2 = await sceneFor(mainGlbPath(), "three_quarter");
      const posedS5b = await s9PosedFor(S9_S5);
      const posedMainb = await s9PosedFor(mainGlbPath());
      const cam = k2.camera;
      let siteQ = 0;
      let failQ = 0;
      for (const [x0, y0, x1, y1] of S9_BOXES_C2P["three_quarter"]!) {
        for (let y = y0; y <= y1; y += S9_STRIDE) {
          for (let x = x0; x <= x1; x += S9_STRIDE) {
            const mh = s9FullHits(posedMainb, cam, x, y);
            if (mh.length === 0) continue;
            const mFirst = mh.find((hh) => /scrub_shirt/.test(hh.matName) && hh.dotWind < 0);
            if (!mFirst || mh[0] !== mFirst) continue;
            siteQ++;
            const ch = s9FullHits(posedS5b, cam, x, y);
            if (ch.length === 0) { failQ++; continue; }
            const cFirst = ch[0]!;
            const cls0 = classifyNurseWaistHit(cFirst.mesh.name, cFirst.matName, "OPAQUE");
            if (cls0 !== "shirt" || cFirst.dotWind >= 0) { failQ++; continue; }
            const near = ch.find((hh) => /kevin_body/.test(hh.meshName) && /skin/.test(hh.matName) && Math.abs(hh.t - cFirst.t) <= S9_TIE_GRADE);
            if (near) failQ++;
          }
        }
      }
      // eslint-disable-next-line no-console
      console.log(`S10e F2-plant S5-as-candidate C2' tq: site=${siteQ} S5fail=${failQ} (S9 recorded main 0 / S5 36 RED)`);
      expect(failQ, "S10e F2-plant S5-as-candidate must RED on C2' (as in S9/S10b)").toBeGreaterThan(0);
      // eslint-disable-next-line no-console
      console.log(`Tests: S10e F2-plant S5-as-candidate C2' RED with S5fail=${failQ} on tq site=${siteQ}`);
    }
    writeFileSync(S10E_OUT, JSON.stringify({ rows: outRows, f3Red, f1Red, c3dRed }, null, 1));
    // eslint-disable-next-line no-console
    console.log(`S10e F3: ${f3Red.length === 0 ? "GREEN on all 4 carrying dirs" : `RED: ${f3Red.join(" | ")}`}`);
    // eslint-disable-next-line no-console
    console.log(`S10e F1: ${f1Red.length === 0 ? "GREEN on all 4 carrying dirs" : `RED: ${f1Red.join(" | ")}`}`);
    if (c3dRed.length === 0) {
      // eslint-disable-next-line no-console
      console.log("S10e C3d: C3' does not see L (keep-L SELECTED=132 GREEN on all 4 carrying dirs; C4(i) remains the L guard; report, do not STOP)");
    } else {
      // eslint-disable-next-line no-console
      console.log(`S10e C3d: keep-L SELECTED=132 RED on ${c3dRed.length}/4 carrying dirs: ${c3dRed.join(" | ")}`);
      expect(c3dRed.length, "S10e C3d keep-L SELECTED=132 goes RED on >= 1 of the 4 carrying dirs").toBeGreaterThan(0);
    }
    expect(f3Red, "S10e F3: parity class GREEN (any C1 fail where main first-hit is not hidden = STOP; C2'=0 both ties)").toEqual([]);
    // eslint-disable-next-line no-console
    console.log(`Tests: S10e F3 parity class GREEN with C2'=0 both ties on 4 carrying dirs (allowed px listed per dir in ${S10E_OUT})`);
    expect(f1Red, "S10e F1: fill floor GREEN (every fill(S5) has fill(cand) except a|b)").toEqual([]);
    // eslint-disable-next-line no-console
    console.log(`Tests: S10e F1 fill floor GREEN with violations=0 on 4 carrying dirs (S5fill vs candfill per dir in ${S10E_OUT})`);
  }, 1_500_000);

  // S10h2/B5: machine-local (needs store-only CW132 + CW125 chain outputs) -> skips on clean clones (MADR 0065).
  it.runIf(existsSync(S9_CW132) && existsSync(S9_CW125))("C4 counterweights: keep-L RED, drop-one RED, S5-era substitutions RED", async () => {
    const k1 = await sceneFor(mainGlbPath(), "front");
    const k2 = await sceneFor(mainGlbPath(), "three_quarter");
    // eslint-disable-next-line no-console
    console.log(`S9 C4 substitution before: SELECTED=126 (unionOpen 132 minus inter 6: 1:460/1:537/1:572/4:17/7:14/7:15)`);
    const c4Summary: {
      keepL: { site: number; fail: number; first3: unknown } | null;
      dropOne: { site: number; outside: number; examples: string[] } | null;
    } = { keepL: null, dropOne: null };
    // (i) SELECTED = 132 (keep L) -> C2' RED.
    {
      const posedCW = await s9PosedFor(S9_CW132);
      const posedMain = await s9PosedFor(mainGlbPath());
      // S10h5/B1: C4 owns its frame. The s9 posed cache is shared across
      // clauses and earlier S9 clauses normalize the cached main model as a
      // side effect; alone (e.g. -t C4) the raw-load frame makes every
      // framed-camera ray miss (site=0). Copying the frame here is
      // idempotent under the full-file run (same absolute values).
      for (const p of [posedCW, posedMain]) {
        p.model.scale.copy(k1.model.scale);
        p.model.position.copy(k1.model.position);
        p.model.updateMatrixWorld(true);
      }
      const cam = k2.camera;
      let site = 0;
      const fails: Array<{ x: number; y: number; why: string; tri: string }> = [];
      for (const [x0, y0, x1, y1] of S9_BOXES_C2P["three_quarter"]!) {
        for (let y = y0; y <= y1; y += S9_STRIDE) {
          for (let x = x0; x <= x1; x += S9_STRIDE) {
            const mh = s9FullHits(posedMain, cam, x, y);
            if (mh.length === 0) continue;
            const mFirst = mh.find((hh) => s9IsShirt(hh) && hh.dotWind < 0);
            if (!mFirst || mh[0] !== mFirst) continue;
            site++;
            const sh = s9FullHits(posedCW, cam, x, y);
            if (sh.length === 0) {
              fails.push({ x, y, why: "miss", tri: "-" });
              continue;
            }
            const first = sh[0]!;
            if (!(s9IsShirt(first) && first.dotWind < 0)) {
              fails.push({ x, y, why: `first-not-shirt:${first.meshName}#${first.prim}:${first.face}`, tri: `${first.prim}:${first.face}` });
              continue;
            }
            const near = sh.find((hh) => s9IsBodySkin(hh) && Math.abs(hh.t - first.t) <= S9_TIE_GRADE);
            if (near) {
              fails.push({ x, y, why: `body-near:${near.meshName}#${near.prim}:${near.face}`, tri: `${near.prim}:${near.face}` });
            }
          }
        }
      }
      // eslint-disable-next-line no-console
      console.log(
        `S9 C4(i) substitution after: SELECTED=132 (kept L) C2' tq grade site=${site} fail=${fails.length} e.g. ${JSON.stringify(fails.slice(0, 3))}`,
      );
      expect(fails.length, "C4(i) keep-L SELECTED=132 C2' RED").toBeGreaterThan(0);
      c4Summary.keepL = { site, fail: fails.length, first3: fails.slice(0, 3) };
    }
    // (ii) drop one non-L T_open tri (1:629) -> C1 RED outside the allowance.
    {
      const posedCW = await s9PosedFor(S9_CW125);
      const posedMain = await s9PosedFor(mainGlbPath());
      // S10h5/B1: same owned-frame fix as (i); posedMain must be framed here
      // too (it was the un-normalized reader in the alone-run site=0 RED).
      for (const p of [posedCW, posedMain]) {
        p.model.scale.copy(k1.model.scale);
        p.model.position.copy(k1.model.position);
        p.model.updateMatrixWorld(true);
      }
      const names = new Set<string>();
      for (const c of (posedMain.model as unknown as { children: Mesh[] }).children) {
        names.add(String((c.userData as Record<string, unknown>)["meshName"]));
      }
      const bodyMesh = [...names].find((n) => n.startsWith(S9_BODY_PREFIX))!;
      const cams: Record<string, PerspectiveCamera> = { front: k1.camera, three_quarter: k2.camera };
      let outside = 0;
      let total = 0;
      const examples: string[] = [];
      for (const [view, cam] of Object.entries(cams)) {
        for (const site of S9_SITES) {
          const box = S9_BOXES_C1[view]![site]!;
          for (let y = box[1]; y < box[3]; y += S9_STRIDE) {
            for (let x = box[0]; x < box[2]; x += S9_STRIDE) {
              const rows = s9FullHits(posedMain, cam, x, y);
              if (rows.length === 0) continue;
              const f = rows[0]!;
              if (!(f.cls === "hidden" && f.meshName === bodyMesh)) continue;
              let sn = false;
              for (const r of rows) {
                if (r.t >= f.t) break;
                if (r.cls === "shirt" && r.dotWind < 0) {
                  sn = true;
                  break;
                }
              }
              if (sn) continue;
              total++;
              const cw = s9FullHits(posedCW, cam, x, y);
              if (cw.length === 0) {
                outside++;
                if (examples.length < 3) examples.push(`(${x},${y}) miss`);
                continue;
              }
              const cf = cw[0]!;
              const tri = `${cf.prim}:${cf.face}`;
              if (!S9_L.has(tri)) {
                outside++;
                if (examples.length < 3) examples.push(`(${x},${y}) ${cf.cls} ${tri}`);
              }
            }
          }
        }
      }
      // eslint-disable-next-line no-console
      console.log(
        `S9 C4(ii) substitution after: SELECTED=125 (dropped 1:629) C1 site=${total} fails-outside-allowance=${outside} e.g. ${examples.join(" | ")}`,
      );
      expect(outside, "C4(ii) drop-one (1:629) C1 RED outside the allowance").toBeGreaterThan(0);
      c4Summary.dropOne = { site: total, outside, examples };
    }
    // (iii) S5-era counterweights (winding flip, hair material, negated normals) RED:
    // covered by the C1-counterweights test on this file against the S9 subject
    // (run with KEVIN_COLLAR_SUBJECT_GLB pointing at the ad61615d candidate); gate recorded in RESULT-s9.
    // eslint-disable-next-line no-console
    console.log(`S9 C4(iii) substitution: appended prims material/winding/normals flipped -> C1 RED (see C1-counterweights test on S9 subject)`);
    writeFileSync(`${S10H2_WORK}/s10h2-s9-c4.json`, JSON.stringify(c4Summary, null, 1));
  }, 1_500_000);
});
