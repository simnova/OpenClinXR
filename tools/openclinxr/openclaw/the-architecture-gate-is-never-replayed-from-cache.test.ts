import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: the pre-push architecture gate replayed a cached green for a
 * ratchet violation its own suite would have caught.
 *
 * `pnpm architecture` is `turbo run architecture --filter
 * '@openclinxr/architecture-rules'`. The `architecture` task inputs listed only
 * files inside the architecture-rules package (its own archunit tests, configs,
 * tsconfig, package.json) plus $TURBO_DEFAULT$. The suite scans the whole
 * workspace (file-size budgets, workspace-architecture, freeze honesty). A
 * product change outside architecture-rules left the task hash unchanged, so
 * turbo replayed the last green and the pre-push gate passed a violation the
 * suite catches uncached.
 *
 * MEASURED 2026-09-11 (1b4ee942 message): a direct uncached run of the
 * architecture suite caught the xr-station-room test-internal-import violation
 * immediately; the pre-push turbo path had passed it from cache.
 *
 * THE DECISION: the architecture task never replays from cache
 * (`"cache": false` in turbo.json). The suite is a whole-repo scanner; its
 * scanned set is the tree, not the package, and no input list stays in sync
 * with that by hand.
 *
 * claimScope: that the architecture turbo task is cache-disabled, and that the
 * full-turbo pre-push path still carries the ^typecheck graph.
 * notEvidenceFor: other turbo tasks' cache settings (report only), whether CI
 * shares the same turbo cache directory.
 */

type TurboConfig = {
  tasks?: Record<string, { cache?: boolean; dependsOn?: string[]; inputs?: string[] }>;
};

function readRootTurbo(): TurboConfig {
  return JSON.parse(
    readFileSync(new URL("../../../turbo.json", import.meta.url), "utf8"),
  ) as TurboConfig;
}

describe("the architecture gate is never replayed from cache", () => {
  it("(1) the architecture task disables the turbo cache", () => {
    const turbo = readRootTurbo();
    expect(turbo.tasks?.["architecture"]?.cache).toBe(false);
  });

  it("(2) COUNTERWEIGHT: the pre-push path still runs the full graph, not a shortcut", () => {
    // Guards against a fix that disables the cache by deleting the task or its
    // ^typecheck edge. The full-turbo pre-push path depends on that edge.
    const turbo = readRootTurbo();
    expect(turbo.tasks?.["architecture"]?.dependsOn).toContain("^typecheck");
  });

  it("(3) VACUITY GUARD: the cache flag is explicitly set, not merely absent", () => {
    // Without this, a task with no cache key (undefined) could be misread as
    // cache-disabled. Turbo caches by default, so only explicit false counts.
    const turbo = readRootTurbo();
    const cache = turbo.tasks?.["architecture"]?.cache;
    expect(typeof cache).toBe("boolean");
    expect(cache).toBe(false);
  });
});
