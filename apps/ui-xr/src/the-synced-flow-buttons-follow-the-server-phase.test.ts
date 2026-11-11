import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startEncounterSyncFromUrl } from "@openclinxr/xr-sync-client/headset";
import { describe, expect, it } from "vitest";
import { writeSyncedDoorwayEyebrow as writeEyebrowThrough } from "@openclinxr/xr-sync-client/headset";

// C57 RED (main.ts lines cited at origin/main 087f061e7): while the shell is joined to a synced rotation, "End encounter / start note"
// (#end-encounter-button, handler main.ts:1735-1737) and "Submit note / next encounter" (#submit-note-button, handler :1739-1741) act only in
// the server phase they belong to. Flag writers are main.ts:1889-1890 (updateExamFlowEvidence, run every animation frame). Contract:
//  - `syncedServerPhase` (module-level string, "" = not synced) replaces the boolean `syncedPhase`; onPhase (C55') sets it to the phase.
//  - Exactly one single-line `endEncounterButton.disabled = ...;` and one `submitNoteButton.disabled = ...;` exist. Synced: end enabled iff
//    server phase == "encounter", submit enabled iff == "note". Not synced: the local rule (evidence.phase), byte-identical.
//  - Each click handler returns before applyExamFlowIntent when synced and the server phase does not match.
// main.ts cannot be imported (it boots the page): the shell's own onPhase body, flag lines and handler bodies are taken verbatim from the
// source and run against stand-in elements, driven by the real xr-sync-client.
const SRC = fileURLToPath(new URL(".", import.meta.url));
const MAIN = readFileSync(SRC + "main.ts", "utf8");
const MAIN_LINES_AT_BASE = 4724; // origin/main 0152d3bd4: card tsk_bf84681b185c6766 imports the eyebrow writer on the existing xr-sync-client/headset line (+0); 4724 after B'' tsk_0d56fb3d8be0c6d7 onTopicMenu own line (C49)
const flush = async (): Promise<void> => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const ONPHASE = /onPhase: \(phase, remaining\) => \{\n([\s\S]*?)\n  \},\n/u;
const END_LINES = MAIN.split("\n").filter((line) => /\bendEncounterButton\.disabled =/u.test(line));
const SUBMIT_LINES = MAIN.split("\n").filter((line) => /\bsubmitNoteButton\.disabled =/u.test(line));
const END_HANDLER = /endEncounterButton\.addEventListener\("click", \(\) => \{([\s\S]*?)\}\);/u.exec(MAIN)?.[1] ?? "";
const SUBMIT_HANDLER = /submitNoteButton\.addEventListener\("click", \(\) => \{([\s\S]*?)\}\);/u.exec(MAIN)?.[1] ?? "";
const SYNC = "?encounterSync=ws://127.0.0.1:9";
const LOCAL_PHASES = ["brief", "encounter", "note", "complete"] as const;
const at = (phase: string, phaseRemainingS: number): Record<string, unknown> => ({ phase, phaseRemainingS, stationIndex: 0, stationCount: 3 });

interface Shell {
  local: { phase: string };
  intents: string[];
  snap(phase: string, remaining?: number): Promise<void>;
  flags(localPhase?: string): { end: boolean; submit: boolean };
  peek(): { end: boolean; submit: boolean };
  clickEnd(): void;
  clickSubmit(): void;
}

/** Boot the real client with `search`; the shell's onPhase body, flag lines and handler bodies (from main.ts) run against stand-ins. */
async function boot(search: string): Promise<Shell> {
  const local = { phase: "encounter" };
  const intents: string[] = [];
  const sink = () => ({ textContent: "" });
  const formatStationClock = (seconds: number): string => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const applyExamFlowIntent = (kind: string): void => {
    intents.push(kind);
    if (kind === "end_encounter" && local.phase === "encounter") local.phase = "note";
    else if (kind === "submit_note" && local.phase === "note") local.phase = "encounter";
  };
  const buttons = { end: { disabled: true }, submit: { disabled: true } };
  const eyebrowSink = { textContent: "Doorway" };
  const selectors: string[] = [];
  const requireElement = (selector: string): { textContent: string | null } => { selectors.push(selector); return eyebrowSink; };
  const writeSyncedDoorwayEyebrow = (el: { textContent: string | null }, phase: string | undefined): string =>
    writeEyebrowThrough(el, phase);
  const make = new Function(
    "examFlowTimer", "examFlowAdvance", "stationClockLabel", "formatStationClock", "applyExamFlowIntent", "endEncounterButton", "submitNoteButton", "writeSyncedDoorwayEyebrow", "requireElement",
    `let syncedServerPhase = "";\nlet updateExamFlowEvidence = () => undefined;\n` +
      `const onPhase = (phase, remaining) => {\n${ONPHASE.exec(MAIN)?.[1] ?? ""}\n};\n` +
      `const flags = (evidence) => {\n${END_LINES[0] ?? ""}\n${SUBMIT_LINES[0] ?? ""}\n};\n` +
      `const clickEnd = () => {\n${END_HANDLER}\n};\nconst clickSubmit = () => {\n${SUBMIT_HANDLER}\n};\n` +
      `return { onPhase, flags, clickEnd, clickSubmit, setUpdate: (fn) => { updateExamFlowEvidence = fn; } };`,
  );
  const shell = make(sink(), sink(), sink(), formatStationClock, applyExamFlowIntent, buttons.end, buttons.submit, writeSyncedDoorwayEyebrow, requireElement) as {
    onPhase(phase: string, remaining: number): void; flags(evidence: { phase: string }): void; clickEnd(): void; clickSubmit(): void; setUpdate(fn: () => void): void;
  };
  shell.setUpdate(() => shell.flags({ phase: local.phase }));
  let listener: ((s: unknown) => void) | undefined;
  await startEncounterSyncFromUrl({
    search,
    actorIds: () => [],
    register: () => undefined,
    play: () => undefined,
    publish: () => undefined,
    nowMs: () => 1,
    onStation: () => undefined,
    onPhase: (phase: string, remaining: number) => shell.onPhase(phase, remaining),
    connectFn: async () => ({ sessionId: "s", sendIntent: async () => ({ status: "ack" }), onState: (fn: (s: unknown) => void) => { listener = fn; return () => undefined; }, leave: async () => undefined }) as never,
  } as never);
  return {
    local,
    intents,
    snap: async (phase, remaining = 5) => { listener?.({ serverTick: 1, turnId: 0, turnOwner: "none", actors: {}, learners: {}, ...at(phase, remaining) }); await flush(); },
    flags: (localPhase = local.phase) => { shell.flags({ phase: localPhase }); return { end: !buttons.end.disabled, submit: !buttons.submit.disabled }; },
    peek: () => ({ end: !buttons.end.disabled, submit: !buttons.submit.disabled }),
    clickEnd: () => shell.clickEnd(),
    clickSubmit: () => shell.clickSubmit(),
  };
}

describe("the synced flow buttons follow the server phase (C57)", () => {
  it("CW1 non-synced: both flags and both handler effects are the local rule for every local phase", async () => {
    const shell = await boot("");
    for (const phase of LOCAL_PHASES) {
      expect(shell.flags(phase)).toEqual({ end: phase === "encounter", submit: phase === "note" });
    }
    for (const phase of LOCAL_PHASES) {
      shell.local.phase = phase; shell.intents.length = 0;
      shell.clickEnd(); shell.clickSubmit();
      expect(shell.intents).toEqual(["end_encounter", "submit_note"]);
    }
    expect(END_HANDLER).toContain('applyExamFlowIntent("end_encounter");');
    expect(SUBMIT_HANDLER).toContain('applyExamFlowIntent("submit_note");');
  });

  it("CW2 synced encounter: end is enabled, submit is not, and the end handler changes the local phase", async () => {
    const shell = await boot(SYNC);
    await shell.snap("encounter", 30);
    for (const phase of ["encounter", "note"]) expect(shell.flags(phase)).toEqual({ end: true, submit: false });
    shell.local.phase = "encounter"; shell.clickEnd();
    expect(shell.intents).toEqual(["end_encounter"]);
    expect(shell.local.phase).toBe("note");
  });

  it("CW3 synced note: submit is enabled, end is not, whatever the local phase reads", async () => {
    const shell = await boot(SYNC);
    await shell.snap("note", 20);
    for (const phase of ["encounter", "note"]) expect(shell.flags(phase)).toEqual({ end: false, submit: true });
    shell.local.phase = "note"; shell.clickSubmit();
    expect(shell.intents).toEqual(["submit_note"]);
    expect(shell.local.phase).toBe("encounter");
  });

  it("CW4 synced break, doorway and closed: both flags are disabled while the local phase reads encounter or note", async () => {
    const shell = await boot(SYNC);
    for (const server of ["break", "doorway", "closed"]) {
      await shell.snap(server, 5);
      for (const phase of ["encounter", "note"]) expect(shell.flags(phase), `${server}/${phase}`).toEqual({ end: false, submit: false });
    }
  });

  it("CW5 a direct handler call outside its server phase changes no local phase and applies no intent", async () => {
    const shell = await boot(SYNC);
    for (const server of ["break", "doorway", "closed", "note"]) {
      await shell.snap(server, 5);
      shell.local.phase = "encounter"; shell.clickEnd();
      expect(shell.intents, `end during ${server}`).toEqual([]);
      expect(shell.local.phase).toBe("encounter");
    }
    for (const server of ["break", "doorway", "closed", "encounter"]) {
      await shell.snap(server, 5);
      shell.local.phase = "note"; shell.clickSubmit();
      expect(shell.intents, `submit during ${server}`).toEqual([]);
      expect(shell.local.phase).toBe("note");
    }
  });

  it("CW6 replay and review-lobby rooms get no onPhase, so both flags and handlers stay local", async () => {
    for (const search of [`${SYNC}&encounterReplayStation=slot-a`, `${SYNC}&encounterReviewLobby=1`]) {
      const shell = await boot(search);
      await shell.snap("break", 5);
      expect(shell.flags("encounter")).toEqual({ end: true, submit: false });
      expect(shell.flags("note")).toEqual({ end: false, submit: true });
      shell.local.phase = "encounter"; shell.clickEnd();
      expect(shell.intents).toEqual(["end_encounter"]);
    }
  });

  it("CW7 one writer per flag, the handlers keep their intent calls, one variable replaces syncedPhase, handlers keep their 3-line shape, main.ts keeps exactly its base line count", () => {
    expect(END_LINES).toHaveLength(1);
    expect(SUBMIT_LINES).toHaveLength(1);
    expect(END_LINES[0]).toMatch(/;\s*$/u);
    expect(SUBMIT_LINES[0]).toMatch(/;\s*$/u);
    expect(MAIN.match(/endEncounterButton\.addEventListener\("click"/gu)).toHaveLength(1);
    expect(MAIN.match(/submitNoteButton\.addEventListener\("click"/gu)).toHaveLength(1);
    expect(MAIN).toMatch(/^let syncedServerPhase = "";$/mu);
    expect(MAIN).not.toMatch(/\bsyncedPhase\b/u);
    expect(ONPHASE.exec(MAIN)?.[1] ?? "").toContain("syncedServerPhase = phase;");
    expect(END_HANDLER.split("\n")).toHaveLength(3);
    expect(SUBMIT_HANDLER.split("\n")).toHaveLength(3);
    expect(MAIN).toContain("examFlowStore.applyIntent(kind);");
    expect(MAIN.split("\n").length - (MAIN.endsWith("\n") ? 1 : 0)).toBe(MAIN_LINES_AT_BASE);
  });

  it("CW8 styles.css gives both flow buttons the existing disabled look through the .xr-entry-button:disabled rule only", () => {
    const css = readFileSync(SRC + "styles.css", "utf8");
    const rules = [...css.matchAll(/(^|\})\s*([^{}]+)\{/gu)].map((m) => (m[2] ?? "").trim());
    const shared = rules.filter((selector) => selector.includes(".xr-entry-button:disabled"));
    expect(shared).toHaveLength(1);
    expect(shared[0]).toContain("#end-encounter-button:disabled");
    expect(shared[0]).toContain("#submit-note-button:disabled");
    expect(rules.filter((selector) => /#(end-encounter-button|submit-note-button)/u.test(selector))).toEqual(shared);
  });

  it("CW9 the flags follow a server phase change at once: onPhase runs the one flag writer, no frame wait", async () => {
    const shell = await boot(SYNC);
    shell.local.phase = "encounter";
    await shell.snap("encounter", 30);
    expect(shell.peek()).toEqual({ end: true, submit: false });
    await shell.snap("break", 5);
    expect(shell.peek()).toEqual({ end: false, submit: false });
    shell.local.phase = "note";
    await shell.snap("note", 20);
    expect(shell.peek()).toEqual({ end: false, submit: true });
    const body = ONPHASE.exec(MAIN)?.[1] ?? "";
    expect(body.indexOf("syncedServerPhase = phase;")).toBeGreaterThanOrEqual(0);
    expect(body.indexOf("updateExamFlowEvidence();")).toBeGreaterThan(body.indexOf("syncedServerPhase = phase;"));
  });
});
