import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Declared hidden-case-fact population shared by the licence gate and the KD
 * page gate (stage 7, D1). Lives in a non-test module so importing it does not
 * register another test file's describe/it blocks: importing a `*.test.ts`
 * module executes its suite a second time under the importer's runner.
 *
 * The population is every hidden fact long enough to be a distinctive string
 * rather than a common word, derived from the scenario-fixture sources the
 * same way the licence gate always has: `hiddenFacts: [...]` blocks in the
 * tracked `*.ts` fixtures under `packages/openclinxr/scenario-fixtures/src`,
 * double-quoted entries of at least 12 characters.
 */
export const LICENCE_REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
export const SCENARIO_FIXTURE_DIR = path.join(LICENCE_REPO_ROOT, "packages/openclinxr/scenario-fixtures/src");

export function declaredHiddenFacts(): string[] {
  const facts: string[] = [];
  const files = execFileSync("git", ["ls-files", path.relative(LICENCE_REPO_ROOT, SCENARIO_FIXTURE_DIR)], {
    cwd: LICENCE_REPO_ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter((line) => line.endsWith(".ts"));
  for (const file of files) {
    const source = readFileSync(path.join(LICENCE_REPO_ROOT, file), "utf8");
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
