import { describe, expect, it } from "vitest";

import {
  ARCHITECTURE_GLOBAL_SUITE_FILES,
  biomeStagedFiles,
  buildArchitectureStep,
  buildBiomeStep,
  classifyArchitectureInvocation,
  matchesAnyPath,
  stepsForProfile,
} from "./agentic-hook-runner.js";

describe("agentic-hook-runner path-scoped architecture", () => {
  it("omits architecture when staged files cannot introduce architecture violations", () => {
    const staged = ["PROJECT_STATUS.md", "operator-open-questions.md"];
    expect(classifyArchitectureInvocation("pre-commit", staged)).toBe("omit");
    expect(buildArchitectureStep("pre-commit", staged)).toBeNull();

    const steps = stepsForProfile("pre-commit", staged);
    expect(steps.some((step) => step.label.toLowerCase().includes("architecture"))).toBe(false);
    // AMENDED 2026-08-24. `f87967652` (2026-08-06) added the integrate gate to the pre-commit
    // profile and this exact list was not updated, so the file has been red for eighteen days —
    // invisible because the pre-commit profile runs only the four architecture-rules files and never
    // this suite.
    //
    // The clause's SUBJECT is unchanged and still asserted above: architecture is omitted for staged
    // files that cannot introduce architecture violations. The integrate gate is a different guard
    // that short-circuits on a non-land commit ("not an integrate land — gate not applicable"), so
    // its presence does not weaken what this clause is for.
    expect(steps.map((step) => step.label)).toEqual([
      "Integrate gate (land path only)",
      "OpenClaw drift check",
      "Agent coordination alignment",
      // ADDED 2026-08-25 and UNCONDITIONAL. The old expectation ended here, which is exactly the
      // shape that let four commits publish an orphaned humanoid: every step was path- or
      // claim-scoped and none consulted the consumer graph.
      "Published humanoids are cast or declared",
      "OpenClaw post-slice record check",
    ]);
  });

  it("uses path-scoped-global (direct vitest of full global suites) for single-package product commits", () => {
    const staged = ["packages/openclinxr/domain/src/claim-language.ts"];
    expect(classifyArchitectureInvocation("pre-commit", staged)).toBe("path-scoped-global");

    const step = buildArchitectureStep("pre-commit", staged);
    expect(step).not.toBeNull();
    expect(step?.label).toContain("path-scoped");
    expect(step?.command).toEqual([
      "pnpm",
      "--filter",
      "@openclinxr/architecture-rules",
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.arch.config.ts",
      "--root",
      ".",
      ...ARCHITECTURE_GLOBAL_SUITE_FILES,
    ]);
    // Global suites must still be present — never a weaker subset that drops freeze/workspace scanners.
    expect(step?.command).toContain("src/archunit-tests/file-size-budgets.test.ts");
    expect(step?.command).toContain("src/archunit-tests/workspace-architecture.test.ts");
    expect(step?.command).toContain("src/archunit-tests/decision-invariants.test.ts");
    expect(step?.command).toContain("src/archunit-tests/tsconfig-conventions.test.ts");
    // Must NOT use turbo pnpm architecture (avoids ^typecheck cascade on ordinary product commits).
    expect(step?.command).not.toEqual(["pnpm", "architecture"]);
  });

  it("forces full turbo architecture when architecture-rules or monorepo topology is staged", () => {
    expect(
      classifyArchitectureInvocation("pre-commit", ["packages/openclinxr/architecture-rules/src/workspace-architecture.test.ts"]),
    ).toBe("full-turbo");
    expect(classifyArchitectureInvocation("pre-commit", ["package.json"])).toBe("full-turbo");
    expect(classifyArchitectureInvocation("pre-commit", ["turbo.json"])).toBe("full-turbo");

    const step = buildArchitectureStep("pre-commit", ["package.json"]);
    expect(step?.command).toEqual(["pnpm", "architecture"]);
  });

  it("keeps pre-push and strict on full turbo architecture", () => {
    const product = ["packages/openclinxr/domain/src/claim-language.ts"];
    expect(classifyArchitectureInvocation("pre-push", product)).toBe("full-turbo");
    expect(classifyArchitectureInvocation("strict", product)).toBe("full-turbo");
    expect(buildArchitectureStep("pre-push", product)?.command).toEqual(["pnpm", "architecture"]);
    expect(buildArchitectureStep("strict", product)?.command).toEqual(["pnpm", "architecture"]);
  });

  it("treats empty staged set conservatively as full-turbo on pre-commit", () => {
    expect(classifyArchitectureInvocation("pre-commit", [])).toBe("full-turbo");
    expect(buildArchitectureStep("pre-commit", [])?.command).toEqual(["pnpm", "architecture"]);
  });

  it("matches architecture-relevant path patterns for tools and docs that scanners cover", () => {
    expect(matchesAnyPath(["tools/openclinxr/openclaw/agentic-hook-runner.ts"], [/^tools\//u])).toBe(true);
    expect(
      classifyArchitectureInvocation("pre-commit", ["tools/openclinxr/openclaw/agentic-hook-runner.ts"]),
    ).toBe("path-scoped-global");
    expect(classifyArchitectureInvocation("pre-commit", ["docs/openclinxr/code-implementation-plan.md"])).toBe(
      "path-scoped-global",
    );
  });

  it("includes path-scoped architecture in pre-commit steps for product packages", () => {
    const steps = stepsForProfile("pre-commit", ["apps/api/src/server.ts"]);
    const architecture = steps.find((step) => step.label.includes("Architecture"));
    expect(architecture?.label).toBe("Architecture fitness rules (path-scoped pre-commit)");
    expect(architecture?.command.join(" ")).toContain("vitest run --config vitest.arch.config.ts --root .");
  });

  it("adds biome check on staged TS/JSON under apps/packages/tools", () => {
    expect(biomeStagedFiles(["apps/api/src/server.ts", "PROJECT_STATUS.md"])).toEqual(["apps/api/src/server.ts"]);
    const step = buildBiomeStep(["apps/api/src/server.ts"]);
    expect(step?.label).toBe("Biome check (staged)");
    expect(step?.command).toEqual([
      "pnpm",
      "exec",
      "biome",
      "lint",
      "--no-errors-on-unmatched",
      "--",
      "apps/api/src/server.ts",
    ]);
    const steps = stepsForProfile("pre-commit", ["apps/api/src/server.ts"]);
    expect(steps.some((s) => s.label === "Biome check (staged)")).toBe(true);
  });

  it("omits biome when staged files are not in biome.json includes", () => {
    expect(buildBiomeStep(["PROJECT_STATUS.md", "docs/openclinxr/foo.md"])).toBeNull();
    expect(
      stepsForProfile("pre-commit", ["PROJECT_STATUS.md"]).some((s) => s.label.toLowerCase().includes("biome")),
    ).toBe(false);
  });

  it("falls back to turbo lint on affected packages when the staged biome set exceeds 200 files", () => {
    const files = Array.from({ length: 201 }, (_, i) => `apps/api/src/f${i}.ts`);
    const step = buildBiomeStep(files);
    expect(step?.label).toBe("Biome check (affected packages)");
    expect(step?.command.join(" ")).toContain("packages:lint:affected");
  });
});
