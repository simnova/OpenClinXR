import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  decideRegistryShrink,
  loadRegisteredPaths,
  parseAllowShrink,
  worktreeNote,
} from "./registry-shrink-guard.ts";

export type DocAuthority =
  | "protected-policy"
  | "canonical"
  | "active-plan"
  | "current-reference"
  | "agent-memory"
  | "agent-methodology"
  | "historical-synthesis"
  | "evidence"
  | "proposal"
  | "decision-record"
  | "temporary"
  | "archive-candidate";

export type DocAuthorityEntry = {
  path: string;
  authority: DocAuthority;
  agentInstructionWeight: "highest" | "high" | "medium" | "low" | "none";
  action: "protect" | "use-as-current" | "summarize-before-use" | "treat-as-evidence" | "archive-or-inline-summary";
  rationale: string;
};

const defaultRoot = process.cwd();
const outputJson = "docs/openclinxr/doc-authority-registry-2026-05-27.json";
const outputMd = "docs/openclinxr/doc-authority-registry-2026-05-27.md";
const REGISTRY_LABEL = "doc-authority-registry";

const excluded = new Set(["node_modules", ".git", ".openclinxr-local", "tmp"]);
const protectedPaths = new Set([
  "AGENTS.md",
  "PROJECT_STATUS.md",
  "docs/openclinxr/worker-backlog-and-validation-matrix.md",
  "docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md",
  "docs/openclinxr/codex-openclaw-operating-bridge-2026-05-27.md",
  "docs/openclinxr/openclaw-runbook-2026-05-27.md",
  "docs/openclinxr/openclaw-tool-adapters-2026-05-27.md",
  "docs/openclinxr/doc-authority-registry-2026-05-27.md",
  "docs/openclinxr/doc-authority-registry-2026-05-27.json",
  "docs/openclinxr/generated-artifact-registry-2026-05-27.md",
  "docs/openclinxr/generated-artifact-registry-2026-05-27.json",
  "docs/openclinxr/evidence-index-2026-05-27.md",
  "docs/openclinxr/evidence-index-2026-05-27.json",
]);

/** Living agent-ops SSOT basenames with elevated instruction weight. */
export const HOT_AGENT_OPS_SSOT = new Set([
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
]);

/** Explicit current-reference set (product + tooling + hot agent-ops). */
const currentReferences = new Set([
  "README.md",
  "docs/TOOLING.md",
  "docs/agent-ops/README.md",
  "docs/agent-ops/PATH-SCOPE.md",
  "docs/agent-ops/CEO-VOICE.md",
  "docs/agent-ops/COMPOSITION-ROOTS.md",
  "docs/agent-ops/DOC-WAREHOUSE.md",
  "docs/agent-ops/MAIN-SESSION-ORCHESTRATOR-ONLY.md",
  "docs/agent-ops/WORKTREE-PROMOTE.md",
  "docs/agent-ops/RACI.md",
  "docs/agent-ops/REVIEW-CADENCE.md",
  "docs/agent-ops/CAPABILITY-EVOLUTION.md",
  "docs/agent-ops/REVISION-INDEX.md",
  ".grok/prompts/agentic-io-contract.md",
  "docs/openclinxr/README.md",
  "docs/openclinxr/exam-scenario-architecture.md",
  "docs/openclinxr/virtual-patient-agent-model.md",
  "docs/openclinxr/asset-generation-pipeline.md",
  "docs/openclinxr/asset-pipeline-vetting-and-cagematch-plan-2026-06-05.md",
  "docs/openclinxr/dynamic-session-asset-strategy.md",
  "docs/openclinxr/model-provider-and-voice-routing.md",
  "docs/openclinxr/mongodb-data-model.md",
  "docs/openclinxr/psychometric-and-review-governance.md",
  "docs/openclinxr/claims-consent-privacy-governance.md",
  "docs/openclinxr/statecharts-and-sequences.md",
  "docs/openclinxr/ux-flows.md",
  "docs/openclinxr/communication-style-and-emotion-qa.md",
  "docs/openclinxr/sample-case-bank-v1.md",
  "docs/openclinxr/station-pack-ed-chest-pain-v1.md",
  "docs/openclinxr/external-ai-asset-pipeline-integration-plan.md",
  "docs/openclinxr/garment-license-compatible-source-options-2026-05-27.md",
  "docs/openclinxr/garment-pipeline-slices-2026-05-27.md",
  "docs/openclinxr/humanoid-clothing-tooling-research-2026-05-27.md",
  "docs/openclinxr/humanoid-provider-upgrade-plan-2026-05-27.md",
  "docs/openclinxr/humanoid-toolchain-options-2026-05-27.md",
  "docs/openclinxr/humanoid-variant-materialization-next-slice-2026-05-26.md",
  "docs/openclinxr/admin-ux-and-testing-brief.md",
  "docs/openclinxr/cellix-package-adoption-brief.md",
  "docs/openclinxr/code-implementation-plan.md",
  "docs/openclinxr/knowledge-graph-and-indexing.md",
  "docs/openclinxr/local-ai-voice-model-strategy.md",
  "docs/openclinxr/mongodb-memory-server-test-strategy.md",
  "docs/openclinxr/session-state-websocket-message-design.md",
  "docs/openclinxr/technology-approach-brief.md",
  "docs/openclinxr/arena-physics-clinical-touch-realbind-2026-08-02.md",
  "docs/openclinxr/physics-realbind-pre-production-readiness-checklist-2026-08-02.md",
  "templates/decision-record.md",
  "templates/risk-record.md",
  "templates/source-record.md",
]);

const historicalSyntheses = new Set([
  "docs/openclinxr/github-pages-site-2026-05-06.md",
  "docs/openclinxr/immersive-web-sdk-evaluation-2026-05-04.md",
  "docs/openclinxr/implementation-milestone-1-results.md",
  "docs/openclinxr/research-brief-step2cs-llm-vsp.md",
]);

const retainedEvidence = new Set([
  "docs/openclinxr/local-hardware-spike-results.md",
  "docs/openclinxr/local-realtime-voice-model-download-plan-2026-05-06.md",
  "docs/openclinxr/realtime-voice-transport-spike-2026-05-04.md",
  "docs/openclinxr/realtime-voice-transport-spike-2026-05-05.md",
  "docs/openclinxr/server-side-multi-actor-state-persistence-phase2-2026-05-05.md",
  "docs/openclinxr/server-side-multi-actor-state-spike-2026-05-05.md",
  "docs/openclinxr/spikes/vibevoice-local-voice-spike.md",
  "docs/openclinxr/uikitml-spatial-text-sidecar-2026-05-05.md",
]);

const DATED_AGENT_OPS = /docs\/agent-ops\/\d{4}-\d{2}-\d{2}-/u;
const DATED_SEGMENT = /\/\d{4}-\d{2}-\d{2}-/u;

function walk(dir: string, root: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (excluded.has(name)) continue;
    const full = path.join(dir, name);
    const rel = path.relative(root, full).replaceAll(path.sep, "/");
    const stats = statSync(full);
    if (stats.isDirectory()) walk(full, root, out);
    else if (/\.mdx?$/u.test(name)) out.push(rel);
  }
  return out;
}

export type BuildDocAuthorityRegistryOptions = {
  cwd?: string;
  allowShrink?: boolean;
  /**
   * Test seam: skip filesystem walk and classify these paths instead.
   * Production CLI never sets this — only the shrink-refusal harness.
   */
  pathListOverride?: readonly string[];
  /** Capture stderr-style messages (tests); defaults to console.error. */
  logError?: (message: string) => void;
};

export type BuildDocAuthorityRegistryResult = {
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

/**
 * Classify a repo-relative markdown path for the doc authority registry.
 * Exported for unit tests; order matters — warehouse / agent-ops before archive-candidate.
 */
export function classify(file: string): DocAuthorityEntry {
  if (protectedPaths.has(file)) {
    return {
      path: file,
      authority: "protected-policy",
      agentInstructionWeight: "highest",
      action: "protect",
      rationale:
        "Canonical OpenClaw/blueprint-factory control surface; agents must not weaken or bypass it.",
    };
  }

  // Cold warehouse (docs/_archive/**) — historical only; never rehydrate as law.
  if (file.startsWith("docs/_archive/")) {
    return {
      path: file,
      authority: "historical-synthesis",
      agentInstructionWeight: "none",
      action: "summarize-before-use",
      rationale:
        "Docs warehouse cold tier (docs/_archive); open only for archivist/historical tasks — see DOC-WAREHOUSE.md.",
    };
  }

  // Child agent I/O contract (hot methodology reference).
  if (file.includes("agentic-io-contract")) {
    return {
      path: file,
      authority: "current-reference",
      agentInstructionWeight: "high",
      action: "use-as-current",
      rationale:
        "Agentic I/O contract for role-mapped children; subordinate to AGENTS.md and protected guardrails.",
    };
  }

  // Explicit tooling + agent-ops index (not dated).
  if (file === "docs/TOOLING.md" || file === "docs/agent-ops/README.md") {
    return {
      path: file,
      authority: "current-reference",
      agentInstructionWeight: "high",
      action: "use-as-current",
      rationale:
        "Hot agent-ops / CLI-first tooling SSOT; living reference for barrier removal and roster index.",
    };
  }

  // Dated agent-ops revision records (before/after freeze stubs).
  if (DATED_AGENT_OPS.test(file)) {
    return {
      path: file,
      authority: "historical-synthesis",
      agentInstructionWeight: "low",
      action: "summarize-before-use",
      rationale:
        "Dated agent-ops revision record (or freeze stub); use successor living SSOT, not this file, as law.",
    };
  }

  // Living agent-ops SSOT under docs/agent-ops/ (not dated, not capability-request payloads).
  if (
    file.startsWith("docs/agent-ops/") &&
    !DATED_SEGMENT.test(file) &&
    !file.includes("capability-requests/")
  ) {
    const base = path.posix.basename(file);
    const high = HOT_AGENT_OPS_SSOT.has(base);
    return {
      path: file,
      authority: "current-reference",
      agentInstructionWeight: high ? "high" : "medium",
      action: "use-as-current",
      rationale: high
        ? "Living agent-ops SSOT (hot tier); never archive; see DOC-WAREHOUSE.md never-archive list."
        : "Living agent-ops documentation under docs/agent-ops/; subordinate to protected guardrails.",
    };
  }

  // Capability request queue (warm living templates / open requests).
  if (file.startsWith("docs/agent-ops/capability-requests/")) {
    return {
      path: file,
      authority: "current-reference",
      agentInstructionWeight: "medium",
      action: "use-as-current",
      rationale:
        "Agent capability request queue/template (warm); not a dated freeze candidate.",
    };
  }

  if (file.startsWith("agents/") && (file.endsWith("/charter.md") || file.endsWith("/memory.md"))) {
    return {
      path: file,
      authority: "agent-memory",
      agentInstructionWeight: "medium",
      action: "summarize-before-use",
      rationale: "Repo-defined role memory/charter; use as a lens, not as active task queue.",
    };
  }
  if (file.startsWith("docs/agent-factory/")) {
    return {
      path: file,
      authority: "agent-methodology",
      agentInstructionWeight: "medium",
      action: "use-as-current",
      rationale:
        "OpenClaw-style methodology and agent-factory operating manual; applies when planning or realigning agents.",
    };
  }
  if (file.startsWith("agents/rules/") || file === "agents/rules/README.md") {
    return {
      path: file,
      authority: "agent-methodology",
      agentInstructionWeight: "medium",
      action: "use-as-current",
      rationale:
        "Modular agentic methodology / harness rules (extracted from AGENTS.md for LOW_TOKEN targeted reads + multi-harness standardization); canonical source. Discovered by Grok etc via .grok/rules/ symlinks (see grok-harness-usage.md and source-of-truth order).",
    };
  }
  if (file.startsWith(".agents/skills/")) {
    return {
      path: file,
      authority: "agent-methodology",
      agentInstructionWeight: "medium",
      action: "use-as-current",
      rationale:
        "Repo-local skill used by Codex/Grok-compatible harnesses for specialized OpenClinXR workflows; subordinate to AGENTS.md, protected guardrails, and active state files.",
    };
  }
  if (/^\.(grok|claude|cursor)\/rules\//.test(file)) {
    return {
      path: file,
      authority: "current-reference",
      agentInstructionWeight: "low",
      action: "use-as-current",
      rationale:
        "Harness-specific mirror (symlink) of agents/rules/ canonical; supports .grok / .claude / .cursor discovery without duplication. Edit the agents/rules/ version. See sync-harness-agent-files.sh and .grok/config.toml.",
    };
  }
  if (file.startsWith(".grok/plugins/")) {
    return {
      path: file,
      authority: "current-reference",
      agentInstructionWeight: "low",
      action: "use-as-current",
      rationale:
        "Project plugin for harness automation (hooks, LSP, skills, agents). See 09-plugins.md and .grok/config.toml [plugins]. Subordinate to protected guardrails.",
    };
  }
  if (/^\.(grok|claude|cursor|codex)\/agents\//.test(file)) {
    return {
      path: file,
      authority: "current-reference",
      agentInstructionWeight: "low",
      action: "use-as-current",
      rationale:
        "Safe pointers (no content dup) to repo-defined agents/** roles for first-class subagent discovery/mapping (gap2 in agentex-openclaw-full-autonomy-gaps.md). Canonical defs in root agents/<role>/. See .grok/agents/README.md, agent-consult.md, subagent-protocol.md, .grok/config.toml. Subordinate to protected + drift rules.",
    };
  }
  if (file.startsWith("iterations/")) {
    return {
      path: file,
      authority: "historical-synthesis",
      agentInstructionWeight: "low",
      action: "summarize-before-use",
      rationale: "Historical planning/synthesis evidence; not active marching orders.",
    };
  }
  if (file.startsWith("proposals/")) {
    return {
      path: file,
      authority: "proposal",
      agentInstructionWeight: "low",
      action: "treat-as-evidence",
      rationale: "Approved/recorded scope evidence; check current guardrails before acting on it.",
    };
  }
  if (file.startsWith("docs/madr/")) {
    return {
      path: file,
      authority: "decision-record",
      agentInstructionWeight: "medium",
      action: "treat-as-evidence",
      rationale:
        "Architecture decision record; durable context but subordinate to protected guardrails and active queue.",
    };
  }
  if (
    file.includes("temporary") ||
    file.includes("unattended-runs") ||
    file.includes("handoff") ||
    file.includes("continuation") ||
    file === "blender-bake-temporary-note.md"
  ) {
    return {
      path: file,
      authority: "temporary",
      agentInstructionWeight: "none",
      action: "archive-or-inline-summary",
      rationale:
        "Temporary/handoff/continuation artifact; preserve only as historical evidence unless linked by current queue.",
    };
  }
  if (
    file.startsWith("docs/openclinxr/evidence/") ||
    /evidence|screenshot|smoke|benchmark|runtime|quest|iwsdk|audit|review|score|gate|source-currentness/u.test(
      file,
    )
  ) {
    return {
      path: file,
      authority: "evidence",
      agentInstructionWeight: "low",
      action: "treat-as-evidence",
      rationale:
        "Evidence or gate artifact; use only when it verifies touched behavior or unlocks a named implementation decision.",
    };
  }
  if (currentReferences.has(file)) {
    return {
      path: file,
      authority: "current-reference",
      agentInstructionWeight: "medium",
      action: "use-as-current",
      rationale: "Current product reference, subordinate to protected guardrails and active queue.",
    };
  }
  if (historicalSyntheses.has(file)) {
    return {
      path: file,
      authority: "historical-synthesis",
      agentInstructionWeight: "low",
      action: "summarize-before-use",
      rationale:
        "Substantive historical design or milestone synthesis; use as background, not active instruction.",
    };
  }
  if (retainedEvidence.has(file)) {
    return {
      path: file,
      authority: "evidence",
      agentInstructionWeight: "low",
      action: "treat-as-evidence",
      rationale:
        "Retained spike/evidence record; use only to verify touched behavior or avoid repeating settled investigation.",
    };
  }
  if (file.startsWith("docs/superpowers/")) {
    return {
      path: file,
      authority: "historical-synthesis",
      agentInstructionWeight: "low",
      action: "summarize-before-use",
      rationale: "Skill-era implementation/spec planning history; use as evidence, not active queue.",
    };
  }
  if (file.startsWith("apps/") || file.startsWith("packages/")) {
    return {
      path: file,
      authority: "current-reference",
      agentInstructionWeight: "low",
      action: "use-as-current",
      rationale: "Package/app-local README or provenance reference; local to its module.",
    };
  }
  return {
    path: file,
    authority: "archive-candidate",
    agentInstructionWeight: "none",
    action: "summarize-before-use",
    rationale: "Unclassified Markdown; review before using as instruction.",
  };
}

/**
 * Build and (when allowed) write the doc-authority registry pair.
 *
 * Overload: `buildDocAuthorityRegistry(cwd)` keeps the prior string-cwd call shape.
 * Options form adds shrink-guard + test seams (#116).
 */
export function buildDocAuthorityRegistry(
  cwdOrOptions: string | BuildDocAuthorityRegistryOptions = {},
): BuildDocAuthorityRegistryResult {
  const options: BuildDocAuthorityRegistryOptions =
    typeof cwdOrOptions === "string" ? { cwd: cwdOrOptions } : cwdOrOptions;
  const cwd = options.cwd ?? defaultRoot;
  const allowShrink = options.allowShrink ?? parseAllowShrink();
  const logError = options.logError ?? ((message: string) => console.error(message));

  const stderrParts: string[] = [];
  const note = worktreeNote(cwd);
  if (note) {
    stderrParts.push(note);
    logError(note);
  }

  const files =
    options.pathListOverride !== undefined
      ? [...options.pathListOverride].sort()
      : walk(cwd, cwd).sort();
  const entries = files.map(classify);
  const counts = entries.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.authority] = (acc[entry.authority] ?? 0) + 1;
    return acc;
  }, {});

  const previousPaths = loadRegisteredPaths(path.resolve(cwd, outputJson));
  const nextPaths = entries.map((entry) => entry.path);
  const decision = decideRegistryShrink({
    registryLabel: REGISTRY_LABEL,
    previousPaths,
    nextPaths,
    allowShrink,
    // #580: existence is judged against the tree being regenerated, not process cwd.
    pathExists: (registeredPath) => existsSync(path.resolve(cwd, registeredPath)),
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

  const registry = {
    schemaVersion: "2026-05-27",
    claimBoundary:
      "documentation authority registry for agentic navigation only; not product, clinical, Quest, scoring, or production readiness evidence",
    protectedRule:
      "Protected-policy files are off-limits to routine agents: do not delete, weaken, bypass, rename, or reinterpret them during autonomous work.",
    usageRule:
      "Agents must consult this registry before treating Markdown outside the canonical control surfaces as active instructions.",
    counts,
    entries,
  };

  mkdirSync(path.dirname(path.resolve(cwd, outputJson)), { recursive: true });
  writeFileSync(path.resolve(cwd, outputJson), `${JSON.stringify(registry, null, 2)}\n`);

  const top = entries.filter(
    (entry) =>
      entry.authority === "protected-policy" ||
      entry.authority === "canonical" ||
      entry.authority === "active-plan" ||
      entry.authority === "current-reference",
  );
  const temporary = entries.filter(
    (entry) => entry.authority === "temporary" || entry.authority === "archive-candidate",
  );
  const md = `# Doc Authority Registry\n\nDate: 2026-05-27\n\nThis generated registry helps agents avoid treating all Markdown as equal. Protected and canonical files control autonomous work; historical, evidence, temporary, and archive-candidate files are context only unless the active queue links them.\n\n## Protected Rule\n\nProtected-policy files are off-limits to routine agents: do not delete, weaken, bypass, rename, or reinterpret them during autonomous work.\n\n## Counts\n\n${Object.entries(counts)
    .sort()
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n")}\n\n## Highest-Value Current Navigation\n\n${top
    .map((entry) => `- \`${entry.path}\` - ${entry.authority}; ${entry.rationale}`)
    .join("\n")}\n\n## Cleanup Candidates\n\nThese files should be summarized, archived, or explicitly marked historical before agents use them as instructions.\n\n${temporary
    .map((entry) => `- \`${entry.path}\` - ${entry.authority}; ${entry.rationale}`)
    .join("\n")}\n`;
  writeFileSync(path.resolve(cwd, outputMd), md);

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
  const result = buildDocAuthorityRegistry({ allowShrink: parseAllowShrink() });
  if (!result.ok) {
    process.exitCode = result.exitCode;
    return;
  }
  console.log(
    JSON.stringify(
      {
        outputJson: result.outputJson,
        outputMd: result.outputMd,
        total: result.total,
        counts: result.counts,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
