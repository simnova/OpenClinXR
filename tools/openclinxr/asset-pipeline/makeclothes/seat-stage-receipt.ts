/**
 * Seat-stage receipt pin (ci-w6 adaptation), used only by the rim-seat
 * determinism test and the registry-reproduces-the-receipt counterweight.
 *
 * The parent-body receipt is now multi-stage. The seat producer
 * (seat-teeth-on-lip-rim.ts) and the station registry emit the SEATED bytes;
 * three later deliberate stages moved the body further (2026-10-21
 * garment-provenance-stamp, 2026-10-22 mouthPhysicalCorrection via
 * seat-teeth-ff1-open08.ts, 2026-10-25 albedoRepair), so the receipt's
 * top-level outputSha256 is the FINAL bytes, not the seat bytes. The seat
 * bytes are recorded twice in the receipt: as the garment stamp's input and
 * as the mouth-physical stage's source baseline. Both must agree, or the
 * chain record itself is broken and this throws.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export function readSeatStageReceipt(
  repoRoot: string,
  receiptRel: string,
): { seatStageSha256: string } {
  const receipt = JSON.parse(readFileSync(path.join(repoRoot, receiptRel), "utf8")) as unknown as {
    garmentProvenanceStamp?: { inputArchiveSha256?: string };
    mouthPhysicalCorrection?: { sourceBaselineSha256?: string };
  };
  const stampInput = receipt.garmentProvenanceStamp?.inputArchiveSha256;
  const physicalBaseline = receipt.mouthPhysicalCorrection?.sourceBaselineSha256;
  if (typeof stampInput !== "string" || stampInput.length === 0) {
    throw new Error("receipt has no garmentProvenanceStamp.inputArchiveSha256 seat-stage pin");
  }
  if (stampInput !== physicalBaseline) {
    throw new Error(
      `receipt seat-stage chain broken: garment stamp input ${stampInput} != mouth-physical baseline ${physicalBaseline}`,
    );
  }
  return { seatStageSha256: stampInput };
}
