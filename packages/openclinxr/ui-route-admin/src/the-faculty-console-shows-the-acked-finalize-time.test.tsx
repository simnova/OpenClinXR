import "@testing-library/jest-dom/vitest";
import type { EncounterSnapshot } from "@openclinxr/xr-sync-client";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FacultyReviewConsole } from "./faculty-review-console.js";

// FOLLOWUP r2: one block element per fact line (sign-off, stations, rubric,
// scored, station scores, action row, finalized, reject), faculty-readable labels
// with the machine tokens on data-* attributes, and the ack serverTs as an ISO
// string with the raw ms on data-server-ts. Each line is located by role or data
// attribute and asserted with per-element textContent equality. Station score
// lines render the SERVER items (?rubric= supplies only id->label): checked is
// ✓, unchecked is ✗, and a station with no valid score file shows "not scored".
const RUBRIC = [
  { id: "hpi-onset", label: "Asked onset", checked: true },
  { id: "pe-lungs", label: "Examined lungs", checked: true },
  { id: "plan-shared", label: "Shared the plan", checked: false },
];

// Server items in rubric order (run-7: station-1 T/F/T, station-2 T/T/F,
// station-3 T/F/T). The URL RUBRIC above claims pe-lungs checked and
// plan-shared unchecked; the server says the opposite for station 1.
function lobbySnapshot(reviewFinalized: boolean, unscored: string[] = []): EncounterSnapshot {
  const badges = [
    {
      stationId: "station-1", checkedCount: 2, items: [
        { id: "hpi-onset", checked: true },
        { id: "pe-lungs", checked: false },
        { id: "plan-shared", checked: true },
      ],
    },
    {
      stationId: "station-2", checkedCount: 2, items: [
        { id: "hpi-onset", checked: true },
        { id: "pe-lungs", checked: true },
        { id: "plan-shared", checked: false },
      ],
    },
    {
      stationId: "station-3", checkedCount: 2, items: [
        { id: "hpi-onset", checked: true },
        { id: "pe-lungs", checked: false },
        { id: "plan-shared", checked: true },
      ],
    },
  ].filter((badge) => !unscored.includes(badge.stationId));
  return {
    serverTick: 7,
    phase: "lobby",
    turnId: 0,
    turnOwner: "none",
    actors: {},
    learners: {},
    mode: "lobby",
    lobbyStations: [
      { stationId: "station-1", stationIndex: 0, turnCount: 2, notePresent: false, noteChars: 0 },
      { stationId: "station-2", stationIndex: 1, turnCount: 0, notePresent: false, noteChars: 0 },
      { stationId: "station-3", stationIndex: 2, turnCount: 0, notePresent: false, noteChars: 0 },
    ],
    lobbyScores: badges,
    reviewFinalized,
  } as EncounterSnapshot;
}

function stubHarness(outcome: { serverTs: number } | { rejectReason: string }, unscored: string[] = []): {
  sent: Array<{ kind: string; payload: unknown }>;
  connectFn: () => Promise<unknown>;
} {
  const sent: Array<{ kind: string; payload: unknown }> = [];
  let listener: ((snapshot: EncounterSnapshot) => void) | undefined;
  const connection = {
    sessionId: "faculty-stub",
    sendIntent: async (kind: string, payload: unknown = {}) => {
      sent.push({ kind, payload });
      if ("rejectReason" in outcome) {
        return { status: "reject", seq: sent.length, reason: outcome.rejectReason, rttMs: 1 };
      }
      // The server marks the lobby finalized BEFORE the ack lands, so the
      // next snapshot already carries reviewFinalized.
      listener?.(lobbySnapshot(true, unscored));
      return { status: "ack", seq: sent.length, serverTs: outcome.serverTs, rttMs: 1 };
    },
    onState: (callback: (snapshot: EncounterSnapshot) => void) => {
      listener = callback;
      callback(lobbySnapshot(false, unscored));
      return () => {
        listener = undefined;
      };
    },
    leave: async () => undefined,
  };
  return { sent, connectFn: async () => connection };
}

describe("the faculty console shows the acked finalize time", () => {
  beforeAll(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    vi.stubGlobal("ResizeObserver", class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("lists stations with turn counts, rubric item labels, per-station scores, and one server-item line per station", async () => {
    const { connectFn } = stubHarness({ serverTs: 1800000000000 });
    render(<FacultyReviewConsole syncUrl="ws://127.0.0.1:9/faculty" rubric={RUBRIC} connectFn={connectFn as never} />);

    const list = await screen.findByRole("list", { name: "Review stations" });
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Station 1: 2 turns",
      "Station 2: 0 turns",
      "Station 3: 0 turns",
    ]);

    const signoff = document.querySelector("[data-signoff]");
    expect(signoff?.tagName).toBe("P");
    expect(signoff?.textContent).toBe("Sign-off: open");
    expect(signoff?.getAttribute("data-signoff")).toBe("signoff:open");

    const rubric = document.querySelector("[data-rubric]");
    expect(rubric?.tagName).toBe("P");
    expect(rubric?.textContent).toBe("Rubric items: Asked onset · Examined lungs · Shared the plan");
    expect(rubric?.getAttribute("data-rubric")).toBe("hpi-onset | pe-lungs | plan-shared");

    const scored = document.querySelector("[data-scored]");
    expect(scored?.tagName).toBe("P");
    expect(scored?.textContent).toBe("Scores: Station 1: 2 · Station 2: 2 · Station 3: 2");
    expect(scored?.getAttribute("data-scored")).toBe("station-1:2 | station-2:2 | station-3:2");

    const stationScores = await screen.findByRole("list", { name: "Station scores" });
    expect(within(stationScores).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Station 1: Asked onset ✓, Examined lungs ✗, Shared the plan ✓",
      "Station 2: Asked onset ✓, Examined lungs ✓, Shared the plan ✗",
      "Station 3: Asked onset ✓, Examined lungs ✗, Shared the plan ✓",
    ]);

    expect(new Set([signoff, rubric, scored, stationScores]).size).toBe(4);

    cleanup();
    // CW2: a URL param naming an id the server lacks renders no glyph for it.
    const extra = [...RUBRIC, { id: "ghost-item", label: "Ghost item", checked: true }];
    const second = stubHarness({ serverTs: 1800000000000 });
    render(<FacultyReviewConsole syncUrl="ws://127.0.0.1:9/faculty" rubric={extra} connectFn={second.connectFn as never} />);
    const rescored = await screen.findByRole("list", { name: "Station scores" });
    expect(rescored.textContent ?? "").not.toContain("Ghost item");
    const glyphs = [...(rescored.textContent ?? "")].filter((ch) => ch === "✓" || ch === "✗" || ch === "✕");
    expect(glyphs.length).toBe(9);
  });

  it("shows the acked serverTs after Finalize, not the client clock", async () => {
    const clickNow = 1799999400000;
    const ackTs = clickNow + 60_000;
    vi.spyOn(Date, "now").mockReturnValue(clickNow);
    const { connectFn, sent } = stubHarness({ serverTs: ackTs });
    try {
      render(<FacultyReviewConsole syncUrl="ws://127.0.0.1:9/faculty" rubric={RUBRIC} connectFn={connectFn as never} />);

      expect(await screen.findByText("Scores: Station 1: 2 · Station 2: 2 · Station 3: 2")).toBeInTheDocument();
      expect(document.querySelector("[data-server-ts]")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Finalize" }));
      const finalized = await screen.findByText(`Finalized at ${new Date(ackTs).toISOString()}`);
      expect(finalized.tagName).toBe("P");
      expect(finalized.getAttribute("data-server-ts")).toBe(String(ackTs));
      expect(finalized.getAttribute("title")).toContain(String(ackTs));
      expect(screen.getByText("Sign-off: finalized")).toBeInTheDocument();
      expect(sent.map((entry) => entry.kind)).toEqual(["finalize-review"]);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("shows no finalized time before the ack lands", async () => {
    const { connectFn } = stubHarness({ serverTs: 1800000000000 });
    render(<FacultyReviewConsole syncUrl="ws://127.0.0.1:9/faculty" rubric={RUBRIC} connectFn={connectFn as never} />);

    expect(await screen.findByText("Scores: Station 1: 2 · Station 2: 2 · Station 3: 2")).toBeInTheDocument();
    expect(document.querySelector("[data-server-ts]")).toBeNull();
    expect(screen.queryByText("Finalize rejected: review-finalized")).not.toBeInTheDocument();
  });

  it("shows the server item values, never the URL param flags, and not scored without a score file", async () => {
    // RED2 (card tsk_3b2b5bb28eb3a5de): the ?rubric= param says lungs checked
    // and plan unchecked, while the server items say pe-lungs false and
    // plan-shared true for station 1. The console renders the server values.
    // E2 pinned here too: station 2 has no valid score file, so no items and
    // the UI shows "Station 2: not scored".
    const { connectFn } = stubHarness({ serverTs: 1800000000000 }, ["station-2"]);
    render(<FacultyReviewConsole syncUrl="ws://127.0.0.1:9/faculty" rubric={RUBRIC} connectFn={connectFn as never} />);

    const stationScores = await screen.findByRole("list", { name: "Station scores" });
    expect(within(stationScores).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Station 1: Asked onset ✓, Examined lungs ✗, Shared the plan ✓",
      "Station 2: not scored",
      "Station 3: Asked onset ✓, Examined lungs ✗, Shared the plan ✓",
    ]);
    const text = stationScores.textContent ?? "";
    expect(text).toContain("Examined lungs ✗");
    expect(text).toContain("Shared the plan ✓");
    expect(text).not.toContain("Examined lungs ✓");
    expect(text).not.toContain("Shared the plan ✗");
  });

  it("names the reject reason and shows no finalized time on reject", async () => {
    const { connectFn, sent } = stubHarness({ rejectReason: "review-finalized" });
    render(<FacultyReviewConsole syncUrl="ws://127.0.0.1:9/faculty" rubric={RUBRIC} connectFn={connectFn as never} />);

    expect(await screen.findByText("Scores: Station 1: 2 · Station 2: 2 · Station 3: 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Finalize" }));
    const rejection = await screen.findByText("Finalize rejected: review-finalized");
    expect(rejection.tagName).toBe("P");
    expect(document.querySelector("[data-server-ts]")).toBeNull();
    expect(sent.map((entry) => entry.kind)).toEqual(["finalize-review"]);
  });
});
