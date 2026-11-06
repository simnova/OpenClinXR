import { describe, expect, it } from "vitest";
import { type EncounterSyncEvidence, startEncounterSyncFromUrl } from "./headset.js";
import { mountRoomPanel, topicLabel } from "./encounter-room-panel.js";

// C36 RED (planted by lane manager, 2026-11-06): the shell shows the cast, the authored topic menu, the doorway countdown, and doorway refusals.
// Contract (names are the spec):
//   topicLabel(tag) = tag with "_" replaced by " " (shipped scenario tag text, no hard-coded table).
//   mountRoomPanel({ doc, parent }) appends div#room-panel to parent holding four child elements and returns { render(snapshot), refuse(reason) }:
//     #room-cast       "Cast: <displayName> (<role>); ..." in snapshot actor order, actors with empty displayName skipped; "" when none.
//     #room-topics     "Ask about: <topicLabel>, ..." in topicMenu order; "" when topicMenu is empty or absent.
//     #room-countdown  phase doorway "Encounter opens in <n> s"; encounter "Encounter: <n> s left"; note "Note: <n> s left"; closed "Station closed"; "" when phase is "".
//     #room-refusal    "" until refuse(reason); refuse("outside-encounter-phase") during the doorway -> "Not open yet: the encounter opens in <n> s.";
//                      the same reason in any other phase -> "Not accepted: the station is in the <phase> phase."; any other reason -> "Not accepted: <reason>".
//                      The next snapshot with phase "encounter" clears it. Before any snapshot the phase is "" and the doorway text is not used (-> "Not accepted: outside-encounter-phase").
//   startEncounterSyncFromUrl mounts the panel in the typed-box parent (live rooms only: not replay, not lobby), renders every snapshot,
//   and any intent the room rejects (typed utterance, speech utterance, speech-audio, trace action) calls refuse(reason).
type Handler = (event: { preventDefault?: () => void }) => void;
class FakeElement {
  id = ""; value = ""; textContent: string | null = ""; type = ""; placeholder = ""; disabled = false; hidden = false;
  children: FakeElement[] = [];
  handlers = new Map<string, Handler[]>();
  constructor(readonly tag: string) {}
  appendChild(child: FakeElement): FakeElement { this.children.push(child); return child; }
  addEventListener(type: string, fn: Handler): void { this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]); }
  find(id: string): FakeElement | undefined { return this.id === id ? this : this.children.map((child) => child.find(id)).find((found) => found !== undefined); }
}
const fakeDoc = { createElement: (tag: string) => new FakeElement(tag) };
const text = (parent: FakeElement, id: string): string | null | undefined => parent.find(id)?.textContent;
const flush = async (): Promise<void> => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
const SNAP = {
  serverTick: 1, phase: "doorway", phaseRemainingS: 7, turnId: 0, turnOwner: "none", learners: {},
  actors: { p: { id: "p", displayName: "Robert Hayes", role: "patient" }, f: { id: "f", displayName: "Anna Hayes", role: "family" }, x: { id: "x", displayName: "", role: "" } },
  topicMenu: ["history_opqrst", "ecg_request"],
};

describe("room panel (C36)", () => {
  it("topicLabel replaces underscores", () => {
    expect(topicLabel("risk_factor_question")).toBe("risk factor question");
  });

  it("renders cast, topics and the phase countdown from a snapshot", () => {
    const parent = new FakeElement("div");
    const panel = mountRoomPanel({ doc: fakeDoc, parent } as never);
    expect(parent.find("room-panel")).toBeDefined();
    expect(text(parent, "room-cast")).toBe("");
    panel.render(SNAP as never);
    expect(text(parent, "room-cast")).toBe("Cast: Robert Hayes (patient); Anna Hayes (family)");
    expect(text(parent, "room-topics")).toBe("Ask about: history opqrst, ecg request");
    expect(text(parent, "room-countdown")).toBe("Encounter opens in 7 s");
    panel.render({ ...SNAP, phase: "encounter", phaseRemainingS: 120 } as never);
    expect(text(parent, "room-countdown")).toBe("Encounter: 120 s left");
    panel.render({ ...SNAP, phase: "note", phaseRemainingS: 30 } as never);
    expect(text(parent, "room-countdown")).toBe("Note: 30 s left");
    panel.render({ ...SNAP, phase: "closed", phaseRemainingS: 0 } as never);
    expect(text(parent, "room-countdown")).toBe("Station closed");
    panel.render({ ...SNAP, phase: "encounter", topicMenu: [], actors: {} } as never);
    expect(text(parent, "room-topics")).toBe("");
    expect(text(parent, "room-cast")).toBe("");
  });

  it("a doorway refusal becomes text and the encounter phase clears it", () => {
    const parent = new FakeElement("div");
    const panel = mountRoomPanel({ doc: fakeDoc, parent } as never);
    panel.refuse("outside-encounter-phase");
    expect(text(parent, "room-refusal")).toBe("Not accepted: outside-encounter-phase");
    panel.render(SNAP as never);
    panel.refuse("outside-encounter-phase");
    expect(text(parent, "room-refusal")).toBe("Not open yet: the encounter opens in 7 s.");
    panel.render({ ...SNAP, phase: "note", phaseRemainingS: 30 } as never);
    panel.refuse("outside-encounter-phase");
    expect(text(parent, "room-refusal")).toBe("Not accepted: the station is in the note phase.");
    panel.refuse("unknown-topic");
    expect(text(parent, "room-refusal")).toBe("Not accepted: unknown-topic");
    panel.render({ ...SNAP, phase: "encounter", phaseRemainingS: 100 } as never);
    expect(text(parent, "room-refusal")).toBe("");
  });
});

describe("room panel wiring (C36)", () => {
  async function joined(rejectKinds: Set<string>) {
    const parent = new FakeElement("div");
    const published: EncounterSyncEvidence[] = [];
    let stateListener: ((s: unknown) => void) | undefined;
    const handle = await startEncounterSyncFromUrl({
      search: "?encounterSync=ws://127.0.0.1:9",
      actorIds: () => ["p"],
      register: () => undefined,
      play: () => undefined,
      publish: (e: EncounterSyncEvidence) => { published.push(e); },
      nowMs: () => Date.now(),
      utteranceBox: { doc: fakeDoc, parent },
      connectFn: async () => ({
        sessionId: "s",
        sendIntent: async (kind: string) => (rejectKinds.has(kind) ? { status: "reject", reason: "outside-encounter-phase", seq: 1 } : { status: "ack", seq: 1, serverTs: 0, rttMs: 1 }),
        onState: (fn: (s: unknown) => void) => { stateListener = fn; return () => undefined; },
        leave: async () => undefined,
      }) as never,
    } as never);
    return { parent, handle, evidence: published[0] as EncounterSyncEvidence, snapshot: (s: unknown) => stateListener?.(s) };
  }

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
