import { glob, readFile } from "node:fs/promises";

const allowedTsNoCheckFiles = new Set([
  "tools/agent-factory/benchmark-gate-report.test.ts",
  "tools/openclinxr/encounter-publication-payloads.test.ts",
]);

async function main(): Promise<void> {
  const findings: string[] = [];
  const seenAllowedFiles = new Set<string>();

  for await (const filePath of glob("{apps,packages,tools}/**/*.{ts,tsx}")) {
    const source = await readFile(filePath, "utf8");
    const hasTsNoCheck = /^\/\/\s*@ts-nocheck\b/mu.test(source);
    if (!hasTsNoCheck) {
      continue;
    }

    if (allowedTsNoCheckFiles.has(filePath)) {
      seenAllowedFiles.add(filePath);
      continue;
    }

    findings.push(`${filePath}: unapproved @ts-nocheck`);
  }

  for (const allowedFile of allowedTsNoCheckFiles) {
    if (!seenAllowedFiles.has(allowedFile)) {
      findings.push(`${allowedFile}: stale @ts-nocheck allowlist entry`);
    }
  }

  if (findings.length > 0) {
    console.error(findings.join("\n"));
    process.exitCode = 1;
    return;
  }

  console.log(`Checked TypeScript guardrails; ${allowedTsNoCheckFiles.size} temporary @ts-nocheck files remain allowlisted.`);
}

await main();
