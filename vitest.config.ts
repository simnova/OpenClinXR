import { defaultExclude, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    /**
     * AGENT WORKTREES MUST NOT BE DISCOVERED. Measured 2026-08-30, and it blocked every commit in
     * the repo for roughly an hour while three agents diagnosed the wrong thing.
     *
     * `.claude/worktrees/` is gitignored (.gitignore:50), so `git status` is clean and the tree is
     * invisible to git. Vitest does not read .gitignore. With `include: ["**\/*.test.ts"]` and only
     * the default excludes (node_modules, dist, .idea, .git, cache, output), a nested worktree's
     * copy of every test file is discovered as a first-class test.
     *
     * The failure is confusing precisely because the test NAMED on the command line is fine:
     *
     *   pnpm assets:reachability
     *     -> vitest run --root . tools/openclinxr/openclaw/every-published-humanoid-is-cast-or-declared.test.ts
     *     -> Test Files  1 failed | 1 passed (2)
     *
     * Two files for one path, because a positional argument is a FILTER, not a path — it matched
     * the main copy AND `.claude/worktrees/<agent>/tools/.../<same file>`. The worktree copy fails
     * on `Cannot find package '@openclinxr/scenario-fixtures'` since a worktree has no installed
     * workspace links, so a green suite in main goes red the moment any agent worktree exists.
     *
     * That makes every parallel-agent worktree a landmine under the shared gates, which is the
     * opposite of what worktree isolation is for. Excluding them restores the intent: an agent's
     * tree is ITS OWN to test, never discovered by the parent checkout's runs.
     */
    exclude: [...defaultExclude, "**/.claude/worktrees/**", "**/.grok/worktrees/**"],
  },
});
