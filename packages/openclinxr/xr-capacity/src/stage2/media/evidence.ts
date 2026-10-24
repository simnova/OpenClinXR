import type {Stage2HealthBin,Stage2MarkExchange} from '../grading/types.js';

/** A deliberate mode rejection is distinct from an unrelated runtime failure. */
export class Stage2ExpectedNegative extends Error {}
export function stage2CompleteToneBins(bins:readonly Stage2HealthBin[],hz:400|700):boolean {
 const complete=bins.filter(b=>b.partialReason===null);
 return complete.length>0&&complete.every(b=>{const expected=hz===400?b.tone.power400:b.tone.power700,other=hz===400?b.tone.power700:b.tone.power400;return b.nonzeroSamples>0&&b.tone.sumSquares>0&&expected>=.5*b.tone.sumSquares/b.tone.N&&expected>=4*other;});
}

/** A command write is not an applied-output observation. Join the actual zero tail to its latch. */
export function stage2AppliedZero(healthy:Stage2HealthBin,bins:readonly Stage2HealthBin[],injectedAt:number,mark:Stage2MarkExchange):boolean {
 const latch=mark.browser.ack?.downlinkMonitor?.position;
 if(!Number.isFinite(injectedAt)||mark.command!=='warmup'||!latch||mark.browser.sentMs<injectedAt||mark.browser.receivedMs===null||mark.browser.receivedMs<mark.browser.sentMs)return false;
 const tail=bins.filter(b=>b.sequence>healthy.sequence&&b.frameEnd<=latch.processedFrames);
 const firstZero=tail.findIndex(b=>b.partialReason===null&&b.nonzeroSamples===0);
 if(firstZero<0)return false;
 const zero=tail.slice(firstZero);
 return zero.length>0&&zero.at(-1)?.frameEnd===latch.processedFrames&&zero.every((b,i)=>b.nonzeroSamples===0&&b.nonfiniteSamples===0&&b.finiteSamples===b.channelSamples&&(i===0||zero[i-1]?.frameEnd===b.frameStart));
}

/** Qualified duration comes from actual START/END latches on each clock, never later totals. */
export function stage2FiveSecondLatches(start:Stage2MarkExchange|undefined,end:Stage2MarkExchange):boolean {
 const a=start?.server.ack?.uplinkDecoded?.position,b=end.server.ack?.uplinkDecoded?.position,c=start?.browser.ack?.downlinkMonitor?.position,d=end.browser.ack?.downlinkMonitor?.position;
 return !!a&&!!b&&!!c&&!!d&&a.sampleRate===b.sampleRate&&c.sampleRate===d.sampleRate
  &&(b.processedFrames-a.processedFrames)/b.sampleRate>=5&&(d.processedFrames-c.processedFrames)/d.sampleRate>=5;
}
