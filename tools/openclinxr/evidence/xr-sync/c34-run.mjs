#!/usr/bin/env node
/**
 * C34 host/Quest harness: the documented dev stack accepts headset speech with no harness-owned server.
 * The stack is started the documented way (`pnpm --filter @openclinxr/xr-sync-server dev:portless`, portless assigns the port);
 * the faster-whisper sidecar is wired by dev-server.ts from its defaults (no recognizer is injected here).
 *
 * Stack A (default env): speech ready line before the listening line; the shell (apps/ui-xr) shows a mic preflight state, injected
 * push-to-talk audio is recognized by the dev server, the learner caption shows the words, the typed box stays.
 * Stack B (XR_SYNC_STT_PYTHON=/nonexistent): the server stays up and prints `speech unavailable`; the shell hides push-to-talk, shows
 * the typed-box fallback text, and a typed utterance is acked.
 * Part A: a failed XR session start clears window.__openClinXrXrSession.
 *
 * Host:  node c34-run.mjs --mode host --out <dir>
 * Quest: node c34-run.mjs --mode quest --serial <serial> --out <dir>
 * Exit 1 on any failed assertion.
 */
import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { adb, collectQuestCleanupLists, parseArgs, runHostProbe, runQuestProbe, startStaticServer } from "./harness-lib.mjs";

const run_ = promisify(execFile);
const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..", "..");
const APP_DIST = join(ROOT, "apps/ui-xr/dist");
const LISTEN_RE = /xr-sync listening ws:\/\/127\.0\.0\.1:(\d+) instance=(\S+)/;
const READY_TIMEOUT_MS = 240000;
const JOIN_TIMEOUT_MS = 240000;
const SPOKEN = { onset: "When did the chest pressure start?" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (values) => { const s = [...values].sort((a, b) => a - b); return s.length === 0 ? null : s[Math.floor(s.length / 2)]; };

async function makeFixtures(dir) {
  await mkdir(dir, { recursive: true });
  for (const [name, sentence] of Object.entries(SPOKEN)) {
    await run_("say", ["-v", "Samantha", "-o", join(dir, `${name}.aiff`), sentence]);
    await run_("ffmpeg", ["-loglevel", "error", "-y", "-i", join(dir, `${name}.aiff`), "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", join(dir, `${name}.wav`)]);
  }
}
async function readPcm(path) {
  const bytes = await readFile(path);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = view.getUint32(offset + 4, true);
    if (id === "data") return Array.from({ length: size >> 1 }, (_, i) => view.getInt16(offset + 8 + i * 2, true));
    offset += 8 + size + (size & 1);
  }
  throw new Error(`no data chunk in ${path}`);
}

/** Start the documented dev stack: pnpm --filter @openclinxr/xr-sync-server dev:portless. */
function startStack(instance, extraEnv = {}) {
  const proc = spawn("pnpm", ["--filter", "@openclinxr/xr-sync-server", "dev:portless"], {
    cwd: ROOT, env: { ...process.env, XR_SYNC_INSTANCE: instance, FORCE_COLOR: "0", ...extraEnv }, detached: true, stdio: ["ignore", "pipe", "pipe"],
  });
  const record = { instance, proc, output: "", port: null, exited: false, exitCode: null };
  const onData = (chunk) => {
    record.output += chunk.toString();
    const listen = record.output.match(LISTEN_RE);
    if (listen && record.port === null) record.port = Number(listen[1]);
  };
  proc.stdout.on("data", onData);
  proc.stderr.on("data", onData);
  record.exitPromise = new Promise((done) => proc.once("exit", (code) => { record.exited = true; record.exitCode = code; done(); }));
  return record;
}
async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(200);
  }
}
async function descendants(rootPid) {
  const { stdout } = await run_("ps", ["-axo", "pid=,ppid=,command="]);
  const rows = stdout.split("\n").map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean).map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] }));
  const found = new Set([rootPid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const row of rows) if (found.has(row.ppid) && !found.has(row.pid)) { found.add(row.pid); grew = true; }
  }
  return rows.filter((row) => found.has(row.pid) && row.pid !== rootPid);
}
function bindLoopback(port) {
  return new Promise((done) => {
    const probe = createServer();
    probe.once("error", (error) => done(error.code ?? "unknown-error"));
    probe.listen(port, "127.0.0.1", () => probe.close(() => done("bound")));
  });
}
async function stopStack(record) {
  if (!record.exited) {
    try { process.kill(-record.proc.pid, "SIGTERM"); } catch { /* already gone */ }
    const exited = await Promise.race([record.exitPromise.then(() => true), sleep(10000).then(() => false)]);
    if (!exited) { try { process.kill(-record.proc.pid, "SIGKILL"); } catch { /* gone */ } }
    return exited;
  }
  return true;
}

async function main(argv) {
  const options = parseArgs(argv);
  const outDir = resolve(options.out);
  await mkdir(outDir, { recursive: true });
  const run = { mode: options.mode, serial: options.mode === "quest" ? options.serial : null, script: "c34", assertions: [], stackA: null, stackB: null, pageErrors: [], consoleErrors: [], notEvidenceFor: { soundHeardByAPerson: true, clinicalValidity: true, examEquivalence: true } };
  const check = (name, pass, detail = "") => {
    run.assertions.push({ name, pass: Boolean(pass), detail: String(detail) });
    if (!pass) process.exitCode = 1;
  };
  const startedMs = Date.now();
  let staticServer = null;
  const stacks = [];
  const isAsset404 = (text) => /Failed to load resource.*404/iu.test(text);
  try {
    if (options.mode === "quest") {
      await adb(options.serial, ["shell", "input keyevent KEYCODE_WAKEUP"]).catch(() => undefined);
      await adb(options.serial, ["shell", "am broadcast -a com.oculus.vrpowermanager.prox_close"]).catch(() => undefined);
      await sleep(1500);
    }
    const audioDir = join(outDir, "audio");
    await makeFixtures(audioDir);
    const pcm = await readPcm(join(audioDir, "onset.wav"));
    staticServer = await startStaticServer(APP_DIST);
    const launchArgs = ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${join(audioDir, "onset.wav")}`];
    const probeFn = (pageUrl, drive) => (options.mode === "host" ? runHostProbe({ pageUrl, outDir, drive, launchArgs }) : runQuestProbe({ pageUrl, outDir, serial: options.serial, drive }));
    const readShell = (page) => page.evaluate(() => {
      const e = globalThis.__openClinXrEncounterSync;
      const button = document.getElementById("speak-button");
      return {
        state: e.state, error: e.error, micState: e.speech?.micState ?? null, serverSpeech: e.speech?.serverSpeech ?? null,
        buttonHidden: button?.hidden ?? null, micStatus: document.getElementById("mic-status")?.textContent ?? null,
        speechStatus: document.getElementById("speech-status")?.textContent ?? null, learnerCaption: document.getElementById("learner-caption")?.textContent ?? null,
        captures: JSON.parse(JSON.stringify(e.speech?.captures ?? [])), speechUtterances: JSON.parse(JSON.stringify(e.speechUtterances ?? [])),
        utterances: JSON.parse(JSON.stringify(e.utterances ?? [])), typedBoxHidden: document.getElementById("utterance-input")?.hidden ?? null, hasInject: typeof e.speech?.inject === "function",
      };
    });
    const waitJoined = (page) => page.waitForFunction(() => { const e = globalThis.__openClinXrEncounterSync; return e !== undefined && e.state !== "joining"; }, undefined, { timeout: JOIN_TIMEOUT_MS });

    // Stack A: default env, real faster-whisper.
    const stackA = startStack(`c34a-${process.pid}`);
    stacks.push(stackA);
    await waitFor(() => stackA.port !== null || stackA.exited, READY_TIMEOUT_MS, "stack A listening line");
    const readyIndex = stackA.output.indexOf("xr-sync speech ready");
    const listenIndex = stackA.output.indexOf("xr-sync listening");
    run.stackA = { instance: stackA.instance, port: stackA.port, bootLines: stackA.output.split("\n").filter((l) => l.startsWith("xr-sync ")).slice(0, 6) };
    check("D1 stack A (documented dev:portless) printed the speech-ready line before the listening line", stackA.port !== null && readyIndex >= 0 && readyIndex < listenIndex, JSON.stringify(run.stackA.bootLines));
    const sidecarsA = (await descendants(stackA.proc.pid)).filter((row) => /transcribe\.py/u.test(row.command));
    check("D2 the dev server owns a faster-whisper sidecar process (descendant of the stack)", sidecarsA.length >= 1, sidecarsA.map((row) => `${row.pid}`).join(","));

    const pageA = `http://127.0.0.1:${staticServer.port}/?${new URLSearchParams({ encounterSync: `ws://127.0.0.1:${stackA.port}`, encounterMicInject: "1" })}`;
    const driveA = async (page) => {
      await waitJoined(page);
      const probe = { joined: await readShell(page), captures: [] };
      if (options.mode === "quest") {
        // The headset audio clock can lag after a wake: wait (bounded) until a fresh AudioContext clock advances, record the wait.
        probe.audioWarmup = await page.evaluate(async () => {
          const started = performance.now();
          const context = new AudioContext();
          await context.resume();
          const t0 = context.currentTime;
          while (context.currentTime - t0 < 0.5 && performance.now() - started < 45000) await new Promise((r) => setTimeout(r, 100));
          const advanced = context.currentTime - t0;
          await context.close();
          return { waitMs: Math.round(performance.now() - started), advancedS: Math.round(advanced * 1000) / 1000 };
        });
      }
      probe.grant = await page.context().grantPermissions(["microphone"]).then(() => "granted", (error) => `grant-failed: ${String(error).slice(0, 120)}`);
      for (let i = 0; i < 2; i += 1) {
        const before = (await readShell(page)).captures.length;
        await page.evaluate((samples) => globalThis.__openClinXrEncounterSync.speech.inject(Int16Array.from(samples)), pcm);
        await page.evaluate(() => globalThis.__openClinXrEncounterSync.speech.press());
        await sleep(Math.round(pcm.length / 16) + 800);
        await page.evaluate(() => document.getElementById("speak-button").dispatchEvent(new Event("pointerup")));
        await page.waitForFunction((count) => globalThis.__openClinXrEncounterSync.speech.captures.length > count, before, { timeout: 90000 });
        await sleep(1500);
        probe.captures.push(await readShell(page));
      }
      if (options.mode === "quest") {
        const before = (await readShell(page)).captures.length;
        await page.evaluate(() => globalThis.__openClinXrEncounterSync.speech.press());
        await sleep(3000);
        await page.evaluate(() => document.getElementById("speak-button").dispatchEvent(new Event("pointerup")));
        await page.waitForFunction((count) => globalThis.__openClinXrEncounterSync.speech.captures.length > count, before, { timeout: 90000 }).catch(() => undefined);
        await sleep(1500);
        probe.real = await readShell(page);
      }
      // Part A: a failed XR session start clears the published session.
      probe.xrCatch = await page.evaluate(async () => {
        const button = document.getElementById("enter-xr-button");
        const fake = { addEventListener() {}, end: async () => undefined };
        Object.defineProperty(navigator, "xr", { value: { requestSession: async () => fake, isSessionSupported: async () => true }, configurable: true });
        if (button === null) return { error: "no #enter-xr-button" };
        button.disabled = false;
        button.click();
        await new Promise((r) => setTimeout(r, 1500));
        return { sessionAfterFailure: globalThis.__openClinXrXrSession === undefined ? "undefined" : "set", status: document.getElementById("xr-status")?.textContent ?? null };
      }).catch((error) => ({ error: String(error).slice(0, 160) }));
      probe.final = await readShell(page);
      return probe;
    };
    const outA = await probeFn(pageA, driveA);
    const pa = outA.probe;
    run.stackA.probe = pa;
    run.pageErrors.push(...outA.pageErrors);
    run.consoleErrors.push(...outA.consoleErrors);
    check("D3 the shell joined stack A, reports serverSpeech available, shows a mic preflight state and its status text, and keeps the typed box", pa.joined?.state === "joined" && pa.joined.serverSpeech === "available" && ["granted", "prompt"].includes(pa.joined.micState) && /^Microphone (ready|permission needed)$/u.test(pa.joined.micStatus ?? "") && pa.joined.buttonHidden === false && pa.joined.typedBoxHidden === false, JSON.stringify({ mic: pa.joined?.micState, server: pa.joined?.serverSpeech, text: pa.joined?.micStatus, hidden: pa.joined?.buttonHidden }));
    const norm = (text) => text.toLowerCase().replace(/[^a-z0-9 ]/gu, " ").replace(/\s+/gu, " ").trim();
    const caps = pa.captures.map((shell) => shell.captures.at(-1));
    check("D4 two injected push-to-talk captures were recognized by the dev server: status ok, non-silent, words in the learner caption", caps.length === 2 && caps.every((c) => c?.status === "ok" && c.source === "injected" && c.rms > 0.005 && c.chars > 5) && pa.captures.every((shell) => { const t = norm(shell.learnerCaption ?? ""); return /^you said 0 \d\d /u.test(t) && t.includes("chest") && t.includes("pressure"); }), JSON.stringify(caps.map((c) => ({ s: c?.status, chars: c?.chars, conf: c?.confidence, ms: c?.releaseToCaptionMs }))));
    const injectedSends = pa.captures.at(-1)?.speechUtterances ?? [];
    check("D5 each injected recognized utterance was sent to the room and acked (select-actor, utterance-start, utterance-end)", injectedSends.length === 2 && injectedSends.every((u) => u.statuses.length === 3 && u.statuses.every((s) => s === "ack")), JSON.stringify(injectedSends));
    const latencies = caps.map((c) => c?.releaseToCaptionMs);
    run.latency = { releaseToCaptionMs: latencies, median: median(latencies) };
    check("D6 release-to-caption latency recorded (finite, > 0, < 15 s)", latencies.length === 2 && latencies.every((v) => Number.isFinite(v) && v > 0 && v < 15000), JSON.stringify(run.latency));
    if (options.mode === "quest") {
      const real = pa.real?.captures?.at(-1);
      run.realMicrophone = { tested: Boolean(real?.status === "ok" && real.rms > 0.005), capture: real ?? null, micState: pa.real?.micState ?? null, micStatus: pa.real?.micStatus ?? null, permissionGrant: pa.grant };
      check("D7 the headset microphone path ran to a recorded outcome (source microphone) and the preflight state is one of granted/prompt/denied/unavailable", real !== undefined && real.source === "microphone" && ["granted", "prompt", "denied", "unavailable"].includes(pa.real.micState), JSON.stringify(run.realMicrophone));
    }
    check("D8 Part A: after a failed XR session start window.__openClinXrXrSession is undefined", pa.xrCatch?.sessionAfterFailure === "undefined", JSON.stringify(pa.xrCatch));
    const otherA = outA.consoleErrors.filter((text) => !isAsset404(text));
    check("D9 stack A page: no page errors and no console errors other than missing-asset 404s", outA.pageErrors.length === 0 && otherA.length === 0, [...outA.pageErrors, ...otherA].join(" | ") || `${outA.consoleErrors.length} asset 404s`);
    const chunkNames = (await readdir(join(APP_DIST, "assets"))).filter((n) => n.endsWith(".js"));
    const hits = [];
    for (const chunk of chunkNames) {
      const code = await readFile(join(APP_DIST, "assets", chunk), "utf8");
      for (const marker of ["@openclinxr/xr-sync-server", "@colyseus/core", "faster-whisper"]) if (code.includes(marker)) hits.push(`${chunk} contains ${marker.slice(0, 40)}`);
    }
    check("D10 no built chunk carries the server package, @colyseus/core or the recognizer", chunkNames.length > 0 && hits.length === 0, hits.join(" | ") || `${chunkNames.length} chunks`);
    const sidecarPids = sidecarsA.map((row) => row.pid);
    const stoppedA = await stopStack(stackA);
    await sleep(1000);
    const portAfterA = await bindLoopback(stackA.port);
    const alive = (await Promise.all(sidecarPids.map(async (pid) => { try { process.kill(pid, 0); return pid; } catch { return null; } }))).filter((pid) => pid !== null);
    check("D11 SIGTERM stops stack A within 10 s, the port is released and the sidecar processes are gone", stoppedA && portAfterA === "bound" && alive.length === 0, `stopped=${stoppedA} port=${portAfterA} sidecarsAlive=${alive.join(",")}`);

    // Stack B: recognizer path missing.
    const stackB = startStack(`c34b-${process.pid}`, { XR_SYNC_STT_PYTHON: "/nonexistent/python" });
    stacks.push(stackB);
    await waitFor(() => stackB.port !== null || stackB.exited, READY_TIMEOUT_MS, "stack B listening line");
    run.stackB = { instance: stackB.instance, port: stackB.port, bootLines: stackB.output.split("\n").filter((l) => l.startsWith("xr-sync ")).slice(0, 6) };
    check("E1 stack B boots without a recognizer: prints `speech unavailable`, no `speech ready`, still listens, process alive", stackB.port !== null && /xr-sync speech unavailable: /u.test(stackB.output) && !/xr-sync speech ready/u.test(stackB.output) && !stackB.exited, JSON.stringify(run.stackB.bootLines));
    const pageB = `http://127.0.0.1:${staticServer.port}/?${new URLSearchParams({ encounterSync: `ws://127.0.0.1:${stackB.port}` })}`;
    const driveB = async (page) => {
      await waitJoined(page);
      await sleep(1000);
      const probe = { joined: await readShell(page) };
      await page.evaluate(() => {
        const input = document.getElementById("utterance-input");
        input.value = "Hello, I am the student doctor.";
        document.getElementById("utterance-send").click();
      });
      await page.waitForFunction(() => (globalThis.__openClinXrEncounterSync.utterances ?? []).some((u) => u.statuses.length === 3), undefined, { timeout: 30000 }).catch(() => undefined);
      probe.final = await readShell(page);
      return probe;
    };
    const outB = await probeFn(pageB, driveB);
    const pb = outB.probe;
    run.stackB.probe = pb;
    check("E2 the shell hides push-to-talk, says speech recognition is off, and keeps the typed box", pb.joined?.state === "joined" && pb.joined.serverSpeech === "unavailable" && pb.joined.buttonHidden === true && pb.joined.micStatus === "Speech recognition off: type your question" && pb.joined.typedBoxHidden === false, JSON.stringify({ server: pb.joined?.serverSpeech, hidden: pb.joined?.buttonHidden, text: pb.joined?.micStatus }));
    check("E3 a typed utterance on stack B is sent and acked (select-actor, utterance-start, utterance-end)", pb.final?.utterances?.length === 1 && pb.final.utterances[0].statuses.length === 3 && pb.final.utterances[0].statuses.every((s) => s === "ack"), JSON.stringify(pb.final?.utterances));
    const otherB = outB.consoleErrors.filter((text) => !isAsset404(text));
    run.pageErrors.push(...outB.pageErrors);
    run.consoleErrors.push(...outB.consoleErrors);
    check("E4 stack B page: no page errors and no console errors other than missing-asset 404s", outB.pageErrors.length === 0 && otherB.length === 0, [...outB.pageErrors, ...otherB].join(" | ") || `${outB.consoleErrors.length} asset 404s`);
    const stillUp = !stackB.exited;
    const stoppedB = await stopStack(stackB);
    check("E5 stack B stayed up for the whole page run and exits within 10 s of SIGTERM", stillUp && stoppedB, `stillUp=${stillUp} stopped=${stoppedB}`);

    if (options.mode === "quest") {
      const lists = await collectQuestCleanupLists({ staticPort: staticServer.port, syncPort: String(stackA.port), serial: options.serial });
      const listsB = await collectQuestCleanupLists({ staticPort: staticServer.port, syncPort: String(stackB.port), serial: options.serial });
      run.adbReverseList = lists.adbReverseList;
      run.adbForwardList = lists.adbForwardList;
      check("Q1 adb reverse/forward lists hold neither run port nor tcp:9222", !lists.leaked && !listsB.leaked, `reverse=${lists.adbReverseList} forward=${lists.adbForwardList}`);
    }
  } catch (error) {
    process.exitCode = 1;
    run.fatal = String(error?.stack ?? error).slice(0, 1600);
  } finally {
    for (const stack of stacks) await stopStack(stack).catch(() => undefined);
    await staticServer?.close().catch(() => undefined);
    run.elapsedMs = Date.now() - startedMs;
    await writeFile(join(outDir, "c34-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 300));
    if (run.fatal) console.log(`FATAL ${run.fatal.slice(0, 400)}`);
    console.log(`wrote ${join(outDir, "c34-run.json")}`);
  }
  process.exit(process.exitCode ?? 0);
}

await main(process.argv.slice(2));
