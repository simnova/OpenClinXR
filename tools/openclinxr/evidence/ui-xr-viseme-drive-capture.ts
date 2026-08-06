/**
 * #63 viseme vertical capture — live mesh morph samples + head-and-shoulders frames.
 *
 * Reads mesh.morphTargetInfluences[mesh.morphTargetDictionary[name]] via page.evaluate
 * on window.__openClinXrDebugScene (patient mesh only). Driver self-report is not evidence.
 *
 * Actor: default generated peds_patient_child.glb (has viseme_* shape keys with real POSITION
 * deltas on L/TH/FV/OU; AA/E are sub-cm — still driven, but frames prefer L/TH for visibility).
 * School-age mpfb2 comparator GLB missing in this worktree.
 *
 * claimScope: mouth. notEvidenceFor: anatomy bind-pose, production phoneme timing, Quest.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { spawnPortlessDevServer, type PortlessDevServer } from "./lib/portless-server.js";

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
  return page.evaluate(() => {
    const scene = (window as unknown as {
      __openClinXrDebugScene?: {
        traverse: (cb: (o: {
          name?: string;
          morphTargetDictionary?: Record<string, number>;
          morphTargetInfluences?: number[];
        }) => void) => void;
      };
    }).__openClinXrDebugScene;

    const readings: Reading[] = [];
    if (scene?.traverse) {
      scene.traverse((object) => {
        const meshName = object.name ?? "";
        const dict = object.morphTargetDictionary;
        const influences = object.morphTargetInfluences;
        if (!dict || !influences) return;
        if (!("viseme_AA" in dict) && !("viseme_L" in dict)) return;
        for (const [targetName, index] of Object.entries(dict)) {
          if (!targetName.toLowerCase().startsWith("viseme_")) continue;
          if (typeof index !== "number" || index < 0 || index >= influences.length) continue;
          readings.push({
            meshName,
            targetName,
            influence: influences[index] ?? 0,
            index,
          });
        }
      });
    }

    // Prefer non-silence peaks so idle silence does not hide active speech morphs.
    const ranked = [...readings].sort((a, b) => {
      const aSilence = a.targetName.toLowerCase().includes("silence") ? 0 : 1;
      const bSilence = b.targetName.toLowerCase().includes("silence") ? 0 : 1;
      if (aSilence !== bSilence) return bSilence - aSilence;
      return b.influence - a.influence;
    });
    const peak = ranked[0]
      ? { targetName: ranked[0].targetName, influence: ranked[0].influence, meshName: ranked[0].meshName }
      : null;

    const speech = (window as unknown as {
      __openClinXrHumanoidSpeechEvidence?: {
        activeViseme?: string;
        activePhoneme?: string;
        activeMouthOpenness?: number;
      };
    }).__openClinXrHumanoidSpeechEvidence;

    return {
      t: 0,
      readings,
      peak,
      speech: speech
        ? {
            activeViseme: speech.activeViseme,
            activePhoneme: speech.activePhoneme,
            activeMouthOpenness: speech.activeMouthOpenness,
          }
        : null,
    };
  });
}

async function reframeCameraOnPatientFace(page: Page): Promise<string> {
  return page.evaluate(() => {
    const scene = (window as unknown as {
      __openClinXrDebugScene?: {
        traverse: (cb: (o: Record<string, unknown>) => void) => void;
      };
    }).__openClinXrDebugScene;
    if (!scene?.traverse) return "no-scene";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let camera: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let patientMesh: any = null;
    scene.traverse((object) => {
      const o = object as {
        isPerspectiveCamera?: boolean;
        type?: string;
        name?: string;
        morphTargetDictionary?: Record<string, number>;
        matrixWorld?: { elements?: ArrayLike<number> };
        updateWorldMatrix?: (u: boolean, d: boolean) => void;
      };
      if (o.isPerspectiveCamera || o.type === "PerspectiveCamera") camera = o;
      const name = o.name ?? "";
      if (
        o.morphTargetDictionary &&
        ("viseme_L" in o.morphTargetDictionary || "viseme_AA" in o.morphTargetDictionary) &&
        /peds_patient|patient_child/i.test(name)
      ) {
        patientMesh = o;
      }
    });
    if (!camera?.position?.set) return "no-camera";
    if (!patientMesh) return "no-patient-mesh";

    patientMesh.updateWorldMatrix?.(true, false);
    camera.parent?.updateWorldMatrix?.(true, false);
    const e = patientMesh.matrixWorld?.elements;
    // matrixWorld translation = elements[12,13,14]
    const px = e ? Number(e[12]) : 0;
    const py = e ? Number(e[13]) : 1.0;
    const pz = e ? Number(e[14]) : 0;
    // Head sits above mesh origin on these Anny exports; pull in for mouth-legible framing.
    const headY = py + 1.12;
    // Camera is parented under locomotionRig — convert world aim to parent-local.
    const worldCam = {
      x: px + 0.04,
      y: headY + 0.04,
      z: pz + 0.72,
    };
    if (camera.parent?.worldToLocal && camera.position?.clone) {
      const local = camera.position.clone();
      local.set(worldCam.x, worldCam.y, worldCam.z);
      camera.parent.worldToLocal(local);
      camera.position.copy(local);
    } else {
      camera.position.set(worldCam.x, worldCam.y, worldCam.z);
    }
    // lookAt expects world coordinates
    camera.lookAt(px, headY - 0.04, pz);
    camera.fov = 28;
    camera.updateProjectionMatrix?.();
    return `patient@${px.toFixed(2)},${py.toFixed(2)},${pz.toFixed(2)} headY=${headY.toFixed(2)} camLocal=${camera.position.x?.toFixed?.(2)},${camera.position.y?.toFixed?.(2)},${camera.position.z?.toFixed?.(2)}`;
  });
}

async function retriggerPatientDialogue(page: Page): Promise<void> {
  // Click the work-of-breathing trace to restart speech if the first utterance already ended.
  const button = page.getByRole("button", { name: /Work Of Breathing/i });
  if (await button.count()) {
    await button.first().click({ timeout: 5_000 }).catch(() => undefined);
  }
}

async function main(): Promise<void> {
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

      await page.waitForFunction(
        () => {
          const scene = (window as unknown as {
            __openClinXrDebugScene?: {
              traverse?: (cb: (o: { morphTargetDictionary?: Record<string, number> }) => void) => void;
            };
          }).__openClinXrDebugScene;
          if (!scene?.traverse) return false;
          let hasViseme = false;
          scene.traverse((object) => {
            const dict = object.morphTargetDictionary;
            if (!dict) return;
            for (const name of Object.keys(dict)) {
              if (name.toLowerCase().startsWith("viseme_")) hasViseme = true;
            }
          });
          return hasViseme;
        },
        { timeout: 180_000 },
      );

      const frameNote = await reframeCameraOnPatientFace(page);
      process.stdout.write(`camera: ${frameNote}\n`);
      await page.waitForTimeout(600);
      await retriggerPatientDialogue(page);
      await page.waitForTimeout(350);

      // Dense samples across a full dialogue window (~2.5–4s).
      const sampleTimesMs = [150, 450, 800, 1200, 1600, 2000, 2500, 3000];
      const liveSamples: Array<{
        t: number;
        targetName: string;
        influence: number;
        meshName: string;
        framePath: string;
      }> = [];
      const rawTimeline: SceneSample[] = [];
      const t0 = Date.now();
      const strongByName = new Map<string, { t: number; influence: number; framePath: string }>();

      for (let i = 0; i < sampleTimesMs.length; i += 1) {
        const targetDelay = sampleTimesMs[i]!;
        const elapsed = Date.now() - t0;
        if (targetDelay > elapsed) {
          await page.waitForTimeout(targetDelay - elapsed);
        }

        // Keep framing locked (runtime may tweak camera).
        await reframeCameraOnPatientFace(page);

        const sceneSample = await samplePatientVisemes(page);
        const t = (Date.now() - t0) / 1000;
        const frameName = `viseme_frame_${String(i).padStart(2, "0")}.png`;
        const framePath = path.join(OUTPUT_DIR, frameName);
        await page.screenshot({ path: framePath, fullPage: false });

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

      // If we still lack two strong non-silence visemes, force a second dialogue pass and sample.
      const nonSilenceStrong = [...strongByName.keys()].filter((n) => !n.toLowerCase().includes("silence"));
      if (nonSilenceStrong.length < 2) {
        await retriggerPatientDialogue(page);
        await page.waitForTimeout(200);
        for (let i = 0; i < 6; i += 1) {
          await page.waitForTimeout(350);
          await reframeCameraOnPatientFace(page);
          const sceneSample = await samplePatientVisemes(page);
          const t = (Date.now() - t0) / 1000;
          const frameName = `viseme_frame_extra_${String(i).padStart(2, "0")}.png`;
          const framePath = path.join(OUTPUT_DIR, frameName);
          await page.screenshot({ path: framePath, fullPage: false });
          rawTimeline.push({ ...sceneSample, t });
          if (sceneSample.peak) {
            liveSamples.push({
              t,
              targetName: sceneSample.peak.targetName,
              influence: sceneSample.peak.influence,
              meshName: sceneSample.peak.meshName,
              framePath,
            });
          }
          for (const r of sceneSample.readings) {
            if (r.influence < 0.5) continue;
            const prev = strongByName.get(r.targetName);
            if (!prev || r.influence > prev.influence) {
              strongByName.set(r.targetName, { t, influence: r.influence, framePath });
            }
          }
        }
      }

      const inspection = {
        schemaVersion: "openclinxr.ui-xr-viseme-drive-capture.v1",
        generatedAt: new Date().toISOString(),
        claimScope: "mouth_named_viseme_morph_drive_runtime_evidence",
        actor:
          "peds_patient_child.glb (default generated humanoid; school-age comparator GLB missing — chose sound morph set)",
        url,
        framing: "in-page head-and-shoulders reframe on patient face (fov=32, z≈1.15)",
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
          () =>
            (window as unknown as { __openClinXrHumanoidSpeechEvidence?: unknown })
              .__openClinXrHumanoidSpeechEvidence ?? null,
        ),
        morphCue: await page.evaluate(() => {
          const scene = (window as unknown as {
            __openClinXrDebugScene?: {
              traverse: (cb: (o: { userData?: Record<string, unknown>; name?: string }) => void) => void;
            };
          }).__openClinXrDebugScene;
          let cue: unknown = null;
          scene?.traverse((o) => {
            if (o.userData?.openClinXrNamedVisemeDrive || o.userData?.openClinXrMorphTargetRuntimeCue) {
              cue = {
                meshName: o.name ?? "",
                named: o.userData.openClinXrNamedVisemeDrive ?? null,
                morph: o.userData.openClinXrMorphTargetRuntimeCue ?? null,
              };
            }
          });
          return cue;
        }),
        framePaths: liveSamples.map((s) => s.framePath),
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
          morphDeltaNote:
            "peds_patient_child.glb: viseme_AA/E max|d|≈0.006 (subtle); viseme_L≈0.26, viseme_TH≈2.0 (legible close-up)",
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
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
