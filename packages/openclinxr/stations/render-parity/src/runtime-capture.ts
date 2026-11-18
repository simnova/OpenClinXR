/**
 * Aisha-parity runtime capture (lane aisha-parity, P2): renders the SAME
 * shipped Aisha GLB in the isolated-subject lab at the P1a cameras' native
 * resolutions, with the parity levers from a preset JSON.
 *
 * Usage (one preset per invocation, run through the heavy slot):
 *   tsx tools/openclinxr/evidence/aisha-parity/runtime-capture.ts \
 *     --cameras <p1a cameras.json> --out <E dir> --levers baseline
 *   --levers accepts a preset name (presets/<name>.json), a path, or inline JSON.
 *   --masks renders flat P1a-table ID colours into <out>/masks/ (registration).
 *   --normal-pass renders world-normal geometry probes (RGB=N*0.5+0.5,
 *     lighting bypassed) into <out>/<preset>-normal/<cam>.normal.png plus
 *     per-mesh morph/bone state in state.json (G-probe, three side).
 *   --calib renders the P1a chrome/grey spheres (head_front camera) into <out>/calib/.
 *   --calib-sweep <path> sweeps HDRI rotationYDeg (then exposure) for calib mode.
 *   --nohair adds hideHair:true (brows/lashes stay; lab enforces) to beauty specs.
 *   --eye-shading forwards eyeRuntimeShading:true (P2d probe; the lab refuses
 *     it in parity/HDRI mode — the refusal is the verdict, recorded in E).
 *   --only <cam,cam> limits cameras (e.g. head_front,head_34 for nohair).
 *
 * Output per preset dir <out>/<preset>/ (or <out>/<preset>-nohair/):
 *   <cam>.png + evidence.json (camera matrices, renderer settings, every
 *   lever readback live from the scene, wall ms, GPU string, 60-frame ms).
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "./slotted-playwright.js";
import { createLocalComputeServices } from "@openclinxr/service-local-compute/local";
import { spawnPortlessDevServer, stopPortlessDevServer } from "./portless-server.js";
import type { CameraRec, CaptureCli } from "./capture-args.js";
import { loadCameras, parseCaptureArgs, resolveLevers } from "./capture-args.js";
import { HDRI_URL, buildSpec, calibSpheres, subjectUrl } from "./capture-spec.js";
import {
  MATERIAL_DUMP_JS,
  WORLD_NORMAL_PROBE_JS,
  decodePngFloat,
  hideEvalJs,
  meanAbsDiffFloat,
  measureFrameMs,
  readGpuString,
  waitForParityEvidence,
} from "./capture-probes.js";

/** Local sha256 (was ../skin-realism/runtime-portrait-capture.js; 3-line helper, inlined so the station builds standalone). */
function sha256File(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

async function captureCamera(opts: {
  page: Page;
  baseUrl: string;
  cam: CameraRec;
  spec: Record<string, unknown>;
  pngPath: string;
}): Promise<{ evidence: Record<string, unknown>; frameMs: { medianMs: number; p95Ms: number; samples: number } }> {
  const [w, h] = opts.cam.resolution;
  await opts.page.setViewportSize({ width: w, height: h });
  await opts.page.goto(subjectUrl(opts.baseUrl, opts.spec), { waitUntil: "domcontentloaded", timeout: 120_000 });
  const evidence = await waitForParityEvidence(opts.page);
  await mkdir(path.dirname(opts.pngPath), { recursive: true });
  const canvas = opts.page.locator("#isolated-subject-capture-canvas");
  if ((await canvas.count()) === 0) throw new Error(`capture canvas missing for ${opts.cam.name} — refusing`);
  await canvas.screenshot({ path: opts.pngPath });
  const dims = decodePngFloat(opts.pngPath);
  if (dims.w !== w || dims.h !== h) {
    throw new Error(
      `capture ${opts.cam.name} is ${dims.w}x${dims.h}, camera wants ${w}x${h} — refusing (registration needs exact pixels)`,
    );
  }
  const frameMs = await measureFrameMs(opts.page, 60);
  return { evidence, frameMs };
}

/** Run one parity capture from parsed CLI opts: beauty/calib/masks/normal-pass/dump-state capture into the out dir. */
export async function runRuntimeCapture(opts: CaptureCli): Promise<void> {
  const cli = opts;
  const outAbs = cli.out ? path.resolve(cli.cwd, cli.out) : null;
  const camerasJson = await readFile(path.resolve(cli.cwd, cli.cameras), "utf8");
  const cameras = loadCameras(camerasJson).filter((c) => cli.only.length === 0 || cli.only.includes(c.name));
  if (cameras.length === 0) throw new Error("--only matched no cameras — refusing");
  const headFront = loadCameras(camerasJson).find((c) => c.name === "head_front");
  if (!headFront) throw new Error("head_front camera missing from cameras.json — refusing");

  let server: Awaited<ReturnType<typeof spawnPortlessDevServer>> | null = null;
  try {
    server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", cwd: cli.cwd, readyTimeoutMs: 180_000 });
    const hdriRes = await fetch(new URL(HDRI_URL, server.url));
    const hdriBytes = Number(hdriRes.headers.get("content-length") ?? "0");
    if (!hdriRes.ok || hdriBytes < 1_000_000) {
      throw new Error(`HDRI unreachable at ${HDRI_URL} (status ${hdriRes.status}, ${hdriBytes} bytes) — refusing`);
    }
    await hdriRes.arrayBuffer();
    const serverUrl = server.url;
    const primaryLaunch = chromium.launch.bind(chromium, { headless: true, channel: "chromium", args: ["--use-angle=metal"] });
    const fallbackLaunch = chromium.launch.bind(chromium, { headless: true, args: ["--use-angle=metal"] });
    let gpuLaunch = "";
    const resilientLaunch = async (): Promise<Awaited<ReturnType<typeof chromium.launch>>> => {
      try {
        const primary = await primaryLaunch();
        gpuLaunch = "channel:chromium --use-angle=metal";
        return primary;
      } catch {
        const fallback = await fallbackLaunch();
        gpuLaunch = "fallback default-chromium --use-angle=metal";
        return fallback;
      }
    };
    await createLocalComputeServices({ browserLaunch: resilientLaunch }).sceneCapture.withBrowser("aisha-parity:runtime-capture", async (launched) => {
      const browser = launched as Awaited<ReturnType<typeof chromium.launch>>;
      const page = await browser.newPage({ viewport: { width: 1536, height: 1536 }, deviceScaleFactor: 1 });
    const gpu = await readGpuString(page);

    if (cli.calibSweep) {
      const sweepTrials: Array<{ rotationYDeg: number; exposure: number; meanAbsDiff: number; png: string }> = [];
      const sweepPath = path.resolve(cli.calibSweep);
      const p1aCalib = path.join(
        path.dirname(path.resolve(cli.cwd, cli.cameras)),
        "calib",
        "spheres.png",
      );
      const flushSweep = async (): Promise<void> => {
        const ranked = [...sweepTrials].sort((a, b) => a.meanAbsDiff - b.meanAbsDiff);
        await mkdir(path.dirname(sweepPath), { recursive: true });
        await writeFile(
          sweepPath,
          `${JSON.stringify(
            {
              p1aCalib,
              headFrontCamera: headFront.name,
              spheres: calibSpheres(headFront),
              trials: sweepTrials,
              chosen: ranked.length > 0
                ? {
                    rotationYDeg: ranked[0]!.rotationYDeg,
                    exposure: ranked[0]!.exposure,
                    meanAbsDiff: ranked[0]!.meanAbsDiff,
                  }
                : null,
              gpu,
              gpuLaunch,
            },
            null,
            2,
          )}\n`,
        );
      };
      const rotations = [...cli.rotations];
      const runCalib = async (rotationYDeg: number, exposure: number, tag: string): Promise<number> => {
        const pngPath = path.join(path.dirname(sweepPath), `sweep-${tag}.png`);
        try {
          const existing = decodePngFloat(pngPath);
          if (existing.w === headFront.resolution[0] && existing.h === headFront.resolution[1]) {
            const diff = meanAbsDiffFloat(pngPath, p1aCalib);
            console.log(`[sweep] reuse ${tag}: meanAbsDiff=${diff.toFixed(5)}`);
            sweepTrials.push({ rotationYDeg, exposure, meanAbsDiff: diff, png: pngPath });
            return diff;
          }
        } catch {
          // No usable prior capture — render it.
        }
        console.log(`[sweep] capture ${tag} (rot=${rotationYDeg} exp=${exposure}) ...`);
        const spec = buildSpec(headFront, {
          levers: { rotationYDeg, exposure },
          masks: false,
          calibSpheres: calibSpheres(headFront),
          nohair: false,
        });
        await captureCamera({ page, baseUrl: server!.url, cam: headFront, spec, pngPath });
        const diff = meanAbsDiffFloat(pngPath, p1aCalib);
        console.log(`[sweep] done ${tag}: meanAbsDiff=${diff.toFixed(5)}`);
        sweepTrials.push({ rotationYDeg, exposure, meanAbsDiff: diff, png: pngPath });
        await flushSweep();
        return diff;
      };
      for (const r of rotations) {
        await runCalib(r, 1, `rot${r}`);
      }
      let best = sweepTrials.reduce((a, b) => (a.meanAbsDiff <= b.meanAbsDiff ? a : b));
      const step = cli.refine;
      for (let r = best.rotationYDeg - cli.window; r <= best.rotationYDeg + cli.window; r += step) {
        const norm = ((Math.round(r) % 360) + 360) % 360;
        if (rotations.includes(norm)) continue;
        await runCalib(norm, 1, `rot${norm}`);
      }
      best = sweepTrials.filter((t) => t.exposure === 1).reduce((a, b) => (a.meanAbsDiff <= b.meanAbsDiff ? a : b));
      const exposures = cli.exposures.length > 0 ? cli.exposures : [best ? 1 : 1];
      if (cli.exposures.length > 0) {
        for (const e of cli.exposures) {
          await runCalib(best.rotationYDeg, e, `rot${best.rotationYDeg}-exp${e}`);
        }
        best = sweepTrials.reduce((a, b) => (a.meanAbsDiff <= b.meanAbsDiff ? a : b));
      }
      const sweepOut = {
        p1aCalib,
        headFrontCamera: headFront.name,
        spheres: calibSpheres(headFront),
        trials: sweepTrials,
        chosen: { rotationYDeg: best.rotationYDeg, exposure: best.exposure, meanAbsDiff: best.meanAbsDiff },
        gpu,
        gpuLaunch,
        partial: false,
      };
      await mkdir(path.dirname(sweepPath), { recursive: true });
      await writeFile(sweepPath, `${JSON.stringify(sweepOut, null, 2)}\n`);
      return;
    }

    if (cli.masks) {
      const dir = path.join(outAbs!, "masks");
      const perCam: Record<string, unknown> = {};
      for (const cam of cameras) {
        const spec = buildSpec(cam, { levers: {}, masks: true, calibSpheres: null, nohair: cli.nohair });
        const pngPath = path.join(dir, `${cam.name}.png`);
        const { evidence, frameMs } = await captureCamera({ page, baseUrl: serverUrl, cam, spec, pngPath });
        perCam[cam.name] = { png: pngPath, evidence, frameMs, sha256: sha256File(pngPath) };
      }
      await writeFile(
        path.join(dir, "evidence.json"),
        `${JSON.stringify({ mode: "masks", gpu, gpuLaunch, cameras: perCam }, null, 2)}\n`,
      );
      return;
    }

    if (cli.calib && outAbs) {
      const { name: presetName, levers } = await resolveLevers(cli.levers);
      const dir = path.join(outAbs, presetName);
      const spec = buildSpec(headFront, {
        levers,
        masks: false,
        calibSpheres: calibSpheres(headFront),
        nohair: cli.nohair,
      });
      const pngPath = path.join(dir, "spheres.png");
      const { evidence, frameMs } = await captureCamera({ page, baseUrl: serverUrl, cam: headFront, spec, pngPath });
      await writeFile(
        path.join(dir, "evidence.json"),
        `${JSON.stringify({ mode: "calib", preset: presetName, levers, gpu, gpuLaunch, evidence, frameMs, sha256: sha256File(pngPath) }, null, 2)}\n`,
      );
      return;
    }

    if (cli.dumpState && outAbs) {
      const { name: presetName, levers } = await resolveLevers(cli.levers);
      const dir = path.join(outAbs, cli.nohair ? `${presetName}-nohair-dump` : `${presetName}-dump`);
      const perCam: Record<string, unknown> = {};
      for (const cam of cameras) {
        const spec = buildSpec(cam, { levers, masks: false, calibSpheres: null, nohair: cli.nohair, eyeShading: cli.eyeShading });
        const [w, h] = cam.resolution;
        await page.setViewportSize({ width: w, height: h });
        await page.goto(subjectUrl(serverUrl, spec), { waitUntil: "domcontentloaded", timeout: 120_000 });
        const evidence = await waitForParityEvidence(page);
        const dump = (await page.evaluate(MATERIAL_DUMP_JS)) as Record<string, unknown>;
        perCam[cam.name] = { dump, evidence };
        console.log(`[dump] done ${cam.name}: meshes=${(dump["meshes"] as unknown[]).length}`);
      }
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "dump.json"), `${JSON.stringify({ mode: "dump-state", preset: presetName, levers, cameras: perCam }, null, 2)}\n`);
      return;
    }

    if (cli.normalPass && outAbs) {
      const { name: presetName, levers } = await resolveLevers(cli.levers);
      const dir = path.join(outAbs, cli.nohair ? `${presetName}-nohair-normal` : `${presetName}-normal`);
      const perCam: Record<string, unknown> = {};
      const consoleErrors: string[] = [];
      page.on("console", (msg) => {
        try {
          if (msg.type() === "error" || msg.type() === "warning") {
            consoleErrors.push(`[${msg.type()}] ${msg.text()}`.slice(0, 500));
          }
        } catch {
          // ignore listener faults
        }
      });
      page.on("pageerror", (e) => {
        consoleErrors.push(`[pageerror] ${String(e && (e as Error).message ? (e as Error).message : e)}`.slice(0, 500));
      });
      for (const cam of cameras) {
        const spec = buildSpec(cam, { levers, masks: false, calibSpheres: null, nohair: cli.nohair, eyeShading: cli.eyeShading });
        const [w, h] = cam.resolution;
        await page.setViewportSize({ width: w, height: h });
        await page.goto(subjectUrl(serverUrl, spec), { waitUntil: "domcontentloaded", timeout: 120_000 });
        const evidence = await waitForParityEvidence(page);
        const state = (await page.evaluate(WORLD_NORMAL_PROBE_JS)) as Record<string, unknown>;
        const pngPath = path.join(dir, `${cam.name}.normal.png`);
        await mkdir(path.dirname(pngPath), { recursive: true });
        const canvas = page.locator("#isolated-subject-capture-canvas");
        if ((await canvas.count()) === 0) throw new Error(`capture canvas missing for ${cam.name} — refusing`);
        await canvas.screenshot({ path: pngPath });
        const dims = decodePngFloat(pngPath);
        if (dims.w !== w || dims.h !== h) {
          throw new Error(
            `normal capture ${cam.name} is ${dims.w}x${dims.h}, camera wants ${w}x${h} — refusing`,
          );
        }
        perCam[cam.name] = { png: pngPath, state, evidence, sha256: sha256File(pngPath), consoleErrors };
        console.log(`[normal] done ${cam.name}: meshes=${(state["meshes"] as unknown[]).length}`);
        if (cam.name === "body_front") {
          await page.evaluate(hideEvalJs("toigo_t_shirt", true));
          const noShirtPath = path.join(dir, `${cam.name}.noshirt.normal.png`);
          await canvas.screenshot({ path: noShirtPath });
          await page.evaluate(hideEvalJs("toigo_t_shirt", false));
          await page.evaluate(hideEvalJs("mpfb_ob_patient_aisha_v1_body", true));
          const noBodyPath = path.join(dir, `${cam.name}.nobody.normal.png`);
          await canvas.screenshot({ path: noBodyPath });
          await page.evaluate(hideEvalJs("mpfb_ob_patient_aisha_v1_body", false));
          perCam[cam.name] = { ...(perCam[cam.name] as Record<string, unknown>), noShirtPng: noShirtPath, noBodyPng: noBodyPath };
        }
      }
      await writeFile(path.join(dir, "state.json"), `${JSON.stringify({ mode: "normal-pass", preset: presetName, levers, cameras: perCam }, null, 2)}\n`);
      return;
    }

    const { name: presetName, levers } = await resolveLevers(cli.levers);
    const dir = path.join(outAbs!, cli.nohair ? `${presetName}-nohair` : presetName);
    const perCam: Record<string, unknown> = {};
    for (const cam of cameras) {
      const spec = buildSpec(cam, { levers, masks: false, calibSpheres: null, nohair: cli.nohair, eyeShading: cli.eyeShading });
      const pngPath = path.join(dir, `${cam.name}.png`);
      console.log(`[capture] ${presetName}${cli.nohair ? "-nohair" : ""} ${cam.name} ...`);
      const { evidence, frameMs } = await captureCamera({ page, baseUrl: serverUrl, cam, spec, pngPath });
      console.log(`[capture] done ${cam.name}: medianMs=${frameMs.medianMs.toFixed(2)} p95Ms=${frameMs.p95Ms.toFixed(2)}`);
      perCam[cam.name] = { png: pngPath, evidence, frameMs, sha256: sha256File(pngPath) };
    }
    await writeFile(
      path.join(dir, "evidence.json"),
      `${JSON.stringify(
        {
          mode: "beauty",
          preset: presetName,
          nohair: cli.nohair,
          levers,
          hdriUrl: HDRI_URL,
          gpu,
          gpuLaunch,
          captureCommand: `runtime_capture.ts --cameras ${cli.cameras} --out ${cli.out} --levers ${cli.levers}${cli.nohair ? " --nohair" : ""}`,
          cameras: perCam,
        },
        null,
        2,
      )}\n`,
    );
    });
  } finally {
    if (server) await stopPortlessDevServer(server.proc).catch(() => {});
  }
}

const invoked = process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  // lane manager 2026-11-18: the dev-server pipes kept node alive 33 min after the calib sweep finished; exit explicitly.
  await runRuntimeCapture(parseCaptureArgs(process.argv.slice(2))).then(() => process.exit(0), (e: unknown) => { console.error(e); process.exit(1); });
}
