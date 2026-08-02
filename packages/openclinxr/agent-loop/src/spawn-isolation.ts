/**
 * Parent spawn isolation checklist + writer isolation enforcement.
 * Wave A: ensure workspace-write writers are spawned with isolation=worktree
 * and parents forward isolation into native spawn_subagent.
 */

export type ParentSpawnChecklist = {
  isolation: "none" | "worktree";
  /** True when parent must pass isolation into harness spawn_subagent. */
  mustPassIsolationToHarness: boolean;
  pathScopePresent: boolean;
  writeRootsCount: number;
  warnings: string[];
};

export type BuildParentSpawnChecklistInput = {
  isolation: "none" | "worktree";
  pathScope?: { writeRoots: string[]; preferredCli?: string[] } | null | undefined;
  capabilityMode?: string | null | undefined;
  sandboxMode?: string | undefined;
};

export type AssertWriterIsolationInput = {
  roleId: string;
  isolation: "none" | "worktree";
  sandboxMode: string;
  capabilityMode?: string | null;
};

export type AssertWriterIsolationResult = {
  ok: boolean;
  error?: string;
};

function isWriteCapability(capabilityMode?: string | null): boolean {
  return capabilityMode === "write" || capabilityMode === "read-write";
}

/**
 * Build a parent-facing checklist for spawn_subagent.
 * Surfaces isolation, whether parent must forward isolation, pathScope stats, and soft warnings.
 */
export function buildParentSpawnChecklist(spec: BuildParentSpawnChecklistInput): ParentSpawnChecklist {
  const writeRoots = spec.pathScope?.writeRoots ?? [];
  const writeRootsCount = writeRoots.length;
  const pathScopePresent = spec.pathScope != null;
  const mustPassIsolationToHarness = spec.isolation === "worktree";
  const warnings: string[] = [];

  if (mustPassIsolationToHarness) {
    warnings.push("parent MUST pass isolation=worktree to spawn_subagent");
  }

  if (
    spec.sandboxMode === "workspace-write" &&
    isWriteCapability(spec.capabilityMode) &&
    spec.isolation !== "worktree"
  ) {
    warnings.push(
      `workspace-write writer has isolation=${spec.isolation}; expected isolation=worktree`,
    );
  }

  if (pathScopePresent && writeRootsCount === 0) {
    warnings.push("pathScope present but writeRoots empty");
  }

  // Wave B2: soft preferredCli hint only — never hard-fail CLI choice in verify
  const preferredCli = spec.pathScope?.preferredCli;
  if (preferredCli && preferredCli.length > 0) {
    warnings.push(`prefer package-filtered CLI: ${preferredCli.join(", ")}`);
  }

  return {
    isolation: spec.isolation,
    mustPassIsolationToHarness,
    pathScopePresent,
    writeRootsCount,
    warnings,
  };
}

/**
 * Hard assert: workspace-write + write/read-write capability must use isolation=worktree.
 * Scouts (read-only) and frontier (null capability) pass.
 */
export function assertWriterIsolation(spec: AssertWriterIsolationInput): AssertWriterIsolationResult {
  if (spec.sandboxMode !== "workspace-write") {
    return { ok: true };
  }
  if (!isWriteCapability(spec.capabilityMode)) {
    return { ok: true };
  }
  if (spec.isolation === "worktree") {
    return { ok: true };
  }
  return {
    ok: false,
    error:
      `role=${spec.roleId}: workspace-write + capability=${spec.capabilityMode} requires isolation=worktree (got isolation=${spec.isolation})`,
  };
}
