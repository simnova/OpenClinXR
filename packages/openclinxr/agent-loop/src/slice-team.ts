/**
 * Slice-team workflow: brief + team templates + handoff JSON + machine done_when verification.
 * Replaces triple-MD per-subagent updates with parallel role-bound execution.
 */

import { existsSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

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
    anti_toil_pivot: template.anti_toil_pivot,
  };
}

export function rolesForPhase(
  brief: SliceBrief,
  template: SliceTeamTemplate | null,
  phaseId: SlicePhaseId,
): string[] {
  if (template) {
    const phase = template.phases.find((entry) => entry.id === phaseId);
    if (phase) {
      return phase.roleIds.filter((roleId) => brief.roles[roleId]);
    }
  }
  return Object.entries(brief.roles)
    .filter(([, assignment]) => (assignment.phase ?? "execute") === phaseId)
    .map(([roleId]) => roleId);
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
  return [
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
  ]
    .filter(Boolean)
    .join("\n");
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
    const absolute = path.isAbsolute(target) ? target : path.join(repoRoot, target);
    if (!existsSync(absolute)) {
      return { rule, passed: false, detail: `missing ${target}` };
    }
    const size = statSync(absolute).size;
    const minBytes = Number(minBytesRaw);
    return {
      rule,
      passed: size >= minBytes,
      detail: `${target} size=${size} min=${minBytes}`,
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
    return {
      roleId,
      phase: input.phase,
      mode: assignment.mode,
      paths: assignment.paths,
      handoffPath: sliceHandoffPath(input.brief.id, roleId),
      spawnPrompt: buildSliceTeamSpawnPrompt({
        repoRoot: input.repoRoot,
        roleId,
        roleDir,
        brief: input.brief,
        assignment,
        phase: input.phase,
      }),
    };
  });

  return {
    schemaVersion: TEAM_SPAWN_REPORT_SCHEMA,
    sliceId: input.brief.id,
    templateId: input.brief.templateId,
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