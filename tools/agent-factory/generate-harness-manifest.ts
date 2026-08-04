#!/usr/bin/env tsx
/**
 * Generate docs/agent-ops/harness-neutral/manifest.json from role-harness-policy.ts.
 * Vendor-free SSOT: no model IDs. Run: pnpm agent:harness:manifest
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildHarnessNeutralManifest,
  formatHarnessNeutralManifestJson,
  HARNESS_NEUTRAL_MANIFEST_REL,
} from "../../packages/openclinxr/agent-loop/src/harness-neutral-manifest.js";

const repoRoot = process.cwd();

async function main(): Promise<void> {
  const manifest = buildHarnessNeutralManifest();
  const outPath = path.join(repoRoot, HARNESS_NEUTRAL_MANIFEST_REL);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, formatHarnessNeutralManifestJson(manifest), "utf8");
  console.log(
    `harness-manifest: wrote ${HARNESS_NEUTRAL_MANIFEST_REL} (${manifest.roles.length} roles, maxNestingDepth=${manifest.maxNestingDepth})`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
