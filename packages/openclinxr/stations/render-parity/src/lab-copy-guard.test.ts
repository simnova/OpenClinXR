/** G1: sync guard for the lab regions the parity boot copies (cap42 2026-11-18).
 *
 * p2k copies runs of X/src/isolated-subject-lab.ts into X/src/parity/parity-lab.ts
 * so the lab stays byte-identical for the cornea pin. Until LAB-PARITY-DEDUPE
 * lands, a copied run must change in both files: this guard fails when a pinned
 * lab region changes without parity-lab.ts following (and vice versa).
 * Pins are content-anchored (sha256), NOT line numbers, so an insertion
 * elsewhere in the lab does not move them.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../../..");
const LAB_REL = "packages/openclinxr/xr-scene/src/isolated-subject-lab.ts";
const PARITY_REL = "packages/openclinxr/xr-scene/src/parity/parity-lab.ts";
const PARITY_DIR = "packages/openclinxr/xr-scene/src/parity";
const PINS_REL = "packages/openclinxr/stations/render-parity/src/lab-copy-pins.json";
const DEDUPE = "LAB-PARITY-DEDUPE tsk_fc8765e10b4f4f53";
const CARRY =
  "carry the change into both files and re-pin in " +
  "packages/openclinxr/stations/render-parity/src/lab-copy-pins.json; " +
  "do not delete this guard, invert it when the dedupe lands";
const REASON = "copied lab run must change in both files";

interface Pin {
  kind: "copied" | "reimplemented";
  labStartText: string;
  lineCount: number;
  sha256: string;
  parityFunction?: string;
  parityFile?: string;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

/** All 1-based start lines where `lines[i] === startText`. */
function anchorLines(lines: string[], startText: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < lines.length; i += 1) if (lines[i] === startText) out.push(i + 1);
  return out;
}

function failMessage(labRange: string, parityRange: string): string {
  return [
    `lab: ${LAB_REL} ${labRange}`,
    `parity: ${parityRange}`,
    `reason: ${REASON} (cap42 2026-11-18)`,
    DEDUPE,
    CARRY,
  ].join("\n");
}

const pins: Pin[] = JSON.parse(readFileSync(path.join(REPO, PINS_REL), "utf8")).pins;
const labText = readFileSync(path.join(REPO, LAB_REL), "utf8");
const labLines = labText.split("\n");
const parityText = readFileSync(path.join(REPO, PARITY_REL), "utf8");
const parityLines = parityText.split("\n");

function findParityDefinition(name: string): string | null {
  const files = readdirSync(path.join(REPO, PARITY_DIR))
    .filter((f) => f.endsWith(".ts"))
    .sort();
  const re = new RegExp(`function\\s+${name}\\s*\\(`);
  for (const f of files) {
    const lines = readFileSync(path.join(REPO, PARITY_DIR, f), "utf8").split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      if (re.test(lines[i] ?? "")) return `${PARITY_DIR}/${f}:${i + 1}`;
    }
  }
  return null;
}

describe("lab copy guard: copied runs stay in sync until the dedupe lands", () => {
  for (const pin of pins) {
    const label =
      pin.kind === "copied"
        ? `copied run ${JSON.stringify(pin.labStartText.slice(0, 48))} x${pin.lineCount}`
        : `reimplemented ${pin.parityFunction}`;
    it(label, () => {
      // Clause (1): the pinned text occurs in the lab exactly once with that sha.
      const candidates = anchorLines(labLines, pin.labStartText);
      const hits: number[] = [];
      for (const start of candidates) {
        const window = labLines.slice(start - 1, start - 1 + pin.lineCount).join("\n");
        if (sha256(window) === pin.sha256) hits.push(start);
      }
      const labRange =
        candidates.length === 0
          ? `labStartText not found: ${JSON.stringify(pin.labStartText)}`
          : `lines ${candidates[0]}-${candidates[0]! + pin.lineCount - 1}`;
      let parityRange: string;
      let parityOk: boolean;
      if (pin.kind === "copied") {
        const pAnchors = anchorLines(parityLines, pin.labStartText);
        parityRange =
          pAnchors.length === 0
            ? `${PARITY_REL} not found`
            : `${PARITY_REL} lines ${pAnchors[0]}-${pAnchors[0]! + pin.lineCount - 1}`;
        // Clause (2): the same text occurs in parity-lab.ts.
        parityOk =
          hits.length === 1 &&
          parityText.split(labLines.slice(hits[0]! - 1, hits[0]! - 1 + pin.lineCount).join("\n")).length - 1 === 1;
        if (parityOk) {
          const at = parityText.indexOf(
            labLines.slice(hits[0]! - 1, hits[0]! - 1 + pin.lineCount).join("\n"),
          );
          parityRange = `${PARITY_REL} lines ${lineOf(parityText, at)}-${lineOf(parityText, at) + pin.lineCount - 1}`;
        }
      } else {
        const found = findParityDefinition(pin.parityFunction ?? "");
        parityRange =
          found === null
            ? `${pin.parityFunction} not found in ${PARITY_DIR}/**`
            : `${pin.parityFunction} still defined at ${found}`;
        parityOk = found !== null;
      }
      expect(
        hits.length === 1 && parityOk,
        `\n${failMessage(labRange, parityRange)}\n`,
      ).toBe(true);
    });
  }
});
