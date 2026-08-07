/**
 * Test harness for #116 — protected-registry shrink refusal.
 *
 * Invokes the same builder entry points the pnpm scripts use
 * (`buildGeneratedArtifactRegistry` / `buildDocAuthorityRegistry`), against a
 * temporary tree only. Never touches the real repository registries.
 *
 * `pathListOverride` is the fixture seam: the contract uses abstract paths
 * (`a/one.json`) that are not under production scan roots / markdown walk rules.
 * Production CLI never sets that option.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildDocAuthorityRegistry } from "../../agent-factory/build-doc-authority-registry.ts";
import { buildGeneratedArtifactRegistry } from "../../agent-factory/build-generated-artifact-registry.ts";

export type BuilderRun = {
  exitCode: number;
  wrote: boolean;
  outputsUnchanged: boolean;
  removedPaths: string[];
  stderr: string;
};

export type RunRegistryBuilderForTestInput = {
  builder: "generated-artifact" | "doc-authority";
  existingRegisteredPaths: string[];
  presentPaths: string[];
  allowShrink?: boolean;
};

function hashFile(absPath: string): string {
  try {
    return createHash("sha256").update(readFileSync(absPath)).digest("hex");
  } catch {
    return "missing";
  }
}

function seedRegistry(tmp: string, relJson: string, relMd: string, paths: readonly string[]): void {
  const entries = paths.map((p) => ({
    path: p,
    authority: "fixture",
    tracked: false,
    action: "keep",
    agentInstructionWeight: "none",
    rationale: "seed for #116 shrink-refusal fixture",
  }));
  const registry = {
    schemaVersion: "2026-05-27",
    claimBoundary: "fixture only — not a product registry",
    protectedRule: "fixture",
    usageRule: "fixture",
    counts: { fixture: paths.length },
    entries,
  };
  const jsonAbs = path.join(tmp, relJson);
  const mdAbs = path.join(tmp, relMd);
  mkdirSync(path.dirname(jsonAbs), { recursive: true });
  writeFileSync(jsonAbs, `${JSON.stringify(registry, null, 2)}\n`);
  writeFileSync(
    mdAbs,
    `# Fixture registry\n\n${paths.map((p) => `- \`${p}\``).join("\n")}\n`,
  );
}

/**
 * Run one builder against a disposable tree. Safe for parallel tests (unique tmp).
 */
export async function runRegistryBuilderForTest(
  input: RunRegistryBuilderForTestInput,
): Promise<BuilderRun> {
  const tmp = mkdtempSync(path.join(tmpdir(), `openclinxr-registry-shrink-${process.pid}-`));
  try {
    const relJson =
      input.builder === "generated-artifact"
        ? "docs/openclinxr/generated-artifact-registry-2026-05-27.json"
        : "docs/openclinxr/doc-authority-registry-2026-05-27.json";
    const relMd =
      input.builder === "generated-artifact"
        ? "docs/openclinxr/generated-artifact-registry-2026-05-27.md"
        : "docs/openclinxr/doc-authority-registry-2026-05-27.md";

    seedRegistry(tmp, relJson, relMd, input.existingRegisteredPaths);

    const jsonAbs = path.join(tmp, relJson);
    const mdAbs = path.join(tmp, relMd);
    const beforeJson = hashFile(jsonAbs);
    const beforeMd = hashFile(mdAbs);

    const stderrChunks: string[] = [];
    const logError = (message: string) => {
      stderrChunks.push(message);
    };

    const result =
      input.builder === "generated-artifact"
        ? buildGeneratedArtifactRegistry({
            cwd: tmp,
            allowShrink: input.allowShrink === true,
            pathListOverride: input.presentPaths,
            logError,
          })
        : buildDocAuthorityRegistry({
            cwd: tmp,
            allowShrink: input.allowShrink === true,
            pathListOverride: input.presentPaths,
            logError,
          });

    const afterJson = hashFile(jsonAbs);
    const afterMd = hashFile(mdAbs);

    return {
      exitCode: result.exitCode,
      wrote: result.wrote,
      outputsUnchanged: beforeJson === afterJson && beforeMd === afterMd,
      removedPaths: result.removedPaths,
      stderr: result.stderr || stderrChunks.join("\n"),
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
