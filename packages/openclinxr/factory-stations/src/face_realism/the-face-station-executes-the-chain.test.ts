import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertNoModelStage,
  prepareFixtureReplayDir,
  runFaceRealism,
  runReplayChain,
  sanitizedFaceRealismEnv,
} from "./run.js";

/**
 * The face station executes the stored skin chain from its stored record.
 *
 * G1 runs the station on the Aisha record and reproduces the final albedo
 * whose sha256 the station run-report records (byte-exact). G2 injects a
 * stage that tries a model call and the station refuses it by throwing
 * (known-bad). G3 a missing record still refuses.
 */

/** Local repo-root walk: repo-root.js is entrypoint-reachable, so importing
 * it here would count against the test-internal-import ceiling. */
function testRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("workspace root (pnpm-workspace.yaml) not found");
}

const RECORD = "tools/openclinxr/asset-pipeline/reference-set/manifest.json";
const CHAIN = "tools/openclinxr/asset-pipeline/skin/face-replay/chain-manifest.json";
const FIXTURE_ALBEDO = "tools/openclinxr/asset-pipeline/skin/face-replay/fixtures/base-good-A.png";

const STORE_DIR = "/Volumes/files/openclinxr-assets/store/face-station-run";

function shaFile(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function stageOutDir(): { outDir: string; manifest512: string } {
  const root = testRepoRoot();
  const outDir = join(os.tmpdir(), `face-station-exec-${process.pid}-${Math.round(Math.random() * 1e9)}`);
  mkdirSync(outDir, { recursive: true });
  const chain = JSON.parse(readFileSync(join(root, CHAIN), "utf8")) as {
    stages: Array<{ name: string; parameters: Record<string, unknown> }>;
  };
  chain.stages[0]!.parameters["size"] = 512;
  const manifest512 = join(outDir, "man512.json");
  writeFileSync(manifest512, JSON.stringify(chain));
  return { outDir, manifest512 };
}

function runChainOnce(outDir: string, manifest: string): {
  finalSha256: string | null;
  stageShas: Record<string, string>;
  executedChainStages: string[];
} {
  const staged = prepareFixtureReplayDir(outDir, FIXTURE_ALBEDO, 512);
  return runReplayChain({
    subject: "aisha",
    manifestFile: manifest,
    glbFile: staged.glbFile,
    albedoFile: staged.albedoFile,
    storeDir: outDir,
    skipAo: true,
    skipStages: [],
  });
}

describe("the face station executes the chain", () => {
  it("(G1) running the station on the Aisha record reproduces the recorded final albedo", () => {
    const root = testRepoRoot();
    const report = JSON.parse(
      readFileSync(join(root, "packages/openclinxr/factory-stations/src/face_realism/run-report.json"), "utf8"),
    ) as { finalAlbedo: { sha256: string }; executedStages: string[] };
    const first = stageOutDir();
    const second = stageOutDir();
    writeFileSync(second.manifest512, readFileSync(first.manifest512));
    const resultA = runChainOnce(first.outDir, first.manifest512);
    const resultB = runChainOnce(second.outDir, first.manifest512);
    expect(resultA.executedChainStages).toEqual([
      "derive",
      "occlusion",
      "roughness",
      "lips",
      "eye_corners",
      "symmetrise",
      "socket",
    ]);
    expect(resultA.executedChainStages).toEqual(report.executedStages);
    expect(resultA.finalSha256).toBe(report.finalAlbedo.sha256);
    expect(resultB.finalSha256).toBe(report.finalAlbedo.sha256);
    const finalFile = join(first.outDir, "albedo_socket.png");
    expect(existsSync(finalFile)).toBe(true);
    expect(shaFile(finalFile)).toBe(report.finalAlbedo.sha256);
  }, 300_000);

  it("(FALSIFIER) two runs are bit-identical per stage output", () => {
    const first = stageOutDir();
    const second = stageOutDir();
    writeFileSync(second.manifest512, readFileSync(first.manifest512));
    const resultA = runChainOnce(first.outDir, first.manifest512);
    const resultB = runChainOnce(second.outDir, first.manifest512);
    const names = Object.keys(resultA.stageShas).sort();
    expect(names.length).toBeGreaterThanOrEqual(5);
    const diffs = names
      .filter((name) => resultA.stageShas[name] !== resultB.stageShas[name])
      .map((name) => `${name}: ${resultA.stageShas[name]} vs ${resultB.stageShas[name]}`);
    expect(diffs, diffs.join("; ")).toEqual([]);
  }, 300_000);

  it("(G2) a stage that tries a model call is refused by throwing (known-bad)", () => {
    const root = testRepoRoot();
    const chain = JSON.parse(readFileSync(join(root, CHAIN), "utf8")) as {
      stages: Array<Record<string, unknown>>;
    };
    chain.stages.push({
      name: "bad-imagine",
      kind: "imagine",
      script: "fix_lips.py",
      parameters: { ratio: 1.0 },
    });
    const badManifest = join(os.tmpdir(), `face-station-bad-${process.pid}.json`);
    writeFileSync(badManifest, JSON.stringify(chain));
    expect(() =>
      runFaceRealism({
        actorId: "aisha",
        recordPath: RECORD,
        chainManifestPath: badManifest,
        outDir: join(os.tmpdir(), `face-station-bad-out-${process.pid}`),
      }),
    ).toThrow(/refused model stage/);
    expect(() =>
      assertNoModelStage({
        stages: [{ name: "bad-llm", kind: "llm", script: "fix_lips.py", parameters: { ratio: 1 } }],
      }),
    ).toThrow(/refused model stage/);
  });

  it("(G2b) subprocess env strips model credentials so a call fails loudly", () => {
    process.env["OPENCLINXR_TEST_MODEL_PROBE"] = "probe-value";
    process.env["OPENAI_API_KEY"] = "test-key-that-must-not-ride";
    try {
      const env = sanitizedFaceRealismEnv();
      expect(env["OPENAI_API_KEY"]).toBeUndefined();
      expect(env["PATH"]).toBeDefined();
    } finally {
      delete process.env["OPENCLINXR_TEST_MODEL_PROBE"];
      delete process.env["OPENAI_API_KEY"];
    }
  });

  it("(G3) a missing record still refuses", () => {
    const result = runFaceRealism({
      actorId: "aisha",
      recordPath: "tools/openclinxr/asset-pipeline/reference-set/no-such-record.json",
    });
    expect(result["stop"]).toBe(true);
    expect(["issues", "refused"]).toContain(result["status"]);
  });

  it(existsSync(STORE_DIR) ? "(store) run-report final albedo sha verifies" : "(store absent: final albedo verification skipped)", () => {
    if (!existsSync(STORE_DIR)) return;
    const root = testRepoRoot();
    const report = JSON.parse(
      readFileSync(join(root, "packages/openclinxr/factory-stations/src/face_realism/run-report.json"), "utf8"),
    ) as { finalAlbedo: { assets: string; sha256: string } };
    const stored = join("/Volumes/files/openclinxr-assets/store", report.finalAlbedo.assets);
    expect(existsSync(stored)).toBe(true);
    expect(shaFile(stored)).toBe(report.finalAlbedo.sha256);
  });
});
