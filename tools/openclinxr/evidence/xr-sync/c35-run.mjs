#!/usr/bin/env node
/**
 * C35 host/Quest harness: the documented dev stack (`pnpm --filter @openclinxr/xr-sync-server dev:portless`, default env) loads the
 * shipped scenario + dialogue seed bank, so a room is cast and a learner utterance gets the scenario-authored answer, spoken in the
 * actor's voice with mouth cues. No harness-owned server, no overlay: expected lines are read from the shipped bank at run time.
 * Turns: typed greeting (opening), typed shipped phrase, two push-to-talk captures through the app's REAL getUserMedia path (the harness
 * replaces navigator.mediaDevices.getUserMedia before the page loads with a stream from an AudioContext MediaStreamDestination that plays the
 * fixture wav on a harness-controlled start; no app flag), one injected-path control capture, then a NotAllowedError override: the shell shows
 * denied, hides push-to-talk, and a typed utterance still gets the authored answer.
 * Unknown XR_SYNC_SCENARIO is refused by a second stack start (named error, exit 1, no listening line).
 *
 * Host:  node c35-run.mjs --mode host --out <dir>
 * Quest: node c35-run.mjs --mode quest --serial <serial> --out <dir>
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
const FIXTURES_DIST = join(ROOT, "packages/openclinxr/scenario-fixtures/dist/index.js");
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
  const run = { mode: options.mode, serial: options.mode === "quest" ? options.serial : null, script: "c35", assertions: [], stack: null, pageErrors: [], consoleErrors: [], notEvidenceFor: { soundHeardByAPerson: true, clinicalValidity: true, examEquivalence: true } };
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
    const { edChestPainScenario, scenarioDialogueSeedBank } = await import(FIXTURES_DIST);
    const entry = scenarioDialogueSeedBank.find((e) => e.scenarioId === edChestPainScenario.scenarioId);
    const seed = entry.seeds.find((s) => s.seedId === "patient_onset_history");
    const actor = edChestPainScenario.actors.find((a) => a.actorId === seed.actorId);
    const TYPED_HELLO = "Hello, I am the student doctor.";
    const TYPED_PHRASE = seed.utterancePhrases[0];
    const expectedLine = `${actor.displayName}: ${seed.caption ?? seed.spokenText}`;
    const expectedReplyIds = [`${actor.actorId}:opening`, ...Array(5).fill(`${actor.actorId}:seed:${seed.seedId}`)];
    run.expected = { actorId: actor.actorId, expectedReplyIds, expectedLine };

    const audioDir = join(outDir, "audio");
    await makeFixtures(audioDir);
    const pcm = await readPcm(join(audioDir, "onset.wav"));
    staticServer = await startStaticServer(APP_DIST);
    const launchArgs = ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${join(audioDir, "onset.wav")}`];
    const initScript = () => {
      const ctl = { mode: "wav", wav: null, calls: 0, opened: 0, denied: 0, played: 0, ctx: null, dest: null };
      globalThis.__c35Mic = ctl;
      const devices = navigator.mediaDevices;
      if (devices === undefined) return;
      devices.getUserMedia = async () => {
        ctl.calls += 1;
        if (ctl.mode === "deny") { ctl.denied += 1; throw new DOMException("Permission denied by harness", "NotAllowedError"); }
        const ctx = new AudioContext();
        await ctx.resume();
        ctl.ctx = ctx;
        ctl.dest = ctx.createMediaStreamDestination();
        ctl.opened += 1;
        return ctl.dest.stream;
      };
      ctl.play = () => {
        const buffer = ctl.ctx.createBuffer(1, ctl.wav.length, 16000);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < ctl.wav.length; i += 1) data[i] = ctl.wav[i] / 32768;
        const node = ctl.ctx.createBufferSource();
        node.buffer = buffer;
        node.connect(ctl.dest);
        node.start();
        ctl.played += 1;
      };
    };
    const probeFn = (pageUrl, drive) => (options.mode === "host" ? runHostProbe({ pageUrl, outDir, drive, launchArgs, initScript }) : runQuestProbe({ pageUrl, outDir, serial: options.serial, drive, initScript }));
    const readShell = (page) => page.evaluate(() => {
      const e = globalThis.__openClinXrEncounterSync;
      return {
        state: e.state, error: e.error, serverSpeech: e.speech?.serverSpeech ?? null,
        turns: JSON.parse(JSON.stringify(e.turns.map((t) => ({ actorId: t.actorId, replyId: t.replyId, caption: t.caption, planCaption: t.planCaption })))),
        voiceError: e.voice?.error ?? "", records: e.voice ? JSON.parse(JSON.stringify(e.voice.records)) : [],
        learnerCaption: document.getElementById("learner-caption")?.textContent ?? null, dialogue: document.getElementById("dialogue-line")?.textContent ?? null,
        utterances: JSON.parse(JSON.stringify(e.utterances ?? [])), speechUtterances: JSON.parse(JSON.stringify(e.speechUtterances ?? [])),
        captures: JSON.parse(JSON.stringify(e.speech?.captures ?? [])),
      };
    });
    const waitJoined = (page) => page.waitForFunction(() => { const e = globalThis.__openClinXrEncounterSync; return e !== undefined && e.state !== "joining"; }, undefined, { timeout: JOIN_TIMEOUT_MS });

    const stack = startStack(`c35-${process.pid}`);
    stacks.push(stack);
    await waitFor(() => stack.port !== null || stack.exited, READY_TIMEOUT_MS, "stack listening line");
    const bootLines = stack.output.split("\n").filter((l) => l.startsWith("xr-sync ")).slice(0, 8);
    run.stack = { instance: stack.instance, port: stack.port, bootLines, exited: stack.exited, exitCode: stack.exitCode, head: stack.output.slice(0, 1200) };
    const scenarioIdx = stack.output.indexOf(`xr-sync scenario ready id=${edChestPainScenario.scenarioId} actors=${edChestPainScenario.actors.length}`);
    check("S1 the documented stack (default env) printed `scenario ready` for the shipped ed-chest scenario before the listening line", stack.port !== null && scenarioIdx >= 0 && scenarioIdx < stack.output.indexOf("xr-sync listening"), JSON.stringify(bootLines));

    const pageUrl = `http://127.0.0.1:${staticServer.port}/?${new URLSearchParams({ encounterSync: `ws://127.0.0.1:${stack.port}`, encounterMicInject: "1" })}`;
    const drive = async (page) => {
      await waitJoined(page);
      const probe = { joined: await readShell(page), steps: [] };
      if (options.mode === "quest") {
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
      await page.context().grantPermissions(["microphone"]).catch(() => undefined);
      await page.locator("#utterance-input").waitFor({ timeout: 60000 });
      // The dev stack's station opens with a 1 s doorway phase; intents sent inside it are refused (outside-encounter-phase).
      await sleep(3000);
      const patientTurns = async () => (await readShell(page)).turns.filter((t) => t.actorId === seed.actorId).length;
      const waitTurn = async (count) => {
        try {
          await page.waitForFunction(({ id, count }) => globalThis.__openClinXrEncounterSync.turns.filter((t) => t.actorId === id).length >= count && globalThis.__openClinXrEncounterSync.voice.records.length >= count, { id: seed.actorId, count }, { timeout: 120000 });
        } catch (error) {
          run.diag = { waiting: count, audioWarmup: probe.audioWarmup ?? null, shell: await readShell(page).catch((e) => String(e)) };
          throw error;
        }
        await page.waitForFunction((count) => { const r = globalThis.__openClinXrEncounterSync.voice.records[count - 1]; return r !== undefined && (r.chars === 0 || r.error !== "" || r.played !== undefined); }, count, { timeout: 60000 }).catch(() => undefined);
        await sleep(800);
      };
      let have = await patientTurns();
      for (const text of [TYPED_HELLO, TYPED_PHRASE]) {
        await page.evaluate((value) => { document.getElementById("utterance-input").value = value; document.getElementById("utterance-send").click(); }, text);
        have += 1;
        await waitTurn(have);
        probe.steps.push({ kind: "typed", text, shell: await readShell(page) });
      }
      await page.evaluate((samples) => { globalThis.__c35Mic.wav = samples; }, pcm);
      const hold = async (play) => {
        await page.evaluate(() => document.getElementById("speak-button").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
        await play();
        await sleep(Math.round(pcm.length / 16) + 800);
        await page.evaluate(() => document.getElementById("speak-button").dispatchEvent(new PointerEvent("pointerup", { bubbles: true })));
      };
      for (let i = 0; i < 2; i += 1) {
        await hold(async () => {
          await page.waitForFunction(() => globalThis.__c35Mic.opened > 0 && globalThis.__c35Mic.ctx !== null, undefined, { timeout: 20000 });
          await sleep(800);
          await page.evaluate(() => globalThis.__c35Mic.play());
        });
        have += 1;
        await waitTurn(have);
        // Release the override's AudioContext so later captures do not compete with it for the (software) audio device.
        await page.evaluate(async () => { await globalThis.__c35Mic.ctx?.close().catch(() => undefined); globalThis.__c35Mic.ctx = null; });
        probe.steps.push({ kind: "override-microphone", shell: await readShell(page), mic: await page.evaluate(() => ({ calls: globalThis.__c35Mic.calls, opened: globalThis.__c35Mic.opened, played: globalThis.__c35Mic.played })) });
      }
      // Control: the injection hook (the only injected-path turn). A capture that records no samples (too-short) is retried once after a settle.
      let capturesBefore = 0;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await sleep(2000);
        await page.evaluate((samples) => globalThis.__openClinXrEncounterSync.speech.inject(Int16Array.from(samples)), pcm);
        capturesBefore = (await readShell(page)).captures.length;
        await hold(async () => undefined);
        await page.waitForFunction((n) => globalThis.__openClinXrEncounterSync.speech.captures.length > n, capturesBefore, { timeout: 90000 });
        probe.controlAttempts = attempt + 1;
        if ((await readShell(page)).captures.at(-1)?.status !== "too-short") break;
      }
      // The control's transcript may miss the phrase list or come back empty (recognizer variance): a turn is awaited briefly, not required.
      probe.controlTurn = await page.waitForFunction(({ id, count }) => globalThis.__openClinXrEncounterSync.turns.filter((t) => t.actorId === id).length >= count, { id: seed.actorId, count: have + 1 }, { timeout: 20000 }).then(() => true, () => false);
      if (probe.controlTurn) { have += 1; await waitTurn(have); }
      probe.steps.push({ kind: "injected-control", shell: await readShell(page), mic: await page.evaluate(() => ({ calls: globalThis.__c35Mic.calls })) });
      // Permission states: the override rejects with NotAllowedError.
      await page.evaluate(() => { globalThis.__c35Mic.mode = "deny"; });
      await page.evaluate(() => document.getElementById("speak-button").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
      await sleep(1500);
      await page.evaluate(() => document.getElementById("speak-button").dispatchEvent(new PointerEvent("pointerup", { bubbles: true })));
      await sleep(1000);
      probe.denied = await page.evaluate(() => ({ micState: globalThis.__openClinXrEncounterSync.speech.micState, micStatus: document.getElementById("mic-status")?.textContent ?? null, buttonHidden: document.getElementById("speak-button").hidden, typedHidden: document.getElementById("utterance-input").hidden, lastCapture: globalThis.__openClinXrEncounterSync.speech.captures.at(-1) ?? null, mic: { calls: globalThis.__c35Mic.calls, denied: globalThis.__c35Mic.denied } }));
      await page.evaluate((value) => { document.getElementById("utterance-input").value = value; document.getElementById("utterance-send").click(); }, TYPED_PHRASE);
      have += 1;
      await waitTurn(have);
      probe.steps.push({ kind: "typed-after-denied", shell: await readShell(page) });
      probe.final = await readShell(page);
      return probe;
    };
    const out = await probeFn(pageUrl, drive);
    const p = out.probe;
    run.stack.probe = p;
    run.pageErrors.push(...out.pageErrors);
    run.consoleErrors.push(...out.consoleErrors);
    check("S2 the shell joined the dev stack's room and the server reports speech available", p.joined?.state === "joined" && p.joined.serverSpeech === "available", JSON.stringify({ state: p.joined?.state, error: p.joined?.error, speech: p.joined?.serverSpeech }));
    const patientTurns = (p.final?.turns ?? []).filter((t) => t.actorId === actor.actorId).slice(0, 6);
    run.turns = patientTurns;
    const replyIds = patientTurns.map((t) => t.replyId);
    const withControl = p.controlTurn === true;
    const seedIdx = withControl ? [1, 2, 3, 5] : [1, 2, 3, 4];
    const controlReply = withControl ? (replyIds[4] ?? "") : "";
    // The injected-path control is a source check; its turn is optional and, when present, is the seed or a C3 fallback row (recognizer variance on a clipped tail).
    check("S3 the cast patient answered in order: opening, then the shipped onset seed for the typed phrase and both microphone-path captures, the injected control (optional turn: seed or C3 fallback row), and the shipped seed for the typed phrase after denial (replyIds from the shipped bank)", replyIds.length === (withControl ? 6 : 5) && replyIds[0] === expectedReplyIds[0] && seedIdx.every((i) => replyIds[i] === expectedReplyIds[1]) && (!withControl || controlReply === expectedReplyIds[1] || /^c3-/u.test(controlReply)), JSON.stringify({ withControl, replyIds }));
    const openingLine = `${actor.displayName}: ${actor.openingUtterance ?? ""}`;
    check("S4 the authored lines reached the shell: the opening line, and the shipped onset line on every seed turn (caption equals plan caption)", patientTurns[0]?.caption === openingLine && patientTurns.every((t) => t.caption === t.planCaption) && seedIdx.every((i) => patientTurns[i]?.caption === expectedLine), JSON.stringify(patientTurns.map((t) => t.caption)));
    const records = (p.final?.records ?? []).slice(0, 6);
    run.voiceRecords = records;
    check("S5 each answered turn was spoken in the actor's voice with mouth cues: synthesized audio played, no error, cues attached, at least 2 non-silent cues", p.final?.voiceError === "" && records.length === (withControl ? 6 : 5) && records.every((r) => r.chars > 0 && r.error === "" && r.attached === true && r.played !== undefined && r.nonSilentCues >= 2), JSON.stringify(records.map((r) => [r.chars, r.cueCount, r.nonSilentCues, r.attached, r.error])));
    const norm = (text) => text.toLowerCase().replace(/[^a-z0-9 ]/gu, " ").replace(/\s+/gu, " ").trim();
    const micSteps = p.steps.filter((s) => s.kind === "override-microphone");
    const micCaps = micSteps.map((s) => s.shell.captures.at(-1));
    run.turnSources = p.steps.map((s) => ({ kind: s.kind, source: s.shell.captures.at(-1)?.source ?? null, usedGetUserMediaOverride: s.kind === "override-microphone" }));
    check("S6 both override captures took the getUserMedia path (capture source microphone, override opened a stream each time and played the wav), were non-silent, and the recognized words (learner caption) carry the fixture sentence", micSteps.length === 2 && micCaps.every((c) => c?.source === "microphone" && c.status === "ok" && c.rms > 0.005) && micSteps.every((s, i) => s.mic.opened >= i + 1 && s.mic.played === i + 1 && s.mic.calls === i + 1) && micSteps.every((s) => { const t = norm(s.shell.learnerCaption ?? ""); return t.includes("chest") && t.includes("pressure"); }), JSON.stringify(micSteps.map((s, i) => ({ cap: micCaps[i], mic: s.mic, caption: s.shell.learnerCaption }))));
    const control = p.steps.find((s) => s.kind === "injected-control");
    const controlCap = control?.shell.captures.at(-1);
    check("S7 control: the injection-hook capture is the only injected one (source injected, getUserMedia not called for it) and is recognized", controlCap?.source === "injected" && controlCap.status === "ok" && control.mic.calls === 2 && norm(control.shell.learnerCaption ?? "").includes("chest"), JSON.stringify({ controlCap, calls: control?.mic }));
    const denied = p.denied;
    const deniedTyped = p.steps.find((s) => s.kind === "typed-after-denied");
    check("S7b NotAllowedError override: the failed capture is recorded, mic state denied, status text says blocked, push-to-talk hidden, typed box visible, and a typed utterance still gets the authored answer", denied?.micState === "denied" && /blocked/iu.test(denied.micStatus ?? "") && denied.buttonHidden === true && denied.typedHidden === false && /^failed:NotAllowedError/u.test(denied.lastCapture?.status ?? "") && denied.mic.denied >= 1 && deniedTyped?.shell.turns.filter((t) => t.actorId === actor.actorId).at(-1)?.replyId === expectedReplyIds.at(-1), JSON.stringify({ denied, typedReply: deniedTyped?.shell.turns.at(-1)?.replyId }));
    const sends = [...(p.final?.utterances ?? []), ...(p.final?.speechUtterances ?? [])];
    check("S7c every typed (3) and sent speech (2 microphone-path, plus the control when it sent) utterance was acked (select-actor, utterance-start, utterance-end)", sends.length >= 5 && sends.every((u) => u.statuses.length === 3 && u.statuses.every((st) => st === "ack")), JSON.stringify(sends.map((u) => u.statuses)));
    const own = await readFile(fileURLToPath(import.meta.url), "utf8");
    const overlay = [new RegExp("utterance" + "Phrases\\s*:"), new RegExp("utterance" + "Fallback\\s*:"), new RegExp("dialogue" + "Seeds\\s*:")].filter((re) => re.test(own));
    const literals = [seed.caption ?? seed.spokenText, entry.utteranceFallback?.line, actor.openingUtterance].filter((v) => typeof v === "string" && v.length > 0);
    const copied = literals.filter((text) => own.includes(text));
    check("S8 overlay absent: the harness starts no server, authors no phrase/fallback/seed properties, and its source holds none of the shipped answer, fallback or opening line texts (expected values are read from the shipped bank)", overlay.length === 0 && copied.length === 0 && literals.length === 3 && /dev:portless/u.test(own), JSON.stringify({ overlay: overlay.length, copied: copied.length, literals: literals.length }));
    const other = out.consoleErrors.filter((text) => !isAsset404(text));
    check("S9 no page errors and no console errors other than missing-asset 404s", out.pageErrors.length === 0 && other.length === 0, [...out.pageErrors, ...other].join(" | ") || `${out.consoleErrors.length} asset 404s`);
    const stopped = await stopStack(stack);
    await sleep(1000);
    check("S10 SIGTERM stops the stack within 10 s and its port is released", stopped && (await bindLoopback(stack.port)) === "bound", `stopped=${stopped}`);

    // Unknown id: a second stack start refuses with a named error and never listens.
    const bad = startStack(`c35bad-${process.pid}`, { XR_SYNC_SCENARIO: "no_such_scenario_v9" });
    stacks.push(bad);
    await Promise.race([bad.exitPromise, sleep(60000)]);
    check("S11 an unknown XR_SYNC_SCENARIO exits 1 with `unknown-scenario` naming the id and never prints a listening line", bad.exited && bad.exitCode !== 0 && /unknown-scenario: "no_such_scenario_v9"/u.test(bad.output) && bad.port === null, `exit=${bad.exitCode} ${bad.output.split("\n").filter((l) => /unknown-scenario/u.test(l)).join(" ").slice(0, 160)}`);

    if (options.mode === "quest") {
      const lists = await collectQuestCleanupLists({ staticPort: staticServer.port, syncPort: String(stack.port), serial: options.serial });
      run.adbReverseList = lists.adbReverseList;
      run.adbForwardList = lists.adbForwardList;
      check("Q1 adb reverse/forward lists hold neither run port nor tcp:9222", !lists.leaked, `reverse=${lists.adbReverseList} forward=${lists.adbForwardList}`);
    }
  } catch (error) {
    process.exitCode = 1;
    run.fatal = String(error?.stack ?? error).slice(0, 1600);
  } finally {
    for (const s of stacks) await stopStack(s).catch(() => undefined);
    await staticServer?.close().catch(() => undefined);
    run.elapsedMs = Date.now() - startedMs;
    await writeFile(join(outDir, "c35-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 300));
    if (run.fatal) console.log(`FATAL ${run.fatal.slice(0, 400)}`);
    console.log(`wrote ${join(outDir, "c35-run.json")}`);
  }
  process.exit(process.exitCode ?? 0);
}

await main(process.argv.slice(2));
