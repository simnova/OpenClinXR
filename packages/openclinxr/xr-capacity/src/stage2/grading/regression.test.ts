import { expect, it } from "vitest";
import { at, fixture, history, recount, syncRows } from "./fixtures.test-support.js";
import { gradeStage2Run } from "../../entrypoints/stage2.js";
import type { Stage2RunRecord } from "../../entrypoints/stage2.js";
type Stage2HealthBin=Stage2RunRecord["sources"]["uplink"]["bins"][number];

it("does not permit arbitrary same-phase partial cuts to waive complete-bin tone", () => {
  const { record, release } = fixture(); const h = record.decoded.downlink; const rows: Stage2HealthBin[] = [];
  for (const b of h.bins) {
    if (b.phase !== "qualified") { rows.push(b); continue; }
    const parts = b.frames >= (h.targetBinFrames ?? Infinity) ? [b.frames / 2, b.frames / 2] : [b.frames];
    let start = b.frameStart;
    for (const frames of parts) {
      const n = structuredClone(b); const ratio = frames / b.frames;
      n.frameStart = start; n.frameEnd = start + frames; n.frames = frames;
      for (const key of ["channelSamples", "finiteSamples", "nonfiniteSamples", "nonzeroSamples", "sumSquares", "clippedSamples", "missingFrames", "frameDiscontinuities", "sampleRateChanges", "channelChanges"] as const) n[key] = b[key] * ratio;
      n.tagStart.value = b.tagStart.value + start - b.frameStart; n.tagEndExclusive.value = n.tagStart.value + frames;
      n.partialReason = "phase-boundary";
      n.tone = { analysisChannel: 0, N: frames, sumSquares: frames * .0002, real400: frames * .01, imag400: 0, real700: 0, imag700: 0, power400: .0002, power700: 0 };
      rows.push(n); start += frames;
    }
  }
  h.bins = rows; h.bins.forEach((b, i) => { b.sequence = i; }); recount(h); syncRows(record);
  const grade = gradeStage2Run(record, release);
  expect(grade.functionalPass).toBe(false);
  expect(grade.reasons).toContain("window.actual-latch-bin-boundaries");
});
it("accepts a real same-phase ready/setup cut bound to each actual path latch", () => {
  const { record, release } = fixture();
  for (const h of [record.sources.uplink, record.sources.downlink, record.decoded.uplink, record.decoded.downlink]) {
    const kind = h.origin?.tag.kind ?? "worklet-currentFrame";
    Object.assign(h, history(kind === "decoded-pts" || h === record.sources.uplink ? 400 : 700, h.total.channels, h.initialQuantum ?? 128, kind, [["setup", 19200], ["setup", 28800], ["warmup", 480000], ["qualified", 3360000], ["ended", (h.initialQuantum ?? 128) * 2]]));
  }
  const ready = record.marks[0]; if (!ready?.server.ack || !ready.browser.ack) throw new Error("fixture");
  if (ready.server.ack.uplinkDecoded) ready.server.ack.uplinkDecoded.position = at(record.decoded.uplink, 19200);
  if (ready.server.ack.downlinkSource) ready.server.ack.downlinkSource.position = at(record.sources.downlink, 19200);
  if (ready.browser.ack.uplinkSource) ready.browser.ack.uplinkSource.position = at(record.sources.uplink, 19200);
  if (ready.browser.ack.downlinkMonitor) ready.browser.ack.downlinkMonitor.position = at(record.decoded.downlink, 19200);
  syncRows(record);
  expect(gradeStage2Run(record, release).reasons).toEqual([]);
});
it("rejects coherently relabelled browser render-source clock roles", () => {
  const { record, release } = fixture(); const h = record.sources.uplink;
  if (!h.origin || !h.final) throw new Error("fixture");
  h.origin.tag.kind = "generated-pts"; h.final.tag.kind = "generated-pts";
  for (const b of h.bins) { b.tagStart.kind = "generated-pts"; b.tagEndExclusive.kind = "generated-pts"; }
  for (const mark of record.marks) { const l = mark.browser.ack?.uplinkSource; if (l) l.position.tag.kind = "generated-pts"; }
  expect(gradeStage2Run(record, release).reasons).toContain("uplink.generated-source");
});
