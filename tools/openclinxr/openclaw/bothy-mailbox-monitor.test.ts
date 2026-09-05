import { describe, expect, it } from "vitest";

import {
  decideMailboxMonitorTick,
  lookedAtCardsUpdated,
  readyTaskChanged,
} from "./bothy-mailbox-monitor.js";

describe("bothy-mailbox-monitor wakes", () => {
  it("seed tick is silent even when mail and a ready card already exist", () => {
    expect(
      decideMailboxMonitorTick({
        isSeed: true,
        newForeignIds: ["cmt_old"],
        readyTaskChanged: true,
        lookedAtUpdated: true,
        patPresent: true,
        permanentErrorCount: 0,
      }),
    ).toEqual({ emit: null, abort: false });
  });

  it("wakes on a new foreign mailbox comment", () => {
    expect(
      decideMailboxMonitorTick({
        isSeed: false,
        newForeignIds: ["cmt_new"],
        patPresent: true,
        permanentErrorCount: 0,
      }).emit,
    ).toBe("DONE");
  });

  it("wakes when tasks.next identity changes", () => {
    expect(readyTaskChanged(null, "tsk_next")).toBe(true);
    expect(readyTaskChanged("tsk_a", "tsk_b")).toBe(true);
    expect(readyTaskChanged("tsk_a", "tsk_a")).toBe(false);
    expect(readyTaskChanged(null, null)).toBe(false);
    expect(
      decideMailboxMonitorTick({
        isSeed: false,
        newForeignIds: [],
        readyTaskChanged: true,
        patPresent: true,
        permanentErrorCount: 0,
      }).emit,
    ).toBe("DONE");
  });

  it("wakes when a looked-at card's updatedAt moves", () => {
    expect(
      lookedAtCardsUpdated(
        { tsk_looked: "2026-09-03T21:00:00.000Z" },
        { tsk_looked: "2026-09-03T21:40:00.000Z" },
      ),
    ).toBe(true);
    expect(
      lookedAtCardsUpdated(
        {},
        { tsk_looked: "2026-09-03T21:40:00.000Z" },
      ),
    ).toBe(false);
    expect(
      lookedAtCardsUpdated(
        { tsk_looked: "2026-09-03T21:00:00.000Z" },
        { tsk_looked: "2026-09-03T21:00:00.000Z" },
      ),
    ).toBe(false);
    expect(
      decideMailboxMonitorTick({
        isSeed: false,
        newForeignIds: [],
        readyTaskChanged: false,
        lookedAtUpdated: true,
        patPresent: true,
        permanentErrorCount: 0,
      }).emit,
    ).toBe("DONE");
  });

  it("stays quiet when nothing moved", () => {
    expect(
      decideMailboxMonitorTick({
        isSeed: false,
        newForeignIds: [],
        readyTaskChanged: false,
        lookedAtUpdated: false,
        patPresent: true,
        permanentErrorCount: 0,
      }).emit,
    ).toBe(null);
  });
});
