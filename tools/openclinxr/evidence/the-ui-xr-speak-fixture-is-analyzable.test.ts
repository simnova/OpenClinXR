import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: UI-XR has no runnable learner-speech fixture from transcript to a speaking actor.
 *
 * MEASURED 2026-08-28. GitHub #710. `package.json` has no `local:voice:ui-xr-speak-fixture` script
 * (voice scripts stop at `local:voice:blueprint-simulation`). `ui-xr-viseme-drive-capture.ts` exists
 * and is the proven instrument to extend — it does not yet mention a learner transcript fixture.
 *
 * claimScope: deterministic offline fixture turn reaching UI-XR transcript, response, and live mouth
 * measurement.
 * notEvidenceFor: microphone, STT/TTS, audible playback, Quest, clinical validity.
 *
 * ## FIXED (#710)
 *
 * Clauses (1) and (2) flipped from `it.fails` to `it` on 2026-08-28. Root package.json now defines
 * `local:voice:ui-xr-speak-fixture` (tsx ui-xr-viseme-drive-capture.ts --speak-fixture), and the
 * capture names the learner-transcript speak fixture: `--speak-fixture` runs the #709 runner
 * (scenario-runtime generateRoutedActorResponse, mock-only gateway) in Node, hands the runner's
 * in-memory turn result to the page through the dev-only speak-fixture bridge
 * (apps/ui-xr/src/speak-fixture-bridge.ts, openclinxrSpeakFixture=1), fires the actor's dialogue
 * with the runner's response text via the existing triggerHumanoidDialogue path, and measures the
 * speaking actor's live viseme drive with the same sampler. Tracked artifact:
 * ui-xr-speak-fixture-live.json + rest/speaking stills under tools/openclinxr/evidence/.
 *
 * Diagnosis and measured tables in this header are IMMUTABLE. Flip it.fails → it and append
 * ## FIXED. Do not rewrite the original paths or numbers.
 */

const REPO = process.cwd();
const PKG = join(REPO, "package.json");
const CAPTURE = join(REPO, "tools/openclinxr/evidence/ui-xr-viseme-drive-capture.ts");

describe("the ui-xr speak fixture is analyzable", () => {
  it("(1) package.json defines local:voice:ui-xr-speak-fixture", () => {
    const pkg = JSON.parse(readFileSync(PKG, "utf8")) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.["local:voice:ui-xr-speak-fixture"]).toBeTruthy();
  });

  it("(2) the viseme-drive capture names a learner-transcript speak fixture", () => {
    const src = readFileSync(CAPTURE, "utf8");
    expect(src.toLowerCase()).toMatch(/learner.?transcript|speak.?fixture/);
  });

  it("(3) COUNTERWEIGHT: the proven viseme-drive capture still exists", () => {
    expect(existsSync(CAPTURE)).toBe(true);
    expect(readFileSync(CAPTURE, "utf8")).toContain("morphTargetInfluences");
  });
});

// NOT TESTED: acoustic input; full-duplex; Quest.
