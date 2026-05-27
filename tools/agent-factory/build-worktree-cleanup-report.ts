import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

type Category = "cleanup-control-plane" | "agent-memory-docs" | "product-code" | "generated-code" | "retained-evidence" | "runtime-assets" | "local-cache" | "operator-notes" | "other";

type WorktreeEntry = {
  status: string;
  path: string;
  category: Category;
  recommendedAction: string;
};

const root = process.cwd();
const outputJson = "docs/openclinxr/worktree-cleanup-handoff-2026-05-27.json";
const outputMd = "docs/openclinxr/worktree-cleanup-handoff-2026-05-27.md";

function gitStatus(): string[] {
  return execFileSync("git", ["status", "--short"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

function parseStatus(line: string): { status: string; file: string } {
  return { status: line.slice(0, 2).trim(), file: line.slice(3).trim() };
}

function categorize(file: string): Category {
  if (/^(AGENTS\.md|PROJECT_COORDINATION_INDEX\.md|AUTONOMOUS_WORK_PLAN\.md|package\.json|\.gitignore|tools\/agent-factory\/build-.*registry|tools\/agent-factory\/build-evidence-index|tools\/agent-factory\/build-worktree-cleanup-report|tools\/agent-factory\/check-coordination-alignment|docs\/openclinxr\/(README|doc-authority-registry|generated-artifact-registry|evidence-index|worktree-cleanup-handoff)-2026-05-27|docs\/openclinxr\/README)/u.test(file)) {
    return "cleanup-control-plane";
  }
  if (file.startsWith("agents/") || file.startsWith("docs/agent-factory/") || file.startsWith("iterations/")) return "agent-memory-docs";
  if (file.startsWith("operator-")) return "operator-notes";
  if (file.startsWith(".agent-factory/") || file.startsWith(".openclinxr/") || file.startsWith(".openclinxr-local/")) return "local-cache";
  if (file.startsWith("docs/openclinxr/") || file.startsWith("sources/")) return "retained-evidence";
  if (file.includes("/generated/") || file.endsWith(".generated.ts") || file.endsWith(".graphql")) return "generated-code";
  if (file.startsWith("apps/ui-xr/public/xr-assets/") || file.startsWith("apps/ui-xr/dist/xr-assets/")) return "runtime-assets";
  if (file.startsWith("apps/") || file.startsWith("packages/") || file.startsWith("tools/openclinxr/") || file === "pnpm-lock.yaml") return "product-code";
  return "other";
}

function actionFor(category: Category): string {
  switch (category) {
    case "cleanup-control-plane": return "Commit only with cleanup/index/registry changes after docs checks pass.";
    case "agent-memory-docs": return "Review as agent-memory update; commit only if it reflects current OpenClaw guidance.";
    case "product-code": return "Do not mix into cleanup commits; triage as product feature/stabilization work.";
    case "generated-code": return "Commit only with its owning schema/API/package change after focused verification.";
    case "retained-evidence": return "Commit in coherent evidence batches if registry/index classify it as retained evidence.";
    case "runtime-assets": return "Commit only with provenance/source/registry coverage and package-level asset verification.";
    case "local-cache": return "Ignore or delete if untracked; do not commit as durable evidence.";
    case "operator-notes": return "Review for active blockers/defaults; avoid mixing with product-code commits.";
    default: return "Review manually before commit, delete, or ignore.";
  }
}

const entries: WorktreeEntry[] = gitStatus()
  .map((line) => {
    const parsed = parseStatus(line);
    const category = categorize(parsed.file);
    return { status: parsed.status, path: parsed.file, category, recommendedAction: actionFor(category) };
  })
  .filter((entry) => entry.category !== "cleanup-control-plane");
const counts = entries.reduce<Record<string, number>>((acc, entry) => {
  acc[entry.category] = (acc[entry.category] ?? 0) + 1;
  return acc;
}, {});
const report = {
  schemaVersion: "2026-05-27",
  claimBoundary: "worktree cleanup handoff only; not product readiness, clinical evidence, scoring evidence, or Quest readiness",
  usageRule: "Use this report to keep cleanup commits separate from product-code and generated-code stabilization work.",
  counts,
  entries,
};

mkdirSync(path.dirname(path.resolve(root, outputMd)), { recursive: true });
writeFileSync(path.resolve(root, outputJson), `${JSON.stringify(report, null, 2)}\n`);
const grouped = Object.entries(counts).sort().map(([category, count]) => `- ${category}: ${count}`).join("\n");
const md = `# Worktree Cleanup Handoff\n\nDate: 2026-05-27\n\nThis generated report categorizes the remaining dirty worktree so cleanup commits do not accidentally absorb unrelated product work. It is a navigation aid only.\n\n## Counts\n\n${grouped}\n\n## Entries\n\n${entries.map((entry) => `- \`${entry.status}\` \`${entry.path}\` - ${entry.category}; ${entry.recommendedAction}`).join("\n")}\n`;
writeFileSync(path.resolve(root, outputMd), md);
console.log(JSON.stringify({ outputMd, outputJson, total: entries.length, counts }, null, 2));
