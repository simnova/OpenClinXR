/**
 * #358 — PRE-FIX measurement for the head-focus station.
 *
 * The #354 eye-focus station frames the head only on the MPFB rail (eye meshes
 * exist there) and silently falls back to whole-subject framing everywhere else
 * (7 of 7 Anny actors have eye BONES but zero eye GEOMETRY). This before-column
 * measures the CURRENT behaviour BEFORE any product edit:
 *
 *  - file-side (NodeIO): body bounds, the geometry-derived head box (the SAME
 *    `deriveHeadBoxFromPoints` the post-fix lab will use — no drift between the
 *    measurement and the runtime), and the eye box (present / absent)
 *  - in-browser (the CURRENT, unmodified lab): the framing the current code
 *    actually selects (`eye_box` on MPFB, `whole_subject_fallback` on Anny) and
 *    the camera it placed
 *  - the on-screen head height in pixels under the current behaviour, projected
 *    under the measured camera with the same pure-perspective math the #354
 *    pre-fix documented (`projectPixelSpan`)
 *
 * The motivating number: the Anny head lands at ~100 px in a 1024 px frame
 * under whole-subject framing — a framing this loop has repeatedly proved
 * cannot support a face verdict (#350: 10–20 px slivers hid in exactly that
 * frame).
 *
 * claimScope: the pre-fix before-column for the head-focus station.
 * notEvidenceFor: which hair mechanism is correct (that is the orchestrator's
 * pixel grade of the post-fix matched crops), clinical realism, Quest readiness.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO, type Document, type Mesh } from "@gltf-transform/core";
import { chromium, type Browser, type Page } from "playwright";
import { spawnPortlessDevServer, stopPortlessDevServer, type PortlessDevServer } from "./lib/portless-server.js";
import {
  deriveHeadBoxFromPoints,
  isFittedHairMeshName,
  type HeadBoxGeometry,
  type Vec3,
} from "../../../apps/ui-xr/src/head-box-from-geometry.js";
import { projectPixelSpan } from "./mpfb-eyes-inspection.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../..");
export const HEAD_FOCUS_EVIDENCE_ROOT = ".openclinxr/evidence/head-focus";

/** Matches the #354 eye channel filter (mesh name or material name). */
const EYE_MESH_RE = /eyes|iris|cornea|sclera/i;

const PACK_VIEWPORT = { width: 1024, height: 1024 } as const;

export const HEAD_FOCUS_SUBJECTS = [
  {
    rail: "mpfb",
    role: "adult_female",
    glb: "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb",
    outName: "mpfb-head-front.png",
  },
  {
    rail: "anny",
    role: "adult_anny",
    glb: "apps/ui-xr/public/generated-humanoids/peds_nurse_kevin.glb",
    outName: "anny-head-front.png",
  },
] as const;

type Bounds = { min: Vec3; max: Vec3 };

/**
 * World points of every mesh, plus the body-only silhouette subset and the
 * hair (containment) subset. Fitted hair is not body (#394): hair feeds the
 * head BOX via `containPoints` (the crop must contain it) but never the
 * silhouette profile (hair masks the neck constriction) — same split the
 * runtime lab and the contract use.
 */
function worldPoints(doc: Document): { points: Vec3[]; silhouettePoints: Vec3[]; containPoints: Vec3[] } {
  const points: Vec3[] = [];
  const silhouettePoints: Vec3[] = [];
  const containPoints: Vec3[] = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const isHair = isFittedHairMeshName(mesh.getName() ?? "")
      || isFittedHairMeshName(node.getName() ?? "");
    const wm = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION")?.getArray();
      if (!pos) continue;
      for (let i = 0; i + 2 < pos.length; i += 3) {
        const p: Vec3 = {
          x: wm[0] * Number(pos[i]) + wm[4] * Number(pos[i + 1]) + wm[8] * Number(pos[i + 2]) + wm[12],
          y: wm[1] * Number(pos[i]) + wm[5] * Number(pos[i + 1]) + wm[9] * Number(pos[i + 2]) + wm[13],
          z: wm[2] * Number(pos[i]) + wm[6] * Number(pos[i + 1]) + wm[10] * Number(pos[i + 2]) + wm[14],
        };
        points.push(p);
        if (isHair) containPoints.push(p);
        else silhouettePoints.push(p);
      }
    }
  }
  return { points, silhouettePoints, containPoints };
}

function aabbOf(pts: ReadonlyArray<Vec3>): Bounds {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of pts) {
    if (p.x < min.x) min.x = p.x;
    if (p.y < min.y) min.y = p.y;
    if (p.z < min.z) min.z = p.z;
    if (p.x > max.x) max.x = p.x;
    if (p.y > max.y) max.y = p.y;
    if (p.z > max.z) max.z = p.z;
  }
  return { min, max };
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function boundsToRecord(b: Bounds): { min: Vec3; max: Vec3 } {
  return { min: { x: round4(b.min.x), y: round4(b.min.y), z: round4(b.min.z) }, max: { x: round4(b.max.x), y: round4(b.max.y), z: round4(b.max.z) } };
}

type EyeScan = { present: boolean; matchedMeshes: string[]; bounds: Bounds | null; reason: string };

function scanEyeMeshes(doc: Document): EyeScan {
  const matchedMeshes: string[] = [];
  const pts: Vec3[] = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const wm = node.getWorldMatrix();
    const materialNames = mesh
      .listPrimitives()
      .map((p) => p.getMaterial()?.getName() ?? "")
      .filter(Boolean);
    const names = [mesh.getName() ?? "", node.getName() ?? "", ...materialNames];
    if (!names.some((n) => EYE_MESH_RE.test(n))) continue;
    matchedMeshes.push(node.getName() ?? mesh.getName() ?? "<unnamed>");
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION")?.getArray();
      if (!pos) continue;
      for (let i = 0; i + 2 < pos.length; i += 3) {
        pts.push({
          x: wm[0] * Number(pos[i]) + wm[4] * Number(pos[i + 1]) + wm[8] * Number(pos[i + 2]) + wm[12],
          y: wm[1] * Number(pos[i]) + wm[5] * Number(pos[i + 1]) + wm[9] * Number(pos[i + 2]) + wm[13],
          z: wm[2] * Number(pos[i]) + wm[6] * Number(pos[i + 1]) + wm[10] * Number(pos[i + 2]) + wm[14],
        });
      }
    }
  }
  if (matchedMeshes.length === 0) {
    return {
      present: false,
      matchedMeshes: [],
      bounds: null,
      reason: `0 primitives match ${String(EYE_MESH_RE)} (mesh name or material name)`,
    };
  }
  return { present: true, matchedMeshes, bounds: aabbOf(pts), reason: "" };
}

type LabEvidence = {
  focusRegion:
    | { kind: "eye_box"; matchedMeshes?: string[]; boundsMeters?: unknown }
    | { kind: "whole_subject_fallback"; reason?: string }
    | null;
  packFraming?: {
    packCamera?: {
      fov: number;
      distance: number;
      position: Vec3;
      target: Vec3;
    } | null;
  };
};

async function captureCurrentLab(
  page: Page,
  baseUrl: string,
  glb: string,
): Promise<LabEvidence> {
  const spec = {
    subjectId: "pre-fix-current-behaviour",
    subjectKind: "glb",
    bodyGlb: glb.replace("apps/ui-xr/public/", ""),
    view: "front",
    focus: "eyes",
    subjectOnly: true,
    label: "pre-fix current behaviour",
  };
  const url = `${baseUrl}isolated-subject.html?subject=${encodeURIComponent(JSON.stringify(spec))}`;
  await page.setViewportSize({ width: PACK_VIEWPORT.width, height: PACK_VIEWPORT.height });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const handle = await page.waitForFunction(
    () => {
      const evidence = (window as unknown as {
        __openClinXrIsolatedSubjectEvidence?: LabEvidence;
      }).__openClinXrIsolatedSubjectEvidence;
      return evidence && typeof (evidence as { meshCount?: number }).meshCount === "number"
        ? evidence
        : null;
    },
    null,
    { timeout: 120_000 },
  );
  return (await handle.jsonValue()) as LabEvidence;
}

export type HeadFocusPreFix = {
  schemaVersion: "openclinxr.head-focus.pre-fix.v1";
  issue: "358";
  factoryStep: "instrument";
  measuredAt: string;
  generator: {
    tool: "writeHeadFocusPreFix";
    file: "tools/openclinxr/evidence/head-focus-inspection.ts";
    deterministic: true;
    llmInvolved: false;
  };
  framing: {
    viewportPx: { width: number; height: number };
    camera: {
      fovDegrees: number;
      view: string;
      note: string;
    };
  };
  subjects: Array<{
    rail: string;
    role: string;
    glb: string;
    bodyBoundsMeters: { min: Vec3; max: Vec3 };
    bodyHeightMeters: number;
    headBoxMeters: {
      min: Vec3;
      max: Vec3;
      heightFractionOfBody: number;
      neckPositionMeters: number;
      dominantAxis: string;
      vertexCount: number;
      derivation: string;
    };
    eyeBox: {
      present: boolean;
      matchedMeshes: string[];
      boundsMeters: { min: Vec3; max: Vec3 } | null;
      reason: string;
    };
    framingCurrentCodeSelects: string;
    framingReason: string;
    onScreenHeadHeightPx: number;
    onScreenHeadHeightDerivation: string;
  }>;
  claimScope: string[];
  notEvidenceFor: string[];
};

export async function writeHeadFocusPreFix(options?: { cwd?: string; outputRoot?: string }): Promise<HeadFocusPreFix> {
  const cwd = options?.cwd ?? process.cwd();
  const outputRoot = options?.outputRoot ?? HEAD_FOCUS_EVIDENCE_ROOT;
  const outDir = path.join(cwd, outputRoot);

  // Browser measurement of the CURRENT (unmodified) lab — one boot, two renders.
  let server: PortlessDevServer | null = null;
  let browser: Browser | null = null;
  const labByRail = new Map<string, LabEvidence>();
  try {
    server = await spawnPortlessDevServer({
      filter: "@openclinxr/ui-xr",
      cwd,
      readyTimeoutMs: 180_000,
    });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { ...PACK_VIEWPORT }, deviceScaleFactor: 1 });
    for (const s of HEAD_FOCUS_SUBJECTS) {
      labByRail.set(s.rail, await captureCurrentLab(page, server.url, s.glb));
    }
  } finally {
    if (browser) await browser.close();
    if (server) await stopPortlessDevServer(server.proc);
  }

  const io = new NodeIO();
  const subjects: HeadFocusPreFix["subjects"] = [];
  for (const s of HEAD_FOCUS_SUBJECTS) {
    const doc = await io.read(path.join(cwd, s.glb));
    const split = worldPoints(doc);
    const pts = split.points;
    const silhouettePoints = split.silhouettePoints;
    const containPoints = split.containPoints;
    const bodyBounds = aabbOf(pts);
    const bodyHeight = bodyBounds.max.y - bodyBounds.min.y;
    const head = deriveHeadBoxFromPoints(pts, { silhouettePoints, containPoints }) as HeadBoxGeometry | null;
    if (!head) {
      throw new Error(`${s.rail} ${s.glb}: the geometry-derived head box is null — cannot build the before-column`);
    }
    const headHeight = head.box.max.y - head.box.min.y;
    const eye = scanEyeMeshes(doc);
    const lab = labByRail.get(s.rail);
    const framing = lab?.focusRegion?.kind ?? "none";
    const camera = lab?.packFraming?.packCamera;
    if (!camera) {
      throw new Error(`${s.rail}: the current lab did not record a pack camera for the front view`);
    }
    const headPx = projectPixelSpan({
      subject: head.box,
      cameraPosition: camera.position,
      lookAt: camera.target,
      fovDegrees: camera.fov,
      viewport: PACK_VIEWPORT,
    });
    subjects.push({
      rail: s.rail,
      role: s.role,
      glb: s.glb,
      bodyBoundsMeters: boundsToRecord(bodyBounds),
      bodyHeightMeters: round4(bodyHeight),
      headBoxMeters: {
        min: head.box.min,
        max: head.box.max,
        heightFractionOfBody: Math.round((headHeight / bodyHeight) * 1000) / 1000,
        neckPositionMeters: round4(head.neckPosition),
        dominantAxis: head.dominantAxis,
        vertexCount: head.vertexCount,
        derivation:
          "topmost band of the body bounds cut at the neck — silhouette width profile of the body mesh "
          + "(skull widest slice, then the profile minimum below it is the neck); never the eye mesh, "
          + "never literal camera coordinates (D1)",
      },
      eyeBox: {
        present: eye.present,
        matchedMeshes: eye.matchedMeshes,
        boundsMeters: eye.bounds ? boundsToRecord(eye.bounds) : null,
        reason: eye.reason,
      },
      framingCurrentCodeSelects: framing,
      framingReason:
        framing === "eye_box"
          ? "eye mesh matched — the lab frames the derived eye box"
          : framing === "whole_subject_fallback"
            ? "no eye mesh matched — the lab SILENTLY falls back to whole-subject framing (the #358 defect)"
            : "no focus region recorded",
      onScreenHeadHeightPx: Math.round(headPx * 10) / 10,
      onScreenHeadHeightDerivation:
        "the file-side head box projected under the pack camera the CURRENT lab actually placed "
        + "(focus=eyes, view=front, 1024x1024), via the same pure-perspective math as the #354 pre-fix "
        + "(projectPixelSpan); " + (framing === "whole_subject_fallback"
          ? "the head is a small fraction of the whole-subject frame"
          : "the framed eye box is far smaller than the head, so the head overflows the frame"),
    });
  }

  const preFix: HeadFocusPreFix = {
    schemaVersion: "openclinxr.head-focus.pre-fix.v1",
    issue: "358",
    factoryStep: "instrument",
    measuredAt: new Date().toISOString(),
    generator: {
      tool: "writeHeadFocusPreFix",
      file: "tools/openclinxr/evidence/head-focus-inspection.ts",
      deterministic: true,
      llmInvolved: false,
    },
    framing: {
      viewportPx: { ...PACK_VIEWPORT },
      camera: {
        fovDegrees: 35,
        view: "front",
        note:
          "the CURRENT isolated-subject-lab focus=eyes behaviour, measured in-browser BEFORE any product "
          + "edit: MPFB frames the derived eye box; Anny silently falls back to whole-subject framing",
      },
    },
    subjects,
    claimScope: [
      "pre_fix_before_column_for_the_head_focus_station",
      "current_framing_selection_measured_in_browser_before_any_product_edit",
      "head_box_derived_from_body_geometry_only",
      "eye_box_presence_measured_file_side",
      "on_screen_head_height_px_under_the_current_behaviour",
    ],
    notEvidenceFor: [
      "which_hair_mechanism_is_correct_pixel_grade_of_the_post_fix_crops_required",
      "clinical_realism",
      "quest_readiness",
      "learner_readiness",
    ],
  };

  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "pre-fix.json");
  await writeFile(outPath, `${JSON.stringify(preFix, null, 2)}\n`, "utf8");
  return preFix;
}

// CLI — only when this file is the entrypoint.
const isMain = Boolean(
  process.argv[1]
  && (import.meta.url === `file://${path.resolve(process.argv[1])}`
    || import.meta.url.endsWith(process.argv[1]!.replaceAll("\\", "/"))),
);

if (isMain) {
  writeHeadFocusPreFix()
    .then((preFix) => {
      console.log(JSON.stringify({
        path: `${HEAD_FOCUS_EVIDENCE_ROOT}/pre-fix.json`,
        subjects: preFix.subjects.map((s) => ({
          rail: s.rail,
          framingCurrentCodeSelects: s.framingCurrentCodeSelects,
          onScreenHeadHeightPx: s.onScreenHeadHeightPx,
          headHeightFractionOfBody: s.headBoxMeters.heightFractionOfBody,
          eyePresent: s.eyeBox.present,
        })),
      }, null, 2));
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    });
}
