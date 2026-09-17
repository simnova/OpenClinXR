import { describe, it, expect } from "vitest";
import { createPlayback } from "./playback.mjs";

// Feature RED: named refusal with a valid fixture, never missing import/asset/infrastructure.
// Owner assertions are frozen; convert only it.fails markers after implementation.
function fixture(generation = "actor-A:turn-1") {
  const sources = [];
  const context = { currentTime: 10, state: "running", sampleRate: 48000,
    async resume() { return undefined; },
    createBufferSource() {
      const source = { playbackRate: { value: 1 }, buffer: null, connected: false, starts: [], stops: 0,
        connect(dest) { this.connected = dest; },
        start(when, offset) { this.starts.push([when, offset]); },
        stop() { this.stops++; }, onended: null };
      sources.push(source); return source;
    } };
  const buffer = { sampleRate: 48000, length: 480000, duration: 10, numberOfChannels: 1 };
  const identity = { waveformSha256: "a".repeat(64), cueSha256: "b".repeat(64), actorId: "actor-A", generation, decodedSampleRate: 48000, decodedSampleCount: 480000 };
  const destination = {};
  return { context, buffer, identity, destination, sources, player: createPlayback({ context, buffer, identity, destination }) };
}

describe("actual source-owned audible playback position", () => {
  it("counterweight: imported feature seam accepts a coherent buffer and source factory", () => {
    const f = fixture(); expect(f.player.generation).toBe("actor-A:turn-1");
    const s = f.context.createBufferSource(); s.connect(f.destination); s.start(12, 0.5);
    expect(s.starts).toEqual([[12, 0.5]]); expect(s.connected).toBe(f.destination);
    expect(f.buffer.length / f.buffer.sampleRate).toBe(f.buffer.duration);
  });
  it("counterweight: absent constructor data is a named refusal", () => {
    expect(() => createPlayback({})).toThrow("invalid-playback-input");
  });
  it.fails("scheduled source start connects real adapter and never advances before its audio start", async () => {
    const f = fixture(); await f.player.start({ when: 12, offset: 0.5, rate: 1 });
    expect(f.sources).toHaveLength(1); expect(f.sources[0].connected).toBe(f.destination);
    expect(f.sources[0].buffer).toBe(f.buffer); expect(f.sources[0].starts).toEqual([[12, 0.5]]);
    expect(f.player.position()).toBe(0.5); f.context.currentTime = 12.75; expect(f.player.position()).toBe(1.25);
  });
  it.fails("source offset and playback rate select sample position instead of wall elapsed time", async () => {
    const f = fixture(); await f.player.start({ when: 10, offset: 2, rate: 0.5 });
    f.context.currentTime = 14; expect(f.player.position()).toBe(4);
    expect(f.sources[0].playbackRate.value).toBe(0.5); f.context.currentTime = 40; expect(f.player.position()).toBe(10);
  });
  it.fails("actor pause holds source position and resumes with a new one-shot node", async () => {
    const f = fixture(); await f.player.start({ when: 10, offset: 0, rate: 1 });
    f.context.currentTime = 12; await f.player.pause(); expect(f.sources[0].stops).toBe(1);
    f.context.currentTime = 18; expect(f.player.position()).toBe(2);
    await f.player.resume(); expect(f.sources).toHaveLength(2); expect(f.sources[1].starts).toEqual([[18, 2]]);
    f.context.currentTime = 19; expect(f.player.position()).toBe(3);
  });
  it.fails("late end callback of a paused node cannot end the resumed actor generation", async () => {
    const f = fixture(); await f.player.start({ when: 10, offset: 0, rate: 1 }); const first = f.sources[0];
    f.context.currentTime = 11; await f.player.pause(); await f.player.resume(); first.onended?.();
    f.context.currentTime = 12; expect(f.player.position()).toBe(2);
    expect(f.sources[1].stops).toBe(0);
  });
  it.fails("suspended or rejected source start cannot report playing or animate speech", async () => {
    const f = fixture(); f.context.state = "suspended";
    await expect(f.player.start({ when: 10, offset: 0, rate: 1 })).rejects.toThrow("audio-context-not-running");
    expect(f.sources).toHaveLength(0); expect(f.player.position()).toBe(0);
    const g = fixture(); g.context.createBufferSource = () => ({ playbackRate: {value:1}, connect() {}, start() {throw Error("source-start-refused");}, stop() {} });
    await expect(g.player.start({ when: 10, offset: 0, rate: 1 })).rejects.toThrow("source-start-refused");
    expect(g.player.position()).toBe(0);
  });
  it.fails("stop must be present and not false before the actor is reported stopped", async () => {
    const f = fixture(); await f.player.start({ when: 10, offset: 0, rate: 1 });
    f.sources[0].stop = () => false; await expect(f.player.stop()).rejects.toThrow("source-stop-refused");
    f.context.currentTime = 11; expect(f.player.position()).toBe(1);
    f.sources[0].stop = undefined; await expect(f.player.stop()).rejects.toThrow("source-stop-unsupported");
  });
  it.fails("independent actors sharing one context never pause or cancel each other's sources", async () => {
    const f = fixture(); const identity = {...f.identity, actorId: "actor-B", generation: "actor-B:turn-1"};
    const second = createPlayback({context:f.context,buffer:f.buffer,identity,destination:f.destination});
    await f.player.start({when:10,offset:0,rate:1}); await second.start({when:10,offset:1,rate:1});
    f.context.currentTime=12; await f.player.pause(); f.context.currentTime=13;
    expect(f.player.position()).toBe(2); expect(second.position()).toBe(4); expect(f.sources[1].stops).toBe(0);
    expect(f.context.state).toBe("running");
  });
});
