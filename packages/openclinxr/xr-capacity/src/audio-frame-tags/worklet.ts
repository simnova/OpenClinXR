import {CONFIG} from './types.js';

export const WORKLET_SOURCE = `
const C=${JSON.stringify(CONFIG)};
class Tagged extends AudioWorkletProcessor {
 constructor(options){super();this.role=options.processorOptions.role;this.stopTag=options.processorOptions.stopTag??null;this.limit=this.role==='checker'?C.checkerTuples:C.producerTuples;this.trace=new Float64Array(this.limit*C.tupleWidth);this.nextId=1;this.expectedId=null;this.activated=false;this.done=false;this.expectedTag=null;
 this.r={role:this.role,callbacks:0,frames:0,firstTag:null,lastTag:null,firstTime:null,lastTime:null,lastQuantum:0,tagGaps:0,invalidClock:0,firstId:null,lastId:null,firstIdCallback:null,missingPrefix:0,positiveSamples:0,preludeZeros:0,activationPrefixZeros:0,postActivationZeros:0,zerosAfterFirstId:0,invalidSamples:0,skippedIds:0,duplicateOrBackwardIds:0,ordinalOverflow:false,tupleRows:0,tupleLimit:this.limit,omittedTuples:0,nonzeroOutputSamples:0};
 this.port.onmessage=e=>{if(e.data==='activate')this.activated=true;if(e.data==='stop')this.finish();};
 }
 finish(){if(this.done)return;this.done=true;const buffer=this.trace.buffer;this.port.postMessage({kind:'final',record:this.r,buffer},[buffer]);}
 process(inputs,outputs){
 // This precedes every state, input and clock branch. The checker never forwards input.
 for(const channel of outputs[0]||[])channel.fill(0);
 if(this.done)return false;
 const output=outputs[0]?.[0],q=output?.length||0,r=this.r;
 if(!q){r.invalidClock++;return true;}
 const tag=currentFrame,t=currentTime;
 if(!Number.isSafeInteger(tag)||tag<0||!Number.isFinite(t)||Math.abs(t-tag/sampleRate)>1e-8)r.invalidClock++;
 if(this.expectedTag!==null&&tag!==this.expectedTag)r.tagGaps++;
 if(this.stopTag!==null&&tag>=this.stopTag){this.finish();return false;}
 this.expectedTag=tag+q;if(r.firstTag===null){r.firstTag=tag;r.firstTime=t;if(this.stopTag===null)this.stopTag=tag+sampleRate*C.acquisitionMs/1000;}r.lastTag=tag;r.lastTime=t;r.lastQuantum=q;
 let first=0,last=0,count=0;
 const input=inputs[0]?.[0];
 for(let i=0;i<q;i++){
  let value=0;
  if(this.role==='producer'){
   if(this.nextId>C.maximumOrdinal){r.ordinalOverflow=true;}else value=this.nextId++;
   output[i]=value;
  }else value=input?.[i]===undefined?0:input[i];
  if(value===0){
   if(!this.activated&&this.role==='checker')r.preludeZeros++;
   else{r.postActivationZeros++;if(r.firstId===null)r.activationPrefixZeros++;else r.zerosAfterFirstId++;}
   continue;
  }
  if(!Number.isInteger(value)||value<1||value>C.maximumOrdinal){r.invalidSamples++;continue;}
  if(r.firstId===null){r.firstId=value;r.firstIdCallback=r.callbacks;r.missingPrefix=value-1;}
  if(this.expectedId!==null){if(value>this.expectedId)r.skippedIds+=value-this.expectedId;else if(value<this.expectedId)r.duplicateOrBackwardIds++;}
  this.expectedId=value+1;r.lastId=value;r.positiveSamples++;if(!first)first=value;last=value;count++;
 }
 for(const channel of outputs[0]||[])for(const value of channel)if(value!==0)r.nonzeroOutputSamples++;
 const ordinal=r.callbacks++;r.frames+=q;
 if(ordinal<this.limit){this.trace.set([ordinal,tag,q,r.frames,first,last,count],ordinal*C.tupleWidth);r.tupleRows++;}else r.omittedTuples++;
 if(this.role==='checker'&&r.callbacks===C.preludeCallbacks)this.port.postMessage({kind:'prelude',callbacks:r.callbacks,frames:r.frames,globalTag:tag,stopTag:this.stopTag});
 return true;
 }
}
registerProcessor('quest-frame-tags-checker-v1',Tagged);
registerProcessor('quest-frame-tags-producer-v1',Tagged);
`;
