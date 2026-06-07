import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { validateCagematchReportPage, type CagematchReportRegistry } from "../../../packages/openclinxr/arena/model-vetting/src/cagematch-report.js";
import { buildHumanoidSourceSideBySideReportPage } from "../factory/cagematch-report-pages.js";

type CliOptions = {
  template: "humanoid-source-side-by-side";
  runId: string;
  lane: string;
  captureDir?: string;
  capturePrefix: string;
};

const PUBLIC_REPORTS_ROOT = "apps/arena/model-vetting-studio/public/cagematch-reports";
const REGISTRY_PATH = `${PUBLIC_REPORTS_ROOT}/registry.json`;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const reportId = `${options.lane}-${options.runId}`.replaceAll("/", "-");
  const reportDir = path.join(PUBLIC_REPORTS_ROOT, reportId);
  await mkdir(reportDir, { recursive: true });

  const mediaUrlPaths = await copyCaptureMedia({
    captureDir: options.captureDir,
    capturePrefix: options.capturePrefix,
    runId: options.runId,
    reportDir,
    reportId,
  });

  const report = buildHumanoidSourceSideBySideReportPage({
    runId: options.runId,
    generatedAt,
    mediaUrlPaths,
  });
  report.reportId = reportId;

  const validation = validateCagematchReportPage(report);
  if (!validation.ok) throw new Error(`Invalid cagematch report page: ${validation.errors.join("; ")}`);

  const reportPath = path.join(reportDir, "report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const thumbnailUrlPath = mediaUrlPaths.find((item) => item.mediaId.includes("front"))?.urlPath;
  await upsertRegistry({
    reportId,
    lane: options.lane,
    runId: options.runId,
    title: report.title,
    family: report.family,
    reportUrlPath: `/cagematch-reports/${reportId}/report.json`,
    pageUrlQuery: `?cagematchReport=${reportId}`,
    thumbnailUrlPath,
    generatedAt,
  });

  process.stdout.write(
    `${JSON.stringify({ reportPath, reportId, pageUrl: `/?cagematchReport=${reportId}`, registryPath: REGISTRY_PATH }, null, 2)}\n`,
  );
}

async function copyCaptureMedia(input: {
  captureDir?: string;
  capturePrefix: string;
  runId: string;
  reportDir: string;
  reportId: string;
}): Promise<Array<{ mediaId: string; label: string; urlPath: string; caption: string }>> {
  const views = [
    { view: "front", label: "Front comparison", caption: "Side-by-side front capture: Anny Comfy masked-face pediatric patient (left) vs MPFB/MakeHuman pediatric comparator (right)." },
    { view: "three_quarter", label: "Three-quarter comparison", caption: "Side-by-side three-quarter capture for silhouette, clothing regions, and face read at an angle." },
  ];
  const results: Array<{ mediaId: string; label: string; urlPath: string; caption: string }> = [];
  for (const { view, label, caption } of views) {
    const fileName = `${input.capturePrefix}_${view}_${input.runId}.png`;
    const sourceCandidates = [
      input.captureDir ? path.join(input.captureDir, fileName) : null,
      path.join(".openclinxr/evidence/cagematch", input.capturePrefix.includes("anny") ? "humanoid-source-side-by-side" : "", input.runId, "captures", fileName),
      path.join(".openclinxr/evidence/cagematch/humanoid-source-side-by-side", input.runId, "captures", fileName),
    ].filter((candidate): candidate is string => Boolean(candidate));

    let copied = false;
    for (const sourcePath of sourceCandidates) {
      try {
        const destName = `${view}.png`;
        const destPath = path.join(input.reportDir, destName);
        await copyFile(sourcePath, destPath);
        results.push({
          mediaId: `${input.reportId}_${view}`,
          label,
          urlPath: `/cagematch-reports/${input.reportId}/${destName}`,
          caption,
        });
        copied = true;
        break;
      } catch {
        // try next candidate path
      }
    }
    if (!copied) {
      results.push({
        mediaId: `${input.reportId}_${view}`,
        label,
        urlPath: `/cagematch-reports/${input.reportId}/${view}.png`,
        caption: `${caption} (capture file missing locally — re-run pnpm asset:humanoid-source:side-by-side-cagematch)`,
      });
    }
  }
  return results;
}

async function upsertRegistry(
  entry: CagematchReportRegistry["reports"][number] & { generatedAt: string },
): Promise<void> {
  let registry: CagematchReportRegistry = {
    schemaVersion: "openclinxr.cagematch-report-registry.v1",
    generatedAt: entry.generatedAt,
    reports: [],
  };
  try {
    registry = JSON.parse(await readFile(REGISTRY_PATH, "utf8")) as CagematchReportRegistry;
  } catch {
    // fresh registry
  }
  registry.generatedAt = entry.generatedAt;
  registry.reports = registry.reports.filter((report) => report.reportId !== entry.reportId);
  registry.reports.unshift({
    reportId: entry.reportId,
    lane: entry.lane,
    runId: entry.runId,
    title: entry.title,
    family: entry.family,
    reportUrlPath: entry.reportUrlPath,
    pageUrlQuery: entry.pageUrlQuery,
    thumbnailUrlPath: entry.thumbnailUrlPath,
  });
  await mkdir(path.dirname(REGISTRY_PATH), { recursive: true });
  await writeFile(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    template: "humanoid-source-side-by-side",
    runId: new Date().toISOString().slice(0, 10),
    lane: "humanoid-source-side-by-side",
    capturePrefix: "anny_comfy_v6_vs_mpfb",
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--template") options.template = requireNext(args, ++index, arg) as CliOptions["template"];
    else if (arg === "--run-id") options.runId = requireNext(args, ++index, arg);
    else if (arg === "--lane") options.lane = requireNext(args, ++index, arg);
    else if (arg === "--capture-dir") options.captureDir = requireNext(args, ++index, arg);
    else if (arg === "--capture-prefix") options.capturePrefix = requireNext(args, ++index, arg);
    else throw new Error(`Unknown option ${arg}`);
  }
  if (options.template !== "humanoid-source-side-by-side") {
    throw new Error(`Unsupported template ${options.template}`);
  }
  return options;
}

function requireNext(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}