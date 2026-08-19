/**
 * #434 (#423 E6.3) — THREE GRADEABLE MOUTH STILLS OF `mpfb-viseme-inspect.glb` (aa / PP / sil).
 *
 * E6.3 (`02a9526a`) landed the asset: 47 morph targets (32 FACS + 15 viseme), `viseme_aa`
 * displacing 18.16 mm at vertex 494 whose dominant joint is `oris01` (lip weight 0.99),
 * `viseme_sil` at rest. That is a MEASUREMENT. Nobody has looked at it — this probe produces
 * the three stills the lead grades. No rebake, no shipped actor touched, no runtime wiring.
 *
 * ## THE INSTRUMENT (same as #431 — the isolated subject lab, not the scenario runtime)
 *
 * `apps/ui-xr/isolated-subject.html` (`isolated-subject-lab.ts`), a separate render path
 * that derives the camera from the subject mesh and has produced graded renders. Spec:
 * `subjectKind: "glb"`, `bodyGlb: generated-humanoids/mpfb-viseme-inspect.glb`,
 * `focus: "head"`. The lab derives the head box from the body's own bind-pose bounds
 * (`computeMeshBounds` -> `resolveFocus("head")` -> `frameCamera`); no camera position is
 * authored here (D1). Not Blender Workbench (ignores Principled Base Color), not a point cloud.
 *
 * ## THE THREE STATES — each target at weight 1.0, the other 46 at 0
 *
 * The lab cannot drive phonemes, so each shot is the same GLB bytes with ONE viseme target
 * driven to full weight and every other influence forced to 0 by an in-page applier that
 * starts before the GLB finishes loading and re-applies every 5 ms until the lab's 4-frame
 * render loop has drawn its final frame. `viseme_sil` is the rest control — #426 measured it
 * at 0 vertices, so its frame must read as a closed neutral mouth.
 *
 * ## SAME CAMERA, SAME FRAMING — BY CONSTRUCTION, PROVEN BY MEASUREMENT
 *
 * `computeMeshBounds` / `resolveFocus` read bind-pose positions (no morph displacement), so
 * the head box and the derived camera are identical whether any morph is applied. This probe
 * compares the recorded head boxes across the three loads to 1 mm and refuses to write unless
 * they match — one shared derived camera, not three cameras that happen to look alike.
 *
 * ## headFrameFraction — the head AABB projected through the DERIVED camera
 *
 * The lab records the head box (`focusRegion.boundsMeters`) and the framing target (AABB
 * center + 5% height, `packFraming`); the legacy camera pose is `frameCamera`'s non-view
 * branch: `distance = max(size)*2.4`, position = center + (d*0.55, radius*0.35, d*0.85),
 * fov 35, aspect 1280/960. This probe re-derives that pose from the RECORDED head box with
 * the same arithmetic (no `three` import — pure math, same constants) and projects the 8
 * head-box corners to NDC. `headFrameFraction` = projected bbox area / frame area. The
 * planted contract floors it at 0.15 — a full-body frame where the mouth is a few pixels
 * fails clause (4) for exactly this reason.
 *
 * ## CONTENT IS LUMINANCE sd, NEVER BYTES
 *
 * The probe prints `regionLuminance` (the same `lib/png-region-luminance` reader the planted
 * contract uses) per still as a self-check; a flat grey field (sd < 1) or an empty render
 * refuses before the artifact is written. The contract asserts sd > 8 — do not reintroduce
 * a byte floor.
 *
 * ## NOT TESTED / CLAIM SCOPE
 *
 * This probe does not judge whether the shapes look like speech — the lead grades the three
 * on a closed checklist (`mouth_moves_aa` / `lips_close_PP` / `sil_is_rest`). No cause, no
 * fix, no rebake, no GLB touched, no `apps/ui-xr` product edit.
 *
 * ## FIXED (#442) — the ROUNDED pair joins the set
 *
 * #434's three shapes (aa / PP / sil) are all producible by the lip ring alone, so "the
 * visemes02 pack is lip-only" was an inference, not a finding. The two shapes that cannot be
 * faked by lips — `viseme_O` (protrusion + jaw travel) and `viseme_U` (protrusion) — are now
 * rendered at weight 1.0 through the SAME instrument, camera and GLB. `TARGETS` /
 * `STILLS` above are the only knobs changed; the in-page applier, the head-box camera
 * identity check, the sd>8 content refusal and the distinct-hash check now cover five
 * targets. The lead grades the O/U pair on whether the jaw drops and the lips round.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import {
  type PortlessDevServer,
  spawnPortlessDevServer, stopPortlessDevServer,
} from "./lib/portless-server.js";
import { regionLuminance } from "./lib/png-region-luminance.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");

/** The targets the lead grades — exact glTF morph-target names on the asset. */
const TARGETS = ["viseme_aa", "viseme_PP", "viseme_sil", "viseme_O", "viseme_U"] as const;
type Target = (typeof TARGETS)[number];

const SUBJECT = "mpfb-viseme-inspect.glb";
const GLB_URL_PATH = "/generated-humanoids/mpfb-viseme-inspect.glb";
const GLB_DISK_PATH = join(REPO_ROOT, "apps/ui-xr/public", GLB_URL_PATH);
const MORPH_WEIGHT = 1.0;

const STILLS: Record<Target, string> = {
  viseme_aa: "tools/openclinxr/evidence/stills/viseme-inspect-aa.png",
  viseme_PP: "tools/openclinxr/evidence/stills/viseme-inspect-pp.png",
  viseme_sil: "tools/openclinxr/evidence/stills/viseme-inspect-sil.png",
  viseme_O: "tools/openclinxr/evidence/stills/viseme-inspect-o.png",
  viseme_U: "tools/openclinxr/evidence/stills/viseme-inspect-u.png",
};
const ARTIFACT = join(REPO_ROOT, "tools/openclinxr/evidence/viseme-inspect-stills.json");

/** The lab's legacy framing constants (camera-fit-to-bounds.ts `frameCamera`, non-view branch). */
const FOV_DEG = 35;
const VIEW_W = 1280;
const VIEW_H = 960;

type Vec3 = { x: number; y: number; z: number };
type LabEvidence = {
  meshCount: number;
  boundsMeters: { width: number; height: number; depth: number };
  packFraming: {
    boundsMin: Vec3;
    boundsMax: Vec3;
  };
  frameCoverage: number;
  frameSpanFraction: number | null;
  focusRegion: {
    kind: string;
    boundsMeters: { min: Vec3; max: Vec3 };
  };
};

/** In-page applier: forces ONE target to weight 1.0 and every other influence to 0, every 5 ms. */
function morphApplierEvaluate(morphName: string, weight: number): string {
  return `(() => {
    const MORPH = ${JSON.stringify(morphName)};
    const WEIGHT = ${JSON.stringify(weight)};
    let applied = 0;
    const step = function () {
      const root = window.__openClinXrIsolatedSceneRoot;
      if (!root) return;
      root.traverse(function (o) {
        if (!o.isSkinnedMesh || !o.morphTargetDictionary || !o.morphTargetInfluences) return;
        const idx = o.morphTargetDictionary[MORPH];
        if (idx === undefined) return;
        for (let k = 0; k < o.morphTargetInfluences.length; k++) o.morphTargetInfluences[k] = 0;
        o.morphTargetInfluences[idx] = WEIGHT;
        applied += 1;
      });
    };
    window.__openClinXrMorphApplier = { applied: 0, running: true };
    const timer = window.setInterval(function () {
      step();
      window.__openClinXrMorphApplier.applied = applied;
    }, 5);
    window.__openClinXrMorphApplierStop = function () { window.clearInterval(timer); window.__openClinXrMorphApplier.running = false; };
    step();
    return { ok: true };
  })()`;
}

function sha256Hex(data: Buffer | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Re-derive the legacy camera pose from the head box — the SAME arithmetic as
 * `frameCamera`'s non-view branch (camera-fit-to-bounds.ts), so the projection
 * below uses the camera the lab actually rendered with.
 */
function legacyCameraFromHeadBox(b: { min: Vec3; max: Vec3 }): {
  position: Vec3;
  target: Vec3;
  fov: number;
  aspect: number;
} {
  const cx = (b.min.x + b.max.x) / 2;
  const cy = (b.min.y + b.max.y) / 2;
  const cz = (b.min.z + b.max.z) / 2;
  const sx = b.max.x - b.min.x;
  const sy = b.max.y - b.min.y;
  const sz = b.max.z - b.min.z;
  const radius = Math.max(sx, sy, sz, 0.4);
  const distance = radius * 2.4;
  return {
    position: { x: cx + distance * 0.55, y: cy + radius * 0.35, z: cz + distance * 0.85 },
    target: { x: cx, y: cy + sy * 0.05, z: cz },
    fov: FOV_DEG,
    aspect: VIEW_W / VIEW_H,
  };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalize(a: Vec3): Vec3 {
  const len = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / len, y: a.y / len, z: a.z / len };
}

const CORNER_SIGNS: ReadonlyArray<readonly [boolean, boolean, boolean]> = [
  [false, false, false],
  [false, false, true],
  [false, true, false],
  [false, true, true],
  [true, false, false],
  [true, false, true],
  [true, true, false],
  [true, true, true],
];

/**
 * Project the head AABB through the derived camera and return the bbox area as a
 * fraction of the frame area. Mirrors the projection in `frameCamera`'s pack branch
 * (NDC x/y via tanHalf and aspect) applied to the legacy camera pose.
 */
function projectHeadFraction(
  box: { min: Vec3; max: Vec3 },
  cam: { position: Vec3; target: Vec3; fov: number; aspect: number },
): { fraction: number; spanX: number; spanY: number; cornersBehind: number } {
  const fwd = normalize(sub(cam.target, cam.position));
  const up = { x: 0, y: 1, z: 0 };
  const right = normalize(cross(fwd, up));
  const upv = cross(right, fwd);
  const tanHalf = Math.tan((cam.fov * Math.PI) / 360);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let cornersBehind = 0;
  for (const [mx, my, mz] of CORNER_SIGNS) {
    const corner: Vec3 = {
      x: mx ? box.max.x : box.min.x,
      y: my ? box.max.y : box.min.y,
      z: mz ? box.max.z : box.min.z,
    };
    const v = sub(corner, cam.position);
    const depth = dot(v, fwd);
    if (depth < 0.01) {
      cornersBehind += 1;
      continue;
    }
    const x = dot(v, right);
    const y = dot(v, upv);
    const ndcX = x / (depth * tanHalf * cam.aspect);
    const ndcY = y / (depth * tanHalf);
    if (ndcX < minX) minX = ndcX;
    if (ndcX > maxX) maxX = ndcX;
    if (ndcY < minY) minY = ndcY;
    if (ndcY > maxY) maxY = ndcY;
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  return { fraction: (spanX * spanY) / 4, spanX, spanY, cornersBehind };
}

function boundsEqual(a: Vec3, b: Vec3, tol = 0.001): boolean {
  return Math.abs(a.x - b.x) < tol && Math.abs(a.y - b.y) < tol && Math.abs(a.z - b.z) < tol;
}

export async function runVisemeInspectStillsProbe(): Promise<void> {
  let server: PortlessDevServer | undefined;
  const shotRows: Array<{
    target: Target;
    evidence: LabEvidence;
    morphReadback: { targetIndex: number | null; appliedMeshes: number; targetMax: number; otherMax: number; influenceCount: number };
  }> = [];
  try {
    server = await spawnPortlessDevServer({
      filter: "@openclinxr/ui-xr",
      readyTimeoutMs: 180_000,
    });

    // The bytes all three frames are rendered from: hash the served GLB and require it to
    // match the tracked file, so `subjectGlbSha256` is the exact byte identity of the frames.
    const served = await fetch(new URL(GLB_URL_PATH, server.url));
    if (!served.ok) throw new Error(`GLB fetch failed: ${served.status}`);
    const servedBytes = new Uint8Array(await served.arrayBuffer());
    const servedSha256 = sha256Hex(servedBytes);
    const diskBytes = await readFile(GLB_DISK_PATH);
    const diskSha256 = sha256Hex(diskBytes);
    if (servedSha256 !== diskSha256) {
      throw new Error(
        `served GLB (${servedSha256}) differs from tracked file (${diskSha256}) — refusing to record a hash that does not match the frames' bytes`,
      );
    }
    process.stdout.write(`subjectGlbSha256=${servedSha256} (served == tracked)\n`);

    const spec = {
      subjectId: "mpfb_viseme_inspect",
      subjectKind: "glb",
      bodyGlb: "generated-humanoids/mpfb-viseme-inspect.glb",
      focus: "head",
      label: "mpfb-viseme-inspect subject",
    };
    const labUrl = `${server.url}isolated-subject.html?subject=${encodeURIComponent(JSON.stringify(spec))}`;

    const browser = await chromium.launch({ headless: true });
    try {
      for (const target of TARGETS) {
        const page: Page = await browser.newPage({ viewport: { width: VIEW_W, height: VIEW_H } });
        try {
          const pageErrors: string[] = [];
          page.on("pageerror", (err) => pageErrors.push(String(err)));
          // Init script runs BEFORE any page script and survives Vite full-reloads: the
          // applier interval is already polling when the lab exposes the scene root, so it
          // fires within 5 ms of the root appearing — long before the lab's 4-frame render
          // loop draws its final frame. No timing dependence on the dev server's first
          // compile (the #431 probe's post-goto evaluate raced a Vite reload here).
          await page.addInitScript(morphApplierEvaluate(target, MORPH_WEIGHT));
          await page.goto(labUrl, { waitUntil: "networkidle", timeout: 240_000 });
          // Wait for the lab's rendered evidence — or surface the lab's own refusal.
          await page.waitForFunction(
            `(() => {
              if (window.__openClinXrIsolatedSubjectEvidence != null) return true;
              const app = document.querySelector("#app");
              return app != null && app.textContent.includes("Isolated subject lab error");
            })()`,
            { timeout: 120_000 },
          );
          const labError = await page.evaluate(
            `(() => document.querySelector("#app")?.textContent ?? "")()`,
          ) as string;
          if (labError.includes("Isolated subject lab error")) {
            throw new Error(`${target}: isolated subject lab refused: ${labError.slice(0, 2000)}`);
          }
          await page.evaluate(
            `(() => { if (window.__openClinXrMorphApplierStop) window.__openClinXrMorphApplierStop(); })()`,
          );
          await page.waitForTimeout(300); // settle; canvas holds the final rendered frame

          const info = (await page.evaluate(`(() => {
            const ev = window.__openClinXrIsolatedSubjectEvidence;
            const root = window.__openClinXrIsolatedSceneRoot;
            const TARGET = ${JSON.stringify(target)};
            const out = {
              evidence: null,
              targetIndex: null,
              appliedMeshes: 0,
              targetMax: 0,
              otherMax: 0,
              influenceCount: 0,
              morphCount: 0,
            };
            if (ev) {
              out.evidence = {
                meshCount: ev.meshCount,
                boundsMeters: ev.boundsMeters,
                packFraming: ev.packFraming,
                frameCoverage: ev.frameCoverage,
                frameSpanFraction: ev.frameSpanFraction,
                focusRegion: ev.focusRegion,
              };
            }
            if (root) {
              root.traverse(function (o) {
                if (!o.isSkinnedMesh || !o.morphTargetDictionary || !o.morphTargetInfluences) return;
                out.morphCount = o.morphTargetInfluences.length;
                const idx = o.morphTargetDictionary[TARGET];
                if (idx === undefined) return;
                out.targetIndex = idx;
                const t = Math.abs(o.morphTargetInfluences[idx] || 0);
                if (t > out.targetMax) out.targetMax = t;
                if (Math.abs(t - 1) < 1e-6) out.appliedMeshes += 1;
                for (let k = 0; k < o.morphTargetInfluences.length; k++) {
                  if (k === idx) continue;
                  const v = Math.abs(o.morphTargetInfluences[k] || 0);
                  if (v > out.otherMax) out.otherMax = v;
                }
              });
            }
            return out;
          })()`) as unknown as {
            evidence: LabEvidence | null;
            targetIndex: number | null;
            appliedMeshes: number;
            targetMax: number;
            otherMax: number;
            influenceCount: number;
            morphCount: number;
          });
          if (!info.evidence) {
            throw new Error(
              `${target}: lab evidence missing (pageErrors: ${pageErrors.join(" | ") || "none"})`,
            );
          }
          if (info.targetIndex === null) {
            throw new Error(`${target}: morph target absent from every skinned mesh`);
          }
          if (info.appliedMeshes === 0) {
            throw new Error(`${target}: applier never drove the target to weight 1.0 on a mesh`);
          }
          if (info.targetMax < 0.99) {
            throw new Error(`${target}: target influence read ${info.targetMax}, expected 1.0`);
          }
          if (info.otherMax > 1e-6) {
            throw new Error(`${target}: other influences not at 0 (max ${info.otherMax})`);
          }

          const abs = join(REPO_ROOT, STILLS[target]);
          await mkdir(dirname(abs), { recursive: true });
          const canvas = page.locator("#isolated-subject-capture-canvas");
          if (await canvas.count()) {
            await canvas.screenshot({ path: abs });
          } else {
            await page.screenshot({ path: abs, type: "png" });
          }
          const stillBytes = await readFile(abs);
          const lum = regionLuminance(stillBytes);
          if (!lum || lum.sd <= 8) {
            throw new Error(
              `${target}: flat/empty frame (mean ${lum?.mean.toFixed(1) ?? "?"}, sd ${lum?.sd.toFixed(2) ?? "?"}) — nothing rendered`,
            );
          }
          process.stdout.write(
            `${target}: meshCount=${info.evidence.meshCount} coverage=${info.evidence.frameCoverage.toFixed(3)} ` +
              `targetMax=${info.targetMax} otherMax=${info.otherMax} sd=${lum.sd.toFixed(2)}\n`,
          );
          shotRows.push({
            target,
            evidence: info.evidence,
            morphReadback: {
              targetIndex: info.targetIndex,
              appliedMeshes: info.appliedMeshes,
              targetMax: info.targetMax,
              otherMax: info.otherMax,
              influenceCount: info.morphCount,
            },
          });
        } finally {
          await page.close().catch(() => undefined);
        }
      }
    } finally {
      await browser.close();
    }

    // --- Same derived camera: head boxes must match to the millimetre across all three. ---
    const first = shotRows[0]!;
    for (const row of shotRows) {
      if (
        !boundsEqual(row.evidence.packFraming.boundsMin, first.evidence.packFraming.boundsMin) ||
        !boundsEqual(row.evidence.packFraming.boundsMax, first.evidence.packFraming.boundsMax)
      ) {
        throw new Error(
          `${row.target}: lab derived DIFFERENT head bounds than ${first.target} — the three shots do not share one derived camera`,
        );
      }
    }

    // --- headFrameFraction per shot from the recorded head box + the derived camera. ---
    const headBox = {
      min: first.evidence.focusRegion.boundsMeters.min,
      max: first.evidence.focusRegion.boundsMeters.max,
    };
    const camera = legacyCameraFromHeadBox(headBox);
    const projected = projectHeadFraction(headBox, camera);
    if (projected.cornersBehind > 0) {
      throw new Error(`head box projection: ${projected.cornersBehind} corners behind the camera — framing is unusable`);
    }
    if (projected.fraction <= 0.15) {
      throw new Error(
        `head occupies ${(projected.fraction * 100).toFixed(1)}% of the frame — below the 15% clause; mouth unreadable`,
      );
    }
    process.stdout.write(
      `headFrameFraction=${projected.fraction.toFixed(3)} (spanX=${projected.spanX.toFixed(3)}, spanY=${projected.spanY.toFixed(3)})\n`,
    );

    // --- Rows come from each file's own bytes, after all three exist. ---
    const shots = [];
    const stillHashes = new Set<string>();
    for (const row of shotRows) {
      const stillAbs = join(REPO_ROOT, STILLS[row.target]);
      const [stillBytes, stillStat] = await Promise.all([readFile(stillAbs), stat(stillAbs)]);
      const sha = sha256Hex(stillBytes);
      stillHashes.add(sha);
      const lum = regionLuminance(stillBytes)!;
      shots.push({
        target: row.target,
        weight: 1,
        still: STILLS[row.target],
        bytes: stillStat.size,
        sha256: sha,
        headFrameFraction: Number(projected.fraction.toFixed(4)),
        frameCoverage: Number(row.evidence.frameCoverage.toFixed(4)),
        luminance: {
          mean: Number(lum.mean.toFixed(2)),
          sd: Number(lum.sd.toFixed(2)),
        },
        morphReadback: row.morphReadback,
      });
    }
    if (stillHashes.size !== TARGETS.length) {
      throw new Error(
        `the stills are not distinct (${stillHashes.size} unique hashes for ${TARGETS.length} targets) — a morph did not bind; refusing to write an artifact that compares nothing`,
      );
    }

    const artifact = {
      schemaVersion: "openclinxr.viseme-inspect-stills.v1",
      issue: "442",
      subIssueOf: "423",
      generatedAt: new Date().toISOString(),
      subject: SUBJECT,
      subjectGlbSha256: servedSha256,
      camera: {
        derivation:
          "legacy framing of the lab-derived head box (camera-fit-to-bounds.ts frameCamera, non-view branch), recomputed in this probe from the lab-recorded head AABB (focusRegion.boundsMeters): distance = max(headSize)*2.4, position = headCenter + (d*0.55, radius*0.35, d*0.85), lookAt headCenter + 5% height; fov 35, aspect 1280/960; never a hardcoded position (D1); identical for all five shots by construction (bind-pose bounds) and verified to 1 mm across the loads",
        fov: camera.fov,
        aspect: Number(camera.aspect.toFixed(4)),
        position: camera.position,
        target: camera.target,
        headBoxMeters: headBox,
        framePx: { width: VIEW_W, height: VIEW_H },
        headFrameFractionDerivation:
          "projected head AABB bbox area / frame area — the 8 head-box corners projected to NDC through the derived camera",
      },
      source:
        "isolated subject lab renders (apps/ui-xr/isolated-subject.html -> isolated-subject-lab.ts) via playwright headless chromium against the ui-xr " +
        "portless dev server (spawnPortlessDevServer filter @openclinxr/ui-xr); subjectKind=glb, bodyGlb=generated-humanoids/mpfb-viseme-inspect.glb, focus=head; " +
        "camera derived by the lab from the head-region AABB of the subject's own unmorphed bounds, never hardcoded; each shot drives ONE viseme target to " +
        "weight 1.0 with all other influences forced to 0 by an in-page applier running before the lab's 4-frame render loop draws its final frame; " +
        "viseme_sil is the rest control (#426 measured 0 displaced vertices); NOT the scenario runtime, NOT a static asset read, NOT a rebake.",
      shots,
      claimScope:
        "five stills of mpfb-viseme-inspect.glb (viseme_aa / viseme_PP / viseme_sil / viseme_O / viseme_U, each at weight 1.0 with the other 46 targets at 0), one shared " +
        "mesh-derived head-framed camera, head AABB bbox occupying >15% of the frame; #423 E6.3 (#434 aa/PP/sil, #442 O/U) — the artifacts the lead grades",
      notEvidenceFor: [
        "whether the shapes look like speech (the lead grades the five on a closed checklist)",
        "the runtime speaking state (this is a viseme stand-in, not dialogue)",
        "any cause or fix",
        "production phoneme timing",
        "clinical validity",
        "scoring validity",
        "quest readiness",
      ],
    };

    const json = `${JSON.stringify(artifact, null, 2)}\n`;
    await writeFile(ARTIFACT, json, "utf8");
    process.stdout.write(`${ARTIFACT}\n`);
    for (const t of TARGETS) process.stdout.write(`${join(REPO_ROOT, STILLS[t])}\n`);
  } finally {
    if (server) {
      try {
        await stopPortlessDevServer(server.proc);
      } catch {
        // ignore
      }
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void runVisemeInspectStillsProbe().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
  });
}
