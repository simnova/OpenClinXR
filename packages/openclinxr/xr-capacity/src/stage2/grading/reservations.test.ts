import { expect, it } from "vitest";
import { STAGE2_CONFIG } from "../../entrypoints/stage2.js";
import { fixture } from "./fixtures.test-support.js";
import { gradeStage2Run } from "../../entrypoints/stage2.js";
import type { ReservationAudit, Stage2RunRecord } from "../../entrypoints/stage2.js";
type Stage2ResourceRecord=Stage2RunRecord["resources"];

it("partitions the same 1MiB cap before work and permits retained numeric history at close", () => {
  expect(Object.values(STAGE2_CONFIG.bounds.ownerReservationBytes).reduce((a, b) => a + b, 0)).toBe(1048576);
  const { record, release } = fixture();
  expect(record.resources.ownerReservations.python?.heldBytesAtClose).toBeGreaterThan(0);
  expect(gradeStage2Run(record, release).functionalPass).toBe(true);
});
it("does not sum category maxima that occurred at different instants", () => {
  const { record, release } = fixture(); const audit = record.resources.ownerReservations.browser;
  if (!audit) throw new Error("fixture");
  audit.categoryPeaks = { history: 500000, temporaryResponse: 500000 };
  expect(gradeStage2Run(record, release).functionalPass).toBe(true);
});
it("rejects a missing required outer audit instead of silently supplying zero", () => {
  const { record, release } = fixture();
  Reflect.deleteProperty(record.resources, "ownerReservations");
  expect(gradeStage2Run(record, release).functionalPass).toBe(false);
});
it.each(["browser", "python", "gateway"] as const)("retains null %s audit but cannot qualify it", owner => {
  const { record, release } = fixture(); record.resources.ownerReservations[owner] = null;
  expect(gradeStage2Run(record, release).functionalPass).toBe(false);
});
it.each(["browser", "python", "gateway"] as const)("rejects zero observed reservations for necessarily used %s owner", owner => {
  const { record, release } = fixture(); const audit = record.resources.ownerReservations[owner];
  if (!audit) throw new Error("fixture");
  audit.peakBytes = 0; audit.heldBytesAtClose = 0; audit.categoryPeaks = {};
  expect(gradeStage2Run(record, release).functionalPass).toBe(false);
});
const invalid: Array<[string, (audit: ReservationAudit) => void]> = [
  ["cross-owner limit", a => { a.limitBytes = 327680; }],
  ["invented capacity", a => { a.limitBytes++; }],
  ["peak overflow", a => { a.peakBytes = a.limitBytes + 1; }],
  ["held larger than observed peak", a => { a.heldBytesAtClose = a.peakBytes + 1; }],
  ["reservation refusal", a => { a.rejectedReservations++; }],
  ["unsealed growth", a => { a.closed = false; }],
  ["nonfinite peak", a => { a.peakBytes = Infinity; }],
  ["fractional peak", a => { a.peakBytes = 1.5; }],
  ["negative held count", a => { a.heldBytesAtClose = -1; }],
  ["category above simultaneous owner peak", a => { a.categoryPeaks["large"] = a.peakBytes + 1; }],
  ["nonfinite category", a => { a.categoryPeaks["bad"] = NaN; }],
  ["fractional category", a => { a.categoryPeaks["bad"] = .5; }],
  ["missing category coverage", a => { a.categoryPeaks = { onlyCategory: a.peakBytes - 1 }; }],
  ["empty categories with nonzero peak", a => { a.categoryPeaks = {}; }],
  ["array of categories", a => { a.categoryPeaks = [] as unknown as Record<string, number>; }],
];
it.each(invalid)("rejects %s in an actual owner audit", (_name, mutate) => {
  const { record, release } = fixture(); const audit = record.resources.ownerReservations.browser;
  if (!audit) throw new Error("fixture"); mutate(audit);
  expect(gradeStage2Run(record, release).functionalPass).toBe(false);
});
it("does not substitute reservation capacity for measured scoped payload totals", () => {
  const { record, release } = fixture();
  record.resources.typedHealthBytes = record.resources.ownerReservations.browser?.limitBytes ?? 0;
  expect(gradeStage2Run(record, release).functionalPass).toBe(false);
});
it("missing, refused and unclosed audits are hard resource failures used by every negative mode", () => {
  const { record, release } = fixture();
  for (const mutate of [
    (x: Stage2ResourceRecord) => { x.ownerReservations.python = null; },
    (x: Stage2ResourceRecord) => { if (x.ownerReservations.gateway) x.ownerReservations.gateway.rejectedReservations++; },
    (x: Stage2ResourceRecord) => { if (x.ownerReservations.browser) x.ownerReservations.browser.closed = false; },
  ]) {
    const copy = structuredClone(record); mutate(copy.resources);
    expect(gradeStage2Run(copy, release).reasons.some(code => code.includes("reservation"))).toBe(true);
  }
});
