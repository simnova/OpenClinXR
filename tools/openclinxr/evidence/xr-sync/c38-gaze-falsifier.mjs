#!/usr/bin/env node
/**
 * C38 gaze falsifier. Emulated immersive-vr (IWER Quest 3): set head pose A (yaw 0), then B (yaw 90 degrees), and read the shell's gaze-camera
 * forward vector after each. Verdict: the angle between forward(A) and forward(B) above 45 degrees (half the applied yaw) means gaze follows
 * the head (FALSE_ALARM); otherwise CONFIRMED. Writes --out (a JSON file path). Primary poses go through the IWER remote dispatch (animate_to);
 * a second pair is applied by writing device.quaternion directly, as the C37 probe did, and reported beside it.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runHostProbe, startStaticServer } from "./harness-lib.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..", "..");
const APP_DIST = join(ROOT, "apps/ui-xr/dist");
const IWER_BUNDLE = join(ROOT, "apps/arena/ui-xr-iwsdk-spike/node_modules/iwer/build/iwer.min.js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const THRESHOLD_DEGREES = 45;

function iwerGlue() {
  const device = new IWER.XRDevice(IWER.metaQuest3);
  device.installRuntime({ forceInstall: true });
  globalThis.__c38Xr = { device, sessions: [] };
  const xr = navigator.xr;
  const original = xr.requestSession.bind(xr);
  xr.requestSession = async function requestSession(...args) {
    const session = await original(...args);
    globalThis.__c38Xr.sessions.push(session);
    return session;
  };
}

const angleDegrees = (a, b) => {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = Math.hypot(...a) * Math.hypot(...b);
  return (Math.acos(Math.max(-1, Math.min(1, dot / norm))) * 180) / Math.PI;
};

async function main() {
  const outIndex = process.argv.indexOf("--out");
  if (outIndex === -1) throw new Error("usage: c38-gaze-falsifier.mjs --out <file.json>");
  const outPath = resolve(process.argv[outIndex + 1]);
  await mkdir(dirname(outPath), { recursive: true });
  const iwerText = await readFile(IWER_BUNDLE, "utf8");
  const staticServer = await startStaticServer(APP_DIST);
  const pageUrl = `http://127.0.0.1:${staticServer.port}/`;
  const report = { slice: "c38", pageUrl, thresholdDegrees: THRESHOLD_DEGREES, yawAppliedDegrees: 90 };
  try {
    const out = await runHostProbe({
      pageUrl,
      outDir: dirname(outPath),
      initScript: { content: `${iwerText};(${iwerGlue.toString()})();` },
      launchArgs: [],
      drive: async (page) => {
        const forward = () => page.evaluate(() => { const c = globalThis.__openClinXrGazeCamera; return c.getWorldDirection(c.position.clone()).toArray(); });
        const probe = {};
        await page.waitForFunction(() => { const b = document.getElementById("enter-xr-button"); return b !== null && !b.disabled; }, undefined, { timeout: 120000 });
        await page.waitForFunction(() => globalThis.__openClinXrGazeCamera !== undefined, undefined, { timeout: 120000 });
        probe.forwardBeforeSession = await forward();
        await page.click("#enter-xr-button");
        await page.waitForFunction(() => globalThis.__c38Xr.sessions.length === 1 && document.getElementById("enter-xr-button").textContent === "Exit Full VR", undefined, { timeout: 60000 });
        const remote = (method, params) => page.evaluate(([m, p]) => globalThis.__c38Xr.device.remote.dispatch(m, p), [method, params]);
        const yaw = (degrees) => ({ x: 0, y: Math.sin((degrees * Math.PI) / 360), z: 0, w: Math.cos((degrees * Math.PI) / 360) });
        const pose = async (degrees) => {
          await remote("animate_to", { device: "headset", position: { x: 0, y: 1.6, z: 0 }, orientation: yaw(degrees), duration: 0.3 });
          await sleep(1500);
          return { yawDegrees: degrees, headsetOrientation: JSON.parse(JSON.stringify((await remote("get_transform", { device: "headset" })).orientation)), forward: await forward() };
        };
        probe.remote = { A: await pose(0), B: await pose(90) };
        const direct = async (degrees) => {
          const q = yaw(degrees);
          await page.evaluate((o) => globalThis.__c38Xr.device.quaternion.set(o.x, o.y, o.z, o.w), q);
          await sleep(1500);
          return { yawDegrees: degrees, forward: await forward() };
        };
        probe.direct = { A: await direct(0), B: await direct(90) };
        probe.presenting = await page.evaluate(() => globalThis.__c38Xr.sessions.length === 1);
        return probe;
      },
    }).catch((error) => ({ error: String(error) }));
    report.out = out;
    const angle = (pair) => (pair ? Number(angleDegrees(pair.A.forward, pair.B.forward).toFixed(2)) : null);
    report.angleDegrees = { remote: angle(out.probe?.remote), direct: angle(out.probe?.direct) };
    report.pageErrors = out.pageErrors?.length ?? null;
    report.verdict = report.angleDegrees.remote === null ? "NO_MEASUREMENT" : report.angleDegrees.remote > THRESHOLD_DEGREES ? "FALSE_ALARM" : "CONFIRMED";
    report.forwardA = out.probe?.remote?.A.forward;
    report.forwardB = out.probe?.remote?.B.forward;
  } finally {
    await staticServer.close?.();
  }
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(outPath);
}
main().catch((error) => { console.error(error); process.exit(1); });
