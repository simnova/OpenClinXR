/**
 * Agent worktrees are gitignored; Vitest does not read .gitignore.
 * Both nodeConfig and archConfig must consume this list — do not copy the globs.
 */
export const worktreeExcludePatterns = [
  "**/.claude/worktrees/**",
  "**/.grok/worktrees/**",
] as const;
