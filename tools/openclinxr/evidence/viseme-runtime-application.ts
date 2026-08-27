/**
 * #722 — live-run evidence that a BAKED Rhubarb viseme timeline reaches named morph targets.
 *
 * The six predecessors of this defect class all had a working code path; the contract therefore
 * reads a LIVE RUN. This runner boots the ui-xr app (portless) with `ed_stroke_alert_handoff_v1`,
 * waits for the patient humanoid, the auto-fired dialogue and the #722 join marker
 * (`userData.openClinXrBakedVisemeTimeline` — set only when the served cue file loaded), then
 * samples `mesh.morphTargetInfluences[mesh.morphTargetDictionary[name]]` on the live scene graph
 * across the utterance. The applied rows land in the TRACKED
 * `tools/openclinxr/evidence/viseme-runtime-application.json` (contract clause 1).
 *
 * claimScope: named viseme_* morph writes observed in a running ui-xr scene, driven from a baked
 *   cue file served by the app. notEvidenceFor: mouth appearance (orchestrator pixel grade),
 *   cue timing vs audio (Rhubarb owns), utterance-to-dialogue-turn identity beyond the content
 *   hash this slice's join defines, anatomy/bind-pose, clinical affect scoring.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { type PortlessDevServer, spawnPortlessDevServer, stopPortlessDevServer } from "./lib/portless-server.js";
import { withTreeStamp } from "./lib/measurement-tree-stamp.js";

import {
  ROOM_CAPTURE_MODE,
  buildRoomCaptureUrl,
} from "./ui-xr-environment-room-capture.js";

export const VISEME_RUNTIME_APPLICATION_PATH = path.join(
  "tools", "openclinxr", "evidence", "viseme-runtime-application.json",
);

export type AppliedVisemeRow = {
  viseme: string;
  morphTargetName: string;
  weight: number;
};

export type LiveSpeechProbe = {
  pageNowMs: number;
  activeViseme: string | null;
  activePhoneme: string | null;
  activeMouthOpenness: number | null;
};

export type VisemeRuntimeApplicationReport = {
  schemaVersion: "openclinxr.viseme-runtime-application.v1";
  scenarioId: string;
  utteranceText: string;
  baked: {
    utteranceId: string;
    cueCount: number;
    durationMs: number;
  } | null;
  samples: Array<{
    tMs: number;
    readings: AppliedVisemeRow[];
    speech: LiveSpeechProbe;
    namedDrive: {
      activeTargetName: string | null;
      influence: number;
      frameIndex: number;
      frameCount: number;
    } | null;
  }>;
  applied: AppliedVisemeRow[];
  distinctVisemes: number;
  distinctMorphTargets: number;
};

/** The baked ed_stroke openingUtterance, spoken on patient load (prefix stripped by the join). */
const STROKE_UTTERANCE =
  "Samuel Brooks: My right arm feels weak, and I cannot get the words out clearly.";

async function waitForBakedVisemeJoin(page: Page, timeoutMs: number): Promise<void> {
  // Poll on a TIMER, not rAF: headless rAF throttles to ~1 fps under WebGL load, so an rAF
  // poll would see the join marker up to a second after it appears — a third of the speech
  // window. The 50 ms interval sees it within a frame of the attach.
  await page.waitForFunction(
    `(() => {
      const scene = window.__openClinXrDebugScene;
      if (!scene || typeof scene.traverse !== "function") return false;
      let hasVisemeMesh = false;
      let hasBakedMarker = false;
      scene.traverse(function (o) {
        const dict = o.morphTargetDictionary;
        if (dict) {
          for (const k of Object.keys(dict)) {
            if (k.toLowerCase().indexOf("viseme_") === 0) { hasVisemeMesh = true; break; }
          }
        }
        const ud = o.userData;
        if (ud && ud.openClinXrBakedVisemeTimeline) hasBakedMarker = true;
      });
      return hasVisemeMesh && hasBakedMarker;
    })()`,
    undefined,
    { timeout: timeoutMs, polling: 50 },
  );
}

/**
 * String IIFE (not a TS arrow) so tsx/esbuild cannot inject `__name` into the browser.
 * Reads the live mesh morph influences by dictionary name — unfakeable against driver self-report.
 */
export async function readLiveVisemeApplication(page: Page): Promise<{
  scenarioId: string;
  baked: VisemeRuntimeApplicationReport["baked"];
  readings: AppliedVisemeRow[];
  speech: LiveSpeechProbe;
  namedDrive: {
    activeTargetName: string | null;
    influence: number;
    frameIndex: number;
    frameCount: number;
    weights: Record<string, number>;
    jawOpenRadians: number;
    availableTargets: string[];
  } | null;
}> {
  return page.evaluate(`(() => {
    const scene = window.__openClinXrDebugScene;
    const params = new URLSearchParams(window.location.search);
    let scenarioId = params.get("openclinxrScenarioId") || params.get("scenarioId") || "";
    let baked = null;
    let drivenRoot = null;
    let namedDrive = null;
    if (scene && typeof scene.traverse === "function") {
      scene.traverse(function (o) {
        if (scenarioId && o.userData && o.userData.openClinXrStationEnvironment &&
            typeof o.userData.openClinXrStationEnvironment.scenarioId === "string") {
          scenarioId = o.userData.openClinXrStationEnvironment.scenarioId || scenarioId;
        }
        // The root the #722 join attached to is the root the wire drives. Sampling any other
        // viseme-carrying mesh in the scene reads a neutral/rest actor (every humanoid ships
        // viseme_* targets and only the speaking root is driven).
        if (!baked && o.userData && o.userData.openClinXrBakedVisemeTimeline) {
          baked = o.userData.openClinXrBakedVisemeTimeline;
          drivenRoot = o;
        }
        if (!namedDrive && o.userData && o.userData.openClinXrNamedVisemeDrive) {
          namedDrive = o.userData.openClinXrNamedVisemeDrive;
        }
      });
    }
    const readings = [];
    const driveWeights = namedDrive && typeof namedDrive.weights === "object" && namedDrive.weights
      ? namedDrive.weights
      : null;
    if (drivenRoot && typeof drivenRoot.traverse === "function") {
      drivenRoot.traverse(function (o) {
        const dict = o.morphTargetDictionary;
        const influences = o.morphTargetInfluences;
        if (!dict || !influences) return;
        for (const targetName of Object.keys(dict)) {
          const lower = targetName.toLowerCase();
          // The wire's last drive wrote exactly the names in its weights map (driveTargets +
          // the resolved active target, which may be a MPFB FACS mouth unit via the alias pass).
          // openclinxr_* expression morphs are a different path — not this timeline — and are
          // excluded so the report stays the baked drive's evidence.
          if (lower.indexOf("openclinxr_") === 0) continue;
          if (driveWeights && !(targetName in driveWeights)) continue;
          const index = dict[targetName];
          if (typeof index !== "number" || index < 0 || index >= influences.length) continue;
          const weight = influences[index] || 0;
          if (weight <= 0.001) continue;
          readings.push({
            viseme: targetName.replace(/^viseme_/, ""),
            morphTargetName: targetName,
            weight: Number(weight.toFixed(4)),
          });
        }
      });
    }
    readings.sort(function (a, b) { return b.weight - a.weight; });
    const ev = window.__openClinXrHumanoidSpeechEvidence || null;
    return {
      scenarioId: scenarioId,
      baked: baked,
      readings: readings,
      namedDrive: namedDrive
        ? {
            activeTargetName: namedDrive.activeTargetName,
            influence: namedDrive.influence,
            frameIndex: namedDrive.frameIndex,
            frameCount: namedDrive.frameCount,
            weights: namedDrive.weights,
            jawOpenRadians: namedDrive.jawOpenRadians,
            availableTargets: Array.isArray(namedDrive.availableTargets) ? namedDrive.availableTargets.slice(0, 40) : [],
          }
        : null,
      speech: {
        pageNowMs: Math.round(performance.now()),
        activeViseme: ev ? (ev.activeViseme || null) : null,
        activePhoneme: ev ? (ev.activePhoneme || null) : null,
        activeMouthOpenness: ev && typeof ev.activeMouthOpenness === "number" ? ev.activeMouthOpenness : null,
      },
    };
  })()`) as Promise<{
    scenarioId: string;
    baked: VisemeRuntimeApplicationReport["baked"];
    readings: AppliedVisemeRow[];
    speech: LiveSpeechProbe;
    namedDrive: {
      activeTargetName: string | null;
      influence: number;
      frameIndex: number;
      frameCount: number;
      weights: Record<string, number>;
      jawOpenRadians: number;
      availableTargets: string[];
    } | null;
  }>;
}

async function waitForStationShellTimed(page: Page, timeoutMs: number): Promise<void> {
  // Same predicate as the shared waitForStationShell, but TIMER-polled: the shared helper polls
  // on rAF, which stalls to ~1 fps under WebGL load — a full second of the ~3.7 s speech window
  // per stalled frame. The 50 ms interval resolves within a frame of the shell appearing.
  await page.waitForFunction(
    `(() => {
      const scene = window.__openClinXrDebugScene;
      if (!scene || typeof scene.traverse !== "function") return false;
      if (scene.userData && scene.userData.openClinXrStationEnvironment &&
          scene.userData.openClinXrStationEnvironment.environmentId) return true;
      let found = false;
      scene.traverse(function (o) {
        if (o.name === "openclinxr.station-environment-shell") found = true;
      });
      return found;
    })()`,
    undefined,
    { timeout: timeoutMs, polling: 50 },
  );
}

export async function measureVisemeRuntimeApplication(input?: {
  baseUrl?: string;
  scenarioId?: string;
}): Promise<VisemeRuntimeApplicationReport> {
  const scenarioId = input?.scenarioId ?? "ed_stroke_alert_handoff_v1";

  let server: PortlessDevServer | undefined;
  let ownedServer = false;
  try {
    const baseUrl =
      input?.baseUrl
      ?? (await (async () => {
        ownedServer = true;
        server = await spawnPortlessDevServer({
          filter: "@openclinxr/ui-xr",
          readyTimeoutMs: 180_000,
        });
        return server.url;
      })());

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      try {
        const url = buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE);
        process.stdout.write(`viseme-runtime-application: goto ${scenarioId}\n`);
        await page.goto(url, { waitUntil: "load", timeout: 180_000 });
        await waitForStationShellTimed(page, 180_000);
        // #722 join: the patient's auto-fired dialogue loads the served cue file at load time
        // (the boot warm-up makes the attach a cache hit). The speech window is ~3.7 s and the
        // join wait is TIMER-polled (rAF stalls to ~1 fps under WebGL load), so sampling starts
        // within ~100 ms of the marker and covers most of the baked timeline.
        await waitForBakedVisemeJoin(page, 60_000);
        await page.waitForTimeout(60);

        let samples: VisemeRuntimeApplicationReport["samples"] = [];
        let applied: AppliedVisemeRow[] = [];
        for (let attempt = 0; attempt < 3; attempt += 1) {
          samples = [];
          applied = [];
          const appliedByKey = new Map<string, AppliedVisemeRow>();
          const SAMPLE_STEP_MS = 120;
          const SAMPLE_COUNT = 30;
          for (let i = 0; i < SAMPLE_COUNT; i += 1) {
            const tMs = i * SAMPLE_STEP_MS;
            if (tMs > 0) await page.waitForTimeout(SAMPLE_STEP_MS);
            const live = await readLiveVisemeApplication(page);
            for (const row of live.readings) {
              const key = `${row.viseme}|${row.morphTargetName}`;
              const prev = appliedByKey.get(key);
              if (!prev || row.weight > prev.weight) appliedByKey.set(key, row);
            }
            samples.push({
              tMs,
              readings: live.readings,
              speech: live.speech,
              namedDrive: live.namedDrive
                ? {
                    activeTargetName: live.namedDrive.activeTargetName,
                    influence: live.namedDrive.influence,
                    frameIndex: live.namedDrive.frameIndex,
                    frameCount: live.namedDrive.frameCount,
                  }
                : null,
            });
            process.stdout.write(
              `  t=${String(tMs).padStart(4)}ms ${live.readings.map((r) => `${r.viseme}:${r.weight}`).join(", ") || "no viseme_* write"} `
                + `drive=${live.namedDrive ? `${live.namedDrive.activeTargetName ?? "none"}#${live.namedDrive.frameIndex}/${live.namedDrive.frameCount}` : "-"} `
                + `avail=${(live.namedDrive?.availableTargets ?? []).length} `
                + `speech=${live.speech.activeViseme ?? "-"}/${live.speech.activePhoneme ?? "-"}\n`,
            );
          }
          applied = [...appliedByKey.values()].sort((a, b) => a.viseme.localeCompare(b.viseme));
          const distinctVisemes = new Set(applied.map((r) => r.viseme)).size;
          const distinctTargets = new Set(applied.map((r) => r.morphTargetName)).size;
          if (distinctVisemes >= 2 && distinctTargets >= 2) break;
          if (attempt < 2) {
            process.stdout.write(
              `viseme-runtime-application: attempt ${attempt + 1} saw ${distinctVisemes} visemes / `
                + `${distinctTargets} targets — re-booting to re-catch the speech window\n`,
            );
            await page.goto(url, { waitUntil: "load", timeout: 180_000 });
            await waitForStationShellTimed(page, 180_000);
            await waitForBakedVisemeJoin(page, 60_000);
            await page.waitForTimeout(60);
          }
        }

        // Bake marker read at the end (it lives on the live scene graph userData, not per-sample).
        const finalLive = await readLiveVisemeApplication(page);
        const report: VisemeRuntimeApplicationReport = {
          schemaVersion: "openclinxr.viseme-runtime-application.v1",
          scenarioId,
          utteranceText: STROKE_UTTERANCE,
          baked: finalLive.baked,
          samples,
          applied,
          distinctVisemes: new Set(applied.map((r) => r.viseme)).size,
          distinctMorphTargets: new Set(applied.map((r) => r.morphTargetName)).size,
        };
        return report;
      } finally {
        await page.close().catch(() => undefined);
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
  } finally {
    if (ownedServer && server) {
      try {
        await stopPortlessDevServer(server.proc);
      } catch {
        // ignore
      }
    }
  }
}

export async function writeVisemeRuntimeApplication(report: VisemeRuntimeApplicationReport): Promise<string> {
  await mkdir(path.dirname(VISEME_RUNTIME_APPLICATION_PATH), { recursive: true });
  const payload = withTreeStamp({
    ...report,
    claimScope: [
      "named_viseme_morph_writes_in_a_running_ui_xr_scene",
      "driven_from_a_served_baked_cue_file",
      "live_scene_graph_morph_influence_readback",
    ],
    notEvidenceFor: [
      "mouth_appearance_which_only_a_pixel_grade_can_say",
      "cue_timing_vs_audio_rhubarb_owns",
      "utterance_to_dialogue_turn_identity_beyond_the_content_hash_join",
      "anatomy_bind_pose",
      "clinical_affect_scoring",
      "quest_readiness",
    ],
  });
  await writeFile(VISEME_RUNTIME_APPLICATION_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`viseme-runtime-application: wrote ${VISEME_RUNTIME_APPLICATION_PATH}\n`);
  return VISEME_RUNTIME_APPLICATION_PATH;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let scenarioId: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--scenario" && args[i + 1]) scenarioId = args[++i]!;
  }
  const report = await measureVisemeRuntimeApplication({ scenarioId });
  await writeVisemeRuntimeApplication(report);
  process.stdout.write(
    `viseme-runtime-application: scenario=${report.scenarioId} applied=${report.applied.length} `
      + `distinctVisemes=${report.distinctVisemes} distinctTargets=${report.distinctMorphTargets}\n`,
  );
}

const isDirectRun =
  typeof process.argv[1] === "string"
  && (process.argv[1].endsWith("viseme-runtime-application.ts")
    || process.argv[1].endsWith("viseme-runtime-application.js"));

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
