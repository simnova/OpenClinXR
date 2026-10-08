/** Playwright driver for the viseme audio-clock bake-off. Real-time capture, one run at a time. */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { startServer } from "./serve.mjs";

const PORT = 8931;
const BASE = `http://127.0.0.1:${PORT}`;
const server = await startServer(PORT);
const OUT = new URL("../cache/runs/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const CLIPS = {
  pangram: "/clips/pangram.wav",
  "viseme-words": "/clips/viseme-words.wav",
  pain: "/clips/i-feel-the-pain-is-better-now.wav",
  oov: "/clips/oov-albuterol.wav",
};

const only = process.argv[2] ?? ""; // e.g. "headaudio.pangram.0" or "smoke"
const REPS = Number(process.env.REPS ?? "20");

const jobs = [];
if (only === "smoke") {
  jobs.push({ candidate: "headaudio", clip: "pangram", rep: 0 });
} else if (only) {
  const [c, k, r] = only.split(".");
  jobs.push({ candidate: c, clip: k, rep: Number(r ?? "0") });
} else {
  for (const candidate of ["headaudio", "wawa"]) {
    for (const clip of Object.keys(CLIPS)) {
      for (let rep = 0; rep < REPS; rep += 1) jobs.push({ candidate, clip, rep });
    }
  }
}

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
});
try {
  for (const { candidate, clip, rep } of jobs) {
    const dest = `${OUT}/${candidate}.${clip}.rep${rep}.json`;
    if (existsSync(dest)) {
      console.log(`skip ${candidate}.${clip}.rep${rep} (exists)`);
      continue;
    }
    const page = await browser.newPage();
    page.on("pageerror", (e) => console.log(`PAGEERROR ${candidate}.${clip}.${rep}: ${String(e).slice(0, 200)}`));
    try {
      await page.goto(`${BASE}/harness.html`);
      const t0 = Date.now();
      const result = await Promise.race([
        page.evaluate(
          ({ c, p }) => window.runCapture(c, p),
          { c: candidate, p: CLIPS[clip] },
        ),
        new Promise((_, reject) => setTimeout(() => reject(new Error("run-timeout-180s")), 180000)),
      ]);
      const driverMs = Date.now() - t0;
      const out = { ...result, driverMs, rep, clip, at: new Date().toISOString() };
      writeFileSync(dest, JSON.stringify(out));
      console.log(`saved ${candidate}.${clip}.rep${rep} samples=${result.samples.length} audioMs=${Math.round(result.audioMs)} wallMs=${Math.round(result.wallMs)}`);
    } catch (err) {
      console.log(`FAIL ${candidate}.${clip}.rep${rep}: ${String(err).slice(0, 160)}`);
    } finally {
      await page.close().catch(() => {});
    }
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(0);
