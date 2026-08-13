/**
 * #63 viseme vertical capture — live mesh morph samples + head-and-shoulders frames.
 *
 * Reads mesh.morphTargetInfluences[mesh.morphTargetDictionary[name]] via page.evaluate
 * on window.__openClinXrDebugScene (patient mesh only). Driver self-report is not evidence.
 *
 * Measured 2026-08-13 (#365): the peds asthma patient renders as the Anny
 * `peds_patient_child` base (9 viseme_* keys driven at weight 1.0 by the named drive),
 * while the parent/nurse are MPFB FACS bodies (`mouth-*`) driven through the #353 alias
 * map — the sampler accepts BOTH spellings and reads all mouth-family morphs by influence.
 * Frames are graded by the orchestrator; the states artifact is the contract surface.
 *
 * SUPERSEDED (#366): the peds cast now loads MPFB bodies, so the driven patient mesh is
 * `mpfb_peds_patient_child_body` — the sampler/reframe name regex covers both spellings and
 * the artifact's actor label is derived from the live scene, not this historical note.
 *
 * #368 remaining half: the artifact records the reframe OUTCOME (target mesh name + world
 * position, or the failure code), so a face-framed capture can say what it actually framed.
 *
 * claimScope: mouth. notEvidenceFor: anatomy bind-pose, production phoneme timing, Quest.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { type PortlessDevServer, spawnPortlessDevServer } from "./lib/portless-server.js";

const OUTPUT_DIR = ".openclinxr/evidence/viseme-drive-2026-08-06";
const INSPECTION_PATH = path.join(OUTPUT_DIR, "inspection.json");

/**
 * face-detail alone keeps natural dialogue duration (~phonemeCount*90ms) so progress spans
 * many visemes. Camera is re-framed in-page onto the patient head (face-detail default looks left).
 */
const CAPTURE_QUERY =
  "openclinxrScenarioId=peds_asthma_parent_anxiety_v1" +
  "&openclinxrCaptureMode=face-detail" +
  "&openclinxrPortalStart=encounter" +
  "&openclinxrAcceleratedExam=1";

type Reading = {
  meshName: string;
  targetName: string;
  influence: number;
  index: number;
};

type SceneSample = {
  t: number;
  readings: Reading[];
  peak: { targetName: string; influence: number; meshName: string } | null;
  speech?: { activeViseme?: string; activePhoneme?: string; activeMouthOpenness?: number } | null;
};

async function samplePatientVisemes(page: Page): Promise<SceneSample> {
  // String IIFE (not a TS arrow) so tsx/esbuild cannot inject `__name` into the browser.
  return page.evaluate(`(() => {
    const win = window;
    const scene = win.__openClinXrDebugScene;
    let patientMesh = null;
    if (scene && typeof scene.traverse === "function") {
      scene.traverse(function (object) {
        if (patientMesh) return;
        const dict = object.morphTargetDictionary;
        if (!dict) return;
        const name = object.name || "";
        if (!/peds_patient|patient_child/i.test(name)) return;
        const keys = Object.keys(dict);
        const hasMouthFamily = keys.some(function (k) {
          const lk = k.toLowerCase();
          return lk.indexOf("viseme_") === 0 || lk.indexOf("mouth") === 0 || lk.indexOf("openclinxr_mouth") === 0;
        });
        if (hasMouthFamily) patientMesh = object;
      });
    }

    const readings = [];
    const dict = patientMesh && patientMesh.morphTargetDictionary;
    const influences = patientMesh && patientMesh.morphTargetInfluences;
    if (dict && influences) {
      for (const targetName of Object.keys(dict)) {
        const index = dict[targetName];
        if (typeof index !== "number" || index < 0 || index >= influences.length) continue;
        const influence = influences[index] || 0;
        if (influence <= 0.01) continue;
        readings.push({
          meshName: patientMesh.name || "",
          targetName,
          influence,
          index
        });
      }
    }
    readings.sort(function (a, b) { return b.influence - a.influence; });
    const peak = readings[0]
      ? { targetName: readings[0].targetName, influence: readings[0].influence, meshName: readings[0].meshName }
      : null;

    const speech = win.__openClinXrHumanoidSpeechEvidence;
    return {
      t: 0,
      readings,
      peak,
      speech: speech
        ? {
            activeViseme: speech.activeViseme,
            activePhoneme: speech.activePhoneme,
            activeMouthOpenness: speech.activeMouthOpenness
          }
        : null
    };
  })()`);
}

type ReframeOkOutcome = {
  status: "ok";
  targetMeshName: string;
  targetWorldPosition: { x: number; y: number; z: number };
  /** Live actor identity stamped on the humanoid root (userData.openClinXrActorId), or null. */
  actorId: string | null;
  headY: number;
  fov: number;
  cameraLocal: { x: number; y: number; z: number };
};

type ReframeFailureOutcome = {
  status: "no-scene" | "no-camera" | "no-patient-mesh";
};

type ReframeOutcome = ReframeOkOutcome | ReframeFailureOutcome;

function reframeOutcomeSummary(outcome: ReframeOutcome): string {
  if (outcome.status !== "ok") {
    return `in-page face reframe FAILED: ${outcome.status}`;
  }
  const p = outcome.targetWorldPosition;
  const c = outcome.cameraLocal;
  return (
    `in-page head-and-shoulders reframe on ${outcome.targetMeshName} ` +
    `(world ${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)} ` +
    `headY=${outcome.headY.toFixed(2)} fov=${outcome.fov} ` +
    `camLocal=${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(2)})`
  );
}

async function reframeCameraOnPatientFace(page: Page): Promise<ReframeOutcome> {
  // String IIFE (not a TS arrow) so tsx/esbuild cannot inject `__name` into the browser.
  return page.evaluate(`(() => {
    const isRecord = function (value) {
      return typeof value === "object" && value !== null;
    };

    const hasPositionApi = function (value) {
      if (!isRecord(value)) return false;
      const position = value["position"];
      if (!isRecord(position)) return false;
      return typeof position["set"] === "function" && typeof value["lookAt"] === "function";
    };

    const scene = window.__openClinXrDebugScene;
    if (!scene || typeof scene.traverse !== "function") return { status: "no-scene" };

    // Collector avoids let-null + closure assignment narrowing to never under some TS checkers.
    const found = {
      camera: null,
      patientMesh: null
    };
    scene.traverse(function (object) {
      if (!isRecord(object)) return;
      if (object["isPerspectiveCamera"] === true || object["type"] === "PerspectiveCamera") {
        found.camera = object;
      }
      const name = typeof object["name"] === "string" ? object["name"] : "";
      const dict = object["morphTargetDictionary"];
      if (!isRecord(dict)) return;
      const keys = Object.keys(dict);
      const hasMouthFamily = keys.some(function (k) {
        const lk = k.toLowerCase();
        return lk.indexOf("viseme_") === 0 || lk.indexOf("mouth") === 0 || lk.indexOf("openclinxr_mouth") === 0;
      });
      if (hasMouthFamily && /peds_patient|patient_child/i.test(name)) {
        // First match wins — the sampler (samplePatientVisemes) stops at the first
        // matching mesh, so the camera must frame the same object the sampler reads.
        // Last-match-wins framed a different mesh (body_8) than the sampler sampled
        // (body) and the counterweight caught it.
        if (!found.patientMesh) found.patientMesh = object;
      }
    });

    if (!hasPositionApi(found.camera)) return { status: "no-camera" };
    if (!isRecord(found.patientMesh)) return { status: "no-patient-mesh" };
    const camera = found.camera;
    const patientMesh = found.patientMesh;

    // Walk up to the humanoid root for the live actor identity — never a hardcoded label.
    let actorId = null;
    let cursor = patientMesh;
    while (cursor && cursor["parent"]) {
      const ud = cursor["userData"];
      if (ud && typeof ud["openClinXrActorId"] === "string") {
        actorId = ud["openClinXrActorId"];
        break;
      }
      cursor = cursor["parent"];
    }

    const updateMeshWorld = patientMesh["updateWorldMatrix"];
    if (typeof updateMeshWorld === "function") {
      updateMeshWorld.call(patientMesh, true, false);
    }
    const parent = isRecord(camera.parent) ? camera.parent : undefined;
    const updateParentWorld = parent && parent["updateWorldMatrix"];
    if (typeof updateParentWorld === "function") {
      updateParentWorld.call(parent, true, false);
    }

    const matrixWorld = isRecord(patientMesh["matrixWorld"]) ? patientMesh["matrixWorld"] : undefined;
    const elements = matrixWorld && matrixWorld["elements"];
    const e = elements && typeof elements === "object" ? elements : undefined;
    // matrixWorld translation = elements[12,13,14]
    const px = e ? Number(e[12]) : 0;
    const py = e ? Number(e[13]) : 1.0;
    const pz = e ? Number(e[14]) : 0;
    // Head sits above mesh origin on these exports; pull in for mouth-legible framing.
    const headY = py + 1.12;
    // Camera is parented under locomotionRig — convert world aim to parent-local.
    const worldCam = {
      x: px + 0.04,
      y: headY + 0.04,
      z: pz + 0.72
    };
    const worldToLocal = parent && typeof parent["worldToLocal"] === "function"
      ? parent["worldToLocal"]
      : undefined;
    if (worldToLocal) {
      const local = camera.position.clone();
      local.set(worldCam.x, worldCam.y, worldCam.z);
      worldToLocal.call(parent, local);
      camera.position.copy(local);
    } else {
      camera.position.set(worldCam.x, worldCam.y, worldCam.z);
    }
    // lookAt expects world coordinates
    camera.lookAt(px, headY - 0.04, pz);
    camera.fov = 28;
    if (typeof camera.updateProjectionMatrix === "function") camera.updateProjectionMatrix();

    return {
      status: "ok",
      targetMeshName: typeof patientMesh["name"] === "string" ? patientMesh["name"] : "",
      targetWorldPosition: { x: Number(px), y: Number(py), z: Number(pz) },
      actorId: actorId,
      headY: Number(headY),
      fov: 28,
      cameraLocal: {
        x: Number(camera.position.x),
        y: Number(camera.position.y),
        z: Number(camera.position.z)
      }
    };
  })()`);
}

async function retriggerPatientDialogue(page: Page): Promise<void> {
  // Click the work-of-breathing trace to restart speech if the first utterance already ended.
  const button = page.getByRole("button", { name: /Work Of Breathing/i });
  if (await button.count()) {
    await button.first().click({ timeout: 5_000 }).catch(() => undefined);
  }
}

export async function runVisemeCapture(): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });

  let server: PortlessDevServer | undefined;
  try {
    server = await spawnPortlessDevServer({
      filter: "@openclinxr/ui-xr",
      readyTimeoutMs: 180_000,
    });

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1280 } });
      const url = `${server.url}?${CAPTURE_QUERY}`;
      await page.goto(url, { waitUntil: "networkidle", timeout: 180_000 });

      // Wait for ANY mouth-family morph mesh (Anny viseme_* OR MPFB FACS mouth-*).
      await page.waitForFunction(
        `(() => {
          const scene = window.__openClinXrDebugScene;
          if (!scene || typeof scene.traverse !== "function") return false;
          let found = false;
          scene.traverse(function (o) {
            const dict = o.morphTargetDictionary;
            if (!dict) return;
            for (const k of Object.keys(dict)) {
              const lk = k.toLowerCase();
              if (lk.indexOf("viseme_") === 0 || lk.indexOf("mouth") === 0 || lk.indexOf("openclinxr_mouth") === 0) {
                found = true;
                return;
              }
            }
          });
          return found;
        })()`,
        { timeout: 180_000 },
      );

      const reframeOutcomes: ReframeOutcome[] = [];
      const initialReframe = await reframeCameraOnPatientFace(page);
      reframeOutcomes.push(initialReframe);
      process.stdout.write(`camera: ${reframeOutcomeSummary(initialReframe)}\n`);
      await page.waitForTimeout(600);
      // Restart the patient's dialogue so the sampling window covers a full utterance from t≈0.
      await retriggerPatientDialogue(page);
      await page.waitForTimeout(120);

      const liveSamples: Array<{
        t: number;
        targetName: string;
        influence: number;
        meshName: string;
        framePath: string | null;
      }> = [];
      const rawTimeline: SceneSample[] = [];
      const t0 = Date.now();
      const strongByName = new Map<string, { t: number; influence: number; framePath: string | null }>();

      // One state sample per step. The page's render loop is slow (measured ~6 fps in
      // headless), so screenshots (~500 ms each) are kept OFF the states pass — a screenshot
      // between every sample would halve the distinct visemes the timeline actually visits.
      async function sampleStates(framePath: string | null): Promise<void> {
        const t = (Date.now() - t0) / 1000;
        // Keep framing locked (runtime may tweak camera) and record every outcome.
        reframeOutcomes.push(await reframeCameraOnPatientFace(page));
        const sceneSample = await samplePatientVisemes(page);
        rawTimeline.push({ ...sceneSample, t });

        const peak = sceneSample.peak;
        liveSamples.push({
          t,
          targetName: peak?.targetName ?? "none",
          influence: peak?.influence ?? 0,
          meshName: peak?.meshName ?? "",
          framePath,
        });
        for (const r of sceneSample.readings) {
          if (r.influence < 0.5) continue;
          const prev = strongByName.get(r.targetName);
          if (!prev || r.influence > prev.influence) {
            strongByName.set(r.targetName, { t, influence: r.influence, framePath });
          }
        }
      }

      const distinctStrong = (): Set<string> =>
        new Set(
          liveSamples
            .filter((s) => s.influence >= 0.5 && s.targetName !== "none")
            .map((s) => s.targetName),
        );

      // Dense states pass across the full dialogue window (~110 ms steps, up to the 4.8 s cap).
      const SAMPLE_STEP_MS = 110;
      const SAMPLE_SPAN_MS = 4_400;
      async function denseStatesPass(): Promise<void> {
        for (let target = SAMPLE_STEP_MS; target <= SAMPLE_SPAN_MS; target += SAMPLE_STEP_MS) {
          const elapsed = Date.now() - t0;
          if (target > elapsed) {
            await page.waitForTimeout(target - elapsed);
          }
          await sampleStates(null);
        }
      }

      await denseStatesPass();
      // If one utterance's samples did not cover five distinct mouth shapes, replay the
      // dialogue and keep sampling (the retrigger restarts the phoneme timeline).
      if (distinctStrong().size < 5) {
        await retriggerPatientDialogue(page);
        await page.waitForTimeout(120);
        await denseStatesPass();
      }

      // Frame pass — sparse screenshots for the orchestrator's pixel grade, labelled with the
      // live dominant value sampled at the same instant.
      await retriggerPatientDialogue(page);
      await page.waitForTimeout(120);
      const FRAME_STEP_MS = 250;
      const FRAME_COUNT = 8;
      for (let i = 0; i < FRAME_COUNT; i += 1) {
        const target = i * FRAME_STEP_MS;
        const elapsed = Date.now() - t0;
        if (target > elapsed) {
          await page.waitForTimeout(target - elapsed);
        }
        const frameName = `viseme_frame_${String(i).padStart(2, "0")}.png`;
        const framePath = path.join(OUTPUT_DIR, frameName);
        await sampleStates(framePath);
        await page.screenshot({ path: framePath, fullPage: false });
      }

      // #368 remaining half: the artifact must record the reframe's OUTCOME — the mesh the
      // camera actually framed and its world position (or the failure code), never a
      // hardcoded description. The actor label is derived from the live scene, not restated.
      const firstReframe: ReframeOutcome = reframeOutcomes[0] ?? { status: "no-scene" };
      const reappliedFailures = [
        ...new Set(
          reframeOutcomes
            .slice(1)
            .filter((o) => o.status !== "ok")
            .map((o) => o.status),
        ),
      ];
      const drivenMeshNames = [
        ...new Set(liveSamples.map((s) => s.meshName).filter((n) => n !== "")),
      ];
      const actorLabel =
        firstReframe.status === "ok" && firstReframe.actorId
          ? `${firstReframe.actorId} — driven mesh: ${drivenMeshNames.length > 0 ? drivenMeshNames.join(", ") : "none observed"}`
          : `peds patient (actor id not stamped on the framed root) — driven mesh: ${drivenMeshNames.length > 0 ? drivenMeshNames.join(", ") : "none observed"}`;
      const reframeRecord = {
        status: firstReframe.status,
        targetMeshName: firstReframe.status === "ok" ? firstReframe.targetMeshName : null,
        targetWorldPosition:
          firstReframe.status === "ok" ? firstReframe.targetWorldPosition : null,
        framingDescription: reframeOutcomeSummary(firstReframe),
        reappliedCount: reframeOutcomes.length - 1,
        reappliedFailures,
      };

      const inspection = {
        schemaVersion: "openclinxr.ui-xr-viseme-drive-capture.v1",
        generatedAt: new Date().toISOString(),
        claimScope: "mouth_named_viseme_morph_drive_runtime_evidence",
        actor: actorLabel,
        url,
        framing: reframeRecord.framingDescription,
        reframe: reframeRecord,
        liveVisemeSamples: liveSamples.map((s) => ({
          t: Number(s.t.toFixed(3)),
          targetName: s.targetName,
          influence: Number(s.influence.toFixed(4)),
          meshName: s.meshName,
          framePath: s.framePath,
        })),
        strongVisemeTargets: [...strongByName.entries()].map(([targetName, v]) => ({
          targetName,
          t: Number(v.t.toFixed(3)),
          influence: Number(v.influence.toFixed(4)),
          framePath: v.framePath,
        })),
        distinctStrongVisemeCount: strongByName.size,
        distinctDominantStrongCount: distinctStrong().size,
        maxInfluence: Math.max(...liveSamples.map((s) => s.influence), 0),
        rawTimeline: rawTimeline.map((s) => ({
          t: Number(s.t.toFixed(3)),
          peak: s.peak,
          speech: s.speech,
          nonZeroVisemes: s.readings
            .filter((r) => r.influence > 0.01)
            .map((r) => ({
              targetName: r.targetName,
              influence: Number(r.influence.toFixed(4)),
              index: r.index,
              meshName: r.meshName,
            })),
        })),
        speechEvidence: await page.evaluate(
          `(() => (window.__openClinXrHumanoidSpeechEvidence || null))()`,
        ),
        morphCue: await page.evaluate(`(() => {
          const scene = window.__openClinXrDebugScene;
          let cue = null;
          if (scene && typeof scene.traverse === "function") {
            scene.traverse(function (o) {
              if (!cue && o.userData && (o.userData.openClinXrNamedVisemeDrive || o.userData.openClinXrMorphTargetRuntimeCue)) {
                cue = {
                  meshName: o.name || "",
                  named: o.userData.openClinXrNamedVisemeDrive || null,
                  morph: o.userData.openClinXrMorphTargetRuntimeCue || null
                };
              }
            });
          }
          return cue;
        })()`),
        framePaths: liveSamples.filter((s) => s.framePath !== null).map((s) => s.framePath as string),
        notEvidenceFor: [
          "anatomy_bind_pose",
          "school_age_mpfb2_comparator",
          "production_phoneme_timing",
          "validated_facial_animation",
          "clinical_affect_scoring",
          "quest_readiness",
          "b_plus_visual_realism_gate",
          "learner_readiness",
        ],
        verificationNotes: {
          liveSceneGraph:
            "influences read from mesh.morphTargetInfluences[dict[name]] via __openClinXrDebugScene (patient meshes)",
          gateNotReliedOn: "morphTargetAppliedTargetCount > 0 (satisfied by mouth-open alone)",
          required: "≥3 timestamps; ≥2 distinct viseme_* names at influence ≥ 0.5",
          framesAreSparse:
            "screenshots are ~500 ms each on this slow render loop, so frames are taken on a separate pass from the dense states; each frame is labelled with the dominant value at its instant",
        },
      };

      await writeFile(INSPECTION_PATH, `${JSON.stringify(inspection, null, 2)}\n`, "utf8");
      process.stdout.write(`${INSPECTION_PATH}\n`);
      process.stdout.write(
        `strongVisemes=${strongByName.size} nonSilence=${[...strongByName.keys()].filter((n) => !n.toLowerCase().includes("silence")).length} samples=${liveSamples.length}\n`,
      );

      if (liveSamples.length < 3) {
        throw new Error(`Need ≥3 live samples; got ${liveSamples.length}`);
      }
      if (strongByName.size < 2) {
        throw new Error(
          `Need ≥2 distinct viseme_* at influence ≥0.5; got ${strongByName.size}: ${[...strongByName.keys()].join(",")}`,
        );
      }
    } finally {
      await browser.close();
    }
  } finally {
    if (server) {
      try {
        server.proc.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void runVisemeCapture().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
