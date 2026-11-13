import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// C49 RED B: C48 folded `let replayClock = false;` onto the #station-clock line and the replayAnchor / onReplay deps onto the
// long startEncounterSyncFromUrl line, which hid the wiring. Each now sits on a line of its own, and main.ts is no longer than at
// C48 (4766 lines; the ui-xr app ceiling stays frozen). main.ts cannot be imported (it boots the page), so the source is pinned.
const MAIN = readFileSync(fileURLToPath(new URL("./main.ts", import.meta.url)), "utf8");
const LINES = MAIN.split("\n");
const C48_MAIN_LINES = 4766;

describe("the replay wiring has its own lines in main.ts (C49)", () => {
  it("replayClock is declared on a line of its own", () => {
    expect(LINES.filter((line) => /^\s*let replayClock = false;\s*$/.test(line))).toHaveLength(1);
  });

  it("the onReplay dep sits on a line of its own", () => {
    expect(LINES.filter((line) => /^\s*onReplay: \(\) => \{ replayClock = true; clock\.textContent = "Replay"; \},?\s*$/.test(line))).toHaveLength(1);
  });

  it("the replayAnchor dep sits on a line of its own", () => {
    expect(LINES.filter((line) => /^\s*replayAnchor: .*\.ehr-panel.*,?\s*$/.test(line))).toHaveLength(1);
  });

  it("the tick writer is still guarded and the clock has exactly four writers (replay, break, phase, tick)", () => {
    expect(MAIN).toContain("if (!replayClock && !breakClock && !syncedServerPhase) clock.textContent = formatStationClock(state.elapsedSecond);");
    expect(MAIN.match(/\bclock\.textContent =/g)).toHaveLength(4);
  });

  it("main.ts is no longer than it was at C48", () => {
    expect(LINES.length - (MAIN.endsWith("\n") ? 1 : 0)).toBeLessThanOrEqual(C48_MAIN_LINES);
  });
});
