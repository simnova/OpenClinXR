import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type AttemptRecord,
  type BedsideAdmissionColdBootsReport,
  type CollectorIdentity,
  SOURCE_PATHS,
  recomputeCollectorOutcome,
  repoRootFromHere,
  sha256File,
  sha256Hex,
  validateBedsideAdmissionColdBootsReport,
} from "./validate.js";

/**
 * Destructive counterweights for the bedside admission collector validator.
 * Never boots a browser. Never touches the tracked snapshot.
 */

const ROOT = repoRootFromHere();
const MIN_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function tempDir(): Promise<string> {
  const created = await mkdtemp(path.join(os.tmpdir(), "bedside-admission-fixture-"));
  tmpDirs.push(created);
  return created;
}

async function sourceHashes(): Promise<BedsideAdmissionColdBootsReport["sourceSha256"]> {
  const out = {} as BedsideAdmissionColdBootsReport["sourceSha256"];
  for (const [key, rel] of Object.entries(SOURCE_PATHS) as Array<
    [keyof typeof SOURCE_PATHS, string]
  >) {
    out[key] = { path: rel, sha256: await sha256File(path.join(ROOT, rel)) };
  }
  return out;
}

function identity(): CollectorIdentity {
  return {
    bundleSha256: "b".repeat(64),
    frozenPlanId: "scene_closure_supine_bedside_plan_v1",
    frozenPlanSha256: "c".repeat(64),
    frozenGeometryRevision: "geom-v1-cdaa4a22-7",
    browserName: "chromium",
    browserVersion: "Chrome/1.2.3",
    caseId: "scene_closure_supine_bedside_v1",
    stationId: "scene_closure_supine_bedside_station_v1",
    environmentId: "inpatient_ward_room_v1",
    viewport: { width: 960, height: 720 },
    launchArgs: ["--disable-gpu-vsync"],
  };
}

function snapshot(status: "admitted" | "refused", extra?: Partial<AttemptRecord["snapshots"][number]>): AttemptRecord["snapshots"][number] {
  return {
    atIso: "2026-09-16T00:00:00.000Z",
    atMs: 1,
    status,
    reason: status === "refused" ? "layout_not_reproduced" : null,
    detail: status === "refused" ? "re-solved target sits 7.800e-1 m from the frozen target" : null,
    reproduced: status === "admitted",
    observedGeometryRevision: "geom-v1-cdaa4a22-7",
    source: "window.__openClinXrFrozenScenePlanAdmission",
    ...extra,
  };
}

async function writeAttemptFiles(
  dir: string,
  attempt: AttemptRecord,
): Promise<AttemptRecord> {
  const rawRel = attempt.raw.path;
  const shotRel = attempt.screenshot.path;
  if (shotRel) {
    await writeFile(path.isAbsolute(shotRel) ? shotRel : path.join(dir, path.basename(shotRel)), MIN_PNG);
    attempt.screenshot.sha256 = sha256Hex(MIN_PNG);
    attempt.screenshot.path = path.isAbsolute(shotRel) ? shotRel : path.join(dir, path.basename(shotRel));
  }
  attempt.raw = { path: path.isAbsolute(rawRel) ? rawRel : path.join(dir, path.basename(rawRel)), sha256: "" };
  const body = `${JSON.stringify(attempt, null, 2)}\n`;
  await writeFile(attempt.raw.path, body, "utf8");
  attempt.raw.sha256 = sha256Hex(body);
  return attempt;
}

async function wellFormedReport(
  dir: string,
  mutateAttempt?: (attempt: AttemptRecord, index: number) => void,
  status: "admitted" | "refused" = "admitted",
): Promise<BedsideAdmissionColdBootsReport> {
  const id = identity();
  const attempts: AttemptRecord[] = [];
  for (let i = 1; i <= 5; i += 1) {
    const snap = snapshot(status);
    let attempt: AttemptRecord = {
      attemptId: String(i),
      captureHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      bundleSha256: id.bundleSha256,
      frozenPlanSha256: id.frozenPlanSha256,
      browserVersion: id.browserVersion,
      startIso: "2026-09-16T00:00:00.000Z",
      endIso: "2026-09-16T00:00:10.000Z",
      namedTimeout: null,
      timeoutDiagnostic: null,
      admissionObservationPresent: true,
      finalStatus: status,
      finalReason: snap.reason,
      finalDetail: snap.detail,
      finalReproduced: snap.reproduced,
      observedGeometryRevision: snap.observedGeometryRevision,
      snapshots: [snap],
      publishCount: 1,
      driveSource: "case_owned_bedside_approach",
      driveSourceDiagnostic: null,
      environmentState: "loaded",
      environmentDiagnostic: null,
      actorWorldPositions: [{ actorId: "senior_resident_ward_v1", name: "physician", x: 0, y: 0, z: 0 }],
      actorPositionsDiagnostic: null,
      consoleErrors: [],
      pageErrors: [],
      requestErrors: [],
      browser: {
        name: "chromium",
        version: id.browserVersion,
        pid: 1000 + i,
        pidDiagnostic: null,
        launchedAtIso: "2026-09-16T00:00:00.000Z",
        closedAtIso: "2026-09-16T00:00:10.000Z",
      },
      screenshot: {
        path: path.join(dir, `attempt-${i}.png`),
        sha256: "",
        diagnostic: null,
      },
      raw: { path: path.join(dir, `attempt-${i}.json`), sha256: "" },
    };
    mutateAttempt?.(attempt, i - 1);
    attempt = await writeAttemptFiles(dir, attempt);
    attempts.push(attempt);
  }
  const recomputed = recomputeCollectorOutcome(attempts);
  return {
    schemaVersion: "openclinxr.bedside-admission-cold-boots.v1",
    generatedAt: "2026-09-16T00:00:00.000Z",
    captureHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    runId: "fixture",
    runDir: dir,
    elapsedWallClockMs: 1,
    outcome: recomputed.outcome,
    identity: id,
    sourceSha256: await sourceHashes(),
    attempts,
    geometryVariation: recomputed.geometryVariation,
    deadlinesHit: [],
    claimScope: "fixture",
    notEvidenceFor: ["clinical validity"],
  };
}

describe("bedside admission cold-boots validator", () => {
  it("accepts a well-formed five-attempt fixture", async () => {
    const dir = await tempDir();
    const report = await wellFormedReport(dir);
    const result = await validateBedsideAdmissionColdBootsReport(report, { root: ROOT });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("all_admitted");
  });

  it("rejects a deleted attempt record", async () => {
    const dir = await tempDir();
    const report = await wellFormedReport(dir);
    const missing = report.attempts[2]!;
    await rm(missing.raw.path);
    const result = await validateBedsideAdmissionColdBootsReport(report, { root: ROOT });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("raw file missing") && e.includes(missing.attemptId))).toBe(
      true,
    );
  });

  it("rejects a duplicated attempt id", async () => {
    const dir = await tempDir();
    const report = await wellFormedReport(dir, (attempt, index) => {
      if (index === 4) attempt.attemptId = "1";
    });
    const result = await validateBedsideAdmissionColdBootsReport(report, { root: ROOT });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("duplicate attempt id"))).toBe(true);
  });

  it("rejects an altered raw hash", async () => {
    const dir = await tempDir();
    const report = await wellFormedReport(dir);
    report.attempts[0]!.raw.sha256 = "0".repeat(64);
    const result = await validateBedsideAdmissionColdBootsReport(report, { root: ROOT });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("raw hash mismatch"))).toBe(true);
  });

  it("rejects an altered screenshot hash", async () => {
    const dir = await tempDir();
    const report = await wellFormedReport(dir);
    report.attempts[1]!.screenshot.sha256 = "1".repeat(64);
    const result = await validateBedsideAdmissionColdBootsReport(report, { root: ROOT });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("screenshot hash mismatch"))).toBe(true);
  });

  it("rejects mismatched head/bundle identity", async () => {
    const dir = await tempDir();
    const report = await wellFormedReport(dir, (attempt, index) => {
      if (index === 2) attempt.bundleSha256 = "d".repeat(64);
    });
    const result = await validateBedsideAdmissionColdBootsReport(report, { root: ROOT });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("identity mismatch") && e.includes("bundleSha256"))).toBe(
      true,
    );
  });

  it("rejects an admitted record with no admission snapshot", async () => {
    const dir = await tempDir();
    const report = await wellFormedReport(dir, (attempt, index) => {
      if (index === 0) {
        attempt.snapshots = [];
        attempt.admissionObservationPresent = false;
        attempt.finalStatus = "admitted";
      }
    });
    const result = await validateBedsideAdmissionColdBootsReport(report, { root: ROOT });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("admitted attempt 1 has no admission snapshot"))).toBe(
      true,
    );
  });

  it("recomputes mixed_outcomes when observations differ and refuses stable_refusal when geometry varies", async () => {
    const dir = await tempDir();
    const report = await wellFormedReport(
      dir,
      (attempt, index) => {
        const geom = index < 2 ? "geom-a" : "geom-b";
        attempt.observedGeometryRevision = geom;
        attempt.snapshots = [
          snapshot("refused", { observedGeometryRevision: geom }),
        ];
        attempt.finalStatus = "refused";
        attempt.finalReason = "layout_not_reproduced";
        attempt.finalDetail = "offset";
        attempt.finalReproduced = false;
      },
      "refused",
    );
    expect(report.outcome).toBe("mixed_outcomes");
    expect(report.geometryVariation?.preventsStableRefusal).toBe(true);
    report.outcome = "stable_refusal";
    const result = await validateBedsideAdmissionColdBootsReport(report, { root: ROOT });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("prevents stable_refusal") || e.includes("!== recomputed"))).toBe(
      true,
    );
  });

  it("rejects a report-only forged refusal or admission over unchanged raw evidence", async () => {
    const refusalDir = await tempDir();
    const admittedReport = await wellFormedReport(refusalDir);
    for (const attempt of admittedReport.attempts) {
      attempt.finalStatus = "refused";
      attempt.finalReason = "fabricated_reason";
      attempt.finalDetail = "fabricated_detail";
      attempt.finalReproduced = false;
    }
    admittedReport.outcome = "stable_refusal";
    const forgedRefusal = await validateBedsideAdmissionColdBootsReport(admittedReport, { root: ROOT });
    expect(forgedRefusal.ok).toBe(false);
    expect(
      forgedRefusal.errors.some(
        (e) => e.includes("field finalStatus diverges from raw") && e.includes("attempt 1"),
      ),
    ).toBe(true);
    expect(forgedRefusal.outcome).toBe("all_admitted");

    const admissionDir = await tempDir();
    const refusedReport = await wellFormedReport(admissionDir, undefined, "refused");
    for (const attempt of refusedReport.attempts) {
      attempt.finalStatus = "admitted";
      attempt.finalReason = null;
      attempt.finalDetail = null;
      attempt.finalReproduced = true;
    }
    refusedReport.outcome = "all_admitted";
    const forgedAdmission = await validateBedsideAdmissionColdBootsReport(refusedReport, { root: ROOT });
    expect(forgedAdmission.ok).toBe(false);
    expect(
      forgedAdmission.errors.some(
        (e) => e.includes("field finalStatus diverges from raw") && e.includes("attempt 1"),
      ),
    ).toBe(true);
    expect(forgedAdmission.outcome).toBe("stable_refusal");
  });

  it("rejects a final status inconsistent with the last snapshot", async () => {
    const dir = await tempDir();
    const report = await wellFormedReport(dir, (attempt, index) => {
      if (index === 0) {
        attempt.finalStatus = "refused";
        attempt.finalReason = "layout_not_reproduced";
        attempt.finalDetail = "offset";
        attempt.finalReproduced = false;
      }
    });
    const result = await validateBedsideAdmissionColdBootsReport(report, { root: ROOT });
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => e.includes("attempt 1") && e.includes("finalStatus inconsistent with last snapshot")),
    ).toBe(true);
  });
});
