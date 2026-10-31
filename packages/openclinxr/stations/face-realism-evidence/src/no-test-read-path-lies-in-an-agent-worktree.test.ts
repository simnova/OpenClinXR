import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { repoRoot } from "@openclinxr/factory-station-core/runner";

/**
 * No test-read path lies in an ephemeral agent worktree.
 *
 * Tracked reports cited files inside /Users/patrick/.grok/worktrees/src-openclinxr/<name>/...;
 * removing a worktree reds tests on main. Measured in
 * .openclinxr/evidence/worktree-pins/pre-fix.json: exactly 2 citations are read by tests
 * (testReadCitations); all other citations are provenance strings and stay untouched.
 * The READS table mirrors exactly what the two reader suites open/stat/hash, so a future
 * report edit that reintroduces a worktree path fails here instead of red-ing main later.
 */

/** Anchor via the repo-root helper (same pattern as the-station-runs-on-a-child-case.test.ts). */
const REPO_ROOT = repoRoot();
const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKTREE_ROOT = path.join(os.homedir(), ".grok/worktrees");
const PRE_FIX = path.join(REPO_ROOT, ".openclinxr/evidence/worktree-pins/pre-fix.json");

const THIRD = "tools/openclinxr/evidence/second-subject/third-subject-report.json";
const CROWN = "tools/openclinxr/asset-pipeline/skin/face-replay/crown-registration-report.json";
const CHILD_CASE = "the-station-runs-on-a-child-case.test.ts";
const DONOR_ISLAND = "a-donor-island-lands-only-where-it-is-registered.test.ts";

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

type Entry = {
  report: string;
  selector: string;
  reader: string;
  token: string;
  covers: string[];
  select: (report: Record<string, unknown>) => string[];
};

function readReport(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, rel), "utf8")) as Record<string, unknown>;
}

/**
 * One entry per (report, field selector) that a test opens/stats/hashes.
 * Reader line numbers were verified by grep against the reader sources.
 */
const READS: Entry[] = [
  {
    report: THIRD,
    selector: 'findings[evidence_kind=="observed"].artifacts[]',
    reader: `${CHILD_CASE}:347`, // (pre-fix.json reader the-station-runs-on-a-child-case.test.ts:347; grep: existsSync(artifact) at :347)
    token: "artifacts",
    covers: ["findings[id=F3-tone-anchor].artifacts[0]"], // (pre-fix.json classification field)
    select: (r) =>
      asArray(asRecord(r).findings).flatMap((f) =>
        asRecord(f).evidence_kind === "observed" ? asArray(asRecord(f).artifacts).filter(isString) : [],
      ),
  },
  {
    report: THIRD,
    selector: "h1_direct.stages[].runs.{run1,run2}.outputs[].path",
    reader: `${CHILD_CASE}:333`, // (grep: existsSync(o.path) at :333)
    token: "outputs",
    covers: [],
    select: (r) =>
      asArray(asRecord(asRecord(r).h1_direct).stages).flatMap((s) =>
        [asRecord(asRecord(s).runs).run1, asRecord(asRecord(s).runs).run2].flatMap((run) =>
          asArray(asRecord(run).outputs)
            .map((o) => asRecord(o).path)
            .filter(isString),
        ),
      ),
  },
  {
    report: THIRD,
    selector: "h1_direct.stages[].runs.{run1,run2}.log",
    reader: `${CHILD_CASE}:338`, // (grep: existsSync(run.log) at :338)
    token: "run.log",
    covers: [],
    select: (r) =>
      asArray(asRecord(asRecord(r).h1_direct).stages).flatMap((s) =>
        [asRecord(asRecord(s).runs).run1, asRecord(asRecord(s).runs).run2]
          .map((run) => asRecord(run).log)
          .filter(isString),
      ),
  },
  {
    report: THIRD,
    selector: "sheet.root + sheet.files[]",
    reader: `${CHILD_CASE}:351-357`, // (grep: join(r.sheet.root, name) at :352, readdirSync(r.sheet.root) at :357)
    token: "root",
    covers: [],
    select: (r) => {
      const sheet = asRecord(asRecord(r).sheet);
      const root = sheet.root;
      if (!isString(root)) return [];
      return [root, ...Object.keys(asRecord(sheet.files)).map((name) => path.join(root, name))];
    },
  },
  {
    report: THIRD,
    selector: "runner.runs[].stageRecords",
    reader: `${CHILD_CASE}:365`, // (grep: existsSync(run.stageRecords) at :365)
    token: "stageRecords",
    covers: [],
    select: (r) =>
      asArray(asRecord(asRecord(r).runner).runs)
        .map((run) => asRecord(run).stageRecords)
        .filter(isString),
  },
  {
    report: CROWN,
    selector: "hb1.body2.front_render",
    reader: `${DONOR_ISLAND}:184`, // (pre-fix.json reader a-donor-island-lands-only-where-it-is-registered.test.ts:184; grep: crownPresence(hb1.front_render) at :184)
    token: "front_render",
    covers: ["hb1.body2.front_render"], // (pre-fix.json classification field)
    select: (r) => {
      const v = asRecord(asRecord(asRecord(r).hb1).body2).front_render;
      return isString(v) ? [v] : [];
    },
  },
  {
    report: CROWN,
    selector: "keys of store_shas",
    reader: `${DONOR_ISLAND}:189-193`, // (grep: Object.entries(rep.store_shas) at :190, fs.existsSync(p) at :191)
    token: "store_shas",
    covers: [],
    select: (r) => Object.keys(asRecord(asRecord(r).store_shas)).filter(isString),
  },
];

function isWorktreePath(p: string): boolean {
  return p.includes("/.grok/worktrees/") || p.startsWith(WORKTREE_ROOT + path.sep);
}

describe("no test-read path lies in an agent worktree", () => {
  it("CLAUSE.1: every selected string stays outside homedir()/.grok/worktrees", () => {
    const violations: string[] = [];
    for (const e of READS) {
      for (const value of e.select(readReport(e.report))) {
        if (isWorktreePath(value)) {
          violations.push(`${e.report} :: ${e.selector} :: ${value}`);
        }
      }
    }
    expect(violations, "test-read paths outside agent worktrees").toEqual([]);
  });

  it("CLAUSE.2: each selector selects at least one string", () => {
    for (const e of READS) {
      // (1 per brief: pre-fix.json classification lists one TEST-READ value per report)
      expect(e.select(readReport(e.report)).length, `${e.report} :: ${e.selector} selects >= 1 string`).toBeGreaterThanOrEqual(1);
    }
  });

  it("CLAUSE.3: every TEST-READ classification in pre-fix.json is covered, with no globbed report set", () => {
    const pre = JSON.parse(readFileSync(PRE_FIX, "utf8")) as {
      classification: Array<{ verdict: string; report: string; field: string }>;
    };
    const testReads = pre.classification.filter((c) => c.verdict === "TEST-READ");
    expect(testReads.length).toBeGreaterThanOrEqual(2); // (pre-fix.json testReadCitations: 2)
    for (const c of testReads) {
      const rows = READS.filter((e) => e.report === c.report);
      expect(rows.length, `${c.report} appears in the READS table`).toBeGreaterThan(0); // (0: omission of the red-causing report fails)
      expect(
        rows.some((e) => e.covers.includes(c.field)),
        `${c.report} field ${c.field} is covered by a selector`,
      ).toBe(true);
    }
    for (const e of READS) {
      expect(e.report.includes("*"), `${e.selector} names an exact report file, no glob`).toBe(false);
    }
  });

  it("CLAUSE.4: every entry names a token still present in its reader source", () => {
    for (const e of READS) {
      const file = e.reader.split(":")[0]!;
      const src = readFileSync(path.join(SRC_DIR, file), "utf8");
      expect(src.includes(e.token), `${e.reader} still reads ${e.token}`).toBe(true);
    }
  });
});
