/**
 * clinical-touch-smoke.ts — headless gate for animation-driven clinical-touch
 * interaction evidence on the real UI-XR patient path.
 *
 * Spawns UI-XR dev:portless (default PORT 5320), loads the ED chest-pain patient
 * scenario, pointer-raycasts the abdomen_rlq hit-region via the real canvas path,
 * asserts window.__openClinXrClinicalTouchEvidence shows clipPlayed + emotion=pain +
 * dialogueFired + traceTag, requires empty pageErrors, and writes a dated report +
 * wince screenshot under docs/openclinxr/.
 *
 * CRITICAL: if runtime wiring / globals are absent, FAIL GRACEFULLY — write a report
 * with clear blockers, exit non-zero, and do NOT throw/crash. Do not implement UI-XR.
 *
 * Run:             pnpm asset:clinical-touch:smoke
 *                  tsx tools/openclinxr/evidence/clinical-touch-smoke.ts --port 5321
 * Validate latest: pnpm asset:clinical-touch:smoke:validate
 *
 * Modeled on tools/openclinxr/evidence/bvh-retarget-lab-smoke.ts (CLI + spawn + report).
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { globFiles, readJson, writeJson } from "../../agent-factory/lib.js";

const SCHEMA_VERSION = "openclinxr.clinical-touch-smoke.v1";
const REPORT_GLOB = "docs/openclinxr/clinical-touch-smoke-*.json";
const SCENARIO_ID = "ed_chest_pain_priority_v1";
const COMPARATOR = "ed_anny_real_garment_patient";
const TOUCH_REGION = "abdomen_rlq";
/** Soft expectation when case fixture is present; missing runtime still graceful-fails. */
const EXPECTED_CLIP = "openclinxr_role_patient_guard_withdraw_rlq";
const EXPECTED_EMOTION = "pain";
const EXPECTED_TRACE_TAG = "clinical_touch_guard_rlq";

/** Evidence shape asserted by this gate (runtime may expose additional fields). */
type ClinicalTouchEvidenceShape = {
  region: string;
  clipPlayed: boolean;
  emotion: string;
  dialogueFired: boolean;
  traceTag: string;
  // optional richer fields when runtime is fully wired
  responseClip?: string;
  emotionTransitioned?: boolean;
  dialogueLine?: string;
  schemaVersion?: string;
  actorId?: string;
  [key: string]: unknown;
};

type CliOptions = {
  validatePath?: string;
  validateLatest: boolean;
  outputPath?: string;
  port: number;
  runId: string;
};

const defaultOutputPath = () =>
  `docs/openclinxr/clinical-touch-smoke-${new Date().toISOString().slice(0, 10)}.json`;

/** Local evidence dir (registry-ignore); durable gate report stays at docs/openclinxr/clinical-touch-smoke-*.json. */
const defaultScreenshotPath = (runId: string) =>
  path.join(".openclinxr/evidence/clinical-touch-smoke", runId, "rlq-guard-wince.png");

function parseArgs(argv: string[]): CliOptions {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const opts: CliOptions = {
    validateLatest: false,
    // Portless fan-out range: 5320-5323; default avoids colliding with concurrent lanes.
    port: 5320,
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

async function waitForServer(port: number, server: ChildProcessWithoutNullStreams): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return;
    } catch {
      // retry
    }
    if (server.exitCode !== null) throw new Error("UI-XR dev server exited before ready.");
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`UI-XR not ready on port ${port}`);
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
 * Soft product expectations once shape is present (case-driven abdomen_rlq guarding).
 */
function evidenceValueBlockers(ev: ClinicalTouchEvidenceShape): string[] {
  const b: string[] = [];
  if (ev.region !== TOUCH_REGION) b.push(`wrong_region:${String(ev.region)}`);
  if (ev.clipPlayed !== true) b.push(`clip_not_played:${String((ev as { responseClip?: string }).responseClip ?? ev.clipPlayed)}`);
  if (ev.emotion !== EXPECTED_EMOTION) b.push(`wrong_emotion:${String(ev.emotion)}`);
  if (ev.dialogueFired !== true) b.push("dialogue_not_fired");
  if (!ev.traceTag) b.push("no_trace_tag");
  if (ev.traceTag && ev.traceTag !== EXPECTED_TRACE_TAG) b.push(`wrong_trace_tag:${String(ev.traceTag)}`);
  const responseClip = (ev as { responseClip?: string }).responseClip;
  if (responseClip !== undefined && responseClip !== EXPECTED_CLIP) {
    b.push(`wrong_clip:${String(responseClip)}`);
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
  let evidence: ClinicalTouchEvidenceShape | null = null;
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
    return envelope(opts, null, [`mkdir_failed:${String(e)}`], null, pageErrors, null);
  }

  const server = spawn("pnpm", ["--filter", "@openclinxr/ui-xr", "dev:portless"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(opts.port) },
    stdio: "pipe",
  });

  try {
    try {
      await waitForServer(opts.port, server);
    } catch (e) {
      blockers.push(`ui_xr_server_not_ready:${String(e)}`);
      return envelope(opts, null, blockers, outDir, pageErrors, null);
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
            (window as unknown as { __openClinXrClinicalTouchRegionsReady?: { count?: number; regions?: string[]; actorId?: string } })
              .__openClinXrClinicalTouchRegionsReady ?? null,
        );
      } catch {
        blockers.push(
          "clinical_touch_regions_not_ready:window.__openClinXrClinicalTouchRegionsReady absent or empty after settle — UI-XR clinical-touch region registration not wired or humanoid failed to load",
        );
      }

      // Attempt real canvas click via projection helper when available.
      if (regionsReady && (regionsReady.count ?? 0) > 0) {
        const screen = await page.evaluate((region) => {
          const project = (
            window as unknown as {
              __openClinXrProjectTouchRegionToScreen?: (id: string) => { x: number; y: number } | null;
            }
          ).__openClinXrProjectTouchRegionToScreen;
          return project ? project(region) : null;
        }, TOUCH_REGION);

        if (!screen) {
          blockers.push(
            "region_projection_unavailable:window.__openClinXrProjectTouchRegionToScreen missing or returned null",
          );
        } else if (screen.x < 0 || screen.y < 0 || screen.x > 1280 || screen.y > 1024) {
          blockers.push(`region_offscreen:${Math.round(screen.x)},${Math.round(screen.y)}`);
        } else {
          try {
            await page.mouse.click(screen.x, screen.y);
          } catch (e) {
            blockers.push(`mouse_click_failed:${String(e)}`);
          }
          try {
            await page.waitForFunction(
              () =>
                Boolean(
                  (window as unknown as { __openClinXrClinicalTouchEvidence?: unknown })
                    .__openClinXrClinicalTouchEvidence,
                ),
              { timeout: 15_000 },
            );
          } catch {
            blockers.push(
              "no_touch_evidence_after_click:window.__openClinXrClinicalTouchEvidence still absent after region click",
            );
          }
          // Let wince clip / emotion play a beat, then capture.
          await page.waitForTimeout(500);
        }
      }

      // Always read evidence if present (may already be set by other paths).
      try {
        evidence = await page.evaluate(
          () =>
            ((window as unknown as { __openClinXrClinicalTouchEvidence?: ClinicalTouchEvidenceShape })
              .__openClinXrClinicalTouchEvidence ?? null) as ClinicalTouchEvidenceShape | null,
        );
      } catch (e) {
        blockers.push(`evidence_evaluate_failed:${String(e)}`);
      }

      // Screenshot under .openclinxr/evidence (registry-ignore local cache).
      // Durable gate report remains docs/openclinxr/clinical-touch-smoke-*.json (registered).
      screenshotPath = defaultScreenshotPath(opts.runId);
      try {
        await mkdir(path.dirname(screenshotPath), { recursive: true });
        await page.screenshot({ path: screenshotPath });
        await page.screenshot({ path: path.join(outDir, "rlq-guard-wince.png") });
      } catch (e) {
        blockers.push(`screenshot_failed:${String(e)}`);
        screenshotPath = null;
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
    try {
      server.kill("SIGTERM");
    } catch {
      // ignore
    }
  }

  // Shape + value assertions (never throw).
  const shapeBlockers = evidenceShapeBlockers(evidence);
  blockers.push(...shapeBlockers);
  if (evidence && shapeBlockers.length === 0) {
    blockers.push(...evidenceValueBlockers(evidence));
  }
  if (pageErrors.length > 0) blockers.push(`page_errors:${pageErrors.length}`);

  return envelope(opts, evidence, blockers, outDir, pageErrors, screenshotPath);
}

function envelope(
  opts: CliOptions,
  evidence: ClinicalTouchEvidenceShape | null,
  blockers: string[],
  outDir: string | null,
  pageErrors: string[],
  screenshotPath: string | null,
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
      region: TOUCH_REGION,
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
