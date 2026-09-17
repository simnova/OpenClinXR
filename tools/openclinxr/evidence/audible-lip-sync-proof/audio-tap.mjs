/** AudioWorklet tap after the actor source, before destination and recorder. */
class OpenClinXrAudioTap extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options?.processorOptions ?? {};
    this.generation = opts.generation ?? "";
    this.nodeSerial = opts.nodeSerial ?? 0;
    this.sourceStartContextSample = 0;
    this.armed = false;
    this.remaining = 0;
    this.port.onmessage = (event) => {
      const data = event.data ?? {};
      if (data.arm) {
        this.armed = true;
        this.generation = data.generation;
        this.nodeSerial = data.nodeSerial;
        this.sourceStartContextSample = data.sourceStartContextSample;
        this.remaining = data.sampleCount;
      }
    };
  }
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (input && output) {
      for (let channel = 0; channel < output.length; channel += 1) {
        if (input[channel] && output[channel]) output[channel].set(input[channel]);
      }
    }
    if (!this.armed || this.remaining <= 0) return true;
    const samples = input?.[0];
    if (!samples || samples.length === 0) return true;
    const count = Math.min(samples.length, this.remaining);
    this.port.postMessage({
      observationKind: "audio-worklet-process",
      generation: this.generation,
      nodeSerial: this.nodeSerial,
      sourceStartContextSample: this.sourceStartContextSample,
      samples: samples.slice(0, count),
    });
    this.remaining -= count;
    return true;
  }
}
registerProcessor("openclinxr-audio-tap", OpenClinXrAudioTap);
