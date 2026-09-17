import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SeedWorldviewQueue } from "@openclinxr/ui-route-admin/seed-worldview-queue";
import { installWorldviewQueueTestDom } from "./worldview-queue-test-dom.js";

installWorldviewQueueTestDom();

/**
 * WCG typed-port gate, end to end through the actual worldview UI (not just the pure
 * `compile-edge-port-types.ts` unit tests). The operator's exact ask: "a connection is
 * refused unless the output's type matches the input's."
 *
 * `mergeWorldviewCompileEdges` used to stamp ad hoc, unvalidated `kind`s
 * (`actor.compileNodeKind` = "ActorVariant", `"fixtureSlot"`, `"trellisBake"`,
 * `"authored"`) with no port check at all. `seed-worldview-queue.tsx` now derives the
 * correct closed-vocabulary kind for each worldview action and gained a genuine
 * "connect nodes" action (`reduceWorldviewConnectNodes` -> `resolveCompileEdgeConnection`)
 * that a user can drive from `EnvironmentGenerationQueuePanel`'s two "Connect
 * from/to node" selects and "Connect nodes" button.
 */

const EMPTY_QUEUE = {
  packetCount: 0,
  packets: [],
  blockedScenarioIds: [],
  readyForGenerationReviewScenarioIds: [],
  nextReviewGateCounts: {},
} as never;

/**
 * Compile-graph node ids are random per render (crypto.randomUUID); read the exact
 * generated id from a "Connect …" combobox's own options rather than hardcoding it.
 *
 * jsdom quirk measured directly (not assumed): `installWorldviewQueueTestDom` stubs a
 * FIXED element id ("test-id") for every antd Select instance, and rc-select's option
 * popups do not unmount promptly in jsdom even after a selection closes them
 * visually — so `getAllByRole("option")` returns every option from every popup that
 * has EVER been opened in this render, not just the currently-open one, and they
 * collide on id. The one thing that stays true: rc-select portals APPEND to
 * `document.body` in open order, so the most-recently-opened popup's options are
 * always the LAST occurrences in document order. Taking the last match, not the
 * first, is what makes this reliable rather than reading a stale popup's option.
 */
function selectComboboxOption(comboboxName: string, matcher: (text: string) => boolean): void {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: comboboxName }));
  const options = screen.getAllByRole("option");
  const match = [...options].reverse().find((option) => matcher(option.textContent ?? ""));
  if (!match) {
    throw new Error(`no option matched for combobox "${comboboxName}"`);
  }
  fireEvent.click(match);
}

function findGeneratedNodeId(comboboxName: string, pattern: RegExp): string {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: comboboxName }));
  const options = screen.getAllByRole("option");
  const match = [...options].reverse().find((option) => pattern.test(option.textContent ?? ""));
  if (!match || match.textContent === null) {
    throw new Error(`no compile-graph node id option matched ${String(pattern)} in combobox "${comboboxName}"`);
  }
  return match.textContent;
}

function connectNodes(fromNodeId: string, toNodeId: string): void {
  selectComboboxOption("Connect from node", (text) => text === fromNodeId);
  selectComboboxOption("Connect to node", (text) => text === toNodeId);
  fireEvent.click(screen.getByRole("button", { name: /connect nodes/i }));
}

describe("the worldview connect-nodes action refuses mismatched port types", () => {
  afterEach(() => {
    cleanup();
  });

  it("(1) REFUSES a body output connected to an equipment input", async () => {
    render(<SeedWorldviewQueue environmentGenerationQueue={EMPTY_QUEUE} />);

    // One actor -> one body_to_clothing edge (actor:<id>:body -> actor:<id>:wardrobe).
    fireEvent.click(screen.getByRole("button", { name: /add actor compile node/i }));
    // One equipment bind -> one equip_to_fixture_slot edge (equip:<id> -> fixture:stretcher).
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Equipment fixtureSlot" }));
    fireEvent.click(await screen.findByRole("option", { name: "stretcher" }));
    expect(screen.getByText(/2 compile dependency edge/)).toBeInTheDocument();

    const bodyNodeId = findGeneratedNodeId("Connect from node", /:body$/);
    const equipNodeId = findGeneratedNodeId("Connect from node", /^equip:/);

    connectNodes(bodyNodeId, equipNodeId);

    const result = screen.getByLabelText("Connection attempt result");
    expect(result).toHaveTextContent(/^refused:/);
    expect(result).toHaveTextContent(/body output/);
    // Refused means no edge was added: still 2, not 3.
    expect(screen.getByText(/2 compile dependency edge/)).toBeInTheDocument();
    expect(screen.queryByText(/3 compile dependency edge/)).not.toBeInTheDocument();
  });

  it("(2) ACCEPTS a wardrobe output connected to that same equipment input", async () => {
    render(<SeedWorldviewQueue environmentGenerationQueue={EMPTY_QUEUE} />);

    fireEvent.click(screen.getByRole("button", { name: /add actor compile node/i }));
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Equipment fixtureSlot" }));
    fireEvent.click(await screen.findByRole("option", { name: "stretcher" }));
    expect(screen.getByText(/2 compile dependency edge/)).toBeInTheDocument();

    const wardrobeNodeId = findGeneratedNodeId("Connect from node", /:wardrobe$/);
    const equipNodeId = findGeneratedNodeId("Connect from node", /^equip:/);

    connectNodes(wardrobeNodeId, equipNodeId);

    const result = screen.getByLabelText("Connection attempt result");
    expect(result).toHaveTextContent(/^accepted:/);
    expect(result).toHaveTextContent("wardrobe_to_equipment");
    // Accepted means one new edge landed: 2 -> 3.
    expect(screen.getByText(/3 compile dependency edge/)).toBeInTheDocument();
  });
});

// NOT TESTED: drag-and-drop connect (this UI is select+button, not a canvas drag
// gesture); server-side persistence of a manually connected edge — this proves the
// client-side typed-port gate, not a REST round trip.
