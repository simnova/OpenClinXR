import { COUNTER_KEYS, AUDIO_ROW_WIDTH } from "./recorder.js";
export const DUPLEX_WORKLET_PROCESSOR = "quest-stage1-duplex-v1";
/** This exact UTF8 string is emitted as the independently hashed static worklet asset. */
export const DUPLEX_WORKLET_SOURCE = `
const KEYS=${JSON.stringify(COUNTER_KEYS)}, WIDTH=${AUDIO_ROW_WIDTH};
function fresh(frame){return {frameStart:frame,frameEnd:frame,sampleRate,blocks:0,frames:0,channelFrames:0,finiteSamples:0,nonfiniteSamples:0,nonzeroSamples:0,sumSquares:0,peak:0,clipSamples:0,missingInputBlocks:0,frameDiscontinuities:0,quantumMin:0,quantumMax:0,sampleRateChanges:0,zeroOutputNonzeroSamples:0};}
class DuplexMeter extends AudioWorkletProcessor {
 constructor(options){super();this.mode=options.processorOptions.mode;this.total=null;this.bin=null;this.rows=new Float64Array(512*WIDTH);this.count=0;this.sent=0;this.pending=false;this.sequence=0;this.phase=0;this.marks=[];this.stopping=false;this.stopped=false;this.lastFrame=null;this.coalesced=0;this.highWater=0;this.overflow=0;this.first=true;this.finalSent=false;this.gapReports=0;
  this.port.onmessage=({data})=>{if(data.type==='ack'){if(!this.pending||data.sequence!==this.sequence){this.fail('bad-report-ack');return;}this.pending=false;this.send();}
   else if(data.type==='mark'){if(this.marks.length>=8||this.stopping)this.fail('mark-budget');else this.marks.push(data);}
   else if(data.type==='stop'){this.stopping=true;}
  };
 }
 fail(reason){this.overflow++;this.stopped=true;this.port.postMessage({type:'fault',reason});}
 flush(partial){if(!this.bin||!this.bin.blocks)return;if(this.count>=512){this.fail('row-budget');return;}
  const at=this.count*WIDTH;this.rows[at]=this.count;this.rows[at+1]=this.phase;this.rows[at+2]=partial?1:0;
  for(let j=0;j<KEYS.length;j++)this.rows[at+3+j]=this.bin[KEYS[j]];
  this.count++;this.bin=null;
  if(this.pending)this.coalesced++;this.send();
 }
 send(){if(this.pending)return;if(this.sent<this.count){const end=Math.min(this.count,this.sent+16),batch=this.rows.slice(this.sent*WIDTH,end*WIDTH);this.sent=end;this.pending=true;this.highWater=1;this.sequence++;
   this.port.postMessage({type:'report',sequence:this.sequence,rows:batch,counters:this.total,coalesced:this.coalesced,highWater:this.highWater,overflow:this.overflow},[batch.buffer]);
  }else if(this.stopping&&!this.finalSent){this.finalSent=true;this.port.postMessage({type:'final',counters:this.total,rows:this.count,coalesced:this.coalesced,highWater:this.highWater,overflow:this.overflow});}
 }
 process(inputs,outputs){const output=outputs[0]||[];for(const c of output)c.fill(0);if(this.stopped)return false;
  const quantum=output[0]?.length||0;if(!quantum){this.fail('empty-output-quantum');return false;}
  if(!this.total){this.total=fresh(currentFrame);this.bin=fresh(currentFrame);}
  while(this.marks.length){const m=this.marks.shift();this.flush(true);this.phase=m.phase;
   this.port.postMessage({type:'mark',id:m.id,frame:currentFrame,counters:this.total});
  }
  if(this.stopping){this.flush(true);this.stopped=true;this.send();return false;}
  if(!this.bin)this.bin=fresh(currentFrame);
  if(this.lastFrame!==null&&currentFrame!==this.lastFrame&&this.gapReports++<8)this.port.postMessage({type:'clock-gap',expected:this.lastFrame,actual:currentFrame,quantum,mode:this.mode});
  const input=inputs[0]||[],missing=input.length!==1||input.some(c=>c.length!==quantum);
  for(let which=0;which<2;which++){const counter=which?this.bin:this.total;counter.blocks++;counter.frames+=quantum;counter.frameEnd=currentFrame+quantum;
   counter.quantumMin=counter.quantumMin?Math.min(counter.quantumMin,quantum):quantum;counter.quantumMax=Math.max(counter.quantumMax,quantum);
   if(this.lastFrame!==null&&currentFrame!==this.lastFrame)counter.frameDiscontinuities++;
   if(counter.sampleRate!==sampleRate)counter.sampleRateChanges++;
   if(missing)counter.missingInputBlocks++;
  }
  let channelFrames=0,finite=0,nonfinite=0,nonzero=0,squares=0,peak=0,clips=0;
  for(const channel of input){for(let i=0;i<channel.length;i++){const value=channel[i];channelFrames++;
   if(Number.isFinite(value)){finite++;if(value!==0)nonzero++;squares+=value*value;peak=Math.max(peak,Math.abs(value));if(Math.abs(value)>=.98)clips++;}else nonfinite++;
  }}
  for(let which=0;which<2;which++){const c=which?this.bin:this.total;c.channelFrames+=channelFrames;c.finiteSamples+=finite;c.nonfiniteSamples+=nonfinite;c.nonzeroSamples+=nonzero;c.sumSquares+=squares;c.peak=Math.max(c.peak,peak);c.clipSamples+=clips;}
  if(this.mode==='output'){const source=input[0];for(const channel of output)for(let i=0;i<quantum;i++)channel[i]=Number.isFinite(source?.[i])?source[i]:0;}
  else{for(const channel of output)for(const value of channel)if(value!==0){this.total.zeroOutputNonzeroSamples++;this.bin.zeroOutputNonzeroSamples++;}}
  this.lastFrame=currentFrame+quantum;
  if(this.first){this.first=false;this.port.postMessage({type:'first',frame:currentFrame+quantum,counters:this.total});}
  if(this.total.frames>sampleRate*150){this.fail('graph-frame-budget');return false;}
  if(this.bin.frames>=sampleRate*.5)this.flush(false);
  return true;
 }
}
registerProcessor('${DUPLEX_WORKLET_PROCESSOR}',DuplexMeter);
`;
