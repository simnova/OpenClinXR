/**
 * The renders ride the lidconform bake, never final.glb.
 *
 * Handback 9: every POST body2 render was captured on the wrong GLB
 * (face-station-cases/body2/final.glb, the r2 bake before iris-neutral
 * and lid-conform). Body2 renders ride the current run3 lidconform bake;
 * aisha keeps her run2 bake. final.glb stays pinned only as the
 * derive/UV-mask stage input (chain-manifest subject glb_sha256).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { repoRoot } from "@openclinxr/factory-station-core/runner";
/** Relocated evidence: skin sources stay under tools/ (S4); anchor via the repo-root helper (S5). */
const DIR = path.join(repoRoot(), "tools/openclinxr/asset-pipeline/skin/face-replay");
const REPORT = path.join(DIR, "wrinkle-scale-report.json");
const MANIFEST = path.join(DIR, "chain-manifest.json");

const GLB_BODY2_SHA = "bdb051938777cde567825a8e7b5e993d3ea1f84b442c0d7903828c4f096ce83b";
const GLB_AISHA_SHA = "0fbaf4c69c689197be180fff237a53d6df3f9813d21e548dd0cad004b73c4a2d";
const GLB_FINAL_SHA = "94a9ca6c81d47fe06561a3cfa6914b909eb936d7cf74387d0975a1a0027bc437";

type GlbRec = { path: string; sha256: string };
type RenderRec = { path: string; sha256: string; glb?: GlbRec };

function loadReport(): {
  pre: { render_body2: RenderRec; render_aisha: RenderRec };
  post: { body2: RenderRec; aisha: RenderRec };
  renders: RenderRec[];
} {
  return JSON.parse(fs.readFileSync(REPORT, "utf8")) as {
    pre: { render_body2: RenderRec; render_aisha: RenderRec };
    post: { body2: RenderRec; aisha: RenderRec };
    renders: RenderRec[];
  };
}

function subjectOf(p: string): string {
  if (p.includes("body2")) return "body2";
  if (p.includes("aisha")) return "aisha";
  throw new Error(`cannot tell subject of cited render: ${p}`);
}

/** Every render the report cites, with its recorded GLB. */
function citedRenders(): { subject: string; rec: RenderRec }[] {
  const r = loadReport();
  const out: { subject: string; rec: RenderRec }[] = [
    { subject: "body2", rec: r.pre.render_body2 },
    { subject: "aisha", rec: r.pre.render_aisha },
    { subject: "body2", rec: r.post.body2 },
    { subject: "aisha", rec: r.post.aisha },
  ];
  for (const rec of r.renders) {
    if (rec.glb) out.push({ subject: subjectOf(rec.path), rec });
  }
  return out;
}

function siblingRenderJson(renderPng: string): string {
  const base = renderPng.replace(/-front\.png$/, ".json");
  if (base === renderPng) throw new Error(`not a front render: ${renderPng}`);
  return base;
}

describe("the renders ride the lidconform bake", () => {
  it("every cited body2 render records the run3 GLB sha", () => {
    for (const { subject, rec } of citedRenders()) {
      if (subject !== "body2") continue;
      expect(rec.glb).toBeDefined();
      expect(rec.glb!.path.endsWith("body2-lidconform.glb")).toBe(true);
      expect(rec.glb!.path.endsWith("final.glb")).toBe(false);
      expect(rec.glb!.sha256).toBe(GLB_BODY2_SHA);
    }
  });

  it("every cited aisha render records her run2 GLB sha", () => {
    for (const { subject, rec } of citedRenders()) {
      if (subject !== "aisha") continue;
      expect(rec.glb).toBeDefined();
      expect(rec.glb!.path.endsWith("aisha-lidconform.glb")).toBe(true);
      expect(rec.glb!.sha256).toBe(GLB_AISHA_SHA);
    }
  });

  it("report GLB shas match the render JSONs that recorded them", () => {
    for (const { rec } of citedRenders()) {
      const sib = siblingRenderJson(rec.path);
      expect(fs.existsSync(sib)).toBe(true);
      const cap = JSON.parse(fs.readFileSync(sib, "utf8")) as {
        glb: { path: string; sha256: string };
      };
      expect(rec.glb!.sha256).toBe(cap.glb.sha256);
      expect(rec.glb!.path).toBe(cap.glb.path);
    }
  });

  it("final.glb stays pinned only as the UV-mask stage input", () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as {
      subjects: Record<string, { glb_sha256: string }>;
    };
    expect(manifest.subjects.adult_male_street_casual.glb_sha256)
      .toBe(GLB_FINAL_SHA);
    for (const { rec } of citedRenders()) {
      expect(rec.glb!.path.endsWith("final.glb")).toBe(false);
      expect(rec.glb!.sha256).not.toBe(GLB_FINAL_SHA);
    }
  });
});
