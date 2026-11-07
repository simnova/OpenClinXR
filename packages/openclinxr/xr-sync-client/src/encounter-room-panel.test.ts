import { describe, expect, it } from "vitest";
import { type EncounterSyncEvidence, startEncounterSyncFromUrl } from "./headset.js";

// C36 RED (planted by lane manager, 2026-11-06): the shell shows the cast, the authored topic menu, the doorway countdown, and doorway refusals.
// Contract (names are the spec):
//   A topic label is the tag with "_" replaced by " " (shipped scenario tag text, no hard-coded table).
//   The panel module is internal: tests reach it through startEncounterSyncFromUrl (a snapshot renders it; a room-rejected intent refuses).
//   The panel is a div#room-panel appended to the typed-box parent holding four child elements:
//     #room-cast       "Cast: <displayName> (<role>); ..." in snapshot actor order, actors with empty displayName skipped; "" when none.
//     #room-topics     one <button> per topicMenu entry {tag, label, labelSource, note, asked} in snapshot order; button text is the server label with data-asked from the snapshot; no buttons when topicMenu is empty or absent.
//     #room-countdown  phase doorway "Encounter opens in <n> s"; encounter "Encounter: <n> s left"; note "Note: <n> s left"; closed "Station closed"; "" when phase is "".
//     #room-refusal    "" until refuse(reason); refuse("outside-encounter-phase") during the doorway -> "Not open yet: the encounter opens in <n> s.";
//                      the same reason in any other phase -> "Not accepted: the station is in the <phase> phase."; any other reason -> "Not accepted: <reason>".
//                      The next snapshot with phase "encounter" clears it. Before any snapshot the phase is "" and the doorway text is not used (-> "Not accepted: outside-encounter-phase").
//   startEncounterSyncFromUrl mounts the panel in the typed-box parent (live rooms only: not replay, not lobby), renders every snapshot,
//   and any intent the room rejects (typed utterance, speech utterance, speech-audio, trace action) calls refuse(reason).
type Handler = (event: { preventDefault?: () => void }) => void;
class FakeElement {
  id = ""; value = ""; type = ""; placeholder = ""; disabled = false; hidden = false;
  children: FakeElement[] = [];
  attributes = new Map<string, string>();
  handlers = new Map<string, Handler[]>();
  private text: string | null = "";
  constructor(readonly tag: string) {}
  get textContent(): string | null { return this.text; }
  // DOM semantics: assigning textContent replaces all children.
  set textContent(value: string | null) { this.text = value; this.children = []; }
  appendChild(child: FakeElement): FakeElement { this.children.push(child); return child; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  addEventListener(type: string, fn: Handler): void { this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]); }
  click(): void { for (const fn of this.handlers.get("click") ?? []) fn({}); }
  find(id: string): FakeElement | undefined { return this.id === id ? this : this.children.map((child) => child.find(id)).find((found) => found !== undefined); }
}
const fakeDoc = { createElement: (tag: string) => new FakeElement(tag) };
const text = (parent: FakeElement, id: string): string | null | undefined => parent.find(id)?.textContent;
const flush = async (): Promise<void> => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
const SNAP = {
  serverTick: 1, phase: "doorway", phaseRemainingS: 7, turnId: 0, turnOwner: "none", learners: {},
  actors: { p: { id: "p", displayName: "Robert Hayes", role: "patient" }, f: { id: "f", displayName: "Anna Hayes", role: "family" }, x: { id: "x", displayName: "", role: "" } },
  topicMenu: [
    { tag: "history_opqrst", label: "when did the chest pressure start", labelSource: "seed-phrase", note: "", asked: false },
    { tag: "ecg_request", label: "ecg_request", labelSource: "tag", note: "", asked: false },
  ],
};

async function joined(rejectKinds: Set<string>, reason = "outside-encounter-phase", search = "?encounterSync=ws://127.0.0.1:9") {
  const parent = new FakeElement("div");
  const published: EncounterSyncEvidence[] = [];
  let stateListener: ((s: unknown) => void) | undefined;
  const handle = await startEncounterSyncFromUrl({
    search,
    actorIds: () => ["p"],
    register: () => undefined,
    play: () => undefined,
    publish: (e: EncounterSyncEvidence) => { published.push(e); },
    nowMs: () => Date.now(),
    utteranceBox: { doc: fakeDoc, parent },
    connectFn: async () => ({
      sessionId: "s",
      sendIntent: async (kind: string) => (rejectKinds.has(kind) ? { status: "reject", reason, seq: 1 } : { status: "ack", seq: 1, serverTs: 0, rttMs: 1 }),
      onState: (fn: (s: unknown) => void) => { stateListener = fn; return () => undefined; },
      leave: async () => undefined,
    }) as never,
  } as never);
  return { parent, handle, evidence: published[0] as EncounterSyncEvidence, snapshot: (s: unknown) => stateListener?.(s) };
}

describe("room panel (C36)", () => {
  it("renders cast, topics and the phase countdown from a snapshot", async () => {
    const { parent, snapshot } = await joined(new Set());
    expect(text(parent, "room-panel")).toBe("");
    expect(text(parent, "room-cast")).toBe("");
    snapshot(SNAP);
    expect(text(parent, "room-cast")).toBe("Cast: Robert Hayes (patient); Anna Hayes (family)");
    expect((parent.find("room-topics") as FakeElement).children.map((button) => button.textContent)).toEqual(["when did the chest pressure start", "ecg request"]);
    expect(text(parent, "room-countdown")).toBe("Encounter opens in 7 s");
    snapshot({ ...SNAP, phase: "encounter", phaseRemainingS: 120 });
    expect(text(parent, "room-countdown")).toBe("Encounter: 120 s left");
    snapshot({ ...SNAP, phase: "note", phaseRemainingS: 30 });
    expect(text(parent, "room-countdown")).toBe("Note: 30 s left");
    snapshot({ ...SNAP, phase: "closed", phaseRemainingS: 0 });
    expect(text(parent, "room-countdown")).toBe("Station closed");
    snapshot({ ...SNAP, phase: "encounter", topicMenu: [], actors: {} });
    expect(text(parent, "room-topics")).toBe("");
    expect(text(parent, "room-cast")).toBe("");
  });

  it("a refusal before any snapshot names the reason; doorway, other-phase and other reasons read as specified; the encounter phase clears it", async () => {
    const { parent, handle, snapshot } = await joined(new Set(["select-actor"]));
    await handle?.sendUtterance("p", "hello");
    expect(text(parent, "room-refusal")).toBe("Not accepted: outside-encounter-phase");
    snapshot(SNAP);
    await handle?.sendUtterance("p", "hello");
    expect(text(parent, "room-refusal")).toBe("Not open yet: the encounter opens in 7 s.");
    snapshot({ ...SNAP, phase: "note", phaseRemainingS: 30 });
    await handle?.sendUtterance("p", "hello");
    expect(text(parent, "room-refusal")).toBe("Not accepted: the station is in the note phase.");
    snapshot({ ...SNAP, phase: "encounter", phaseRemainingS: 100 });
    expect(text(parent, "room-refusal")).toBe("");
  });

  it("the panel holds exactly #room-cast, #room-topics, #room-countdown, #room-refusal in that order; no topicMenu and a blank phase render empty text", async () => {
    const { parent, snapshot } = await joined(new Set());
    const panel = parent.find("room-panel") as FakeElement;
    expect(panel.children.map((child) => child.id)).toEqual(["room-cast", "room-topics", "room-countdown", "room-refusal"]);
    snapshot({ serverTick: 1, phase: "", turnId: 0, turnOwner: "none", learners: {}, actors: {} });
    expect(text(parent, "room-topics")).toBe("");
    expect(text(parent, "room-countdown")).toBe("");
  });

  it("replay and lobby rooms mount no panel", async () => {
    const replay = await joined(new Set(), "x", "?encounterSync=ws://127.0.0.1:9&encounterReplayStation=slot-a");
    expect(replay.parent.find("room-panel")).toBeUndefined();
    const lobby = await joined(new Set(), "x", "?encounterSync=ws://127.0.0.1:9&encounterReviewLobby=1");
    expect(lobby.parent.find("room-panel")).toBeUndefined();
  });

  it("a rejected speech-audio intent shows the refusal", async () => {
    const { parent, evidence, snapshot } = await joined(new Set(["speech-audio"]));
    snapshot(SNAP);
    await evidence.sendIntent?.("speech-audio" as never, { pcm: [], sampleRate: 16000 });
    expect(text(parent, "room-refusal")).toBe("Not open yet: the encounter opens in 7 s.");
  });

  it("any other rejected reason reads `Not accepted: <reason>` whatever the phase", async () => {
    const { parent, handle, snapshot } = await joined(new Set(["select-actor"]), "unknown-topic");
    snapshot(SNAP);
    await handle?.sendTraceAction("p", "ecg_request");
    expect(text(parent, "room-refusal")).toBe("Not accepted: unknown-topic");
  });
});

describe("room panel wiring (C36)", () => {
  it("a live room mounts the panel and renders snapshots", async () => {
    const { parent, snapshot } = await joined(new Set());
    snapshot(SNAP);
    expect(text(parent, "room-cast")).toBe("Cast: Robert Hayes (patient); Anna Hayes (family)");
    expect(text(parent, "room-countdown")).toBe("Encounter opens in 7 s");
  });

  it("a rejected typed utterance, trace action and speech turn each show the refusal", async () => {
    const { parent, handle, snapshot } = await joined(new Set(["select-actor"]));
    snapshot(SNAP);
    await handle?.sendUtterance("p", "hello");
    expect(text(parent, "room-refusal")).toBe("Not open yet: the encounter opens in 7 s.");
    snapshot({ ...SNAP, phase: "encounter", phaseRemainingS: 50 });
    expect(text(parent, "room-refusal")).toBe("");
    snapshot({ ...SNAP, phase: "doorway", phaseRemainingS: 3 });
    await handle?.sendTraceAction("p", "ecg_request");
    expect(text(parent, "room-refusal")).toBe("Not open yet: the encounter opens in 3 s.");
    snapshot({ ...SNAP, phase: "note", phaseRemainingS: 20 });
    await handle?.sendSpeech("p", "hello", 0.9);
    await flush();
    expect(text(parent, "room-refusal")).toBe("Not accepted: the station is in the note phase.");
  });

  it("an accepted intent leaves the refusal empty", async () => {
    const { parent, handle, snapshot } = await joined(new Set());
    snapshot({ ...SNAP, phase: "encounter", phaseRemainingS: 50 });
    await handle?.sendUtterance("p", "hello");
    expect(text(parent, "room-refusal")).toBe("");
  });
});
