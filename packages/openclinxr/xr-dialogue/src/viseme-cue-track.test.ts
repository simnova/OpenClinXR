import { describe, expect, it } from "vitest";
import { createActorAudioRuntime } from "./actor-audio-runtime.js";

const { visemeCueTrack } = createActorAudioRuntime();

function timedRows(symbols: readonly string[]): Array<{ startS: number; endS: number; symbol: string }> {
  return symbols.map((symbol, index) => ({ startS: index * 0.1, endS: (index + 1) * 0.1, symbol }));
}

function pcm16Wav(samples: readonly number[], sampleRate = 10): ArrayBuffer {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const text = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, sample, true));
  return bytes;
}

describe("canonical OVR viseme cue intake", () => {
  it("maps every Rhubarb 1.x table row", () => {
    const rows = timedRows(Object.keys(visemeCueTrack.mappings.rhubarb));
    const actual = visemeCueTrack.mapRhubarbTrack({ mouthCues: rows.map((row) => ({ start: row.startS, end: row.endS, value: row.symbol })) });
    expect(actual.map((cue) => cue.viseme)).toEqual(Object.values(visemeCueTrack.mappings.rhubarb));
    expect(actual.every((cue) => cue.intensity === 1)).toBe(true);
  });

  it("maps every ARPAbet table row, including stress suffixes", () => {
    const symbols = Object.keys(visemeCueTrack.mappings.arpabet);
    const rows = timedRows(symbols.map((symbol) => ["AA", "AE", "AH", "EH", "ER", "IH", "IY", "UH", "UW"].includes(symbol) ? `${symbol}1` : symbol));
    const actual = visemeCueTrack.mapArpabetTrack(rows.map((row) => ({ startS: row.startS, endS: row.endS, phone: row.symbol })));
    expect(actual.map((cue) => cue.viseme)).toEqual(Object.values(visemeCueTrack.mappings.arpabet));
  });

  it("maps every case-sensitive Polly-style table row", () => {
    const rows = timedRows(Object.keys(visemeCueTrack.mappings.polly));
    const actual = visemeCueTrack.mapPollyTrack(rows.map((row) => ({ startS: row.startS, endS: row.endS, viseme: row.symbol })));
    expect(actual.map((cue) => cue.viseme)).toEqual(Object.values(visemeCueTrack.mappings.polly));
  });

  it("fails loud for unknown symbols and invalid timing", () => {
    expect(() => visemeCueTrack.mapRhubarbTrack({ mouthCues: [{ start: 0, end: 0.1, value: "Q" }] })).toThrow("unknown-rhubarb-symbol:Q");
    expect(() => visemeCueTrack.mapArpabetTrack([{ startS: 0, endS: 0.1, phone: "Q" }])).toThrow("unknown-arpabet-symbol:Q");
    expect(() => visemeCueTrack.mapPollyTrack([{ startS: 0, endS: 0.1, viseme: "x" }])).toThrow("unknown-polly-symbol:x");
    expect(() => visemeCueTrack.mapPollyTrack([{ startS: 0.2, endS: 0.1, viseme: "p" }])).toThrow("invalid-viseme-cue:0");
  });

  it("uses cue-window RMS normalized to the loudest cue when WAV is present", () => {
    const wav = pcm16Wav([3276, 3276, 3276, 3276, 16384, 16384, 16384, 16384], 4);
    const track = visemeCueTrack.mapPollyTrack([
      { startS: 0, endS: 1, viseme: "a" },
      { startS: 1, endS: 2, viseme: "a" },
    ], wav);
    expect(track[0]?.intensity).toBeCloseTo(0.2, 3);
    expect(track[1]?.intensity).toBeCloseTo(1, 6);
  });
});
