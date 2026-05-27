import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export type GeneratedArtifactAuthority =
  | "keep-current"
  | "keep-template"
  | "keep-evidence"
  | "prune-stale"
  | "ignore-local-cache"
  | "needs-human-review";

export type GeneratedArtifactEntry = {
  path: string;
  authority: GeneratedArtifactAuthority;
  tracked: boolean;
  action: "keep" | "delete-if-untracked" | "ignore" | "review-before-change";
  rationale: string;
};

const root = process.cwd();
const outputJson = "docs/openclinxr/generated-artifact-registry-2026-05-27.json";
const outputMd = "docs/openclinxr/generated-artifact-registry-2026-05-27.md";

const scannedRoots = [
  ".agent-factory",
  ".openclinxr",
  "docs/openclinxr",
  "apps/ui-xr/public/xr-assets",
  "apps/ui-xr/dist/xr-assets",
] as const;

const generatedExtensions = new Set([
  ".json",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".glb",
  ".gltf",
  ".bin",
  ".mp3",
  ".wav",
  ".ogg",
  ".txt",
]);

const excludedDirectoryNames = new Set(["node_modules", ".git", ".turbo"]);
const templatePatterns = [/template/u, /LICENSE$/u, /PROVENANCE$/u, /source-record/u, /risk-record/u, /decision-record/u];
const currentEvidencePatterns = [
  /doc-authority-registry-2026-05-27/u,
  /generated-artifact-registry-2026-05-27/u,
  /full-app-(re)?smoke-2026-05-26/u,
  /ui-admin-route-smoke-2026-05-26/u,
  /ui-xr-.*2026-05-26/u,
  /garment-.*2026-05-27/u,
  /humanoid-.*2026-05-27/u,
  /body-measurements-.*2026-05-27/u,
  /blender-normal-refine-.*2026-05-27/u,
  /encounter-.*2026-05-26/u,
  /source.*2026/u,
  /provenance/u,
];
const stalePatterns = [
  /quest-cdp-smoke-.*2026-05-04/u,
  /quest-cdp-smoke-.*2026-05-05/u,
  /iwsdk-sidecar-quest-cdp-smoke-check-2026-05-04/u,
  /adversarial-visual-qa-evidence-iwer-sidecar-2026-05-04/u,
  /local-provider-benchmark-2026-05-04/u,
  /asset-production-readiness-benchmark-2026-05-06/u,
  /visual-qa-evidence-2026-05-04/u,
];

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (excludedDirectoryNames.has(name)) continue;
    const full = path.join(dir, name);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      walk(full, out);
      continue;
    }
    const ext = path.extname(name).toLowerCase();
    if (generatedExtensions.has(ext)) {
      out.push(path.relative(root, full).replaceAll(path.sep, "/"));
    }
  }
  return out;
}

function loadTrackedFiles(): Set<string> {
  const gitIndex = path.join(root, ".git", "index");
  if (!existsSync(gitIndex)) return new Set();
  const output = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
  return new Set(output.split("\n").filter(Boolean));
}

function classify(file: string, tracked: boolean): GeneratedArtifactEntry {
  const basename = path.basename(file);

  if (file.startsWith(".openclinxr/")) {
    return { path: file, authority: "ignore-local-cache", tracked, action: "ignore", rationale: "Local runtime/cache artifact; should not be committed or used as durable evidence." };
  }

  if (file.startsWith(".agent-factory/")) {
    const authority = tracked ? "keep-evidence" : "ignore-local-cache";
    return { path: file, authority, tracked, action: tracked ? "keep" : "delete-if-untracked", rationale: tracked ? "Tracked agent-factory evidence output; preserve unless a focused evidence policy replaces it." : "Untracked transient agent-factory check output; safe to delete or ignore." };
  }

  if (templatePatterns.some((pattern) => pattern.test(file) || pattern.test(basename))) {
    return { path: file, authority: "keep-template", tracked, action: "keep", rationale: "Template/license/provenance/source artifact; never prune as generated clutter." };
  }

  if (file.includes("/xr-assets/") || /\.(glb|gltf|bin)$/u.test(file)) {
    return { path: file, authority: "keep-current", tracked, action: "keep", rationale: "Runtime asset/provenance material; preserve for product and evidence continuity." };
  }

  if (stalePatterns.some((pattern) => pattern.test(file)) && !currentEvidencePatterns.some((pattern) => pattern.test(file))) {
    return { path: file, authority: "prune-stale", tracked, action: tracked ? "review-before-change" : "delete-if-untracked", rationale: "Superseded early spike/evidence artifact with newer representative evidence available." };
  }

  if (file.startsWith("docs/openclinxr/screenshots/")) {
    const authority = /2026-05-27|2026-05-26/u.test(file) ? "keep-evidence" : "prune-stale";
    return { path: file, authority, tracked, action: authority === "prune-stale" ? (tracked ? "review-before-change" : "delete-if-untracked") : "keep", rationale: authority === "keep-evidence" ? "Recent visual evidence for realism or full-app review." : "Older screenshot evidence superseded by newer contact sheets and scenario captures." };
  }

  if (currentEvidencePatterns.some((pattern) => pattern.test(file))) {
    return { path: file, authority: "keep-evidence", tracked, action: "keep", rationale: "Current representative evidence for cleanup, runtime, garment, humanoid, or encounter-factory lanes." };
  }

  if (/template|checklist|policy|fixture/u.test(file)) {
    return { path: file, authority: "keep-template", tracked, action: "keep", rationale: "Reusable template/checklist/policy fixture." };
  }

  if (file.startsWith("docs/openclinxr/evidence/")) {
    return { path: file, authority: "keep-evidence", tracked, action: "keep", rationale: "Purpose-built evidence directory artifact; retain unless a later evidence compaction policy supersedes it." };
  }

  if (/2026-05-2[1-7]/u.test(file)) {
    return { path: file, authority: "keep-evidence", tracked, action: "keep", rationale: "Recent generated evidence from active encounter-factory, garment, humanoid, or runtime cleanup work." };
  }

  if (file.startsWith("docs/openclinxr/")) {
    return { path: file, authority: "keep-evidence", tracked, action: "keep", rationale: "Generated OpenClinXR evidence artifact; keep unless a later explicit stale pattern supersedes it." };
  }

  return { path: file, authority: "keep-current", tracked, action: "keep", rationale: "Generated-looking artifact retained by conservative default after explicit stale/cache/template rules." };
}

const trackedFiles = loadTrackedFiles();
const files = scannedRoots.flatMap((scanRoot) => walk(path.resolve(root, scanRoot))).sort();
const entries = files.map((file) => classify(file, trackedFiles.has(file)));
const counts = entries.reduce<Record<string, number>>((acc, entry) => {
  acc[entry.authority] = (acc[entry.authority] ?? 0) + 1;
  return acc;
}, {});
const registry = {
  schemaVersion: "2026-05-27",
  claimBoundary: "generated artifact navigation registry for cleanup only; not product, clinical, Quest, scoring, or production readiness evidence",
  protectedRule: "Do not delete protected policy, templates, provenance, source records, runtime assets, or current representative evidence through this registry.",
  usageRule: "Autonomous cleanup agents must classify generated non-Markdown artifacts here before deleting, ignoring, or committing them.",
  counts,
  entries,
};

mkdirSync(path.dirname(path.resolve(root, outputJson)), { recursive: true });
writeFileSync(path.resolve(root, outputJson), `${JSON.stringify(registry, null, 2)}\n`);

const byAuthority = [...entries].sort((a, b) => a.authority.localeCompare(b.authority) || a.path.localeCompare(b.path));
const md = `# Generated Artifact Registry\n\nDate: 2026-05-27\n\nThis generated registry complements the Markdown authority registry. It classifies non-Markdown artifacts so cleanup agents can prune stale evidence and local cache files without touching protected OpenClaw control surfaces or product assets.\n\n## Protected Rule\n\nDo not delete protected policy, templates, provenance, source records, runtime assets, or current representative evidence through this registry.\n\n## Counts\n\n${Object.entries(counts).sort().map(([key, value]) => `- ${key}: ${value}`).join("\n")}\n\n## Cleanup Actions\n\n${byAuthority.map((entry) => `- \`${entry.path}\` - ${entry.authority}; ${entry.action}; ${entry.rationale}`).join("\n")}\n`;
writeFileSync(path.resolve(root, outputMd), md);
console.log(JSON.stringify({ outputJson, outputMd, total: entries.length, counts }, null, 2));
