import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#141) — evidence modules cache their measurement to disk and read it back with
 * no record of the tree they measured, so a stale artifact asserts against a scene that no longer
 * exists.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT — the cache must keep working when the tree has NOT
 * moved, because it exists to avoid re-paying a 29-second Vite boot per test. It is `it.fails` only
 * because the module is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * FOUR FALSE READINGS IN FOUR CYCLES. THIS IS NOW BLOCKING.
 *
 * `seated-contact-and-flexion.ts:108-109` reads `.openclinxr/evidence/seated-posture/*.json` when it
 * exists. Every time an upstream slice changes the scene, the next health run asserts against the
 * previous measurement:
 *
 *   - after #138 landed and fixed the seated silhouette, the test still failed with BYTE-IDENTICAL
 *     numbers. Deleting the artifact gave 3 passed.
 *   - this cycle, after #103 regenerated six humanoids, `seated-posture-survives-mixer` reported red
 *     again. Deleting the artifact gave 7 passed of 8.
 *
 * Both times I spent part of a cycle believing a landed fix had not worked. A gate that produces
 * FALSE DIAGNOSES costs more than a gate that is simply red.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE CACHE IS NOT THE DEFECT — THE MISSING STAMP IS
 *
 * #105's brief explicitly told a worker to measure once into an artifact and assert against it,
 * because a previous slice paid three cold Vite boots by measuring inside each test case. That was
 * correct and the worker implemented it correctly. **Do not remove the cache.** The counterweight
 * exists to stop that.
 *
 * What is missing is that the artifact records nothing about WHAT it measured. §7s in the delegation
 * rules already prescribes the fix and nothing implements it:
 *
 *   > Any contract whose measurement is cached to disk must record the tree state it measured — a
 *   > commit sha, or the hashes of the inputs — and refuse the cache when that has moved.
 *
 * There is a second, cheaper detector worth having alongside it, because it is what actually caught
 * this: **compare the run duration to the honest cost of the measurement.** The real measurement
 * boots Vite and takes ~29s; the cached path returned in 3.4s. A suspiciously fast pass — or fail —
 * is a failed run.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THIS IS THE THIRD INSTANCE OF THE CLASS
 *
 *   #55  a cached gate reported green over a red main
 *   #89  evidence/latest/ on main mixes runs with no commit stamp, so the pixel-grading loop can
 *        grade stale images as current
 *   this one, in both directions — red about nothing, and green about nothing
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SWEEP FIRST — I HAVE NOT DONE IT
 *
 * I found `seated-contact-and-flexion.ts` by chasing a specific failure. I have **not** swept
 * `tools/openclinxr/evidence/**` for other modules that read back their own artifact. Contract (1)
 * enumerates them rather than taking my one example, because a fix that stamps one module and leaves
 * three unstamped is the #102 lesson wearing different clothes.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - What the stamp is. A commit sha is simple and wrong in a dirty tree — which is exactly when this
 *    bites, since every one of the four false readings happened right after an integrate. Input
 *    hashes are honest and more work. Your call, and say why.
 *  - Whether a stale cache is REFUSED (honest, noisy, and forces a slow re-measure) or REFRESHED
 *    automatically (convenient, and hides how slow the test really is). I have no strong view.
 *  - Whether the stamp lives in each module or in a shared helper. There may be one reader or four;
 *    the sweep decides.
 *  - Whether the duration heuristic ships as a check or only as a note in the module. It is a
 *    heuristic, not a proof, and dressing it as a proof would be its own defect.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands every cached artifact carry a tree stamp, and is satisfiable by writing a constant. (2)
 * forbids that by requiring a stale stamp to actually be refused. (3) is green today and forbids
 * buying either by deleting the cache, which would reintroduce the cold-boot cost the cache exists to
 * avoid.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectMeasurementCacheFreshness()`. What must
 * not change: cache-reading modules are ENUMERATED from `tools/openclinxr/evidence/**`, not listed.
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS THE
 * OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT.
 *
 * SCOPE: whether a cached measurement knows what it measured. Says NOTHING about whether any
 * measurement is correct, and nothing about the pixel-grading evidence directory (#89), which is the
 * same class in a different place and stays open.
 */

const load = async () => import("./measurement-cache-freshness.js") as Promise<Record<string, unknown>>;

type CachingModule = {
  /** Repo-relative path of an evidence module that reads back its own artifact. */
  modulePath: string;
  /** Repo-relative path of the artifact it reads. */
  artifactPath: string;
  /** True when the artifact records the tree state it measured — a sha, or input hashes. */
  recordsTreeStamp: boolean;
  /** True when a stamp that no longer matches causes the cache to be refused or refreshed. */
  refusesStaleStamp: boolean;
  /** True when the module still returns a cached result for an unchanged tree. */
  servesFreshCache: boolean;
};

type Inspect = () => Promise<{ modules: CachingModule[] }>;

describe("a cached measurement knows what it measured (#141)", () => {
  it("every cache-reading evidence module records a tree stamp", async () => {
    // seated-contact-and-flexion.ts:108-109 readFile's its artifact with no record of the scene it
    // measured. Enumerated rather than listed — I found one by chasing a failure and never swept.
    const mod = await load();
    const inspect = mod["inspectMeasurementCacheFreshness"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.modules.length, "no cache-reading modules were found — the sweep found nothing").toBeGreaterThan(0);

    const unstamped = report.modules
      .filter((m) => !m.recordsTreeStamp)
      .map((m) => `${m.modulePath} caches to ${m.artifactPath} with no tree stamp`);
    expect(unstamped, `caches that cannot know if they are stale:\n${unstamped.join("\n")}`).toHaveLength(0);
  }, 900_000);

  it("a stamp that no longer matches is refused", async () => {
    // Kills the cheap satisfaction of the first contract: writing a stamp nobody compares leaves the
    // stale artifact being served exactly as before, with a field that makes it look handled.
    const mod = await load();
    const inspect = mod["inspectMeasurementCacheFreshness"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const ignored = report.modules
      .filter((m) => m.recordsTreeStamp && !m.refusesStaleStamp)
      .map((m) => `${m.modulePath} records a stamp and serves the cache anyway`);
    expect(ignored, `stamps nobody checks:\n${ignored.join("\n")}`).toHaveLength(0);
  }, 900_000);

  it("the cache still serves an unchanged tree (COUNTERWEIGHT)", async () => {
    // The cache exists because #105 measured three cold Vite boots inside one suite. Deleting it to
    // make the other two contracts trivially true would re-earn that cost. Refusing EVERY cache is
    // the cheap satisfaction here and it is forbidden.
    const mod = await load();
    const inspect = mod["inspectMeasurementCacheFreshness"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    for (const m of report.modules) {
      expect(m.servesFreshCache, `${m.modulePath} stopped caching entirely`).toBe(true);
    }
  }, 900_000);
});
