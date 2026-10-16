import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// Arch: this gate imports exactly one colocated helper (./catchlight-png.js,
// unreachable from the package entrypoint, so it does not count toward
// testInternalImports — same posture as skin-shader/png-crop.js and the
// cornea gate test) plus node builtins. It NEVER imports
// ./rig-key-globe-env.js or ../isolated-subject-rig-variants.js: both are
// entrypoint-reachable and the ceiling (10) must not rise, so the build is
// pinned by source hash + source text instead of by import.
import {
  centroid,
  connectedWhere,
  countChangedPx,
  decodePngFile,
  dilatePixels,
  luminanceLStar,
  meanLStarOf,
  rectFromArray,
  type CropRect,
  type DecodedPng,
  type Pixel,
} from "./catchlight-png.js";

const here = dirname(fileURLToPath(import.meta.url));
const reportPath = join(here, "catchlight-key-report.json");
const moduleRel = "./rig-key-globe-env.ts";
const modulePath = join(here, moduleRel);
const callSiteRel = "../isolated-subject-rig-variants.ts";
const callSitePath = join(here, callSiteRel);
const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
  module: string;
  moduleSha256: string;
  callSite: string;
  callSiteSha256: string;
  rig: string;
  rigSha256: string;
  store: string;
  subjects: Record<string, { glb: string; glbSha256: string }>;
  spotDefinition: string;
  eyes: Record<string, {
    seed: [number, number]; iris: [number, number, number]; pupil_r: number; sclera_n: number;
    pre_spot: [number, number, number, number]; pre_maxD: number;
    key_pred: [number, number]; key_theta_deg: number; key_radius_px: number; key_tol: number;
    post_spot: [number, number, number]; post_maxD: number;
    key_dist: number; key_verdict: string; fals_pred_off_pupil: number;
    wash_pred: [number, number]; wash_radius_px: number; wash_tol: number; wash_dist: number; wash_verdict: string;
    halo: { post_n: number; pre_n: number; post_on_sclera: number; post_maxR: number };
  }>;
  g2: Record<string, {
    pred0?: [number, number]; pred1?: [number, number]; dPred?: [number, number];
    meas0?: [number, number, number]; meas1?: [number, number, number]; dMeas?: [number, number];
    directionCos?: number; motionPx?: number; verdict?: string;
    override?: unknown; readback?: { keyReplaced?: unknown; sourceNames?: unknown };
  }>;
  g3: boolean;
  g4: {
    skin: Record<string, { crops: Record<string, [number, number, number, number]>; headBoxPx: unknown } & Record<string, { rect: [number, number, number, number]; changed: number; meanL_pre: number; meanL_post: number; verdict: string } | unknown>>;
    sclera: Record<string, { post06: number; post00: number; pre06: number; dPost: number; dPrePost06: number; verdict: string }>;
  };
  probe: { roomEnvRestored: string; preShaMatch: boolean; probeVsPreChangedTotal: number; verdict: string };
  falsifier: { predictedOnPupil: boolean; note: string };
  verdicts: Record<string, string>;
  renders: Record<string, { png: string; sha256: string }>;
  storeShas: Record<string, string>;
};
const sha256File = (p: string): string =>
  createHash("sha256").update(readFileSync(p)).digest("hex");

const STORE = report.store;
const storeExists = existsSync(STORE);
const STEM: Record<string, string> = { aisha: "ck-aisha", body2: "ck-body2" };

function irisCircle(off: DecodedPng, seed: [number, number]): { cx: number; cy: number; r: number } {
  const full: CropRect = { x0: 0, y0: 0, x1: off.w, y1: off.h };
  const comp = connectedWhere(full, seed[0], seed[1], (x, y) => luminanceLStar(off, x, y) < 45);
  const c = centroid(comp);
  let rr = 0;
  for (const p of comp) rr += Math.hypot(p.x - c.x, p.y - c.y);
  return { cx: c.x, cy: c.y, r: (rr / Math.max(comp.length, 1)) * 1.15 };
}

function spotSet(on: DecodedPng, off: DecodedPng, cx: number, cy: number, r: number): Pixel[] {
  if (on.w !== off.w || on.h !== off.h) throw new Error("spot diff dimension mismatch");
  const out: Pixel[] = [];
  for (let y = 0; y < on.h; y += 1) {
    for (let x = 0; x < on.w; x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      if (luminanceLStar(on, x, y) - luminanceLStar(off, x, y) >= 25) out.push({ x, y });
    }
  }
  return out;
}

function scleraSet(opening: DecodedPng, seed: [number, number], pad: number): Pixel[] {
  const full: CropRect = { x0: 0, y0: 0, x1: opening.w, y1: opening.h };
  const core = connectedWhere(full, seed[0], seed[1], (x, y) => luminanceLStar(opening, x, y) < 60);
  return dilatePixels(core, full, 12).filter((p) => luminanceLStar(opening, p.x, p.y) >= 70);
}

describe("the rig-built env places the reflection (catchlight-key)", () => {
  it("report pins the module, call site, and rig by hash", () => {
    expect(report.module).toBe("packages/openclinxr/xr-scene/src/cornea-env/rig-key-globe-env.ts");
    expect(sha256File(modulePath)).toBe(report.moduleSha256);
    expect(report.callSite).toBe("packages/openclinxr/xr-scene/src/isolated-subject-rig-variants.ts");
    expect(sha256File(callSitePath)).toBe(report.callSiteSha256);
  });

  it("G5: the new module builds from rig data — no generic room, no spot literals", () => {
    const src = readFileSync(modulePath, "utf8");
    expect(src, "no generic-room source in the new module").not.toMatch(/RoomEnvironment/);
    expect(src, "no pixel literals").not.toMatch(/[0-9]+\s*pixels?\b/i);
    expect(src, "no degree literals").not.toMatch(/[0-9][^/\n\"']*\bdeg\b/i);
    for (const [i, line] of src.split("\n").entries()) {
      expect(
        /spot|centroid|catchlight/i.test(line) && /[0-9]+\.[0-9]+/.test(line),
        `spot line ${i + 1} carries a numeric literal: ${line.trim().slice(0, 80)}`,
      ).toBe(false);
    }
    expect(src, "PMREM sigma kept").toMatch(/RIG_ENV_PMREM_SIGMA = 0\.04/);
    expect(src, "area loci use power over area").toMatch(/light\.energy \/ area/);
  });

  it("call site swaps the globe source only (studio path keeps its room)", () => {
    const src = readFileSync(callSitePath, "utf8");
    const fnIdx = src.indexOf("export async function applyProductRig");
    expect(fnIdx, "applyProductRig present").toBeGreaterThanOrEqual(0);
    const body = src.slice(fnIdx);
    expect(body, "rig-built globe map on the product path").toMatch(/buildProductRigGlobeEnvMap/);
    expect(body, "no generic room on the product path").not.toMatch(/RoomEnvironment/);
    expect(src, "studio path untouched").toMatch(/new RoomEnvironment\(\)/);
  });

  it(storeExists ? "G1+G3: measured spot matches the report and stays in the disc" : "store absent — G1/G3 skipped", () => {
    if (!storeExists) return;
    for (const [eyeKey, g] of Object.entries(report.eyes)) {
      const [subj, view] = eyeKey.split(".");
      const stem = STEM[subj!]!;
      const on06 = decodePngFile(join(STORE, `post-${stem}-06-${view}.png`));
      const off00 = decodePngFile(join(STORE, `post-${stem}-00-${view}.png`));
      expect(on06.w, `${eyeKey} width`).toBe(1280);
      const circle = irisCircle(off00, g.seed);
      expect(circle.cx, `${eyeKey} iris cx`).toBeCloseTo(g.iris[0], 0);
      expect(circle.cy, `${eyeKey} iris cy`).toBeCloseTo(g.iris[1], 0);
      expect(circle.r, `${eyeKey} iris r`).toBeCloseTo(g.iris[2], 0);
      const set = spotSet(on06, off00, circle.cx, circle.cy, circle.r);
      expect(set.length, `${eyeKey} spot count`).toBeGreaterThan(0);
      expect(Math.abs(set.length - g.post_spot[2]), `${eyeKey} spot count pinned`).toBeLessThanOrEqual(5);
      const c = centroid(set);
      expect(c.x, `${eyeKey} spot cx`).toBeCloseTo(g.post_spot[0], 0);
      expect(c.y, `${eyeKey} spot cy`).toBeCloseTo(g.post_spot[1], 0);
      // G3 (card-literal): the spot IS the in-disc set, so every spot pixel
      // lies in the circle by construction; the test pins the count and the
      // recorded peri-ocular halo (outside-disc lift on lash-line tissue,
      // near-zero on sclera) as regression data without gating on it.
      expect(set.every((p) => Math.hypot(p.x - circle.cx, p.y - circle.cy) <= circle.r + 1e-9), `${eyeKey} G3 in-disc`).toBe(true);
      expect(report.eyes[eyeKey]!.halo.post_on_sclera, `${eyeKey} halo off sclera`).toBeLessThanOrEqual(3);
      // G1 key verdict pinned: recomputed distance clears the tolerance by 2+ px.
      const d = Math.hypot(c.x - g.key_pred[0], c.y - g.key_pred[1]);
      expect(d, `${eyeKey} key dist pinned`).toBeCloseTo(g.key_dist, 0);
      expect(d - g.key_tol, `${eyeKey} key shortfall pinned`).toBeGreaterThan(2);
      expect(g.key_verdict, `${eyeKey} key verdict recorded`).toBe("fail");
      expect(report.verdicts["G1_key"]).toBe("fail");
    }
    expect(report.g3).toBe(true);
  });

  it(storeExists ? "G2: the key moves in the env while the spot stays put" : "store absent — G2 skipped", () => {
    if (!storeExists) return;
    const rb = report.g2["readback"] as { keyReplaced?: unknown; sourceNames?: unknown };
    expect(rb.keyReplaced, "replacement engaged in the shift render").toBe(true);
    expect(rb.sourceNames, "key locus replaced").toContain("key+override");
    for (const [key, g] of Object.entries(report.g2)) {
      if (!key.startsWith("aisha.") || !g.dMeas) continue;
      const [subj, view] = key.split(".");
      const stem = STEM[subj!]!;
      const [cx, cy, r] = report.eyes[key]!.iris;
      const m0 = centroid(spotSet(
        decodePngFile(join(STORE, `post-${stem}-06-${view}.png`)),
        decodePngFile(join(STORE, `post-${stem}-00-${view}.png`)), cx, cy, r));
      const m1 = centroid(spotSet(
        decodePngFile(join(STORE, `post-${stem}-06-shift-${view}.png`)),
        decodePngFile(join(STORE, `post-${stem}-00-shift-${view}.png`)), cx, cy, r));
      const dm = [m1.x - m0.x, m1.y - m0.y];
      expect(Math.hypot(dm[0] - g.dMeas[0]!, dm[1] - g.dMeas[1]!), `${key} shift pinned`).toBeLessThanOrEqual(0.6);
      // Static: the key moves half a metre in the env while the spot does
      // not move in the image — the visible set carries no key content.
      expect(Math.hypot(dm[0], dm[1]), `${key} spot is static`).toBeLessThanOrEqual(2);
      expect(g.verdict, `${key} verdict recorded`).toBe("fail");
    }
    expect(report.verdicts["G2"]).toBe("fail");
  });

  it(storeExists ? "G4: skin pixel-identical, sclera pinned" : "store absent — G4 skipped", () => {
    if (!storeExists) return;
    for (const [viewKey, entry] of Object.entries(report.g4.skin)) {
      const [subj, view] = viewKey.split(".");
      const stem = STEM[subj!]!;
      const pre = decodePngFile(join(STORE, `pre-${stem}-06-${view}.png`));
      const post = decodePngFile(join(STORE, `post-${stem}-06-${view}.png`));
      for (const cropKey of ["cheek", "forehead"] as const) {
        const rec = (entry as Record<string, { rect: [number, number, number, number]; changed: number; meanL_pre: number; meanL_post: number; verdict: string }>)[cropKey]!;
        const rect = rectFromArray(rec.rect);
        expect(countChangedPx(pre, post, rect), `${viewKey} ${cropKey} identical`).toBe(0);
        expect(rec.changed).toBe(0);
        expect(rec.verdict).toBe("pass");
      }
    }
    expect(report.verdicts["G4_skin"]).toBe("pass");
    for (const [eyeKey, s] of Object.entries(report.g4.sclera)) {
      const [subj, view] = eyeKey.split(".");
      const stem = STEM[subj!]!;
      const seed = report.eyes[eyeKey]!.seed;
      const off = decodePngFile(join(STORE, `post-${stem}-00-${view}.png`));
      const set = scleraSet(off, seed, 0);
      const on = decodePngFile(join(STORE, `post-${stem}-06-${view}.png`));
      const pre = decodePngFile(join(STORE, `pre-${stem}-06-${view}.png`));
      // Cross-implementation set noise (TS vs PIL L* flips boundary pixels
      // of the <60 opening) moves means ~0.08; verdict margins are 0.29+.
      const mOn = meanLStarOf(on, set), mOff = meanLStarOf(off, set), mPre = meanLStarOf(pre, set);
      expect(mOn, `${eyeKey} sclera post06`).toBeCloseTo(s.post06, 0);
      expect(mOff, `${eyeKey} sclera post00`).toBeCloseTo(s.post00, 0);
      expect(mPre, `${eyeKey} sclera pre06`).toBeCloseTo(s.pre06, 0);
      expect(Math.abs(mOn - mPre), `${eyeKey} sclera delta pinned`).toBeCloseTo(Math.abs(s.post06 - s.pre06), 0);
      expect(s.verdict).toBe(Math.abs(s.post06 - s.pre06) <= 1.9 ? "pass" : "fail");
    }
  });

  it(storeExists ? "probe: RoomEnvironment restore is bit-identical to PRE" : "store absent — probe skipped", () => {
    if (!storeExists) return;
    const probe = decodePngFile(join(STORE, report.probe.roomEnvRestored));
    const pre = decodePngFile(join(STORE, "pre-ck-aisha-06-front.png"));
    expect(probe.w).toBe(1280);
    expect(countChangedPx(probe, pre, { x0: 0, y0: 0, x1: probe.w, y1: probe.h }), "probe == PRE").toBe(0);
    expect(sha256File(join(STORE, report.probe.roomEnvRestored))).toBe(report.renders[report.probe.roomEnvRestored]!.sha256);
    expect(report.probe.preShaMatch).toBe(true);
    expect(report.verdicts["probe"]).toBe("pass");
  });

  it(storeExists ? "store shas verify (assets:catchlight-key/)" : "store absent — sha verification skipped", () => {
    if (!storeExists) return;
    for (const [name, want] of Object.entries(report.storeShas)) {
      const p = join(STORE, name);
      expect(existsSync(p), `store file present: ${name}`).toBe(true);
      expect(sha256File(p), `sha of ${name}`).toBe(want);
    }
    for (const [name, rec] of Object.entries(report.renders)) {
      expect(report.storeShas[name], `render sha recorded: ${name}`).toBe(rec.sha256);
    }
  });
});
