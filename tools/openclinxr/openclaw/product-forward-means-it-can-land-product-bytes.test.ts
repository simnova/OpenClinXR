/**
 * `readyDepth` calls a card product-forward when its `factory_step` is anything but `instrument`.
 * That is not the same question as "can this card reset the product clock", and the gap has been
 * reported for 38 consecutive audits.
 *
 * MEASURED 2026-08-26, real cards through `briefFromIssue` and the canonical `isProductPath`:
 *
 *   #577  room_generate  changed: docs/openclinxr/cagematch/findings/iwsdk-scene-composer.md  -> false
 *   #568  body_param     changed: apps/ui-xr/public/generated-humanoids/                      -> TRUE
 *   #674  instrument     changed: tools/openclinxr/evidence/*.test.ts                         -> false
 *
 * #577 is counted as product-forward today and **cannot land a product byte**. For most of one night
 * `readyDepth.productForward` read 1-2 while the product clock sat at 17 evidence-only commits and
 * `assertProductLaneNotStarved` refused every non-product dispatch — the gauge said the queue had
 * product work and the gate said it did not, and the gate was right.
 *
 * THE FIX IS NOT A SPECIAL CASE. `isProductPath` (product-lane-gate.ts:63) is already the authority
 * the refusing gate uses. This asks the same predicate the same question, so the two cannot drift:
 * one definition, both ends.
 *
 * DELIBERATELY CONJUNCTIVE — a card must be BOTH a product station AND able to deliver:
 *   - `factory_step: instrument` stays excluded even if it touches a product path incidentally,
 *     because the skill's `FACTORY_STEPS` names instrument as the non-station and this contract is
 *     not the place to relitigate that.
 *   - a product station whose contract cannot land product bytes is excluded, which is the defect.
 * Strictly tighter than today. It cannot promote anything that is not already counted.
 *
 * ADDITIVE BY CONSTRUCTION: `landsProductBytes` is optional, and `undefined` preserves the old
 * behaviour exactly. Callers that do not supply it are unchanged — clause (3) pins that.
 *
 * claimScope: which ready cards `readyDepth` counts as product-forward.
 * notEvidenceFor: whether any card's contract is otherwise well-formed, and whether a card that CAN
 *   land product bytes will. `changed:apps/ui-xr/` is satisfied by touching any file under it — a
 *   defect I introduced on #588 and one this contract does not fix.
 */
import { describe, it, expect } from "vitest";
import { readyDepth } from "./supervisor-audit.js";
import { isProductPath } from "./product-lane-gate.js";

const base = { dispatchable: true, planted: true, prioritized: true } as const;

describe("product-forward means the card can land product bytes", () => {
  // (1) THE HOLE: #577's real shape — a product STATION whose contract targets only a docs file.
  it("refuses a product station whose contract cannot land product bytes", () => {
    expect(isProductPath("docs/openclinxr/cagematch/findings/iwsdk-scene-composer.md")).toBe(false);
    const d = readyDepth([
      { ...base, number: 577, factoryStep: "room_generate", landsProductBytes: false },
    ]);
    expect(d.productForward, "#577 is room_generate and can never reset the product clock").toBe(0);
    expect(d.includingInstrument, "it is still READY — this is about the product count only").toBe(1);
  });

  // (2) COUNTERWEIGHT: #568's real shape must still count. Without this the contract passes by
  //     counting nothing, which is the same lie in the other direction.
  it("counts a product station whose contract DOES land product bytes", () => {
    expect(isProductPath("apps/ui-xr/public/generated-humanoids/")).toBe(true);
    const d = readyDepth([
      { ...base, number: 568, factoryStep: "body_param", landsProductBytes: true },
    ]);
    expect(d.productForward).toBe(1);
    expect(d.cards).toEqual([568]);
  });

  // (3) COUNTERWEIGHT: omitting the field preserves today's behaviour exactly, so no existing caller
  //     changes. A fix that silently reclassifies unmeasured cards is worse than the defect.
  it("falls back to the factory-step rule when landsProductBytes is undefined", () => {
    const d = readyDepth([
      { ...base, number: 900, factoryStep: "room_generate" },
      { ...base, number: 901, factoryStep: "instrument" },
    ]);
    expect(d.productForward, "undefined must behave exactly as before").toBe(1);
    expect(d.cards).toEqual([900]);
  });

  // (4) COUNTERWEIGHT: instrument stays excluded even when it lands product bytes. This contract
  //     tightens the definition; it must not promote a card that is not counted today.
  it("does not promote an instrument card that happens to touch a product path", () => {
    const d = readyDepth([
      { ...base, number: 902, factoryStep: "instrument", landsProductBytes: true },
    ]);
    expect(d.productForward, "instrument is the non-station; that is FACTORY_STEPS' call").toBe(0);
    expect(d.includingInstrument).toBe(1);
  });
});
