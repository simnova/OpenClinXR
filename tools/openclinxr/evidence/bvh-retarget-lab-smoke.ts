/**
 * bvh-retarget-lab-smoke.ts — three.js-side render gate for retargeted locomotion GLBs.
 *
 * The Blender bake can look fine while the GLB explodes/desyncs in the runtime (the
 * classic three.js rest-pose explosion). This gate loads each shippable clip in the
 * isolated humanoid lab, samples the *deformed* skinned-mesh bbox over ~one cycle via
 * window.__isoAnimEvidence, and fails on explosion / static playback / page errors.
 *
 * Run:             tsx tools/openclinxr/evidence/bvh-retarget-lab-smoke.ts
 * Validate latest: tsx tools/openclinxr/evidence/bvh-retarget-lab-smoke.ts --validate-latest
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { globFiles, readJson, writeJson } from "../../agent-factory/lib.js";

const SCHEMA_VERSION = "openclinxr.bvh-retarget-lab-smoke.v1";
const REPORT_GLOB = "docs/openclinxr/bvh-retarget-lab-smoke-*.json";
const MAX_EXPLODE_RATIO = 3.0;
const MIN_MOTION_RANGE_M = 0.02; // static bake => ~0; healthy walk >> this
const MAX_BACK_PITCH_DEG = 25.0; // upright walk ~10-14 deg; a torso dive/hunch >> this

type Clip = { key: string; glb: string; anim: string };
const CLIPS: Clip[] = [
  {
    key: "mblab-walk",
    glb: "/cagematch/seated-adult-bod-preview-2026-08-02/ed_chest_pain_patient_adult_bod.cmu-bvh-full.glb",
    anim: "walking",
  },
  {
    key: "mblab-run",
    glb: "/cagematch/seated-adult-bod-preview-2026-08-02/ed_chest_pain_patient_adult_bod.cmu-bvh-full.glb",
    anim: "running",
  },
  {
    key: "cmu-walk",
    glb: "/cagematch/seated-adult-bod-preview-2026-08-02/ed_chest_pain_patient_adult_bod.cmu-diag.glb",
    anim: "07_01",
  },
];

// Public-dir path (relative to apps/ui-xr) used only for an existence preflight.
const PUBLIC_ROOT = "apps/ui-xr/public";

type CliOptions = {
  validatePath?: string;
  validateLatest: boolean;
  outputPath?: string;
  port: number;
  runId: string;
};

const defaultOutputPath = () =>
  `docs/openclinxr/bvh-retarget-lab-smoke-${new Date().toISOString().slice(0, 10)}.json`;

function parseArgs(argv: string[]): CliOptions {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const opts: CliOptions = {
    validateLatest: false,
    port: 5199,
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

function clipBlockers(clip: Clip, ev: any, pageErrors: string[]): string[] {
  const b: string[] = [];
  if (!ev || !ev.ready) { b.push(`${clip.key}:no_evidence`); return b; }
  if (!ev.animating) b.push(`${clip.key}:not_animating`);
  if ((ev.explodeRatio ?? 0) > MAX_EXPLODE_RATIO) b.push(`${clip.key}:mesh_explode=${ev.explodeRatio}`);
  if ((ev.motionRangeM ?? 0) < MIN_MOTION_RANGE_M) b.push(`${clip.key}:static_motion=${ev.motionRangeM}`);
  if ((ev.backPitchMaxDeg ?? 0) > MAX_BACK_PITCH_DEG) b.push(`${clip.key}:torso_pitch=${ev.backPitchMaxDeg}`);
  if ((ev.pageErrors?.length ?? 0) > 0) b.push(`${clip.key}:page_errors=${ev.pageErrors.length}`);
  if (pageErrors.length > 0) b.push(`${clip.key}:pw_page_errors=${pageErrors.length}`);
  return b;
}

async function buildReport(opts: CliOptions): Promise<any> {
  // Preflight: the referenced GLBs must exist in the public dir.
  const missing = [...new Set(CLIPS.map((c) => c.glb))].filter(
    (g) => !existsSync(path.join(PUBLIC_ROOT, g.replace(/^\//, ""))),
  );
  if (missing.length) {
    return reportEnvelope(opts, [], [`missing_glb:${missing.join(",")}`]);
  }

  const outDir = path.join(".openclinxr/evidence/bvh-retarget-lab-smoke", opts.runId);
  await mkdir(outDir, { recursive: true });

  const server = spawn("pnpm", ["--filter", "@openclinxr/ui-xr", "dev:portless"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(opts.port) },
    stdio: "pipe",
  });

  const results: any[] = [];
  const blockers: string[] = [];
  try {
    await waitForServer(opts.port, server);
    const browser = await chromium.launch({ headless: true });
    try {
      for (const clip of CLIPS) {
        const page = await browser.newPage({ viewport: { width: 900, height: 1100 } });
        const pageErrors: string[] = [];
        page.on("pageerror", (e) => pageErrors.push(String(e)));
        const url =
          `http://127.0.0.1:${opts.port}/_isolated-humanoid-lab/index.html` +
          `?glb=${clip.glb}&anim=glb:${clip.anim}&physics=0&skeleton=1&skinOpacity=0.28&align=0&_ts=${Date.now()}`;
        let ev: any = null;
        try {
          await page.goto(url, { waitUntil: "load", timeout: 45_000 });
          await page.waitForFunction(() => window.__isoReady === true || window.__isoError, { timeout: 30_000 });
          await page.waitForFunction(
            () => Boolean(window.__isoAnimEvidence && window.__isoAnimEvidence.ready),
            { timeout: 20_000 },
          );
          ev = await page.evaluate(() => window.__isoAnimEvidence);
          await page.screenshot({ path: path.join(outDir, `${clip.key}.png`) });
        } catch (e) {
          pageErrors.push(`capture_failed:${String(e)}`);
        }
        const cb = clipBlockers(clip, ev, pageErrors);
        blockers.push(...cb);
        results.push({ clip: clip.key, glb: clip.glb, anim: clip.anim, evidence: ev, pageErrors, blockers: cb });
        await page.close();
      }
    } finally {
      await browser.close();
    }
  } finally {
    server.kill("SIGTERM");
  }

  await writeFile(path.join(outDir, "inspection.json"), JSON.stringify(results, null, 2));
  return reportEnvelope(opts, results, blockers, outDir);
}

function reportEnvelope(opts: CliOptions, clips: any[], blockers: string[], outDir?: string): any {
  const uniq = [...new Set(blockers)];
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    claimScope: "animation_retarget_validation_not_clinical_validity",
    providerBoundary: { localOnly: true, externalNetworkUsed: true, paidApiUsed: false },
    thresholds: { maxExplodeRatio: MAX_EXPLODE_RATIO, minMotionRangeM: MIN_MOTION_RANGE_M },
    evidenceDir: outDir ?? null,
    clips,
    verdict: { passed: uniq.length === 0, blockers: uniq },
    notEvidenceFor: ["clinical_validity", "scoring_validity", "production_asset_readiness", "quest_readiness"],
  };
}

function validateReport(r: any): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const req = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
  req(r?.schemaVersion === SCHEMA_VERSION, `schemaVersion !== ${SCHEMA_VERSION}`);
  req(r?.claimScope === "animation_retarget_validation_not_clinical_validity", "claimScope wrong");
  req(typeof r?.verdict?.passed === "boolean", "verdict.passed missing");
  req(r?.verdict?.passed === true, `verdict not passed: ${JSON.stringify(r?.verdict?.blockers)}`);
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
    if (!p) throw new Error("No bvh-retarget-lab-smoke report to validate.");
    const v = validateReport(await readJson<any>(p));
    if (v.ok) { console.log(`Validated ${p}`); return; }
    for (const e of v.errors) console.error(`  ✗ ${e}`);
    process.exitCode = 1;
    return;
  }

  const r = await buildReport(opts);
  const out = opts.outputPath ?? defaultOutputPath();
  await writeJson(out, r);
  console.log(`Wrote ${out}`);
  console.log(`verdict.passed=${r.verdict.passed} blockers=${JSON.stringify(r.verdict.blockers)}`);
  if (!r.verdict.passed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
