import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * **`overlapping-garments-do-not-interpenetrate` is RED on main, and the cheapest way to green it is
 * to stop measuring the actor that broke it.** This contract exists to refuse that.
 *
 * The wardrobe campaign re-dressed staff from `cargo_pants` into `scrub_pants`. That gate's selector
 * is `/cargo_pants/i` (`:126`), so `mpfb-peds-nurse-kevin` — one of the three actors it names — now
 * yields no measurable row. Its `requireMeasured()` asserts `rows.length === ACTORS.length` and all
 * three clauses fail.
 *
 * **The vacuity guard did its job.** I predicted the gate would pass silently over an unmeasurable
 * actor; it does not, because someone wrote that guard for exactly this (§7t). The regression is
 * visible only because of it. Recorded because I was wrong and the guard was right.
 *
 * ## MEASURED 2026-08-14 — what ships against what is watched
 *
 *   actor                          | in ACTORS | cargo | scrub | footwear
 *   -------------------------------|-----------|-------|-------|---------
 *   mpfb-ob-patient-aisha          |    yes    |  2782 |     0 |    57600
 *   mpfb-peds-patient-child        |    yes    |  2636 |     0 |     1004
 *   **mpfb-peds-nurse-kevin**      |  **yes**  | **0** |  2704 |    30768
 *   mpfb-clinical-nurse-adult      |   **NO**  |     0 |  2704 |    57600
 *   mpfb-clinical-physician-adult  |   **NO**  |     0 |  2704 |    57600
 *   mpfb-family-partner-adult      |   **NO**  |  2821 |     0 |     1004
 *   mpfb-peds-parent-aisha         |   **NO**  |  2782 |     0 |    57600
 *
 * **Seven shipped assets carry a lower garment and footwear. Two are actually measured.**
 *
 * This is §7j in production: a check that names its subjects explicitly, and a selector that names one
 * garment id, both went stale the moment the wardrobe changed. Neither failed loudly at the moment of
 * the change — the gate went red one landing LATER, when I happened to run it.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                            | (1) covered | (2) no shrink | result
 *   ------------------------------------------------------|-------------|---------------|--------
 *   a) today — 3 named, 1 of them unmeasurable            |  **FAIL**   |     pass      | REFUSED
 *   b) drop kevin from ACTORS so the gate goes green      |  **FAIL**   |   **FAIL**    | REFUSED
 *   c) widen the selector only, leave ACTORS at 3          |  **FAIL**   |     pass      | REFUSED
 *   d) widen the selector AND enumerate from what ships    |    pass     |     pass      | ALL PASS
 *
 * **(b) is the one to watch and it is one line.** Deleting the offending actor satisfies
 * `requireMeasured()` instantly and leaves the boot/trouser overlap unwatched on the actor whose
 * wardrobe just changed. Clause (2) pins the three currently-named actors so the population can only
 * grow.
 *
 * **(c) is a half fix** — it restores kevin and still leaves four shipped assets unwatched.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1) is the sole RED.** **(2) passes today** and is a true
 * net. **(3) passes today** and guards vacuity.
 *
 * NOT TESTED:
 *   - **Whether any newly-covered actor then FAILS the interpenetration measure.** Likely, and that is
 *     the point — this contract asserts they are MEASURED, not that they pass. New baselines must be
 *     measured, not copied; `BASELINE[actor] ?? 0` would false-red every new actor.
 *   - **The upper-garment layering** (coat over scrub shirt). A separate defect, separately unmeasured:
 *     the radial instrument I tried answers "is the shirt outside the coat" and cannot answer "does the
 *     coat cover" (§6t). Not filed as a mechanism.
 *   - **Anny-rail assets.** `mpfb-*.glb` only.
 *
 * ## FIXED (#408) — 2026-08-14
 *
 * (1) flipped to live: the gate's population is now the full shipped dressed set — seven actors —
 * selected by the lower-garment CLASS `(cargo|scrub|trouser)_pants`, enumerated from what ships and
 * re-checked inside the gate itself (see the gate's FIXED #408 block), so every shipped dressed
 * actor is measured. (2) unchanged. (3) corrected: the planted `actors.length < dressed.length`
 * assertion is unsatisfiable alongside (1) — (1) requires every dressed actor to be IN the gate
 * population (|population| >= |dressed|) while (3) demanded |population| < |dressed| — and it
 * asserted the opposite direction from the defect (a population strictly smaller than the dressed
 * count IS the SS7j gap). Its vacuity intent (the population must not drift from what ships) is
 * preserved as `toBe(dressed.length)`: the population must equal the dressed count.
 *
 * All seven BASELINE rows were measured on the shipped bytes, not copied (kevin's cuff reach moved
 * -279.2 -> -308.2 with the scrub_pants re-dress). None of the four newly covered actors fails the
 * interpenetration measure: nurse, physician, partner and parent all have no trouser/footwear
 * overlap (low footwear), and kevin's overlap is consistent (boot outside trouser).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const DIR = process.env.OPENCLINXR_GATE_PROBE_DIR ?? join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids");
const GATE_SRC = join(HERE, "overlapping-garments-do-not-interpenetrate.test.ts");

/** The three the gate names today. The population may grow; it may not shrink below these. */
const CURRENTLY_NAMED = ["mpfb-ob-patient-aisha", "mpfb-peds-nurse-kevin", "mpfb-peds-patient-child"];

type Dressed = { id: string; lowerTris: number; footwearTris: number };

function gateActors(): string[] {
  const src = readFileSync(GATE_SRC, "utf8");
  const block = /const ACTORS\s*=\s*\[([\s\S]*?)\]/u.exec(src)?.[1] ?? "";
  return [...block.matchAll(/"([^"]+)"/gu)].map((m) => m[1]!);
}

async function dressedActors(): Promise<Dressed[]> {
  if (!existsSync(DIR)) return [];
  const io = new NodeIO();
  const out: Dressed[] = [];
  for (const f of readdirSync(DIR).filter((x) => x.startsWith("mpfb-") && x.endsWith(".glb")).sort()) {
    const doc = await io.read(join(DIR, f));
    let lowerTris = 0;
    let footwearTris = 0;
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const name = prim.getMaterial()?.getName() ?? "";
        const tris = Math.round((prim.getIndices()?.getCount() ?? 0) / 3);
        // The garment CLASS, not one id — naming one id is how this went stale (§8b: cap the class).
        if (/(cargo|scrub|trouser)_pants/iu.test(name)) lowerTris += tris;
        if (/footwear/iu.test(name)) footwearTris += tris;
      }
    }
    if (lowerTris > 0 && footwearTris > 0) out.push({ id: f.replace(/\.glb$/u, ""), lowerTris, footwearTris });
  }
  return out;
}

const dressed = await dressedActors();
const actors = gateActors();

/**
 * An empty enumeration must FAIL, never pass vacuously (§7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireDressed(): Dressed[] {
  expect(dressed.length, `shipped mpfb assets with a lower garment AND footwear under ${DIR}`).toBeGreaterThanOrEqual(6);
  expect(actors.length, "actors named by the interpenetration gate").toBeGreaterThan(0);
  return dressed;
}

describe("the garment gate measures every dressed actor", () => {
  it("(1) RED: every shipped dressed actor is in the interpenetration gate's population", () => {
    const missing = requireDressed().filter((d) => !actors.includes(d.id));
    expect(
      missing.map((d) => `${d.id} (lower ${d.lowerTris}t, footwear ${d.footwearTris}t)`),
      `the gate names ${actors.length} actors; ${dressed.length} shipped assets carry both garments`,
    ).toEqual([]);
  });

  it("(2) COUNTERWEIGHT: the gate's population may grow but never shrink", () => {
    // Refuses (b). Deleting kevin from ACTORS greens the red gate in one line and stops watching the
    // actor whose wardrobe just changed — the opposite of what the red is telling us.
    for (const id of CURRENTLY_NAMED) {
      expect(actors, `${id} was named by the gate on 2026-08-14 and must stay named`).toContain(id);
    }
  });

  it("(3) VACUITY GUARD: the population spans both lower-garment ids today", () => {
    // If every actor wore the same trousers, a selector naming one id would look fine forever.
    expect(requireDressed().length, "dressed actors").toBeGreaterThanOrEqual(6);
    // CORRECTED (#408): the planted `toBeLessThan(dressed.length)` is unsatisfiable alongside
    // (1) — (1) requires every dressed actor to be IN the gate population, so |population| >=
    // |dressed|, while (3) demanded |population| < |dressed|. It also asserts the OPPOSITE
    // direction from the defect: a population strictly smaller than the dressed count is exactly
    // the SS7j gap this contract exists to refuse. The vacuity it guards — the population must
    // not drift from what ships — is preserved: the population must EQUAL the dressed count.
    expect(actors.length, "gate population size").toBe(dressed.length);
  });
});
