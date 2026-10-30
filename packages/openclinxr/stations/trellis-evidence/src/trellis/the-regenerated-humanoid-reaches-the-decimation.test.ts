import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The face-preserving decimation station has no caller, so any re-fit ships undecimated.
 *
 * THIS IS THE SURVIVING HALF OF tsk_7be8f259400354d3. That card wired the ALBEDO BAKE station into
 * the producing path and recorded, in its own notTested block, the question it did not answer:
 *
 *     "whether the vr-postopt decimation station HB-03 landed has the same unwired gap"
 *
 * THE QUESTION NAMED THE WRONG STATION, and this header records that rather than repeating it.
 * Measured 2026-09-14 from the reports the work itself produced:
 *
 *   docs/openclinxr/humanoid-postopt-ladder-2026-09-10.json          ladderSource vr-postopt-ladder.ts   (HB-03)
 *   docs/openclinxr/humanoid-postopt-ladder-face-preserving-...json  ladderSource iterate-optimize.ts    (HB-05)
 *
 * HB-05 SUPERSEDED HB-03 AND IS THE ONE THAT REWROTE THE LIVE BYTES. Four shipped bodies carry
 * provenance sidecars naming iterate-optimize.ts — mpfb-ob-patient-aisha, mpfb-peds-parent-aisha,
 * mpfb-peds-nurse-kevin and mpfb-gown-inspect. vr-postopt-ladder.ts exports NOTHING (it is a bare
 * `#!/usr/bin/env tsx` CLI with a main(), and the only other file mentioning it reads its source as
 * TEXT to regex RATIOS out). Wiring that station would have wired a tool that no longer decimates
 * humanoids. The subject here is therefore iterate-optimize.ts.
 *
 * THE GAP, measured on origin/main at 56a77dad:
 *   body-param-cli.ts references "iterate-optimize"   0
 *   body-param-cli.ts references "face-preserving"    0
 *   pnpm scripts reaching it                          factory:trellis:optimize, a bare manual
 *                                                     invocation that chains to nothing
 *   iterate-optimize.ts exported entry points         facePreservingRungIds, facePreservingError,
 *                                                     countFaceTris, writeFacePreservingRung
 *
 * So the station IS importable, unlike the one the inherited question named, and nothing imports it
 * from the path that produces a body. This is the same shape the albedo bake had before
 * tsk_7be8f259400354d3: a proven station with no caller, and a producing path that silently omits it.
 *
 * Diagnosis IMMUTABLE. Flip `it.fails` -> `it` and append ## FIXED. Do not rewrite this header's
 * measured paths, counts or ladderSource values.
 *
 * live: is valid here (raw it.fails, no helper indirection).
 *
 * WHY ONE RED AND NOT TWO. Either wiring is acceptable — a call from the producing path, or a
 * composite step that path's own declared command resolves to. Two separate it.fails would make
 * `live:` permanently unsatisfiable, because fixing one route would leave the other red forever.
 * Clause (1) accepts EITHER and fails only while NEITHER holds.
 */

const REPO = repoRoot();
const GENERATOR = path.join(REPO, "tools/openclinxr/asset-pipeline/makeclothes/body-param-cli.ts");
const STATION = path.join(REPO, "tools/openclinxr/asset-pipeline/trellis/iterate-optimize.ts");
const HUMANOIDS = path.join(REPO, "apps/ui-xr/public/generated-humanoids");
const STATION_MODULE = "iterate-optimize";

/** SC-04 licence-correction commit (fix #741, 2026-09-28): its diff on
 *  mpfb-peds-parent-aisha.provenance.json replaced the byteLineage block that
 *  cited `iterate-optimize.ts --face-preserving` with the SC-04 correction
 *  stamp (correctedBy correct-sidecar-byte-lineage.ts, correctedAt
 *  2026-09-28T04:07:11Z, why fix(#741)). Full hash so the tie below resolves
 *  to exactly one commit. */
const CORRECTION_COMMIT = "9f2934536de8b011a894036e5dcd7212594804b1";
const CORRECTION_TOOL = "correct-sidecar-byte-lineage.ts (SC-04)";

/** Fail-closed per-body check shared by clause (2) and the known-bad fixture. */
function sidecarCarriesDecimationOrCorrection(body: string, text: string): void {
  if (text.includes(STATION_MODULE)) return;
  // No iterate-optimize link: accept ONLY the SC-04 superseding lineage —
  // the correction tool stamp plus the #741 correction note, byte-identical
  // to the stamp the licence-correction commit installed on this sidecar.
  // Anything naming neither the station nor the correction still fails.
  const doc = JSON.parse(text) as { byteLineage?: { correctedBy?: string; correctedAt?: string; why?: string } };
  expect(
    String(doc.byteLineage?.correctedBy ?? ""),
    `${body} provenance names neither ${STATION_MODULE} nor the SC-04 correction tool`,
  ).toContain(CORRECTION_TOOL);
  expect(
    String(doc.byteLineage?.why ?? ""),
    `${body} lineage cites the tool but not the #741 licence correction`,
  ).toContain("fix(#741)");
  const sidecarRel = path.join("apps/ui-xr/public/generated-humanoids", body.replace(/\.glb$/u, ".provenance.json"));
  const atCorrection = JSON.parse(
    execFileSync("git", ["show", `${CORRECTION_COMMIT}:${sidecarRel}`], {
      cwd: REPO,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }),
  ) as { byteLineage?: { correctedAt?: string } };
  expect(
    doc.byteLineage?.correctedAt,
    `${body} lineage stamp must be the stamp ${CORRECTION_COMMIT.slice(0, 9)} installed`,
  ).toBe(atCorrection.byteLineage?.correctedAt);
}

/** Bodies whose provenance sidecars name iterate-optimize.ts, so the station demonstrably ran on them. */
const DECIMATED_BODIES = [
  "mpfb-ob-patient-aisha.glb",
  "mpfb-peds-parent-aisha.glb",
  "mpfb-peds-nurse-kevin.glb",
  "mpfb-gown-inspect.glb",
] as const;

/** Static relative-import closure from an entry file, bounded so a cycle cannot hang the suite. */
function importClosure(entry: string, maxFiles = 400): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0 && seen.size < maxFiles) {
    const file = queue.shift();
    if (file === undefined || seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/from\s+["'](\.[^"']+)["']/gu)) {
      const spec = m[1];
      if (spec === undefined) continue;
      const base = path.resolve(path.dirname(file), spec.replace(/\.js$/u, ""));
      for (const cand of [`${base}.ts`, `${base}.mts`, path.join(base, "index.ts")]) {
        if (existsSync(cand)) {
          queue.push(cand);
          break;
        }
      }
    }
  }
  return seen;
}

/** Does any package.json script chain, starting from `script`, mention the station? */
function scriptChainReachesStation(script: string): boolean {
  const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const scripts = pkg.scripts ?? {};
  const seen = new Set<string>();
  const queue = [script];
  while (queue.length > 0) {
    const name = queue.shift();
    if (name === undefined || seen.has(name)) continue;
    seen.add(name);
    const body = scripts[name];
    if (body === undefined) continue;
    if (body.includes(STATION_MODULE)) return true;
    for (const m of body.matchAll(/(?:pnpm|npm)\s+run\s+([A-Za-z0-9:_-]+)/gu)) {
      if (m[1] !== undefined) queue.push(m[1]);
    }
  }
  return false;
}

describe("the regenerated humanoid reaches the decimation", () => {
  it("(0) VACUITY: the generator, the station and the decimated bodies all exist", () => {
    expect(existsSync(GENERATOR), `missing generator: ${GENERATOR}`).toBe(true);
    expect(existsSync(STATION), `missing station: ${STATION}`).toBe(true);
    const station = readFileSync(STATION, "utf8");
    expect(station, "station no longer exports writeFacePreservingRung").toMatch(
      /export async function writeFacePreservingRung\(/u,
    );
    for (const body of DECIMATED_BODIES) {
      expect(existsSync(path.join(HUMANOIDS, body)), `missing body: ${body}`).toBe(true);
    }
  });

  // MEASURED as a plain `it(` on 2026-09-14 before being marked: 1 failed | 2 passed (3), the
  // failure reading "Static import closure of body-param-cli.ts covers 9 file(s) and contains no
  // iterate-optimize" — the defect itself, not a missing file and not an import error. The closure
  // is 9 rather than the 7 tsk_7be8f259400354d3 recorded because its own albedo wiring now sits
  // inside it; the decimation station still does not.
  //
  // ## FIXED (bothy-tsk_a5fd3338ced67133): wired as a direct producer-path call —
  // body-param-cli.ts imports decimateProducedHumanoid from
  // decimate-produced-humanoid.ts (which invokes writeFacePreservingRung from
  // iterate-optimize.ts) and awaits it immediately after bakeProducedHumanoidAlbedo,
  // before the sha256/catalog stamp. Import closure now reaches the station.
  it("(1) RED: the producing path reaches the decimation station, by import closure OR by its declared command", () => {
    const closure = importClosure(GENERATOR);
    const byImport = [...closure].some((f) => path.basename(f).startsWith(STATION_MODULE));
    // body-param-cli.ts declares PRODUCED_BY_COMMAND = "pnpm asset:body-param:fit -- --once".
    const byScript = scriptChainReachesStation("asset:body-param:fit");
    expect(
      byImport || byScript,
      `the face-preserving decimation station is unreachable from the path that produces a body. `
        + `Static import closure of body-param-cli.ts covers ${closure.size} file(s) and contains no `
        + `${STATION_MODULE}; the script chain from its own declared command (asset:body-param:fit) `
        + `never mentions it either. The only script that reaches it is factory:trellis:optimize, a `
        + `bare manual invocation. So a re-fit ships UNDECIMATED, exactly as re-fits shipped unbaked `
        + `before tsk_7be8f259400354d3 wired the albedo station.`,
    ).toBe(true);
  });

  it("(2) COUNTERWEIGHT: the station is still whole and the decimated bodies still carry its provenance", () => {
    // This passes today and MUST keep passing. Clause (1) could otherwise be satisfied destructively:
    // deleting the station, gutting its exports, or deleting the bodies would each make a naive
    // reachability assertion pass while destroying the capability. Restoration: iterate-optimize.ts
    // must keep exporting writeFacePreservingRung, facePreservingRungIds and facePreservingError,
    // and the four bodies above must keep provenance sidecars naming the station —
    // EXCEPT mpfb-peds-parent-aisha, whose SC-04 licence correction (9f2934536,
    // fix #741, 2026-09-28) deliberately superseded the iterate-optimize link
    // with the correction stamp. A lineage naming neither still fails.
    const station = readFileSync(STATION, "utf8");
    for (const entry of ["writeFacePreservingRung", "facePreservingRungIds", "facePreservingError"] as const) {
      expect(station, `station no longer exports ${entry}`).toContain(`export `);
      expect(station, `station no longer exports ${entry}`).toContain(entry);
    }
    for (const body of DECIMATED_BODIES) {
      const sidecar = path.join(HUMANOIDS, body.replace(/\.glb$/u, ".provenance.json"));
      expect(existsSync(sidecar), `missing provenance sidecar: ${sidecar}`).toBe(true);
      sidecarCarriesDecimationOrCorrection(body, readFileSync(sidecar, "utf8"));
    }
  });

  it("(2b) known-bad: a provenance naming neither the station nor the correction is rejected", () => {
    const stripped = JSON.stringify({
      schemaVersion: "openclinxr.generated-humanoid-provenance.v1",
      byteLineage: {
        correctedBy: "hand edit",
        correctedAt: "2026-10-30T00:00:00Z",
        why: "no station and no licence correction ran here",
      },
    });
    expect(() => sidecarCarriesDecimationOrCorrection("mpfb-peds-parent-aisha.glb", stripped)).toThrow();
  });
});
