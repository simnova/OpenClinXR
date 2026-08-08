#!/usr/bin/env tsx
/**
 * Orchestrator-owned value decisions.
 *
 * From the #204 retro, which named a failure I created by removing target numbers from contracts:
 *
 *   "Uniformity-only was correct... But once the mechanism worked, I INVENTED A DERIVATION TARGET
 *    so I would not have to sit with 'recommend and wait'. That is exactly the threshold-as-design-
 *    target failure the brief warned about — just RELOCATED FROM THE CONTRACT INTO MY RATIONALE."
 *
 * Four slices of removing numbers from contracts did not remove the pressure to have a number; it
 * moved that pressure to whoever finishes the work. A worker cannot ship "recommend and wait", so it
 * will produce a justification instead — and a justification is unfalsifiable in a way a contract is
 * not. The worker's own summary: "L5 plus 'recommend with a reason' becomes IMPLEMENTER DECIDES
 * UNDER A GEOMETRY ALIBI, which is what happened."
 *
 * So the boundary is made explicit rather than assumed:
 *
 *   record   — the ORCHESTRATOR writes the chosen value after grading a rendered sweep
 *   assert   — a contract reads that file and fails unless the shipping constant matches
 *
 * This does not defeat a hostile worker and is not trying to. It removes the AMBIGUITY about who
 * owns a value, which is what let a geometry argument stand in for a graded decision.
 *
 *   record:  value-decision.ts record <slice> <key> <value> --sheet <path> --why "<reason>"
 *   read:    value-decision.ts read <slice> <key>
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type ValueDecision = {
  slice: string;
  key: string;
  value: number;
  /** The rendered sweep this was graded from. A decision with no sheet is a guess. */
  gradedFrom: string;
  why: string;
  decidedBy: "orchestrator";
  at: string;
};

export function decisionPath(repoRoot: string, slice: string): string {
  return join(repoRoot, ".openclinxr", "evidence", slice, "value-decisions.json");
}

export function readDecision(repoRoot: string, slice: string, key: string): ValueDecision | null {
  const path = decisionPath(repoRoot, slice);
  if (!existsSync(path)) return null;
  try {
    const all = JSON.parse(readFileSync(path, "utf8")) as ValueDecision[];
    return all.find((d) => d.key === key) ?? null;
  } catch {
    return null;
  }
}

export function recordDecision(repoRoot: string, decision: Omit<ValueDecision, "decidedBy" | "at">): void {
  if (!existsSync(join(repoRoot, decision.gradedFrom))) {
    throw new Error(
      `value-decision: the sheet ${decision.gradedFrom} does not exist. A value decision must be `
      + `graded from a rendered sweep — recording one without a sheet is the guess this exists to stop.`,
    );
  }
  const path = decisionPath(repoRoot, decision.slice);
  mkdirSync(dirname(path), { recursive: true });
  const existing: ValueDecision[] = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as ValueDecision[])
    : [];
  const next = [
    ...existing.filter((d) => d.key !== decision.key),
    { ...decision, decidedBy: "orchestrator" as const, at: new Date().toISOString() },
  ];
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
}

/** For use inside a planted contract. Fails loudly when the value was never graded. */
export function assertMatchesOrchestratorChoice(
  repoRoot: string,
  slice: string,
  key: string,
  actual: number,
  tolerance = 1e-6,
): void {
  const decision = readDecision(repoRoot, slice, key);
  if (!decision) {
    throw new Error(
      `value-decision: no orchestrator decision recorded for ${slice}/${key}. The shipping value is `
      + `${actual}, chosen by whoever wrote it. Render the sweep, have it graded, then record the `
      + `choice — do not ship a number the orchestrator has not seen in a sheet.`,
    );
  }
  if (Math.abs(decision.value - actual) > tolerance) {
    throw new Error(
      `value-decision: ${slice}/${key} ships ${actual} but the orchestrator chose ${decision.value} `
      + `(graded from ${decision.gradedFrom}: ${decision.why}). The implementer does not own this value.`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, slice, key, raw] = process.argv.slice(2);
  const flag = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 ? process.argv[i + 1] : undefined;
  };
  if (cmd === "read" && slice && key) {
    const d = readDecision(process.cwd(), slice, key);
    if (!d) { console.error(`no decision for ${slice}/${key}`); process.exit(1); }
    console.log(JSON.stringify(d, null, 2));
  } else if (cmd === "record" && slice && key && raw) {
    const sheet = flag("sheet");
    const why = flag("why");
    if (!sheet || !why) {
      console.error('record requires --sheet <path> and --why "<reason>"');
      process.exit(2);
    }
    recordDecision(process.cwd(), { slice, key, value: Number(raw), gradedFrom: sheet, why });
    console.log(`recorded ${slice}/${key} = ${raw} (graded from ${sheet})`);
  } else {
    console.error('usage: value-decision.ts record <slice> <key> <value> --sheet <path> --why "<reason>"');
    console.error("       value-decision.ts read <slice> <key>");
    process.exit(2);
  }
}
