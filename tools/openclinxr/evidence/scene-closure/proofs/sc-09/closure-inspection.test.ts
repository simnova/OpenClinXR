import { describe, expect, it } from "vitest";
import {
  canonicalSourcePath,
  inspectClosureEvidence,
  pinnedSourceReader,
} from "./closure-inspection.js";
import { unitControl } from "./unit-fixture.js";

describe("bounded source and retained recording inspection", () => {
  it("accepts a fully bound UNIT control without claiming an actual encounter", () => {
    expect(unitControl().verify()).toEqual([]);
  });
  it("rejects the demonstrated false digest, altered path and omitted required source escapes", () => {
    for (const mutate of [
      (c: ReturnType<typeof unitControl>) => {
        c.inputs[0]!.sha256 = "0".repeat(64);
      },
      (c: ReturnType<typeof unitControl>) => {
        c.inputs[0]!.path = "../../private";
      },
      (c: ReturnType<typeof unitControl>) => {
        c.executionInputs.shift();
      },
    ]) {
      const c = unitControl();
      mutate(c);
      expect(c.verify().length).toBeGreaterThan(0);
    }
  });
  it("rejects text-only, corrupt video, cross-run trace and generic observations", () => {
    const absent = unitControl();
    absent.objects.delete("video");
    expect(absent.verify().join("\n")).toMatch(/video/u);
    const corrupt = unitControl();
    corrupt.inspection.decodeVideo = () => new Error("undecodable");
    expect(corrupt.verify().join("\n")).toMatch(/decoding failed/u);
    const wrongRun = unitControl();
    wrongRun.put("trace", {
      runId: "other-run",
      identities: wrongRun.identities,
      measurements: wrongRun.measurements,
    });
    expect(wrongRun.verify().join("\n")).toMatch(/run identity mismatch/u);
    const generic = unitControl();
    generic.put("trace", {
      runId: "unit-run",
      identities: generic.identities,
      measurements: { allChecksPass: true },
    });
    expect(generic.verify().join("\n")).toMatch(/missing numeric/u);
  });
  it("rejects changed selected bytes and missing independent full-watch receipt", () => {
    const changed = unitControl();
    changed.put("bundle", { bundleId: "substituted" });
    expect(changed.verify().join("\n")).toMatch(/bundle/u);
    const review = unitControl();
    review.objects.delete("watch");
    expect(review.verify().join("\n")).toMatch(/watch receipt/u);
  });
  it("keeps honest historical execution valid but refuses changed current replay", () => {
    const c = unitControl();
    c.inspection.sourceReader.current = () =>
      Buffer.from("changed later selected input");
    expect(c.verify()).toEqual([]);
    (c.report["recordingBinding"] as Record<string, unknown>)["claimMode"] =
      "current-replay";
    expect(c.verify().join("\n")).toMatch(/current replay input changed/u);
  });
  it("rejects NaN/absent watch duration and unbound source files inside otherwise owned roots", () => {
    for (const value of [undefined, Number.NaN, -1]) {
      const c = unitControl();
      c.put("watch", {
        reviewerId: "reviewer",
        runId: "unit-run",
        sourceCommit: "1".repeat(40),
        videoSha256: c.objects.get("video")!.sha256,
        decodedFrames: 60,
        watchedThroughSeconds: value,
      });
      expect(c.verify().join("\n")).toMatch(/watch receipt/u);
    }
    const c = unitControl();
    c.inputs.push({
      path: "tools/openclinxr/evidence/scene-closure/proofs/sc-09/undeclared.ts",
      sha256: "0".repeat(64),
    });
    expect(c.verify().join("\n")).toMatch(/unapproved source input/u);
  });
  it("rejects missing edited-video lineage in SC-08 and SC-09", () => {
    for (const cardKey of ["SC-08", "SC-09"]) {
      const c = unitControl();
      c.report["cardKey"] = cardKey;
      expect(c.verify()).toEqual([]);
      c.objects.delete("edited-video");
      expect(c.verify().join("\n")).toMatch(/reviewed edit/u);
    }
  });
  it("separates later grading inputs from capture freshness without omitting runtime main", () => {
    const c = unitControl();
    const captureCommit = "1".repeat(40),
      gradingCommit = "2".repeat(40);
    const gradePath =
      "tools/openclinxr/evidence/scene-closure/proofs/sc-09/a.ts";
    const gradeBytes = c.sources.get(gradePath);
    if (!gradeBytes) throw Error("UNIT grade bytes missing");
    const implementation = c.report["implementation"] as Record<
      string,
      unknown
    >;
    implementation["productSourceCommit"] = gradingCommit;
    implementation["inputs"] = c.inputs.filter(
      (input) => input.path === gradePath,
    );
    const originalRead = c.inspection.sourceReader.read;
    c.inspection.sourceReader.read = (revision, name) =>
      revision === gradingCommit && name === gradePath
        ? gradeBytes
        : name === gradePath && revision === captureCommit
          ? new Error("grader did not exist at capture")
          : originalRead(revision, name);
    (c.report["recordingBinding"] as Record<string, unknown>)["claimMode"] =
      "current-replay";
    const originalCurrent = c.inspection.sourceReader.current;
    c.inspection.sourceReader.current = (name) =>
      name === gradePath
        ? Buffer.from("later documentation/grader update")
        : originalCurrent(name);
    expect(c.verify()).toEqual([]);
    c.inspection.sourceReader.current = (name) =>
      name === "apps/ui-xr/src/main.ts"
        ? Buffer.from("changed runtime")
        : originalCurrent(name);
    expect(c.verify().join("\n")).toMatch(
      /current replay input changed.*main\.ts/u,
    );
  });
  it("rejects reuse when pinned support geometry changes while support IDs remain unchanged", () => {
    const c = unitControl();
    (c.report["recordingBinding"] as Record<string, unknown>)["claimMode"] =
      "current-replay";
    const current = c.inspection.sourceReader.current;
    c.inspection.sourceReader.current = (name) =>
      name === "packages/openclinxr/xr-station/src/station-stretcher.ts"
        ? Buffer.from("changed deck geometry")
        : current(name);
    expect(c.verify().join("\n")).toMatch(
      /current replay input changed.*station-stretcher/u,
    );
  });
  it("requires explicit video-relative clocks and the accepted support identity", () => {
    const clock = unitControl();
    clock.put("trace", {
      runId: "unit-run",
      clock: "wall-clock-ms",
      headingUnit: "degrees",
      identities: clock.identities,
      measurements: clock.measurements,
    });
    expect(clock.verify().join("\n")).toMatch(/clock\/unit/u);
    const support = unitControl();
    support.identities.supportInstanceId = "unaccepted-support";
    support.put("trace", {
      runId: "unit-run",
      clock: "video-relative-ms",
      headingUnit: "radians",
      identities: support.identities,
      measurements: support.measurements,
    });
    expect(support.verify().join("\n")).toMatch(/support\/environment/u);
  });
  it("refuses traversal, invalid refs and source inspection omission", () => {
    for (const name of [
      "../secret",
      "/absolute",
      "a/../b",
      "a//b",
      "a\\b",
      "a:b",
    ])
      expect(canonicalSourcePath(name)).toBe(false);
    expect(
      pinnedSourceReader(process.cwd()).read("--help", "tools/x.ts"),
    ).toBeInstanceOf(Error);
    const c = unitControl();
    expect(inspectClosureEvidence(c.report, c.objects, [], undefined)).toEqual([
      "source/media inspection unavailable; actual closure cannot be verified",
    ]);
  });
});
