import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PipelineCandidate, PipelineCandidateIndex } from "@openclinxr/model-vetting";
import { describe, expect, it } from "vitest";
import {
  aggregateRealism,
  distinctRoles,
  faceRealism,
  formatMegabytes,
  formatScorePercent,
  fullRealism,
  loadPipelineCandidateIndex,
  pipelineCandidateIndexUrls,
  realismForFraming,
} from "./pipeline-admin-data.js";

const sampleIndex = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../public/sample-pipeline-candidate-index.json", import.meta.url)), "utf8"),
) as PipelineCandidateIndex;

function candidate(overrides: Partial<PipelineCandidate>): PipelineCandidate {
  return {
    candidateId: "g/a",
    group: "g",
    manifestId: "a",
    role: "nurse",
    glbPath: ".openclinxr/asset-production/anny/g/a.glb",
    sizeBytes: 1024 * 1024,
    modifiedAt: "2026-08-03T00:00:00.000Z",
    visionScore: null,
    riggingSummary: null,
    thumbnailPath: null,
    notEvidenceFor: ["clinical_validity"],
    ...overrides,
  };
}

describe("score accessors", () => {
  it("returns null when unscored", () => {
    const c = candidate({ visionScore: null });
    expect(aggregateRealism(c)).toBeNull();
    expect(fullRealism(c)).toBeNull();
    expect(faceRealism(c)).toBeNull();
  });
  it("returns aggregate but null full/face for flat scores", () => {
    const c = candidate({
      visionScore: {
        full: null,
        face: null,
        aggregateRealism_0to1: 0.34,
        aggregateClothing_0to1: 0.52,
        reason: "x",
        sourceReportPath: null,
        scoredAt: null,
        notEvidenceFor: [],
      },
    });
    expect(aggregateRealism(c)).toBeCloseTo(0.34);
    expect(fullRealism(c)).toBeNull();
    expect(realismForFraming(c, "aggregate")).toBeCloseTo(0.34);
    expect(realismForFraming(c, "full")).toBeNull();
  });
  it("returns full/face for dual-frame scores", () => {
    const c = candidate({
      visionScore: {
        full: { realism_0to1: 0.5, clothing_0to1: 0.4, reason: "f" },
        face: { realism_0to1: 0.6, clothing_0to1: 0.1, reason: "fa" },
        aggregateRealism_0to1: 0.55,
        aggregateClothing_0to1: 0.4,
        reason: "agg",
        sourceReportPath: null,
        scoredAt: null,
        notEvidenceFor: [],
      },
    });
    expect(fullRealism(c)).toBeCloseTo(0.5);
    expect(faceRealism(c)).toBeCloseTo(0.6);
    expect(realismForFraming(c, "face")).toBeCloseTo(0.6);
  });
});

describe("formatters + helpers", () => {
  it("formats score percent and dash", () => {
    expect(formatScorePercent(0.34)).toBe("34");
    expect(formatScorePercent(null)).toBe("—");
  });
  it("formats megabytes", () => {
    expect(formatMegabytes(21550404)).toBe("20.6 MB");
  });
  it("lists distinct roles sorted", () => {
    const roles = distinctRoles([candidate({ role: "parent" }), candidate({ role: "nurse" }), candidate({ role: "nurse" })]);
    expect(roles).toEqual(["nurse", "parent"]);
  });
});

describe("pipelineCandidateIndexUrls", () => {
  it("puts override first and sample fallback last", () => {
    const urls = pipelineCandidateIndexUrls("http://x/override.json");
    expect(urls[0]).toBe("http://x/override.json");
    expect(urls.at(-1)).toBe("/sample-pipeline-candidate-index.json");
  });
});

describe("loadPipelineCandidateIndex", () => {
  it("loads + validates from the first ok url", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify(sampleIndex), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const result = await loadPipelineCandidateIndex({ urls: ["/whatever"], fetchImpl });
    expect(result.index.schemaVersion).toBe("openclinxr.pipeline-candidate-index.v1");
    expect(result.index.candidates.length).toBeGreaterThan(0);
  });
  it("falls through failing urls then throws with details", async () => {
    const fetchImpl = (async (url: string) => {
      if (url === "/ok") return new Response(JSON.stringify(sampleIndex), { status: 200 });
      return new Response("nope", { status: 404 });
    }) as unknown as typeof fetch;
    const result = await loadPipelineCandidateIndex({ urls: ["/missing", "/ok"], fetchImpl });
    expect(result.loadedFromUrl).toBe("/ok");
    await expect(loadPipelineCandidateIndex({ urls: ["/missing"], fetchImpl })).rejects.toThrow(/Unable to load/);
  });
});

describe("committed sample index", () => {
  it("has 37 candidates and some scored", () => {
    expect(sampleIndex.candidates.length).toBe(37);
    expect(sampleIndex.scoredCandidateCount).toBeGreaterThan(0);
    expect(sampleIndex.notEvidenceFor).toContain("clinical_validity");
  });
});
