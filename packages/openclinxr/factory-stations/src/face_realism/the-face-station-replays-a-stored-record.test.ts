import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { factoryStationSchemas, PRODUCTION_STATION_IDS } from "../index.js";
import { stationRunners } from "../station-runners.js";
import { planFaceRealism } from "./plan.js";
import { faceRealismModelCallCount, planFaceRealismStation, runFaceRealism } from "./run.js";

/**
 * Local repo-root walk: repo-root.js is reachable from the package entrypoint,
 * so importing it here would count against the test-internal-import ceiling.
 */
function testRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("workspace root (pnpm-workspace.yaml) not found");
}

/**
 * OBSERVABLE: no face station exists. The skin chain, eye texture, shell,
 * corner fit, and lash fit are scripts; nothing replays them from a record.
 */

const RECORD = "tools/openclinxr/asset-pipeline/reference-set/manifest.json";

const VALID = { actorId: "aisha", recordPath: RECORD };
const MISSING = { actorId: "aisha", recordPath: "tools/openclinxr/asset-pipeline/reference-set/no-such-record.json" };

const STORE = "/Volumes/files/openclinxr-assets/store";

describe("the face station replays a stored record", () => {
  it("(1) face_realism is registered with its runner", () => {
    expect(PRODUCTION_STATION_IDS).toContain("face_realism");
    expect(stationRunners.face_realism.stationId).toBe("face_realism");
  });

  it("(2) catalog accepts VALID and rejects an unknown key", () => {
    expect(factoryStationSchemas.face_realism["~standard"].validate(VALID)).toEqual({ value: VALID });
    const bad = factoryStationSchemas.face_realism["~standard"].validate({ ...VALID, bogus: 1 });
    expect(bad.issues).toBeDefined();
  });

  it("(3) plan() is a dry-run replay carrying the stored shas", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const manifest = JSON.parse(readFileSync(join(dir, "station-manifest.json"), "utf8")) as Record<string, unknown>;
    const result = planFaceRealismStation(VALID);
    expect(result.issues).toBeUndefined();
    if (result.issues !== undefined) return;
    expect(result.plan["mode"]).toBe("dry-run");
    expect(result.plan["stationId"]).toBe("face_realism");
    expect(result.plan["promptSha"]).toBe(manifest["promptSha"]);
    expect(result.plan["referenceSha256"]).toBe(manifest["referenceSha256"]);
    expect(result.plan["chainManifestSha"]).toBe(manifest["chainManifestSha"]);
    expect(result.plan["modelCalls"]).toBe(0);
    expect(result.plan["chainStages"]).toEqual([
      "derive",
      "occlusion",
      "roughness",
      "lips",
      "eye_corners",
      "symmetrise",
      "socket",
      "beard_shadow",
    ]);
    expect(result.plan["shellDefault"]).toBe("off");
  });

  it("(4) plan() refuses a missing record", () => {
    const result = planFaceRealism(MISSING);
    expect(result.status).toBe("issues");
    if (result.status !== "issues") return;
    expect(result.issues.join(" ")).toContain("missing record");
  });

  it("(5) run() refuses a missing record and stops", () => {
    const result = runFaceRealism(MISSING);
    expect(result["stop"]).toBe(true);
    expect(["issues", "refused"]).toContain(result["status"]);
    expect(faceRealismModelCallCount()).toBe(0);
  });

  it("(6) replay of the stored record makes 0 model calls", () => {
    const before = faceRealismModelCallCount();
    const result = runFaceRealism(VALID);
    expect(result["status"]).toBe("replayed");
    expect(result["modelCalls"]).toBe(0);
    expect(faceRealismModelCallCount()).toBe(before);
  });

  it("(7) COUNTERWEIGHT: the replay sources call no model", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    for (const file of ["run.ts", "plan.ts"]) {
      const src = readFileSync(join(dir, file), "utf8");
      for (const marker of ["fetch(", "XMLHttpRequest", "image_gen", "image_edit", "https://"]) {
        expect(src, `${file} contains ${marker}`).not.toContain(marker);
      }
    }
  });

  it(existsSync(STORE) ? "(8) manifest shas recompute from the stored bytes" : "(8) store absent: sha verification skipped", () => {
    if (!existsSync(STORE)) return;
    const dir = dirname(fileURLToPath(import.meta.url));
    const manifest = JSON.parse(readFileSync(join(dir, "station-manifest.json"), "utf8")) as Record<string, unknown>;
    const root = testRepoRoot();
    const record = JSON.parse(readFileSync(join(root, String(manifest["record"])), "utf8")) as {
      cases: { aisha: { references: { goal_front: { prompt: string; output: { sha256: string } } } } };
    };
    const goal = record.cases.aisha.references.goal_front;
    expect(createHash("sha256").update(goal.prompt).digest("hex")).toBe(manifest["promptSha"]);
    expect(goal.output.sha256).toBe(manifest["referenceSha256"]);
    expect(createHash("sha256").update(readFileSync(join(root, String(manifest["chainManifest"])))).digest("hex")).toBe(
      manifest["chainManifestSha"],
    );
  });
});
