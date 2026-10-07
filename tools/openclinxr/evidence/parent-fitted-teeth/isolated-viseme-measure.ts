/**
 * Offline measurement for the isolated viseme stills (viseme-eval slice).
 *
 * The still PNGs on disk were posed by the runtime applier in the browser
 * (one baked cue per viseme; the render session asserts weight 1.0 alone
 * in-page before saving each PNG). This tool measures them WITHOUT
 * re-rendering: it replays the identical pose headlessly (real
 * applyVisemeWeights/lipVisemeWeights/applyJawOpenToRoot calls), projects
 * orbicularis-oris landmark verts through replicated pack cameras, and runs
 * the capture's own tooth classifier on the still pixels.
 *
 * Camera replication: PerspectiveCamera(35, aspect, 0.01, 100) +
 * frameCamera on the resolveFocus box (mouth for front/34, head for the
 * default view) on a 1024x1024 (pack views) or 1280x960 (legacy) canvas.
 * The camera is never parented (rig offset 0, same as the lab). Each view
 * records a framing residual (mouth/head-box centre projection vs canvas
 * centre) so a drifted replication refuses by measurement, not by faith.
 *
 * Writes isolated.raw.json (per-still rows for the report builder),
 * isolated.report.json (slim per-viseme rows), and isolated-central.json
 * (corner sets + default-box containment for the bilabial-central check).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Box3, BufferAttribute, Matrix4, Mesh, PerspectiveCamera, Vector3 } from "three";
import { deriveHeadBoxFromPoints, frameCamera, isFittedHairMeshName } from "@openclinxr/xr-scene";
import {
  applyJawOpenToRoot,
  applyVisemeWeights,
  JAW_OPEN_TEETH_CLEAR_RADIANS,
  JAW_TEETH_GAIN,
  jawOpenRadiansForPhoneme,
} from "@openclinxr/xr-dialogue";
import { analyzeToothPixels } from "./tooth-pixel-split.js";
import { loadHeadlessScene, type HeadlessScene } from "../../mouth-solver/headless-scene.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const GLB = path.join(REPO, "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb");
const OUT_DIR = path.join(REPO, "docs/openclinxr/mouth-dynamics/viseme-eval");

const ORDER = ["sil", "PP", "FF", "TH", "DD", "kk", "CH", "SS", "nn", "RR", "aa", "E", "I", "O", "U"];
const FRONT_WIN = { ox: 520, yTop: 570, x0: 10, x1: 230, y0: 25, y1: 95 };
const DEFAULT_BOX = { x0: 40, x1: 100, y0: 55, y1: 85 };

/** Live morph-target view onto a headless SkinnedMesh (same arrays, no copy). */
type MeasureMorphTarget = {
  morphTargetDictionary: Record<string, number>;
  morphTargetInfluences: number[];
};

/**
 * Local viseme-name mapping (`viseme_${v}`): exact match, then a
 * case-insensitive match against the real mesh list. The tool poses one
 * baked cue per viseme, so the key is already the target spelling
 * (`viseme_PP`, …, `viseme_sil`); no alias pass lives here.
 */
function resolveVisemeTargetLocal(phoneme: string, availableTargets: readonly string[]): string | null {
  const available = new Set(availableTargets);
  const raw = phoneme.trim();
  if (!raw) return null;
  if (available.has(raw)) return raw;
  const lower = `viseme_${raw.replace(/^viseme_/i, "")}`.toLowerCase();
  for (const target of availableTargets) {
    if (target.toLowerCase() === lower) return target;
  }
  return null;
}

/**
 * Local per-mesh gain: contact visemes (PP/FF/TH) at full weight, every
 * other `viseme_*` at half. Both gains are 0.5 on this asset
 * (JAW_TEETH_GAIN for teeth, the lip half-gain for body), so one branch
 * covers both meshes without publishing the runtime helper.
 */
const CONTACT_VISEMES_LOCAL: ReadonlySet<string> = new Set(["pp", "ff", "th"]);
function lipVisemeWeightsLocal(
  mesh: MeasureMorphTarget & { name?: string },
  weights: Record<string, number>,
): Record<string, number> {
  void mesh.name;
  const scaled: Record<string, number> = {};
  for (const [key, weight] of Object.entries(weights)) {
    const token = key.replace(/^viseme_/i, "").toLowerCase();
    scaled[key] = CONTACT_VISEMES_LOCAL.has(token) ? weight : weight * 0.5;
  }
  return scaled;
}

/**
 * Local head framing from already-public xr-scene API: rest-pose world
 * points (hair excluded from the silhouette profile, unioned for
 * containment) through deriveHeadBoxFromPoints, wrapped in a Box3 for
 * frameCamera. Mirrors headFocusCamera in tools/openclinxr/mouth-solver/headless-scene.ts.
 */
function deriveHeadFrameBoundsLocal(root: HeadlessScene["root"]): Box3 {
  root.updateMatrixWorld(true);
  const points: Array<{ x: number; y: number; z: number }> = [];
  const silhouettePoints: Array<{ x: number; y: number; z: number }> = [];
  const containPoints: Array<{ x: number; y: number; z: number }> = [];
  const point = new Vector3();
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!(mesh instanceof Mesh)) return;
    const position = mesh.geometry.getAttribute("position");
    if (!position) return;
    const userName = (mesh.userData as { name?: unknown }).name;
    const geometryName = (mesh.geometry as unknown as { name?: unknown }).name;
    const isHair =
      isFittedHairMeshName(object.name) ||
      (typeof userName === "string" && isFittedHairMeshName(userName)) ||
      (typeof geometryName === "string" && isFittedHairMeshName(geometryName));
    for (let i = 0; i < position.count; i += 1) {
      point.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
      const p = { x: point.x, y: point.y, z: point.z };
      points.push(p);
      if (isHair) containPoints.push(p);
      else silhouettePoints.push(p);
    }
  });
  const derived = deriveHeadBoxFromPoints(points, { silhouettePoints, containPoints });
  if (!derived) throw new Error("focus=head unresolvable on this asset: deriveHeadBoxFromPoints returned null");
  return new Box3(
    new Vector3(derived.box.min.x, derived.box.min.y, derived.box.min.z),
    new Vector3(derived.box.max.x, derived.box.max.y, derived.box.max.z),
  );
}
function asMorphTarget(mesh: {
  morphTargetDictionary?: Record<string, number>;
  morphTargetInfluences?: number[];
  name?: string;
}): MeasureMorphTarget & { name?: string } {
  const dict = mesh.morphTargetDictionary;
  const influences = mesh.morphTargetInfluences;
  if (!dict || !influences) throw new Error(`mesh-morph-missing:${mesh.name ?? "(unnamed)"}`);
  return {
    morphTargetDictionary: dict,
    morphTargetInfluences: influences,
    ...(typeof mesh.name === "string" ? { name: mesh.name } : {}),
  };
}

function skinMeshPositions(scene: HeadlessScene): Float32Array {
  const body = scene.body;
  const influences = body.skinned.morphTargetInfluences ?? [];
  const count = body.base.length / 3;
  const morphed = new Float32Array(body.base);
  for (let t = 0; t < body.targetDeltas.length; t += 1) {
    const w = influences[t] ?? 0;
    if (!w) continue;
    const delta = body.targetDeltas[t];
    if (!delta) continue;
    for (let i = 0; i < morphed.length; i += 1) morphed[i] = (morphed[i] ?? 0) + w * (delta[i] ?? 0);
  }
  const out = new Float32Array(body.base.length);
  const m = new Matrix4();
  const p = new Vector3();
  const bm = body.skeleton.boneMatrices;
  if (!bm) throw new Error("no-bone-matrices");
  for (let v = 0; v < count; v += 1) {
    let ox = 0;
    let oy = 0;
    let oz = 0;
    for (let s = 0; s < 4; s += 1) {
      const w = body.weights[v * 4 + s] ?? 0;
      if (!w) continue;
      m.fromArray(bm, (body.joints[v * 4 + s] ?? 0) * 16);
      p.set(morphed[v * 3] ?? 0, morphed[v * 3 + 1] ?? 0, morphed[v * 3 + 2] ?? 0).applyMatrix4(m);
      ox += w * p.x;
      oy += w * p.y;
      oz += w * p.z;
    }
    out[v * 3] = ox;
    out[v * 3 + 1] = oy;
    out[v * 3 + 2] = oz;
  }
  return out;
}

function orisIndices(scene: HeadlessScene): number[] {
  const bones = scene.body.skeleton.bones;
  const out: number[] = [];
  const count = scene.body.base.length / 3;
  for (let v = 0; v < count; v += 1) {
    let joint = scene.body.joints[v * 4] ?? 0;
    let best = scene.body.weights[v * 4] ?? 0;
    for (let s = 1; s < 4; s += 1) {
      const w = scene.body.weights[v * 4 + s] ?? 0;
      if (w > best) {
        best = w;
        joint = scene.body.joints[v * 4 + s] ?? joint;
      }
    }
    if (/^oris/i.test(bones[joint]?.name ?? "")) out.push(v);
  }
  if (!out.length) throw new Error("no-oris-verts");
  return out;
}

function project(cam: PerspectiveCamera, W: number, H: number, p: { x: number; y: number; z: number }): { x: number; y: number } {
  const v = new Vector3(p.x, p.y, p.z).project(cam);
  return { x: (v.x * 0.5 + 0.5) * W, y: (1 - (v.y * 0.5 + 0.5)) * H };
}

async function rgbaGlOrder(pngPath: string): Promise<{ buf: Uint8Array; W: number; H: number }> {
  const probe = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", pngPath], { encoding: "utf8" });
  const [W, H] = probe.trim().split(",").map(Number);
  if (!W || !H) throw new Error(`bad-png-dims:${pngPath}`);
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", pngPath, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 }) as Buffer;
  if (raw.length < W * H * 3) throw new Error(`short-raw:${pngPath}`);
  const out = new Uint8Array(W * H * 4);
  for (let row = 0; row < H; row += 1) {
    const srcRow = H - 1 - row;
    for (let x = 0; x < W; x += 1) {
      const s = (srcRow * W + x) * 3;
      const d = (row * W + x) * 4;
      out[d] = raw[s] ?? 0;
      out[d + 1] = raw[s + 1] ?? 0;
      out[d + 2] = raw[s + 2] ?? 0;
      out[d + 3] = 255;
    }
  }
  return { buf: out, W, H };
}

function toGlBox(top: { x0: number; x1: number; y0: number; y1: number }, W: number, H: number) {
  return {
    x0: Math.max(0, Math.round(top.x0)),
    x1: Math.min(W - 1, Math.round(top.x1)),
    y0: Math.max(0, Math.round(H - 1 - top.y1)),
    y1: Math.min(H - 1, Math.round(H - 1 - top.y0)),
  };
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const id of ["front", "34"]) {
    for (const v of ORDER) {
      const f = path.join(OUT_DIR, `isolated-${id}`, `${v}.png`);
      if (!existsSync(f)) throw new Error(`missing-still:${f}`);
    }
  }
  const scene = await loadHeadlessScene(GLB);
  for (const mesh of [scene.body, scene.teeth]) {
    mesh.skinned.geometry.setAttribute("skinIndex", new BufferAttribute(Float32Array.from(mesh.joints as ArrayLike<number>), 4));
    mesh.skinned.geometry.setAttribute("skinWeight", new BufferAttribute(Float32Array.from(mesh.weights), 4));
  }
  scene.root.updateMatrixWorld(true);
  // Manual mouth_box: the fitted-teeth base AABB via mesh matrixWorld.
  // The lab rule unions oris-dominant body verts, but its body match
  // (node/userData/material names vs /_body$/) fails on this asset
  // (node '..._body_mesh', skin material), while the teeth match via the
  // 'mat_openclinxr_fitted_teeth_...' material — so the live box is
  // teeth-only (GLTFLoader names meshes after nodes; verified in
  // three@0.184.0 GLTFLoader.js: mesh-as-node + material-name matching).
  const mouthBox = new Box3();
  {
    const p = new Vector3();
    const tb = scene.teeth;
    tb.skinned.updateMatrixWorld(true);
    for (let i = 0; i < tb.base.length / 3; i += 1) {
      p.set(tb.base[i * 3] ?? 0, tb.base[i * 3 + 1] ?? 0, tb.base[i * 3 + 2] ?? 0).applyMatrix4(tb.skinned.matrixWorld);
      mouthBox.expandByPoint(p);
    }
  }
  const headBox = deriveHeadFrameBoundsLocal(scene.root);
  const oris = orisIndices(scene);

  const mkCam = (W: number, H: number) => new PerspectiveCamera(35, W / H, 0.01, 100);
  const frontCam = mkCam(1024, 1024);
  frameCamera(frontCam, mouthBox, "front");
  frontCam.updateMatrixWorld(true);
  const qCam = mkCam(1024, 1024);
  frameCamera(qCam, mouthBox, "three_quarter_left");
  qCam.updateMatrixWorld(true);
  const defCam = mkCam(1280, 960);
  frameCamera(defCam, headBox, undefined);
  defCam.updateMatrixWorld(true);

  const residual = (cam: PerspectiveCamera, box: Box3, W: number, H: number): number => {
    const c = box.getCenter(new Vector3());
    const p = project(cam, W, H, { x: c.x, y: c.y, z: c.z });
    return Math.hypot(p.x - W / 2, p.y - H / 2);
  };
  const residuals = {
    front: residual(frontCam, mouthBox, 1024, 1024),
    view34: residual(qCam, mouthBox, 1024, 1024),
    default: residual(defCam, headBox, 1280, 960),
  };
  process.stdout.write(`camera residuals px: ${JSON.stringify(residuals)}\n`);

  const pose = (viseme: string) => {
    const key = viseme === "sil" ? "viseme_sil" : `viseme_${viseme}`;
    const bodyMorph = asMorphTarget(scene.body.skinned);
    const teethMorph = asMorphTarget(scene.teeth.skinned);
    bodyMorph.morphTargetInfluences.fill(0);
    teethMorph.morphTargetInfluences.fill(0);
    const bodyTarget = resolveVisemeTargetLocal(key, scene.body.targetNames);
    if (!bodyTarget) throw new Error(`unresolvable:${viseme}`);
    applyVisemeWeights(bodyMorph, lipVisemeWeightsLocal(bodyMorph, { [key]: 1 }));
    applyVisemeWeights(teethMorph, lipVisemeWeightsLocal(teethMorph, { [key]: 1 }));
    const jawRad = jawOpenRadiansForPhoneme(viseme) * JAW_TEETH_GAIN;
    applyJawOpenToRoot(scene.root, jawRad);
    scene.root.updateMatrixWorld(true);
    scene.body.skeleton.update();
    scene.teeth.skeleton.update();
    const dict = bodyMorph.morphTargetDictionary;
    const influence = bodyMorph.morphTargetInfluences[dict[bodyTarget] ?? -1] ?? 0;
    if (!(influence > 0)) throw new Error(`zero-influence:${viseme}`);
    const teethDict = teethMorph.morphTargetDictionary;
    const teethKeys = Object.keys(teethDict);
    let teethTarget = "";
    let teethWeight = 0;
    for (const name of teethKeys) {
      const w = teethMorph.morphTargetInfluences[teethDict[name] ?? -1] ?? 0;
      if (w > teethWeight) {
        teethWeight = w;
        teethTarget = name;
      }
    }
    return { bodyTarget, influence, teethTarget, teethWeight, jawRad, jawFraction: jawRad / JAW_OPEN_TEETH_CLEAR_RADIANS };
  };

  const landmarks = (cam: PerspectiveCamera, W: number, H: number) => {
    const posed = skinMeshPositions(scene);
    const at = (v: number) => ({ x: posed[v * 3] ?? 0, y: posed[v * 3 + 1] ?? 0, z: posed[v * 3 + 2] ?? 0 });
    const firstOris = oris[0];
    if (firstOris === undefined) throw new Error("no-oris-verts");
    let minI = firstOris;
    let maxI = firstOris;
    for (const i of oris) {
      if ((at(i).x) < at(minI).x) minI = i;
      if ((at(i).x) > at(maxI).x) maxI = i;
    }
    const half = Math.max(Math.abs(at(minI).x), Math.abs(at(maxI).x));
    // Mid-lip rim: the oris verts nearest the commissure mid-height on each
    // side of it (upper rim just above, lower rim just below). A global
    // max/min-y would escape to the nose/chin across the broad oris field.
    const midY = (at(minI).y + at(maxI).y) / 2;
    let upI = -1;
    let loI = -1;
    for (const i of oris) {
      if (Math.abs(at(i).x) > 0.1 * half) continue;
      const dy = at(i).y - midY;
      if (dy >= 0 && (upI < 0 || dy < at(upI).y - midY)) upI = i;
      if (dy < 0 && (loI < 0 || dy > at(loI).y - midY)) loI = i;
    }
    if (upI < 0 || loI < 0) throw new Error("mid-lip-missing");
    const L = project(cam, W, H, at(minI));
    const R = project(cam, W, H, at(maxI));
    const U = project(cam, W, H, at(upI));
    const D = project(cam, W, H, at(loI));
    const widthPx = Math.abs(R.x - L.x);
    const aperturePx = Math.abs(D.y - U.y);
    const span = R.x - L.x;
    const pad = Math.max(8, 0.3 * aperturePx);
    const central = {
      x0: L.x + 0.15 * span, x1: R.x - 0.15 * span,
      y0: Math.min(U.y, D.y) - pad, y1: Math.max(U.y, D.y) + pad,
    };
    return { corners: { lx: L.x, rx: R.x }, widthPx, aperturePx, central };
  };

  const views: Record<string, { canvas: { w: number; h: number }; cameraResidualPx: number; stills: Record<string, unknown>[] }> = {};
  const viewDefs = [
    { id: "front", cam: frontCam, W: 1024, H: 1024, residual: residuals.front },
    { id: "34", cam: qCam, W: 1024, H: 1024, residual: residuals.view34 },
  ] as const;
  const silCorners: Record<string, { lx: number; rx: number }> = {};
  for (const view of viewDefs) {
    const rows: Record<string, unknown>[] = [];
    for (const viseme of ORDER) {
      const p = pose(viseme);
      const lm = landmarks(view.cam, view.W, view.H);
      const { buf } = await rgbaGlOrder(path.join(OUT_DIR, `isolated-${view.id}`, `${viseme}.png`));
      const central = analyzeToothPixels(buf, view.W, view.H, toGlBox(lm.central, view.W, view.H), true);
      const legacy = view.id === "front"
        ? analyzeToothPixels(buf, view.W, view.H, {
          x0: FRONT_WIN.ox + FRONT_WIN.x0, x1: FRONT_WIN.ox + FRONT_WIN.x1,
          y0: (view.H - FRONT_WIN.yTop) + FRONT_WIN.y0, y1: (view.H - FRONT_WIN.yTop) + FRONT_WIN.y1,
        }, false)
        : null;
      if (viseme === "sil") silCorners[view.id] = { lx: lm.corners.lx, rx: lm.corners.rx };
      rows.push({
        viseme, target: viseme === "sil" ? "viseme_sil" : `viseme_${viseme}`, weight: 1,
        jawRad: Math.round(p.jawRad * 1e6) / 1e6,
        jawFraction: Math.round(p.jawFraction * 1000) / 1000,
        teethTarget: p.teethTarget, teethWeight: Math.round(p.teethWeight * 1000) / 1000,
        corners: { lx: Math.round(lm.corners.lx * 10) / 10, rx: Math.round(lm.corners.rx * 10) / 10 },
        widthPx: Math.round(lm.widthPx * 10) / 10, aperturePx: Math.round(lm.aperturePx * 10) / 10,
        cameraResidualPx: Math.round(view.residual * 10) / 10,
        centralBox: { x0: Math.round(lm.central.x0 * 10) / 10, x1: Math.round(lm.central.x1 * 10) / 10, y0: Math.round(lm.central.y0 * 10) / 10, y1: Math.round(lm.central.y1 * 10) / 10 },
        upperPx: central.upperTeethN ?? 0, lowerPx: central.lowerTeethN ?? 0,
        mouthPx: central.mouthTeethN, lipGapPx: central.lipGapPx,
        legacyMouthPx: legacy?.mouthTeethN ?? null, legacyLipGapPx: legacy?.lipGapPx ?? null,
      });
      process.stdout.write(`isolated ${view.id} ${viseme}: jaw=${p.jawRad.toFixed(4)} teeth=${p.teethTarget || "(none)"}:${p.teethWeight} upper=${central.upperTeethN} lower=${central.lowerTeethN} width=${lm.widthPx.toFixed(1)} aperture=${lm.aperturePx.toFixed(1)}\n`);
    }
    views[view.id] = { canvas: { w: view.W, h: view.H }, cameraResidualPx: Math.round(view.residual * 10) / 10, stills: rows };
  }

  pose("sil");
  const defLm = landmarks(defCam, 1280, 960);
  const defSpan = defLm.corners.rx - defLm.corners.lx;
  const defCx0 = defLm.corners.lx + 0.15 * defSpan;
  const defCx1 = defLm.corners.rx - 0.15 * defSpan;
  // Central ROI in default-window GL coords (window origin x=500,
  // y=250 from bottom; canvas 1280x960 top-origin).
  const defGx0 = defCx0 - 500;
  const defGx1 = defCx1 - 500;
  const defGy0 = (960 - 1 - defLm.central.y1) - 250;
  const defGy1 = (960 - 1 - defLm.central.y0) - 250;
  const central = {
    cornersSilFront: silCorners["front"],
    cornersSil34: silCorners["34"],
    cornersSilDefault: { lx: defLm.corners.lx - 500, rx: defLm.corners.rx - 500 },
    defaultWindow: { ox: 500, yTop: 710, w: 240, h: 180, canvasW: 1280, canvasH: 960 },
    defaultBox: DEFAULT_BOX,
    centralDefaultWindow: { x0: defGx0, x1: defGx1, y0: defGy0, y1: defGy1 },
    // The verdict direction: the central ROI is CONTAINED in the measured
    // default box, so the committed 0/0 box counts imply central 0/0.
    centralInsideDefaultBox: defGx0 >= DEFAULT_BOX.x0 && defGx1 <= DEFAULT_BOX.x1 && defGy0 >= DEFAULT_BOX.y0 && defGy1 <= DEFAULT_BOX.y1,
    defaultCameraResidualPx: Math.round(residuals.default * 10) / 10,
  };
  if (!central.centralInsideDefaultBox) throw new Error(`central-outside-default-box:${JSON.stringify(central.centralDefaultWindow)}`);
  writeFileSync(path.join(OUT_DIR, "isolated.raw.json"), `${JSON.stringify({ views, corners: { default: { corners: central.cornersSilDefault, W: 240, H: 180, residual: residuals.default } } }, null, 2)}\n`);
  const slim = (id: string) => (views[id]?.stills ?? []).map((s) => {
    const r = s as unknown as { viseme: string; jawRad: number; jawFraction: number; teethTarget: string; teethWeight: number; upperPx: number; lowerPx: number; aperturePx: number; widthPx: number; lipGapPx: number; centralBox: unknown };
    return { viseme: r.viseme, jawRad: r.jawRad, jawFraction: r.jawFraction, teethTarget: r.teethTarget, teethWeight: r.teethWeight, upperPx: r.upperPx, lowerPx: r.lowerPx, apertureH: Math.round(r.aperturePx * 10) / 10, width: Math.round(r.widthPx * 10) / 10, lipGapPx: r.lipGapPx, centralBox: r.centralBox };
  });
  writeFileSync(path.join(OUT_DIR, "isolated.report.json"), `${JSON.stringify({
    schemaVersion: "openclinxr.viseme-isolated.v1",
    method: [
      "Each viseme posed at weight 1.0 ALONE (all others 0) through the runtime applier calls (applyVisemeWeights/lipVisemeWeights/applyJawOpenToRoot) with a single baked cue; jaw = jawOpenRadiansForPhoneme(viseme) times the runtime teeth gain (DD/kk use the runtime unknown-consonant 0.25 fallback); teeth as the runtime writes them (no target = 0); blink untouched (eyes outside the mouth framing).",
      "Corners = extreme-x body verts whose dominant skinning joint is an orbicularis-oris bone (lip tissue by rig), posed with live morph influences + skeleton and projected through replicated pack cameras (fov 35, unparented rig); central ROI = corners inset 15% each end. Camera residual = focus-box centre projection vs canvas centre.",
      "Three-quarter view is the rig three_quarter_left (45 deg yaw), mouth focus. Still PNGs were rendered by the browser session (runtime-posed, weight-1 asserted in-page); this tool only measures.",
    ],
    corners: { front: silCorners["front"], view34: silCorners["34"], default: central.cornersSilDefault },
    cameraResiduals: { front: views["front"]?.cameraResidualPx, view34: views["34"]?.cameraResidualPx, default: central.defaultCameraResidualPx },
    views: { front: slim("front"), view34: slim("34") },
  }, null, 2)}\n`);
  writeFileSync(path.join(OUT_DIR, "isolated-central.json"), `${JSON.stringify(central, null, 2)}\n`);
  process.stdout.write("wrote isolated.raw.json + isolated.report.json + isolated-central.json\n");
}

const invoked = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
