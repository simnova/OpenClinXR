/**
 * Slice-team workflow: brief + team templates + handoff JSON + machine done_when verification.
 * Replaces triple-MD per-subagent updates with parallel role-bound execution.
 */

import { existsSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  getRepoRoleHarnessPolicy,
  assertTouchedWithinWriteRoots,
  findSoleAuthorLockViolations,
  formatPathScopeBlock,
  pathMatchesAnyGlob,
} from "./role-harness-policy.js";
import {
  buildParentSpawnChecklist,
  type ParentSpawnChecklist,
} from "./spawn-isolation.js";

export const SLICE_BRIEF_SCHEMA = "openclinxr.slice-brief.v1" as const;
export const TEAM_TEMPLATE_SCHEMA = "openclinxr.slice-team-template.v1" as const;
export const HANDOFF_SCHEMA = "openclinxr.slice-handoff.v1" as const;
export const TEAM_SPAWN_REPORT_SCHEMA = "openclinxr.slice-team-spawn.v1" as const;

export type SliceRoleMode = "read-only" | "write";
export type SlicePhaseId = "scout" | "execute" | "integrate";
export type HandoffStatus = "done" | "blocked" | "in_progress" | "aborted";
export type SkepticVerdict = "visible" | "invisible" | "abort" | "pending";

export type SliceRoleAssignment = {
  paths: string[];
  mode: SliceRoleMode;
  phase?: SlicePhaseId;
};

export type SliceBrief = {
  schemaVersion: typeof SLICE_BRIEF_SCHEMA;
  id: string;
  templateId?: string;
  goal: string;
  q_gate: string;
  autonomy: string;
  roles: Record<string, SliceRoleAssignment>;
  done_when: string[];
  anti_toil_pivot?: string;
  next_slice?: string;
};

export type SliceTeamTemplate = {
  schemaVersion: typeof TEAM_TEMPLATE_SCHEMA;
  id: string;
  description: string;
  goal: string;
  q_gate: string;
  autonomy: string;
  roles: Record<string, SliceRoleAssignment>;
  done_when: string[];
  anti_toil_pivot?: string;
  phases: Array<{
    id: SlicePhaseId;
    parallel: boolean;
    roleIds: string[];
  }>;
};

export type SliceHandoff = {
  schemaVersion: typeof HANDOFF_SCHEMA;
  role: string;
  sliceId: string;
  status: HandoffStatus;
  touched: string[];
  evidence: string[];
  blockers: string[];
  skeptic_verdict?: SkepticVerdict;
  recommended_next: string | null;
  updatedAt: string;
  /** Optional subagent thread id from initial spawn_subagent. Used by orchestrator for resume_from on refinement turns (short delta only). Subagent must still write authoritative update to this same handoff file. */
  subagent_thread_id?: string;
};

export type DoneWhenCheck = {
  rule: string;
  passed: boolean;
  detail: string;
};

export type SliceVerifyReport = {
  schemaVersion: "openclinxr.slice-verify.v1";
  sliceId: string;
  ok: boolean;
  checks: DoneWhenCheck[];
  handoffs: Record<string, SliceHandoff | null>;
};

export type TeamSpawnRoleSpec = {
  roleId: string;
  phase: SlicePhaseId;
  mode: SliceRoleMode;
  paths: string[];
  handoffPath: string;
  spawnPrompt: string;
  /** subagent_id returned by harness spawn_subagent (if available). Enables resume_from for bounded refinement within the same role's handoff contract (e.g. capture/evidence iteration per visibility mandate). Follow-ups must still update the exact same handoff JSON. One-shot remains default. */
  subagentThreadId?: string;
  /** Worktree isolation: workspace-write + write mode → worktree (same rule as buildGrokRepoAgentSpawnSpec). */
  isolation?: "none" | "worktree";
  /** Parent checklist: isolation forward + pathScope stats (Wave A). */
  parentChecklist?: ParentSpawnChecklist;
  /** Role pathScope.writeRoots (when policy exists). */
  pathScopeWriteRoots?: string[];
  /** Paths stripped from assignment as out of writeRoots scope. */
  pathWarnings?: string[];
};

export type TeamSpawnReport = {
  schemaVersion: typeof TEAM_SPAWN_REPORT_SCHEMA;
  sliceId: string;
  templateId?: string;
  briefPath: string;
  phase: SlicePhaseId;
  parallel: boolean;
  autonomy: string;
  roles: TeamSpawnRoleSpec[];
};

export function sliceRootDir(sliceId: string): string {
  return path.join(".openclinxr", "slices", sliceId);
}

export function sliceBriefPath(sliceId: string): string {
  return path.join(sliceRootDir(sliceId), "brief.json");
}

export function sliceHandoffPath(sliceId: string, roleId: string): string {
  return path.join(sliceRootDir(sliceId), "handoffs", `${roleId}.json`);
}

export function materializeBriefFromTemplate(
  template: SliceTeamTemplate,
  sliceId: string,
): SliceBrief {
  return {
    schemaVersion: SLICE_BRIEF_SCHEMA,
    id: sliceId,
    templateId: template.id,
    goal: template.goal,
    q_gate: template.q_gate,
    autonomy: template.autonomy,
    roles: template.roles,
    done_when: [...template.done_when],
    ...(template.anti_toil_pivot !== undefined ? { anti_toil_pivot: template.anti_toil_pivot } : {}),
  };
}

export function rolesForPhase(
  brief: SliceBrief,
  template: SliceTeamTemplate | null,
  phaseId: SlicePhaseId,
): string[] {
  const roles = brief.roles ?? {};
  if (template) {
    const phase = template.phases.find((entry) => entry.id === phaseId);
    if (phase) {
      return phase.roleIds.filter((roleId) => roles[roleId]);
    }
  }
  return Object.entries(roles)
    .filter(([, assignment]) => (assignment.phase ?? "execute") === phaseId)
    .map(([roleId]) => roleId);
}

const SLICE_PATHS_GLOB = ".openclinxr/slices/**";
const WRITE_ROOTS_DEFAULT_CAP = 12;

/**
 * Constrain free-form assignment.paths to the role's pathScope.writeRoots
 * (plus always-allowed slice handoff paths). Out-of-scope paths are stripped
 * with warnings; if nothing remains, default to writeRoots (capped).
 */
export function constrainPathsToWriteRoots(
  roleId: string,
  paths: string[],
): { paths: string[]; warnings: string[] } {
  const policy = getRepoRoleHarnessPolicy(roleId);
  const writeRoots = policy?.pathScope.writeRoots;
  if (!writeRoots || writeRoots.length === 0) {
    return { paths: [...paths], warnings: [] };
  }

  const allowed: string[] = [];
  const warnings: string[] = [];
  for (const p of paths) {
    if (pathAllowedUnderWriteRoots(p, writeRoots)) {
      allowed.push(p);
    } else {
      warnings.push(`stripped out-of-scope path for ${roleId}: ${p}`);
    }
  }

  if (allowed.length === 0) {
    return {
      paths: writeRoots.slice(0, WRITE_ROOTS_DEFAULT_CAP),
      warnings: [
        ...warnings,
        `no assignment paths within writeRoots for ${roleId}; defaulted to writeRoots (cap ${WRITE_ROOTS_DEFAULT_CAP})`,
      ],
    };
  }
  return { paths: allowed, warnings };
}

/** True if candidate matches writeRoots or is under .openclinxr/slices/**. */
function pathAllowedUnderWriteRoots(candidate: string, writeRoots: string[]): boolean {
  if (pathMatchesAnyGlob(candidate, [SLICE_PATHS_GLOB])) return true;
  if (pathMatchesAnyGlob(candidate, writeRoots)) return true;
  // Assignment paths are often themselves globs (e.g. packages/openclinxr/arena/**).
  // Accept when candidate is equal to / nests a writeRoot, or a writeRoot nests candidate.
  for (const root of writeRoots) {
    if (pathMatchesAnyGlob(root, [candidate])) return true;
    const rootBase = stripGlobSuffix(root);
    const candBase = stripGlobSuffix(candidate);
    if (
      candBase === rootBase ||
      candBase.startsWith(`${rootBase}/`) ||
      rootBase.startsWith(`${candBase}/`)
    ) {
      return true;
    }
  }
  return false;
}

function stripGlobSuffix(p: string): string {
  return p.replace(/\/\*\*$/, "").replace(/\/\*$/, "").replace(/\*$/, "");
}

/** workspace-write sandbox + write mode → worktree (aligns with buildGrokRepoAgentSpawnSpec). */
export function resolveTeamSpawnIsolation(
  roleId: string,
  mode: SliceRoleMode,
): "none" | "worktree" {
  const policy = getRepoRoleHarnessPolicy(roleId);
  if (policy?.sandboxMode === "workspace-write" && mode === "write") {
    return "worktree";
  }
  return "none";
}

export function buildSliceTeamSpawnPrompt(input: {
  repoRoot: string;
  roleId: string;
  roleDir: string;
  brief: SliceBrief;
  assignment: SliceRoleAssignment;
  phase: SlicePhaseId;
}): string {
  const handoffRel = sliceHandoffPath(input.brief.id, input.roleId);
  const briefRel = sliceBriefPath(input.brief.id);
  const writeNote =
    input.assignment.mode === "write"
      ? `Write scope ONLY: ${input.assignment.paths.join(", ")}. Do not edit PROJECT_STATUS.md or other coordination MDs.`
      : "Read-only for this phase. Do not edit product or coordination files.";
  const lines = [
    `Target repo: ${input.repoRoot}`,
    `Slice: ${input.brief.id} (${input.phase} phase)`,
    `Brief: ${briefRel}`,
    `Role: ${input.roleId} (read charter first 30 lines: ${input.roleDir}/charter.md)`,
    `Goal: ${input.brief.goal}`,
    `Q-gate: ${input.brief.q_gate}`,
    `Autonomy: ${input.brief.autonomy}`,
    writeNote,
    `Output: write ONLY ${handoffRel} with schema ${HANDOFF_SCHEMA} (status, touched[], evidence[], blockers[], skeptic_verdict if skeptic).`,
    `Done when (slice-level): ${input.brief.done_when.join("; ")}`,
    `Gates: agents/rules/GUARD_BLUEPRINT.md + agents/rules/MANDATE_VISIBILITY.md`,
    `UNABLE: <reason> if blocked — integrator escalates tier; do not wait for human approval.`,
    input.roleId === "productivity-skeptic"
      ? `Skeptic: set skeptic_verdict to visible|invisible|abort based on evidence paths; invisible twice triggers pivot: ${input.brief.anti_toil_pivot ?? "expand scope"}.`
      : "",
  ].filter(Boolean);

  const policy = getRepoRoleHarnessPolicy(input.roleId);
  if (policy?.pathScope) {
    lines.push("", formatPathScopeBlock(policy.pathScope));
    if (policy.sandboxMode === "workspace-write") {
      lines.push("ISOLATION: parent MUST spawn with isolation=worktree");
    }
    if (policy.pathScope.preferredCli && policy.pathScope.preferredCli.length > 0) {
      lines.push(`Preferred CLI: ${policy.pathScope.preferredCli.join(", ")}`);
    }
  }

  return lines.join("\n");
}

function globMatch(pattern: string, candidate: string): boolean {
  const normalizedPattern = pattern.replaceAll("\\", "/");
  const normalizedCandidate = candidate.replaceAll("\\", "/");
  if (!normalizedPattern.includes("*")) {
    return normalizedCandidate === normalizedPattern || normalizedCandidate.endsWith(`/${normalizedPattern}`);
  }
  const regex = new RegExp(
    `^${normalizedPattern
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
  );
  return regex.test(normalizedCandidate);
}

async function walkFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkFiles(full)));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

async function resolveExistsTargets(repoRoot: string, target: string): Promise<string[]> {
  const absolute = path.isAbsolute(target) ? target : path.join(repoRoot, target);
  if (!target.includes("*")) {
    return existsSync(absolute) ? [absolute] : [];
  }
  const normalizedTarget = target.replaceAll("\\", "/");
  const wildcardIndex = normalizedTarget.split("/").findIndex((segment) => segment.includes("*"));
  if (wildcardIndex < 0) {
    return [];
  }
  const searchRoot = path.join(
    repoRoot,
    ...normalizedTarget.split("/").slice(0, wildcardIndex),
  );
  const pattern = normalizedTarget.split("/").slice(wildcardIndex).join("/");
  const files = await walkFiles(searchRoot);
  return files.filter((file) => {
    const rel = path.relative(searchRoot, file).replaceAll("\\", "/");
    return globMatch(pattern, rel);
  });
}

export async function evaluateDoneWhenRule(
  repoRoot: string,
  rule: string,
  sliceId: string,
  handoffs: Record<string, SliceHandoff | null>,
): Promise<DoneWhenCheck> {
  if (rule.startsWith("exists:")) {
    const target = rule.slice("exists:".length).trim();
    const matches = await resolveExistsTargets(repoRoot, target);
    return {
      rule,
      passed: matches.length > 0,
      detail: matches.length > 0 ? `found ${matches.join(", ")}` : `missing ${target}`,
    };
  }

  if (rule.startsWith("min-bytes:")) {
    const [, target, minBytesRaw] = rule.split(":");
    if (!target || !minBytesRaw) {
      return { rule, passed: false, detail: "invalid min-bytes rule" };
    }
    const minBytes = Number(minBytesRaw);
    const matches = await resolveExistsTargets(repoRoot, target);
    if (matches.length === 0) {
      return { rule, passed: false, detail: `missing ${target}` };
    }
    const sizeInfos: Array<{ rel: string; size: number }> = matches.map((m) => ({
      rel: path.relative(repoRoot, m).replaceAll("\\", "/"),
      size: statSync(m).size,
    }));
    const allSufficient = sizeInfos.every((info) => info.size >= minBytes);
    const detail = sizeInfos.map((info) => `${info.rel} size=${info.size}`).join("; ") + ` min=${minBytes}`;
    return {
      rule,
      passed: allSufficient,
      detail,
    };
  }

  if (rule.startsWith("handoff:")) {
    const parts = rule.slice("handoff:".length).split(":");
    const roleId = parts[0]?.trim();
    const expectedStatus = (parts[1]?.trim() ?? "done") as HandoffStatus;
    if (!roleId) {
      return { rule, passed: false, detail: "missing role id" };
    }
    const handoff = handoffs[roleId];
    if (!handoff) {
      return { rule, passed: false, detail: `no handoff for ${roleId}` };
    }
    const passed = handoff.status === expectedStatus;
    return {
      rule,
      passed,
      detail: `${roleId} status=${handoff.status} expected=${expectedStatus}`,
    };
  }

  if (rule.startsWith("skeptic:")) {
    const expected = rule.slice("skeptic:".length).trim() as SkepticVerdict;
    const handoff = handoffs["productivity-skeptic"];
    const verdict = handoff?.skeptic_verdict ?? "pending";
    return {
      rule,
      passed: verdict === expected,
      detail: `skeptic_verdict=${verdict} expected=${expected}`,
    };
  }

  if (rule === "handoffs:all-done") {
    const pending = Object.entries(handoffs).filter(([, h]) => h?.status !== "done");
    return {
      rule,
      passed: pending.length === 0 && Object.keys(handoffs).length > 0,
      detail:
        pending.length === 0
          ? `all ${Object.keys(handoffs).length} handoffs done`
          : `pending: ${pending.map(([role]) => role).join(", ")}`,
    };
  }

  return {
    rule,
    passed: false,
    detail: `unsupported rule (slice ${sliceId})`,
  };
}

/** Strip :line suffix from touched paths (e.g. "src/file.ts:42" → "src/file.ts") for glob matching. */
function stripTouchedLineSuffix(touchedPath: string): string {
  return touchedPath.replace(/:(\d+)$/, "");
}

export function auditHandoffsPathScope(
  handoffs: Record<string, SliceHandoff | null>,
): DoneWhenCheck[] {
  const checks: DoneWhenCheck[] = [];
  for (const [roleId, handoff] of Object.entries(handoffs)) {
    if (!handoff || !handoff.touched || handoff.touched.length === 0) continue;
    const policy = getRepoRoleHarnessPolicy(roleId);
    if (!policy) continue;
    const cleanPaths = handoff.touched.map((p) => stripTouchedLineSuffix(p));
    const result = assertTouchedWithinWriteRoots(cleanPaths, policy.pathScope);
    checks.push({
      rule: `path-scope:${roleId}`,
      passed: result.ok,
      detail: result.ok
        ? `${cleanPaths.length} file(s) within writeRoots`
        : `violations: ${result.violations.join(", ")}`,
    });
  }
  return checks;
}

export function auditHandoffsSoleAuthorLocks(
  handoffs: Record<string, SliceHandoff | null>,
): DoneWhenCheck[] {
  const checks: DoneWhenCheck[] = [];
  for (const [roleId, handoff] of Object.entries(handoffs)) {
    if (!handoff || !handoff.touched || handoff.touched.length === 0) continue;
    const cleanPaths = handoff.touched.map((p) => stripTouchedLineSuffix(p));
    const violations = findSoleAuthorLockViolations(roleId, cleanPaths);
    for (const v of violations) {
      checks.push({
        rule: `sole-author:${v.lockId}:${roleId}`,
        passed: false,
        detail: `${v.path} locked by ${v.ownerRoleId} (${v.lockId}); ${roleId} is not the owner`,
      });
    }
    if (violations.length === 0) {
      // Only emit a passing check if there were touched files and no violations
      checks.push({
        rule: `sole-author:${roleId}`,
        passed: true,
        detail: `${cleanPaths.length} file(s) — no sole-author lock violations`,
      });
    }
  }
  return checks;
}

export async function verifySliceBrief(input: {
  repoRoot: string;
  brief: SliceBrief;
  handoffs?: Record<string, SliceHandoff | null>;
}): Promise<SliceVerifyReport> {
  const handoffs = input.handoffs ?? {};
  const checks: DoneWhenCheck[] = [];
  for (const rule of input.brief.done_when) {
    checks.push(await evaluateDoneWhenRule(input.repoRoot, rule, input.brief.id, handoffs));
  }
  // Append path-scope audits after done_when rules
  checks.push(...auditHandoffsPathScope(handoffs));
  // Append sole-author lock audits
  checks.push(...auditHandoffsSoleAuthorLocks(handoffs));
  const ok = checks.every((check) => check.passed);
  return {
    schemaVersion: "openclinxr.slice-verify.v1",
    sliceId: input.brief.id,
    ok,
    checks,
    handoffs,
  };
}

export function buildTeamSpawnReport(input: {
  repoRoot: string;
  brief: SliceBrief;
  template: SliceTeamTemplate | null;
  phase: SlicePhaseId;
  roleDirs: Record<string, string>;
}): TeamSpawnReport {
  const roleIds = rolesForPhase(input.brief, input.template, input.phase);
  const templatePhase = input.template?.phases.find((entry) => entry.id === input.phase);
  const parallel = templatePhase?.parallel ?? true;

  const roles: TeamSpawnRoleSpec[] = roleIds.map((roleId) => {
    const assignment = input.brief.roles[roleId];
    if (!assignment) {
      throw new Error(`Role ${roleId} missing from brief ${input.brief.id}`);
    }
    const roleDir = input.roleDirs[roleId] ?? `agents/**/${roleId}`;
    const constrained = constrainPathsToWriteRoots(roleId, assignment.paths);
    const constrainedAssignment: SliceRoleAssignment = {
      ...assignment,
      paths: constrained.paths,
    };
    const policy = getRepoRoleHarnessPolicy(roleId);
    const isolation = resolveTeamSpawnIsolation(roleId, assignment.mode);
    // Align capability signal with spawn surface: write-mode workspace-write → read-write.
    const capabilityMode: "read-only" | "read-write" | null =
      policy?.sandboxMode === "workspace-write" && assignment.mode === "write"
        ? "read-write"
        : policy?.sandboxMode === "read-only" || assignment.mode === "read-only"
          ? "read-only"
          : null;
    const parentChecklist = buildParentSpawnChecklist({
      isolation,
      pathScope: policy?.pathScope,
      capabilityMode,
      sandboxMode: policy?.sandboxMode,
    });
    const roleSpec: TeamSpawnRoleSpec = {
      roleId,
      phase: input.phase,
      mode: assignment.mode,
      paths: constrained.paths,
      handoffPath: sliceHandoffPath(input.brief.id, roleId),
      spawnPrompt: buildSliceTeamSpawnPrompt({
        repoRoot: input.repoRoot,
        roleId,
        roleDir,
        brief: input.brief,
        assignment: constrainedAssignment,
        phase: input.phase,
      }),
      isolation,
      parentChecklist,
    };
    if (policy?.pathScope.writeRoots && policy.pathScope.writeRoots.length > 0) {
      roleSpec.pathScopeWriteRoots = policy.pathScope.writeRoots;
    }
    if (constrained.warnings.length > 0) {
      roleSpec.pathWarnings = constrained.warnings;
    }
    return roleSpec;
  });

  return {
    schemaVersion: TEAM_SPAWN_REPORT_SCHEMA,
    sliceId: input.brief.id,
    ...(input.brief.templateId !== undefined ? { templateId: input.brief.templateId } : {}),
    briefPath: sliceBriefPath(input.brief.id),
    phase: input.phase,
    parallel,
    autonomy: input.brief.autonomy,
    roles,
  };
}

export function formatTeamSpawnBrief(report: TeamSpawnReport): string {
  const lines = [
    `slice=${report.sliceId} phase=${report.phase} parallel=${report.parallel}`,
    `brief=${report.briefPath}`,
    `roles=${report.roles.map((r) => r.roleId).join(",")}`,
  ];
  return lines.join(" | ");
}