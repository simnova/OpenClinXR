// tools/thinning/check-thinning.test.ts — pure-core tests, in-memory rows only
// (no git fixture repos) except T12, which reads the real policy + `git ls-files` once.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { evaluateThinning, gatherInputs, globToRegExp, NoBaseError, resolveBaseSha } from "./check-thinning.js";

const TODAY = "2026-11-18";
const R = (path: string, bytes: number) => ({ path, bytes });

function testPolicy(overrides = {}) {
  return {
    order: ["D", "G", "E", "P"],
    buckets: {
      D: { globs: ["data/**"], ceilingBytes: 10_000, ceilingFiles: 100, targetBytes: null },
      G: { globs: ["proc/**"], ceilingBytes: 10_000, ceilingFiles: null, targetBytes: 1_500 },
      E: { globs: ["ev/**"], ceilingBytes: 10_000, ceilingFiles: null, targetBytes: 5_000 },
      P: { globs: [], ceilingBytes: null, ceilingFiles: null, targetBytes: null },
    },
    rules: { offsetRatio: 2 },
    pinBan: { pathGlobs: ["*.test.*", "*.json"], buckets: ["E", "G", "P"] },
    exceptions: [],
    ...overrides,
  };
}

const rulesOf = (v: { rule: string }[]) => v.map((x) => x.rule);

describe("thinning core", () => {
  it("T1 P-only change (+10KB product) -> ok", () => {
    const r = evaluateThinning({
      policy: testPolicy(), base: [R("src/a.ts", 1000)],
      head: [R("src/a.ts", 1000), R("src/b.ts", 10_240)], addedLines: [], today: TODAY,
    });
    expect(r.ok).toBe(true);
  });

  it("T2 +1000B G, 0 removed -> offset violation", () => {
    const r = evaluateThinning({
      policy: testPolicy(), base: [R("proc/a.md", 2000)],
      head: [R("proc/a.md", 2000), R("proc/b.md", 1000)], addedLines: [], today: TODAY,
    });
    expect(r.ok).toBe(false);
    expect(rulesOf(r.violations)).toContain("offset");
  });

  it("T3 +1000B G and -2000B G -> ok", () => {
    const r = evaluateThinning({
      policy: testPolicy(), base: [R("proc/a.md", 2000), R("proc/old.md", 2000)],
      head: [R("proc/a.md", 2000), R("proc/b.md", 1000)], addedLines: [], today: TODAY,
    });
    expect(r.ok).toBe(true);
  });

  it("T4 +1000B G and -2000B E -> same-bucket violation", () => {
    const r = evaluateThinning({
      policy: testPolicy(),
      base: [R("proc/a.md", 2000), R("ev/old.ts", 6000)],
      head: [R("proc/a.md", 2000), R("proc/b.md", 1000), R("ev/old.ts", 4000)],
      addedLines: [], today: TODAY,
    });
    expect(r.ok).toBe(false);
    expect(rulesOf(r.violations)).toContain("offset");
  });

  it("T5 bucket at/below target: +1000B G alone -> ok", () => {
    const r = evaluateThinning({
      policy: testPolicy(), base: [R("proc/a.md", 100)],
      head: [R("proc/a.md", 100), R("proc/b.md", 1000)], addedLines: [], today: TODAY,
    });
    expect(r.ok).toBe(true);
  });

  it("T6 any added D file -> violation; D file removed -> ok", () => {
    const grown = evaluateThinning({
      policy: testPolicy(), base: [R("data/x.bin", 100)],
      head: [R("data/x.bin", 100), R("data/y.bin", 50)], addedLines: [], today: TODAY,
    });
    expect(grown.ok).toBe(false);
    expect(rulesOf(grown.violations)).toContain("d-growth");
    const shrunk = evaluateThinning({
      policy: testPolicy(), base: [R("data/x.bin", 100), R("data/y.bin", 50)],
      head: [R("data/x.bin", 100)], addedLines: [], today: TODAY,
    });
    expect(shrunk.ok).toBe(true);
  });

  it("T7 ceiling exceeded with offset satisfied -> violation", () => {
    const r = evaluateThinning({
      policy: testPolicy(), base: [R("proc/a.md", 12_000)],
      head: [R("proc/a.md", 10_000), R("proc/b.md", 500)], addedLines: [], today: TODAY,
    });
    expect(r.ok).toBe(false);
    expect(rulesOf(r.violations)).toContain("ceiling");
    expect(rulesOf(r.violations)).not.toContain("offset");
  });

  it("T8 64hex next to a .glb path in a .test.ts -> pin; hex alone -> ok", () => {
    const hex = "a".repeat(64);
    const bad = evaluateThinning({
      policy: testPolicy(), base: [], head: [R("ev/a.test.ts", 10)],
      addedLines: [{ path: "ev/a.test.ts", line: `sha ${hex} apps/ui-xr/public/x.glb` }],
      today: TODAY,
    });
    expect(bad.ok).toBe(false);
    expect(rulesOf(bad.violations)).toContain("pin");
    const okLine = evaluateThinning({
      policy: testPolicy(), base: [], head: [R("ev/a.test.ts", 10)],
      addedLines: [{ path: "ev/a.test.ts", line: `sha ${hex} (see the release notes)` }],
      today: TODAY,
    });
    expect(okLine.ok).toBe(true);
  });

  it("T9 file.py:line citation in a .json -> pin", () => {
    const stem = "materialize_mpfb_humanoid_candidate";
    const pinned = `"source": "${stem}${".py" + ":" + "8073"}"`;
    const r = evaluateThinning({
      policy: testPolicy(), base: [], head: [R("ev/b.json", 10)],
      addedLines: [{ path: "ev/b.json", line: pinned }],
      today: TODAY,
    });
    expect(r.ok).toBe(false);
    expect(rulesOf(r.violations)).toContain("pin");
  });

  it("T10 exception missing quote -> violation; valid exception exempts its rule only", () => {
    const missing = evaluateThinning({
      policy: testPolicy({
        exceptions: [{
          id: "x1", scope: ["ev/a.test.ts"], rule: "pin", approvedBy: "op",
          date: "2026-11-18", expires: "2026-12-18", evidence: "none",
        }],
      }),
      base: [], head: [], addedLines: [], today: TODAY,
    });
    expect(rulesOf(missing.violations)).toContain("exception");
    const hex = "b".repeat(64);
    const scoped = evaluateThinning({
      policy: testPolicy({
        exceptions: [{
          id: "x2", scope: ["proc/only.test.ts"], rule: "pin", approvedBy: "op",
          quote: "operator verbatim approval words here", date: "2026-11-18",
          expires: "2026-12-18", evidence: "none",
        }],
      }),
      // Same path violates pin (exempt) AND offset (+1000B G above target, exempt only from pin).
      base: [R("proc/a.md", 2000)],
      head: [R("proc/a.md", 2000), R("proc/only.test.ts", 1000)],
      addedLines: [{ path: "proc/only.test.ts", line: `sha ${hex} apps/ui-xr/public/x.glb` }],
      today: TODAY,
    });
    expect(rulesOf(scoped.violations)).not.toContain("pin");
    expect(rulesOf(scoped.violations)).toContain("offset");
  });

  it("T11 expired exception -> violation and does not apply", () => {
    const hex = "c".repeat(64);
    const r = evaluateThinning({
      policy: testPolicy({
        exceptions: [{
          id: "x3", scope: ["ev/a.test.ts"], rule: "pin", approvedBy: "op",
          quote: "operator verbatim approval words here", date: "2026-10-01",
          expires: "2026-10-31", evidence: "none",
        }],
      }),
      base: [], head: [R("ev/a.test.ts", 10)],
      addedLines: [{ path: "ev/a.test.ts", line: `sha ${hex} apps/ui-xr/public/x.glb` }],
      today: TODAY,
    });
    expect(rulesOf(r.violations)).toContain("exception");
    expect(rulesOf(r.violations)).toContain("pin");
  });

  it("T13 no base fails closed: merge-base failure throws NoBaseError, never HEAD", () => {
    const throwing = (): string => { throw new Error("fatal: no such ref"); };
    expect(() => resolveBaseSha(undefined, throwing)).toThrow(NoBaseError);
  });

  it("T14 bare --base (empty value) throws NoBaseError", () => {
    expect(() => resolveBaseSha("", () => "abc123\n")).toThrow(NoBaseError);
  });

  it("T15 unresolvable --base ref throws NoBaseError", () => {
    const throwing = (): string => { throw new Error("fatal: no such ref"); };
    expect(() => resolveBaseSha("no-such-ref", throwing)).toThrow(NoBaseError);
    expect(() => resolveBaseSha("no-such-ref", () => "  \n")).toThrow(NoBaseError);
  });

  it("T16 explicit --base resolves ONE sha via merge-base for both tree and diff", () => {
    const calls: string[][] = [];
    const run = (args: string[]): string => {
      calls.push(args);
      if (args[0] === "merge-base") return "abc123\n";
      return "";
    };
    const inputs = gatherInputs("feature-branch", run);
    expect(inputs.baseSha).toBe("abc123");
    expect(calls[0]).toEqual(["merge-base", "HEAD", "feature-branch"]);
    const treeCall = calls.find((c) => c[0] === "ls-tree" && c[3] !== "HEAD");
    expect(treeCall?.[3]).toBe("abc123");
    const diffCall = calls.find((c) => c[0] === "diff");
    expect(diffCall?.[2]).toBe("abc123...HEAD");
  });

  it("T17 zero-byte file added to D -> d-growth violation", () => {
    const r = evaluateThinning({
      policy: testPolicy(), base: [R("data/x.bin", 100)],
      head: [R("data/x.bin", 100), R("data/empty.bin", 0)], addedLines: [], today: TODAY,
    });
    expect(r.ok).toBe(false);
    expect(rulesOf(r.violations)).toContain("d-growth");
  });

  it("T18 ceiling exception excludes the path from the ceiling file count too", () => {
    const buckets = {
      D: { globs: ["data/**"], ceilingBytes: 100_000, ceilingFiles: 1, targetBytes: null },
      G: { globs: ["proc/**"], ceilingBytes: 10_000, ceilingFiles: null, targetBytes: 1_500 },
      E: { globs: ["ev/**"], ceilingBytes: 10_000, ceilingFiles: null, targetBytes: 5_000 },
      P: { globs: [], ceilingBytes: null, ceilingFiles: null, targetBytes: null },
    };
    const rows = [R("data/keep.bin", 10), R("data/exempt.bin", 20)];
    const exc = {
      id: "c1", scope: ["data/exempt.bin"], rule: "ceiling", approvedBy: "op",
      quote: "operator verbatim approval words here", date: "2026-11-18",
      expires: "2026-12-18", evidence: "none",
    };
    const withExc = evaluateThinning({
      policy: testPolicy({ buckets, exceptions: [exc] }),
      base: rows, head: rows, addedLines: [], today: TODAY,
    });
    expect(withExc.ok).toBe(true);
    const withoutExc = evaluateThinning({
      policy: testPolicy({ buckets, exceptions: [] }),
      base: rows, head: rows, addedLines: [], today: TODAY,
    });
    expect(withoutExc.ok).toBe(false);
    expect(rulesOf(withoutExc.violations)).toContain("ceiling");
  });

  it("T19 ci.yml Thinning step passes an explicit base per event (no HEAD-vs-itself on push)", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const ci = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
    expect(ci).toMatch("github.event.before");
    expect(ci).toMatch("base_ref");
    expect(ci).toMatch("--ceilings-only");
  });

  it("T12 real policy parses and every bucket glob matches >= 1 tracked path", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const policy = JSON.parse(readFileSync(join(root, "thinning-policy.json"), "utf8"));
    expect(policy.order).toEqual(["D", "G", "E", "P"]);
    const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8", cwd: root })
      .split("\n").filter(Boolean);
    expect(tracked.length).toBeGreaterThan(1000);
    for (const id of policy.order as string[]) {
      for (const g of policy.buckets[id].globs as string[]) {
        const re = globToRegExp(g);
        expect(tracked.some((f) => re.test(f)), `${id} glob ${g} matches nothing`).toBe(true);
      }
    }
  });
});
