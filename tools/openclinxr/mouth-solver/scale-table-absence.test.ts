/**
 * Inverted guard: the runtime teeth scale table must NOT exist.
 *
 * Context: e4ff44801 added a per-target teeth morph scale table behind the
 * prepared playback path (setPreparedTeethVisemeScales in
 * viseme-lip-dynamics.ts, exposed via diagnostics.setTeethVisemeScales).
 * Measurement showed a uniform morph scale cannot decouple the upper and
 * lower arches: every RMS-improving scale above 1.0 violated the
 * upper-teeth constraint, per-target keying helped E only, and consonant
 * frames (no teeth morph weight) were unreachable at any scale. The producer
 * (seat-teeth-on-lip-rim.ts) now owns gap behavior through rim-referenced
 * skin/morph transfer, so the table was removed.
 *
 * Restoration (only if the producer approach is ever abandoned): reinstate
 * setPreparedTeethVisemeScales/resetPreparedTeethVisemeScales in
 * packages/openclinxr/xr-dialogue/src/viseme-lip-dynamics.ts plus the two
 * diagnostics passthrough methods in actor-audio-runtime.ts, with NO export
 * changes. Do NOT widen it instead (e.g. per-vertex scales or a jaw-gain
 * override): any runtime-side scalar still spans both arches through the
 * shared morph targets, so widening re-trades upper-arch displacement
 * against gap with no new decoupling. Failing this test means the table is
 * back; either remove it again or delete this guard with coordinator sign-off
 * recorded in the commit message.
 */
import { readFileSync } from "node:fs";
import { createActorAudioRuntime } from "@openclinxr/xr-dialogue/actor-audio-runtime";
import { describe, expect, it } from "vitest";

const LIP_DYNAMICS_SRC = new URL(
  "../../../packages/openclinxr/xr-dialogue/src/viseme-lip-dynamics.ts",
  import.meta.url,
).pathname;
const RUNTIME_SRC = new URL(
  "../../../packages/openclinxr/xr-dialogue/src/actor-audio-runtime.ts",
  import.meta.url,
).pathname;

describe("teeth scale table absence", () => {
  it("has no teeth-scale symbols in xr-dialogue sources", () => {
    for (const path of [LIP_DYNAMICS_SRC, RUNTIME_SRC]) {
      const source = readFileSync(path, "utf8");
      expect(source).not.toContain("TeethVisemeScale");
      expect(source).not.toContain("teethVisemeScale");
    }
  });

  it("exposes no teeth-scale methods on runtime diagnostics", () => {
    const runtime = createActorAudioRuntime({
      developmentFixture: true,
      fixtureSearch: "?openclinxrSpeakFixture=1",
    });
    const diagnostics = runtime.diagnostics as unknown as Record<string, unknown>;
    expect("setTeethVisemeScales" in diagnostics).toBe(false);
    expect("resetTeethVisemeScales" in diagnostics).toBe(false);
  });
});
