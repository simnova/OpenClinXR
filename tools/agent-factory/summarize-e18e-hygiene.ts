import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const DEFAULT_OUTPUT_PATH = ".agent-factory/e18e-hygiene-summary-current.json";

type E18eSummary = {
  source: "e18e-cli analyze --log-level error";
  generatedAt: string;
  packageName: string;
  packageVersion: string;
  installSize: string;
  dependencyCount: number;
  productionDependencyCount: number;
  developmentDependencyCount: number;
  duplicateDependencyCount: number;
  warningCount: number | null;
  posture: "advisory";
  acceptedWarningFamilies: string[];
  unsafeAutofixPatterns: string[];
  nextReductionCandidates: string[];
  rawOutputExcerpt: string[];
};

function parseArgs(argv: string[]): { write: boolean; outputPath: string } {
  let write = false;
  let outputPath = DEFAULT_OUTPUT_PATH;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--write") {
      write = true;
      continue;
    }
    if (arg === "--output") {
      const next = argv[index + 1];
      if (!next) throw new Error("--output requires a path");
      outputPath = next;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { write, outputPath };
}

function stripAnsi(value: string): string {
  return value.replace(new RegExp(`${String.fromCharCode(27)}\\\\[[0-?]*[ -/]*[@-~]`, "g"), "");
}

function matchRequired(source: string, pattern: RegExp, label: string): string {
  const match = source.match(pattern);
  if (!match?.[1]) throw new Error(`Unable to parse e18e ${label}`);
  return match[1].trim();
}

function parseDependencyCounts(value: string): {
  dependencyCount: number;
  productionDependencyCount: number;
  developmentDependencyCount: number;
} {
  const match = value.match(/^(\d+)\s+\((\d+)\s+production,\s+(\d+)\s+development\)$/u);
  if (!match) throw new Error(`Unable to parse dependency count: ${value}`);
  return {
    dependencyCount: Number(match[1]),
    productionDependencyCount: Number(match[2]),
    developmentDependencyCount: Number(match[3]),
  };
}

function parseWarningCount(output: string): number | null {
  const match = output.match(/│\s+(\d+)\s+warnings/u);
  return match?.[1] ? Number(match[1]) : null;
}

function buildSummary(): E18eSummary {
  const rawOutput = execFileSync("pnpm", ["exec", "e18e-cli", "analyze", "--log-level", "error"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = stripAnsi(rawOutput);
  const dependencyCounts = parseDependencyCounts(matchRequired(output, /Dependencies\s+([^\n]+)/u, "dependency count"));

  return {
    source: "e18e-cli analyze --log-level error",
    generatedAt: new Date().toISOString(),
    packageName: matchRequired(output, /Package Name\s+([^\n]+)/u, "package name"),
    packageVersion: matchRequired(output, /Version\s+([^\n]+)/u, "package version"),
    installSize: matchRequired(output, /Install Size\s+([^\n]+)/u, "install size"),
    ...dependencyCounts,
    duplicateDependencyCount: Number(matchRequired(output, /Duplicate Dependency Count\s+(\d+)/u, "duplicate dependency count")),
    warningCount: parseWarningCount(output),
    posture: "advisory",
    acceptedWarningFamilies: [
      "transitive duplicate dependency families not controlled by root package.json",
      "workspace package exports warnings pending separate package-boundary decision",
      "IWSDK/Vite peer drift must not be changed by dedupe without explicit compatibility proof",
    ],
    unsafeAutofixPatterns: [
      "Do not run pnpm dedupe as a cleanup shortcut unless pnpm peers check and pnpm hooks:strict remain green and duplicate count improves.",
      "Do not upgrade @typescript/native-preview during e18e cleanup; compiler-preview upgrades require a separate package-boundary migration.",
      "Do not add pnpm overrides solely to silence transitive duplicate warnings without a runtime/test justification.",
      "Do not remove nested workspace exports solely because e18e flags them; validate package-resolution intent first.",
    ],
    nextReductionCandidates: [
      "Finish the gltf-pipeline removal decision only after security notes, asset-pipeline docs, and e18e summary evidence all show @gltf-transform/core covers required source-smoke and conversion-runtime gates.",
      "Keep IWSDK Vite plugins sidecar-gated until a published IWSDK plugin peer range accepts Vite 8 or an explicitly approved compatibility override is recorded.",
      "Move legacy optional asset tools behind capability-specific install/runtime gates if they remain required.",
    ],
    rawOutputExcerpt: output.split("\n").slice(0, 80),
  };
}

const { write, outputPath } = parseArgs(process.argv.slice(2));
const summary = buildSummary();
const serialized = `${JSON.stringify(summary, null, 2)}\n`;

if (write) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, serialized);
  console.log(`Wrote e18e hygiene summary to ${outputPath}`);
} else {
  console.log(serialized);
}
