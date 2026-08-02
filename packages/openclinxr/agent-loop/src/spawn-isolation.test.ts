import { describe, expect, it } from "vitest";
import {
  assertWriterIsolation,
  buildParentSpawnChecklist,
} from "./spawn-isolation.js";

describe("spawn-isolation", () => {
  describe("assertWriterIsolation", () => {
    it("fails for workspace-write + read-write + isolation none", () => {
      const result = assertWriterIsolation({
        roleId: "asset-pipeline-lead",
        isolation: "none",
        sandboxMode: "workspace-write",
        capabilityMode: "read-write",
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("asset-pipeline-lead");
      expect(result.error).toContain("isolation=worktree");
    });

    it("fails for workspace-write + write + isolation none", () => {
      const result = assertWriterIsolation({
        roleId: "xr-systems-architect",
        isolation: "none",
        sandboxMode: "workspace-write",
        capabilityMode: "write",
      });
      expect(result.ok).toBe(false);
    });

    it("passes for workspace-write + read-write + isolation worktree", () => {
      const result = assertWriterIsolation({
        roleId: "asset-pipeline-lead",
        isolation: "worktree",
        sandboxMode: "workspace-write",
        capabilityMode: "read-write",
      });
      expect(result.ok).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("passes for read-only scouts even with isolation none", () => {
      const result = assertWriterIsolation({
        roleId: "chief-coordinator",
        isolation: "none",
        sandboxMode: "read-only",
        capabilityMode: "read-only",
      });
      expect(result.ok).toBe(true);
    });

    it("passes when capability is null (frontier / non-spawn)", () => {
      const result = assertWriterIsolation({
        roleId: "vp-engineering-delivery",
        isolation: "none",
        sandboxMode: "read-only",
        capabilityMode: null,
      });
      expect(result.ok).toBe(true);
    });

    it("passes workspace-write when capability is not write (edge)", () => {
      const result = assertWriterIsolation({
        roleId: "hrbp",
        isolation: "none",
        sandboxMode: "workspace-write",
        capabilityMode: "read-only",
      });
      expect(result.ok).toBe(true);
    });
  });

  describe("buildParentSpawnChecklist", () => {
    it("sets mustPassIsolationToHarness true for worktree", () => {
      const checklist = buildParentSpawnChecklist({
        isolation: "worktree",
        pathScope: { writeRoots: ["packages/openclinxr/arena/**"] },
        capabilityMode: "read-write",
        sandboxMode: "workspace-write",
      });
      expect(checklist.isolation).toBe("worktree");
      expect(checklist.mustPassIsolationToHarness).toBe(true);
      expect(checklist.pathScopePresent).toBe(true);
      expect(checklist.writeRootsCount).toBe(1);
      expect(checklist.warnings.some((w) => w.includes("isolation=worktree"))).toBe(true);
    });

    it("sets mustPassIsolationToHarness false for none", () => {
      const checklist = buildParentSpawnChecklist({
        isolation: "none",
        pathScope: { writeRoots: [] },
        capabilityMode: "read-only",
        sandboxMode: "read-only",
      });
      expect(checklist.mustPassIsolationToHarness).toBe(false);
      expect(checklist.isolation).toBe("none");
    });

    it("warns when workspace-write writer lacks worktree", () => {
      const checklist = buildParentSpawnChecklist({
        isolation: "none",
        pathScope: { writeRoots: ["tools/**"] },
        capabilityMode: "read-write",
        sandboxMode: "workspace-write",
      });
      expect(checklist.mustPassIsolationToHarness).toBe(false);
      expect(
        checklist.warnings.some((w) => w.includes("expected isolation=worktree")),
      ).toBe(true);
    });

    it("soft-warns when preferredCli is present (Wave B2)", () => {
      const checklist = buildParentSpawnChecklist({
        isolation: "worktree",
        pathScope: {
          writeRoots: ["packages/openclinxr/arena/**"],
          preferredCli: ["pnpm --filter @openclinxr/asset-pipeline"],
        },
        capabilityMode: "read-write",
        sandboxMode: "workspace-write",
      });
      expect(
        checklist.warnings.some((w) =>
          w.includes("prefer package-filtered CLI: pnpm --filter @openclinxr/asset-pipeline"),
        ),
      ).toBe(true);
    });

    it("does not preferredCli-warn when preferredCli absent", () => {
      const checklist = buildParentSpawnChecklist({
        isolation: "none",
        pathScope: { writeRoots: ["docs/**"] },
        capabilityMode: "read-only",
        sandboxMode: "read-only",
      });
      expect(checklist.warnings.some((w) => w.includes("prefer package-filtered CLI"))).toBe(
        false,
      );
    });
  });
});
