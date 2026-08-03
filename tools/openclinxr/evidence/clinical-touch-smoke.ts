/**
 * clinical-touch-smoke.ts — headless gate for the animation-driven clinical-touch
 * interaction. Loads the ED chest-pain patient in the real UI-XR runtime, pointer-clicks
 * the case-driven body region (chest_R) via the actual canvas ray path, and asserts the
 * response fired: one-shot clip + pain emotion + reflexive dialogue + trace tag recorded,
 * no page errors. Screenshots the wince.
 *
 * Run:             tsx tools/openclinxr/evidence/clinical-touch-smoke.ts
 * Validate latest: tsx tools/openclinxr/evidence/clinical-touch-smoke.ts --validate-latest
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
const ED_PATIENT_GLB =
  "apps/ui-xr/public/cagematch/anny-real-garment/current/ed_chest_pain_patient_real_garment.glb";
const TOUCH_REGION = "chest_R";
const EXPECTED_CLIP = "openclinxr_role_patient_guard_withdraw";

type CliOptions = { validatePath?: string; validateLatest: boolean; outputPath?: string; port: number; runId: string };

const defaultOutputPath = () =>
  `docs/openclinxr/clinical-touch-smoke-${new Date().toISOString().slice(0, 10)}.json`;

function parseArgs(argv: string[]): CliOptions {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const opts: CliOptions = {
    validateLatest: false,
    port: 5231,
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

async function buildReport(opts: CliOptions): Promise<Record<string, unknown>> {
  const blockers: string[] = [];
  if (!existsSync(ED_PATIENT_GLB)) return envelope(opts, null, [`missing_ed_patient_glb:${ED_PATIENT_GLB}`]);

  const outDir = path.join(".openclinxr/evidence/clinical-touch-smoke", opts.runId);
  await mkdir(outDir, { recursive: true });

  const server = spawn("pnpm", ["--filter", "@openclinxr/ui-xr", "dev:portless"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(opts.port) },
    stdio: "pipe",
  });

  let evidence: Record<string, unknown> | null = null;
  const pageErrors: string[] = [];
  try {
    await waitForServer(opts.port, server);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1024 } });
      page.on("pageerror", (e) => pageErrors.push(String(e)));
      const url =
        `http://127.0.0.1:${opts.port}/?openclinxrScenarioId=ed_chest_pain_priority_v1` +
        `&openclinxrPortalStart=encounter&openclinxrAcceleratedExam=1` +
        `&humanoidSourceComparator=ed_anny_real_garment_patient&_ts=${Date.now()}`;
      await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });

      // 1. Wait for the case-driven touch regions to register (humanoid loaded).
      await page.waitForFunction(
        () => {
          const r = (window as unknown as { __openClinXrClinicalTouchRegionsReady?: { count?: number } })
            .__openClinXrClinicalTouchRegionsReady;
          return Boolean(r && (r.count ?? 0) > 0);
        },
        { timeout: 90_000 },
      );

      // 2. Project the region center to a canvas pixel and click it (real ray path).
      const screen = await page.evaluate((region) => {
        const project = (window as unknown as {
          __openClinXrProjectTouchRegionToScreen?: (id: string) => { x: number; y: number } | null;
        }).__openClinXrProjectTouchRegionToScreen;
        return project ? project(region) : null;
      }, TOUCH_REGION);

      if (!screen) {
        blockers.push("region_projection_unavailable");
      } else if (screen.x < 0 || screen.y < 0 || screen.x > 1280 || screen.y > 1024) {
        blockers.push(`region_offscreen:${Math.round(screen.x)},${Math.round(screen.y)}`);
      } else {
        await page.mouse.click(screen.x, screen.y);
        // 3. Wait for the response evidence.
        try {
          await page.waitForFunction(
            () => Boolean((window as unknown as { __openClinXrClinicalTouchEvidence?: unknown }).__openClinXrClinicalTouchEvidence),
            { timeout: 15_000 },
          );
        } catch {
          blockers.push("no_touch_evidence_after_click");
        }
        // let the wince clip + emotion play a beat, then capture
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(outDir, "chest-guard-wince.png") });
      }

      evidence = await page.evaluate(
        () => (window as unknown as { __openClinXrClinicalTouchEvidence?: Record<string, unknown> }).__openClinXrClinicalTouchEvidence ?? null,
      );
      await page.close();
    } finally {
      await browser.close();
    }
  } finally {
    server.kill("SIGTERM");
  }

  // 4. Assert the response.
  if (!evidence) blockers.push("no_clinical_touch_evidence");
  else {
    if (evidence.region !== TOUCH_REGION) blockers.push(`wrong_region:${String(evidence.region)}`);
    if (evidence.clipPlayed !== true) blockers.push(`clip_not_played:${String(evidence.responseClip)}`);
    if (evidence.responseClip !== EXPECTED_CLIP) blockers.push(`wrong_clip:${String(evidence.responseClip)}`);
    if (evidence.emotion !== "pain") blockers.push(`wrong_emotion:${String(evidence.emotion)}`);
    if (evidence.emotionTransitioned !== true) blockers.push("emotion_not_transitioned");
    if (evidence.dialogueFired !== true) blockers.push("dialogue_not_fired");
    if (!evidence.traceTag) blockers.push("no_trace_tag");
  }
  if (pageErrors.length > 0) blockers.push(`page_errors:${pageErrors.length}`);

  return envelope(opts, evidence, blockers, outDir, pageErrors);
}

function envelope(
  opts: CliOptions,
  evidence: Record<string, unknown> | null,
  blockers: string[],
  outDir?: string,
  pageErrors: string[] = [],
): Record<string, unknown> {
  const uniq = [...new Set(blockers)];
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    claimScope: "animation_interaction_response_not_clinical_validity",
    providerBoundary: { localOnly: true, externalNetworkUsed: true, paidApiUsed: false },
    input: { scenarioId: "ed_chest_pain_priority_v1", comparator: "ed_anny_real_garment_patient", region: TOUCH_REGION },
    evidence,
    pageErrors,
    evidenceDir: outDir ?? null,
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
    if (!p) throw new Error("No clinical-touch-smoke report to validate.");
    const v = validateReport(await readJson<Record<string, unknown>>(p));
    if (v.ok) { console.log(`Validated ${p}`); return; }
    for (const e of v.errors) console.error(`  ✗ ${e}`);
    process.exitCode = 1;
    return;
  }
  const r = await buildReport(opts);
  const out = opts.outputPath ?? defaultOutputPath();
  await writeJson(out, r);
  console.log(`Wrote ${out}`);
  const verdict = r.verdict as { passed: boolean; blockers: string[] };
  console.log(`verdict.passed=${verdict.passed} blockers=${JSON.stringify(verdict.blockers)}`);
  if (!verdict.passed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
