import type { CaseAudioEvidence, CaseAudioOptions } from "./actor-audio-case-types.js";
import { convertRhubarb, cuesAdmissible, decodePcm16MonoWav } from "./actor-audio-prepared-data.js";
export type VerifiedCaseBytes = { decoded: ReturnType<typeof decodePcm16MonoWav>; cues: ReturnType<typeof convertRhubarb> };
async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
export async function prepareCaseBytes(e: CaseAudioEvidence, options: CaseAudioOptions | undefined): Promise<VerifiedCaseBytes> {
  const { plan: _plan, execution: _execution, artifacts: _artifacts, ...request } = e;
  if (!options?.resolveApproval || await options.resolveApproval(Object.freeze(request)) !== true) throw Error("approval_refused");
  const fetchBytes = options.fetchBytes ?? (async (uri: string) => {
    const response = await fetch(uri); if (!response.ok) throw Error("fetch_refused");
    return new Uint8Array(await response.arrayBuffer());
  });
  const [waveform, cues] = await Promise.all([fetchBytes(e.waveformUri).then(bytes => Uint8Array.from(bytes)), fetchBytes(e.cueUri).then(bytes => Uint8Array.from(bytes))]);
  if (waveform.length !== e.waveformByteLength || cues.length !== e.cueByteLength) throw Error("byte_length_mismatch");
  const [waveHash, cueHash] = await Promise.all([sha256(waveform), sha256(cues)]);
  if (waveHash !== e.waveformSha256 || cueHash !== e.cueSha256 || waveHash !== e.bakeWaveformSha256) throw Error("byte_hash_mismatch");
  const decoded = decodePcm16MonoWav(Uint8Array.from(waveform).buffer);
  if (!Number.isFinite(decoded.sampleRate) || decoded.sampleRate <= 0 || decoded.sampleRate !== e.nativeSampleRate || decoded.sampleCount !== e.nativeSampleCount) throw Error("native_domain_mismatch");
  const document = JSON.parse(new TextDecoder().decode(cues)) as Parameters<typeof convertRhubarb>[0];
  if (JSON.stringify(document.mouthCues) !== JSON.stringify(e.artifacts.visemeCues?.mouthCues)) throw Error("embedded_cues_mismatch");
  const converted = convertRhubarb(document);
  if (!cuesAdmissible(converted) || converted.some(c => c.atSecond + c.durationSeconds > decoded.sampleCount / decoded.sampleRate + 1e-9)) throw Error("invalid_cue_domain");
  return { decoded, cues: converted };
}
