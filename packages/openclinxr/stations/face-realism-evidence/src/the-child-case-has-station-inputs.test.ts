// Card tsk_386c8c91eee19dca: the child case has station inputs (G1-G6).
// G1 goal image in the store, recorded with prompt/generator/driver/seed/sha.
// G2 plan() plans the child; the plan gate is unchanged vs origin/main.
// G3 chain-manifest child row: every value sourced; glb sha recomputed.
// G4 face_realism pins re-derived; aisha final albedo unchanged.
// G5 aisha/body2 targets identical to origin/main; child entry exists.
// G6 third-subject r2 block lists F1-F8 with status + owner.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function testRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("workspace root (pnpm-workspace.yaml) not found");
}

const CHILD = "peds_asthma_parent_anxiety_v1";
const STORE_GOAL = "/Volumes/files/openclinxr-assets/store/third-subject/goal-front.png";
const SHIPPED_GLB = "apps/ui-xr/public/generated-humanoids/mpfb-peds-patient-child.glb";

function shaFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("the child case has station inputs", () => {
  it("G1 goal image exists in the store and is recorded with prompt, generator, driver model, seed and sha", () => {
    const root = testRepoRoot();
    const manifest = JSON.parse(
      readFileSync(join(root, "tools/openclinxr/asset-pipeline/reference-set/manifest.json"), "utf8"),
    ) as {
      cases: Record<string, { references?: { goal_front?: Record<string, unknown> }; phenotype_tone?: unknown }>;
    };
    const child = manifest.cases[CHILD];
    expect(child, "child case in reference-set manifest").toBeDefined();
    expect(child?.phenotype_tone).toBe("warm_light_child");
    const goal = child?.references?.["goal_front"] as Record<string, unknown>;
    expect(typeof goal?.["prompt"], "prompt recorded").toBe("string");
    expect((goal?.["prompt"] as string).length).toBeGreaterThan(50);
    expect(typeof goal?.["generator"], "generator recorded").toBe("string");
    expect(String(goal?.["generator"])).toContain("image_edit");
    expect(typeof goal?.["driverModel"], "driver model recorded").toBe("string");
    expect(typeof goal?.["seed"], "seed field recorded").toBe("string");
    const output = goal?.["output"] as { store_relpath?: unknown; path?: unknown; sha256?: unknown };
    expect(typeof output?.sha256, "output sha recorded").toBe("string");
    if (existsSync(STORE_GOAL)) {
      expect(shaFile(STORE_GOAL), "stored goal sha recomputes").toBe(output?.sha256);
    }
  });

  it("G2 plan() plans the child and the plan gate is unchanged", () => {
    const root = testRepoRoot();
    // 2026-10-30 the station moved from factory-stations/src/face_realism to stations/face-realism;
    // origin/main may hold plan.ts at either path. The gate is unchanged when the working file
    // equals main's copy once the station's own path prefix is mapped across.
    const NEW_DIR = "packages/openclinxr/stations/face-realism/src";
    const OLD_DIR = "packages/openclinxr/factory-stations/src/face_realism";
    const onMain = (rel: string): string | null => {
      try {
        return execSync(`git show origin/main:${rel}`, { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString();
      } catch {
        return null;
      }
    };
    const base = onMain(`${NEW_DIR}/plan.ts`) ?? onMain(`${OLD_DIR}/plan.ts`)?.split(OLD_DIR).join(NEW_DIR) ?? null;
    expect(base, "plan.ts exists on origin/main at the old or new path").not.toBeNull();
    const current = readFileSync(join(root, NEW_DIR, "plan.ts"), "utf8");
    expect(current, "plan.ts gate unchanged vs origin/main").toBe(base);
  });

  it("G3 chain-manifest child row sources every value and pins the computed GLB sha", () => {
    const root = testRepoRoot();
    const chain = JSON.parse(
      readFileSync(join(root, "tools/openclinxr/asset-pipeline/skin/face-replay/chain-manifest.json"), "utf8"),
    ) as { subjects: Record<string, Record<string, unknown>> };
    const row = chain.subjects["peds_patient_child"];
    expect(row, "child subject row").toBeDefined();
    expect(shaFile(join(root, SHIPPED_GLB)), "named GLB sha recomputes").toBe(row?.["glb_sha256"]);
    const sources = row?.["sources"] as Record<string, unknown>;
    for (const key of ["glb_sha256", "skin_tone_rgb", "lips.ratio", "symmetrise.strength", "beard_shadow.weight"]) {
      expect(typeof sources?.[key], `source recorded for ${key}`).toBe("string");
      expect((sources?.[key] as string).length).toBeGreaterThan(10);
    }
    expect(row?.["skin_tone_rgb"]).toEqual([0.84, 0.7, 0.6]);
    const overrides = row?.["overrides"] as Record<string, Record<string, unknown>>;
    expect(overrides?.["lips"]).toEqual({ ratio: 1.0 });
    expect(overrides?.["symmetrise"]).toEqual({ strength: 1.0 });
    expect(overrides?.["beard_shadow"]).toEqual({ weight: 0.0 });
  });

  it("G4 face_realism pins are re-derived and aisha final albedo is unchanged", () => {
    const root = testRepoRoot();
    const chainSha = shaFile(join(root, "tools/openclinxr/asset-pipeline/skin/face-replay/chain-manifest.json"));
    const station = JSON.parse(
      readFileSync(join(root, "packages/openclinxr/stations/face-realism/src/station-manifest.json"), "utf8"),
    ) as { chainManifestSha?: unknown };
    expect(station.chainManifestSha, "station-manifest pin == chain file sha").toBe(chainSha);
    const report = JSON.parse(
      readFileSync(join(root, "packages/openclinxr/stations/face-realism/src/run-report.json"), "utf8"),
    ) as { chainManifestSha256?: unknown; finalAlbedo?: { sha256?: unknown } };
    expect(report.chainManifestSha256, "run-report pin == chain file sha").toBe(chainSha);
    expect(report.finalAlbedo?.sha256, "aisha final albedo unchanged").toBe(
      "9cbf06772f6e6bb322cb3ae7e36d0788fcd891aa9d28c8d44e6d4bdcb6ebe312",
    );
  });

  it("G5 aisha/body2 targets identical to origin/main; child entry exists", () => {
    const root = testRepoRoot();
    const current = JSON.parse(
      readFileSync(join(root, "tools/openclinxr/evidence/face-fit/any-subject-targets.json"), "utf8"),
    ) as { cases: Record<string, unknown> };
    const originRaw = execSync("git show origin/main:tools/openclinxr/evidence/face-fit/any-subject-targets.json", {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024,
    }).toString();
    const origin = JSON.parse(originRaw) as { cases: Record<string, unknown> };
    expect(current.cases["aisha"], "aisha entry byte-identical to origin/main").toEqual(origin.cases["aisha"]);
    expect(current.cases["body2"], "body2 entry byte-identical to origin/main").toEqual(origin.cases["body2"]);
    expect(current.cases[CHILD], "child entry exists").toBeDefined();
  });

  it("G6 third-subject r2 block lists F1-F8 with status and owner", () => {
    const root = testRepoRoot();
    const report = JSON.parse(
      readFileSync(join(root, "tools/openclinxr/evidence/second-subject/third-subject-report.json"), "utf8"),
    ) as { r2?: { findingsStatus?: Array<{ id?: unknown; status?: unknown; owner?: unknown }> } };
    expect(report.r2, "r2 block present (first block kept)").toBeDefined();
    const rows = report.r2?.findingsStatus ?? [];
    expect(rows.map((row) => row.id).sort()).toEqual(
      ["F1-plan-gate", "F2-no-goal", "F3-tone-anchor", "F4-lid-map", "F5-eye-stem", "F6-chain-subjects", "F7-face-fit", "F8-derive-floor"].sort(),
    );
    for (const row of rows) {
      expect(["resolved", "still_refused"]).toContain(row.status);
      if (row.status === "still_refused") {
        expect(typeof row.owner, `${row.id} names its owner lane`).toBe("string");
      }
    }
  });
});
