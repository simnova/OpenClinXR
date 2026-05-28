import { glob, readFile } from "node:fs/promises";

const allowedTsNoCheckFiles = new Set<string>();
const allowedRelaxedTsconfigOptions = new Map<string, ReadonlySet<string>>([
  ["packages/cellix/config-typescript/tsconfig.base.json", new Set(["skipLibCheck"])],
]);
const forbiddenRelaxedTsconfigOptions = new Set([
  "exactOptionalPropertyTypes",
  "noFallthroughCasesInSwitch",
  "noImplicitOverride",
  "noImplicitReturns",
  "noUncheckedIndexedAccess",
  "noPropertyAccessFromIndexSignature",
  "noUncheckedSideEffectImports",
  "strict",
]);
const rootInheritedStrictConfig = "packages/cellix/config-typescript/tsconfig.base.json";
const requiredRootInheritedStrictOptions = new Set([
  "strict",
  "exactOptionalPropertyTypes",
  "noUncheckedIndexedAccess",
  "noImplicitReturns",
  "noImplicitOverride",
  "noFallthroughCasesInSwitch",
  "noPropertyAccessFromIndexSignature",
  "noUncheckedSideEffectImports",
]);
const requiredRootInheritedFalseOptions = new Set([
  "allowUnreachableCode",
  "allowUnusedLabels",
]);

async function main(): Promise<void> {
  const findings: string[] = [];
  const assert = (condition: boolean, message: string): void => {
    if (!condition) {
      findings.push(message);
    }
  };
  const seenAllowedFiles = new Set<string>();

  const biomeSource = await readFile("biome.json", "utf8");
  const biome = JSON.parse(biomeSource) as {
    assist?: {
      enabled?: boolean;
      actions?: {
        source?: {
          organizeImports?: string;
        };
      };
    };
  };
  const assist = biome.assist;
  assert(assist?.enabled === true, "biome.json must enable assist");
  assert(
    assist?.actions?.source?.organizeImports === "on",
    "biome.json must enable source.organizeImports",
  );

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

    if (compilerOptions["skipLibCheck"] === true && !allowedRelaxations.has("skipLibCheck")) {
      findings.push(`${filePath}: skipLibCheck must not be enabled without an explicit guardrail allowlist entry`);
    }

    if (filePath === rootInheritedStrictConfig) {
      for (const option of requiredRootInheritedStrictOptions) {
        if (compilerOptions[option] !== true) {
          findings.push(`${filePath}: ${option} must remain true in the root inherited strict config`);
        }
      }

      for (const option of requiredRootInheritedFalseOptions) {
        if (compilerOptions[option] !== false) {
          findings.push(`${filePath}: ${option} must remain false in the root inherited strict config`);
        }
      }
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
