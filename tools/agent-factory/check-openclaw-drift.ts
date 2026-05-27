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
  "PROJECT_COORDINATION_INDEX.md",
  "AUTONOMOUS_WORK_PLAN.md",
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
  "PROJECT_COORDINATION_INDEX.md": [
    "openclaw-runbook-2026-05-27.md",
    "docs:drift-check",
    "Required Per-Slice Record",
    "openclaw-tool-adapters-2026-05-27.md",
  ],
  "AUTONOMOUS_WORK_PLAN.md": [
    "openclaw-runbook-2026-05-27.md",
    "docs:drift-check",
  ],
  "docs/openclinxr/worker-backlog-and-validation-matrix.md": [
    "openclaw-runbook-2026-05-27.md",
    "docs:drift-check",
  ],
  "docs/openclinxr/openclaw-runbook-2026-05-27.md": [
    "protected OpenClaw control surface",
    "Required Per-Slice Record",
    "Canonical Automation Prompt",
    "pnpm docs:drift-check",
    "case-definition-driven WebXR encounter factory",
    "openclaw-tool-adapters-2026-05-27.md",
  ],
  "docs/openclinxr/openclaw-tool-adapters-2026-05-27.md": [
    "protected OpenClaw control surface",
    "OpenClaw is repo-native, not Codex-native",
    "Capability Fallback Matrix",
    "Universal OpenClaw Prompt",
    "Codex Adapter",
    "Claude Adapter",
    "Grok Adapter",
    "Cursor Adapter",
    "Drift Police Rule For All Hosts",
  ],
};

const ignoredDirectoryNames = new Set([".git", "node_modules", ".turbo", ".openclinxr-local", "tmp"]);
const generatedArtifactRoots = [
  ".agent-factory",
  ".openclinxr",
  "docs/openclinxr",
  "apps/ui-xr/public/xr-assets",
  "apps/ui-xr/dist/xr-assets",
] as const;
const generatedArtifactExtensions = new Set([".json", ".png", ".jpg", ".jpeg", ".webp", ".glb", ".gltf", ".bin", ".mp3", ".wav", ".ogg", ".txt"]);
const oneOffMarkdownNamePattern = /(?:checkpoint|status|progress|scratch|temporary|temp|handoff|prompt|continuation|notes?)(?:[-_].*)?\.md$/iu;
const allowedOneOffMarkdownPaths = new Set([
  "docs/openclinxr/worktree-cleanup-handoff-2026-05-27.md",
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

  for (const file of input.markdownFiles) {
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
    if (!registeredArtifacts.has(file)) {
      failures.push({ file, message: "generated artifact is not registered in the generated artifact registry; run pnpm docs:artifacts or ignore/delete the local artifact" });
    }
  }

  const scripts = input.packageJson?.scripts ?? {};
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
