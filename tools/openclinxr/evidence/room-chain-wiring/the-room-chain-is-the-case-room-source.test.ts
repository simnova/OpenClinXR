import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runRoomStage } from "../../dark-factory/multi-case-runner.js";
import { promoteRoom } from "../../asset-pipeline/environment/room-promote-cli.js";
import { ROOM_CHAIN_RECIPES, type runRoomChain } from "@openclinxr/factory-stations/room-chain";

let scratch: string | undefined;
afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

const root = path.resolve(import.meta.dirname, "../../../..");
const shippedWard = path.join(root, "apps/ui-xr/public/xr-assets/environment/infinigen-inpatient-ward.glb");
const shippedSha = createHash("sha256").update(readFileSync(shippedWard)).digest("hex");
const shippedWardRig = path.join(root, "apps/ui-xr/public/xr-assets/lighting/inpatient_ward_room_v1.rig.json");
const shippedStepdown = path.join(root, "apps/ui-xr/public/xr-assets/environment/infinigen-stepdown.glb");
const shippedStepdownRig = path.join(root, "apps/ui-xr/public/xr-assets/lighting/stepdown_room_v1.rig.json");

describe("dark-factory room source selection", () => {
  it("uses the room chain for a registered ward and records its shipped GLB sha", async () => {
    scratch = mkdtempSync(path.join(tmpdir(), `room-chain-case-${process.pid}-`));
    const fakeChain = async (options: Parameters<typeof runRoomChain>[0]): Promise<Awaited<ReturnType<typeof runRoomChain>>> => {
      const finalGlb = path.join(options.outDir!, "infinigen-inpatient-ward.chain.glb");
      const rigJson = path.join(options.outDir!, "ward-chain.lighting-rig.json");
      writeFileSync(finalGlb, readFileSync(shippedWard));
      writeFileSync(rigJson, "{}\n");
      return {
        environmentId: options.environmentId,
        seed: options.seed!,
        cache: {
          room_generate: { hit: true, key: "gen" },
          room_clinic_finish: { hit: true, key: "finish" },
          lighting_design: { hit: true, key: "light" },
        },
        stageKeys: { room_generate: "gen", room_clinic_finish: "finish", lighting_design: "light" },
        workGlb: finalGlb,
        finalGlb,
        rigJson,
        reportPath: path.join(options.outDir!, "ward-chain-report.json"),
        glbSha256: shippedSha,
        rigSha256: createHash("sha256").update("{}\n").digest("hex"),
      };
    };
    const result = await runRoomStage("ward_delirium_med_rec_v1", scratch, { runChain: fakeChain });
    const record = JSON.parse(readFileSync(path.join(scratch, "room-chain-output.json"), "utf8"));
    expect(result.row.classification).toBe("deterministic");
    expect(record.roomSource).toBe("room-chain");
    expect(record.seed).toBe(ROOM_CHAIN_RECIPES.inpatient_ward_room_v1.defaultSeed);
    expect(record.outputGlbSha256).toBe(shippedSha);
    expect(record.stageCacheKeys).toEqual({ room_generate: "gen", room_clinic_finish: "finish", lighting_design: "light" });
  });

  it("names the parametric fallback when the registry has no recipe", async () => {
    scratch = mkdtempSync(path.join(tmpdir(), `room-parametric-case-${process.pid}-`));
    const throwingChain = async (): Promise<never> => {
      throw new Error("hermetic: runChain must not run for an absent recipe (no Blender/provider launch)");
    };
    // Actual peds fixture (pediatric_urgent_care_bay_v1 is registered in the real
    // registry) with an explicitly absent injected registry, so the test exercises
    // the actual parametric builder without provider work.
    await runRoomStage("peds_asthma_parent_anxiety_v1", scratch, {
      recipes: {},
      runChain: throwingChain as unknown as typeof runRoomChain,
    });
    const record = JSON.parse(readFileSync(path.join(scratch, "room-shell.json"), "utf8"));
    expect(record.roomSource).toBe("parametric");
  });

  it("uses the room chain for the shipped stepdown case", async () => {
    scratch = mkdtempSync(path.join(tmpdir(), `room-chain-stepdown-${process.pid}-`));
    const stepdownSha = createHash("sha256").update(readFileSync(shippedStepdown)).digest("hex");
    const fakeChain = async (options: Parameters<typeof runRoomChain>[0]): Promise<Awaited<ReturnType<typeof runRoomChain>>> => {
      const finalGlb = path.join(options.outDir!, "infinigen-stepdown.chain.glb");
      const rigJson = path.join(options.outDir!, "ward-chain.lighting-rig.json");
      writeFileSync(finalGlb, readFileSync(shippedStepdown));
      writeFileSync(rigJson, "{}\n");
      return {
        environmentId: options.environmentId, seed: options.seed!,
        cache: { room_generate: { hit: true, key: "gen" }, room_clinic_finish: { hit: true, key: "finish" }, lighting_design: { hit: true, key: "light" } },
        stageKeys: { room_generate: "gen", room_clinic_finish: "finish", lighting_design: "light" },
        workGlb: finalGlb, finalGlb, rigJson,
        reportPath: path.join(options.outDir!, "ward-chain-report.json"),
        glbSha256: stepdownSha,
        rigSha256: createHash("sha256").update("{}\n").digest("hex"),
      };
    };
    const result = await runRoomStage("stepdown_sepsis_nurse_escalation_v1", scratch, { runChain: fakeChain });
    const record = JSON.parse(readFileSync(path.join(scratch, "room-chain-output.json"), "utf8"));
    expect(result.row.classification).toBe("deterministic");
    expect(record.roomSource).toBe("room-chain");
    expect(record.environmentId).toBe("stepdown_room_v1");
    expect(record.seed).toBe(ROOM_CHAIN_RECIPES.stepdown_room_v1.defaultSeed);
  });

  it("keeps the ward preset and door declaration only in the exported recipe registry", async () => {
    const runSource = readFileSync(path.join(root, "packages/openclinxr/factory-stations/src/room_chain/run.ts"), "utf8");
    expect(runSource).not.toContain("WARD_CHAIN_DOOR");
    expect(runSource).not.toContain("WARD_CHAIN_PRESET");
    expect(ROOM_CHAIN_RECIPES.inpatient_ward_room_v1.finishPreset).toBe("ward_photo");
    expect(ROOM_CHAIN_RECIPES.inpatient_ward_room_v1.door.liteRect).toEqual([0.64, 0.8, 0.58, 0.87]);
    expect(ROOM_CHAIN_RECIPES.inpatient_ward_room_v1.finish?.door.kind).toBe("hospital");
  });

  it("promotes from two output directories through the real publisher into a fixture root", async () => {
    scratch = mkdtempSync(path.join(tmpdir(), `room-promote-${process.pid}-`));
    const fixtureRoot = path.join(scratch, "fixture-repo");
    const dirs = [path.join(scratch, "a"), path.join(scratch, "b")];
    for (const outDir of dirs) mkdirSync(outDir, { recursive: true });
    // Unrelated fixture file the publisher must leave untouched.
    const unrelated = path.join(fixtureRoot, "apps/ui-xr/public/xr-assets/environment/UNRELATED.txt");
    mkdirSync(path.dirname(unrelated), { recursive: true });
    writeFileSync(unrelated, "hermetic sentinel\n");
    const unrelatedBefore = readFileSync(unrelated);
    const stepdownSha = createHash("sha256").update(readFileSync(shippedStepdown)).digest("hex");
    const stepdownRigSha = createHash("sha256").update(readFileSync(shippedStepdownRig)).digest("hex");
    let calls = 0;
    // Only the expensive generation dependency is injected (valid shipped copies);
    // the real promoteRoom publication/routing logic runs unmocked.
    const fakeChain = async (options: Parameters<typeof runRoomChain>[0]): Promise<Awaited<ReturnType<typeof runRoomChain>>> => {
      calls += 1;
      mkdirSync(options.outDir!, { recursive: true });
      const finalGlb = path.join(options.outDir!, "infinigen-stepdown.chain.glb");
      const rigJson = path.join(options.outDir!, "ward-chain.lighting-rig.json");
      writeFileSync(finalGlb, readFileSync(shippedStepdown));
      writeFileSync(rigJson, readFileSync(shippedStepdownRig));
      return {
        environmentId: options.environmentId,
        seed: options.seed!,
        cache: {
          room_generate: { hit: true, key: "gen" },
          room_clinic_finish: { hit: true, key: "finish" },
          lighting_design: { hit: true, key: "light" },
        },
        stageKeys: { room_generate: "gen", room_clinic_finish: "finish", lighting_design: "light" },
        workGlb: finalGlb,
        finalGlb,
        rigJson,
        reportPath: path.join(options.outDir!, "ward-chain-report.json"),
        glbSha256: stepdownSha,
        rigSha256: stepdownRigSha,
      };
    };
    const deps = { runChain: fakeChain, repositoryRoot: fixtureRoot, publicationTargetRoot: fixtureRoot };
    // Stepdown has no provenanceOut, so no child producer runs; every write lands
    // under fixtureRoot or the scratch outDirs — never the live repo.
    await promoteRoom(["--environment", "stepdown_room_v1", "--out-dir", dirs[0]!], deps);
    const publishedGlb = path.join(fixtureRoot, "apps/ui-xr/public/xr-assets/environment/infinigen-stepdown.glb");
    const publishedRig = path.join(fixtureRoot, "apps/ui-xr/public/xr-assets/lighting/stepdown_room_v1.rig.json");
    expect(readFileSync(publishedGlb).equals(readFileSync(shippedStepdown))).toBe(true);
    const baselineGlb = readFileSync(publishedGlb);
    const baselineRig = readFileSync(publishedRig);
    await promoteRoom(["--environment", "stepdown_room_v1", "--out-dir", dirs[1]!], deps);
    expect(calls).toBe(2);
    expect(readFileSync(publishedGlb).equals(baselineGlb)).toBe(true);
    expect(readFileSync(publishedRig).equals(baselineRig)).toBe(true);
    for (const name of ["infinigen-stepdown.chain.glb", "ward-chain.lighting-rig.json"]) {
      expect(readFileSync(path.join(dirs[0]!, name)).equals(readFileSync(path.join(dirs[1]!, name)))).toBe(true);
    }
    for (const outDir of dirs) {
      expect(existsSync(path.join(outDir, "room-evidence-poses.json"))).toBe(true);
    }
    expect(readFileSync(unrelated).equals(unrelatedBefore)).toBe(true);
  }, 120_000);

  it("routes the ward provenance branch to the fixture target with the real spawn", async () => {
    scratch = mkdtempSync(path.join(tmpdir(), `room-promote-ward-${process.pid}-`));
    const fixtureSrc = path.join(scratch, "fixture-src");
    const fixturePub = path.resolve(scratch, "fixture-pub");
    const wardOutDir = path.join(scratch, "ward-out");
    mkdirSync(wardOutDir, { recursive: true });
    // Minimal fixture source repo: read-only Main deps plus a stub provenance producer
    // that records the ACTUAL spawn cwd/env instead of touching real provenance.
    const stubDir = path.join(fixtureSrc, "tools/openclinxr/evidence/room-ward-finish-chain");
    mkdirSync(stubDir, { recursive: true });
    symlinkSync(path.join(root, "node_modules"), path.join(fixtureSrc, "node_modules"));
    writeFileSync(path.join(stubDir, "ship-ward-provenance.ts"), [
      `import { mkdirSync, writeFileSync } from "node:fs";`,
      `const out = process.env["SHIP_WARD_OUT"] ?? "";`,
      `mkdirSync(out, { recursive: true });`,
      `writeFileSync(\`\${out}/provenance-stub-record.json\`, \`\${JSON.stringify({`,
      `  cwd: process.cwd(),`,
      `  shipWardOut: out,`,
      `  shipWardChainOut: process.env["SHIP_WARD_CHAIN_OUT"] ?? "",`,
      `  shipWardSeed: process.env["SHIP_WARD_SEED"] ?? "",`,
      `}, null, 2)}\n\`, "utf8");`,
      ``,
    ].join("\n"));
    const srcSentinel = path.join(fixtureSrc, "SOURCE_SENTINEL.txt");
    writeFileSync(srcSentinel, "fixture source sentinel\n");
    const srcBefore = readFileSync(srcSentinel);
    const unrelated = path.join(fixturePub, "apps/ui-xr/public/xr-assets/environment/UNRELATED.txt");
    mkdirSync(path.dirname(unrelated), { recursive: true });
    writeFileSync(unrelated, "hermetic sentinel\n");
    const unrelatedBefore = readFileSync(unrelated);
    const wardRigSha = createHash("sha256").update(readFileSync(shippedWardRig)).digest("hex");
    const fakeChain = async (options: Parameters<typeof runRoomChain>[0]): Promise<Awaited<ReturnType<typeof runRoomChain>>> => {
      mkdirSync(options.outDir!, { recursive: true });
      const finalGlb = path.join(options.outDir!, "infinigen-inpatient-ward.chain.glb");
      const rigJson = path.join(options.outDir!, "ward-chain.lighting-rig.json");
      writeFileSync(finalGlb, readFileSync(shippedWard));
      writeFileSync(rigJson, readFileSync(shippedWardRig));
      return {
        environmentId: options.environmentId,
        seed: options.seed!,
        cache: {
          room_generate: { hit: true, key: "gen" },
          room_clinic_finish: { hit: true, key: "finish" },
          lighting_design: { hit: true, key: "light" },
        },
        stageKeys: { room_generate: "gen", room_clinic_finish: "finish", lighting_design: "light" },
        workGlb: finalGlb,
        finalGlb,
        rigJson,
        reportPath: path.join(options.outDir!, "ward-chain-report.json"),
        glbSha256: shippedSha,
        rigSha256: wardRigSha,
      };
    };
    const savedShipWardOut = process.env["SHIP_WARD_OUT"];
    delete process.env["SHIP_WARD_OUT"];
    try {
      // REAL promoteRoom with the REAL default process spawn; only generation is
      // injected (valid shipped ward bytes) and the producer script is a fixture stub.
      // Fixture provenance content is routing evidence only, not a quality claim.
      await promoteRoom(["--environment", "inpatient_ward_room_v1", "--out-dir", wardOutDir], {
        runChain: fakeChain,
        repositoryRoot: fixtureSrc,
        publicationTargetRoot: fixturePub,
      });
    } finally {
      if (savedShipWardOut === undefined) delete process.env["SHIP_WARD_OUT"];
      else process.env["SHIP_WARD_OUT"] = savedShipWardOut;
    }
    const publishedGlb = path.join(fixturePub, "apps/ui-xr/public/xr-assets/environment/infinigen-inpatient-ward.glb");
    const publishedRig = path.join(fixturePub, "apps/ui-xr/public/xr-assets/lighting/inpatient_ward_room_v1.rig.json");
    expect(readFileSync(publishedGlb).equals(readFileSync(shippedWard))).toBe(true);
    expect(readFileSync(publishedRig).equals(readFileSync(shippedWardRig))).toBe(true);
    const expectedOut = path.resolve(fixturePub, "docs/openclinxr/room-realism/floor-cast");
    const record = JSON.parse(readFileSync(path.join(expectedOut, "provenance-stub-record.json"), "utf8"));
    // macOS TMPDIR (/var/…) is an alias for /private/var/…; the spawned process reports
    // the resolved cwd, so compare filesystem realpaths, never aliased strings.
    expect(realpathSync(record.cwd)).toBe(realpathSync(fixturePub));
    expect(record.shipWardOut).toBe(expectedOut);
    expect(record.shipWardChainOut).toBe(wardOutDir);
    expect(record.shipWardSeed).toBe(String(ROOM_CHAIN_RECIPES.inpatient_ward_room_v1.defaultSeed));
    expect(existsSync(path.join(wardOutDir, "room-evidence-poses.json"))).toBe(true);
    expect(readFileSync(srcSentinel).equals(srcBefore)).toBe(true);
    expect(readFileSync(unrelated).equals(unrelatedBefore)).toBe(true);
  }, 120_000);

  it("defaults publication to the provided repository root", async () => {
    scratch = mkdtempSync(path.join(tmpdir(), `room-promote-rootonly-${process.pid}-`));
    const repoOnly = path.resolve(scratch, "repo-only");
    const outDir = path.join(scratch, "gen-out");
    const unrelated = path.join(repoOnly, "apps/ui-xr/public/xr-assets/environment/UNRELATED.txt");
    mkdirSync(path.dirname(unrelated), { recursive: true });
    writeFileSync(unrelated, "hermetic sentinel\n");
    const unrelatedBefore = readFileSync(unrelated);
    const stepdownSha = createHash("sha256").update(readFileSync(shippedStepdown)).digest("hex");
    const stepdownRigSha = createHash("sha256").update(readFileSync(shippedStepdownRig)).digest("hex");
    const fakeChain = async (options: Parameters<typeof runRoomChain>[0]): Promise<Awaited<ReturnType<typeof runRoomChain>>> => {
      mkdirSync(options.outDir!, { recursive: true });
      const finalGlb = path.join(options.outDir!, "infinigen-stepdown.chain.glb");
      const rigJson = path.join(options.outDir!, "ward-chain.lighting-rig.json");
      writeFileSync(finalGlb, readFileSync(shippedStepdown));
      writeFileSync(rigJson, readFileSync(shippedStepdownRig));
      return {
        environmentId: options.environmentId,
        seed: options.seed!,
        cache: {
          room_generate: { hit: true, key: "gen" },
          room_clinic_finish: { hit: true, key: "finish" },
          lighting_design: { hit: true, key: "light" },
        },
        stageKeys: { room_generate: "gen", room_clinic_finish: "finish", lighting_design: "light" },
        workGlb: finalGlb,
        finalGlb,
        rigJson,
        reportPath: path.join(options.outDir!, "ward-chain-report.json"),
        glbSha256: stepdownSha,
        rigSha256: stepdownRigSha,
      };
    };
    // No publicationTargetRoot: publication must fall back to repositoryRoot, never cwd.
    await promoteRoom(["--environment", "stepdown_room_v1", "--out-dir", outDir], {
      runChain: fakeChain,
      repositoryRoot: repoOnly,
    });
    const publishedGlb = path.join(repoOnly, "apps/ui-xr/public/xr-assets/environment/infinigen-stepdown.glb");
    expect(readFileSync(publishedGlb).equals(readFileSync(shippedStepdown))).toBe(true);
    expect(readFileSync(unrelated).equals(unrelatedBefore)).toBe(true);
  }, 120_000);
});
