import { nodeConfig } from "@cellix/config-vitest/node";
import { defineConfig, mergeConfig } from "vitest/config";

/**
 * Root tools runner. CellixJS: every package mergeConfig(nodeConfig, …).
 * Worktree exclude lives in nodeConfig — Vitest does not read .gitignore
 * (measured 2026-08-30: nested .claude/.grok worktrees doubled test files).
 */
export default mergeConfig(nodeConfig, defineConfig({}));
