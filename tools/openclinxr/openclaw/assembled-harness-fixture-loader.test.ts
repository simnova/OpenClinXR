import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FileDurableSink,
  resolveSeed,
} from "../../../tests/openclinxr/helpers/assembled-exam-harness.js";

describe("assembled harness fixture loader", () => {
  it("resolves the pediatric work-of-breathing seed from the public entrypoint", async () => {
    const seed = await resolveSeed({ seedId: "peds_patient_work_of_breathing" });
    expect(seed).toMatchObject({
      seedId: "peds_patient_work_of_breathing",
      actorId: "patient_maya_johnson_v1",
      learnerUtterance:
        "Maya, can you show me how hard it feels to breathe and tell me what is bothering you most?",
      expectedTraceTags: ["work_of_breathing_assessment"],
    });
  });

  it("resolves a real ED seed", async () => {
    const seed = await resolveSeed({ seedId: "patient_onset_history" });
    expect(seed).toMatchObject({
      seedId: "patient_onset_history",
      actorId: "patient_robert_hayes_v1",
      expectedTraceTags: ["history_opqrst"],
    });
  });

  it("rejects unknown seeds and repeats cached results", async () => {
    await expect(resolveSeed({ seedId: "no_such_seed" })).rejects.toThrow(
      "harness fixture seed not found: no_such_seed",
    );
    const first = await resolveSeed({ seedId: "peds_patient_work_of_breathing" });
    const second = await resolveSeed({ seedId: "peds_patient_work_of_breathing" });
    expect(second).toEqual(first);
  });

  it("persists disposition aggregates across FileDurableSink restarts with root isolation", () => {
    const firstRoot = mkdtempSync(path.join(tmpdir(), "oc-disposition-a-"));
    const secondRoot = mkdtempSync(path.join(tmpdir(), "oc-disposition-b-"));
    try {
      const first = new FileDurableSink({ rootDir: firstRoot });
      expect(first.getAssembledExamDisposition("missing-run")).toBeUndefined();
      const aggregate = {
        current: {
          decisionId: "decision-1",
          disposition: "hold",
          status: "draft",
          reviewerId: "faculty-r1",
        },
      };
      first.saveAssembledExamDisposition("exam-1", aggregate);
      const restarted = new FileDurableSink({ rootDir: firstRoot });
      expect(restarted.getAssembledExamDisposition("exam-1")).toEqual(aggregate);
      const isolated = new FileDurableSink({ rootDir: secondRoot });
      expect(isolated.getAssembledExamDisposition("exam-1")).toBeUndefined();
    } finally {
      rmSync(firstRoot, { recursive: true, force: true });
      rmSync(secondRoot, { recursive: true, force: true });
    }
  });
});
