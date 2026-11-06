/** C33 learner speech PCM: resample float chunks to 16 kHz mono int16, and RMS level. */

/** Concatenate chunks, linearly resample by window averaging to 16 kHz mono, clamp to [-1,1], round to int16. */
export function downsampleToPcm16(chunks: Float32Array[], sourceRate: number): Int16Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  if (total === 0) return new Int16Array(0);
  const flat = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    flat.set(chunk, offset);
    offset += chunk.length;
  }
  if (sourceRate === 16000) {
    const out = new Int16Array(total);
    for (let i = 0; i < total; i += 1) out[i] = floatToInt16(flat[i] ?? 0);
    return out;
  }
  const r = sourceRate / 16000;
  const count = Math.floor(total / r);
  const out = new Int16Array(count);
  for (let i = 0; i < count; i += 1) {
    const start = i * r;
    const end = (i + 1) * r;
    const from = Math.floor(start);
    const to = Math.min(total, Math.floor(end));
    let sum = 0;
    let n = 0;
    for (let j = from; j < to; j += 1) {
      sum += flat[j] ?? 0;
      n += 1;
    }
    out[i] = floatToInt16(n === 0 ? 0 : sum / n);
  }
  return out;
}

function floatToInt16(value: number): number {
  const clamped = value < -1 ? -1 : value > 1 ? 1 : value;
  return clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
}

/** Root mean square of pcm/32768 (0..1); 0 for empty input. */
export function pcmRms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i += 1) {
    const v = (pcm[i] ?? 0) / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / pcm.length);
}
