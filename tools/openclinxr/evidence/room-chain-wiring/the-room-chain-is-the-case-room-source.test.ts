import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runRoomStage } from "../../dark-factory/multi-case-runner.js";
import { ROOM_CHAIN_RECIPES, type runRoomChain } from "@openclinxr/factory-stations/room-chain";

let scratch: string | undefined;
afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

const root = path.resolve(import.meta.dirname, "../../../..");
const shippedWard = path.join(root, "apps/ui-xr/public/xr-assets/environment/infinigen-inpatient-ward.glb");
const shippedSha = createHash("sha256").update(readFileSync(shippedWard)).digest("hex");
const shippedStepdown = path.join(root, "apps/ui-xr/public/xr-assets/environment/infinigen-stepdown.glb");

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

  it("names the parametric fallback for a non-recipe environment", async () => {
    scratch = mkdtempSync(path.join(tmpdir(), `room-parametric-case-${process.pid}-`));
    await runRoomStage("peds_asthma_parent_anxiety_v1", scratch);
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

  it("promotes from two output directories without changing any tracked bytes", () => {
    scratch = mkdtempSync(path.join(tmpdir(), `room-promote-${process.pid}-`));
    const dirs = [path.join(scratch, "a"), path.join(scratch, "b")];
    const before = execFileSync("git", ["diff", "--binary", "HEAD"], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    for (const outDir of dirs) {
      execFileSync("pnpm", ["factory:room:promote", "--", "--environment", "inpatient_ward_room_v1", "--out-dir", outDir], {
        cwd: root,
        stdio: "pipe",
        timeout: 120_000,
      });
    }
    for (const name of ["infinigen-inpatient-ward.chain.glb", "ward-chain.lighting-rig.json"]) {
      expect(readFileSync(path.join(dirs[0]!, name)).equals(readFileSync(path.join(dirs[1]!, name)))).toBe(true);
    }
    const after = execFileSync("git", ["diff", "--binary", "HEAD"], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    expect(after.equals(before)).toBe(true);
  }, 240_000);
});
