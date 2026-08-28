import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: speak-fixture stills are a grey cloth fill. The camera is not on the actor's head.
 *
 * MEASURED 2026-08-28. Orchestrator native grade of
 * tools/openclinxr/evidence/speak-fixture-stills/speak-fixture-rest.png,
 * speak-fixture-speaking-1.png, speak-fixture-speaking-2.png: 3D view is a grey cloth volume
 * filling the viewport. HUD on speaking frames names the fixture. JSON joinVerdict is true.
 * Live JSON has no firstHit / occluder field, so a green joinVerdict can sit next to a cloth fill.
 *
 * claimScope: speak-fixture stills framed on the patient actor (first camera->head hit is the actor).
 * notEvidenceFor: viseme correctness; audible speech; Quest; clinical validity.
 *
 * Diagnosis and measured tables in this header are IMMUTABLE. Flip it.fails → it and append
 * ## FIXED. Do not rewrite the original paths or numbers.
 */

const REPO = process.cwd();
const LIVE = join(REPO, "tools/openclinxr/evidence/ui-xr-speak-fixture-live.json");

describe("the speak fixture stills are framed on the actor", () => {
  it.fails("(1) live JSON records the first camera-to-head hit as the expected actor", () => {
    expect(existsSync(LIVE)).toBe(true);
    const live = JSON.parse(readFileSync(LIVE, "utf8")) as {
      fixture?: { expectedActorId?: string };
      framing?: { firstHitActorId?: string; occluder?: boolean };
    };
    expect(live.framing?.occluder).toBe(false);
    expect(live.framing?.firstHitActorId).toBe(live.fixture?.expectedActorId);
  });

  it("(2) COUNTERWEIGHT: the live JSON still exists and joinVerdict fired", () => {
    expect(existsSync(LIVE)).toBe(true);
    const live = JSON.parse(readFileSync(LIVE, "utf8")) as {
      joinVerdict?: { transcript?: boolean; response?: boolean; actor?: boolean };
    };
    expect(live.joinVerdict?.transcript).toBe(true);
    expect(live.joinVerdict?.response).toBe(true);
    expect(live.joinVerdict?.actor).toBe(true);
  });
});

// NOT TESTED: that the pixels look like a mouth; viseme identity.
