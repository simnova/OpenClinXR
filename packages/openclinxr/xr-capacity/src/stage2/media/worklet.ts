import {STAGE2_CONFIG,STAGE2_PHASE_FOR_COMMAND} from "../grading/config.js";
import {COHERENT_TONE_DSP_SOURCE} from "./tone-dsp.js";
export const STAGE2_WORKLET_PROCESSOR="quest-stage2-synthetic-media-v1";
export const STAGE2_ROW_KEYS=["sequence","phaseCode","frameStart","frameEnd","sampleRate","quantumFirst","quantumLast","quantumMin","quantumMax","partialCode","frames","channels","channelSamples","finiteSamples","nonfiniteSamples","nonzeroSamples","sumSquares","peak","clippedSamples","missingFrames","frameDiscontinuities","sampleRateChanges","channelChanges","N","toneSumSquares","real400","imag400","real700","imag700","power400","power700","tagStart","tagEnd"] as const;
export const STAGE2_ROW_WIDTH=STAGE2_ROW_KEYS.length;
export const STAGE2_UNSENT_ROWS=64;
export const STAGE2_WORKLET_TYPED_BYTES=(STAGE2_UNSENT_ROWS*STAGE2_ROW_WIDTH+32)*8;
/** Separate generator and actual-remote monitor instances; every callback counted from the first actual currentFrame read. */
export const STAGE2_WORKLET_SOURCE=`
${COHERENT_TONE_DSP_SOURCE}
const CONFIG=${JSON.stringify(STAGE2_CONFIG)},PHASES=['setup','warmup','qualified','ended'],COMMAND_PHASE=${JSON.stringify(STAGE2_PHASE_FOR_COMMAND)},KEYS=${JSON.stringify(STAGE2_ROW_KEYS)},WIDTH=${STAGE2_ROW_WIDTH};
const HEALTH=['frames','channels','channelSamples','finiteSamples','nonfiniteSamples','nonzeroSamples','sumSquares','peak','clippedSamples','missingFrames','frameDiscontinuities','sampleRateChanges','channelChanges'];
function fresh(channels){return {frames:0,channels,channelSamples:0,finiteSamples:0,nonfiniteSamples:0,nonzeroSamples:0,sumSquares:0,peak:0,clippedSamples:0,missingFrames:0,frameDiscontinuities:0,sampleRateChanges:0,channelChanges:0};}
class Stage2Processor extends AudioWorkletProcessor{
 constructor(options){super();this.mode=options.processorOptions.mode;this.total=null;this.origin=null;this.lastFrame=null;this.blocks=0;this.phase='setup';this.bin=null;this.rows=new Float64Array(64*WIDTH);this.firstCallbacks=new Float64Array(32);this.count=0;this.sent=0;this.sequence=0;this.pending=false;this.coalesced=0;this.gapCount=0;this.marks=[];this.stopping=false;this.stopSamples=null;this.stopped=false;this.finalSent=false;this.overflow=0;
 this.port.onmessage=({data})=>{if(data.type==='ack'){if(!this.pending||data.sequence!==this.sequence){this.fail('invalid-report-ACK');return;}this.pending=false;this.send();}else if(data.type==='mark'){if(this.marks.length>=4||this.stopping||typeof data.markerId!=='string'||data.markerId.length>128||!Object.hasOwn(COMMAND_PHASE,data.command)){this.fail('invalid-marker');return;}this.marks.push(data);}else if(data.type==='stop')this.stopping=true;};}
 position(frame=currentFrame){return {processedFrames:this.total?.frames||0,sampleRate,channels:this.total?.channels||0,tag:{kind:'worklet-currentFrame',value:frame,timeBaseNumerator:1,timeBaseDenominator:sampleRate},atSourceMonotonicMs:currentTime*1000};}
 fail(reason){if(this.stopped)return;if(reason.includes('budget'))this.overflow++;this.stopped=true;this.port.postMessage({type:'fault',reason,total:this.total,position:this.position(),blocks:this.blocks});}
 newBin(channels,quantum){return {...fresh(channels),frameStart:this.total.frames,frameEnd:this.total.frames,sampleRate,quantumFirst:quantum,quantumLast:quantum,quantumMin:quantum,quantumMax:quantum,tagStart:currentFrame,tagEnd:currentFrame,dsp:new CoherentToneAccumulator(sampleRate)};}
 flush(reason){if(!this.bin||!this.bin.frames)return;if(this.count>=512){this.fail('health-row-budget');return;}if(this.count-this.sent>=64){this.fail('unsent-ring-budget');return;}const b=this.bin,t=b.dsp.summary();const row={...b,sequence:this.count,phaseCode:PHASES.indexOf(this.phase),partialCode:reason==='phase-boundary'?1:reason==='final-tail'?2:0,N:t.n,toneSumSquares:t.sumSquares,real400:t.real400,imag400:t.imag400,real700:t.real700,imag700:t.imag700,power400:t.power400,power700:t.power700};
 const at=(this.count%64)*WIDTH;for(let i=0;i<KEYS.length;i++)this.rows[at+i]=row[KEYS[i]];this.count++;this.bin=null;if(this.pending)this.coalesced++;this.send();}
 send(){if(this.pending)return;if(this.sent<this.count){const end=Math.min(this.count,this.sent+16),batch=new Float64Array((end-this.sent)*WIDTH);for(let row=this.sent;row<end;row++)for(let i=0;i<WIDTH;i++)batch[(row-this.sent)*WIDTH+i]=this.rows[(row%64)*WIDTH+i];this.sent=end;this.pending=true;this.sequence++;this.port.postMessage({type:'report',sequence:this.sequence,rows:batch,total:this.total,position:this.position(this.lastFrame),highWater:1,coalesced:this.coalesced,overflow:this.overflow},[batch.buffer]);}else if(this.stopped&&!this.finalSent){this.finalSent=true;const startup=this.blocks<8?this.firstCallbacks.slice(0,this.blocks*4):null;this.rows=null;this.firstCallbacks=null;this.port.postMessage({type:'final',storesReleased:true,total:this.total,position:this.position(this.lastFrame),rows:this.count,blocks:this.blocks,origin:this.origin,initialQuantum:this.initialQuantum,targetBinFrames:this.targetBinFrames,startup,coalesced:this.coalesced,overflow:this.overflow},startup?[startup.buffer]:[]);}}
 process(inputs,outputs){const output=outputs[0]||[];for(const channel of output)channel.fill(0);if(this.stopped)return false;const quantum=output[0]?.length||0;if(!quantum||output.length!==1||!['generator','monitor'].includes(this.mode)){this.fail('processor-shape');return false;}
 const input=inputs[0]||[],channels=this.mode==='generator'?1:input.length;
 if(!this.total){this.total=fresh(channels);this.observedRate=sampleRate;this.initialQuantum=quantum;this.targetBinFrames=Math.ceil(sampleRate*.5/quantum)*quantum;if(this.targetBinFrames/sampleRate>1){this.fail('unsupported-quantum');return false;}this.origin=this.position(currentFrame);this.bin=this.newBin(channels,quantum);}
 const gap=this.lastFrame!==null&&currentFrame!==this.lastFrame;if(gap){if(this.gapCount++>=8){this.fail('clock-gap-budget');return false;}this.port.postMessage({type:'clock-gap',expected:this.lastFrame,actual:currentFrame,quantum,ordinal:this.blocks});}
 while(this.marks.length){const mark=this.marks.shift();this.flush('phase-boundary');this.phase=COMMAND_PHASE[mark.command];this.port.postMessage({type:'mark',markerId:mark.markerId,command:mark.command,phase:this.phase,position:this.position(currentFrame)});}
 if(!this.bin)this.bin=this.newBin(channels,quantum);const b=this.bin;if(this.stopping&&this.stopSamples===null)this.stopSamples=Math.ceil(sampleRate*CONFIG.recipes.rampMs/1000);
 const startFrames=this.total.frames;let missing=0,channelSamples=0,finite=0,nonfinite=0,nonzero=0,squares=0,peak=0,clipped=0;
 if(this.mode==='monitor'&&(channels<1||input.some(channel=>channel.length!==quantum)))missing=quantum;
 for(let i=0;i<quantum;i++){
  let selected=0;if(this.mode==='generator'){
   const startup=Math.min(1,(startFrames+i)/(sampleRate*CONFIG.recipes.rampMs/1000)),ending=this.stopSamples===null?1:Math.max(0,this.stopSamples/(sampleRate*CONFIG.recipes.rampMs/1000));selected=CONFIG.recipes.sourcePeak*Math.sin(2*Math.PI*CONFIG.recipes.uplinkHz*(startFrames+i)/sampleRate)*Math.min(startup,ending);output[0][i]=selected;selected=output[0][i];
   channelSamples++;finite++;if(selected!==0)nonzero++;squares+=selected*selected;peak=Math.max(peak,Math.abs(selected));if(Math.abs(selected)>=.98)clipped++;
  }else{for(let c=0;c<channels;c++){const value=input[c][i];channelSamples++;if(Number.isFinite(value)){finite++;if(value!==0)nonzero++;squares+=value*value;peak=Math.max(peak,Math.abs(value));if(Math.abs(value)>=.98)clipped++;}else nonfinite++;}const value=input[0]?.[i];selected=Number.isFinite(value)?value:0;output[0][i]=selected;}
  b.dsp.add(selected);if(this.stopSamples!==null)this.stopSamples=Math.max(0,this.stopSamples-1);
 }
 for(let which=0;which<2;which++){const h=which?b:this.total;h.frames+=quantum;h.channelSamples+=channelSamples;h.finiteSamples+=finite;h.nonfiniteSamples+=nonfinite;h.nonzeroSamples+=nonzero;h.sumSquares+=squares;h.peak=Math.max(h.peak,peak);h.clippedSamples+=clipped;h.missingFrames+=missing;if(gap)h.frameDiscontinuities++;if(sampleRate!==this.observedRate)h.sampleRateChanges++;if(channels!==this.total.channels)h.channelChanges++;}
 b.frameEnd=this.total.frames;b.quantumLast=quantum;b.quantumMin=Math.min(b.quantumMin,quantum);b.quantumMax=Math.max(b.quantumMax,quantum);b.tagEnd=currentFrame+quantum;this.lastFrame=currentFrame+quantum;
 if(this.blocks<8){const at=this.blocks*4;this.firstCallbacks[at]=this.blocks;this.firstCallbacks[at+1]=currentFrame;this.firstCallbacks[at+2]=currentTime;this.firstCallbacks[at+3]=quantum;}
 this.blocks++;if(this.blocks===1)this.port.postMessage({type:'first',origin:this.origin,position:this.position(this.lastFrame),total:this.total,initialQuantum:this.initialQuantum,targetBinFrames:this.targetBinFrames});if(this.blocks===8){const startup=this.firstCallbacks.slice();this.port.postMessage({type:'startup',startup},[startup.buffer]);}
 if(this.total.frames>sampleRate*150){this.fail('processor-frame-budget');return false;}if(b.frames>=this.targetBinFrames){if(b.frames/sampleRate>1){this.fail('health-bin-duration');return false;}this.flush(null);}
 if(this.stopping&&this.stopSamples===0){this.flush('final-tail');this.stopped=true;this.send();return false;}return true;
 }
}
registerProcessor('${STAGE2_WORKLET_PROCESSOR}',Stage2Processor);
`;
