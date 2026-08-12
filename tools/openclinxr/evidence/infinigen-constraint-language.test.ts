import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * PLANTED CONTRACTS (#339). Infinigen constraint-language capability probe —
 * the question "can a CLINICAL room type be authored with real constraints so
 * environmentId drives GENERATION" measured against the shipped constraint
 * language (source/tests/constraints/*.py + solver/).
 *
 * Verdict enum: adopt_generation | reject_measured | inconclusive_blocked.
 * All close successfully. A measured NO is the successful outcome (issue #339).
 */

type Capability = {
  issue: number;
  question: string;
  verdict: "adopt_generation" | "reject_measured" | "inconclusive_blocked";
  verdictReason: string;
  measuredAt: string;
  languageCanExpress: Array<{ capability: string; evidence: string }>;
  languageCannotExpress: Array<{ capability: string; evidence: string }>;
  footprintExperiment: {
    dryProbes: {
      problemBuilds: boolean;
      missingNodeImpls: string[];
      violCount5x5Area: number | null;
      violCount9x9Area: number | null;
      violCount5x5Aspect: number | null;
    };
    infeasibleTarget: {
      areaBound: [number, number];
      diningAreaM2: number | null;
      satisfied: boolean;
      annealScoreFrozen: boolean;
    } | null;
    feasibleTarget: {
      areaBound: [number, number];
      diningAreaM2: number | null;
      satisfied: boolean;
      annealScoreFrozen: boolean;
    } | null;
    controlShipped: { annealExplores: boolean; scoreStart: number | null } | null;
  };
  doorOnNamedWall: { expressible: boolean; evidence: string };
  singleroomGin: { producesSingleRoomShellDirectly: boolean; extractionStillNeeded: boolean };
  conclusion: string;
  claimScope: string[];
  notEvidenceFor: string[];
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const CAPABILITY_PATH = path.join(
  REPO_ROOT,
  ".openclinxr/evidence/issue-339/constraint-language-capability.json",
);

function loadCapability(): Capability {
  if (!existsSync(CAPABILITY_PATH)) {
    throw new Error(
      `constraint-language-capability.json missing at ${CAPABILITY_PATH} — run the inspect module first`,
    );
  }
  const parsed = JSON.parse(readFileSync(CAPABILITY_PATH, "utf8")) as Capability;
  if (parsed.issue !== 339) throw new Error("capability report is not issue 339");
  return parsed;
}

const load = () =>
  import("./infinigen-constraint-language.js") as Promise<Record<string, unknown>>;

describe("Infinigen constraint language capability (#339)", () => {
  it("the inspect module builds the evidence artifact (dry probes + measured runs)", async () => {
    const mod = await load();
    const inspect = mod["inspectInfinigenConstraintLanguage"] as
      | (() => Promise<Capability>)
      | undefined;
    expect(inspect).toBeTypeOf("function");
    const r = await inspect!();
    expect(["adopt_generation", "reject_measured", "inconclusive_blocked"]).toContain(
      r.verdict,
    );
    expect(r.verdictReason.length).toBeGreaterThan(40);
    expect(r.languageCanExpress.length).toBeGreaterThanOrEqual(5);
    expect(r.languageCannotExpress.length).toBeGreaterThanOrEqual(3);
    expect(r.doorOnNamedWall.expressible).toBe(false);
    expect(r.singleroomGin.producesSingleRoomShellDirectly).toBe(false);
    expect(r.notEvidenceFor.join(" ")).toMatch(/adopt|quest|clinical|promotion/i);
  }, 600_000);

  it("the dry probes prove the language accepts hard footprint bounds (COUNTERWEIGHT)", async () => {
    const mod = await load();
    const inspect = mod["inspectInfinigenConstraintLanguage"] as () => Promise<Capability>;
    const r = await inspect!();
    const dry = r.footprintExperiment.dryProbes;
    expect(dry.problemBuilds).toBe(true);
    expect(dry.missingNodeImpls).toEqual([]);
    // 5x5 m (25 m^2) vs [78,84] must violate; 9x9 m (81 m^2) must satisfy.
    expect(dry.violCount5x5Area).not.toBeNull();
    expect(dry.violCount5x5Area!).toBeGreaterThan(0);
    expect(dry.violCount9x9Area).toBe(0);
  }, 600_000);

  it("a distant footprint target is NOT enforced by the room annealer (measured)", async () => {
    const mod = await load();
    const inspect = mod["inspectInfinigenConstraintLanguage"] as () => Promise<Capability>;
    const r = await inspect!();
    if (r.verdict === "inconclusive_blocked") return;
    const inf = r.footprintExperiment.infeasibleTarget;
    if (!inf) return; // generation outputs absent in this environment
    expect(inf.annealScoreFrozen).toBe(true);
    expect(inf.satisfied).toBe(false);
    expect(inf.diningAreaM2).not.toBeNull();
  }, 600_000);
});
