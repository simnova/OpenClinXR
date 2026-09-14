import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bakeProducedHumanoidAlbedo } from "./bake-produced-humanoid.js";

/**
 * The albedo bake station has no caller, so any re-fit ships unbaked.
 *
 * THE STATION ADMITS IT ITSELF. bake-humanoid-albedo.ts:378 writes into its own report:
 *
 *     "how a regenerated body gets baked: no caller wires this station after materialize yet"
 *
 * MEASURED 2026-09-14 on origin/main at 447837f2:
 *   body-param-cli.ts (1,539 lines, writes the shipped GLBs)  ZERO references to the bake station
 *   package.json                                              no script invokes it
 *   .github/workflows                                         no workflow references it
 *   tools/openclinxr/dark-factory, tools/openclinxr/factory    no reference to either
 *   every reference to bake-humanoid-albedo                   its own file, two humanoid-vetting
 *                                                             tests, and provenance sidecars
 *
 * THE CONSEQUENCE IS LIVE, not hypothetical. Three shipped bodies carry unbaked palette factors on
 * mat_makeclothes_library_toigo_t_shirt, and they arrived by TWO INDEPENDENT re-fit chains:
 *   mpfb-ob-patient-aisha.glb      [0.34, 0.44, 0.34]  tightjeans chain (57e27730 .. 2803b774)
 *   mpfb-peds-parent-aisha.glb     [0.62, 0.28, 0.38]  tightjeans chain
 *   mpfb-family-partner-adult.glb  [0.62, 0.28, 0.38]  bootcut mhclo re-fit (13a94960, 0f460d09)
 * The other seven baked bodies are clean. Two unrelated paths produced the same rot, because ANY
 * re-fit changes materials and nothing re-bakes afterwards.
 *
 * Diagnosis IMMUTABLE. Flip `it.fails` -> `it` and append ## FIXED. Do not rewrite this header's
 * measured paths, commits or factors.
 *
 * live: is valid here (raw it.fails, no helper indirection).
 *
 * WHY ONE RED AND NOT TWO. The card permits either wiring: a call from the producing path, or an
 * explicit composite step that path's own declared command resolves to. Two separate it.fails would
 * make `live:` unsatisfiable, because fixing one route would leave the other red forever. Clause (1)
 * therefore accepts EITHER route and fails only while NEITHER holds.
 */

const REPO = path.resolve(import.meta.dirname, "../../../..");
const GENERATOR = path.join(REPO, "tools/openclinxr/asset-pipeline/makeclothes/body-param-cli.ts");
const STATION = path.join(REPO, "tools/openclinxr/asset-pipeline/trellis/bake-humanoid-albedo.ts");
const HUMANOIDS = path.join(REPO, "apps/ui-xr/public/generated-humanoids");
const STATION_MODULE = "bake-humanoid-albedo";

/** Bodies measured unbaked on 2026-09-14; the fix must reach these, not merely mention the station. */
const UNBAKED_BODIES = [
  "mpfb-ob-patient-aisha.glb",
  "mpfb-peds-parent-aisha.glb",
  "mpfb-family-partner-adult.glb",
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

function texturedNonWhite(glb: string): number {
  const b = readFileSync(glb);
  const len = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + len).toString("utf8")) as {
    materials?: Array<{ name?: string; pbrMetallicRoughness?: { baseColorTexture?: unknown; baseColorFactor?: unknown } }>;
  };
  let n = 0;
  for (const mat of json.materials ?? []) {
    const pbr = mat.pbrMetallicRoughness;
    if (pbr?.baseColorTexture === undefined) continue;
    if (String(mat.name ?? "").startsWith("openclinxr_hidden_")) continue;
    const f = pbr.baseColorFactor;
    if (Array.isArray(f) && !(f as number[]).slice(0, 3).every((c) => c === 1)) n += 1;
  }
  return n;
}

function namedTexturedFactor(glb: string, materialName: string): number[] | undefined {
  const b = readFileSync(glb);
  const len = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + len).toString("utf8")) as {
    materials?: Array<{ name?: string; pbrMetallicRoughness?: { baseColorTexture?: unknown; baseColorFactor?: unknown } }>;
  };
  const mat = (json.materials ?? []).find((m) => m.name === materialName);
  const pbr = mat?.pbrMetallicRoughness;
  if (pbr?.baseColorTexture === undefined) return undefined;
  const f = pbr.baseColorFactor;
  return Array.isArray(f) ? (f as number[]).slice(0, 3) : undefined;
}

const SHIRT = "mat_makeclothes_library_toigo_t_shirt";
/** PNG t-shirt, no JPEG; the aisha pair carry tightjeans-2048-q85 (image/jpeg) which this card must not transcode. */
const COUNTERWEIGHT_BODY = "mpfb-family-partner-adult.glb";

describe("the regenerated humanoid reaches the bake", () => {
  it("(0) VACUITY: the generator, the station and the measured bodies all exist", () => {
    expect(existsSync(GENERATOR), `missing generator: ${GENERATOR}`).toBe(true);
    expect(existsSync(STATION), `missing station: ${STATION}`).toBe(true);
    expect(readFileSync(STATION, "utf8"), "station no longer exports bakeGlbAlbedo").toMatch(
      /export function bakeGlbAlbedo\(/u,
    );
    for (const body of UNBAKED_BODIES) {
      expect(existsSync(path.join(HUMANOIDS, body)), `missing body: ${body}`).toBe(true);
    }
  });

  it("(1) RED: the producing path reaches the bake station, by import closure OR by its declared command", () => {
    const closure = importClosure(GENERATOR);
    const byImport = [...closure].some((f) => path.basename(f).startsWith(STATION_MODULE));
    // body-param-cli.ts:71 declares PRODUCED_BY_COMMAND = "pnpm asset:body-param:fit -- --once".
    const byScript = scriptChainReachesStation("asset:body-param:fit");
    expect(
      byImport || byScript,
      `the bake station is unreachable from the path that produces a body. Static import closure of ` +
        `body-param-cli.ts covers ${closure.size} file(s) and contains no ${STATION_MODULE}; the ` +
        `script chain from its own declared command (asset:body-param:fit) never mentions it either. ` +
        `So a re-fit ships unbaked, which is why ${UNBAKED_BODIES.length} shipped bodies carry ` +
        `non-white palette factors today.`,
    ).toBe(true);
  });

  /*
   * ## FIXED (tsk_7be8f259400354d3)
   * Wiring chosen: direct call from the generation path.
   * body-param-cli.ts imports bake-produced-humanoid.ts, which calls bakeGlbAlbedo
   * after destDisk is finished (footwear + hair), before sha256/catalog stamp.
   * Import closure now includes bake-humanoid-albedo.ts. Not a composite pnpm script:
   * a second command is what humans forget, which is the defect.
   *
   * ## FIXED (tsk_2cdb306c4e7069af)
   * The three measured bodies are baked: mpfb-family-partner-adult.glb,
   * mpfb-peds-parent-aisha.glb and mpfb-ob-patient-aisha.glb each ran through
   * the producer-path station (bakeProducedHumanoidAlbedo on the shipped bytes),
   * and their toigo t-shirt factors now read [1,1,1] with the colour folded into
   * the 2048x2048 texture. Clause (2) is re-pointed at the new evidence: it
   * asserts the three bodies are baked (zero textured non-white materials) and
   * the station entry point is still whole.
   */

  it("(2) COUNTERWEIGHT: the three measured bodies are baked, and the station is still whole", () => {
    // This passes TODAY and states what must remain true of the FIX. It exists so clause (1) cannot
    // be satisfied destructively: deleting the station, gutting bakeGlbAlbedo, or deleting the three
    // bodies would each make a naive wiring assertion pass while destroying the capability.
    // RESTORATION if this ever fails: bakeGlbAlbedo(input, output) must still exist in
    // bake-humanoid-albedo.ts and the three bodies must still ship. Widening or deleting this clause
    // is the wrong repair.
    expect(readFileSync(STATION, "utf8")).toMatch(/export function bakeGlbAlbedo\(input: string, output: string\)/u);
    let totalNonWhite = 0;
    for (const body of UNBAKED_BODIES) totalNonWhite += texturedNonWhite(path.join(HUMANOIDS, body));
    expect(
      totalNonWhite,
      "the three measured bodies carry non-white textured factors again — the 2026-09-12 " +
        "overwrite has recurred, or a re-fit shipped without the producer-path bake.",
    ).toBe(0);
    for (const body of UNBAKED_BODIES) {
      expect(
        namedTexturedFactor(path.join(HUMANOIDS, body), SHIRT),
        `${body} ${SHIRT} should carry a white factor after the tsk_2cdb306c4e7069af bake`,
      ).toEqual([1, 1, 1]);
    }
  });

  it("(3) COUNTERWEIGHT RUNS: the station still bakes a non-white t-shirt factor to white on a copy", () => {
    // Re-pointed by tsk_2cdb306c4e7069af: family-partner is baked now, so the run-proof
    // restores the pre-fix bytes into a temp copy and bakes the COPY. The shipped body
    // is never dirtied; the station entry point and the fold are still exercised on
    // every run.
    // The pre-fix bytes come from main at 92faf9b8, pinned explicitly. HEAD is the
    // wrong source: the tsk_2cdb306c4e7069af rebake landed there, so HEAD now holds
    // baked bytes and the vacuity guard below would fire on a copy with nothing to
    // fold. A later rebake must not break this clause again, hence the pinned commit.
    const PRE_FIX_COMMIT = "92faf9b8";
    const src = path.join(HUMANOIDS, COUNTERWEIGHT_BODY);
    const tmp = mkdtempSync(path.join(os.tmpdir(), "openclinxr-bake-caller-"));
    const dest = path.join(tmp, COUNTERWEIGHT_BODY);
    try {
      const preFix = execFileSync("git", ["show", `${PRE_FIX_COMMIT}:${path.relative(REPO, src)}`], {
        cwd: REPO,
        maxBuffer: 64 * 1024 * 1024,
      });
      writeFileSync(dest, preFix);
      const before = namedTexturedFactor(dest, SHIRT);
      expect(before, `${COUNTERWEIGHT_BODY} ${SHIRT} has no textured factor`).toBeDefined();
      expect(
        texturedNonWhite(dest),
        `${COUNTERWEIGHT_BODY} pre-fix copy has zero textured non-white materials — would pass on an untextured body`,
      ).toBeGreaterThan(0);
      const row = bakeProducedHumanoidAlbedo(dest);
      const after = namedTexturedFactor(dest, SHIRT);
      const bakedShirt = row.materials.find((m) => m.material === SHIRT);
      expect(bakedShirt?.decision.startsWith("baked"), `station did not bake ${SHIRT}: ${bakedShirt?.decision}`).toBe(
        true,
      );
      expect(
        after,
        `${SHIRT} factor after bake. before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
      ).toEqual([1, 1, 1]);
      expect(before, "before factor must stay non-white so this is not a no-op").not.toEqual([1, 1, 1]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 120_000);
});
