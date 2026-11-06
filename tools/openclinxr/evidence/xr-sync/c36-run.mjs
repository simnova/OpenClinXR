#!/usr/bin/env node
/**
 * C36 host/Quest harness: on the documented dev stack (`pnpm --filter @openclinxr/xr-sync-server dev:portless`, XR_SYNC_DOORWAY_SECONDS=45) the
 * apps/ui-xr shell shows the cast (name and role), the authored topic menu and the doorway countdown from room state, and a doorway-phase
 * refusal (a typed utterance sent before the encounter opens) is visible text, not a silent drop. Expected texts are computed at run time from
 * the shipped scenario (no copied strings). After the doorway opens the refusal clears, a typed phrase and one spoken turn (getUserMedia
 * override, as c35) get the authored answer.
 *
 * Host:  node c36-run.mjs --mode host --out <dir>
 * Quest: node c36-run.mjs --mode quest --serial <serial> --out <dir>
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
const DOORWAY_SECONDS = 45;
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
  const run = { mode: options.mode, serial: options.mode === "quest" ? options.serial : null, script: "c36", assertions: [], stack: null, pageErrors: [], consoleErrors: [], notEvidenceFor: { soundHeardByPerson: true, clinicalValidity: true } };
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
    const TYPED_PHRASE = seed.utterancePhrases[0];
    const TYPED_HELLO = "Hello, I am the student doctor.";
    const label = (tag) => tag.replaceAll("_", " ");
    const expectedCast = `Cast: ${edChestPainScenario.actors.map((a) => `${a.displayName} (${a.role})`).join("; ")}`;
    const expectedTopics = `Ask about: ${[...new Set(edChestPainScenario.requiredTraceTags)].filter((t) => t !== "patient_note_submitted").map(label).join(", ")}`;
    run.expected = { expectedCast, expectedTopics, actorId: actor.actorId, seedReplyId: `${actor.actorId}:seed:${seed.seedId}` };

    const audioDir = join(outDir, "audio");
    await makeFixtures(audioDir);
    const pcm = await readPcm(join(audioDir, "onset.wav"));
    staticServer = await startStaticServer(APP_DIST);
    const launchArgs = ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${join(audioDir, "onset.wav")}`];
    const initScript = () => {
      const ctl = { wav: null, calls: 0, opened: 0, played: 0, ctx: null, dest: null };
      globalThis.__c36Mic = ctl;
      const devices = navigator.mediaDevices;
      if (devices === undefined) return;
      devices.getUserMedia = async () => {
        ctl.calls += 1;
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
    const readPanel = (page) => page.evaluate(() => {
      const text = (id) => document.getElementById(id)?.textContent ?? null;
      const e = globalThis.__openClinXrEncounterSync;
      return {
        cast: text("room-cast"), topics: text("room-topics"), countdown: text("room-countdown"), refusal: text("room-refusal"),
        state: e?.state ?? null, error: e?.error ?? "",
        turns: JSON.parse(JSON.stringify((e?.turns ?? []).map((t) => ({ actorId: t.actorId, replyId: t.replyId, caption: t.caption })))),
        utterances: JSON.parse(JSON.stringify(e?.utterances ?? [])),
        captures: JSON.parse(JSON.stringify(e?.speech?.captures ?? [])),
      };
    });
    const waitJoined = (page) => page.waitForFunction(() => { const e = globalThis.__openClinXrEncounterSync; return e !== undefined && e.state !== "joining"; }, undefined, { timeout: JOIN_TIMEOUT_MS });

    const stack = startStack(`c36-${process.pid}`, { XR_SYNC_DOORWAY_SECONDS: String(DOORWAY_SECONDS) });
    stacks.push(stack);
    await waitFor(() => stack.port !== null || stack.exited, READY_TIMEOUT_MS, "stack listening line");
    run.stack = { instance: stack.instance, port: stack.port, bootLines: stack.output.split("\n").filter((l) => l.startsWith("xr-sync ")).slice(0, 8), exited: stack.exited };
    check("S1 the documented stack started with XR_SYNC_DOORWAY_SECONDS and listens", stack.port !== null && !stack.exited, JSON.stringify(run.stack.bootLines));

    const pageUrl = `http://127.0.0.1:${staticServer.port}/?${new URLSearchParams({ encounterSync: `ws://127.0.0.1:${stack.port}`, encounterMicInject: "1" })}`;
    const drive = async (page) => {
      await waitJoined(page);
      const probe = {};
      await page.locator("#utterance-input").waitFor({ timeout: 60000 });
      await page.context().grantPermissions(["microphone"]).catch(() => undefined);
      // Doorway: the panel shows cast, topics and a falling countdown.
      await page.waitForFunction(() => /^Cast: /u.test(document.getElementById("room-cast")?.textContent ?? ""), undefined, { timeout: 30000 }).catch(async (error) => {
        run.diag = { panel: await readPanel(page), hasPanel: await page.evaluate(() => document.getElementById("room-panel") !== null) };
        throw error;
      });
      probe.doorwayA = await readPanel(page);
      // A typed utterance sent before the encounter opens is refused and the refusal is visible.
      await page.evaluate((value) => { document.getElementById("utterance-input").value = value; document.getElementById("utterance-send").click(); }, TYPED_PHRASE);
      await page.waitForFunction(() => (document.getElementById("room-refusal")?.textContent ?? "") !== "", undefined, { timeout: 15000 }).catch(() => undefined);
      probe.refused = await readPanel(page);
      await page.locator("#room-panel").screenshot({ path: join(outDir, "c36-doorway-refusal.png") }).catch(() => undefined);
      await sleep(2500);
      probe.doorwayB = await readPanel(page);
      // Encounter opens: countdown switches, refusal clears.
      await page.waitForFunction(() => /^Encounter: /u.test(document.getElementById("room-countdown")?.textContent ?? ""), undefined, { timeout: 120000 });
      await page.waitForFunction(() => (document.getElementById("room-refusal")?.textContent ?? "") === "", undefined, { timeout: 15000 }).catch(() => undefined);
      probe.open = await readPanel(page);
      await page.locator("#room-panel").screenshot({ path: join(outDir, "c36-encounter.png") }).catch(() => undefined);
      const patientTurns = async () => (await readPanel(page)).turns.filter((t) => t.actorId === actor.actorId).length;
      const waitTurn = async (count) => { await page.waitForFunction(({ id, count }) => globalThis.__openClinXrEncounterSync.turns.filter((t) => t.actorId === id).length >= count, { id: actor.actorId, count }, { timeout: 120000 }); await sleep(800); };
      let have = await patientTurns();
      for (const value of [TYPED_HELLO, TYPED_PHRASE]) {
        await page.evaluate((text) => { document.getElementById("utterance-input").value = text; document.getElementById("utterance-send").click(); }, value);
        await waitTurn(have + 1);
        have += 1;
      }
      probe.typed = await readPanel(page);
      // One spoken turn through the app's getUserMedia path (harness override, as c35).
      await page.evaluate((samples) => { globalThis.__c36Mic.wav = samples; }, pcm);
      await page.evaluate(() => document.getElementById("speak-button").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
      await page.waitForFunction(() => globalThis.__c36Mic.opened > 0 && globalThis.__c36Mic.ctx !== null, undefined, { timeout: 20000 });
      await sleep(800);
      await page.evaluate(() => globalThis.__c36Mic.play());
      await sleep(Math.round(pcm.length / 16) + 800);
      await page.evaluate(() => document.getElementById("speak-button").dispatchEvent(new PointerEvent("pointerup", { bubbles: true })));
      await waitTurn(have + 1);
      probe.spoken = await readPanel(page);
      probe.final = probe.spoken;
      return probe;
    };
    const out = await probeFn(pageUrl, drive);
    const p = out.probe;
    run.stack.probe = p;
    run.pageErrors.push(...out.pageErrors);
    run.consoleErrors.push(...out.consoleErrors);
    check("S2 the shell joined the dev stack's room", p.doorwayA?.state === "joined", JSON.stringify({ state: p.doorwayA?.state, error: p.doorwayA?.error }));
    check("S3 #room-cast lists each shipped scenario actor as `<displayName> (<role>)`", p.doorwayA?.cast === expectedCast, `${p.doorwayA?.cast} | expected ${expectedCast}`);
    check("S4 #room-topics lists the shipped scenario's authored topics (requiredTraceTags minus the note tag)", p.doorwayA?.topics === expectedTopics, `${p.doorwayA?.topics} | expected ${expectedTopics}`);
    const secondsOf = (text) => Number(/(\d+) s/u.exec(text ?? "")?.[1] ?? Number.NaN);
    const a = secondsOf(p.doorwayA?.countdown), b = secondsOf(p.doorwayB?.countdown);
    check("S5 the doorway countdown reads `Encounter opens in N s` and falls between two reads 2.5 s apart", /^Encounter opens in \d+ s$/u.test(p.doorwayA?.countdown ?? "") && /^Encounter opens in \d+ s$/u.test(p.doorwayB?.countdown ?? "") && b < a && a <= DOORWAY_SECONDS, `${p.doorwayA?.countdown} -> ${p.doorwayB?.countdown}`);
    const sent = p.refused?.utterances?.[0];
    check("S6 a typed utterance during the doorway was rejected by the room and #room-refusal shows `Not open yet: the encounter opens in N s.`", sent?.statuses?.[0] === "reject" && /^Not open yet: the encounter opens in \d+ s\.$/u.test(p.refused?.refusal ?? "") && !p.refused.turns.some((t) => t.actorId === actor.actorId), JSON.stringify({ statuses: sent?.statuses, refusal: p.refused?.refusal, turns: p.refused?.turns?.length }));
    check("S7 once the encounter opens the countdown reads `Encounter: N s left` and the refusal text is cleared", /^Encounter: \d+ s left$/u.test(p.open?.countdown ?? "") && p.open?.refusal === "", JSON.stringify({ countdown: p.open?.countdown, refusal: p.open?.refusal }));
    const patient = (q) => (q?.turns ?? []).filter((t) => t.actorId === actor.actorId);
    check("S8 after the doorway a typed phrase and one spoken turn each got the shipped onset answer, with no refusal text", patient(p.typed).at(-1)?.replyId === run.expected.seedReplyId && patient(p.spoken).length === patient(p.typed).length + 1 && patient(p.spoken).at(-1)?.replyId === run.expected.seedReplyId && p.spoken?.refusal === "", JSON.stringify({ typed: patient(p.typed).map((t) => t.replyId), spoken: patient(p.spoken).map((t) => t.replyId), refusal: p.spoken?.refusal }));
    const own = await readFile(fileURLToPath(import.meta.url), "utf8");
    const literals = [...edChestPainScenario.actors.map((x) => x.displayName), ...edChestPainScenario.requiredTraceTags.map(label)];
    const copied = literals.filter((text) => own.includes(`"${text}"`) || own.includes(`'${text}'`));
    check("S9 the harness source holds none of the shipped actor names or topic labels (expected values are computed from the shipped scenario)", copied.length === 0, copied.join(", "));
    const other = out.consoleErrors.filter((text) => !isAsset404(text));
    check("S10 no page errors and no console errors other than missing-asset 404s", out.pageErrors.length === 0 && other.length === 0, [...out.pageErrors, ...other].join(" | ") || `${out.consoleErrors.length} asset 404s`);
    const stopped = await stopStack(stack);
    await sleep(1000);
    check("S11 SIGTERM stops the stack within 10 s and its port is released", stopped && (await bindLoopback(stack.port)) === "bound", `stopped=${stopped}`);
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
    await writeFile(join(outDir, "c36-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 300));
    if (run.fatal) console.log(`FATAL ${run.fatal.slice(0, 400)}`);
    console.log(`wrote ${join(outDir, "c36-run.json")}`);
  }
  process.exit(process.exitCode ?? 0);
}

await main(process.argv.slice(2));
