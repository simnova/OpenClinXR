// Owner integrity oracle: never generates played observations.
export function pcm16MonoFloat32(wav) {
 if (wav.toString("ascii",0,4)!=="RIFF" || wav.toString("ascii",8,12)!=="WAVE") throw Error("invalid-waveform-container");
 let fmt,data;
 for (let p=12;p+8<=wav.length;) {
  const tag=wav.toString("ascii",p,p+4),size=wav.readUInt32LE(p+4),start=p+8;
  if(start+size>wav.length)throw Error("truncated-waveform-chunk");
  if(tag==="fmt ")fmt=wav.subarray(start,start+size);
  if(tag==="data")data=wav.subarray(start,start+size);
  p=start+size+(size%2);
 }
 if(!fmt || fmt.length<16 || !data || fmt.readUInt16LE(0)!==1 || fmt.readUInt16LE(2)!==1 || fmt.readUInt16LE(14)!==16 || data.length%2)throw Error("unsupported-waveform-domain");
 const samples=Buffer.alloc(data.length*2);
 for(let i=0;i<data.length/2;i++)samples.writeFloatLE(data.readInt16LE(i*2)/32768,i*4);
 return {sampleRate:fmt.readUInt32LE(4),sampleCount:data.length/2,samples,pcm16:data};
}
export function inspectPlayedSamples(wav,tap,{sampleRate,sampleCount,observationKind,sourceGeneration}) {
 const errors=[];let reference;
 try{reference=pcm16MonoFloat32(wav);}catch(e){return [e.message];}
 if(observationKind!=="audio-worklet-process" || typeof sourceGeneration!=="string" || !sourceGeneration)errors.push("played-tap-unbound");
 if(sampleRate!==reference.sampleRate || sampleCount!==reference.sampleCount)errors.push("played-domain-mismatch");
 let same=Buffer.isBuffer(tap) && tap.length===reference.sampleCount*4;
 if(same)for(let i=0;i<reference.sampleCount;i++) {
  const x=tap.readFloatLE(i*4);
  if(!Number.isFinite(x) || Math.round(x*32768)!==reference.pcm16.readInt16LE(i*2)){same=false;break;}
 }
 if(!same)errors.push("played-waveform-mismatch");
 return errors;
}
