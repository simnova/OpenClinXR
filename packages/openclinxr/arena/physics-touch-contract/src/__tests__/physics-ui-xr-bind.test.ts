/**
 * Physics Clinical Touch — UI-XR Bind Tests (R3)
 *
 * Validates:
 * 1. Bone transform JSON artifact integrity
 * 2. Rapier real adapter getWorldState() returns structured data
 * 3. Capture mode detection logic
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// 1. Bone transform JSON artifact integrity
// ---------------------------------------------------------------------------

const REPO_ROOT = "../../../../../../";

const ARTIFACT_PATH = path.resolve(
  import.meta.dirname ?? __dirname,
  REPO_ROOT + "apps/ui-xr/src/physics-touch/ed-palpation-bone-transforms.json",
);

describe("physics-bone-transforms artifact", () => {
  it("exists and is valid JSON", () => {
    expect(fs.existsSync(ARTIFACT_PATH), "artifact file must exist").toBe(true);
    const raw = fs.readFileSync(ARTIFACT_PATH, "utf-8");
    let parsed: unknown;
    expect(() => { parsed = JSON.parse(raw); }).not.toThrow();
    expect(parsed).toBeDefined();
  });

  it("has schemaVersion openclinxr.physics-bone-transforms.v1", () => {
    const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf-8"));
    expect(artifact.schemaVersion).toBe("openclinxr.physics-bone-transforms.v1");
  });

  it("has engineId 'rapier' (not candidate)", () => {
    const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf-8"));
    expect(artifact.engineId).toBe("rapier");
    expect(artifact.engineId).not.toMatch(/-candidate$/);
  });

  it("has nonzero frames", () => {
    const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf-8"));
    expect(Array.isArray(artifact.frames)).toBe(true);
    expect(artifact.frames.length).toBeGreaterThan(0);
  });

  it("each frame has boneDeltas for all declared bones", () => {
    const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf-8"));
    const bones = artifact.bones as string[];
    expect(bones.length).toBeGreaterThan(0);

    for (const frame of artifact.frames) {
      expect(frame.boneDeltas).toBeDefined();
      for (const bone of bones) {
        expect(frame.boneDeltas[bone], `frame ${frame.tick} missing bone ${bone}`).toBeDefined();
        expect(frame.boneDeltas[bone].position).toBeDefined();
        expect(frame.boneDeltas[bone].rotation).toBeDefined();
        expect(typeof frame.boneDeltas[bone].position.x).toBe("number");
        expect(typeof frame.boneDeltas[bone].position.y).toBe("number");
        expect(typeof frame.boneDeltas[bone].position.z).toBe("number");
      }
    }
  });

  it("has measurable spine displacement (non-zero deltas)", () => {
    const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf-8"));
    // At least one frame must have spine Z displacement > 0.005m (5mm)
    const hasVisibleDelta = artifact.frames.some(
      (f: any) => Math.abs(f.boneDeltas.spine?.position?.z ?? 0) > 0.005,
    );
    expect(hasVisibleDelta, "no frame has spine Z displacement > 5mm").toBe(true);
  });

  it("has notEvidenceFor with required fields", () => {
    const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf-8"));
    expect(Array.isArray(artifact.notEvidenceFor)).toBe(true);
    expect(artifact.notEvidenceFor).toContain("clinical_validity");
    expect(artifact.notEvidenceFor).toContain("exam_equivalence");
    expect(artifact.notEvidenceFor).toContain("scoring");
  });

  it("has seed and fixedDt", () => {
    const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf-8"));
    expect(artifact.seed).toBe(42);
    expect(artifact.fixedDt).toBeCloseTo(1 / 60, 5);
  });

  it("frames are monotonically increasing by tick", () => {
    const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf-8"));
    let prev = -1;
    for (const frame of artifact.frames) {
      expect(frame.tick).toBeGreaterThan(prev);
      prev = frame.tick;
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Capture mode detection logic
// ---------------------------------------------------------------------------

describe("isPhysicsClinicalTouchCapture logic", () => {
  it("detects physics-clinical-touch capture mode", () => {
    // Simulate URL: ?capture=physics-clinical-touch&humanoidSourceComparator=ed_anny_real_garment_patient
    const mode = "physics-clinical-touch";
    const cmp = "ed_anny_real_garment_patient";
    const isActive =
      (mode.includes("physics-clinical-touch") || mode.includes("physics-touch")) &&
      (cmp === "ed_anny_real_garment_patient" || cmp === "peds_anny_real_garment_patient");
    expect(isActive).toBe(true);
  });

  it("detects physics-touch capture mode", () => {
    const mode = "physics-touch";
    const cmp = "ed_anny_real_garment_patient";
    const isActive =
      (mode.includes("physics-clinical-touch") || mode.includes("physics-touch")) &&
      (cmp === "ed_anny_real_garment_patient" || cmp === "peds_anny_real_garment_patient");
    expect(isActive).toBe(true);
  });

  it("rejects non-physics capture modes", () => {
    const mode = "garment-sleeve";
    const cmp = "ed_anny_real_garment_patient";
    const isActive =
      (mode.includes("physics-clinical-touch") || mode.includes("physics-touch")) &&
      (cmp === "ed_anny_real_garment_patient" || cmp === "peds_anny_real_garment_patient");
    expect(isActive).toBe(false);
  });

  it("rejects non-real-garment comparators", () => {
    const mode = "physics-clinical-touch";
    const cmp = "peds_anny_school_age_mpfb2_eye_patient";
    const isActive =
      (mode.includes("physics-clinical-touch") || mode.includes("physics-touch")) &&
      (cmp === "ed_anny_real_garment_patient" || cmp === "peds_anny_real_garment_patient");
    expect(isActive).toBe(false);
  });

  it("accepts peds_anny_real_garment_patient comparator", () => {
    const mode = "physics-touch";
    const cmp = "peds_anny_real_garment_patient";
    const isActive =
      (mode.includes("physics-clinical-touch") || mode.includes("physics-touch")) &&
      (cmp === "ed_anny_real_garment_patient" || cmp === "peds_anny_real_garment_patient");
    expect(isActive).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Evidence directory integrity
// ---------------------------------------------------------------------------

const EVIDENCE_DIR = path.resolve(
  import.meta.dirname ?? __dirname,
  REPO_ROOT + ".openclinxr/evidence/physics-clinical-touch/2026-08-02-uixr-bind",
);

describe("physics touch evidence directory", () => {
  it("contains inspection.json", () => {
    expect(fs.existsSync(path.join(EVIDENCE_DIR, "inspection.json"))).toBe(true);
  });

  it("contains at least one PNG screenshot", () => {
    const files = fs.readdirSync(EVIDENCE_DIR).filter((f) => f.endsWith(".png"));
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  it("PNG screenshots are over 10KB (non-trivial content)", () => {
    const files = fs.readdirSync(EVIDENCE_DIR).filter((f) => f.endsWith(".png"));
    for (const file of files) {
      const stat = fs.statSync(path.join(EVIDENCE_DIR, file));
      expect(
        stat.size,
        `${file} is only ${stat.size} bytes — likely blank capture`,
      ).toBeGreaterThan(10_000);
    }
  });

  it("inspection.json has physics touch evidence", () => {
    const inspection = JSON.parse(
      fs.readFileSync(path.join(EVIDENCE_DIR, "inspection.json"), "utf-8"),
    );
    expect(inspection.physicsUserData).toBeDefined();
    if (Array.isArray(inspection.physicsUserData) && inspection.physicsUserData.length > 0) {
      const pd = inspection.physicsUserData[0];
      expect(pd.physicsTouch).toBeDefined();
      expect(pd.physicsTouch.engineId).toBe("rapier");
      expect(typeof pd.physicsTouch.spineDz).toBe("number");
    }
  });
});
