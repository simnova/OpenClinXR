import type { WitnessCounters,WitnessRecord,WitnessWindow } from "./types.js";
export const WITNESS_COUNTER_KEYS=["frameStart","frameEnd","sampleRate","blocks","frames","quantumMin","quantumMax","frameDiscontinuities","sampleRateChanges","nonfiniteOutputSamples","nonzeroOutputSamples"] as const;
export const WITNESS_ROW_WIDTH=12;
export function emptyWitnessCounters():WitnessCounters{return {frameStart:0,frameEnd:0,sampleRate:0,blocks:0,frames:0,quantumMin:0,quantumMax:0,frameDiscontinuities:0,sampleRateChanges:0,nonfiniteOutputSamples:0,nonzeroOutputSamples:0};}
export function readWitnessCounters(value:unknown):WitnessCounters|null{
 if(!value||typeof value!=="object")return null;const row=value as Record<string,unknown>;
 for(const key of WITNESS_COUNTER_KEYS)if(typeof row[key]!=="number"||!Number.isFinite(row[key])||Number(row[key])<0||(key!=="sampleRate"&&!Number.isSafeInteger(row[key])))return null;
 const c=row as unknown as WitnessCounters;
 if(c.sampleRate<8000||c.sampleRate>384000||c.blocks<1||c.frames<1||c.quantumMin<1||c.quantumMax<c.quantumMin||c.quantumMax>16384||c.frames<c.blocks*c.quantumMin||c.frames>c.blocks*c.quantumMax||c.frameEnd<c.frameStart)return null;
 if(!c.frameDiscontinuities&&c.frameEnd-c.frameStart!==c.frames)return null;return {...c};
}
export class WitnessRecorder {
 readonly storage=new Float64Array(512*WITNESS_ROW_WIDTH);rows=0;
 record:WitnessRecord={...emptyWitnessCounters(),createdMs:null,connectedMs:null,finalReceivedMs:null,targetConnectedMs:null,targetCreation:{input:null,output:null},windows:[],firstEight:[],primingReceivedMs:null,receivedFrontierFrameStart:null,creationBeforeMs:null,creationAfterMs:null,attachedSentMs:null,attachSeen:null,gaps:[],finalReceived:false,firstWorkReceivedMs:null,rejected:0,overflow:0,coalesced:0,highWater:0};
 acceptBatch(value:unknown):boolean{
  if(!(value instanceof Float64Array)||value.length%WITNESS_ROW_WIDTH||value.length===0||value.length>16*WITNESS_ROW_WIDTH||this.rows+value.length/WITNESS_ROW_WIDTH>512){this.record.rejected++;return false;}
  for(let at=0;at<value.length;at+=WITNESS_ROW_WIDTH){if(value[at]!==this.rows){this.record.rejected++;return false;}
   const raw=Object.fromEntries(WITNESS_COUNTER_KEYS.map((k,j)=>[k,value[at+j+1]]));const c=readWitnessCounters(raw);if(!c){this.record.rejected++;return false;}
   this.storage.set(value.subarray(at,at+WITNESS_ROW_WIDTH),this.rows*WITNESS_ROW_WIDTH);this.rows++;
  }return true;
 }
 snapshot():WitnessRecord{
  const windows:WitnessWindow[]=[];for(let i=0;i<this.rows;i++){const at=i*WITNESS_ROW_WIDTH;const c=Object.fromEntries(WITNESS_COUNTER_KEYS.map((k,j)=>[k,this.storage[at+j+1]])) as unknown as WitnessCounters;windows.push({...c,sequence:i,partial:c.frames<c.sampleRate*.5});}
  return structuredClone({...this.record,windows});
 }
}
