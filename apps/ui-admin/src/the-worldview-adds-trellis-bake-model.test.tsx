import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SeedWorldviewQueue } from "./seed-worldview-queue.js";
import { installWorldviewQueueTestDom } from "./worldview-queue-test-dom.js";

installWorldviewQueueTestDom();

/**
 * OBSERVABLE: worldview can bind fixtureSlot but cannot add a net-new TRELLIS
 * bake model to the room. Add-actor already exists; TRELLIS is the gap.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 *
 * ## FIXED (worldview net-new TRELLIS bake model)
 */

const EMPTY_QUEUE = {
  packetCount: 0,
  packets: [],
  blockedScenarioIds: [],
  readyForGenerationReviewScenarioIds: [],
  nextReviewGateCounts: {},
} as never;

describe("the worldview adds a TRELLIS bake model to the room", () => {
  afterEach(() => {
    cleanup();
  });

  it("(1) Add TRELLIS bake model appends trellisBake compile edge and lock row distinct from fixtureSlot", () => {
    render(<SeedWorldviewQueue environmentGenerationQueue={EMPTY_QUEUE} />);
    fireEvent.click(screen.getByRole("button", { name: /add actor compile node/i }));
    expect(within(screen.getByLabelText("proposedVsAccepted")).getByText(/llmProposed ActorVariant/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /add trellis bake model/i }));
    expect(within(screen.getByLabelText("proposedVsAccepted")).getByText(/llmProposed trellisBake/)).toBeInTheDocument();
    expect(screen.getByText(/2 compile dependency edge/)).toBeInTheDocument();
  });

  it("(2) COUNTERWEIGHT: fixtureSlot bind still writes facultyAccepted stretcher", async () => {
    render(<SeedWorldviewQueue environmentGenerationQueue={EMPTY_QUEUE} />);
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Equipment fixtureSlot" }));
    fireEvent.click(await screen.findByRole("option", { name: "stretcher" }));
    expect(within(screen.getByLabelText("proposedVsAccepted")).getByText(/facultyAccepted stretcher/)).toBeInTheDocument();
  });

  it("(3) room Infinigen prompt remains authorable on SeedWorldviewQueue", () => {
    render(<SeedWorldviewQueue environmentGenerationQueue={EMPTY_QUEUE} />);
    const area = screen.getByLabelText("Room Infinigen prompt");
    fireEvent.change(area, { target: { value: "exam bay hard-surface cart" } });
    expect((area as HTMLTextAreaElement).value).toBe("exam bay hard-surface cart");
  });
});

// NOT TESTED: live bake; Quest triangle budget.
