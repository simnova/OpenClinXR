/**
 * clinical-touch-smoke.ts — headless gate for multi-region animation-driven
 * clinical-touch interaction evidence on the real UI-XR patient path.
 *
 * Spawns UI-XR via `spawnPortlessDevServer` (findFreePort + parse Vite Local:
 * line — collision-safe; optional `--port N` still preferred when set). Loads the
 * ED chest-pain patient scenario, pointer-raycasts 2–3 DIFFERENT body regions via
 * the real canvas path, asserts each produces its case-driven emotion/dialogue/trace,
 * requires empty pageErrors, and writes a dated report under docs/openclinxr/.
 *
 * A miss (no hit-box / offscreen) still falls through without crashing (graceful fail).
 *
 * CRITICAL: if runtime wiring / globals are absent, FAIL GRACEFULLY — write a report
 * with clear blockers, exit non-zero, and do NOT throw/crash. Do not implement UI-XR.
 *
 * Run:             pnpm asset:clinical-touch:smoke
 *                  tsx tools/openclinxr/evidence/clinical-touch-smoke.ts --port 5331
 * Validate latest: pnpm asset:clinical-touch:smoke:validate
 *
 * Modeled on tools/openclinxr/evidence/bvh-retarget-lab-smoke.ts (CLI + spawn + report).
 */

import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { globFiles, readJson, writeJson } from "../../agent-factory/lib.js";
import {
  spawnPortlessDevServer,
  stopPortlessDevServer,
} from "./lib/portless-server.js";

const SCHEMA_VERSION = "openclinxr.clinical-touch-smoke.v1";
const REPORT_GLOB = "docs/openclinxr/clinical-touch-smoke-*.json";
const SCENARIO_ID = "ed_chest_pain_priority_v1";
const COMPARATOR = "ed_anny_real_garment_patient";

/** Multi-region exercise set (case bodyMechanics); each has distinct dialogue/trace. */
type ExpectedRegion = {
  region: string;
  emotion: string;
  traceTag: string;
  responseClip: string;
  /** Substring expected in dialogueLine when present. */
  dialogueIncludes: string;
};

const EXERCISE_REGIONS: ExpectedRegion[] = [
  {
    region: "abdomen_rlq",
    emotion: "pain",
    traceTag: "clinical_touch_guard_rlq",
    responseClip: "openclinxr_role_patient_guard_withdraw_rlq",
    dialogueIncludes: "hurts",
  },
  {
    region: "chest_R",
    emotion: "pain",
    traceTag: "clinical_touch_guard_chest_r",
    responseClip: "openclinxr_role_patient_guard_withdraw_rlq",
    dialogueIncludes: "pressure",
  },
  {
    region: "abdomen_luq",
    emotion: "concerned",
    traceTag: "clinical_touch_guard_luq",
    responseClip: "openclinxr_role_patient_guard_withdraw_rlq",
    dialogueIncludes: "Mild discomfort",
  },
];

/** Evidence shape asserted by this gate (runtime may expose additional fields). */
type ClinicalTouchEvidenceShape = {
  region: string;
  clipPlayed: boolean;
  emotion: string;
  dialogueFired: boolean;
  traceTag: string;
  responseClip?: string;
  emotionTransitioned?: boolean;
  dialogueLine?: string;
  schemaVersion?: string;
  actorId?: string;
  [key: string]: unknown;
};

type RegionResult = {
  region: string;
  expected: ExpectedRegion;
  evidence: ClinicalTouchEvidenceShape | null;
  blockers: string[];
  screen: { x: number; y: number } | null;
};

type CliOptions = {
  validatePath?: string;
  validateLatest: boolean;
  outputPath?: string;
  /** Preferred port; 0 / unset → spawnPortlessDevServer pre-scans a free port. */
  port: number;
  runId: string;
};

const defaultOutputPath = () =>
  `docs/openclinxr/clinical-touch-smoke-${new Date().toISOString().slice(0, 10)}.json`;

/** Local evidence dir (registry-ignore); durable gate report stays at docs/openclinxr/clinical-touch-smoke-*.json. */
const defaultScreenshotPath = (runId: string, region: string) =>
  path.join(".openclinxr/evidence/clinical-touch-smoke", runId, `${region}-guard-wince.png`);

function parseArgs(argv: string[]): CliOptions {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const opts: CliOptions = {
    validateLatest: false,
    // 0 = dynamic allocation via spawnPortlessDevServer (collision-safe parallel worktrees).
    port: 0,
    runId: new Date().toISOString().replace(/[:.]/g, "-"),
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--validate-latest") opts.validateLatest = true;
    else if (a === "--validate") opts.validatePath = args[++i];
    else if (a === "--output") opts.outputPath = args[++i];
    else if (a === "--port") opts.port = Number(args[++i]);
    else throw new Error(`Unknown arg: ${a}`);
  }
  return opts;
}

/**
 * Assert required evidence shape. Returns blockers (empty when ok).
 * Does not throw.
 */
function evidenceShapeBlockers(ev: ClinicalTouchEvidenceShape | null | undefined): string[] {
  const b: string[] = [];
  if (!ev || typeof ev !== "object") {
    b.push(
      "no_clinical_touch_evidence:window.__openClinXrClinicalTouchEvidence absent — runtime clinical-touch wiring not published (or touch not exercised)",
    );
    return b;
  }
  if (typeof ev.region !== "string" || !ev.region) b.push(`missing_or_invalid_region:${String(ev.region)}`);
  if (typeof ev.clipPlayed !== "boolean") b.push(`clipPlayed_not_boolean:${String(ev.clipPlayed)}`);
  if (typeof ev.emotion !== "string" || !ev.emotion) b.push(`missing_or_invalid_emotion:${String(ev.emotion)}`);
  if (typeof ev.dialogueFired !== "boolean") b.push(`dialogueFired_not_boolean:${String(ev.dialogueFired)}`);
  if (typeof ev.traceTag !== "string" || !ev.traceTag) b.push(`missing_or_invalid_traceTag:${String(ev.traceTag)}`);
  return b;
}

/**
 * Per-region product expectations once shape is present.
 */
function evidenceValueBlockers(ev: ClinicalTouchEvidenceShape, expected: ExpectedRegion): string[] {
  const b: string[] = [];
  if (ev.region !== expected.region) b.push(`wrong_region:${String(ev.region)}!=${expected.region}`);
  if (ev.clipPlayed !== true) {
    b.push(`clip_not_played:${String((ev as { responseClip?: string }).responseClip ?? ev.clipPlayed)}`);
  }
  if (ev.emotion !== expected.emotion) b.push(`wrong_emotion:${String(ev.emotion)}!=${expected.emotion}`);
  if (ev.dialogueFired !== true) b.push("dialogue_not_fired");
  if (!ev.traceTag) b.push("no_trace_tag");
  if (ev.traceTag && ev.traceTag !== expected.traceTag) {
    b.push(`wrong_trace_tag:${String(ev.traceTag)}!=${expected.traceTag}`);
  }
  const responseClip = (ev as { responseClip?: string }).responseClip;
  if (responseClip !== undefined && responseClip !== expected.responseClip) {
    b.push(`wrong_clip:${String(responseClip)}`);
  }
  const dialogueLine = (ev as { dialogueLine?: string }).dialogueLine;
  if (dialogueLine !== undefined && !dialogueLine.includes(expected.dialogueIncludes)) {
    b.push(`wrong_dialogue:${String(dialogueLine)}`);
  }
  const emotionTransitioned = (ev as { emotionTransitioned?: boolean }).emotionTransitioned;
  if (emotionTransitioned !== undefined && emotionTransitioned !== true) {
    b.push("emotion_not_transitioned");
  }
  return b;
}

async function buildReport(opts: CliOptions): Promise<Record<string, unknown>> {
  const blockers: string[] = [];
  const pageErrors: string[] = [];
  const regionResults: RegionResult[] = [];
  let lastEvidence: ClinicalTouchEvidenceShape | null = null;
  let screenshotPath: string | null = null;
  const outDir = path.join(".openclinxr/evidence/clinical-touch-smoke", opts.runId);

  // Optional asset preflight — missing GLB is a soft blocker (runtime may still load other paths).
  const edPatientGlb =
    "apps/ui-xr/public/cagematch/anny-real-garment/current/ed_chest_pain_patient_real_garment.glb";
  if (!existsSync(edPatientGlb)) {
    blockers.push(`missing_ed_patient_glb:${edPatientGlb}`);
  }

  try {
    await mkdir(outDir, { recursive: true });
    await mkdir("docs/openclinxr", { recursive: true });
  } catch (e) {
    return envelope(opts, null, [`mkdir_failed:${String(e)}`], null, pageErrors, null, regionResults);
  }

  let server: ChildProcessByStdio<null, Readable, Readable> | null = null;
  try {
    try {
      const handle = await spawnPortlessDevServer({
        filter: "@openclinxr/ui-xr",
        env: opts.port > 0 ? { PORT: String(opts.port) } : undefined,
        readyTimeoutMs: 120_000,
      });
      server = handle.proc;
      // Use the **actual** bound port (may differ from preferred if race / auto-pick).
      opts.port = handle.port;
    } catch (e) {
      blockers.push(`ui_xr_server_not_ready:${String(e)}`);
      return envelope(opts, null, blockers, outDir, pageErrors, null, regionResults);
    }

    let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ viewport: { width: 1280, height: 1024 } });
      page.on("pageerror", (e) => pageErrors.push(String(e)));

      const url =
        `http://127.0.0.1:${opts.port}/?openclinxrScenarioId=${SCENARIO_ID}` +
        `&openclinxrPortalStart=encounter&openclinxrAcceleratedExam=1` +
        `&humanoidSourceComparator=${COMPARATOR}&_ts=${Date.now()}`;

      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
      } catch (e) {
        blockers.push(`page_goto_failed:${String(e)}`);
        // Still try to read evidence / screenshot for residual diagnostics.
      }

      // Probe regions-ready. Absence is a clear blocker, not a crash.
      let regionsReady: { count?: number; regions?: string[]; actorId?: string } | null = null;
      try {
        await page.waitForFunction(
          () => {
            const r = (window as unknown as { __openClinXrClinicalTouchRegionsReady?: { count?: number } })
              .__openClinXrClinicalTouchRegionsReady;
            return Boolean(r && (r.count ?? 0) > 0);
          },
          { timeout: 90_000 },
        );
        regionsReady = await page.evaluate(
          () =>
            (window as unknown as {
              __openClinXrClinicalTouchRegionsReady?: { count?: number; regions?: string[]; actorId?: string };
            }).__openClinXrClinicalTouchRegionsReady ?? null,
        );
      } catch {
        blockers.push(
          "clinical_touch_regions_not_ready:window.__openClinXrClinicalTouchRegionsReady absent or empty after settle — UI-XR clinical-touch region registration not wired or humanoid failed to load",
        );
      }

      if (regionsReady && (regionsReady.count ?? 0) > 0) {
        const readyRegions = new Set(regionsReady.regions ?? []);
        for (const expected of EXERCISE_REGIONS) {
          if (readyRegions.size > 0 && !readyRegions.has(expected.region)) {
            regionResults.push({
              region: expected.region,
              expected,
              evidence: null,
              blockers: [`region_not_registered:${expected.region}`],
              screen: null,
            });
            continue;
          }

          // Clear prior evidence so each region is independently asserted.
          await page.evaluate(() => {
            delete (window as unknown as { __openClinXrClinicalTouchEvidence?: unknown })
              .__openClinXrClinicalTouchEvidence;
          });

          const screen = await page.evaluate((region) => {
            const project = (
              window as unknown as {
                __openClinXrProjectTouchRegionToScreen?: (id: string) => { x: number; y: number } | null;
              }
            ).__openClinXrProjectTouchRegionToScreen;
            return project ? project(region) : null;
          }, expected.region);

          const regionBlockers: string[] = [];
          let evidence: ClinicalTouchEvidenceShape | null = null;

          if (!screen) {
            // Miss falls through — record blocker, do not throw.
            regionBlockers.push(
              `region_projection_unavailable:${expected.region}:window.__openClinXrProjectTouchRegionToScreen missing or returned null`,
            );
          } else if (screen.x < 0 || screen.y < 0 || screen.x > 1280 || screen.y > 1024) {
            regionBlockers.push(`region_offscreen:${expected.region}:${Math.round(screen.x)},${Math.round(screen.y)}`);
          } else {
            try {
              await page.mouse.click(screen.x, screen.y);
            } catch (e) {
              regionBlockers.push(`mouse_click_failed:${expected.region}:${String(e)}`);
            }
            try {
              await page.waitForFunction(
                (regionId) => {
                  const ev = (
                    window as unknown as { __openClinXrClinicalTouchEvidence?: { region?: string } }
                  ).__openClinXrClinicalTouchEvidence;
                  return Boolean(ev && ev.region === regionId);
                },
                expected.region,
                { timeout: 15_000 },
              );
            } catch {
              regionBlockers.push(
                `no_touch_evidence_after_click:${expected.region}:window.__openClinXrClinicalTouchEvidence still absent or wrong region after click`,
              );
            }
            await page.waitForTimeout(400);

            try {
              evidence = await page.evaluate(
                () =>
                  ((window as unknown as { __openClinXrClinicalTouchEvidence?: ClinicalTouchEvidenceShape })
                    .__openClinXrClinicalTouchEvidence ?? null) as ClinicalTouchEvidenceShape | null,
              );
            } catch (e) {
              regionBlockers.push(`evidence_evaluate_failed:${expected.region}:${String(e)}`);
            }

            const shapeB = evidenceShapeBlockers(evidence);
            regionBlockers.push(...shapeB.map((s) => `${expected.region}:${s}`));
            if (evidence && shapeB.length === 0) {
              regionBlockers.push(
                ...evidenceValueBlockers(evidence, expected).map((s) => `${expected.region}:${s}`),
              );
            }

            // Per-region screenshot under local evidence dir.
            try {
              const shot = defaultScreenshotPath(opts.runId, expected.region);
              await mkdir(path.dirname(shot), { recursive: true });
              await page.screenshot({ path: shot });
              await page.screenshot({ path: path.join(outDir, `${expected.region}-guard-wince.png`) });
              if (!screenshotPath) screenshotPath = shot;
            } catch (e) {
              regionBlockers.push(`screenshot_failed:${expected.region}:${String(e)}`);
            }
          }

          lastEvidence = evidence;
          regionResults.push({
            region: expected.region,
            expected,
            evidence,
            blockers: regionBlockers,
            screen,
          });
          blockers.push(...regionBlockers);
        }
      }

      // Final composite screenshot if none yet.
      if (!screenshotPath) {
        screenshotPath = defaultScreenshotPath(opts.runId, "composite");
        try {
          await mkdir(path.dirname(screenshotPath), { recursive: true });
          await page.screenshot({ path: screenshotPath });
          await page.screenshot({ path: path.join(outDir, "composite.png") });
        } catch (e) {
          blockers.push(`screenshot_failed:${String(e)}`);
          screenshotPath = null;
        }
      }

      await page.close();
    } catch (e) {
      blockers.push(`playwright_session_failed:${String(e)}`);
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch {
          // ignore close errors
        }
      }
    }
  } finally {
    stopPortlessDevServer(server);
  }

  if (pageErrors.length > 0) blockers.push(`page_errors:${pageErrors.length}`);

  // Require all exercise regions to have been attempted with zero blockers.
  if (regionResults.length < EXERCISE_REGIONS.length) {
    blockers.push(
      `incomplete_region_coverage:${regionResults.length}/${EXERCISE_REGIONS.length}`,
    );
  }

  return envelope(opts, lastEvidence, blockers, outDir, pageErrors, screenshotPath, regionResults);
}

function envelope(
  opts: CliOptions,
  evidence: ClinicalTouchEvidenceShape | null,
  blockers: string[],
  outDir: string | null,
  pageErrors: string[],
  screenshotPath: string | null,
  regionResults: RegionResult[],
): Record<string, unknown> {
  const uniq = [...new Set(blockers)];
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    claimScope: "animation_interaction_response_not_clinical_validity",
    providerBoundary: { localOnly: true, externalNetworkUsed: true, paidApiUsed: false },
    input: {
      scenarioId: SCENARIO_ID,
      comparator: COMPARATOR,
      regions: EXERCISE_REGIONS.map((r) => r.region),
      // Back-compat single region field (first exercised).
      region: EXERCISE_REGIONS[0]?.region ?? "abdomen_rlq",
      port: opts.port,
      runId: opts.runId,
    },
    expectedEvidenceShape: {
      region: "string",
      clipPlayed: "boolean",
      emotion: "string",
      dialogueFired: "boolean",
      traceTag: "string",
    },
    expectedRegions: EXERCISE_REGIONS,
    regionResults: regionResults.map((r) => ({
      region: r.region,
      passed: r.blockers.length === 0 && r.evidence !== null,
      blockers: r.blockers,
      evidence: r.evidence,
      screen: r.screen,
      expected: r.expected,
    })),
    evidence,
    pageErrors,
    screenshotPath,
    evidenceDir: outDir,
    verdict: { passed: uniq.length === 0, blockers: uniq },
    notEvidenceFor: ["clinical_validity", "exam_equivalence", "scoring", "learner_readiness"],
  };
}

function validateReport(r: Record<string, unknown>): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const verdict = r?.verdict as { passed?: unknown; blockers?: unknown } | undefined;
  if (r?.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion !== ${SCHEMA_VERSION}`);
  if (r?.claimScope !== "animation_interaction_response_not_clinical_validity") errors.push("claimScope wrong");
  if (typeof verdict?.passed !== "boolean") errors.push("verdict.passed missing");
  if (verdict?.passed !== true) errors.push(`verdict not passed: ${JSON.stringify(verdict?.blockers)}`);
  // Multi-region: require regionResults when present (new reports).
  const regionResults = r?.regionResults as Array<{ passed?: boolean; region?: string }> | undefined;
  if (Array.isArray(regionResults) && regionResults.length > 0) {
    const failed = regionResults.filter((x) => x.passed !== true);
    if (failed.length > 0) {
      errors.push(`region_failures:${failed.map((f) => f.region).join(",")}`);
    }
    if (regionResults.length < 2) {
      errors.push(`insufficient_regions:${regionResults.length}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

async function latestPath(): Promise<string | null> {
  const files = await globFiles(REPORT_GLOB);
  return files.sort().at(-1) ?? null;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.validatePath || opts.validateLatest) {
    const p = opts.validatePath ?? (await latestPath());
    if (!p) {
      console.error(
        "No clinical-touch-smoke report to validate under docs/openclinxr/clinical-touch-smoke-*.json",
      );
      process.exitCode = 1;
      return;
    }
    let report: Record<string, unknown>;
    try {
      report = await readJson<Record<string, unknown>>(p);
    } catch (e) {
      console.error(`Failed to read report ${p}: ${String(e)}`);
      process.exitCode = 1;
      return;
    }
    const v = validateReport(report);
    if (v.ok) {
      console.log(`Validated ${p}`);
      return;
    }
    for (const e of v.errors) console.error(`  ✗ ${e}`);
    process.exitCode = 1;
    return;
  }

  // Always produce a report even on partial failure (graceful fail contract).
  let r: Record<string, unknown>;
  try {
    r = await buildReport(opts);
  } catch (e) {
    // Absolute last resort: never crash without a written report.
    console.error(`[clinical-touch-smoke] unexpected error (writing failure report): ${String(e)}`);
    r = envelope(
      opts,
      null,
      [`unexpected_build_error:${String(e)}`],
      null,
      [],
      null,
      [],
    );
  }

  const out = opts.outputPath ?? defaultOutputPath();
  try {
    await writeJson(out, r);
    console.log(`Wrote ${out}`);
  } catch (e) {
    console.error(`Failed to write report ${out}: ${String(e)}`);
    process.exitCode = 1;
    return;
  }

  const verdict = r.verdict as { passed: boolean; blockers: string[] };
  const regionResults = (r.regionResults as Array<{ region: string; passed: boolean }> | undefined) ?? [];
  for (const rr of regionResults) {
    console.log(`region ${rr.region}: ${rr.passed ? "PASS" : "FAIL"}`);
  }
  console.log(`verdict.passed=${verdict.passed} blockers=${JSON.stringify(verdict.blockers)}`);
  if (verdict.blockers.length > 0) {
    console.error("[clinical-touch-smoke] BLOCKERS:");
    for (const b of verdict.blockers) console.error(`  - ${b}`);
  }
  if (!verdict.passed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    // Mirror bvh: never leave process hanging; exit non-zero without uncaught throw.
    console.error(`[clinical-touch-smoke] fatal: ${String(e)}`);
    process.exitCode = 1;
  });
}
