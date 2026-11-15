import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

export const LICENCE_REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
export const SCENARIO_FIXTURE_DIR = path.join(LICENCE_REPO_ROOT, "packages/openclinxr/scenario-fixtures/src");
export const SCANNED_ROOTS = ["docs", "apps/ui-xr/public", "tools/openclinxr/evidence/site/fixtures/mn2"] as const;
export const SCANNED_EXTENSIONS = new Set([".json", ".md", ".txt", ".html", ".js"]);

function gitChildEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
}

export function declaredHiddenFacts(repoRoot: string = LICENCE_REPO_ROOT): string[] {
  const facts: string[] = [];
  const scenarioFixtureDir = path.join(repoRoot, "packages/openclinxr/scenario-fixtures/src");
  const files = execFileSync("git", ["ls-files", path.relative(repoRoot, scenarioFixtureDir)], {
    cwd: repoRoot,
    encoding: "utf8",
    env: gitChildEnv(),
  })
    .split("\n")
    .filter((line) => line.endsWith(".ts"));
  for (const file of files) {
    const source = readFileSync(path.join(repoRoot, file), "utf8");
    for (const block of source.matchAll(/hiddenFacts:\s*\[([^\]]*)\]/gsu)) {
      const body = block[1];
      if (body == null) continue;
      for (const quoted of body.matchAll(/"([^"]{12,})"/gu)) {
        const fact = quoted[1];
        if (fact != null) facts.push(fact);
      }
    }
  }
  return facts;
}

export type HiddenFactLeak = {
  factIndex: number;
};

export function scanTextForHiddenFacts(text: string, facts: readonly string[] = declaredHiddenFacts()): HiddenFactLeak[] {
  const leaks: HiddenFactLeak[] = [];
  facts.forEach((fact, factIndex) => {
    if (text.includes(fact)) leaks.push({ factIndex });
  });
  return leaks;
}

export function scanFileForHiddenFacts(
  repoRoot: string,
  file: string,
  facts: readonly string[] = declaredHiddenFacts(),
): HiddenFactLeak[] {
  try {
    return scanTextForHiddenFacts(readFileSync(path.join(repoRoot, file), "utf8"), facts);
  } catch {
    return [];
  }
}
