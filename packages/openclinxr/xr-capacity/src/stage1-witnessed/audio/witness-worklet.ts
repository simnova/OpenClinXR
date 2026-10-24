import {WITNESS_COUNTER_KEYS,WITNESS_ROW_WIDTH} from "./witness-recorder.js";
export const WITNESS_WORKLET_PROCESSOR="quest-stage1-persistent-witness-v1";
/** Exact static module bytes; all actual callbacks from first process are accounted without PCM or per-quantum messages. */
export const WITNESS_WORKLET_SOURCE=`
const KEYS=${JSON.stringify(WITNESS_COUNTER_KEYS)},WIDTH=${WITNESS_ROW_WIDTH};
function fresh(frame){return {frameStart:frame,frameEnd:frame,sampleRate,blocks:0,frames:0,quantumMin:0,quantumMax:0,frameDiscontinuities:0,sampleRateChanges:0,nonfiniteOutputSamples:0,nonzeroOutputSamples:0};}
class Witness extends AudioWorkletProcessor{
 constructor(){super();this.total=null;this.bin=null;this.last=null;this.firstEight=new Float64Array(32);this.gapStorage=new Float64Array(32);this.gapCount=0;this.rows=new Float64Array(512*WIDTH);this.count=0;this.sent=0;this.sequence=0;this.pending=false;this.coalesced=0;this.overflow=0;this.stopping=false;this.stopped=false;this.finalSent=false;this.attachPending=false;this.attachSeen=null;
 this.port.onmessage=({data})=>{if(data.type==='ack'){if(!this.pending||data.sequence!==this.sequence){this.fail('bad-witness-ack');return;}this.pending=false;this.send();}else if(data.type==='attached'){if(this.attachPending||this.attachSeen)this.fail('duplicate-attachment');else this.attachPending=true;}else if(data.type==='stop')this.stopping=true;};}
 fail(reason){this.overflow++;this.stopped=true;this.port.postMessage({type:'fault',reason});}
 flush(){if(!this.bin||!this.bin.blocks)return;if(this.count>=512){this.fail('witness-row-budget');return;}const at=this.count*WIDTH;this.rows[at]=this.count;for(let j=0;j<KEYS.length;j++)this.rows[at+j+1]=this.bin[KEYS[j]];this.count++;this.bin=null;if(this.pending)this.coalesced++;this.send();}
 send(){if(this.pending)return;if(this.sent<this.count){const end=Math.min(this.count,this.sent+16),batch=this.rows.slice(this.sent*WIDTH,end*WIDTH);this.sent=end;this.pending=true;this.sequence++;this.port.postMessage({type:'report',sequence:this.sequence,rows:batch,counters:this.total,coalesced:this.coalesced,highWater:1,overflow:this.overflow},[batch.buffer]);}else if(this.stopping&&!this.finalSent){this.finalSent=true;const gaps=this.gapStorage.slice(0,this.gapCount*4),first=this.total.blocks<8?this.firstEight.slice(0,this.total.blocks*4):null;this.port.postMessage({type:'final',counters:this.total,rows:this.count,gaps,firstEight:first,attachSeen:this.attachSeen,coalesced:this.coalesced,overflow:this.overflow},first?[gaps.buffer,first.buffer]:[gaps.buffer]);}}
 process(_inputs,outputs){const channels=outputs[0]||[];for(const channel of channels)channel.fill(0);if(this.stopped)return false;const quantum=channels[0]?.length||0;if(!quantum||channels.length!==1){this.fail('witness-output-shape');return false;}
 if(!this.total){this.total=fresh(currentFrame);this.bin=fresh(currentFrame);}if(this.stopping){this.flush();this.stopped=true;this.send();return false;}if(!this.bin)this.bin=fresh(currentFrame);
 const ordinal=this.total.blocks;if(this.attachPending){this.attachPending=false;this.attachSeen={ordinal,frame:currentFrame};}
 const gap=this.last!==null&&currentFrame!==this.last;if(gap){if(this.gapCount>=8){this.fail('witness-gap-budget');return false;}const at=this.gapCount++*4;this.gapStorage[at]=this.last;this.gapStorage[at+1]=currentFrame;this.gapStorage[at+2]=quantum;this.gapStorage[at+3]=ordinal;this.port.postMessage({type:'clock-gap',expected:this.last,actual:currentFrame,quantum,ordinal});}
 let nonfinite=0,nonzero=0;for(const channel of channels)for(const value of channel){if(!Number.isFinite(value))nonfinite++;else if(value!==0)nonzero++;}
 for(let which=0;which<2;which++){const c=which?this.bin:this.total;c.blocks++;c.frames+=quantum;c.frameEnd=currentFrame+quantum;c.quantumMin=c.quantumMin?Math.min(c.quantumMin,quantum):quantum;c.quantumMax=Math.max(c.quantumMax,quantum);if(gap)c.frameDiscontinuities++;if(c.sampleRate!==sampleRate)c.sampleRateChanges++;c.nonfiniteOutputSamples+=nonfinite;c.nonzeroOutputSamples+=nonzero;}
 this.last=currentFrame+quantum;if(ordinal<8){const at=ordinal*4;this.firstEight[at]=ordinal;this.firstEight[at+1]=currentFrame;this.firstEight[at+2]=currentTime;this.firstEight[at+3]=quantum;if(ordinal===7){const first=this.firstEight.slice();this.port.postMessage({type:'primed',firstEight:first,lastFrameStart:currentFrame,counters:this.total},[first.buffer]);}}
 if(this.total.frames>sampleRate*150){this.fail('witness-frame-budget');return false;}if(this.bin.frames>=sampleRate*.5)this.flush();return true;
 }
}
registerProcessor('${WITNESS_WORKLET_PROCESSOR}',Witness);
`;
