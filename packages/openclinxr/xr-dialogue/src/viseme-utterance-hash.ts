/**
 * Deterministic utterance id for the baked lip-sync cue lookup (#722).
 *
 * The offline bake (multi-case-runner.ts:876) names every cue file
 * `utterance-${sha1(utterance).digest("hex").slice(0, 10)}` — a content hash of the BARE
 * spoken text (no actor prefix). The runtime speaks the same line with a UI prefix
 * ("Samuel Brooks: My right arm feels weak…"), so the lookup must strip that prefix before
 * hashing, or the served cue file is never found. This module is the browser-side half of
 * that name: pure JS sha1 (no node:crypto — this code runs in the WebXR bundle), plus the
 * prefix normalisation that makes runtime text and bake text agree (D9 determinism).
 *
 * claimScope: deterministic utterance id + prefix normalisation only.
 * notEvidenceFor: cue timing, mouth appearance, utterance-to-dialogue-turn identity beyond
 *   the content-hash match this module defines.
 */

/** Strip a leading "Actor Name:" / "Actor Name：" prefix from a spoken line. */
export function normalizeUtteranceTextForCueLookup(text: string): string {
  const trimmed = (text ?? "").trim();
  return trimmed.replace(/^[^:：]+[:：]\s*/, "").trim();
}

/** 10-hex-char content id, matching the bake's `utterance-<hash>.mouth-cues.json` names. */
export function utteranceIdForText(text: string): string {
  return sha1Hex(normalizeUtteranceTextForCueLookup(text)).slice(0, 10);
}

/** Hex sha1 of a UTF-8 string. */
export function sha1Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  return [...sha1Digest(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** SHA-1 (FIPS 180-1) over raw bytes — small, dependency-free, browser-safe. */
export function sha1Digest(message: Uint8Array): Uint8Array {
  // Initial hash state (big-endian words).
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const bitLen = message.length * 8;
  // Pad: append 0x80, zeros to 56 mod 64, then the 64-bit big-endian bit length.
  const paddedLength = (((message.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[message.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(paddedLength - 8, Math.floor(bitLen / 0x100000000), false);
  dv.setUint32(paddedLength - 4, bitLen >>> 0, false);

  const w = new Uint32Array(80);
  const rotl = (value: number, shift: number): number =>
    ((value << shift) | (value >>> (32 - shift))) >>> 0;

  for (let block = 0; block < paddedLength; block += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = dv.getUint32(block + i * 4, false);
    }
    for (let i = 16; i < 80; i += 1) {
      w[i] = rotl(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i += 1) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + w[i]!) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const out = new Uint8Array(20);
  const outDv = new DataView(out.buffer);
  outDv.setUint32(0, h0, false);
  outDv.setUint32(4, h1, false);
  outDv.setUint32(8, h2, false);
  outDv.setUint32(12, h3, false);
  outDv.setUint32(16, h4, false);
  return out;
}
