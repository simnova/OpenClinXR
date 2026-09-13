import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  decideRegistryShrink,
  loadRegisteredEntries,
  parseAllowShrink,
  parseRegistryAppend,
  worktreeNote,
  type LoadedRegistryEntry,
  type PreservedRegistryEntry,
} from "./registry-shrink-guard.ts";

export type GeneratedArtifactAuthority =
  | "keep-current"
  | "keep-template"
  | "keep-evidence"
  | "keep-compatibility-input"
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

export type BuildGeneratedArtifactRegistryOptions = {
  cwd?: string;
  allowShrink?: boolean;
  /**
   * Test seam: skip filesystem walk and classify these paths instead.
   * Production CLI never sets this — only the shrink-refusal harness.
   */
  pathListOverride?: readonly string[];
  /** Capture stderr-style messages (tests); defaults to console.error. */
  logError?: (message: string) => void;
  /**
   * Register one existing path without a wholesale scan. Growth-only: the
   * shrink guard still refuses if the result would drop a registered path.
   */
  appendPath?: string;
  /** Override the production preserved list (tests). */
  preservedEntries?: readonly PreservedRegistryEntry[];
  /**
   * When true, previous registered paths whose files are gone stay in the
   * written registry until `--allow-shrink`. Present-but-unscannable paths
   * are NOT carried — those need an explicit preserved entry (clause 3).
   * Default: production CLI on (no pathListOverride, no allowShrink); tests off.
   */
  carryForwardMissingPrevious?: boolean;
};

/**
 * Paths the scan cannot reproduce. Each reason is path-specific; a single
 * sentence covering all of them is the failure mode this list exists to avoid.
 *
 * Not a scan-root widen: `public/generated-humanoids` would add 81 files (measured
 * 2026-09-13); `.webm` would add 4 videos under `docs/openclinxr/videos`; `tools/`
 * would sweep source; `.md` collides with the doc-authority registry.
 */
export const GENERATED_ARTIFACT_PRESERVED_ENTRIES: readonly PreservedRegistryEntry[] = [
  {
    path: "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb",
    reason:
      "Promoted MPFB2 runtime cast under public/generated-humanoids, which scannedRoots does not walk (only public/xr-assets).",
  },
  {
    path: "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.provenance.json",
    reason:
      "Lineage sidecar for the same promoted cast; same directory miss as the GLB, not a generic JSON keep.",
  },
  {
    path: "docs/openclinxr/model-vetting-captures/mpfb-peds-parent-aisha_motion-bind_body_motion_probe_2026-08-22.webm",
    reason:
      "Motion-bind body_motion probe already under scannedRoot docs/openclinxr; generatedExtensions omits .webm and must not gain it (other docs videos would batch-enter).",
  },
  {
    path: "tools/openclinxr/evidence/blender/render_seated_clip_frames.py",
    reason:
      "Hand-authored Blender producer for seated-clip frames, not generated output; tools/ is not a scan root.",
  },
  {
    path: "tools/openclinxr/evidence/humanoid-vetting/render-tex-candidates.py",
    reason:
      "EEVEE isolated texture-candidate renderer with a black-frame extrema guard — a different producer than the seated-clip script.",
  },
  {
    path: "tools/openclinxr/evidence/humanoid-vetting/tightjeans-2048-q85.jpg",
    reason:
      "Texture-resize candidate (JPEG q85 2048²) used as the visual comparison; .jpg is a generated extension but the file lives under tools/.",
  },
  {
    path: "tools/openclinxr/evidence/humanoid-vetting/tightjeans-rebake-2026-09-12.md",
    reason:
      "Dated tightjeans rebake evidence note; .md must not join generatedExtensions (doc-authority collision).",
  },
];

export type BuildGeneratedArtifactRegistryResult = {
  ok: boolean;
  exitCode: number;
  wrote: boolean;
  removedPaths: string[];
  stderr: string;
  outputJson: string;
  outputMd: string;
  total: number;
  counts: Record<string, number>;
};

const defaultRoot = process.cwd();
const outputJson = "docs/openclinxr/generated-artifact-registry-2026-05-27.json";
const outputMd = "docs/openclinxr/generated-artifact-registry-2026-05-27.md";
const REGISTRY_LABEL = "generated-artifact-registry";

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
  /evidence-index-2026-05-27/u,
  /encounter-.*peds-asthma-parent-anxiety-2026-05-28/u,
  /generated-ed-station-runtime-bundle-2026-05-28/u,
  /ui-xr-peds-materialization-gate-browser-smoke-2026-05-28/u,
  /peds-humanoid-materialization-handoff-2026-06-04/u,
  /iwsdk-.*2026-06-04/u,
  /godot-project-import-check-2026-06-04/u,
  /source.*2026/u,
  /provenance/u,
];
const compatibilityInputPatterns = [
  /encounter-asset-generation-queue-2026-05-23/u,
  /external-ai-asset-provider-preflight-2026-05-25/u,
  /garment-(fit-quality|promotion-gate|provider-gate|work-order).*2026-05-27/u,
  /humanoid-collision-probe(-active-viseme)?-2026-05-23/u,
  /humanoid-realism-gate-neutral-generated-human-animated-2026-05-23/u,
  /humanoid-source-bplus-scorecard-2026-05-27/u,
  /iwsdk-(first-slice|phase2-devtools)-preinstall-proposal/u,
  /iwsdk-npm-metadata-snapshot-2026-05-27/u,
  /materialize-clinical-idle-pose-(clip|clip-rerun|clip-v2|clip-v3|lower-arms)-2026-05-(23|27)/u,
  /mpfb-makehuman-garment-license-intake-2026-05-27/u,
  /ob-humanoid-source-variants-2026-05-27/u,
  /refine-humanoid-material-contrast-v[23]-2026-05-23/u,
  /runtime-realism-evidence-check-authored-idle-pose-required-2026-05-23/u,
  /strip-humanoid-primitive-proxies-2026-05-23/u,
  /ui-xr-ob-humanoid-source-closeup-comparator-2026-05-27/u,
];
const stalePatterns = [
  /quest-cdp-smoke-.*2026-05-04/u,
  /quest-cdp-smoke-.*2026-05-05/u,
  /iwsdk-sidecar-quest-cdp-smoke-check-2026-05-04/u,
  /adversarial-visual-qa-evidence-iwer-sidecar-2026-05-04/u,
  /local-provider-benchmark-2026-05-04/u,
  /visual-qa-evidence-2026-05-04/u,
];

function walk(dir: string, root: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (excludedDirectoryNames.has(name)) continue;
    const full = path.join(dir, name);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      walk(full, root, out);
      continue;
    }
    const ext = path.extname(name).toLowerCase();
    if (generatedExtensions.has(ext)) {
      out.push(path.relative(root, full).replaceAll(path.sep, "/"));
    }
  }
  return out;
}

function loadTrackedFiles(cwd: string): Set<string> {
  const gitIndex = path.join(cwd, ".git", "index");
  const gitFile = path.join(cwd, ".git");
  // Worktrees have `.git` as a file; still try ls-files when git works.
  if (!existsSync(gitIndex) && !existsSync(gitFile)) return new Set();
  try {
    const output = execFileSync("git", ["ls-files"], { cwd, encoding: "utf8" });
    return new Set(output.split("\n").filter(Boolean));
  } catch {
    return new Set();
  }
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

  if (compatibilityInputPatterns.some((pattern) => pattern.test(file))) {
    return { path: file, authority: "keep-compatibility-input", tracked, action: "review-before-change", rationale: "Historical artifact still referenced by tests, provenance, or validation scripts; keep only until that consumer is refactored to a fixture or current generated output." };
  }

  if (/template|checklist|policy|fixture/u.test(file)) {
    return { path: file, authority: "keep-template", tracked, action: "keep", rationale: "Reusable template/checklist/policy fixture." };
  }

  if (file.startsWith("docs/openclinxr/evidence/")) {
    return { path: file, authority: "keep-evidence", tracked, action: "keep", rationale: "Purpose-built evidence directory artifact; retain unless a later evidence compaction policy supersedes it." };
  }

  if (/2026-05-2[1-7]/u.test(file)) {
    return { path: file, authority: "prune-stale", tracked, action: tracked ? "review-before-change" : "delete-if-untracked", rationale: "Historical generated evidence is not retained by default; keep only protected templates, current evidence, or explicitly listed compatibility inputs." };
  }

  if (file.startsWith("docs/openclinxr/")) {
    return { path: file, authority: "keep-evidence", tracked, action: "keep", rationale: "Generated OpenClinXR evidence artifact; keep unless a later explicit stale pattern supersedes it." };
  }

  return { path: file, authority: "keep-current", tracked, action: "keep", rationale: "Generated-looking artifact retained by conservative default after explicit stale/cache/template rules." };
}

function countByAuthority(entries: readonly GeneratedArtifactEntry[]): Record<string, number> {
  return entries.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.authority] = (acc[entry.authority] ?? 0) + 1;
    return acc;
  }, {});
}

function asGeneratedEntry(raw: LoadedRegistryEntry): GeneratedArtifactEntry {
  const tracked = raw.tracked === true;
  const rationale = typeof raw.rationale === "string" ? raw.rationale : "Carried-forward registered path; kept until --allow-shrink.";
  const authority = raw.authority;
  const action = raw.action;
  const knownAuthority: GeneratedArtifactAuthority[] = [
    "keep-current",
    "keep-template",
    "keep-evidence",
    "keep-compatibility-input",
    "prune-stale",
    "ignore-local-cache",
    "needs-human-review",
  ];
  const knownAction: GeneratedArtifactEntry["action"][] = [
    "keep",
    "delete-if-untracked",
    "ignore",
    "review-before-change",
  ];
  return {
    path: raw.path,
    authority: knownAuthority.includes(authority as GeneratedArtifactAuthority)
      ? (authority as GeneratedArtifactAuthority)
      : "keep-evidence",
    tracked,
    action: knownAction.includes(action as GeneratedArtifactEntry["action"])
      ? (action as GeneratedArtifactEntry["action"])
      : "keep",
    rationale,
  };
}

function assembleEntries(input: {
  scanned: readonly string[];
  preservedEntries: readonly PreservedRegistryEntry[];
  previousEntries: readonly LoadedRegistryEntry[];
  trackedFiles: Set<string>;
  pathExists: (registeredPath: string) => boolean;
  carryForwardMissing: boolean;
}): GeneratedArtifactEntry[] {
  const byPath = new Map<string, GeneratedArtifactEntry>();
  for (const file of input.scanned) {
    byPath.set(file, classify(file, input.trackedFiles.has(file)));
  }
  for (const preserved of input.preservedEntries) {
    if (input.pathExists(preserved.path)) {
      const classified = classify(preserved.path, input.trackedFiles.has(preserved.path));
      byPath.set(preserved.path, { ...classified, action: "keep", rationale: preserved.reason });
      continue;
    }
    byPath.set(preserved.path, {
      path: preserved.path,
      authority: "keep-evidence",
      tracked: input.trackedFiles.has(preserved.path),
      action: "keep",
      rationale: preserved.reason,
    });
  }
  if (input.carryForwardMissing) {
    for (const previous of input.previousEntries) {
      if (byPath.has(previous.path)) continue;
      if (input.pathExists(previous.path)) continue;
      byPath.set(previous.path, asGeneratedEntry(previous));
    }
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function writeRegistryFiles(
  cwd: string,
  entries: readonly GeneratedArtifactEntry[],
  preservedEntries: readonly PreservedRegistryEntry[],
): Record<string, number> {
  const counts = countByAuthority(entries);
  const registry = {
    schemaVersion: "2026-05-27",
    claimBoundary:
      "generated artifact navigation registry for cleanup only; not product, clinical, Quest, scoring, or production readiness evidence",
    protectedRule:
      "Do not delete protected policy, templates, provenance, source records, runtime assets, or current representative evidence through this registry.",
    usageRule:
      "Autonomous cleanup agents must classify generated non-Markdown artifacts here before deleting, ignoring, or committing them.",
    preservedEntries,
    counts,
    entries,
  };
  mkdirSync(path.dirname(path.resolve(cwd, outputJson)), { recursive: true });
  writeFileSync(path.resolve(cwd, outputJson), `${JSON.stringify(registry, null, 2)}\n`);
  const byAuthority = [...entries].sort(
    (a, b) => a.authority.localeCompare(b.authority) || a.path.localeCompare(b.path),
  );
  const preservedMd = preservedEntries
    .map((entry) => `- \`${entry.path}\` — ${entry.reason}`)
    .join("\n");
  const md = `# Generated Artifact Registry\n\nDate: 2026-05-27\n\nThis generated registry complements the Markdown authority registry. It classifies non-Markdown artifacts so cleanup agents can prune stale evidence and local cache files without touching protected OpenClaw-style / OpenClaw-inspired control surfaces or product assets.\n\n## Protected Rule\n\nDo not delete protected policy, templates, provenance, source records, runtime assets, or current representative evidence through this registry.\n\n## Preserved entries\n\nThese paths stay registered across regeneration even though no scannedRoot+generatedExtensions pair reproduces them. Each has its own reason. Removing one means deleting it from this list, not passing \`--allow-shrink\`.\n\n${preservedMd || "- (none)"}\n\n## Counts\n\n${Object.entries(counts)
    .sort()
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n")}\n\n## Cleanup Actions\n\n${byAuthority
    .map((entry) => `- \`${entry.path}\` - ${entry.authority}; ${entry.action}; ${entry.rationale}`)
    .join("\n")}\n`;
  writeFileSync(path.resolve(cwd, outputMd), md);
  return counts;
}

export function buildGeneratedArtifactRegistry(
  options: BuildGeneratedArtifactRegistryOptions = {},
): BuildGeneratedArtifactRegistryResult {
  const cwd = options.cwd ?? defaultRoot;
  const allowShrink = options.allowShrink ?? parseAllowShrink();
  const logError = options.logError ?? ((message: string) => console.error(message));
  const appendPath = options.appendPath;
  const preservedEntries =
    options.preservedEntries ??
    (options.pathListOverride !== undefined ? [] : GENERATED_ARTIFACT_PRESERVED_ENTRIES);
  const carryForwardMissing =
    options.carryForwardMissingPrevious ??
    (options.pathListOverride === undefined && !allowShrink && appendPath === undefined);

  const stderrParts: string[] = [];
  const note = worktreeNote(cwd);
  if (note) {
    stderrParts.push(note);
    logError(note);
  }

  const trackedFiles = loadTrackedFiles(cwd);
  const jsonAbs = path.resolve(cwd, outputJson);
  const previousEntries = loadRegisteredEntries(jsonAbs);
  const previousPaths = previousEntries.map((entry) => entry.path);
  const pathExists = (registeredPath: string) => existsSync(path.resolve(cwd, registeredPath));

  if (appendPath !== undefined) {
    if (!pathExists(appendPath)) {
      const message = `[${REGISTRY_LABEL}] REFUSED: ${appendPath} does not exist on disk — cannot append a missing path.`;
      stderrParts.push(message);
      logError(message);
      return {
        ok: false,
        exitCode: 2,
        wrote: false,
        removedPaths: [],
        stderr: stderrParts.join("\n"),
        outputJson,
        outputMd,
        total: previousEntries.length,
        counts: {},
      };
    }
    const appended = classify(appendPath, trackedFiles.has(appendPath));
    const byPath = new Map(previousEntries.map((entry) => [entry.path, asGeneratedEntry(entry)]));
    byPath.set(appendPath, appended);
    const entries = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
    const nextPaths = entries.map((entry) => entry.path);
    const decision = decideRegistryShrink({
      registryLabel: REGISTRY_LABEL,
      previousPaths,
      nextPaths,
      allowShrink: false,
      pathExists,
    });
    if (decision.message) {
      stderrParts.push(decision.message);
      logError(decision.message);
    }
    if (!decision.allowWrite) {
      return {
        ok: false,
        exitCode: 2,
        wrote: false,
        removedPaths: decision.removedPaths,
        stderr: stderrParts.join("\n"),
        outputJson,
        outputMd,
        total: entries.length,
        counts: countByAuthority(entries),
      };
    }
    const counts = writeRegistryFiles(cwd, entries, preservedEntries);
    return {
      ok: true,
      exitCode: 0,
      wrote: true,
      removedPaths: decision.removedPaths,
      stderr: stderrParts.join("\n"),
      outputJson,
      outputMd,
      total: entries.length,
      counts,
    };
  }

  const scanned =
    options.pathListOverride !== undefined
      ? [...options.pathListOverride].sort()
      : scannedRoots.flatMap((scanRoot) => walk(path.resolve(cwd, scanRoot), cwd)).sort();
  const entries = assembleEntries({
    scanned,
    preservedEntries,
    previousEntries,
    trackedFiles,
    pathExists,
    carryForwardMissing,
  });
  const counts = countByAuthority(entries);
  const nextPaths = entries.map((entry) => entry.path);
  const decision = decideRegistryShrink({
    registryLabel: REGISTRY_LABEL,
    previousPaths,
    nextPaths,
    allowShrink,
    // #580: existence is judged against the tree being regenerated, not process cwd.
    pathExists,
  });

  if (decision.message) {
    stderrParts.push(decision.message);
    logError(decision.message);
  }

  if (!decision.allowWrite) {
    return {
      ok: false,
      exitCode: 2,
      wrote: false,
      removedPaths: decision.removedPaths,
      stderr: stderrParts.join("\n"),
      outputJson,
      outputMd,
      total: entries.length,
      counts,
    };
  }

  writeRegistryFiles(cwd, entries, preservedEntries);

  return {
    ok: true,
    exitCode: 0,
    wrote: true,
    removedPaths: decision.removedPaths,
    stderr: stderrParts.join("\n"),
    outputJson,
    outputMd,
    total: entries.length,
    counts,
  };
}

async function main(): Promise<void> {
  const result = buildGeneratedArtifactRegistry({
    allowShrink: parseAllowShrink(),
    appendPath: parseRegistryAppend(),
  });
  if (!result.ok) {
    process.exitCode = result.exitCode;
    return;
  }
  console.log(
    JSON.stringify(
      { outputJson: result.outputJson, outputMd: result.outputMd, total: result.total, counts: result.counts },
      null,
      2,
    ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
