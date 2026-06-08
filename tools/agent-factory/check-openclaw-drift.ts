import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type OpenClawDriftInput = {
  files: Record<string, string | undefined>;
  markdownFiles: string[];
  generatedArtifactFiles: string[];
  docRegistry?: { entries?: Array<{ path?: string; authority?: string }> };
  artifactRegistry?: { entries?: Array<{ path?: string; authority?: string }> };
  packageJson?: { scripts?: Record<string, string> };
};

export type OpenClawDriftFailure = {
  file: string;
  message: string;
};

export type OpenClawDriftReport = {
  ok: boolean;
  checkedMarkdownCount: number;
  checkedGeneratedArtifactCount: number;
  failures: OpenClawDriftFailure[];
};

const root = process.cwd();

const requiredFiles = [
  "AGENTS.md",
  "PROJECT_STATUS.md",
  "docs/openclinxr/worker-backlog-and-validation-matrix.md",
  "docs/openclinxr/openclaw-runbook-2026-05-27.md",
  "docs/openclinxr/openclaw-tool-adapters-2026-05-27.md",
  "docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md",
  "docs/openclinxr/doc-authority-registry-2026-05-27.json",
  "docs/openclinxr/generated-artifact-registry-2026-05-27.json",
] as const;

const requiredMarkers: Record<string, string[]> = {
  "AGENTS.md": [
    "openclaw-runbook-2026-05-27.md",
    "docs:drift-check",
    "Required Per-Slice Record",
    "openclaw-tool-adapters-2026-05-27.md",
  ],
  "PROJECT_STATUS.md": [
    "openclaw-runbook-2026-05-27.md",
    "docs:drift-check",
    "Required Per-Slice Record",
    "openclaw-tool-adapters-2026-05-27.md",
  ],
  "docs/openclinxr/worker-backlog-and-validation-matrix.md": [
    "openclaw-runbook-2026-05-27.md",
    "docs:drift-check",
  ],
  "docs/openclinxr/openclaw-runbook-2026-05-27.md": [
    "protected OpenClaw-style",
    "OpenClaw-style execution pattern",
    "not an external OpenClaw runtime",
    "Required Per-Slice Record",
    "Canonical Automation Prompt",
    "pnpm openclaw:ready",
    "pnpm openclaw:preflight",
    "pnpm openclaw:post-slice",
    "pnpm openclaw:automation-prompt",
    "pnpm docs:drift-check",
    "case-definition-driven WebXR encounter factory",
    "openclaw-tool-adapters-2026-05-27.md",
  ],
  "docs/openclinxr/openclaw-tool-adapters-2026-05-27.md": [
    "protected OpenClaw-style",
    "OpenClaw-style / OpenClaw-inspired execution is repo-native",
    "Capability Fallback Matrix",
    "Universal OpenClaw-Style Prompt",
    "Codex Adapter",
    "Claude Adapter",
    "Grok Adapter",
    "Cursor Adapter",
    "Drift Police Rule For All Hosts",
  ],
};

const ignoredDirectoryNames = new Set([".git", "node_modules", ".turbo", ".openclinxr", ".openclinxr-local", "dist", "tmp", "openclaw"]);
const generatedArtifactRoots = [
  ".agent-factory",
  "docs/openclinxr",
  "apps/ui-xr/public/xr-assets",
] as const;
const generatedArtifactExtensions = new Set([".json", ".png", ".jpg", ".jpeg", ".webp", ".glb", ".gltf", ".bin", ".mp3", ".wav", ".ogg", ".txt"]);
const oneOffMarkdownNamePattern = /(?:checkpoint|status|progress|scratch|temporary|temp|handoff|prompt|continuation|notes?)(?:[-_].*)?\.md$/iu;
const allowedOneOffMarkdownPaths = new Set([
  "PROJECT_STATUS.md",
  "docs/openclinxr/openclaw-runbook-2026-05-27.md",
]);

export function buildOpenClawDriftReport(input: OpenClawDriftInput): OpenClawDriftReport {
  const failures: OpenClawDriftFailure[] = [];
  const registeredMarkdown = new Set((input.docRegistry?.entries ?? []).map((entry) => entry.path).filter((value): value is string => typeof value === "string"));
  const registeredArtifacts = new Set((input.artifactRegistry?.entries ?? []).map((entry) => entry.path).filter((value): value is string => typeof value === "string"));

  for (const file of requiredFiles) {
    if (typeof input.files[file] !== "string") {
      failures.push({ file, message: "required OpenClaw hardening file is missing" });
    }
  }

  for (const [file, markers] of Object.entries(requiredMarkers)) {
    const text = input.files[file] ?? "";
    for (const marker of markers) {
      if (!text.includes(marker)) {
        failures.push({ file, message: `missing OpenClaw drift marker: ${marker}` });
      }
    }
  }

  for (const file of ["PROJECT_COORDINATION_INDEX.md", "AUTONOMOUS_WORK_PLAN.md", "docs/openclinxr/worker-backlog-and-validation-matrix.md"]) {
    const currentSnapshot = sectionBefore(input.files[file] ?? "", "## Efficient Rehydration");
    if (/\d{4}-\d{2}-\d{2}\s+autonomy heartbeat/iu.test(currentSnapshot)) {
      failures.push({
        file,
        message: "current snapshot contains autonomy heartbeat/no-op verification ledger text; keep no-op runner/watchdog output local and pivot the snapshot to the next product slice",
      });
    }
  }

  for (const file of input.markdownFiles) {
    if (isGeneratedOutputPolicyIgnoredPath(file)) continue;
    if (!registeredMarkdown.has(file)) {
      failures.push({ file, message: "Markdown file is not registered in the doc authority registry; run pnpm docs:authority or remove the scattered artifact" });
    }
    if (oneOffMarkdownNamePattern.test(path.basename(file)) && !allowedOneOffMarkdownPaths.has(file)) {
      const entry = input.docRegistry?.entries?.find((candidate) => candidate.path === file);
      if (!entry || entry.authority === "archive-candidate" || entry.authority === "temporary") {
        failures.push({ file, message: "one-off status/checkpoint/prompt-style Markdown is not allowed unless converted into a canonical registry entry" });
      }
    }
  }

  for (const file of input.generatedArtifactFiles) {
    if (isGeneratedOutputPolicyIgnoredPath(file)) continue;
    if (!registeredArtifacts.has(file)) {
      failures.push({ file, message: "generated artifact is not registered in the generated artifact registry; run pnpm docs:artifacts or ignore/delete the local artifact" });
    }
  }

  const scripts = input.packageJson?.scripts ?? {};
  if (scripts["openclaw:preflight"] !== "pnpm openclaw:ready") {
    failures.push({ file: "package.json", message: "openclaw:preflight script must run the readiness gate" });
  }
  if (scripts["openclaw:post-slice"] !== "tsx tools/agent-factory/check-openclaw-operational-redundancy.ts --post-slice") {
    failures.push({ file: "package.json", message: "openclaw:post-slice script must run the operational redundancy checker" });
  }
  if (scripts["openclaw:automation-prompt"] !== "tsx tools/agent-factory/check-openclaw-operational-redundancy.ts --print-automation-prompt") {
    failures.push({ file: "package.json", message: "openclaw:automation-prompt script must print the canonical automation prompt" });
  }
  if (scripts["openclaw:ready"] !== "tsx tools/agent-factory/check-openclaw-readiness.ts") {
    failures.push({ file: "package.json", message: "openclaw:ready script must run the OpenClaw readiness checker" });
  }
  if (scripts["docs:drift-check"] !== "tsx tools/agent-factory/check-openclaw-drift.ts") {
    failures.push({ file: "package.json", message: "docs:drift-check script must run the OpenClaw drift checker" });
  }
  if (!scripts["agent:verify"]?.startsWith("pnpm agent:alignment && ")) {
    failures.push({ file: "package.json", message: "agent:verify must keep agent:alignment first" });
  }

  return {
    ok: failures.length === 0,
    checkedMarkdownCount: input.markdownFiles.length,
    checkedGeneratedArtifactCount: input.generatedArtifactFiles.length,
    failures,
  };
}

function sectionBefore(text: string, marker: string): string {
  const index = text.indexOf(marker);
  return index >= 0 ? text.slice(0, index) : text;
}

function isGeneratedOutputPolicyIgnoredPath(file: string): boolean {
  return file.startsWith(".openclinxr/")
    || file.includes("/dist/")
    || file.startsWith("docs/openclinxr/anny-skin-cagematch-mit-pbr-bake-")
    || file.startsWith("docs/openclinxr/model-vetting-captures/anny-skin-")
    || file.startsWith("docs/openclinxr/realvisxl-")
    || /^docs\/openclinxr\/anny-skin-(?:texture-cagematch-manifest|track-a-mit-pbr)/u.test(file)
    || /^docs\/openclinxr\/stablegen-blender-background-trial-/u.test(file);
}

function walkFiles(start: string, predicate: (file: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(start)) return out;
  for (const name of readdirSync(start)) {
    if (ignoredDirectoryNames.has(name)) continue;
    const full = path.join(start, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkFiles(full, predicate, out);
      continue;
    }
    const rel = path.relative(root, full).replaceAll(path.sep, "/");
    if (predicate(rel)) out.push(rel);
  }
  return out;
}

function loadJson<T>(file: string): T | undefined {
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function loadInputFromWorkspace(): OpenClawDriftInput {
  const files: Record<string, string | undefined> = {};
  for (const file of requiredFiles) {
    files[file] = existsSync(file) ? readFileSync(file, "utf8") : undefined;
  }

  const markdownFiles = walkFiles(root, (file) => /\.mdx?$/u.test(file)).sort();
  const generatedArtifactFiles = generatedArtifactRoots
    .flatMap((scanRoot) => walkFiles(path.resolve(root, scanRoot), (file) => generatedArtifactExtensions.has(path.extname(file).toLowerCase())))
    .sort();

  return {
    files,
    markdownFiles,
    generatedArtifactFiles,
    docRegistry: loadJson("docs/openclinxr/doc-authority-registry-2026-05-27.json"),
    artifactRegistry: loadJson("docs/openclinxr/generated-artifact-registry-2026-05-27.json"),
    packageJson: loadJson("package.json"),
  };
}

async function main(): Promise<void> {
  const report = buildOpenClawDriftReport(loadInputFromWorkspace());
  if (report.ok) {
    console.log(`Checked OpenClaw drift across ${report.checkedMarkdownCount} Markdown files and ${report.checkedGeneratedArtifactCount} generated artifacts.`);
    return;
  }
  for (const failure of report.failures) {
    console.error(`${failure.file}: ${failure.message}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
