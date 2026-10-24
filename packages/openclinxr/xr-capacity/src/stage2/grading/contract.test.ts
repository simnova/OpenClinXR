import { describe, expect, it } from "vitest";
import { STAGE2_CONFIG, STAGE2_PROTOCOL_SHA256, gradeStage2Run } from "../../entrypoints/stage2.js";
import {fixture} from "./fixtures.test-support.js";
import {workletFlow} from "../media/run.test-support.js";

describe("prospective Stage2 units and frozen criteria", () => {
  it("keeps fixed policy, content criteria, lifecycle and explicit bounded histories", () => {
    expect(STAGE2_PROTOCOL_SHA256).toBe("212aada18426eb1c30c5c0b5740b26d28220e361b3456446a9ff05b66ba830a6");
    expect(STAGE2_CONFIG.analysis.minimumExpectedFraction).toBe(.5);
    expect(STAGE2_CONFIG.analysis.minimumExpectedToOtherRatio).toBe(4);
    expect(STAGE2_CONFIG.timing).toEqual({ setupMs: 20000, warmupMs: 10000, qualifiedMs: 70000, drainMs: 5000, peerLifetimeMs: 150000, contextLifetimeMs: 150000, driverDeadlineMs: 165000, earlyCloseQualifiedMs: 5000 });
    expect(STAGE2_CONFIG.bins.maximumRowsPerDecodedDirection).toBe(512);
    expect(STAGE2_CONFIG.bins.maximumRowsPerSource).toBe(512);
    expect(STAGE2_CONFIG.bins.maximumStatsPageRows).toBe(16);
    expect(STAGE2_CONFIG.bounds.maximumOwnedTypedAndKnownPayloadBytes).toBe(1048576);
    const h=workletFlow();h.step();for(const command of ["ready","warmup","start","end"]){h.command({type:"mark",markerId:command,command});h.step();}expect(Object.fromEntries(h.messages.filter(m=>m.type==="mark").map(m=>[m.command,m.phase]))).toEqual({ready:"setup",warmup:"warmup",start:"qualified",end:"ended"});
  });
  it.each([[48000, 128, 24064], [44100, 128, 22144], [48000, 960, 24000], [48000, 192, 24000]])("rounds observed rate %s with actual first quantum %s", (rate, quantum, expected) => {
    const h=workletFlow("generator",rate);h.step(quantum);expect(h.node.targetBinFrames).toBe(expected);
  });
  it.each([[NaN, 128], [48000, 0], [48000, 1.5], [48000, 48001]])("rejects invalid or unsupported bin construction %s/%s", (rate, quantum) => {
    const {record,release}=fixture();record.sources.uplink.initialQuantum=quantum;record.sources.uplink.targetBinFrames=Number.isFinite(rate)?Math.ceil(rate*.5/quantum)*quantum:rate;expect(gradeStage2Run(record,release).functionalPass).toBe(false);
  });
  it("counts stereo channel samples without doubling time or tone N", () => {
    const good=fixture();expect(gradeStage2Run(good.record,good.release).functionalPass).toBe(true);
    for(const corrupt of [(b:typeof good.record.decoded.uplink.bins[number])=>{b.tone.N=b.channelSamples;},(b:typeof good.record.decoded.uplink.bins[number])=>{b.channelSamples=b.frames;},(b:typeof good.record.decoded.uplink.bins[number])=>{b.frames=1.5;b.tone.N=1.5;}]){const {record,release}=fixture();const first=record.decoded.uplink.bins[0];if(!first)throw Error("fixture");corrupt(first);expect(gradeStage2Run(record,release).functionalPass).toBe(false);}
  });
  it("uses finite coherent aggregate energy without ratios or PCM", () => {
    const good=fixture();expect(gradeStage2Run(good.record,good.release).functionalPass).toBe(true);
    for(const mutate of [(b:typeof good.record.decoded.uplink.bins[number])=>{b.tone.power400=0;},(b:typeof good.record.decoded.uplink.bins[number])=>{b.tone.real400=Infinity;},(b:typeof good.record.decoded.uplink.bins[number])=>{b.tone.N=0;}]){const {record,release}=fixture();const first=record.decoded.uplink.bins[0];if(!first)throw Error("fixture");mutate(first);expect(gradeStage2Run(record,release).functionalPass).toBe(false);}
  });

});
