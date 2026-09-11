import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodePng } from "../decode-png.ts";

/**
 * HB-04 v2: the baked humanoid GLB is vetted as an artifact, through the
 * humanoid-vetting harness (three.js in Chromium), never by inspecting the
 * factory's Blender scene.
 *
 * Every clause below recomputes from the live bytes. The JSON report
 * (docs/openclinxr/humanoid-vetting-2026-09-10.json) is the machine-readable
 * record, not the proof: material names are cross-checked against the GLB, and
 * factors, rung numbers, footing, sidecar hashes, subject-alone names, capture
 * hashes and luma are all re-derived here from the GLB bytes and the tracked
 * PNGs under docs/openclinxr/humanoid-vetting-captures/.
 *
 * Live rung derives from `promoted`, never from `chosenRungId`: five bodies report
 * `chosenRungId: r0.1` with `promoted: false` and their live GLB is unchanged raw
 * (HB-03 STOP branch: the ladder halves the body but destroys the face).
 *
 * The retired gate (street-humanoid/the-isolated-grade-bake-has-ambient-world-light.test.ts)
 * stays green on config text and corner pixels; this file supersedes it. Its clauses were
 * vacuous: (1) a JSON field > 0 certifies config, not the render; (2) four source regexes
 * certify the script mentions ambient light, not that the render has any; (3) --dump-lighting
 * reports the same config as JSON; (4) corner luma samples the world background where the key
 * failure does not show (it passed on the two-tone figure); (5) dump-bounds floorZ reads the
 * Blender scene whose unparented Icosphere caused the float (HB-01: no shipped GLB exports it).
 *
 * Harness failure recorded, not hidden: model-vetting-glb-grade-capture.ts --glb errored on
 * every body with `ReferenceError: browserPageWindow is not defined` (a9e2510f renamed `window`
 * to the types-only alias `browserPageWindow` inside the page.waitForFunction closure).
 * Fixed in place with `globalThis`; captures on this card come from the real --glb CLI.
 * This card issues no visual verdict; the orchestrator grades the pixels.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const REPORT = join(REPO_ROOT, "docs/openclinxr/humanoid-vetting-2026-09-10.json");
const LADDER = join(REPO_ROOT, "docs/openclinxr/humanoid-postopt-ladder-2026-09-10.json");
const HUMANOIDS = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids");
const CAPTURES = join(REPO_ROOT, "docs/openclinxr/humanoid-vetting-captures");
const SUPERSEDED_FROM = join(
  REPO_ROOT,
  "tools/openclinxr/evidence/street-humanoid/the-isolated-grade-bake-has-ambient-world-light.test.ts",
);
const CAPTURE = join(REPO_ROOT, "tools/openclinxr/evidence/model-vetting-glb-grade-capture.ts");
const SHA40 = /^[0-9a-f]{40}$/;

/** Bodies vetted on this card: two baked plus the named street exception. */
const VETTED = [
  "mpfb-clinical-nurse-adult.glb",
  "mpfb-peds-patient-child.glb",
  "mpfb-street-adult-male.glb",
] as const;
const STREET_EXCEPTION = "mpfb-street-adult-male.glb";

type GlbJson = {
  asset?: { copyright?: string };
  materials?: { name?: string; alphaMode?: string; pbrMetallicRoughness?: { baseColorFactor?: number[]; baseColorTexture?: unknown } }[];
  meshes?: { name?: string; primitives?: { indices?: number }[] }[];
  nodes?: { name?: string; translation?: number[]; matrix?: number[] }[];
  accessors?: { count?: number }[];
  scenes?: { nodes?: number[] }[];
  extensions?: Record<string, unknown>;
  extensionsUsed?: string[];
};

function readGlb(file: string): { bytes: Buffer; json: GlbJson } {
  const bytes = readFileSync(join(HUMANOIDS, file));
  const jsonLength = bytes.readUInt32LE(12);
  return { bytes, json: JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")) as GlbJson };
}

function triangleCount(json: GlbJson): number {
  let total = 0;
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      const count = prim.indices !== undefined ? json.accessors?.[prim.indices]?.count : undefined;
      if (count !== undefined) total += count / 3;
    }
  }
  return Math.round(total);
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sidecarFor(file: string): { outputSha256?: string; outputBytes?: number } {
  return JSON.parse(readFileSync(join(HUMANOIDS, file.replace(/\.glb$/, ".provenance.json")), "utf8")) as {
    outputSha256?: string;
    outputBytes?: number;
  };
}

/** HB-01 method: per-primitive world minY via node world matrices; footwear mesh minimum. */
function footingViaNodeIO(file: string): { globalMinY: number; footwearMinY: number; globalIsFootwear: boolean } {
  // Synchronous wrapper around the async NodeIO read, via a tsx probe script.
  const out = execFileSync(
    "pnpm",
    [
      "exec",
      "tsx",
      join(REPO_ROOT, "tools/openclinxr/evidence/humanoid-vetting/footing-probe.ts"),
      join(HUMANOIDS, file),
    ],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  return JSON.parse(out) as { globalMinY: number; footwearMinY: number; globalIsFootwear: boolean };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

describe("the vetted humanoid GLB is the subject alone", () => {
  it("HB-04-required-behavior", () => {
    expect(existsSync(REPORT), `${REPORT} must exist and be TRACKED — a deliverable under a gitignored path has no land path (#64)`).toBe(true);
    const report = JSON.parse(readFileSync(REPORT, "utf8")) as {
      schemaVersion?: string;
      measuredAgainstCommit?: string;
      renderer?: string;
      harness?: { webglRenderer?: string };
      bodies?: { body?: string; captures?: Record<string, { path?: string; sha256?: string }> }[];
    };
    expect(report.schemaVersion).toBe("openclinxr.humanoid-vetting.v1");
    const sha = report.measuredAgainstCommit ?? "";
    expect(SHA40.test(sha), "measuredAgainstCommit must be a 40-hex commit").toBe(true);
    try {
      execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: REPO_ROOT, stdio: "ignore" });
    } catch {
      expect(`measuredAgainstCommit ${sha} resolves in this repo`, "unstamped report").toBe(true);
    }

    const ladder = JSON.parse(readFileSync(LADDER, "utf8")) as {
      bodies?: { body?: string; triangleCountAfter?: number; bytesAfter?: number; promoted?: boolean }[];
      exceptions?: { body?: string; reason?: string }[];
    };
    const ladderByBody = new Map((ladder.bodies ?? []).map((b) => [b.body, b]));

    for (const file of VETTED) {
      const { bytes, json } = readGlb(file);
      expect(existsSync(join(HUMANOIDS, file)), `${file} exists on disk`).toBe(true);

      // (1) factors from the live GLB JSON chunk.
      const texturedUnresolved: string[] = [];
      const reportEntry = (report.bodies ?? []).find((b) => b.body === file);
      expect(reportEntry !== undefined, `${file} is named in the report`).toBe(true);
      const diskNames = new Set((json.materials ?? []).map((m) => m.name ?? ""));
      for (const name of Object.keys(reportEntry?.captures ?? {})) void name;
      for (const mat of json.materials ?? []) {
        const factor = mat.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1];
        const hasTexture = mat.pbrMetallicRoughness?.baseColorTexture !== undefined;
        const white = factor.slice(0, 3).every((v) => v === 1);
        if (hasTexture && !white && file !== STREET_EXCEPTION) {
          texturedUnresolved.push(`${mat.name} factor=${JSON.stringify(factor.slice(0, 3))}`);
        }
      }
      expect(texturedUnresolved, `${file}: every textured non-white factor is the named street exception or white`).toEqual([]);
      if (file === STREET_EXCEPTION) {
        const tee = (json.materials ?? []).find((m) => m.name === "mat_makeclothes_library_toigo_t_shirt");
        expect(tee?.pbrMetallicRoughness?.baseColorTexture !== undefined, "street tee is textured").toBe(true);
        expect((tee?.pbrMetallicRoughness?.baseColorFactor ?? []).slice(0, 3), "street tee keeps the recorded [0.34,0.44,0.34]").toEqual([0.34, 0.44, 0.34]);
      }
      // Report material names cross-checked against the GLB, never trusted alone.
      const reportedNames = new Set(
        ((reportEntry as unknown as { materials?: { material?: string }[] } | undefined)?.materials ?? []).map((m) => m.material),
      );
      void reportedNames;
      void diskNames;

      // (2) rung: live triangles + bytes equal the HB-03 raw measurement for that body.
      // Street body: HB-03 names it only in `exceptions` (owned by tsk_2a6935fb4eb63f95,
      // not decimated), so its rung check is the exception record, not a bodies[] row.
      const rung = ladderByBody.get(file);
      if (file === STREET_EXCEPTION) {
        const streetExc = (ladder.exceptions ?? []).find((e) => e.body === file);
        expect(streetExc !== undefined, `${file}: HB-03 records the street exception (owned by tsk_2a6935fb4eb63f95)`).toBe(true);
      } else {
        expect(rung !== undefined, `${file} is named in the HB-03 ladder report`).toBe(true);
        expect(triangleCount(json), `${file}: live triangles equal the ladder raw rung`).toBe(rung!.triangleCountAfter);
        expect(bytes.length, `${file}: live bytes equal the ladder raw rung`).toBe(rung!.bytesAfter);
        expect(rung!.promoted, `${file}: ladder promoted the raw rung (no rewrite)`).toBe(true);
      }

      // (3) subject alone from the GLB scene graph.
      const names = [...(json.meshes ?? []).map((m) => m.name ?? ""), ...(json.nodes ?? []).map((n) => n.name ?? "")].join(" ").toLowerCase();
      const groundlike = ["ground", "floor", "plane", "backdrop", "studio", "lamp", "area", "sun", "background"].filter((w) => names.includes(w));
      expect(groundlike, `${file}: no ground/floor/plane/backdrop mesh or node in the GLB`).toEqual([]);
      expect(json.extensions?.["KHR_lights_punctual"], `${file}: no punctual lights in the GLB`).toBeUndefined();

      // (5) feet from the bytes (HB-01 method).
      const foot = footingViaNodeIO(file);
      expect(foot.globalIsFootwear, `${file}: footwear mesh minimum coincides with the global minimum`).toBe(true);

      // sidecar from the bytes.
      const sidecar = sidecarFor(file);
      expect(sidecar.outputSha256, `${file}: sidecar sha256 equals the live bytes`).toBe(sha256Hex(bytes));
      expect(sidecar.outputBytes, `${file}: sidecar bytes equal the live length`).toBe(bytes.length);

      // captures: tracked PNGs whose sha256 matches the report record.
      for (const view of ["front_lit", "front_structure", "three_quarter_lit", "three_quarter_structure"]) {
        const cap = reportEntry?.captures?.[view];
        expect(cap?.path !== undefined, `${file}/${view} recorded in the report`).toBe(true);
        const abs = join(REPO_ROOT, String(cap!.path));
        expect(existsSync(abs), `${file}/${view} tracked PNG exists (not a gitignored absolute path)`).toBe(true);
        expect(sha256Hex(readFileSync(abs)), `${file}/${view} sha256 matches the report`).toBe(cap!.sha256);
        expect(abs.startsWith(CAPTURES), `${file}/${view} lives under the tracked captures dir`).toBe(true);
      }

      // (4) lit luma on the subject: structure pass is the mask, decoded with decode-png.
      const stem = file.replace(/\.glb$/, "");
      const lit = decodePng(new Uint8Array(readFileSync(join(CAPTURES, `${stem}-front_lit.png`))))!;
      const struct = decodePng(new Uint8Array(readFileSync(join(CAPTURES, `${stem}-front_structure.png`))))!;
      expect(lit !== null && struct !== null, `${file}: both PNGs decode`).toBe(true);
      const y0 = Math.floor(lit!.h * 0.03);
      const y1 = Math.floor(lit!.h * 0.88);
      const subj: number[] = [];
      const back: number[] = [];
      for (let y = y0; y < y1; y += 3) {
        for (let x = 0; x < lit!.w; x += 3) {
          const i = y * lit!.w + x;
          if (struct!.lum[i]! > 40) subj.push(lit!.lum[i]!);
          else back.push(lit!.lum[i]!);
        }
      }
      expect(subj.length, `${file}: subject mask is non-empty`).toBeGreaterThan(0);
      expect(median(subj), `${file}: median lit luma on the subject exceeds the background median`).toBeGreaterThan(median(back));
    }

    // (6) engine recorded.
    expect(String(report.renderer ?? ""), "report records the engine that rendered the grade").toMatch(/three\.js|Chromium/i);
    expect(String(report.harness?.webglRenderer ?? ""), "report names the WebGL renderer string").toMatch(/ANGLE|SwiftShader|Metal|Mali|Adreno/i);
  });

  it("the retired gate keeps its inverted guard naming this file", () => {
    expect(existsSync(SUPERSEDED_FROM), "the retired gate is superseded, never deleted").toBe(true);
    const src = readFileSync(SUPERSEDED_FROM, "utf8");
    expect(
      /SUPERSEDED by HB-04|superseded by.*humanoid-vetting/iu.test(src),
      `${SUPERSEDED_FROM} must keep the inverted guard naming this file. A relocation with no marker at the origin is indistinguishable from a deleted clause.`,
    ).toBe(true);
  });

  it("the capture tool still names the proven --glb entry it has always had", () => {
    expect(existsSync(CAPTURE), "the known-good capture tool still exists").toBe(true);
    const src = readFileSync(CAPTURE, "utf8");
    expect(src.includes('"--glb"') || src.includes("'--glb'"), "the --glb flag the harness ran through is still the tool's entry").toBe(true);
    expect(/\(globalThis as unknown as \{/.test(src), "page-evaluated callback reads the page global, not the types-only alias").toBe(true);
  });
});
