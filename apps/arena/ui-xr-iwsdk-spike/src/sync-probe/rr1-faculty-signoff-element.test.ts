import { afterEach, describe, expect, it, vi } from "vitest";
import { type C14Evidence, createC14Tracker } from "./probe-c14.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RR1 faculty sign-off overlay source", () => {
  it("renders signoff:finalized into #sync-probe-c14", () => {
    const label = { textContent: "c14: -" };
    const querySelector = vi.fn((selector: string) => selector === "#sync-probe-c14" ? label : null);
    vi.stubGlobal("document", { querySelector });
    const evidence: C14Evidence = {
      hitTileId: "",
      triggerFired: false,
      signoffSent: true,
      signoffAcked: true,
      reviewFinalized: false,
      signoffBadge: "",
      connectionId: "fixture",
    };

    createC14Tracker({ c14: evidence })({ mode: "lobby", reviewFinalized: true });

    expect(querySelector).toHaveBeenCalledWith("#sync-probe-c14");
    expect(label.textContent).toBe("signoff:finalized");
    expect(evidence.signoffBadge).toBe("signoff:finalized");
  });
});
