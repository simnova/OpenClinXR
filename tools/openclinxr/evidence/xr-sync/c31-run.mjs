#!/usr/bin/env node
/**
 * C31 host/Quest harness: a replayed station speaks. A live session is recorded (review-safe trace, no caption text);
 * a replay server booted with scenarios + the SHIPPED seed bank recomputes each actor turn's caption from the cast by
 * replyId; the production shell (apps/ui-xr) joins the replay room (?encounterReplayStation=) and speaks the turns through
 * the C30 mesm-tts voice path with mouth cues. A trace whose replyId resolves to nothing is refused, not spoken.
 *
 * Host:  node c31-run.mjs --mode host --out <dir>
 * Quest: node c31-run.mjs --mode quest --serial <serial> --out <dir>
 * Exit 1 on any failed assertion.
 */
import { createHash } from "node:crypto";
import { cpSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectQuestCleanupLists, parseArgs, runHostProbe, runQuestProbe, startStaticServer } from "./harness-lib.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..", "..");
const SERVER_DIST = join(ROOT, "packages/openclinxr/xr-sync-server/dist/index.js");
const CLIENT_DIST = join(ROOT, "packages/openclinxr/xr-sync-client/dist/index.js");
const FIXTURES_DIST = join(ROOT, "packages/openclinxr/scenario-fixtures/dist/index.js");
const APP_DIST = join(ROOT, "apps/ui-xr/dist");
const TIMING = { doorwaySeconds: 1, encounterSeconds: 60, noteSeconds: 1, breakAfterStationOrders: [] };
const JOIN_TIMEOUT_MS = 240000;
const REPLAY_STEP_MS = 2500;

const blueprint = {
  blueprintId: "bp-evidence-c31",
  title: "C31 replay speech",
  stationSlots: [{ slotId: "slot-a", order: 1, label: "C31 chest", requiredEnvironmentIds: [], requiredTraceTags: [] }],
  timing: TIMING,
  requiredTraceTags: [],
  requiredSafetyCriticalTraceTags: [],
};
const stripName = (caption) => caption.replace(/^[^:]{1,60}:\s+/u, "").trim();
const fnv = (text) => { let hash = 0x811c9dc5; for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; } return hash.toString(16).padStart(8, "0"); };
const RECORD_KEYS = ["actorId", "attached", "audioClock", "audioSeconds", "chars", "chunks", "computeMs", "cueCount", "error", "firstAudioMs", "firstChunkMs", "nonSilentCues", "peak", "played", "rtf", "turnKey", "underruns", "voiceFallback", "voiceRequested", "voiceUsed", "xRealtime"];
const median = (values) => { const s = [...values].sort((a, b) => a - b); return s.length === 0 ? null : s[Math.floor(s.length / 2)]; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dirDigest = async (dir) => { const parts = []; for (const n of (await readdir(dir)).sort()) parts.push(`${n}:${createHash("sha256").update(await readFile(join(dir, n))).digest("hex")}`); return parts.join("|"); };

async function main(argv) {
  const options = parseArgs(argv);
  const outDir = resolve(options.out);
  await mkdir(outDir, { recursive: true });
  const traceDir = await mkdtemp(join(tmpdir(), "xr-sync-c31-trace-"));
  const forgedDir = await mkdtemp(join(tmpdir(), "xr-sync-c31-forged-"));
  const run = { mode: options.mode, serial: options.mode === "quest" ? options.serial : null, script: "c31", engine: { name: "mesm-tts", model: "heart v2f_lite", revision: "aa59535a8c2b1cf7b0229956ceb26d7f62ef7a14" }, assertions: [], probe: null, refusal: null, pageErrors: [], consoleErrors: [], notEvidenceFor: { soundHeardByAPerson: true, clinicalValidity: true, examEquivalence: true } };
  const check = (name, pass, detail = "") => {
    run.assertions.push({ name, pass: Boolean(pass), detail: String(detail) });
    if (!pass) process.exitCode = 1;
  };
  let liveServer = null;
  let replayServer = null;
  let forgedServer = null;
  let staticServer = null;
  const startedMs = Date.now();
  try {
    const { createEncounterServer } = await import(SERVER_DIST);
    const { connect } = await import(CLIENT_DIST);
    const { edChestPainScenario, scenarioDialogueSeedBank: shippedSeedBank } = await import(FIXTURES_DIST);
    const entry = shippedSeedBank.find((e) => e.scenarioId === edChestPainScenario.scenarioId);
    const seedOf = (id) => entry.seeds.find((s) => s.seedId === id);
    const onset = seedOf("patient_onset_history");
    const escalation = seedOf("nurse_team_escalation");
    const scenario = { ...edChestPainScenario, status: "approved", eventSchedule: edChestPainScenario.eventSchedule.map((slot) => ({ ...slot, atSecond: TIMING.encounterSeconds })) };
    const patient = scenario.actors.find((a) => a.actorId === onset.actorId);
    const nurse = scenario.actors.find((a) => a.actorId === escalation.actorId);
    const expectedCaptions = [
      `${patient.displayName}: ${patient.openingUtterance}`,
      `${patient.displayName}: ${onset.caption ?? onset.spokenText}`,
      `${patient.displayName}: ${entry.utteranceFallback.line}`,
      `${nurse.displayName}: `,
      `${nurse.displayName}: ${escalation.caption ?? escalation.spokenText}`,
    ];
    const expectedChars = expectedCaptions.map((c) => stripName(c).length);
    run.expectedSpokenChars = expectedChars;

    // Phase A: record a live session through the node client (trace persists on station end).
    liveServer = await createEncounterServer({ examBlueprint: blueprint, scenarios: [scenario], dialogueSeeds: shippedSeedBank, traceDir });
    const learner = await connect(liveServer.url, { roomOptions: { actors: [patient.actorId, nurse.actorId] } });
    const liveState = () => JSON.parse(liveServer.getStateJSON());
    const phaseBy = Date.now() + 120000;
    while (liveState().phase !== "encounter" && Date.now() < phaseBy) await sleep(200);
    const say = async (actorId, text) => {
      const ok = [];
      for (const [kind, payload] of [["select-actor", { actorId }], ["utterance-start", {}], ["utterance-end", { text }]]) ok.push((await learner.sendIntent(kind, payload)).status);
      const by = Date.now() + 30000;
      while (liveState().actors?.[actorId]?.speaking !== true && Date.now() < by) await sleep(50);
      while (liveState().actors?.[actorId]?.speaking === true && Date.now() < by + 30000) await sleep(100);
      return ok;
    };
    const recorded = [
      await say(patient.actorId, "hello there"),
      await say(patient.actorId, onset.utterancePhrases[0]),
      await say(patient.actorId, "what is the capital of france"),
      await say(nurse.actorId, "hello nurse"),
      await say(nurse.actorId, escalation.utterancePhrases[0]),
    ];
    check("R0 the live session was recorded: five utterances, all intents acked", recorded.every((s) => s.every((v) => v === "ack")), JSON.stringify(recorded));
    for (let i = 0; i < 900 && !(await readdir(traceDir)).includes("exam-session.review-index.json"); i += 1) await sleep(200);
    await learner.leave().catch(() => undefined);
    await liveServer.close();
    liveServer = null;

    const traceFiles = (await readdir(traceDir)).filter((n) => n.endsWith(".conversation-trace.json"));
    const raws = await Promise.all((await readdir(traceDir)).map((n) => readFile(join(traceDir, n), "utf8")));
    const sizes = await Promise.all((await readdir(traceDir)).map(async (n) => (await stat(join(traceDir, n))).size));
    const lines = [patient.openingUtterance, onset.caption ?? onset.spokenText, entry.utteranceFallback.line, escalation.caption ?? escalation.spokenText].map((t) => t.toLowerCase());
    const leaks = lines.filter((text) => raws.some((raw) => raw.toLowerCase().includes(text)));
    const audioKeys = raws.filter((raw) => /"[^"]*(audio|sample|waveform|wav|pcm|base64|pdn)[^"]*"\s*:/iu.test(raw)).length;
    check("R1 the recorded trace is review-safe: no caption text, no audio-shaped key, every file under 40 kB", traceFiles.length === 1 && leaks.length === 0 && audioKeys === 0 && sizes.every((n) => n < 40000), JSON.stringify({ files: traceFiles.length, leaks, audioKeys, sizes }));
    const digestBefore = await dirDigest(traceDir);
    cpSync(traceDir, forgedDir, { recursive: true });
    const forgedFile = join(forgedDir, traceFiles[0]);
    const forgedTrace = (await readFile(forgedFile, "utf8")).split(`${patient.actorId}:seed:patient_onset_history`).join(`${patient.actorId}:seed:forged_line`);
    await writeFile(forgedFile, forgedTrace, "utf8");

    // Phase B: replay servers (valid and forged) booted with the cast + the shipped seed bank.
    replayServer = await createEncounterServer({ replayDir: traceDir, replayStepMs: REPLAY_STEP_MS, scenarios: [scenario], dialogueSeeds: shippedSeedBank });
    staticServer = await startStaticServer(APP_DIST);
    const pageUrlFor = (url) => `http://127.0.0.1:${staticServer.port}/?${new URLSearchParams({ encounterSync: url, encounterReplayStation: "slot-a" })}`;
    run.pageUrl = pageUrlFor(replayServer.url);

    const drive = async (page) => {
      if (options.mode === "quest") await page.mouse.click(8, 8).catch(() => undefined);
      await page.waitForFunction(() => { const e = globalThis.__openClinXrEncounterSync; return e !== undefined && e.state !== "joining"; }, undefined, { timeout: JOIN_TIMEOUT_MS });
      const readShell = () => page.evaluate(() => {
        const e = globalThis.__openClinXrEncounterSync;
        const hash = (text) => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); };
        return { state: e.state, error: e.error, replayStation: e.replayStation ?? null, turns: e.turns.length, turnCaptionHashes: e.turns.map((t) => hash(t.planCaption)), turnSpoken: e.turns.map((t) => t.spoken), turnReplyIds: e.turns.map((t) => t.replyId), voiceError: e.voice?.error ?? "", records: e.voice ? JSON.parse(JSON.stringify(e.voice.records)) : null, inputMounted: document.getElementById("utterance-input") !== null || document.getElementById("utterance-send") !== null };
      });
      await page.evaluate(() => {
        const hash = (text) => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); };
        globalThis.__c31Spoken = [];
        const Original = globalThis.Worker;
        globalThis.Worker = class extends Original {
          postMessage(message, transfer) { if (message && message.op === "speak") globalThis.__c31Spoken.push(hash(String(message.text))); return super.postMessage(message, transfer); }
        };
      });
      const probe = { marks: [], quiet: null };
      const joined = await readShell();
      probe.joined = joined;
      if (joined.state !== "joined" || joined.records === null) return { ...probe, final: joined };
      probe.unlock = await page.evaluate(async () => { const v = globalThis.__openClinXrEncounterSync.voice; const before = v.audioState(); const error = await v.unlock().then(() => "", (e) => String(e).slice(0, 200)); return { before, after: v.audioState(), error }; });
      await page.evaluate((ids) => {
        globalThis.__c31Mouth = [];
        setInterval(() => { const v = globalThis.__openClinXrEncounterSync.voice; const t = performance.now(); globalThis.__c31Mouth.push([t, ...ids.map((id) => v.mouth(id))]); if (globalThis.__c31Mouth.length > 40000) globalThis.__c31Mouth.shift(); }, 25);
      }, [patient.actorId, nurse.actorId]);
      probe.restTargetsBefore = await page.evaluate((id) => globalThis.__openClinXrEncounterSync.voice.mouthTargets(id), patient.actorId);
      for (let index = 0; index < 5; index += 1) {
        const mark = await page.evaluate(() => globalThis.__c31Mouth.length);
        const arrived = await page.waitForFunction((count) => globalThis.__openClinXrEncounterSync.turns.length >= count && globalThis.__openClinXrEncounterSync.voice.records.length >= count, index + 1, { timeout: 180000 }).then(() => true, () => false);
        if (!arrived) { probe.stuck = { index, shell: await readShell() }; break; }
        await page.waitForFunction((i) => { const r = globalThis.__openClinXrEncounterSync.voice.records[i]; return r.chars === 0 || r.error !== "" || r.played !== undefined; }, index, { timeout: 30000 }).catch(() => undefined);
        probe.marks.push([mark, await page.evaluate(() => globalThis.__c31Mouth.length)]);
      }
      probe.settled = await page.waitForFunction(() => { const rows = globalThis.__c31Mouth.slice(-6); if (rows.length < 6) return false; return [1, 2].every((col) => { const v = rows.map((r) => r[col]); return Math.max(...v) - Math.min(...v) < 0.05; }); }, undefined, { timeout: 90000, polling: 500 }).then(() => true, () => false);
      probe.series = await page.evaluate(() => globalThis.__c31Mouth.map((row) => row.map((v, i) => (i === 0 ? Math.round(v) : Number(v.toFixed(3))))));
      probe.spokenHashes = await page.evaluate(() => globalThis.__c31Spoken);
      probe.restTargetsAfter = await page.evaluate((id) => globalThis.__openClinXrEncounterSync.voice.mouthTargets(id), patient.actorId);
      probe.final = await readShell();
      return probe;
    };
    const driveRefusal = async (page) => {
      await page.waitForFunction(() => { const e = globalThis.__openClinXrEncounterSync; return e !== undefined && e.state !== "joining"; }, undefined, { timeout: JOIN_TIMEOUT_MS });
      await sleep(3000);
      return page.evaluate(() => { const e = globalThis.__openClinXrEncounterSync; return { state: e.state, error: e.error, turns: e.turns.length, records: e.voice ? e.voice.records.length : null, spokenCount: e.turns.filter((t) => t.spoken).length }; });
    };
    const launch = (pageUrl, driveFn) => (options.mode === "host"
      ? runHostProbe({ pageUrl, outDir, drive: driveFn, launchArgs: ["--autoplay-policy=no-user-gesture-required"] })
      : runQuestProbe({ pageUrl, outDir, serial: options.serial, drive: driveFn }));
    const outcome = await launch(run.pageUrl, drive);
    run.probe = outcome.probe;
    run.pageErrors = outcome.pageErrors;
    run.consoleErrors = outcome.consoleErrors;
    run.browserProduct = outcome.browserProduct;
    const probe = outcome.probe;
    const final = probe.final;
    const records = final?.records ?? [];
    check("R3 the shell joined the replay room with the replay station named, voice evidence present without an error, and mounted no learner input", final?.state === "joined" && final.replayStation === "slot-a" && final.records !== null && final.voiceError === "" && final.inputMounted === false, JSON.stringify({ state: final?.state, error: final?.error, station: final?.replayStation, voiceError: final?.voiceError, inputMounted: final?.inputMounted }));
    check("R4 five replayed turns reached the shell with the recorded reply ids (opening, authored answer, table fallback, nurse opening, authored escalation) and five voice records exist in turn order", final?.turns === 5 && final.turnReplyIds[0] === `${patient.actorId}:opening` && final.turnReplyIds[1] === `${patient.actorId}:seed:patient_onset_history` && /^c3-/u.test(final.turnReplyIds[2]) && final.turnReplyIds[3] === `${nurse.actorId}:opening` && final.turnReplyIds[4] === `${nurse.actorId}:seed:nurse_team_escalation` && records.length === 5, JSON.stringify({ turns: final?.turns, ids: final?.turnReplyIds, records: records.map((r) => r.turnKey) }));
    check("R5 the replay server recomputed each turn's caption: the hashes of the five registered plan captions equal the hashes of the cast + seed-bank captions (the evidence file holds hashes, never caption text)", JSON.stringify(final?.turnCaptionHashes) === JSON.stringify(expectedCaptions.map(fnv)), JSON.stringify({ got: final?.turnCaptionHashes, want: expectedCaptions.map(fnv) }));
    const expectedSpoken = expectedCaptions.map(stripName).filter((line) => line !== "").map(fnv);
    run.spokenHashes = probe.spokenHashes;
    check("R6 the texts the page asked the Worker to speak hash-equal the four authored lines (opening, onset answer, fallback, nurse escalation); the nurse opening made no call; records carry only whitelisted keys", JSON.stringify(probe.spokenHashes) === JSON.stringify(expectedSpoken) && JSON.stringify(records.map((r) => r.chars)) === JSON.stringify(expectedChars) && records.every((r) => Object.keys(r).every((key) => RECORD_KEYS.includes(key))), JSON.stringify({ sent: probe.spokenHashes, expected: expectedSpoken, chars: records.map((r) => r.chars) }));
    const spoken = records.filter((r) => r.chars > 0);
    check("R7 every spoken turn synthesized in the Worker without error with chunks, positive audio length and a first chunk", spoken.length === 4 && spoken.every((r) => r.error === "" && typeof r.firstChunkMs === "number" && r.audioSeconds > 0.3 && r.chunks > 0), JSON.stringify(spoken.map((r) => ({ k: r.turnKey, e: r.error.slice(0, 80), c: r.firstChunkMs, a: r.audioSeconds }))));
    const audioStarted = spoken.filter((r) => typeof r.firstAudioMs === "number" && r.played > 0.9 * r.audioSeconds * 24000 && r.underruns === 0).length;
    const onAudioClock = spoken.filter((r) => r.audioClock === "audio").length;
    run.audioOutput = { startedAndPlayed: audioStarted, onAudioClock, attached: spoken.map((r) => r.attached), spokenTurns: spoken.length, clocks: spoken.map((r) => r.audioClock), unlock: probe.unlock };
    check("R8 the audio worklet started and finished every spoken turn (at least 90% of samples played, no underrun); on the headset every turn ran on the audio clock", audioStarted === 4 && (options.mode === "host" || onAudioClock === 4), JSON.stringify(run.audioOutput));
    check("R9 voice per actor comes from scenario data: patient authored miles -> Heart with voiceFallback true; nurse authors none -> Heart, no fallback", records.slice(0, 3).every((r) => r.voiceRequested === "miles" && r.voiceUsed === "heart" && r.voiceFallback === true) && records.slice(3).every((r) => r.voiceRequested === "heart" && r.voiceUsed === "heart" && r.voiceFallback === false), JSON.stringify(records.map((r) => [r.voiceRequested, r.voiceUsed, r.voiceFallback])));
    check("R10 the synthesized audio is not silent: peak above 0.02 on every spoken turn", spoken.every((r) => r.peak > 0.02), JSON.stringify(spoken.map((r) => r.peak)));
    const series = probe.series ?? [];
    const tail = series.slice(-6);
    const rangeOf = (rows, col) => { const v = rows.map((r) => r[col]); return v.length === 0 ? 1 : Math.max(...v) - Math.min(...v); };
    const restOf = [median(tail.map((r) => r[1])) ?? 0, median(tail.map((r) => r[2])) ?? 0];
    const quiet = [rangeOf(tail, 1), rangeOf(tail, 2)];
    const mouthTurns = (probe.marks ?? []).map(([from, to], i) => {
      const col = i < 3 ? 1 : 2;
      const rows = series.slice(from, to).map((r) => r[col]);
      return { turn: i + 1, frames: rows.length, maxDelta: rows.length === 0 ? 0 : Math.max(...rows.map((v) => Math.abs(v - restOf[col - 1]))), open: rows.filter((v) => Math.abs(v - restOf[col - 1]) > 0.05).length };
    });
    run.mouthTurns = mouthTurns;
    const spokenMouth = mouthTurns.filter((_, i) => records[i]?.chars > 0);
    check("R11 the mouth moves with the replayed speech: on the spoken turns the actor's viseme and mouth morph sum departs from its settled rest by more than 0.1 on at least 5 sampled frames on the headset and, on the host (software rendering samples about 1.4 frames per second), on at least 1 frame for at least 3 of the 4 spoken turns; settled (range < 0.05 over the last 6 frames) after the last turn", tail.length === 6 && quiet.every((r) => r < 0.05) && spokenMouth.length === 4 && (options.mode === "host" ? spokenMouth.filter((m) => m.maxDelta > 0.1 && m.open >= 1).length >= 3 : spokenMouth.every((m) => m.maxDelta > 0.1 && m.open >= 5)), JSON.stringify({ restOf, quiet, restTargetsBefore: probe.restTargetsBefore, restTargetsAfter: probe.restTargetsAfter, mouthTurns }));
    check("R12 the shell speech got cues sized to the synthesized audio: every spoken turn is attached with 3 to 15 cues per second of audio and at least 2 non-silent cues", spoken.every((r) => r.attached === true && r.cueCount / r.audioSeconds >= 3 && r.cueCount / r.audioSeconds <= 15 && r.nonSilentCues >= 2), JSON.stringify(spoken.map((r) => [r.cueCount, r.audioSeconds, r.nonSilentCues, r.attached])));
    const warm = spoken.slice(1);
    const xr = spoken.map((r) => r.xRealtime);
    run.measure = {
      firstAudioMsCold: spoken[0]?.firstAudioMs ?? null,
      firstAudioMsWarmMedian: median(warm.map((r) => r.firstAudioMs).filter((v) => typeof v === "number")),
      firstAudioMsWarmMax: Math.max(...warm.map((r) => r.firstAudioMs).filter((v) => typeof v === "number"), 0),
      firstChunkMsCold: spoken[0]?.firstChunkMs ?? null,
      rtfMedian: median(spoken.map((r) => r.rtf)),
      xRealtimeMedian: median(xr),
      xRealtimeMin: xr.length === 0 ? null : Math.min(...xr),
    };
    check("R13 measured on this device: every spoken turn is synthesized faster than real time (rtf < 1) with its first chunk within 15 s", spoken.length === 4 && spoken.every((r) => r.rtf > 0 && r.rtf < 1 && r.firstChunkMs < 15000), JSON.stringify(run.measure));

    // Refusal (a second server in the same process would share the matchmaker, so the valid one closes first).
    await replayServer.close();
    replayServer = null;
    forgedServer = await createEncounterServer({ replayDir: forgedDir, replayStepMs: REPLAY_STEP_MS, scenarios: [scenario], dialogueSeeds: shippedSeedBank });
    const forgedRejection = await connect(forgedServer.url, { roomOptions: { replayStationId: "slot-a" } }).then(() => "joined", (error) => String(error?.message ?? error));
    check("R2 the server refuses the forged station at join with replay-unresolved-reply", /replay-unresolved-reply/.test(forgedRejection), forgedRejection.slice(0, 160));
    const refused = await launch(pageUrlFor(forgedServer.url), driveRefusal);
    run.refusal = refused.probe;
    check("R14 the shell joins the forged station and is refused: state failed, the error names replay-unresolved-reply, no turn reached the shell, nothing spoken, no voice record", refused.probe?.state === "failed" && /replay-unresolved-reply/.test(refused.probe.error) && refused.probe.turns === 0 && refused.probe.spokenCount === 0 && (refused.probe.records ?? 0) === 0, JSON.stringify(refused.probe));
    const isAsset404 = (text) => /Failed to load resource.*404/iu.test(text);
    const consoleErrors = [...outcome.consoleErrors, ...refused.consoleErrors];
    const otherConsoleErrors = consoleErrors.filter((text) => !isAsset404(text) && !/replay-unresolved-reply|Failed to load resource/iu.test(text));
    run.assetNotFoundConsoleErrors = consoleErrors.length - otherConsoleErrors.length;
    check("R15 no page errors and no console errors other than missing-asset 404s (the refused join's own console line excepted)", outcome.pageErrors.length === 0 && otherConsoleErrors.length === 0, [...outcome.pageErrors, ...otherConsoleErrors].join(" | ") || `${run.assetNotFoundConsoleErrors} asset or refusal lines`);
    check("R16 the replay wrote nothing: the trace directory is byte-identical after both replays", (await dirDigest(traceDir)) === digestBefore, "digest compared");
    const chunkNames = (await readdir(join(APP_DIST, "assets"))).filter((n) => n.endsWith(".js"));
    const hits = [];
    for (const chunk of chunkNames) {
      const code = await readFile(join(APP_DIST, "assets", chunk), "utf8");
      for (const marker of ["@openclinxr/xr-sync-server", "@colyseus/core", "phonemizer/dist"]) if (code.includes(marker)) hits.push(`${chunk} contains ${marker}`);
    }
    check("R17 no built chunk carries the server package, @colyseus/core or the eSpeak NG package", chunkNames.length > 0 && hits.length === 0, hits.join(" | ") || `${chunkNames.length} chunks`);
    const ownSource = await readFile(fileURLToPath(import.meta.url), "utf8");
    check("R18 overlay absent: the harness authors no phrases, fallback or voice, and the caption text never reaches the replay server except through the shipped seed bank", ![new RegExp("utterance" + "Phrases\\s*:"), new RegExp("utterance" + "Fallback\\s*:"), new RegExp("tts" + "Voice\\s*:")].some((p) => p.test(ownSource)) && patient.ttsVoice === "miles" && nurse.ttsVoice === undefined, JSON.stringify({ patientVoice: patient.ttsVoice, nurseVoice: nurse.ttsVoice }));
    if (options.mode === "quest") {
      const lists = await collectQuestCleanupLists({ staticPort: staticServer.port, syncPort: new URL(run.pageUrl).searchParams.get("encounterSync").split(":").at(-1), serial: options.serial });
      run.adbReverseList = lists.adbReverseList;
      run.adbForwardList = lists.adbForwardList;
      check("R19 adb reverse/forward lists hold neither run port nor tcp:9222", !lists.leaked, `reverse=${lists.adbReverseList} forward=${lists.adbForwardList}`);
    }
  } catch (error) {
    process.exitCode = 1;
    run.fatal = String(error?.stack ?? error).slice(0, 1600);
  } finally {
    await liveServer?.close().catch(() => undefined);
    await replayServer?.close().catch(() => undefined);
    await forgedServer?.close().catch(() => undefined);
    await staticServer?.close().catch(() => undefined);
    run.elapsedMs = Date.now() - startedMs;
    await writeFile(join(outDir, "c31-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 300));
    if (run.fatal) console.log(`FATAL ${run.fatal.slice(0, 400)}`);
    if (run.measure) console.log(`MEASURE ${JSON.stringify(run.measure)}`);
    console.log(`wrote ${join(outDir, "c31-run.json")}`);
  }
  process.exit(process.exitCode ?? 0);
}

await main(process.argv.slice(2));
