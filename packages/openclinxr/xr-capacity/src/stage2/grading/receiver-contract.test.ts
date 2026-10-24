import { expect, it } from "vitest";
import { gradeStage2Run } from "../../entrypoints/stage2.js";
import type { Stage2RunRecord } from "../../entrypoints/stage2.js";
import { negativeFixture } from "../media/run.test-support.js";
type Stage2ReceiverDecodeSnapshot=NonNullable<Stage2RunRecord["receiverDecodeEvidence"]>["start"];
function receiverExercise(a:Stage2ReceiverDecodeSnapshot,b:Stage2ReceiverDecodeSnapshot):boolean {
 const {record,release}=negativeFixture("remote-output-disconnected");if(!record.receiverDecodeEvidence)throw Error("fixture");
 record.receiverDecodeEvidence.start={...a,receiverTrackId:a.receiverTrackId==="actual-receiver"?"downlink-receiver":a.receiverTrackId,ssrc:a.ssrc===123?700:a.ssrc};
 record.receiverDecodeEvidence.end={...b,receiverTrackId:b.receiverTrackId==="actual-receiver"?"downlink-receiver":b.receiverTrackId,ssrc:b.ssrc===123?700:b.ssrc};
 return gradeStage2Run(record,release).negative?.exercised===true;
}

const start: Stage2ReceiverDecodeSnapshot = { receiverTrackId: "actual-receiver", ssrc: 123, observedAtBrowserMs: 1700, totalSamplesReceived: 48000, concealedSamples: 128, totalAudioEnergy: .01, totalSamplesDuration: 1 };
const end: Stage2ReceiverDecodeSnapshot = { ...start, observedAtBrowserMs: 2300, totalSamplesReceived: 72000, concealedSamples: 256, totalAudioEnergy: .015, totalSamplesDuration: 1.5 };
it("accepts same-receiver nonconcealed sample, energy and duration progression", () => {
  expect(receiverExercise(start, end)).toBe(true);
});
it.each([
  { receiverTrackId: "borrowed" }, { ssrc: 456 }, { totalSamplesReceived: 47000 },
  { concealedSamples: 24128 }, { totalAudioEnergy: .01 }, { totalSamplesDuration: 1 },
  { observedAtBrowserMs: 1600 }, { totalSamplesReceived: 72000.5 }, { totalAudioEnergy: Infinity },
])("rejects missing/reset/mixed receiver or nonadvancing measurement %j", mutation => {
  expect(receiverExercise(start, { ...end, ...mutation })).toBe(false);
});
