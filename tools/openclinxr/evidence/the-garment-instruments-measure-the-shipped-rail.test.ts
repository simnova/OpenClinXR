import { describe, expect, it } from "vitest";

/**
 * **OBSERVABLE: every garment instrument can measure the humanoids this project ships.**
 *
 * ## MEASURED ON HEAD 21090895, 2026-08-23 — re-measured at plant time, not inherited
 *
 * Each module's own entry point against the real `generated-humanoids` directory:
 *
 *     actor-footwear-presence    OK
 *     garment-hem-boundary       OK                 <- fixed by #594
 *     open-front-underlayer      OK                 <- fixed by #589
 *     garment-surface-derived    CRASH RangeError
 *     sleeve-arm-colour-match    CRASH RangeError
 *     sleeve-wrist-boundary      CRASH RangeError
 *
 * **Three appearance gates still throw on the shipped rail.** Shipped humanoids reach 184,062
 * vertices / 115,206 per primitive; a spread passes each element as an argument, so
 * `Math.min(...positions.map(...))` blows the call stack. The instruments do not report a defect —
 * they die, and their deaths have been read as product failures.
 *
 * ## THE FIX EXISTS AND IS UNCONSUMED — D1
 *
 * `tools/openclinxr/evidence/min-max-bounds.ts` landed with #589: `minOf`, `maxOf`, single-walk
 * `minMaxXyz`, `Math.min`/`Math.max` empty-input semantics preserved. **Two modules consume it.
 * Three do not.** Wire it; do not write a second helper.
 *
 * ## NOT A DEFECT — do not sweep by pattern
 *
 * `shoulder-coverage.ts` carries 7 spreads and ZERO over vertex-scale arrays.
 * `Math.max(...girthDeltas)` over four actors is correct and must stay. **The trigger is array
 * LENGTH, not syntax** — a pattern sweep would churn correct code and fails clause (4).
 *
 * claimScope: whether each garment instrument returns a report for the shipped humanoid set.
 * notEvidenceFor: whether any garment is correct; what the reports say; the ~178 spread sites in
 *   modules outside this list.
 */

const DIR = "apps/ui-xr/public/generated-humanoids";

async function runs(mod: string, fn: string): Promise<{ ok: boolean; why: string }> {
  try {
    const m = (await import(`./${mod}.js`)) as Record<string, (o: unknown) => Promise<unknown>>;
    const entry = m[fn];
    if (typeof entry !== "function") return { ok: false, why: `no export ${fn}` };
    await entry({ humanoidDir: DIR });
    return { ok: true, why: "" };
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message.slice(0, 80) : String(e).slice(0, 80) };
  }
}

const CRASHING: Array<[string, string]> = [
  ["garment-surface-derived", "inspectGarmentSurfaceDerivation"],
  ["sleeve-arm-colour-match", "inspectSleeveArmColourMatch"],
  ["sleeve-wrist-boundary", "inspectSleeveWristBoundary"],
];

describe("the garment instruments measure the shipped rail", () => {
  for (const [mod, fn] of CRASHING) {
    it.fails(`(1.${mod}) RED: ${mod} returns a report instead of throwing`, async () => {
      const r = await runs(mod, fn);
      expect(r.ok, `${mod} still fails: ${r.why}`).toBe(true);
    });
  }

  it("(2) KNOWN-GOOD COLUMN: the three already-working instruments still work", async () => {
    // Pins what #589 and #594 bought. Without this, clause (1) could be satisfied by a change that
    // breaks the modules already fixed, and the sweep would trade one crash set for another.
    for (const [mod, fn] of [
      ["actor-footwear-presence", "inspectActorFootwearPresence"],
      ["garment-hem-boundary", "inspectGarmentHemBoundary"],
      ["open-front-underlayer", "inspectOpenFrontUnderLayer"],
    ] as Array<[string, string]>) {
      const r = await runs(mod, fn);
      expect(r.ok, `${mod} regressed: ${r.why}`).toBe(true);
    }
  });

  it("(3) COUNTERWEIGHT: small fixed-array spreads are NOT swept", async () => {
    // Refuses a pattern sweep. shoulder-coverage's spreads are over four-element arrays and are
    // correct; converting them is churn, and a fix that cannot tell length from syntax will do it.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("tools/openclinxr/evidence/shoulder-coverage.ts", "utf8");
    const spreads = (src.match(/Math\.(min|max)\(\.\.\./gu) ?? []).length;
    expect(spreads, "shoulder-coverage's small-array spreads must be left alone").toBe(7);
  });

  it.fails("(4) RED: the shared helper is consumed by every module this card fixes", async () => {
    // Refuses a second helper (D1) and refuses fixing one module by hand while leaving its siblings.
    const { readFileSync } = await import("node:fs");
    const unwired = CRASHING
      .map(([mod]) => mod)
      .filter((mod) => !/from "\.\/min-max-bounds\.js"/u.test(readFileSync(`tools/openclinxr/evidence/${mod}.ts`, "utf8")));
    expect(unwired, `these still hand-roll bounds instead of wiring min-max-bounds.ts`).toEqual([]);
  });
});
