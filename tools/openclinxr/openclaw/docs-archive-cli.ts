/**
 * Docs warehouse archive CLI — freeze cold content into a wiki-style archive.
 *
 * Commands:
 *   plan   — dry list of freeze candidates (--set agent-ops|cruft|all)
 *   freeze — move candidates to docs/_archive, leave stubs, write manifest, rebuild wiki
 *   status — hot living vs cold warehouse counts
 *   wiki   — rebuild docs/_archive wiki index from manifests (no freeze)
 *
 * Cold layout (wiki-capable):
 *   docs/_archive/README.md          — wiki home (archivist entry)
 *   docs/_archive/wiki/index.md      — topic map
 *   docs/_archive/wiki/topics/*.md   — multi-file topic pages
 *   docs/_archive/<area>/<month>/    — body storage + ARCHIVE-MANIFEST.json
 *
 * See docs/agent-ops/DOC-WAREHOUSE.md
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { gitEnvWithoutInheritedRepoVars } from "./worktree-base-freshness.js";

export const DOCS_ARCHIVE_SCHEMA = "openclinxr.docs-archive-manifest.v1" as const;

export type ArchiveFileEntry = {
  source: string;
  basename: string;
  warehouse: string;
  successor: string;
  reason: string;
  /** Optional wiki topic id for multi-file index */
  topic?: string;
};

export type ArchiveManifest = {
  schemaVersion: typeof DOCS_ARCHIVE_SCHEMA;
  batchId: string;
  archivedAt: string;
  warehouseDir: string;
  dryRun: boolean;
  files: ArchiveFileEntry[];
};

export type FreezeSetId = "agent-ops" | "cruft" | "all";

/** Living agent-ops basenames that must never be freeze-moved. */
export const NEVER_ARCHIVE_BASENAMES = new Set([
  "PATH-SCOPE.md",
  "CEO-VOICE.md",
  "COMPOSITION-ROOTS.md",
  "DOC-WAREHOUSE.md",
  "MAIN-SESSION-ORCHESTRATOR-ONLY.md",
  "WORKTREE-PROMOTE.md",
  "RACI.md",
  "REVIEW-CADENCE.md",
  "CAPABILITY-EVOLUTION.md",
  "REVISION-INDEX.md",
  "DOC-HYGIENE-CADENCE.md",
  "TEMPORAL-DECISIONS.md",
  "temporal-decisions-catalog.json",
  "temporal-review-queue.md",
  "TASK-COST-ROLLUP.md",
  "OPENCLAW-EPIC-CONTINUITY.md",
  "README.md",
]);

/** Paths that must never enter freeze catalogs (skills, active ops, protected). */
export const NEVER_ARCHIVE_PATHS = new Set([
  "AGENTS.md",
  "PROJECT_STATUS.md",
  "README.md",
  "docs/TOOLING.md",
  ".openclinxr/README.md",
  "plugins/openclinxr-openclaw-style/README.md",
  "plugins/openclinxr-openclaw-style/skills/openclinxr-openclaw-style/SKILL.md",
]);

const DEFAULT_BATCH = "context-opt-2026-08-02";
const DEFAULT_SOURCE_PREFIX = "docs/agent-ops/";
/** Any dated revision under agent-ops (YYYY-MM-DD-*.md). */
const DATED_AGENT_OPS_FILE = /^\d{4}-\d{2}-\d{2}-.+\.md$/u;

/**
 * Explicit multi-area cruft freeze catalog (audit 2026-08-02).
 * Bodies move to wiki-capable area folders; stubs remain at source.
 */
export const CRUFT_FREEZE_CATALOG: ReadonlyArray<{
  source: string;
  warehouseDir: string;
  successor: string;
  reason: string;
  topic: string;
}> = [
  {
    source: "AUTONOMOUS_WORK_PLAN.md",
    warehouseDir: "docs/_archive/coordination/2026-08",
    successor: "PROJECT_STATUS.md",
    reason: "historical audit ledger; not canonical state",
    topic: "coordination-ledgers",
  },
  {
    source: "PROJECT_COORDINATION_INDEX.md",
    warehouseDir: "docs/_archive/coordination/2026-08",
    successor: "PROJECT_STATUS.md",
    reason: "historical audit ledger; not canonical state",
    topic: "coordination-ledgers",
  },
  {
    source: "docs/openclinxr/anny-character-asset-pipeline-implementation-2026-06-03.md",
    warehouseDir: "docs/_archive/openclinxr/2026-06",
    successor: "docs/openclinxr/asset-generation-pipeline.md",
    reason: "authority archive-candidate; living pipeline doc supersedes",
    topic: "openclinxr-product-docs",
  },
  {
    source: "docs/openclinxr/dependency-hygiene-and-e18e-policy.md",
    warehouseDir: "docs/_archive/openclinxr/2026-06",
    successor: "docs/TOOLING.md",
    reason: "authority archive-candidate; tooling SSOT supersedes",
    topic: "openclinxr-product-docs",
  },
  {
    source: "docs/openclinxr/generated-output-storage-policy-2026-06-06.md",
    warehouseDir: "docs/_archive/openclinxr/2026-06",
    successor: "docs/openclinxr/generated-artifact-registry-2026-05-27.md",
    reason: "authority archive-candidate; registry is living catalog",
    topic: "openclinxr-product-docs",
  },
  {
    source: "docs/openclinxr/gltf-transform-replacement-decision-2026-05-27.md",
    warehouseDir: "docs/_archive/openclinxr/2026-05",
    successor: "docs/madr/",
    reason: "authority archive-candidate; decision folded into MADR trail",
    topic: "openclinxr-product-docs",
  },
  {
    source: "docs/openclinxr/turbo-remote-cache-setup.md",
    warehouseDir: "docs/_archive/openclinxr/2026-06",
    successor: "docs/TOOLING.md",
    reason: "authority archive-candidate; optional turbo setup note",
    topic: "openclinxr-product-docs",
  },
  {
    source: "docs/openclinxr/typescript-strictness-gap-matrix-2026-05-27.md",
    warehouseDir: "docs/_archive/openclinxr/2026-05",
    successor: "docs/openclinxr/code-implementation-plan.md",
    reason: "authority archive-candidate; gap matrix was one-shot audit",
    topic: "openclinxr-product-docs",
  },
  {
    source: "docs/openclinxr/research-brief-step2cs-llm-vsp.md",
    warehouseDir: "docs/_archive/openclinxr/2026-05",
    successor: "AGENTS.md",
    reason: "historical-synthesis research brief; mission lives in AGENTS/product goal",
    topic: "openclinxr-product-docs",
  },
  // Agent-factory iteration-0009 (historical synthesis)
  {
    source: "iterations/iteration-0009/00-brief.md",
    warehouseDir: "docs/_archive/iterations/0009",
    successor: "docs/agent-factory/operating-loop.md",
    reason: "completed agent-factory iteration; cold historical synthesis",
    topic: "agent-factory-iterations",
  },
  {
    source: "iterations/iteration-0009/01-core-plan.md",
    warehouseDir: "docs/_archive/iterations/0009",
    successor: "docs/agent-factory/operating-loop.md",
    reason: "completed agent-factory iteration; cold historical synthesis",
    topic: "agent-factory-iterations",
  },
  {
    source: "iterations/iteration-0009/03-adversarial-counterplan.md",
    warehouseDir: "docs/_archive/iterations/0009",
    successor: "docs/agent-factory/operating-loop.md",
    reason: "completed agent-factory iteration; cold historical synthesis",
    topic: "agent-factory-iterations",
  },
  {
    source: "iterations/iteration-0009/05-core-revision.md",
    warehouseDir: "docs/_archive/iterations/0009",
    successor: "docs/agent-factory/operating-loop.md",
    reason: "completed agent-factory iteration; cold historical synthesis",
    topic: "agent-factory-iterations",
  },
  {
    source: "iterations/iteration-0009/06-leadership-review.md",
    warehouseDir: "docs/_archive/iterations/0009",
    successor: "docs/agent-factory/leadership-gates.md",
    reason: "completed agent-factory iteration; cold historical synthesis",
    topic: "agent-factory-iterations",
  },
  {
    source: "iterations/iteration-0009/07-final-synthesis.md",
    warehouseDir: "docs/_archive/iterations/0009",
    successor: "docs/agent-factory/operating-loop.md",
    reason: "completed agent-factory iteration; cold historical synthesis",
    topic: "agent-factory-iterations",
  },
  {
    source: "iterations/iteration-0009/08-memory-update-log.md",
    warehouseDir: "docs/_archive/iterations/0009",
    successor: "docs/agent-factory/operating-loop.md",
    reason: "completed agent-factory iteration; cold historical synthesis",
    topic: "agent-factory-iterations",
  },
  {
    source: "iterations/iteration-0009/leadership-packet.md",
    warehouseDir: "docs/_archive/iterations/0009",
    successor: "docs/agent-factory/leadership-gates.md",
    reason: "completed agent-factory iteration; cold historical synthesis",
    topic: "agent-factory-iterations",
  },
];

export const WIKI_TOPIC_TITLES: Record<string, string> = {
  "context-optimization": "Context optimization (path-scope / Waves A–C)",
  "coordination-ledgers": "Historical coordination ledgers",
  "openclinxr-product-docs": "OpenClinXR product/process docs (cold)",
  "agent-factory-iterations": "Agent-factory iterations",
  "agent-ops-revisions": "Agent-ops dated revision records",
};

export function resolveSuccessor(basename: string): string {
  if (basename.includes("ceo-bod-voice")) return "docs/agent-ops/CEO-VOICE.md";
  if (basename.includes("roster-review")) return "docs/agent-ops/REVIEW-CADENCE.md";
  if (basename.includes("docs-warehouse") || basename.includes("doc-warehouse")) {
    return "docs/agent-ops/DOC-WAREHOUSE.md";
  }
  if (basename.includes("path-scope")) return "docs/agent-ops/PATH-SCOPE.md";
  if (basename.includes("context-opt-wave-c") || basename.includes("worktree")) {
    return "docs/agent-ops/PATH-SCOPE.md (+ COMPOSITION-ROOTS.md / WORKTREE-PROMOTE.md)";
  }
  if (basename.includes("context-opt")) {
    return "docs/agent-ops/PATH-SCOPE.md";
  }
  return "docs/agent-ops/PATH-SCOPE.md";
}

export function isFreezeCandidateBasename(basename: string): boolean {
  if (NEVER_ARCHIVE_BASENAMES.has(basename)) return false;
  return DATED_AGENT_OPS_FILE.test(basename);
}

export function listFreezeCandidates(agentOpsDir: string): string[] {
  if (!existsSync(agentOpsDir)) return [];
  return readdirSync(agentOpsDir)
    .filter((name) => isFreezeCandidateBasename(name))
    .filter((name) => {
      const full = path.join(agentOpsDir, name);
      try {
        return statSync(full).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

export function planAgentOpsArchiveBatch(options: {
  repoRoot: string;
  batchId: string;
  warehouseMonth?: string;
}): { candidates: ArchiveFileEntry[]; warehouseDir: string } {
  const month =
    options.warehouseMonth ??
    (options.batchId.match(/(\d{4}-\d{2})/)?.[1] ?? "2026-08");
  const warehouseDir = `docs/_archive/agent-ops/${month}`;
  const agentOpsAbs = path.join(options.repoRoot, "docs/agent-ops");
  const basenames = listFreezeCandidates(agentOpsAbs);
  const candidates: ArchiveFileEntry[] = basenames.map((basename) => {
    const source = `${DEFAULT_SOURCE_PREFIX}${basename}`;
    const warehouse = `${warehouseDir}/${basename}`;
    return {
      source,
      basename,
      warehouse,
      successor: resolveSuccessor(basename),
      reason: "dated revision freeze; living SSOT supersedes",
      topic: "agent-ops-revisions",
    };
  });
  return { candidates, warehouseDir };
}

/** @deprecated alias — use planAgentOpsArchiveBatch */
export function planArchiveBatch(options: {
  repoRoot: string;
  batchId: string;
  warehouseMonth?: string;
}): { candidates: ArchiveFileEntry[]; warehouseDir: string } {
  return planAgentOpsArchiveBatch(options);
}

export function planCruftArchiveBatch(options: {
  repoRoot: string;
  batchId?: string;
}): { candidates: ArchiveFileEntry[]; warehouseDirs: string[]; batchId: string } {
  const batchId = options.batchId ?? "cruft-audit-2026-08-02";
  const candidates: ArchiveFileEntry[] = [];
  const warehouseDirs = new Set<string>();

  for (const row of CRUFT_FREEZE_CATALOG) {
    if (NEVER_ARCHIVE_PATHS.has(row.source)) continue;
    const basename = path.basename(row.source);
    const warehouse = `${row.warehouseDir}/${basename}`;
    warehouseDirs.add(row.warehouseDir);
    candidates.push({
      source: row.source,
      basename,
      warehouse,
      successor: row.successor,
      reason: row.reason,
      topic: row.topic,
    });
  }

  return {
    candidates: candidates.sort((a, b) => a.source.localeCompare(b.source)),
    warehouseDirs: [...warehouseDirs].sort(),
    batchId,
  };
}

export function planFreezeSet(options: {
  repoRoot: string;
  set: FreezeSetId;
  batchId?: string;
}): { candidates: ArchiveFileEntry[]; batchId: string; set: FreezeSetId } {
  if (options.set === "agent-ops") {
    const batchId = options.batchId ?? DEFAULT_BATCH;
    const { candidates } = planAgentOpsArchiveBatch({
      repoRoot: options.repoRoot,
      batchId,
    });
    return { candidates, batchId, set: options.set };
  }
  if (options.set === "cruft") {
    const planned = planCruftArchiveBatch({
      repoRoot: options.repoRoot,
      batchId: options.batchId ?? "cruft-audit-2026-08-02",
    });
    return { candidates: planned.candidates, batchId: planned.batchId, set: options.set };
  }
  // all
  const agent = planAgentOpsArchiveBatch({
    repoRoot: options.repoRoot,
    batchId: options.batchId ?? DEFAULT_BATCH,
  });
  const cruft = planCruftArchiveBatch({
    repoRoot: options.repoRoot,
    batchId: options.batchId ?? "cruft-audit-2026-08-02",
  });
  const bySource = new Map<string, ArchiveFileEntry>();
  for (const c of [...agent.candidates, ...cruft.candidates]) bySource.set(c.source, c);
  return {
    candidates: [...bySource.values()].sort((a, b) => a.source.localeCompare(b.source)),
    batchId: options.batchId ?? "warehouse-all-2026-08-02",
    set: "all",
  };
}

export function buildArchiveStub(entry: ArchiveFileEntry, batchId: string): string {
  return [
    `# ARCHIVED — ${entry.basename}`,
    ``,
    `**Status:** archived (docs warehouse cold tier)`,
    `**Warehouse path:** \`${entry.warehouse}\``,
    `**Successor SSOT:** \`${entry.successor}\``,
    `**Batch:** \`${batchId}\``,
    entry.topic ? `**Wiki topic:** \`docs/_archive/wiki/topics/${entry.topic}.md\`` : null,
    `**See:** \`docs/_archive/README.md\`, \`docs/agent-ops/DOC-WAREHOUSE.md\`, \`docs/agent-ops/REVISION-INDEX.md\``,
    ``,
    `Do not treat this stub as policy. Follow the successor living SSOT.`,
    ``,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export function buildManifest(options: {
  batchId: string;
  warehouseDir: string;
  files: ArchiveFileEntry[];
  dryRun: boolean;
  archivedAt?: string;
}): ArchiveManifest {
  return {
    schemaVersion: DOCS_ARCHIVE_SCHEMA,
    batchId: options.batchId,
    archivedAt: options.archivedAt ?? new Date().toISOString(),
    warehouseDir: options.warehouseDir,
    dryRun: options.dryRun,
    files: options.files,
  };
}

function tryGitMv(repoRoot: string, fromRel: string, toRel: string): boolean {
  try {
    execFileSync("git", ["mv", "-f", fromRel, toRel], {
      cwd: repoRoot,
      stdio: "pipe",
      env: gitEnvWithoutInheritedRepoVars(),
    });
    return true;
  } catch {
    return false;
  }
}

export function isArchiveStubBody(body: string): boolean {
  return body.startsWith("# ARCHIVED") && body.includes("docs warehouse cold tier");
}

/**
 * Freeze an explicit list of entries (multi-area). Groups manifests by warehouseDir.
 */
export function freezeExplicitEntries(options: {
  repoRoot: string;
  batchId: string;
  candidates: ArchiveFileEntry[];
  dryRun: boolean;
  rebuildWiki?: boolean;
}): {
  manifest: ArchiveManifest;
  manifestsByDir: Record<string, ArchiveManifest>;
  moved: string[];
  skipped: Array<{ path: string; reason: string }>;
  dryRun: boolean;
} {
  const moved: string[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const applied: ArchiveFileEntry[] = [];
  const byWarehouse = new Map<string, ArchiveFileEntry[]>();

  for (const entry of options.candidates) {
    if (NEVER_ARCHIVE_PATHS.has(entry.source)) {
      skipped.push({ path: entry.source, reason: "never-archive path" });
      continue;
    }
    const sourceAbs = path.join(options.repoRoot, entry.source);
    const destAbs = path.join(options.repoRoot, entry.warehouse);
    if (!existsSync(sourceAbs)) {
      skipped.push({ path: entry.source, reason: "source missing" });
      continue;
    }
    let body: string;
    try {
      body = readFileSync(sourceAbs, "utf8");
    } catch {
      skipped.push({ path: entry.source, reason: "unreadable" });
      continue;
    }
    if (isArchiveStubBody(body)) {
      skipped.push({ path: entry.source, reason: "already stubbed" });
      continue;
    }
    if (existsSync(destAbs) && !options.dryRun) {
      skipped.push({ path: entry.source, reason: "warehouse target exists" });
      continue;
    }

    if (!options.dryRun) {
      mkdirSync(path.dirname(destAbs), { recursive: true });
      const gitOk = tryGitMv(options.repoRoot, entry.source, entry.warehouse);
      if (!gitOk) {
        copyFileSync(sourceAbs, destAbs);
      }
      writeFileSync(sourceAbs, buildArchiveStub(entry, options.batchId), "utf8");
      if (!existsSync(destAbs)) {
        writeFileSync(destAbs, body, "utf8");
      }
      moved.push(entry.source);
      applied.push(entry);
      const dir = path.dirname(entry.warehouse).replaceAll(path.sep, "/");
      const list = byWarehouse.get(dir) ?? [];
      list.push(entry);
      byWarehouse.set(dir, list);
    } else {
      moved.push(entry.source);
      applied.push(entry);
      const dir = path.dirname(entry.warehouse).replaceAll(path.sep, "/");
      const list = byWarehouse.get(dir) ?? [];
      list.push(entry);
      byWarehouse.set(dir, list);
    }
  }

  const manifestsByDir: Record<string, ArchiveManifest> = {};
  for (const [warehouseDir, files] of byWarehouse) {
    const manifest = buildManifest({
      batchId: options.batchId,
      warehouseDir,
      files,
      dryRun: options.dryRun,
    });
    manifestsByDir[warehouseDir] = manifest;
    if (!options.dryRun && files.length > 0) {
      const warehouseAbs = path.join(options.repoRoot, warehouseDir);
      mkdirSync(warehouseAbs, { recursive: true });
      const manifestPath = path.join(warehouseAbs, "ARCHIVE-MANIFEST.json");
      let merged = manifest;
      if (existsSync(manifestPath)) {
        try {
          const prev = JSON.parse(readFileSync(manifestPath, "utf8")) as ArchiveManifest;
          const bySource = new Map<string, ArchiveFileEntry>();
          for (const f of prev.files ?? []) bySource.set(f.source, f);
          for (const f of manifest.files) bySource.set(f.source, f);
          merged = {
            ...manifest,
            files: [...bySource.values()].sort((a, b) => a.source.localeCompare(b.source)),
          };
        } catch {
          merged = manifest;
        }
      }
      writeFileSync(manifestPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
      manifestsByDir[warehouseDir] = merged;
    }
  }

  // Primary manifest = first warehouse dir (compat)
  const firstDir = Object.keys(manifestsByDir).sort()[0] ?? "docs/_archive";
  const primary =
    manifestsByDir[firstDir] ??
    buildManifest({
      batchId: options.batchId,
      warehouseDir: firstDir,
      files: applied,
      dryRun: options.dryRun,
    });

  if (!options.dryRun && (options.rebuildWiki ?? true) && applied.length > 0) {
    rebuildArchiveWiki(options.repoRoot);
  }

  return {
    manifest: primary,
    manifestsByDir,
    moved,
    skipped,
    dryRun: options.dryRun,
  };
}

export function freezeArchiveBatch(options: {
  repoRoot: string;
  batchId: string;
  dryRun: boolean;
  warehouseMonth?: string;
  set?: FreezeSetId;
}): {
  manifest: ArchiveManifest;
  moved: string[];
  skipped: Array<{ path: string; reason: string }>;
  dryRun: boolean;
  manifestsByDir?: Record<string, ArchiveManifest>;
} {
  const set = options.set ?? "agent-ops";
  const planned = planFreezeSet({
    repoRoot: options.repoRoot,
    set,
    batchId: options.batchId,
  });
  const result = freezeExplicitEntries({
    repoRoot: options.repoRoot,
    batchId: planned.batchId,
    candidates: planned.candidates,
    dryRun: options.dryRun,
    rebuildWiki: true,
  });
  return {
    manifest: result.manifest,
    moved: result.moved,
    skipped: result.skipped,
    dryRun: result.dryRun,
    manifestsByDir: result.manifestsByDir,
  };
}

/** Walk all ARCHIVE-MANIFEST.json under docs/_archive and rebuild wiki pages. */
export function rebuildArchiveWiki(repoRoot: string): {
  topics: string[];
  filesIndexed: number;
  paths: string[];
} {
  const archiveRoot = path.join(repoRoot, "docs/_archive");
  mkdirSync(path.join(archiveRoot, "wiki/topics"), { recursive: true });

  type Indexed = ArchiveFileEntry & { batchId: string; warehouseDir: string };
  const all: Indexed[] = [];

  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (name === "ARCHIVE-MANIFEST.json") {
        try {
          const m = JSON.parse(readFileSync(full, "utf8")) as ArchiveManifest;
          for (const f of m.files ?? []) {
            all.push({
              ...f,
              batchId: m.batchId,
              warehouseDir: m.warehouseDir,
              topic: f.topic ?? inferTopicFromWarehouse(f.warehouse),
            });
          }
        } catch {
          // skip bad manifest
        }
      }
    }
  };
  walk(archiveRoot);

  const byTopic = new Map<string, Indexed[]>();
  for (const f of all) {
    const topic = f.topic ?? "misc";
    const list = byTopic.get(topic) ?? [];
    list.push(f);
    byTopic.set(topic, list);
  }

  const topicIds = [...byTopic.keys()].sort();
  const written: string[] = [];

  for (const topicId of topicIds) {
    const files = (byTopic.get(topicId) ?? []).sort((a, b) => a.source.localeCompare(b.source));
    const title = WIKI_TOPIC_TITLES[topicId] ?? topicId;
    const lines = [
      `# ${title}`,
      ``,
      `> Cold warehouse topic page. **Not living law.** Open only via archivist / historical task.`,
      `> Home: [docs/_archive/README.md](../README.md) · Topic map: [index.md](../index.md)`,
      ``,
      `| Source (stub) | Warehouse body | Successor | Batch |`,
      `|---------------|----------------|-----------|-------|`,
      ...files.map(
        (f) =>
          `| \`${f.source}\` | [\`${f.basename}\`](../../${path.relative("docs/_archive", f.warehouse).replaceAll(path.sep, "/")}) | \`${f.successor}\` | \`${f.batchId}\` |`,
      ),
      ``,
      `## Reasons`,
      ``,
      ...files.map((f) => `- **${f.basename}:** ${f.reason}`),
      ``,
    ];
    const rel = `docs/_archive/wiki/topics/${topicId}.md`;
    writeFileSync(path.join(repoRoot, rel), lines.join("\n"), "utf8");
    written.push(rel);
  }

  const indexLines = [
    `# Archive wiki — topic map`,
    ``,
    `Cold multi-file index. Agents: **do not rehydrate** unless archivist/historical task.`,
    `Living law stays in hot SSOT (\`docs/agent-ops/*\`, \`PROJECT_STATUS.md\`, protected 6).`,
    ``,
    `| Topic | Page | Files |`,
    `|-------|------|-------|`,
    ...topicIds.map((id) => {
      const n = byTopic.get(id)?.length ?? 0;
      const title = WIKI_TOPIC_TITLES[id] ?? id;
      return `| ${title} | [topics/${id}.md](./topics/${id}.md) | ${n} |`;
    }),
    ``,
    `## Area folders (body storage)`,
    ``,
    `- \`docs/_archive/agent-ops/<YYYY-MM>/\` — dated agent-ops revision bodies`,
    `- \`docs/_archive/coordination/<YYYY-MM>/\` — root historical ledgers`,
    `- \`docs/_archive/openclinxr/<YYYY-MM>/\` — product/process archive-candidates`,
    `- \`docs/_archive/iterations/<id>/\` — completed agent-factory iterations`,
    ``,
    `Each area folder may contain \`ARCHIVE-MANIFEST.json\` (machine index).`,
    ``,
    `Rebuild: \`pnpm docs:archive -- wiki\``,
    ``,
  ];
  writeFileSync(path.join(archiveRoot, "wiki/index.md"), indexLines.join("\n"), "utf8");
  written.push("docs/_archive/wiki/index.md");

  const home = [
    `# Docs warehouse (cold archive wiki)`,
    ``,
    `**Entry for archivist / historical audit only.** Not part of normal session rehydrate.`,
    ``,
    `| Go | Path |`,
    `|----|------|`,
    `| Topic map | [wiki/index.md](./wiki/index.md) |`,
    `| Living warehouse process | [\`docs/agent-ops/DOC-WAREHOUSE.md\`](../agent-ops/DOC-WAREHOUSE.md) |`,
    `| Warm revision index | [\`docs/agent-ops/REVISION-INDEX.md\`](../agent-ops/REVISION-INDEX.md) |`,
    `| Cadence (when to freeze) | [\`docs/agent-ops/DOC-HYGIENE-CADENCE.md\`](../agent-ops/DOC-HYGIENE-CADENCE.md) |`,
    ``,
    `## Structure (wiki-capable)`,
    ``,
    `\`\`\``,
    `docs/_archive/`,
    `  README.md                 ← you are here`,
    `  wiki/`,
    `    index.md                ← topic map`,
    `    topics/*.md             ← multi-file topic pages`,
    `  agent-ops/<YYYY-MM>/      ← bodies + ARCHIVE-MANIFEST.json`,
    `  coordination/<YYYY-MM>/`,
    `  openclinxr/<YYYY-MM>/`,
    `  iterations/<id>/`,
    `\`\`\``,
    ``,
    `## Topics`,
    ``,
    ...topicIds.map((id) => {
      const title = WIKI_TOPIC_TITLES[id] ?? id;
      const n = byTopic.get(id)?.length ?? 0;
      return `- [${title}](./wiki/topics/${id}.md) (${n} files)`;
    }),
    ``,
    `## Rules`,
    ``,
    `1. Cold content is **historical-synthesis** — never marching orders.`,
    `2. Stubs at original paths point here + successor living SSOT.`,
    `3. Prefer \`pnpm docs:archive -- plan|freeze --set cruft|agent-ops|all\` over ad-hoc moves.`,
    `4. Binary/runtime evidence under \`.openclinxr/\` is gitignored local cache — not this warehouse.`,
    ``,
  ];
  writeFileSync(path.join(archiveRoot, "README.md"), home.join("\n"), "utf8");
  written.push("docs/_archive/README.md");

  return { topics: topicIds, filesIndexed: all.length, paths: written };
}

function inferTopicFromWarehouse(warehouse: string): string {
  if (warehouse.includes("/agent-ops/")) return "agent-ops-revisions";
  if (warehouse.includes("/coordination/")) return "coordination-ledgers";
  if (warehouse.includes("/openclinxr/")) return "openclinxr-product-docs";
  if (warehouse.includes("/iterations/")) return "agent-factory-iterations";
  if (warehouse.includes("context-opt") || warehouse.includes("path-scope")) {
    return "context-optimization";
  }
  return "misc";
}

export function docsArchiveStatus(repoRoot: string): {
  hotLivingAgentOps: number;
  datedStubsOrRevisions: number;
  coldWarehouseMd: number;
  coldManifests: number;
  neverArchivePresent: string[];
  warehouseDirs: string[];
  wikiTopics: number;
  wikiPresent: boolean;
} {
  const agentOps = path.join(repoRoot, "docs/agent-ops");
  const archiveRoot = path.join(repoRoot, "docs/_archive");
  let hotLivingAgentOps = 0;
  let datedStubsOrRevisions = 0;
  const neverArchivePresent: string[] = [];

  if (existsSync(agentOps)) {
    for (const name of readdirSync(agentOps)) {
      const full = path.join(agentOps, name);
      if (!statSync(full).isFile() || !name.endsWith(".md")) continue;
      if (NEVER_ARCHIVE_BASENAMES.has(name) || !/^\d{4}-\d{2}-\d{2}-/.test(name)) {
        if (name.endsWith(".md") && !/^\d{4}-\d{2}-\d{2}-/.test(name)) {
          hotLivingAgentOps += 1;
        }
        if (NEVER_ARCHIVE_BASENAMES.has(name)) neverArchivePresent.push(`docs/agent-ops/${name}`);
      }
      if (/^\d{4}-\d{2}-\d{2}-/.test(name)) datedStubsOrRevisions += 1;
    }
  }

  let coldWarehouseMd = 0;
  let coldManifests = 0;
  const warehouseDirs: string[] = [];
  if (existsSync(archiveRoot)) {
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) {
          warehouseDirs.push(path.relative(repoRoot, full).replaceAll(path.sep, "/"));
          walk(full);
        } else if (name === "ARCHIVE-MANIFEST.json") {
          coldManifests += 1;
        } else if (name.endsWith(".md") && !full.includes(`${path.sep}wiki${path.sep}`)) {
          coldWarehouseMd += 1;
        }
      }
    };
    walk(archiveRoot);
  }

  const wikiTopicsDir = path.join(archiveRoot, "wiki/topics");
  let wikiTopics = 0;
  if (existsSync(wikiTopicsDir)) {
    wikiTopics = readdirSync(wikiTopicsDir).filter((n) => n.endsWith(".md")).length;
  }

  return {
    hotLivingAgentOps,
    datedStubsOrRevisions,
    coldWarehouseMd,
    coldManifests,
    neverArchivePresent: neverArchivePresent.sort(),
    warehouseDirs: warehouseDirs.sort(),
    wikiTopics,
    wikiPresent: existsSync(path.join(archiveRoot, "README.md")),
  };
}

type CliArgs = {
  command: "plan" | "freeze" | "status" | "wiki" | "help";
  batchId: string;
  dryRun: boolean;
  set: FreezeSetId;
};

export function parseDocsArchiveArgs(argv: string[]): CliArgs {
  const args = argv.filter((a) => a !== "--");
  let command: CliArgs["command"] = "help";
  if (
    args[0] === "plan" ||
    args[0] === "freeze" ||
    args[0] === "status" ||
    args[0] === "wiki" ||
    args[0] === "help"
  ) {
    command = args[0];
  }
  let batchId = DEFAULT_BATCH;
  let dryRun = false;
  let set: FreezeSetId = "agent-ops";
  for (let i = 1; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--dry-run") dryRun = true;
    else if ((a === "--batch" || a === "--batch-id") && args[i + 1]) {
      batchId = args[++i]!;
    } else if (a === "--set" && args[i + 1]) {
      const v = args[++i]!;
      if (v === "agent-ops" || v === "cruft" || v === "all") set = v;
    }
  }
  // Cruft set default batch id
  if (set === "cruft" && batchId === DEFAULT_BATCH) {
    batchId = "cruft-audit-2026-08-02";
  }
  if (set === "all" && batchId === DEFAULT_BATCH) {
    batchId = "warehouse-all-2026-08-02";
  }
  return { command, batchId, dryRun, set };
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const parsed = parseDocsArchiveArgs(process.argv.slice(2));

  if (parsed.command === "help") {
    console.log(
      JSON.stringify(
        {
          usage: [
            "pnpm docs:archive -- plan [--set agent-ops|cruft|all]",
            "pnpm docs:archive -- freeze --set cruft --batch cruft-audit-2026-08-02 [--dry-run]",
            "pnpm docs:archive -- freeze --set agent-ops --batch context-opt-2026-08-02",
            "pnpm docs:archive -- status",
            "pnpm docs:archive -- wiki   # rebuild multi-file wiki index",
          ],
          sets: {
            "agent-ops": "dated docs/agent-ops/YYYY-MM-DD-*.md",
            cruft: "root ledgers + openclinxr archive-candidates + iterations",
            all: "union",
          },
          wiki: "docs/_archive/README.md + wiki/index.md + wiki/topics/*",
          see: "docs/agent-ops/DOC-WAREHOUSE.md",
        },
        null,
        2,
      ),
    );
    return;
  }

  if (parsed.command === "wiki") {
    const result = rebuildArchiveWiki(repoRoot);
    console.log(JSON.stringify({ command: "wiki", ...result }, null, 2));
    return;
  }

  if (parsed.command === "plan") {
    const planned = planFreezeSet({
      repoRoot,
      set: parsed.set,
      batchId: parsed.batchId,
    });
    // For plan UX: also report which are already stubbed / missing
    const annotated = planned.candidates.map((c) => {
      const abs = path.join(repoRoot, c.source);
      if (!existsSync(abs)) return { ...c, planStatus: "missing" as const };
      try {
        const body = readFileSync(abs, "utf8");
        if (isArchiveStubBody(body)) return { ...c, planStatus: "already_stubbed" as const };
      } catch {
        return { ...c, planStatus: "unreadable" as const };
      }
      return { ...c, planStatus: "ready" as const };
    });
    console.log(
      JSON.stringify(
        {
          command: "plan",
          set: parsed.set,
          batchId: planned.batchId,
          count: annotated.length,
          ready: annotated.filter((c) => c.planStatus === "ready").length,
          alreadyStubbed: annotated.filter((c) => c.planStatus === "already_stubbed").length,
          candidates: annotated,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (parsed.command === "status") {
    console.log(JSON.stringify({ command: "status", ...docsArchiveStatus(repoRoot) }, null, 2));
    return;
  }

  if (parsed.command === "freeze") {
    const result = freezeArchiveBatch({
      repoRoot,
      batchId: parsed.batchId,
      dryRun: parsed.dryRun,
      set: parsed.set,
    });
    console.log(
      JSON.stringify(
        {
          command: "freeze",
          set: parsed.set,
          batchId: parsed.batchId,
          dryRun: result.dryRun,
          moved: result.moved,
          skipped: result.skipped,
          warehouseDirs: Object.keys(result.manifestsByDir ?? {}),
          manifest: result.manifest,
        },
        null,
        2,
      ),
    );
    if (result.skipped.some((s) => s.reason === "warehouse target exists")) {
      process.exitCode = 2;
    }
    return;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
