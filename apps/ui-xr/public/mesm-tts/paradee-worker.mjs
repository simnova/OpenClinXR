// Paradee in a module Worker, so synthesis (synchronous WASM, ~40 ms per sentence on a laptop core) never blocks the page.
//   const w = new Worker(new URL("./paradee-worker.mjs", import.meta.url), { type: "module" });
//   w.postMessage({ op: "load", model: "v2f" });           // any loadParadee option that can be cloned (espeakUrl, not espeak)
//   w.postMessage({ op: "speak", id: 1, text, first: 16, chunk: 40, speed: 1 });
// Replies: {op:"loaded", info} | {op:"sentence", id, i, text, phonemes} | {op:"chunk", id, samples} (transferred) |
//          {op:"done", id, audio_s, compute_ms} | {op:"error", id, message}.  {op:"stop"} drops the current utterance.
import { loadParadee } from "./paradee.mjs";
let tts = null, current = 0;
self.onmessage = async ({ data: m }) => {
  try {
    if (m.op === "load") { tts = await loadParadee(m); self.postMessage({ op: "loaded", info: tts.info }); return; }
    if (m.op === "stop") { current = 0; return; }
    if (m.op === "speak") {
      current = m.id; const t0 = performance.now(); let n = 0;
      const onSentence = (i, text, phonemes) => self.postMessage({ op: "sentence", id: m.id, i, text, phonemes });
      for await (const c of tts.stream(m.text, { speed: m.speed ?? 1, first: m.first ?? 16, chunk: m.chunk ?? 40, onSentence })) {
        if (current !== m.id) return;
        n += c.length; self.postMessage({ op: "chunk", id: m.id, samples: c }, [c.buffer]);
        await new Promise((r) => setTimeout(r, 0));   // let a "stop" message in between chunks
      }
      self.postMessage({ op: "done", id: m.id, audio_s: n / tts.sampleRate, compute_ms: performance.now() - t0 });
    }
  } catch (e) { self.postMessage({ op: "error", id: m.id, message: String(e?.stack || e) }); }
};
