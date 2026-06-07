import { execSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import type { ModelVettingReport } from "../../../packages/openclinxr/arena/model-vetting/src/index.js";
import { buildCagematchOutputHome, ensureCagematchOutputHome } from "./generated-output-home.js";

type CliOptions = {
  lane: string;
  runId: string;
  annyReportPath: string;
  annyCandidateId: string;
  mpfbGlbPath: string;
  captureViews: Array<"front" | "three_quarter">;
  port: number;
};

const NOT_EVIDENCE_FOR = [
  "b_plus_visual_realism_gate",
  "scene_placement_readiness",
  "quest_readiness",
  "production_asset_readiness",
  "learner_readiness",
  "clinical_validity",
  "scoring_validity",
];

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const outputHome = buildCagematchOutputHome(options.lane, options.runId);
  await ensureCagematchOutputHome(outputHome);

  const annyReport = JSON.parse(await readFile(options.annyReportPath, "utf8")) as ModelVettingReport;
  const annyCandidate = annyReport.candidates.find((candidate) => candidate.candidateId === options.annyCandidateId);
  if (!annyCandidate) {
    throw new Error(`Candidate ${options.annyCandidateId} not found in ${options.annyReportPath}`);
  }

  const mpfbPublicPath = `/${path.relative("apps/arena/model-vetting-studio/public", options.mpfbGlbPath).replaceAll(path.sep, "/")}`;
  const mpfbCandidate = structuredClone(annyCandidate);
  mpfbCandidate.candidateId = "peds_patient_child_mpfb_pediatric_comparator";
  mpfbCandidate.sourceGlbPath = mpfbPublicPath;
  mpfbCandidate.actorDisplayRole = "MPFB/MakeHuman pediatric comparator";
  mpfbCandidate.sourceKind = "imported_humanoid_candidate";
  mpfbCandidate.usesRealAnnyForwardPass = false;
  mpfbCandidate.blockers = [
    ...new Set([
      ...mpfbCandidate.blockers,
      "mpfb_comparator_not_anny_forward_pass",
      "fixed_camera_screenshots_missing",
    ]),
  ].sort();

  const annyCompareCandidate = structuredClone(annyCandidate);
  annyCompareCandidate.candidateId = "peds_patient_child_anny_comfy_masked_face_comparator";
  annyCompareCandidate.actorDisplayRole = "Anny Comfy masked-face pediatric patient";

  const report: ModelVettingReport = {
    ...annyReport,
    generatedAt: new Date().toISOString(),
    claimScope: "isolated_model_vetting_metadata_structural_and_lab_contract_only",
    tracking: annyReport.tracking,
    candidates: [annyCompareCandidate, mpfbCandidate],
    decision: {
      ...annyReport.decision,
      isolatedLabCaptureComplete: false,
      scenePlacementEvidenceAllowed: false,
      runtimePromotionAllowed: false,
      productionManifestPromotionAllowed: false,
      nextSafeStep:
        "Review Anny Comfy masked-face pediatric patient against MPFB comparator in isolated side-by-side captures before any source promotion claim.",
    },
    notEvidenceFor: NOT_EVIDENCE_FOR,
  };

  const publicReportPath = path.join(outputHome.publicMirrorDir, "model-vetting-report.json");
  const localReportPath = path.join(outputHome.localEvidenceDir, "model-vetting-report.json");
  const summaryPath = path.join(outputHome.localEvidenceDir, "humanoid-source-side-by-side-cagematch.json");
  await Promise.all([
    writeJson(publicReportPath, report),
    writeJson(localReportPath, report),
    writeJson(summaryPath, {
      schemaVersion: "openclinxr.humanoid-source-side-by-side-cagematch.v1",
      generatedAt: report.generatedAt,
      claimScope: "isolated_dual_humanoid_source_side_by_side_cagematch_no_promotion",
      reportClaimScope: report.claimScope,
      lane: options.lane,
      runId: options.runId,
      leftCandidateId: annyCompareCandidate.candidateId,
      rightCandidateId: mpfbCandidate.candidateId,
      leftSourceGlbPath: annyCompareCandidate.sourceGlbPath,
      rightSourceGlbPath: mpfbCandidate.sourceGlbPath,
      captureViews: options.captureViews,
      outputHome,
      notEvidenceFor: NOT_EVIDENCE_FOR,
    }),
  ]);

  const captureDir = path.join(outputHome.localEvidenceDir, "captures");
  await mkdir(captureDir, { recursive: true });
  const reportUrl = `/${path.relative("apps/arena/model-vetting-studio/public", publicReportPath).replaceAll(path.sep, "/")}`;
  const server = spawn("pnpm", ["--filter", "@openclinxr/model-vetting-studio", "dev:portless"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(options.port) },
    stdio: "pipe",
  });

  try {
    await waitForStudio(options.port, server);
    const browser = await chromium.launch({ headless: true });
    try {
      for (const captureView of options.captureViews) {
        const artifactPath = path.join(
          captureDir,
          `anny_comfy_v6_vs_mpfb_${captureView}_${options.runId}.png`,
        );
        const page = await browser.newPage({ viewport: { width: 1280, height: 1280 } });
        const url =
          `http://127.0.0.1:${options.port}/?dualCompare=true` +
          `&leftCandidateId=${encodeURIComponent(annyCompareCandidate.candidateId)}` +
          `&rightCandidateId=${encodeURIComponent(mpfbCandidate.candidateId)}` +
          `&captureView=${captureView}` +
          `&reportUrl=${encodeURIComponent(reportUrl)}`;
        await page.goto(url, { waitUntil: "networkidle" });
        await page.waitForFunction(() => {
          const evidence = window.__openClinXrModelVettingDualCaptureEvidence;
          return evidence?.captureClaim === "isolated_dual_humanoid_source_side_by_side_screenshot_only"
            && typeof evidence.leftMeshCount === "number"
            && evidence.leftMeshCount > 0
            && typeof evidence.rightMeshCount === "number"
            && evidence.rightMeshCount > 0;
        });
        await page.waitForTimeout(400);
        await page.screenshot({ path: artifactPath });
        await page.close();
      }
    } finally {
      await browser.close();
    }
  } finally {
    stopServer(server);
  }

  const reportPage = execSync(
    [
      "pnpm",
      "asset:cagematch:report-page",
      "--",
      "--template",
      "humanoid-source-side-by-side",
      "--run-id",
      options.runId,
      "--lane",
      options.lane,
      "--capture-dir",
      captureDir,
      "--capture-prefix",
      "anny_comfy_v6_vs_mpfb",
    ].join(" "),
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  process.stdout.write(
    `${JSON.stringify({ publicReportPath, localReportPath, summaryPath, reportUrl, reportPage: reportPage.trim() }, null, 2)}\n`,
  );
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    lane: "humanoid-source-side-by-side",
    runId: new Date().toISOString().slice(0, 10),
    annyReportPath:
      "apps/arena/model-vetting-studio/public/cagematch/anny-comfy-masked-skin/2026-06-07-comfy-face-inpaint-v6/model-vetting-report.json",
    annyCandidateId: "peds_patient_child_realvisxl_direct_skin_cagematch_realvisxl_direct_texture",
    mpfbGlbPath:
      "apps/arena/model-vetting-studio/public/cagematch/mpfb-peds-patient-comparator/2026-06-07-mpfb-peds-comparator/peds_patient_child_mpfb_comparator.glb",
    captureViews: ["front", "three_quarter"],
    port: 5186,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--lane") options.lane = requireNext(args, ++index, arg);
    else if (arg === "--run-id") options.runId = requireNext(args, ++index, arg);
    else if (arg === "--anny-report") options.annyReportPath = requireNext(args, ++index, arg);
    else if (arg === "--anny-candidate-id") options.annyCandidateId = requireNext(args, ++index, arg);
    else if (arg === "--mpfb-glb") options.mpfbGlbPath = requireNext(args, ++index, arg);
    else if (arg === "--capture-views") {
      options.captureViews = requireNext(args, ++index, arg).split(",").map((view) => view.trim()) as CliOptions["captureViews"];
    } else if (arg === "--port") options.port = Number(requireNext(args, ++index, arg));
    else throw new Error(`Unknown option ${arg}`);
  }
  return options;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function requireNext(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

async function waitForStudio(port: number, server: ChildProcessWithoutNullStreams): Promise<void> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return;
    } catch {
      // retry until vite is ready
    }
    if (server.exitCode !== null) throw new Error(`Model vetting studio exited before ready (${server.exitCode})`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for model vetting studio on port ${port}`);
}

function stopServer(server: ChildProcessWithoutNullStreams): void {
  if (server.exitCode === null) server.kill("SIGTERM");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}