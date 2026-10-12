/**
 * Arm-settle measurement: per-frame arm joint rotations across the walk -> arrival/idle
 * switch on the scene-closure physician, in the browser under the fake clock.
 *
 * Samples every 1/30 s simulated frame from first walking frame until arrived + 2 s
 * stopped: phase/stoppedSeconds from `__openClinXrBedsideApproachEvidence` plus an arm
 * probe off `__openClinXrDebugScene` (local quats of shoulder/upperarm/lowerarm/wrist
 * bones, world positions of shoulder/elbow/wrist/pelvis/neck, locomotion ownership
 * chains). Offline analysis in this file derives per-frame rotation rates, the walk
 * clip's own max arm rate, the switch-frame spike, and the hold upper-arm-from-trunk
 * angle. Output: `.openclinxr/evidence/arm-settle/<name>.json`.
 *
 * Usage: pnpm tsx tools/openclinxr/evidence/arm-settle/arm-settle-measure.ts [--out=<name>]
 * Flag-default runtime (stepping turn at default = on; no query flags appended).
 */

import { execFileSync } from "node:child_process";
import { mkdir, stat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "../lib/slotted-playwright.js";
import { BROWSER_PAGE_GLOBALS_INIT_SCRIPT } from "../lib/evidence-page.js";
import { spawnPortlessDevServer, stopPortlessDevServer } from "../lib/portless-server.js";
import { CASE_FROZEN_SCENE_PLANS } from "@openclinxr/asset-registry/case-frozen-scene-plans";
import {
  buildSceneClosureBundleJson,
  buildSceneClosureUrl,
  SCENE_CLOSURE_BUNDLE_ROUTE,
  SCENE_CLOSURE_SCENARIO_ID,
} from "../scene-closure/proofs/sc-05/ui-xr-bedside-approach-capture.js";

const OUT_DIR = ".openclinxr/evidence/arm-settle";
const STEP_SECONDS = 1 / 30;
const HOLD_SECONDS = 2;

function outNameFromArgv(): string {
  const flag = process.argv.find((arg) => arg.startsWith("--out="));
  return flag ? flag.slice("--out=".length) : "pre-fix";
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Code-under-test proof (arm-settle): rebuild the two runtime packages whose dist the
 * browser serves, then record content markers grepped FROM the built dist plus dist
 * mtimes and the git sha into the measurement JSON. A capture whose dist lacks the
 * expected markers does not count: tsgo --build can skip emit, so mtime alone proves
 * nothing. Expected markers per run are passed in (fix run: slew strings present;
 * control run: slew strings absent).
 */
async function buildAndProve(expected: {
  files: Record<string, { present: string[]; absent: string[] }>;
}): Promise<{
  gitSha: string;
  dist: Record<string, { mtimeMs: number; markers: Record<string, boolean> }>;
}> {
  for (const filter of ["@openclinxr/xr-pose", "@openclinxr/xr-humanoid-animation"]) {
    execFileSync("pnpm", ["-s", "turbo", "run", "build", `--filter=${filter}`], {
      cwd: process.cwd(),
      stdio: "inherit",
      timeout: 600000,
    });
  }
  const gitSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dist: Record<string, { mtimeMs: number; markers: Record<string, boolean> }> = {};
  for (const [file, want] of Object.entries(expected.files)) {
    const content = await readFile(path.resolve(process.cwd(), file), "utf8");
    const fileMarkers: Record<string, boolean> = {};
    for (const marker of [...want.present, ...want.absent]) {
      fileMarkers[marker] = content.includes(marker);
    }
    const mtimeMs = (await stat(path.resolve(process.cwd(), file))).mtimeMs;
    dist[file] = { mtimeMs, markers: fileMarkers };
  }
  const problems: string[] = [];
  for (const [file, want] of Object.entries(expected.files)) {
    const record = dist[file]!;
    for (const marker of want.present) {
      if (!record.markers[marker]) problems.push(`${file} lacks expected marker ${marker}`);
    }
    for (const marker of want.absent) {
      if (record.markers[marker]) problems.push(`${file} unexpectedly contains ${marker}`);
    }
  }
  if (problems.length > 0) throw new Error(`code proof failed:\n${problems.join("\n")}`);
  return { gitSha, dist };
}

function markersFromArgv(): { files: Record<string, { present: string[]; absent: string[] }> } {
  // --expect-fix: the release-smoothing fix must be in the served pose dist, and the
  // temporary mixer-action debug must be gone from the animation dist.
  // Default (control): the fix must be absent.
  const animationFile = "packages/openclinxr/xr-humanoid-animation/dist/locomotion-clip-playback-mod.js";
  const poseFile = "packages/openclinxr/xr-pose/dist/clinical-idle-posture.js";
  if (process.argv.some((arg) => arg === "--expect-fix")) {
    return {
      files: {
        [poseFile]: { present: ["writeArmReleaseSlew", "recordArmReleasePose"], absent: [] },
        [animationFile]: { present: [], absent: ["openClinXrMixerActionDebug"] },
      },
    };
  }
  return {
    files: {
      [poseFile]: { present: [], absent: ["writeArmReleaseSlew", "ARM_RELEASE_SLEW_MAX_RAD"] },
      [animationFile]: { present: [], absent: ["openClinXrMixerActionDebug"] },
    },
  };
}

const SUMMARY_SOURCE = String.raw`
(() => {
  const ev = globalThis.__openClinXrBedsideApproachEvidence || null;
  const samples = ev && ev.samples ? ev.samples : [];
  const last = samples.length ? samples[samples.length - 1] : null;
  return {
    phase: ev ? ev.phase : null,
    stoppedSeconds: ev ? ev.stoppedSeconds : 0,
    sampleCount: samples.length,
    lastStance: last ? last.stanceFoot : null,
    driveSource: ev ? ev.driveSource : null,
  };
})()
`;

/**
 * Arm probe: local quaternions/eulers of arm bones + world joint positions + the
 * locomotion ownership claim on the actor. Fail-soft per bone (null when absent).
 */
const ARM_PROBE_SOURCE = String.raw`
((p) => {
  const scene = globalThis.__openClinXrDebugScene;
  if (!scene) return { ok: false, reason: "no-debug-scene" };
  const actorId = p.actorId;
  let actor = null;
  scene.traverse((o) => {
    if (actor) return;
    const ud = o.userData || {};
    if (ud.openClinXrActorId === actorId) actor = o;
  });
  if (!actor) return { ok: false, reason: "no-physician-actor-" + actorId };
  const san = (n) => (typeof n === "string" ? n.replaceAll(".", "") : "");
  const pick = (tests) => {
    let found = null;
    actor.traverse((o) => {
      if (found) return;
      const s = san(o.name);
      for (const t of tests) { if (t.test(s)) { found = o; break; } }
    });
    return found;
  };
  const bone = (o) => {
    if (!o) return null;
    return {
      name: o.name,
      quat: { x: o.quaternion.x, y: o.quaternion.y, z: o.quaternion.z, w: o.quaternion.w },
      euler: { x: o.rotation.x, y: o.rotation.y, z: o.rotation.z },
    };
  };
  const worldOf = (o) => {
    if (!o) return null;
    if (typeof o.updateWorldMatrix === "function") o.updateWorldMatrix(true, false);
    const e = o.matrixWorld ? o.matrixWorld.elements : null;
    if (!e) return null;
    return { x: e[12], y: e[13], z: e[14] };
  };
  const upperL = pick([/^upperarm01L$/, /^upper_armL$/]);
  const upperR = pick([/^upperarm01R$/, /^upper_armR$/]);
  const lowerL = pick([/^lowerarm01L$/, /^forearmL$/]);
  const lowerR = pick([/^lowerarm01R$/, /^forearmR$/]);
  const shoL = pick([/^shoulder01L$/]) || upperL;
  const shoR = pick([/^shoulder01R$/]) || upperR;
  const wristL = pick([/^wristL$/, /^handL$/]);
  const wristR = pick([/^wristR$/, /^handR$/]);
  const pelvis = pick([/^pelvis$/, /pelvis/i]);
  const neck = pick([/^neck0[123]$/, /^neck$/, /neck/i]);
  // Ownership claim: set on slot.root userData, which is NOT necessarily an ancestor of
  // the actorId-tagged node (actorSlot vs root split). Search the whole scene instead.
  const claimSites = [];
  const playbackSites = [];
  scene.traverse((o) => {
    const ud = o.userData || {};
    if (Array.isArray(ud.openClinXrOwnedBoneChains)) {
      claimSites.push({
        node: o.name || "(unnamed)",
        actorId: ud.openClinXrActorId || null,
        chains: ud.openClinXrOwnedBoneChains.map((c) => ({
          ownerId: c.ownerId, weight: c.weight,
          bones: Array.isArray(c.boneNames) ? c.boneNames.length : -1,
          hasUpperArm: Array.isArray(c.boneNames) && c.boneNames.some((n) => /upperarm|upper_arm/i.test(String(n))),
        })),
      });
    }
    if (ud.openClinXrLocomotionClipPlayback !== undefined || ud.openClinXrLocomotionLegWeight !== undefined || ud.openClinXrLocomotionCrossfade !== undefined) {
      claimSites.push({
        node: (o.name || "(unnamed)") + "#playback",
        actorId: ud.openClinXrActorId || null,
        chains: [{ ownerId: "playback", weight: null, bones: -1, hasUpperArm: false,
          playback: ud.openClinXrLocomotionClipPlayback || null,
          legWeight: ud.openClinXrLocomotionLegWeight || null,
          crossfade: ud.openClinXrLocomotionCrossfade || null }],
      });
    }
  });
  const chainSummary = claimSites.length ? claimSites : null;
  const postureTag = (o) => (o && o.userData && o.userData.openClinXrClinicalIdlePosture) || null;
  // Served-code proof from inside the page: collect EVERY release store scene-wide
  // (one per humanoid running the fixed pass) with upper-arm entries, so the walker's
  // own blend state is visible even when another actor sorts first in traversal.
  const releaseStores: Array<{ node: string; actorId: unknown; size: number; upperEntries: Record<string, unknown> }> = [];
  scene.traverse((o) => {
    const ud = o.userData || {};
    if (ud.openClinXrArmReleasePrev instanceof Map) {
      const m = ud.openClinXrArmReleasePrev;
      const entries: Record<string, unknown> = {};
      m.forEach((v: unknown, k: unknown) => {
        if (typeof k === "string" && /arm/i.test(k)) entries[k] = v;
      });
      releaseStores.push({ node: o.name || "(unnamed)", actorId: ud.openClinXrActorId || null, size: m.size, upperEntries: entries });
    }
  });
  const releaseStore = releaseStores.length ? releaseStores : null;
  return {
    ok: true,
    releaseStore,
    bones: {
      upperL: bone(upperL), upperR: bone(upperR),
      lowerL: bone(lowerL), lowerR: bone(lowerR),
      shoL: bone(shoL), shoR: bone(shoR),
    },
    postureTags: {
      upperL: postureTag(upperL), upperR: postureTag(upperR),
      lowerL: postureTag(lowerL), lowerR: postureTag(lowerR),
    },
    points: {
      shoulderL: worldOf(shoL), elbowL: worldOf(lowerL), wristL: worldOf(wristL),
      shoulderR: worldOf(shoR), elbowR: worldOf(lowerR), wristR: worldOf(wristR),
      pelvis: worldOf(pelvis), neck: worldOf(neck),
    },
    chains: chainSummary,
  };
})
`;

type Quat = { x: number; y: number; z: number; w: number };
type Vec3 = { x: number; y: number; z: number };
type ArmFrame = {
  step: number;
  simMs: number;
  rafCount: number | null;
  phase: string | null;
  stoppedSeconds: number;
  bones: Record<string, { name: string; quat: Quat; euler: Vec3 } | null>;
  points: Record<string, Vec3 | null>;
  chains: Array<{ ownerId: string; weight: number; bones: number; hasUpperArm: boolean }> | null;
  postureTags?: Record<string, string | null>;
  releaseStore?: Array<{ node: string; actorId: unknown; size: number; upperEntries: Record<string, unknown> }> | null;
};

function quatAngleDeg(a: Quat, b: Quat): number {
  const dot = Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w));
  return (2 * Math.acos(dot) * 180) / Math.PI;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z);
  return l > 0 ? { x: v.x / l, y: v.y / l, z: v.z / l } : { x: 0, y: 0, z: 0 };
}

function angleDeg(a: Vec3, b: Vec3): number {
  const d = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
  return (Math.acos(d) * 180) / Math.PI;
}

async function readSummary(page: Page) {
  return (await page.evaluate(SUMMARY_SOURCE)) as {
    phase: string | null;
    stoppedSeconds: number;
    sampleCount: number;
    lastStance: string | null;
    driveSource: string | null;
  };
}

async function main(): Promise<void> {
  const outName = outNameFromArgv();
  const codeProof = await buildAndProve(markersFromArgv());
  process.stdout.write(`[arm-settle] code proof: sha=${codeProof.gitSha} markers ok\n`);
  const scenarioId = SCENE_CLOSURE_SCENARIO_ID;
  const bundleJson = buildSceneClosureBundleJson();
  const bundle = JSON.parse(bundleJson) as { actors: Array<{ actorId: string; role: string }> };
  const walkerRole = CASE_FROZEN_SCENE_PLANS[scenarioId]?.case.walkerRole;
  if (!walkerRole) throw new Error("no walkerRole for scenario");
  const walker = bundle.actors.find((actor) => actor.role === walkerRole);
  if (!walker) throw new Error("no walker actor in bundle");
  const walkerActorId = walker.actorId;
  const buildUrl = (baseUrl: string) => buildSceneClosureUrl(baseUrl);
  process.stdout.write(`[arm-settle] scenario=${scenarioId} walker=${walkerActorId} out=${outName}\n`);

  const server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180_000 });
  try {
    const browser: Browser = await chromium.launch({
      headless: true,
      args: ["--disable-gpu-vsync", "--disable-frame-rate-limit", "--use-gl=swiftshader", "--ignore-gpu-blocklist"],
    });
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const page = await context.newPage();
      await page.addInitScript(BROWSER_PAGE_GLOBALS_INIT_SCRIPT);
      try {
        await page.clock.install();
        await page.route(SCENE_CLOSURE_BUNDLE_ROUTE, async (route) => {
          await route.fulfill({ status: 200, contentType: "application/json", body: bundleJson });
        });
        await page.goto(buildUrl(server.url), { waitUntil: "load", timeout: 180_000 });
        const pinMs = (await page.evaluate(`(() => Date.now())()`)) as number;
        await page.clock.pauseAt(pinMs + 2000);
        // rAF tick counter: under the fake clock, requestAnimationFrame fires only when
        // fastForward elapses fake time past frame deadlines. The per-step delta counts
        // how many runtime frames one probe step actually contains (1 vs many decides
        // whether per-step rates are per-frame rates or pacing artifacts).
        await page.evaluate(`(() => {
          const host = globalThis;
          host.__armSettleRafCount = 0;
          const loop = () => {
            host.__armSettleRafCount += 1;
            requestAnimationFrame(loop);
          };
          requestAnimationFrame(loop);
        })()`);
        const t0 = (await page.evaluate(`(() => Date.now())()`)) as number;
        await realSleep(1500);
        const t1 = (await page.evaluate(`(() => Date.now())()`)) as number;
        if (Math.abs(t1 - t0) >= 300) throw new Error("fake clock not honoured");
        process.stdout.write(`[arm-settle] clock-hold ok (drift ${(t1 - t0).toFixed(0)} ms)\n`);

        let summary = await readSummary(page);
        let preSteps = 0;
        while (summary.phase !== "walking" && preSteps < 900) {
          await page.clock.fastForward(100);
          await realSleep(150);
          summary = await readSummary(page);
          preSteps += 1;
        }
        if (summary.phase !== "walking") throw new Error(`never reached walking (phase=${summary.phase})`);
        if (summary.driveSource !== "case_owned_bedside_approach") {
          throw new Error(`drive came from ${String(summary.driveSource)}, not the case-owned producer`);
        }
        const growth0 = summary.sampleCount;
        await page.clock.fastForward(500);
        await realSleep(300);
        const growth1 = (await readSummary(page)).sampleCount;
        if (growth1 <= growth0) throw new Error("no samples under fake clock");
        process.stdout.write(`[arm-settle] walking, sample-growth ${growth0} -> ${growth1}\n`);

        const frames: ArmFrame[] = [];
        let step = 0;
        for (;;) {
          await page.clock.fastForward(STEP_SECONDS * 1000);
          await realSleep(120);
          const probe = (await page.evaluate(
            `${ARM_PROBE_SOURCE}(${JSON.stringify({ actorId: walkerActorId })})`,
          )) as
            | { ok: true; bones: ArmFrame["bones"]; points: ArmFrame["points"]; chains: ArmFrame["chains"]; postureTags: Record<string, string | null>; releaseStore: ArmFrame["releaseStore"] }
            | { ok: false; reason?: string };
          if (!probe.ok) throw new Error(`arm probe failed at step ${step}: ${(probe as { reason?: string }).reason}`);
          summary = await readSummary(page);
          const simMs = (await page.evaluate(`(() => Date.now())()`)) as number;
          const rafCount = (await page.evaluate(
            `(() => (globalThis.__armSettleRafCount ?? null))()`,
          )) as number | null;
          frames.push({
            step,
            simMs,
            rafCount,
            phase: summary.phase,
            stoppedSeconds: summary.stoppedSeconds,
            bones: probe.bones,
            points: probe.points,
            chains: probe.chains,
            postureTags: probe.postureTags,
            releaseStore: probe.releaseStore ?? null,
          });
          step += 1;
          if (step % 60 === 0) {
            process.stdout.write(
              `[arm-settle] step ${step}: phase=${summary.phase} stopped=${summary.stoppedSeconds.toFixed(2)}s\n`,
            );
          }
          if (summary.phase === "arrived" && summary.stoppedSeconds >= HOLD_SECONDS) break;
          if (step >= 1500) throw new Error(`still not 2 s past arrival after ${step} steps`);
        }

        // ---- offline analysis ----
        const armBones = ["upperL", "upperR", "lowerL", "lowerR"] as const;
        const rates = frames.map((f, i) => {
          if (i === 0) return { step: f.step, phase: f.phase, per: {} as Record<string, number>, max: 0 };
          const prev = frames[i - 1]!;
          const per: Record<string, number> = {};
          let max = 0;
          for (const b of armBones) {
            const q0 = prev.bones[b]?.quat;
            const q1 = f.bones[b]?.quat;
            const d = q0 && q1 ? quatAngleDeg(q0, q1) : NaN;
            per[b] = d;
            if (Number.isFinite(d) && d > max) max = d;
          }
          return { step: f.step, phase: f.phase, per, max };
        });
        const walkRates = rates.filter((r) => r.phase === "walking").slice(1);
        const walkMax = Math.max(...walkRates.map((r) => r.max));
        const walkMedian =
          walkRates.map((r) => r.max).sort((a, b) => a - b)[Math.floor(walkRates.length / 2)] ?? NaN;
        const firstNonWalking = frames.findIndex((f) => f.phase !== "walking");
        const switchWindow = rates.filter((r) => {
          const f = frames[r.step]!;
          return f.phase === "settling" || f.phase === "arrived" || f.phase === "stopping";
        });
        const switchMax = switchWindow.length ? Math.max(...switchWindow.map((r) => r.max)) : NaN;
        const switchFrame = switchWindow.find((r) => r.max === switchMax) ?? null;
        // hold pose: last 10 arrived frames
        const arrived = frames.filter((f) => f.phase === "arrived");
        const hold = arrived.slice(-10);
        const trunkAngles = hold.map((f) => {
          const p = f.points;
          if (!p.pelvis || !p.neck) return { L: NaN, R: NaN };
          const trunkUp = norm(sub(p.neck, p.pelvis));
          const down = { x: -trunkUp.x, y: -trunkUp.y, z: -trunkUp.z };
          const aL = p.shoulderL && p.elbowL ? angleDeg(norm(sub(p.elbowL, p.shoulderL)), down) : NaN;
          const aR = p.shoulderR && p.elbowR ? angleDeg(norm(sub(p.elbowR, p.shoulderR)), down) : NaN;
          return { L: aL, R: aR };
        });
        const holdL = trunkAngles.map((t) => t.L).filter(Number.isFinite);
        const holdR = trunkAngles.map((t) => t.R).filter(Number.isFinite);
        const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
        // elbow bend at hold: 180 - angle(shoulder->elbow, wrist->elbow)... as flexion from straight
        const elbowBend = hold.map((f) => {
          const p = f.points;
          const bL =
            p.shoulderL && p.elbowL && p.wristL
              ? 180 - angleDeg(norm(sub(p.shoulderL, p.elbowL)), norm(sub(p.wristL, p.elbowL)))
              : NaN;
          const bR =
            p.shoulderR && p.elbowR && p.wristR
              ? 180 - angleDeg(norm(sub(p.shoulderR, p.elbowR)), norm(sub(p.wristR, p.elbowR)))
              : NaN;
          return { L: bL, R: bR };
        });
        const analysis = {
          walkClipMaxArmDegPerFrame: walkMax,
          walkMedianArmDegPerFrame: walkMedian,
          switchMaxArmDegPerFrame: switchMax,
          switchStep: switchFrame?.step ?? null,
          switchPhase: switchFrame ? (frames[switchFrame.step]?.phase ?? null) : null,
          firstNonWalkingStep: firstNonWalking,
          holdUpperArmFromTrunkDeg: { L: mean(holdL), R: mean(holdR) },
          holdElbowBendDeg: {
            L: mean(elbowBend.map((e) => e.L).filter(Number.isFinite)),
            R: mean(elbowBend.map((e) => e.R).filter(Number.isFinite)),
          },
          holdFrameCount: hold.length,
          boneNames: {
            upperL: frames[0]?.bones.upperL?.name ?? null,
            upperR: frames[0]?.bones.upperR?.name ?? null,
            lowerL: frames[0]?.bones.lowerL?.name ?? null,
            lowerR: frames[0]?.bones.lowerR?.name ?? null,
          },
        };
        process.stdout.write(`[arm-settle] analysis: ${JSON.stringify(analysis, null, 2)}\n`);

        await mkdir(OUT_DIR, { recursive: true });
        const outPath = path.resolve(process.cwd(), OUT_DIR, `${outName}.json`);
        await writeFile(
          outPath,
          `${JSON.stringify(
            {
              schemaVersion: "openclinxr.arm-settle-measurement.v1",
              measuredAt: new Date().toISOString(),
              scenario: scenarioId,
              actorId: walkerActorId,
              codeProof,
              runtimeFlags: "flag-default (no steppingTurn/ccdStanceLock query flags)",
              stepSeconds: STEP_SECONDS,
              holdSeconds: HOLD_SECONDS,
              analysis,
              frames,
            },
            null,
            2,
          )}\n`,
        );
        process.stdout.write(`[arm-settle] wrote ${outPath} (${frames.length} frames)\n`);
      } finally {
        await context.close().catch(() => undefined);
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
  } finally {
    await stopPortlessDevServer(server.proc);
  }
}

await main();
