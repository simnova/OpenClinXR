/**
 * C52c: the supine plant computes the same pose in node and in the GPU browser within 1e-4 m.
 * Reads c52c-plant-parity.json (written by c52c-plant-parity.mjs). Set C52C_PARITY_JSON to test another file
 * (the destructive probe does this). Tolerance 1e-4 is the plant's own convergence tolerance
 * (`Math.abs(deltaY) < 1e-4`, supine-deck-plant.ts), the same source as RED A.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { caseSetMatches, deriveShippedCases, inputTreeHash, redACases, treeIsCurrent, unionCases } from "./c52c-cases.mjs";
import { caseKey, comparePoses } from "./c52c-plant-core.mjs";

type Pose = { root: { position: number[]; quaternion: number[] }; bones: Record<string, number[]> };
type Row = { body: string; deck: string; inclineDeg: number; source: string[]; maxAbsBoneDeltaM: number; worstBone: string | null; rootPosDeltaM: number; rootQuatDelta: number; node: Pose; page: Pose };
type Parity = {
  headSha: string; inputTreeSha256: string; nodeVersion: string; userAgent: string; renderer: string; nodePid: number; browserPid: number;
  humanoidCountPolls: number; pageErrors: string[]; shippedCases: unknown[]; cases: Row[]; probe: unknown;
};

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const TOLERANCE_M = 1e-4;
const jsonPath = process.env["C52C_PARITY_JSON"] ?? join(ROOT, "tools/openclinxr/evidence/xr-sync/c52c-plant-parity.json");
const parity = JSON.parse(readFileSync(jsonPath, "utf8")) as Parity;
const head = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const red = redACases(ROOT) as { body: string; deck: string; inclineDeg: number }[];
const shipped = (await deriveShippedCases(ROOT)) as { body: string; deck: string; inclineDeg: number }[];
const expected = unionCases(red, shipped) as { body: string; deck: string; inclineDeg: number }[];
const fixture = JSON.parse(readFileSync(join(ROOT, "packages/openclinxr/xr-pose/src/__fixtures__/supine-plant-pose-before.json"), "utf8")) as { cases: { asset: string; condition: string; inclineDeg: number; root: Pose["root"]; bones: Pose["bones"] }[] };

const worstOf = (row: Row): number => {
  const d = comparePoses(row.node, row.page) as { maxAbsBoneDeltaM: number; rootPosDeltaM: number; rootQuatDelta: number };
  return Math.max(d.maxAbsBoneDeltaM, d.rootPosDeltaM, d.rootQuatDelta);
};

describe("the supine plant parity between node and the GPU browser", () => {
  it("the case set is the 8 RED A cases union every shipped supine case, count derived from the blueprint walk", () => {
    expect(red.length).toBe(8);
    expect(shipped.length).toBeGreaterThan(0);
    expect(caseSetMatches(parity.cases, expected)).toBe(true);
    expect(parity.cases.length).toBe(expected.length);
    for (const c of red) expect(parity.cases.some((row) => caseKey(row) === caseKey(c))).toBe(true);
  });

  it("the json's shippedCases equal the list this test re-derives from the blueprints, with their blueprint paths", () => {
    expect(parity.shippedCases).toEqual(JSON.parse(JSON.stringify(shipped)));
    for (const s of parity.shippedCases as { blueprintPath: string }[]) expect(s.blueprintPath).toMatch(/^packages\/openclinxr\/scenario-fixtures\/src\/.+\.ts$/);
  });

  it("a shipped case missing from the json fails the case-set check", () => {
    const dropped = parity.cases.filter((row) => caseKey(row) !== caseKey(shipped[0] as { body: string; deck: string; inclineDeg: number }));
    expect(dropped.length).toBe(parity.cases.length - 1);
    expect(caseSetMatches(dropped, expected)).toBe(false);
    expect(caseSetMatches(parity.cases, expected)).toBe(true);
  });

  it("the browser record is from Chrome on an ANGLE Metal renderer, read in the page, in a different process from node", () => {
    expect(parity.userAgent).toContain("Chrome");
    expect(parity.renderer).toContain("ANGLE Metal");
    expect(Number.isInteger(parity.nodePid) && parity.nodePid > 0).toBe(true);
    expect(Number.isInteger(parity.browserPid) && parity.browserPid > 0).toBe(true);
    expect(parity.nodePid).not.toBe(parity.browserPid);
    expect(parity.nodeVersion).toMatch(/^v\d+/);
  });

  it("the json belongs to this tree: headSha is HEAD or every plant input hashes as it does at HEAD", () => {
    const current = inputTreeHash(ROOT, expected.map((c) => c.body)) as string;
    expect(treeIsCurrent(parity, head, current)).toBe(true);
  });

  it("a json from another tree is refused: different headSha and a different input hash", () => {
    const current = inputTreeHash(ROOT, expected.map((c) => c.body)) as string;
    expect(treeIsCurrent({ ...parity, headSha: "0".repeat(40), inputTreeSha256: "f".repeat(64) }, head, current)).toBe(false);
    expect(treeIsCurrent({ ...parity, headSha: "0".repeat(40) }, head, current)).toBe(parity.inputTreeSha256 === current);
  });

  it("the page read waited for a stable registered humanoid count and the page raised no error", () => {
    expect(parity.humanoidCountPolls).toBeGreaterThanOrEqual(3);
    expect(parity.pageErrors).toEqual([]);
  });

  it("the node side ran the real plant: the 8 RED A cases equal the RED A fixture within 1e-4 on every bone and the root", () => {
    for (const row of fixture.cases) {
      if (row.condition === "bedless") continue;
      const hit = parity.cases.find((c) => caseKey(c) === caseKey({ body: row.asset, deck: "patient_stretcher", inclineDeg: row.inclineDeg }));
      expect(hit, `${row.asset} ${row.inclineDeg}`).toBeDefined();
      const d = comparePoses({ root: row.root, bones: row.bones }, (hit as Row).node) as { maxAbsBoneDeltaM: number; rootPosDeltaM: number; rootQuatDelta: number };
      expect(Math.max(d.maxAbsBoneDeltaM, d.rootPosDeltaM, d.rootQuatDelta)).toBeLessThanOrEqual(TOLERANCE_M);
    }
  });

  it("the comparator rejects a 2e-4 m bone offset and accepts the unmodified record (probe substitution, in memory)", () => {
    const row = parity.cases[0] as Row;
    const bone = Object.keys(row.page.bones)[10] as string;
    const p = row.page.bones[bone] as number[];
    const moved: Pose = { root: row.page.root, bones: { ...row.page.bones, [bone]: [p[0]! + 2e-4, p[1]!, p[2]!] } };
    expect((comparePoses(row.node, moved) as { maxAbsBoneDeltaM: number }).maxAbsBoneDeltaM).toBeGreaterThan(TOLERANCE_M);
  });

  it.each(parity.cases.map((row) => [`${row.body} ${row.inclineDeg} deg`, row] as const))("%s: node and browser agree within 1e-4 on every bone, root position and every root quaternion component", (_name, row) => {
    const d = comparePoses(row.node, row.page) as { maxAbsBoneDeltaM: number; rootPosDeltaM: number; rootQuatDelta: number };
    expect(Object.keys(row.node.bones).length).toBeGreaterThan(100);
    expect(Object.keys(row.page.bones).sort()).toEqual(Object.keys(row.node.bones).sort());
    expect(row.maxAbsBoneDeltaM).toBeCloseTo(d.maxAbsBoneDeltaM, 12);
    expect(d.maxAbsBoneDeltaM).toBeLessThanOrEqual(TOLERANCE_M);
    expect(d.rootPosDeltaM).toBeLessThanOrEqual(TOLERANCE_M);
    expect(d.rootQuatDelta).toBeLessThanOrEqual(TOLERANCE_M);
    expect(worstOf(row)).toBeLessThanOrEqual(TOLERANCE_M);
  });
});
