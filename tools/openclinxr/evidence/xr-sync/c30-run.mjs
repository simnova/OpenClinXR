#!/usr/bin/env node
/**
 * C30 host/Quest harness: the production shell (apps/ui-xr) speaks the server-authoritative actor turn with on-device
 * TTS (mesm-tts Heart, WebAssembly, module Worker), drives the existing mouth-cue path from the synthesized audio, and
 * shows a "please repeat" prompt on speech_low_confidence while the trace counts the retry.
 *
 * Host:  node c30-run.mjs --mode host --out <dir>
 * Quest: node c30-run.mjs --mode quest --serial <serial> --out <dir>
 *
 * Flow: ed-chest one-slot cast with the SHIPPED seed bank. Patient (scenario voice "miles", wired voice Heart => fallback):
 * (1) typed hello (opening) (2) typed onset phrase (authored answer) (3) speech 0.2 (fallback + prompt) (4) speech 0.3
 * (prompt attempt 2) (5) speech 0.9 (authored answer, prompt cleared). Nurse (no authored voice => Heart, no fallback):
 * (6) opening (no text), (7) authored escalation line. Measures first-audio latency and real-time factor per spoken turn.
 * Exit 1 on any failed assertion.
 */
import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectQuestCleanupLists, parseArgs, runHostProbe, runQuestProbe, startStaticServer } from "./harness-lib.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..", "..");
const SERVER_DIST = join(ROOT, "packages/openclinxr/xr-sync-server/dist/index.js");
const FIXTURES_DIST = join(ROOT, "packages/openclinxr/scenario-fixtures/dist/index.js");
const APP_DIST = join(ROOT, "apps/ui-xr/dist");
const TIMING = { doorwaySeconds: 1, encounterSeconds: 300, noteSeconds: 1, breakAfterStationOrders: [] };
const JOIN_TIMEOUT_MS = 240000;

const blueprint = {
  blueprintId: "bp-evidence-c30",
  title: "C30 actor voice",
  stationSlots: [{ slotId: "slot-a", order: 1, label: "C30 chest", requiredEnvironmentIds: [], requiredTraceTags: [] }],
  timing: TIMING,
  requiredTraceTags: [],
  requiredSafetyCriticalTraceTags: [],
};
const stripName = (caption) => caption.replace(/^[^:]{1,60}:\s+/u, "").trim();
const median = (values) => { const s = [...values].sort((a, b) => a - b); return s.length === 0 ? null : s[Math.floor(s.length / 2)]; };

async function main(argv) {
  const options = parseArgs(argv);
  const outDir = resolve(options.out);
  await mkdir(outDir, { recursive: true });
  const traceDir = await mkdtemp(join(tmpdir(), "xr-sync-c30-trace-"));
  const run = { mode: options.mode, serial: options.mode === "quest" ? options.serial : null, script: "c30", engine: { name: "mesm-tts", model: "heart v2f_lite", revision: "aa59535a8c2b1cf7b0229956ceb26d7f62ef7a14" }, assertions: [], probe: null, pageErrors: [], consoleErrors: [], notEvidenceFor: { soundHeardByAPerson: true, clinicalValidity: true, examEquivalence: true, replayCaptions: true } };
  const check = (name, pass, detail = "") => {
    run.assertions.push({ name, pass: Boolean(pass), detail: String(detail) });
    if (!pass) process.exitCode = 1;
  };
  let syncServer = null;
  let staticServer = null;
  const startedMs = Date.now();
  try {
    const { createEncounterServer } = await import(SERVER_DIST);
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
      `${patient.displayName}: ${entry.utteranceFallback.line}`,
      `${patient.displayName}: ${onset.caption ?? onset.spokenText}`,
      `${nurse.displayName}: `,
      `${nurse.displayName}: ${escalation.caption ?? escalation.spokenText}`,
    ];
    const expectedChars = expectedCaptions.map((c) => stripName(c).length);
    const phrase = onset.utterancePhrases[0];
    const nursePhrase = escalation.utterancePhrases[0];
    run.expectedSpokenChars = expectedChars;
    syncServer = await createEncounterServer({ examBlueprint: blueprint, scenarios: [scenario], dialogueSeeds: shippedSeedBank, traceDir });
    staticServer = await startStaticServer(APP_DIST);
    run.pageUrl = `http://127.0.0.1:${staticServer.port}/?${new URLSearchParams({ encounterSync: syncServer.url })}`;

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const serverActorSpeaking = (id) => JSON.parse(syncServer.getStateJSON()).actors?.[id]?.speaking === true;
    const steps = [
      { actor: patient.actorId, send: (id) => `globalThis.__openClinXrEncounterSync.sendUtterance(${JSON.stringify(id)}, "hello there")` },
      { actor: patient.actorId, send: (id) => `globalThis.__openClinXrEncounterSync.sendUtterance(${JSON.stringify(id)}, ${JSON.stringify(phrase)})` },
      { actor: patient.actorId, send: (id) => `globalThis.__openClinXrEncounterSync.sendSpeech(${JSON.stringify(id)}, ${JSON.stringify(phrase)}, 0.2)` },
      { actor: patient.actorId, send: (id) => `globalThis.__openClinXrEncounterSync.sendSpeech(${JSON.stringify(id)}, ${JSON.stringify(phrase)}, 0.3)` },
      { actor: patient.actorId, send: (id) => `globalThis.__openClinXrEncounterSync.sendSpeech(${JSON.stringify(id)}, ${JSON.stringify(phrase)}, 0.9)` },
      { actor: nurse.actorId, send: (id) => `globalThis.__openClinXrEncounterSync.sendUtterance(${JSON.stringify(id)}, "hello nurse")` },
      { actor: nurse.actorId, send: (id) => `globalThis.__openClinXrEncounterSync.sendUtterance(${JSON.stringify(id)}, ${JSON.stringify(nursePhrase)})` },
    ];
    const drive = async (page) => {
      if (options.mode === "quest") {
        // Oculus Browser has no Emulation.setAutoplayPolicy: a CDP mouse click is a trusted user gesture and unlocks the AudioContext.
        await page.mouse.click(8, 8).catch(() => undefined);
      }
      await page.waitForFunction(() => { const e = globalThis.__openClinXrEncounterSync; return e !== undefined && e.state !== "joining"; }, undefined, { timeout: JOIN_TIMEOUT_MS });
      const readShell = () => page.evaluate(() => {
        const e = globalThis.__openClinXrEncounterSync;
        return { state: e.state, error: e.error, turns: e.turns.length, voiceError: e.voice?.error ?? "", records: e.voice ? JSON.parse(JSON.stringify(e.voice.records)) : null, repeatPrompts: e.repeatPrompts ?? null, prompt: document.getElementById("repeat-prompt")?.textContent ?? null, dialogue: document.getElementById("dialogue-line")?.textContent ?? null, audioContext: globalThis.__c30Audio ?? null };
      });
      const probe = { afterTurn: [], marks: [], quiet: null };
      const joined = await readShell();
      if (joined.state !== "joined" || joined.records === null) return { ...probe, final: joined };
      await page.locator("#utterance-input").waitFor({ timeout: 60000 });
      probe.unlock = await page.evaluate(async () => { const v = globalThis.__openClinXrEncounterSync.voice; const before = v.audioState(); const error = await v.unlock().then(() => "", (e) => String(e).slice(0, 200)); return { before, after: v.audioState(), error, activation: navigator.userActivation ? { active: navigator.userActivation.isActive, hasBeenActive: navigator.userActivation.hasBeenActive } : null }; });
      // Sample the actor's viseme influence every 25 ms for the whole run; windows are cut per turn below.
      await page.evaluate((ids) => {
        globalThis.__c30Mouth = [];
        setInterval(() => { const v = globalThis.__openClinXrEncounterSync.voice; const t = performance.now(); globalThis.__c30Mouth.push([t, ...ids.map((id) => v.mouth(id))]); if (globalThis.__c30Mouth.length > 40000) globalThis.__c30Mouth.shift(); }, 25);
      }, [patient.actorId, nurse.actorId]);
      probe.restTargetsBefore = await page.evaluate((id) => globalThis.__openClinXrEncounterSync.voice.mouthTargets(id), patient.actorId);
      await sleep(900);
      const phaseBy = Date.now() + 120000;
      while (JSON.parse(syncServer.getStateJSON()).phase !== "encounter" && Date.now() < phaseBy) await sleep(200);
      for (const [index, step] of steps.entries()) {
        const endBy = Date.now() + 30000;
        while ((serverActorSpeaking(patient.actorId) || serverActorSpeaking(nurse.actorId)) && Date.now() < endBy) await sleep(100);
        const mark = await page.evaluate(() => globalThis.__c30Mouth.length);
        let sent = "";
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          sent = await page.evaluate(step.send(step.actor)).then(() => "sent", (error) => String(error).slice(0, 200));
          // An intent can time out (5 s) when the machine is loaded; the entry's statuses say so and the send is repeated.
          const statuses = await page.evaluate(() => { const e = globalThis.__openClinXrEncounterSync; const all = [...e.utterances, ...e.speechUtterances]; return all.at(-1)?.statuses ?? []; });
          const turned = await page.waitForFunction((count) => globalThis.__openClinXrEncounterSync.turns.length >= count && globalThis.__openClinXrEncounterSync.voice.records.length >= count, index + 1, { timeout: statuses.every((v) => v === "ack") ? 120000 : 3000 }).then(() => true, () => false);
          if (turned) break;
          probe.sendAttempts = [...(probe.sendAttempts ?? []), { index, attempt, statuses }];
          if (statuses.every((v) => v === "ack")) {
            probe.stuck = { index, sent, serverPhase: JSON.parse(syncServer.getStateJSON()).phase, shell: await readShell() };
            break;
          }
          await sleep(3000);
        }
        if (probe.stuck) break;
        // wait for this record to finish playing (played set by the sink) or give up after 20 s (an empty-text turn never plays)
        await page.waitForFunction((i) => { const r = globalThis.__openClinXrEncounterSync.voice.records[i]; return r.chars === 0 || r.error !== "" || r.played !== undefined; }, index, { timeout: 20000 }).catch(() => undefined);
        probe.marks.push([mark, await page.evaluate(() => globalThis.__c30Mouth.length)]);
        probe.afterTurn.push(await readShell());
      }
      // Frames are slow under software rendering, so the mouth eases back to rest over several seconds: wait until it is still.
      probe.settled = await page.waitForFunction(() => { const rows = globalThis.__c30Mouth.slice(-6); if (rows.length < 6) return false; return [1, 2].every((col) => { const v = rows.map((r) => r[col]); return Math.max(...v) - Math.min(...v) < 0.05; }); }, undefined, { timeout: 90000, polling: 500 }).then(() => true, () => false);
      probe.series = await page.evaluate(() => globalThis.__c30Mouth.map((row) => row.map((v, i) => (i === 0 ? Math.round(v) : Number(v.toFixed(3))))));
      probe.restTargetsAfter = await page.evaluate((id) => globalThis.__openClinXrEncounterSync.voice.mouthTargets(id), patient.actorId);
      probe.final = await readShell();
      return probe;
    };
    const outcome = options.mode === "host"
      ? await runHostProbe({ pageUrl: run.pageUrl, outDir, drive, launchArgs: ["--autoplay-policy=no-user-gesture-required"] })
      : await runQuestProbe({ pageUrl: run.pageUrl, outDir, serial: options.serial, drive });
    run.probe = outcome.probe;
    run.pageErrors = outcome.pageErrors;
    run.consoleErrors = outcome.consoleErrors;
    run.browserProduct = outcome.browserProduct;
    const probe = outcome.probe;
    const final = probe.final;
    const records = final?.records ?? [];
    check("S1 shell joined the room and published voice evidence without an error", final?.state === "joined" && final.records !== null && final.voiceError === "", JSON.stringify({ state: final?.state, error: final?.error, voiceError: final?.voiceError }));
    check("S2 seven server turns reached the shell and seven voice records exist, in turn order", final?.turns === 7 && records.length === 7 && records.every((r, i) => r.turnKey.endsWith(`:${i < 5 ? patient.actorId : nurse.actorId}`)), JSON.stringify({ turns: final?.turns, records: records.map((r) => r.turnKey) }));
    check("S3 spoken text is the server caption without the name prefix: each record's char count equals the expected authored line (opening, onset answer, fallback x2, onset answer, nurse opening empty, nurse escalation line); the records hold counts only", JSON.stringify(records.map((r) => r.chars)) === JSON.stringify(expectedChars) && records.every((r) => !("text" in r)), JSON.stringify({ got: records.map((r) => r.chars), expected: expectedChars }));
    const spoken = records.filter((r) => r.chars > 0);
    check("S4a every spoken turn synthesized in the Worker without error: chunks, positive audio length, first chunk received", spoken.length === 6 && spoken.every((r) => r.error === "" && typeof r.firstChunkMs === "number" && r.audioSeconds > 0.3 && r.chunks > 0), JSON.stringify(spoken.map((r) => ({ k: r.turnKey, e: r.error.slice(0, 80), c: r.firstChunkMs, a: r.audioSeconds }))));
    const audioStarted = spoken.filter((r) => typeof r.firstAudioMs === "number" && r.played > 0.9 * r.audioSeconds * 24000 && r.underruns === 0).length;
    const onAudioClock = spoken.filter((r) => r.audioClock === "audio").length;
    run.audioOutput = { startedAndPlayed: audioStarted, onAudioClock, spokenTurns: spoken.length, clocks: spoken.map((r) => r.audioClock), unlock: probe.unlock };
    check("S4b the audio output started and played every spoken turn to its end with no underrun; on the headset the audio clock (not the wall-clock mouth fallback) drove all six turns, on the host (software rendering delays the output-started message) the clocks are recorded", audioStarted === 6 && (options.mode === "host" || onAudioClock === 6), JSON.stringify(run.audioOutput));
    check("S5 the empty-text turn (nurse opening) made no synthesis call", records[5]?.chars === 0 && records[5]?.chunks === 0 && records[5]?.firstAudioMs === null, JSON.stringify(records[5]));
    check("S6 voice per actor comes from scenario data: patient authored miles -> Heart with voiceFallback true; nurse authors none -> Heart, no fallback", records.slice(0, 5).every((r) => r.voiceRequested === "miles" && r.voiceUsed === "heart" && r.voiceFallback === true) && records.slice(5).every((r) => r.voiceRequested === "heart" && r.voiceUsed === "heart" && r.voiceFallback === false), JSON.stringify(records.map((r) => [r.voiceRequested, r.voiceUsed, r.voiceFallback])));
    check("S7 audio was produced and pushed into the player: the peak of the pushed samples is above 0.02 on every spoken turn (the player and the AudioContext clock ran; a person listening is not part of this check)", spoken.every((r) => r.peak > 0.02), JSON.stringify(spoken.map((r) => r.peak)));
    const series = probe.series ?? [];
    const tail = series.slice(-6);
    const rangeOf = (rows, col) => { const v = rows.map((r) => r[col]); return v.length === 0 ? 1 : Math.max(...v) - Math.min(...v); };
    const median = (v) => { const sorted = [...v].sort((x, y) => x - y); return sorted[Math.floor(sorted.length / 2)] ?? 0; };
    const restOf = [median(tail.map((r) => r[1])), median(tail.map((r) => r[2]))];
    const quiet = [rangeOf(tail, 1), rangeOf(tail, 2)];
    const mouthTurns = probe.marks.map(([from, to], i) => {
      const col = i < 5 ? 1 : 2;
      const rows = series.slice(from, to).map((r) => r[col]);
      return { turn: i + 1, frames: rows.length, maxDelta: rows.length === 0 ? 0 : Math.max(...rows.map((v) => Math.abs(v - restOf[col - 1]))), open: rows.filter((v) => Math.abs(v - restOf[col - 1]) > 0.05).length };
    });
    run.mouthTurns = mouthTurns;
    const spokenMouth = mouthTurns.filter((_, i) => records[i]?.chars > 0);
    check("S8 the mouth moves with the speech: on every spoken turn the actor's viseme and mouth morph sum departs from its settled rest value by more than 0.1 on at least 1 sampled frame (the host samples at the page frame rate, about 1.4 Hz under software rendering; the headset samples 8-16 frames per turn), and it is settled (range < 0.05 over the last 6 frames) after the last turn", tail.length === 6 && quiet.every((r) => r < 0.05) && spokenMouth.length === 6 && spokenMouth.every((m) => m.maxDelta > 0.1 && m.open >= 1) && (options.mode === "host" || spokenMouth.every((m) => m.open >= 5)), JSON.stringify({ restOf, quiet, restTargetsBefore: probe.restTargetsBefore, restTargetsAfter: probe.restTargetsAfter, mouthTurns }));
    check("S9 the cues come from the audio: every spoken turn has at least 3 cues and 2 non-silent cues", spoken.every((r) => r.cueCount >= 3 && r.nonSilentCues >= 2), JSON.stringify(spoken.map((r) => [r.cueCount, r.nonSilentCues])));
    const afterPrompts = probe.afterTurn.map((s) => s.prompt);
    check("S10 please-repeat prompt: empty on turns 1-2, 'Please repeat that.' after the first low-confidence speech, '(attempt 2)' after the second, cleared by the good speech", JSON.stringify(afterPrompts.slice(0, 5)) === JSON.stringify(["", "", "Please repeat that.", "Please repeat that. (attempt 2)", ""]), JSON.stringify(afterPrompts));
    check("S11 shell evidence counts the prompts (turn ids and retry counts) and holds no text", JSON.stringify(final?.repeatPrompts?.map((p) => [p.actorId, p.retries])) === JSON.stringify([[patient.actorId, 1], [patient.actorId, 2]]), JSON.stringify(final?.repeatPrompts));
    const latencies = spoken.map((r) => r.firstAudioMs);
    const warm = spoken.slice(1);
    const xr = spoken.map((r) => r.xRealtime);
    run.measure = {
      firstAudioMsCold: spoken[0]?.firstAudioMs ?? null,
      firstAudioMsWarmMedian: median(warm.map((r) => r.firstAudioMs).filter((v) => typeof v === "number")),
      firstAudioMsWarmMax: Math.max(...warm.map((r) => r.firstAudioMs).filter((v) => typeof v === "number"), 0),
      firstChunkMsCold: spoken[0]?.firstChunkMs ?? null,
      firstChunkMsWarmMedian: median(warm.map((r) => r.firstChunkMs)),
      firstAudioMsAll: latencies,
      rtfMedian: median(spoken.map((r) => r.rtf)),
      xRealtimeMedian: median(xr),
      xRealtimeMin: Math.min(...xr),
      audioSecondsTotal: spoken.reduce((n, r) => n + r.audioSeconds, 0),
    };
    check("S12 measured on this device: every spoken turn is synthesized faster than real time (rtf < 1) and has its first chunk within 15 s (the cold first turn loads the worker, engine and lexicon)", spoken.every((r) => r.rtf > 0 && r.rtf < 1 && r.firstChunkMs < 15000), JSON.stringify({ ...run.measure, firstAudioMsAll: undefined }));
    const isAsset404 = (text) => /Failed to load resource.*404/iu.test(text);
    const otherConsoleErrors = outcome.consoleErrors.filter((text) => !isAsset404(text));
    run.assetNotFoundConsoleErrors = outcome.consoleErrors.length - otherConsoleErrors.length;
    check("S13 no page errors and no console errors other than missing-asset 404s", outcome.pageErrors.length === 0 && otherConsoleErrors.length === 0, [...outcome.pageErrors, ...otherConsoleErrors].join(" | ") || `${run.assetNotFoundConsoleErrors} asset 404s`);
    const chunkNames = (await readdir(join(APP_DIST, "assets"))).filter((n) => n.endsWith(".js"));
    const hits = [];
    for (const chunk of chunkNames) {
      const code = await readFile(join(APP_DIST, "assets", chunk), "utf8");
      for (const marker of ["@openclinxr/xr-sync-server", "@colyseus/core", "phonemizer/dist"]) if (code.includes(marker)) hits.push(`${chunk} contains ${marker}`);
    }
    check("S14 no built chunk carries the server package, @colyseus/core or the eSpeak NG package", chunkNames.length > 0 && hits.length === 0, hits.join(" | ") || `${chunkNames.length} chunks`);
    const ownSource = await readFile(fileURLToPath(import.meta.url), "utf8");
    check("S15 overlay absent: the harness authors no phrases, fallback or voice (the server got the shipped bank; the voice comes from the scenario actor field)", ![new RegExp("utterance" + "Phrases\\s*:"), new RegExp("utterance" + "Fallback\\s*:"), new RegExp("tts" + "Voice\\s*:")].some((p) => p.test(ownSource)) && patient.ttsVoice === "miles" && nurse.ttsVoice === undefined, JSON.stringify({ patientVoice: patient.ttsVoice, nurseVoice: nurse.ttsVoice }));
    await syncServer.close();
    syncServer = null;
    let traceFiles = [];
    for (let attempt = 0; attempt < 100; attempt += 1) {
      traceFiles = (await readdir(traceDir)).filter((n) => n.endsWith(".conversation-trace.json"));
      if (traceFiles.length > 0) break;
      await sleep(200);
    }
    const raws = await Promise.all((await readdir(traceDir)).map((n) => readFile(join(traceDir, n), "utf8")));
    const sizes = await Promise.all((await readdir(traceDir)).map(async (n) => (await stat(join(traceDir, n))).size));
    const trace = JSON.parse(await readFile(join(traceDir, traceFiles[0]), "utf8"));
    const ends = (trace.events ?? []).filter((event) => event.kind === "utterance-end" && event.actorId === patient.actorId);
    check("S16 the trace counts the retry: low confidence carries no retry, the next two utterances carry retry 1 and 2", JSON.stringify(ends.map((e) => [e.tag, e.retry])) === JSON.stringify([["utterance_unmatched", undefined], ["history_opqrst", undefined], ["speech_low_confidence", undefined], ["speech_low_confidence", 1], ["history_opqrst", 2]]) || JSON.stringify(ends.slice(2).map((e) => [e.tag, e.retry])) === JSON.stringify([["speech_low_confidence", undefined], ["speech_low_confidence", 1], ["history_opqrst", 2]]), JSON.stringify(ends.map((e) => [e.tag, e.match, e.retry])));
    const lines = [patient.openingUtterance, onset.caption ?? onset.spokenText, entry.utteranceFallback.line, escalation.caption ?? escalation.spokenText, phrase].map((t) => t.toLowerCase());
    const leaks = lines.filter((text) => raws.some((raw) => raw.toLowerCase().includes(text)));
    const audioKeys = raws.filter((raw) => /"(audio|samples|waveform|wav|pcm|base64)[A-Za-z]*"/iu.test(raw)).length;
    check("S17 the persisted trace holds no spoken text and no audio (no audio-shaped key; every file under 40 kB)", leaks.length === 0 && audioKeys === 0 && sizes.every((n) => n < 40000), JSON.stringify({ leaks, audioKeys, sizes }));
    if (options.mode === "quest") {
      const lists = await collectQuestCleanupLists({ staticPort: staticServer.port, syncPort: new URL(run.pageUrl).searchParams.get("encounterSync").split(":").at(-1), serial: options.serial });
      run.adbReverseList = lists.adbReverseList;
      run.adbForwardList = lists.adbForwardList;
      check("S18 adb reverse/forward lists hold neither run port nor tcp:9222", !lists.leaked, `reverse=${lists.adbReverseList} forward=${lists.adbForwardList}`);
    }
  } catch (error) {
    process.exitCode = 1;
    run.fatal = String(error?.stack ?? error).slice(0, 1600);
  } finally {
    await syncServer?.close().catch(() => undefined);
    await staticServer?.close().catch(() => undefined);
    run.elapsedMs = Date.now() - startedMs;
    await writeFile(join(outDir, "c30-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 300));
    if (run.fatal) console.log(`FATAL ${run.fatal.slice(0, 400)}`);
    if (run.measure) console.log(`MEASURE ${JSON.stringify({ ...run.measure, firstAudioMsAll: undefined })}`);
    console.log(`wrote ${join(outDir, "c30-run.json")}`);
  }
  process.exit(process.exitCode ?? 0);
}

await main(process.argv.slice(2));
