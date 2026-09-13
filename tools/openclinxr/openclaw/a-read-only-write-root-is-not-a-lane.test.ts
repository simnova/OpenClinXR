import { describe, expect, it } from "vitest";
import {
  auditBoardGraph,
  greedyDisjointLanes,
  rootHasWriteTarget,
  writeRootsOverlap,
  writeTargetsOf,
} from "./audit-board-graph.js";

/**
 * A read-only root should not claim a lane. Before this fix, the audit joined all done_when rules
 * into one string and checked `proofs.includes(root)`, so a `run:` mention of a directory kept
 * a never-written root looking "proven". The inversion: only `changed:` / `live:` / `exists:` /
 * `min-bytes:` targets are writes.
 */

const card = (id: string, writeRoots: string[], doneWhen: string[]) => ({
  id: `tsk_${id}`,
  title: `card ${id}`,
  status: "ready",
  factory: "Planted" as const,
  writeRoots,
  doneWhen,
});

describe("writeTargetsOf", () => {
  it("min-bytes strips trailing :digits", () => {
    expect(writeTargetsOf(["min-bytes:docs/x/y.json:2048"])).toEqual(["docs/x/y.json"]);
  });

  it("changed: live: exists: are writes", () => {
    expect(writeTargetsOf(["changed:src/foo.ts", "live:src/bar.ts", "exists:src/baz.ts"])).toEqual([
      "src/foo.ts",
      "src/bar.ts",
      "src/baz.ts",
    ]);
  });

  it("run: is ignored entirely", () => {
    expect(writeTargetsOf(["run:pnpm test", "run:grep foo src/"])).toEqual([]);
  });
});

describe("rootHasWriteTarget", () => {
  it("root with changed: target under it is accepted", () => {
    expect(rootHasWriteTarget("src", ["changed:src/foo.ts"])).toBe(true);
  });

  it("root with live: target under it is accepted", () => {
    expect(rootHasWriteTarget("src", ["live:src/bar.ts"])).toBe(true);
  });

  it("root with only run: rules is NOT accepted", () => {
    expect(rootHasWriteTarget("src", ["run:pnpm test"])).toBe(false);
  });

  it("root with no done_when rules is NOT accepted", () => {
    expect(rootHasWriteTarget("src", [])).toBe(false);
  });

  it("exact root match counts", () => {
    expect(rootHasWriteTarget("src", ["changed:src"])).toBe(true);
  });
});

describe("writeRootsOverlap", () => {
  it("identical paths overlap", () => {
    expect(writeRootsOverlap(["docs/openclinxr"], ["docs/openclinxr"])).toBe(true);
  });

  it("parent overlaps child", () => {
    expect(writeRootsOverlap(["docs/openclinxr"], ["docs/openclinxr/sub"])).toBe(true);
  });

  it("child overlaps parent", () => {
    expect(writeRootsOverlap(["docs/openclinxr/sub"], ["docs/openclinxr"])).toBe(true);
  });

  it("docs/openclinxr does NOT overlap docs/openclinxr-other", () => {
    expect(writeRootsOverlap(["docs/openclinxr"], ["docs/openclinxr-other"])).toBe(false);
  });

  it("handles trailing slash", () => {
    expect(writeRootsOverlap(["docs/openclinxr/"], ["docs/openclinxr"])).toBe(true);
  });

  it("handles leading ./", () => {
    expect(writeRootsOverlap(["./docs/openclinxr"], ["docs/openclinxr"])).toBe(true);
  });

  it("disjoint paths do not overlap", () => {
    expect(writeRootsOverlap(["apps/ui-xr"], ["packages/openclinxr"])).toBe(false);
  });
});

describe("greedyDisjointLanes", () => {
  it("returns k=1 for two cards sharing 3 of 4 roots", () => {
    const a = card("a", ["docs", "tools", "packages", "apps"], ["changed:docs/x.ts"]);
    const b = card("b", ["docs", "tools", "packages", "cli"], ["changed:cli/y.ts"]);
    const { k } = greedyDisjointLanes([a, b]);
    expect(k).toBe(1);
  });

  it("returns k=2 after read-only roots are removed", () => {
    // With only the truly-written roots remaining, the two cards no longer overlap.
    const a = card("a", ["apps"], ["changed:apps/x.ts"]);
    const b = card("b", ["cli"], ["changed:cli/y.ts"]);
    const { k } = greedyDisjointLanes([a, b]);
    expect(k).toBe(2);
  });

  it("three non-overlapping cards yield k=3", () => {
    const cards = [
      card("a", ["apps/ui-xr"], ["changed:apps/ui-xr/x.ts"]),
      card("b", ["apps/api"], ["changed:apps/api/x.ts"]),
      card("c", ["packages/domain"], ["changed:packages/domain/x.ts"]),
    ];
    const { k } = greedyDisjointLanes(cards);
    expect(k).toBe(3);
  });

  it("cards with empty writeRoots never collide", () => {
    const a = card("a", [], ["run:pnpm test"]);
    const b = card("b", [], ["run:pnpm lint"]);
    const { k } = greedyDisjointLanes([a, b]);
    expect(k).toBe(2);
  });
});

/**
 * The helpers above are correct in isolation; this drives the inversion through the AUDIT ITSELF,
 * because a correct helper nothing calls changes no lane count.
 *
 * The `run:` rule below names the evidence root LITERALLY, which is the case the old logic got
 * wrong: it joined every rule into one string and asked `proofs.includes(root)`, so this card
 * reported zero findings and kept a root it never writes.
 */
describe("auditBoardGraph wiring", () => {
  const readOnlyRootCard = {
    id: "tsk_wiring",
    title: "a card whose evidence root is only ever READ",
    status: "ready",
    // Not "Planted", and carrying no `live:` rule, so neither RED-presence finding can fire here.
    factory: "Idle",
    writeRoots: ["docs/openclinxr", "tools/openclinxr/evidence"],
    doneWhen: ["changed:docs/openclinxr/x.md", "run:pnpm exec vitest run tools/openclinxr/evidence/"],
  };

  it("reports the run:-only root as read-only, where the old string match reported nothing", () => {
    const findings = auditBoardGraph([readOnlyRootCard], process.cwd());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("write_root_is_read_only");
    expect(findings[0]?.detail).toContain("tools/openclinxr/evidence");
    expect(findings[0]?.detail).toContain("read-closure");
  });

  it("leaves the genuinely-written root alone", () => {
    const findings = auditBoardGraph([readOnlyRootCard], process.cwd());
    expect(findings.some((f) => f.detail.startsWith("write root docs/openclinxr "))).toBe(false);
  });
});
