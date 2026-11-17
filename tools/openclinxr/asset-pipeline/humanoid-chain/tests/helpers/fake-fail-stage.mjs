/**
 * fake-fail-stage.mjs — an in-place node stage that always fails.
 * Appends partial bytes to its single {out} argument (the runner's temp
 * path) then exits non-zero, proving the runner never promotes a temp
 * product to the final write-once name and instead writes a failed report.
 */
import { appendFileSync } from "node:fs";

const out = process.argv[2];
if (!out) {
  console.error("missing output path");
  process.exit(2);
}
appendFileSync(out, "PARTIAL");
process.exit(1);
