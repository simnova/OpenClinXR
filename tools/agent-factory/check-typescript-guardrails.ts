import { glob, readFile } from "node:fs/promises";

const allowedTsNoCheckFiles = new Set<string>();
const allowedRelaxedTsconfigOptions = new Map<string, ReadonlySet<string>>([
  ["packages/cellix/config-typescript/tsconfig.base.json", new Set(["skipLibCheck"])],
]);
const forbiddenRelaxedTsconfigOptions = new Set([
  "exactOptionalPropertyTypes",
  "noUncheckedIndexedAccess",
  "noPropertyAccessFromIndexSignature",
  "noImplicitOverride",
  "strict",
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

  for await (const filePath of glob("{apps,packages}/**/tsconfig*.json")) {
    const source = await readFile(filePath, "utf8");
    const parsed = JSON.parse(source) as { compilerOptions?: Record<string, unknown> };
    const compilerOptions = parsed.compilerOptions ?? {};
    const allowedRelaxations = allowedRelaxedTsconfigOptions.get(filePath) ?? new Set<string>();

    for (const option of forbiddenRelaxedTsconfigOptions) {
      if (compilerOptions[option] === false && !allowedRelaxations.has(option)) {
        findings.push(`${filePath}: ${option} must not be relaxed to false`);
      }
    }

    if (compilerOptions.skipLibCheck === true && !allowedRelaxations.has("skipLibCheck")) {
      findings.push(`${filePath}: skipLibCheck must not be enabled without an explicit guardrail allowlist entry`);
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
