#!/usr/bin/env tsx
/**
 * Cross-adapter harness boundary validator (Atlantis pattern #2).
 * Asserts policy ↔ .grok/agents ↔ .codex/agents parity, AGENTS.md vendor
 * runtime isolation, non-writer read-only sandbox, flat nesting.
 *
 * Run: pnpm agent:harness:boundaries
 * Exit non-zero on violation.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildHarnessNeutralManifest,
  HARNESS_NEUTRAL_MANIFEST_REL,
  validateHarnessBoundaries,
  type BoundaryValidationInput,
  type HarnessNeutralManifest,
} from "../../packages/openclinxr/agent-loop/src/harness-neutral-manifest.js";
import { repoRoleHarnessPolicies } from "../../packages/openclinxr/agent-loop/src/role-harness-policy.js";

export function loadBoundaryValidationInputFromRepo(
  root: string = process.cwd(),
): BoundaryValidationInput {
  const manifestPath = path.join(root, HARNESS_NEUTRAL_MANIFEST_REL);
  const manifest: HarnessNeutralManifest = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, "utf8")) as HarnessNeutralManifest)
    : buildHarnessNeutralManifest();

  const grokDir = path.join(root, ".grok", "agents");
  const codexDir = path.join(root, ".codex", "agents");

  const grokAgentStems = existsSync(grokDir)
    ? readdirSync(grokDir)
        .filter((n) => n.endsWith(".md"))
        .map((n) => path.basename(n, ".md"))
    : [];

  const codexAgentStems = existsSync(codexDir)
    ? [
        ...new Set(
          readdirSync(codexDir)
            .filter((n) => n.endsWith(".toml") || n.endsWith(".md"))
            .map((n) => n.replace(/\.(toml|md)$/i, "")),
        ),
      ]
    : null;

  const agentsMdPath = path.join(root, "AGENTS.md");
  const agentsMdText = existsSync(agentsMdPath) ? readFileSync(agentsMdPath, "utf8") : "";

  return {
    manifest,
    policyRoleIds: repoRoleHarnessPolicies.map((p) => p.roleId),
    grokAgentStems,
    codexAgentStems,
    agentsMdText,
  };
}

export function runHarnessBoundariesCheck(root: string = process.cwd()): {
  ok: boolean;
  exitCode: number;
  report: ReturnType<typeof validateHarnessBoundaries>;
  input: BoundaryValidationInput;
} {
  const input = loadBoundaryValidationInputFromRepo(root);
  const report = validateHarnessBoundaries(input);
  return { ok: report.ok, exitCode: report.ok ? 0 : 1, report, input };
}

function main(): void {
  const { report, input, exitCode } = runHarnessBoundariesCheck();

  for (const w of report.warnings) {
    console.warn(`harness-boundaries WARN: ${w}`);
  }

  if (!report.ok) {
    console.error(`harness-boundaries: FAIL (${report.errors.length} errors)`);
    for (const e of report.errors) {
      console.error(`- ${e}`);
    }
    process.exitCode = exitCode;
    return;
  }

  console.log(
    `harness-boundaries: PASS (${input.policyRoleIds.length} policy roles; Grok/Codex parity; vendor isolation; sandbox; maxNestingDepth=1)`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
