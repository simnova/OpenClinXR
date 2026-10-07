/**
 * Solution application (MADR 0061 mouth executor).
 *
 * The executor runs the job: it validates the pinned solution against the input
 * bytes, seats the lower teeth on the lip rim with the operator-set target, and
 * returns the seated bytes plus the receipt note. It never computes a solution
 * (d6): no solver id, no tuning value and no solve callback appear in this entry.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Solution } from "@openclinxr/station-mouth-objective";
import { buildSeatedGlb, sha256Hex } from "./seat-write.js";
import { inputHashForBytes } from "./problem.js";
import { planRimSeat } from "./seat-plan.js";

/**
 * Provenance the caller supplies with a solution.
 *
 * The operator-set rest target travels here (the M1 Problem shape carries asset
 * and track identity only). Solver id and version name the pinned solver whose
 * output this application claims to carry; the verifier re-runs that solver.
 */
export type ApplyProvenance = {
  /** Rest rim-gap target, head-local mm; the committed seat uses 3.743. */
  targetGapMm: number;
  /** Solver id the solution claims; must equal the solution's solverId. */
  solverId: string;
  /** Solver version the solution claims; must equal the solution's solverVersion. */
  solverVersion: string;
};

/** Seated bytes plus the receipt note recording what ran. */
export type ApplyResult = {
  /** Seated GLB bytes. */
  glbBytes: Uint8Array;
  /** One-line provenance note for the receipt (solver, input hash, target, honest rest gap). */
  receiptNote: string;
};

// Pinned producer configuration: the committed receipt's argv
// (--target-gap-mm 3.743 --down-gain 1.25 --rest-drop-mm 4.215 --ff-lip-contact,
// from the receipt's latest seat-teeth-on-lip-rim.ts sourceNotes entry via
// producerArgvFromReceipt). Private to the package: the public entry carries no
// tuning value (MADR 0061 d6). A retune lands here with the receipt, never in a signature.
const PINNED_DOWN_GAIN = 1.25;
const PINNED_REST_DROP_MM = 4.215;
const PINNED_FF_LIP_CONTACT = true;
const PINNED_FORCE_RIGID = false;

/**
 * Apply a pinned solution to unseated GLB bytes.
 *
 * Fail-closed: the solution's input hash must equal the input bytes' hash, and
 * the provenance must name the solution's solver id and version. Until the
 * registry card wires the pin, the caller carries the committed receipt values.
 */
export async function apply(
  glbBytes: Uint8Array,
  solution: Solution,
  provenance: ApplyProvenance,
): Promise<ApplyResult> {
  if (!Number.isFinite(provenance.targetGapMm) || provenance.targetGapMm <= 0) {
    throw new Error(`bad targetGapMm ${provenance.targetGapMm}`);
  }
  const inputHash = inputHashForBytes(glbBytes);
  if (solution.inputHash !== inputHash) {
    throw new Error("solution inputHash does not match the input bytes");
  }
  if (solution.solverId !== provenance.solverId || solution.solverVersion !== provenance.solverVersion) {
    throw new Error("provenance solver id/version does not match the solution");
  }
  const dir = mkdtempSync(path.join(tmpdir(), "mouth-executor-apply-"));
  try {
    const tmpPath = path.join(dir, "input.glb");
    writeFileSync(tmpPath, glbBytes);
    const seat = await planRimSeat(
      tmpPath,
      provenance.targetGapMm,
      PINNED_FORCE_RIGID,
      PINNED_DOWN_GAIN,
      PINNED_REST_DROP_MM,
      PINNED_FF_LIP_CONTACT,
    );
    const out = buildSeatedGlb(glbBytes, seat);
    const receiptNote =
      `mouth-executor apply: solver ${provenance.solverId}/${provenance.solverVersion}, ` +
      `input ${inputHash.slice(0, 12)}, target-gap-mm ${provenance.targetGapMm}, ` +
      `honest rest ${seat.plan.honestRestGapMm} mm, output ${sha256Hex(out).slice(0, 12)}`;
    return { glbBytes: out, receiptNote };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
