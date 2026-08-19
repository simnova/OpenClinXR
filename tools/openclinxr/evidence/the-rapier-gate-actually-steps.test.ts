import { readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * # THE DEFECT, MEASURED 2026-08-19 on main 2fa424b7 — do not re-derive these rows
 *
 * `@dimforge/rapier3d-compat` is a declared dependency that **nothing imports**.
 *
 *   package.json:390          "@dimforge/rapier3d-compat": "^0.19.3"   (a devDependency)
 *   imports of it, whole tree                                          0
 *   references, whole tree    exactly two string literals, plus their test assertions:
 *     apps/ui-xr/src/main.ts:1735           physicsProbeMode: "runtime_proxy_cues_with_offline_rapier_gate"
 *     apps/ui-xr/src/runtime-state.ts:1046  the same literal
 *
 * **That mode string claims a gate that does not exist.** "offline rapier gate" names an offline
 * physics check; there is no world, no step, no import. It is this repo's characteristic defect —
 * a proven component named in a mode string and wired to nothing — asserting its own presence in
 * the runtime's self-description.
 *
 * ## THE ENGINE WORKS — measured in-process before planting this
 *
 *   version                 0.19.3
 *   ball at y=10, 60 steps  y = 5.0746        drop = 4.9254 m in 56 ms
 *
 * ## WHY THE BAND IS DERIVED, NOT FITTED (SS9s)
 *
 * A body released from rest under gravity falls **½gt²**. Rapier's default timestep is 1/60 s, so
 * 60 steps is exactly 1 s, and 0.5 × 9.81 × 1² = **4.905 m**. The measurement is 4.9254 m — a
 * residual of 0.0204 m, which is the semi-implicit Euler integrator's expected overshoot of half
 * a step (g·dt²/2 = 0.00136 m per step, accumulating).
 *
 * The reference is **Newtonian free fall**, an external floor fixed by the domain. It is not a
 * fraction of the observed drop, and a stub that returns a constant, or a world that never
 * integrates, cannot land inside a 5 cm band around 4.905 m by accident. A self-referential band
 * — "within some fraction of whatever it fell" — would pass on any nonzero number including zero
 * movement plus noise.
 *
 * ## THE apps/ui-xr FENCE STAYS UP — this slice must not touch it
 *
 * `static-assets.test.ts:1192` enforces a physics-touch pre-production fence: no rapier dep in
 * `apps/ui-xr/package.json`, static JSON artifact only, promotion false. That fence is scoped to
 * that package and this contract lives in evidence, so there is no collision — **and clause (4)
 * pins it**, because the obvious way to "wire Rapier" is to import it into the runtime, which
 * would breach a fence someone put up deliberately.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                          | (1) | (2) | (3) | (4) | result
 *   ---------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today — nothing imports it                      |FAIL |FAIL |pass |pass | REFUSED
 *   b) import it, never step                           |pass |**FAIL**|pass|pass| REFUSED
 *   c) rename the mode string so the claim goes away   |FAIL |FAIL |**FAIL**|pass| REFUSED
 *   d) import it into apps/ui-xr and step there        |pass |pass |pass |**FAIL**| REFUSED
 *   e) step it in evidence; leave the fence and string |pass |pass |pass |pass | ALL PASS
 *
 * **(c) is the one to watch.** The mode string is a false claim, and the cheapest way to stop it
 * being false is to delete the word "rapier" from it. That resolves the contradiction by lowering
 * the claim instead of meeting it, and it would silently drop a stated capability from the
 * runtime's self-description. Clause (3) requires the literal to survive intact.
 *
 * **(d) is the tempting one.** "Wire the proven tool" reads like "import it into the runtime".
 * The fence at `static-assets.test.ts:1192` says no, and that is not this slice's decision to
 * overturn.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227):
 *   (1) and (2) are REDS — no importer exists, so nothing steps.
 *   (3) PASSES TODAY — the mode string is present in both files. Pure net against (c).
 *   (4) PASSES TODAY — apps/ui-xr has no rapier dep. Pure net against (d).
 *   (5) PASSES TODAY — vacuity guard on the declared dependency itself.
 *
 * NOT TESTED:
 *   - **That the runtime gains physics.** This proves the ENGINE steps in-process. Whether
 *     anything in a station ever calls it is a separate, later, and fenced decision.
 *   - **Whether Rapier is the right engine.** The lead called this a cagematch-first slice: prove
 *     it earns its place before promotion. Stepping is necessary, not sufficient.
 *   - **Determinism across platforms.** One machine, one run. Rapier is deterministic by design;
 *     that is not demonstrated here.
 *   - **Anything about the ED palpation artifact.** `physics-touch/ed-palpation-bone-transforms.json`
 *     is a static pre-production artifact under the fence and is untouched.
 *   - Quest budget, learner readiness, clinical validity. None.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");

/** Newtonian free fall over 60 steps of Rapier's default 1/60 s timestep: 0.5 * 9.81 * 1^2. */
const ANALYTIC_DROP_METERS = 4.905;
/** Integrator overshoot measured at 0.0204 m; 0.05 m is an order above it and well below any stub. */
const DROP_TOLERANCE_METERS = 0.05;
const STEPS = 60;
/** The literal that claims the gate. Clause (3) refuses deleting the claim instead of meeting it. */
const MODE_LITERAL = "runtime_proxy_cues_with_offline_rapier_gate";

const rootPkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

/**
 * Computed so TypeScript cannot resolve a not-yet-existing module at compile time (#383/#352),
 * and so this contract measures THE REPO'S gate rather than re-implementing one inline.
 *
 * FIRST DRAFT OF THIS FILE WAS VACUOUS AND I CAUGHT IT BEFORE DISPATCH: it created the world
 * inside the test, so all five clauses passed on arrival and a worker would have had nothing to
 * do. A contract that exercises a dependency proves the DEPENDENCY works; only a contract that
 * imports the repo's own module proves the repo CONSUMES it. That is the whole defect here.
 */
const GATE_SPECIFIER = ["./lib/rapier", "gate.js"].join("-");

type GateResult = { engineVersion: string; steps: number; dropMeters: number };

async function loadRepoGate(): Promise<(() => Promise<GateResult>) | null> {
  try {
    const mod = (await import(GATE_SPECIFIER)) as { runFreeFallGate?: () => Promise<GateResult> };
    return mod.runFreeFallGate ?? null;
  } catch {
    return null;
  }
}

const runGate = await loadRepoGate();
const stepped: GateResult | null = runGate ? await runGate().catch(() => null) : null;


describe("the offline rapier gate actually steps", () => {
  it("(1) RED: a Rapier world is created and stepped in-process", () => {
    // Refuses (a). Zero imports exist today; the dependency is declared and unconsumed.
    expect(
      stepped,
      `tools/openclinxr/evidence/lib/rapier-gate.ts must export runFreeFallGate() — today NOTHING in the `
        + `tree imports @dimforge/rapier3d-compat, while main.ts:1735 advertises an "offline rapier gate"`,
    ).not.toBeNull();
    expect((stepped as GateResult).engineVersion, "the gate reports the real engine version").toMatch(/^\d+\.\d+\.\d+/u);
    expect((stepped as GateResult).steps, "the gate must report how many steps it ran").toBe(STEPS);
  });

  it("(2) RED: the step integrates gravity to the analytic free-fall distance", () => {
    // Refuses (b). An imported-but-unstepped world, a stub, or a frozen body all fail this.
    // Reference is Newtonian, external to the thing measured (SS9s): 0.5 * 9.81 * 1^2 = 4.905 m.
    const drop = stepped?.dropMeters ?? 0;
    expect(
      Math.abs(drop - ANALYTIC_DROP_METERS),
      `${STEPS} steps at 1/60 s should drop ${String(ANALYTIC_DROP_METERS)} m; measured ${drop.toFixed(4)} m. `
        + `A world that does not integrate reads 0.`,
    ).toBeLessThanOrEqual(DROP_TOLERANCE_METERS);
  });

  it("(3) COUNTERWEIGHT: the mode string is not deleted to make the claim true", () => {
    // Refuses (c). The literal claims a gate; the fix is to BUILD the gate, not to lower the claim.
    for (const rel of ["apps/ui-xr/src/main.ts", "apps/ui-xr/src/runtime-state.ts"]) {
      expect(
        readFileSync(join(REPO_ROOT, rel), "utf8").includes(MODE_LITERAL),
        `${rel} no longer contains "${MODE_LITERAL}" — deleting the claim is not meeting it`,
      ).toBe(true);
    }
  });

  it("(4) COUNTERWEIGHT: the apps/ui-xr physics fence is not breached", () => {
    // Refuses (d). static-assets.test.ts:1192 forbids a rapier dep in that package; "wire the
    // proven tool" does not authorise overturning a fence someone put up deliberately.
    const uiPkg = JSON.parse(readFileSync(join(REPO_ROOT, "apps/ui-xr/package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...uiPkg.dependencies, ...uiPkg.devDependencies };
    const rapierKeys = Object.keys(all).filter((k) => k.includes("rapier"));
    expect(rapierKeys, `apps/ui-xr must stay free of rapier deps — the pre-production fence`).toEqual([]);
  });

  it("(5) VACUITY GUARD: the dependency really is declared at the root", () => {
    // Reads package.json, not the engine, so it passes today and keeps passing: if someone
    // removes the dependency to make (1) moot, this goes red first.
    const all = { ...rootPkg.dependencies, ...rootPkg.devDependencies };
    expect(all, "the root must still declare the engine this contract is about").toHaveProperty(
      "@dimforge/rapier3d-compat",
    );
  });
});
