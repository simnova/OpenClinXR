import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { planFaceRealism } from "@openclinxr/station-face-realism/runner";
import {
  FACE_REALISM_FIXTURE_ALBEDO_REL,
  planChainManifest,
  prepareFixtureReplayDir,
  runReplayChain,
  runStage3Chain,
} from "@openclinxr/station-face-realism/runner";

/**
 * The station runs every chain-manifest stage (card tsk_68c071233175cae2).
 *
 * Mechanism under test: stage 3 called runReplayChain with
 * stage3_skip_stages = ["beard_shadow"], so replay.py ran derive..socket
 * and then detail_bands on the SOCKET output; runBeardSubStage then wrote
 * albedo_beard.png from albedo_socket.png and stage 3 returned the beard
 * file as its final. The detail_bands product was discarded and the
 * manifest order beard_shadow -> detail_bands was not honoured.
 *
 * G1 runs the fixture-scale replay path from chain.ts (synthetic GLB,
 * flat AO, derive size 512): no Blender, no full chain. The small
 * manifests below are built from the tracked chain-manifest stage defs.
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

const CHAIN = "tools/openclinxr/asset-pipeline/skin/face-replay/chain-manifest.json";
const RECORD = "tools/openclinxr/asset-pipeline/reference-set/manifest.json";

type ManifestStage = {
  name: string;
  script: string;
  parameters: Record<string, unknown>;
  input_kinds: string[];
  output_paths: Record<string, string>;
};

/** Builds a small fixture manifest from tracked stage defs, in the given order. */
function smallManifestPath(stageNames: string[]): string {
  const root = testRepoRoot();
  const chain = JSON.parse(readFileSync(join(root, CHAIN), "utf8")) as {
    stages: ManifestStage[];
    subjects: Record<string, Record<string, unknown>>;
  };
  const byName = new Map(chain.stages.map((stage) => [stage.name, stage]));
  const stages = stageNames.map((name) => {
    const def = byName.get(name);
    if (!def) throw new Error(`tracked manifest holds no stage ${name}`);
    return JSON.parse(JSON.stringify(def)) as ManifestStage;
  });
  for (const stage of stages) {
    if (stage.name === "derive") stage.parameters["size"] = 512;
  }
  const doc = {
    method_version: "face-replay-hands-v1-test",
    stages,
    subjects: { aisha: { glb_sha256: "PLACEHOLDER_GLB_SHA256", overrides: {} } },
  };
  const out = join(os.tmpdir(), `face-station-manifest-stages-${process.pid}-${Math.round(Math.random() * 1e9)}.json`);
  writeFileSync(out, JSON.stringify(doc));
  return out;
}

function runFixture(manifest: string, skipStages: string[]): {
  executedChainStages: string[];
  finalName: string;
  finalSha256: string | null;
  outDir: string;
} {
  const outDir = join(os.tmpdir(), `face-station-manifest-run-${process.pid}-${Math.round(Math.random() * 1e9)}`);
  mkdirSync(outDir, { recursive: true });
  const staged = prepareFixtureReplayDir(outDir, FACE_REALISM_FIXTURE_ALBEDO_REL, 512);
  const result = runReplayChain({
    subject: "aisha",
    manifestFile: manifest,
    glbFile: staged.glbFile,
    albedoFile: staged.albedoFile,
    storeDir: outDir,
    skipAo: true,
    skipStages,
  });
  return { ...result, outDir };
}

describe("the station runs every manifest stage", () => {
  it("(G1) the executed stage list is the manifest minus declared skips, in manifest order", () => {
    const manifest = smallManifestPath(["derive", "occlusion", "roughness"]);
    const { executedChainStages } = runFixture(manifest, ["occlusion"]);
    expect(executedChainStages).toEqual(["derive", "roughness"]);
  }, 240_000);

  it("(G1b) appending a stage to a manifest copy runs with no code change", () => {
    const root = testRepoRoot();
    const chain = JSON.parse(readFileSync(join(root, CHAIN), "utf8")) as {
      stages: ManifestStage[];
    };
    const byName = new Map(chain.stages.map((stage) => [stage.name, stage]));
    const occlusion2 = JSON.parse(JSON.stringify(byName.get("occlusion"))) as ManifestStage;
    occlusion2.output_paths = { albedo_occ_png: "albedo_occ_2.png" };
    const doc = {
      method_version: "face-replay-hands-v1-test",
      stages: [byName.get("derive"), byName.get("occlusion"), occlusion2].map((stage) =>
        JSON.parse(JSON.stringify(stage)),
      ) as ManifestStage[],
      subjects: { aisha: { glb_sha256: "PLACEHOLDER_GLB_SHA256", overrides: {} } },
    };
    (doc.stages[0] as ManifestStage).parameters["size"] = 512;
    const manifest = join(os.tmpdir(), `face-station-manifest-append-${process.pid}.json`);
    writeFileSync(manifest, JSON.stringify(doc));
    const { executedChainStages, outDir } = runFixture(manifest, []);
    expect(executedChainStages).toEqual(["derive", "occlusion", "occlusion"]);
    expect(existsSync(join(outDir, "albedo_occ_2.png"))).toBe(true);
    const plan = planFaceRealism({ actorId: "aisha", recordPath: RECORD, chainManifestPath: manifest });
    expect(plan.status).toBe("replay");
    if (plan.status === "replay") {
      expect(plan.plan.chainStages).toEqual(["derive", "occlusion", "occlusion"]);
    }
  }, 240_000);

  it("(G1c) the final albedo is the LAST executed manifest stage output, not a fixed filename", () => {
    const manifest = smallManifestPath(["derive", "roughness", "occlusion"]);
    const { executedChainStages, finalName, finalSha256, outDir } = runFixture(manifest, []);
    expect(executedChainStages).toEqual(["derive", "roughness", "occlusion"]);
    // Execution order (occlusion last) differs from alphabetical order
    // (roughness.png sorts after albedo_occ.png): a fixed-filename or
    // sorted-dir final would report roughness.png here.
    expect(finalName).toBe("albedo_occ.png");
    const fileSha = createHash("sha256").update(readFileSync(join(outDir, "albedo_occ.png"))).digest("hex");
    expect(finalSha256).toBe(fileSha);
  }, 240_000);

  it("(G1e) a replay stage appended after the chained stages runs in a later segment and becomes the final", () => {
    // A copy of the tracked manifest with an extra replay stage planted
    // AFTER detail_bands (a second lips stage, ratio 1.0 = no change, with
    // its own output file: replay.py dispatches on the stage name, which it
    // already knows, so this runs with no code change). Stage 3 must run
    // the manifest in order as segments: replay, standalone beard, extra
    // replay invocation, standalone detail, extra replay invocation.
    const root = testRepoRoot();
    const chain = JSON.parse(readFileSync(join(root, CHAIN), "utf8")) as {
      stages: ManifestStage[];
      subjects: Record<string, Record<string, unknown>>;
    };
    const byName = new Map(chain.stages.map((stage) => [stage.name, stage]));
    const planted = JSON.parse(JSON.stringify(byName.get("lips"))) as ManifestStage;
    planted.parameters["ratio"] = 1.0;
    planted.output_paths = { albedo_lips_png: "albedo_planted.png" };
    const doc = {
      method_version: "face-replay-hands-v1-test",
      stages: [...chain.stages.map((stage) => JSON.parse(JSON.stringify(stage)) as ManifestStage), planted],
      subjects: { aisha: { ...(chain.subjects["aisha"] as Record<string, unknown>), glb_sha256: "PLACEHOLDER_GLB_SHA256" } },
    };
    for (const stage of doc.stages) {
      if (stage.name === "derive") stage.parameters["size"] = 512;
    }
    const manifest = join(os.tmpdir(), `face-station-manifest-planted-${process.pid}.json`);
    writeFileSync(manifest, JSON.stringify(doc));
    const outDir = join(os.tmpdir(), `face-station-planted-run-${process.pid}-${Math.round(Math.random() * 1e9)}`);
    mkdirSync(outDir, { recursive: true });
    const staged = prepareFixtureReplayDir(outDir, FACE_REALISM_FIXTURE_ALBEDO_REL, 512);
    const caseRec = {
      chain_subject: { value: "aisha" },
      stage3_beard: {
        value: {
          weight: { value: 0.0 },
          seed: { value: 11 },
          texels_per_mm: { value: 4.079 },
          expected_out_sha256: { value: "0".repeat(64), source: "test dummy pin" },
        },
      },
      stage3_detail: {
        value: {
          expected_out_sha256: { value: "0".repeat(64), source: "test dummy pin" },
        },
      },
      stage3_colour: {
        value: {
          expected_chain_socket_sha256: { value: "0".repeat(64), source: "test dummy pin" },
        },
      },
    } as unknown as Record<string, unknown>;
    const chained = runStage3Chain({
      caseRec,
      manifestDoc: doc as unknown as {
        stages?: Array<{ name?: unknown; output_paths?: unknown; parameters?: Record<string, unknown> }>;
        subjects?: Record<string, { overrides?: Record<string, Record<string, unknown>> }>;
      },
      manifestAbs: manifest,
      chainSubject: "aisha",
      glbAbs: staged.glbFile,
      albedoIn: staged.albedoFile,
      storeDir: outDir,
      skipAo: true,
      skipStages: ["beard_shadow", "detail_bands"],
    });
    const names = chained.plan.ordered.map((stage) => stage.name);
    expect(names.at(-1)).toBe("lips");
    // (a) the planted stage executed after detail_bands, in manifest order:
    // two replay segments (derive..socket, planted) with the standalone
    // beard and detail chained between them in position.
    expect(names.lastIndexOf("lips")).toBeGreaterThan(names.indexOf("detail_bands"));
    expect(chained.records.filter((sub) => sub.script.endsWith("replay.py")).length).toBe(2);
    const standaloneAfter: string[] = [];
    for (const sub of chained.records) {
      if (!sub.script.endsWith("replay.py")) standaloneAfter.push(sub.script.split("/").at(-1) ?? "");
    }
    expect(standaloneAfter).toEqual(["beard_shadow.py", "detail_bands.py"]);
    // (b) the final albedo is the planted stage's output file, sha-verified.
    expect(chained.finalStageName).toBe("lips");
    expect(chained.finalAbs).toBe(join(outDir, "albedo_planted.png"));
    expect(existsSync(chained.finalAbs)).toBe(true);
    expect(chained.finalSha256).toBe(createHash("sha256").update(readFileSync(chained.finalAbs)).digest("hex"));
    // (c) the final differs from albedo_socket.png's path.
    expect(chained.finalAbs).not.toBe(join(outDir, "albedo_socket.png"));
  }, 600_000);

  it("(G1d) skipping the last manifest stage moves the final back to the new last stage", () => {
    const manifest = smallManifestPath(["derive", "roughness", "occlusion"]);
    const { executedChainStages, finalName } = runFixture(manifest, ["occlusion"]);
    expect(executedChainStages).toEqual(["derive", "roughness"]);
    expect(finalName).toBe("roughness.png");
  }, 240_000);
});
