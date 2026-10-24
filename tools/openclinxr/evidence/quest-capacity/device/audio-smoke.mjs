/** Real browser Web Audio graph + AudioWorklet, synthesized only; no microphone/camera. */
export const audioSmokeExpression = `(async () => {
  const context = new AudioContext({latencyHint:'interactive',sampleRate:48000});
  const sources=[]; const nodes=[]; const received=[]; let worklet; let moduleUrl;
  try {
    await context.resume();
    if(context.state!=='running') throw new Error('AudioContext suspended');
    const code=\`class CapacityMeter extends AudioWorkletProcessor { constructor(){super();this.blocks=0;this.frames=0;this.firstFrame=null;this.lastEnd=null;this.frameIndexGaps=0} process(inputs,outputs){ const input=inputs[0]||[],output=outputs[0]||[]; for(let c=0;c<output.length;c++) output[c].set(input[c]||new Float32Array(output[c].length));const quantum=output[0]?.length||128;if(this.firstFrame===null)this.firstFrame=currentFrame;if(this.lastEnd!==null&&this.lastEnd!==currentFrame)this.frameIndexGaps++;this.lastEnd=currentFrame+quantum;this.blocks++;this.frames+=quantum;if(this.blocks%8===0)this.port.postMessage({blocks:this.blocks,frames:this.frames,time:currentTime,firstFrame:this.firstFrame,currentFrame,lastEnd:this.lastEnd,frameIndexGaps:this.frameIndexGaps,quantum});return true; } } registerProcessor('capacity-meter',CapacityMeter);\`;
    moduleUrl=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));
    await context.audioWorklet.addModule(moduleUrl);
    worklet=new AudioWorkletNode(context,'capacity-meter');
    worklet.port.onmessage=({data})=>{received.push({...data,at:performance.now()});if(received.length>128)received.shift()};
    const mix=context.createGain(), convolution=context.createConvolver(), master=context.createGain();
    master.gain.value=0; nodes.push(mix,convolution,master);
    const impulse=context.createBuffer(2,4800,context.sampleRate);let seed=1729;
    for(let c=0;c<2;c++){const channel=impulse.getChannelData(c);for(let i=0;i<channel.length;i++){seed=(1664525*seed+1013904223)>>>0;channel[i]=((seed/4294967296)*2-1)*(1-i/channel.length)*0.01}}
    convolution.buffer=impulse;
    for(let i=0;i<8;i++) {const source=context.createOscillator(),pan=context.createPanner();source.frequency.value=120+i*30;pan.panningModel='HRTF';pan.positionX.value=(i-4)*0.3;pan.positionZ.value=-1;source.connect(pan).connect(mix);source.start();sources.push(source);nodes.push(pan)}
    mix.connect(convolution).connect(worklet).connect(master).connect(context.destination);
    const start={at:performance.now(),audioTime:context.currentTime};
    await new Promise(resolve=>setTimeout(resolve,1000));
    const end={at:performance.now(),audioTime:context.currentTime};
    if(!received.length||received.at(-1).frames<=0) throw new Error('No processed AudioWorklet frames observed');
    return {schema:'quest-capacity-audio-smoke.v1',state:context.state,sampleRate:context.sampleRate,baseLatencyReported:context.baseLatency,outputLatencyReported:context.outputLatency??null,voices:8,hrtfPanners:8,convolutionImpulseFrames:4800,mutedAtOutput:true,syntheticSource:true,microphoneCaptured:false,start,end,workletMessages:received,workletContinuity:{scope:'AudioWorklet currentFrame indices; not DAC or acoustic output',firstFrame:received[0]?.firstFrame,lastEnd:received.at(-1)?.lastEnd,frameIndexGaps:received.at(-1)?.frameIndexGaps,processedFramesObserved:received.at(-1)?.frames,mainThreadMessagesReceived:received.length},notEvidenceFor:['physical-headset-output','microphone-route','acoustic-latency','maximum-audio-capacity']};
  } finally {for(const source of sources)source.stop();for(const node of nodes)node.disconnect();worklet?.disconnect();if(worklet)worklet.port.close();if(moduleUrl)URL.revokeObjectURL(moduleUrl);await context.close();}
})()`;
