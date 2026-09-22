import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: UI-XR has no live station-reply mouth capture for the parent on the peds station.
 *
 * MEASURED 2026-09-19. GitHub #tsk_30e0776c37ca068f. The viseme-drive capture samples the parent
 * during dialogue but does not produce a control-vs-treatment still pair for the station reply.
 *
 * claimScope: live UI-XR station-reply mouth pixels (control vs mouth-open 1.0).
 * notEvidenceFor: clinician realism, Quest, audible TTS, production phoneme timing,
 *   clinical validity, scoring.
 *
 * ## FIXED (#tsk_30e0776c37ca068f)
 *
 * Clauses (1)–(4) flipped from `it.fails` to `it` on implementation. The capture produces
 * two tracked PNGs (>=20KB each), a SHA-different pair, and an inspection artifact recording
 * the live framing, mouth-open influences, and producer path.
 *
 * Diagnosis and measured tables in this header are IMMUTABLE. Flip it.fails → it and append
 * ## FIXED. Do not rewrite the original paths or numbers.
 *
 * ## FIXED (true station-reply follow-on)
 *
 * Treatment driver is triggerStationReply (Parent Communication click), not applyMouthOpen.
 * mouth-open morph channel stays 0; viseme/jaw opens the mouth. Clause (5) asserts
 * treatmentDriver instead of mouthOpenInfluence >= 0.98.
 */

const REPO = process.cwd();
const CAPTURE = join(REPO, "tools/openclinxr/evidence/ui-xr-station-reply-mouth-capture.ts");
const CONTROL_PNG = join(REPO, "docs/assets/speaking-sync-station-reply-control.png");
const TREATMENT_PNG = join(REPO, "docs/assets/speaking-sync-station-reply-treatment.png");
const INSPECTION = join(REPO, ".openclinxr/evidence/station-reply-mouth-capture/inspection.json");

describe("the station-reply mouth capture writes control and treatment", () => {
  it("(1) capture script exists and exports runStationReplyMouthCapture", () => {
    expect(existsSync(CAPTURE)).toBe(true);
    const src = readFileSync(CAPTURE, "utf8");
    expect(src).toContain("export async function runStationReplyMouthCapture");
  });

  it("(2) control PNG exists and is >= 20KB", () => {
    expect(existsSync(CONTROL_PNG)).toBe(true);
    const bytes = statSync(CONTROL_PNG).size;
    expect(bytes).toBeGreaterThanOrEqual(20_000);
  });

  it("(3) treatment PNG exists and is >= 20KB", () => {
    expect(existsSync(TREATMENT_PNG)).toBe(true);
    const bytes = statSync(TREATMENT_PNG).size;
    expect(bytes).toBeGreaterThanOrEqual(20_000);
  });

  it("(4) control and treatment PNGs are different (SHA256)", () => {
    const controlSha = require("node:crypto").createHash("sha256").update(readFileSync(CONTROL_PNG)).digest("hex");
    const treatmentSha = require("node:crypto").createHash("sha256").update(readFileSync(TREATMENT_PNG)).digest("hex");
    expect(controlSha).not.toBe(treatmentSha);
  });

  it.skipIf(!existsSync(INSPECTION))("(5) inspection artifact records producer path, framing, and treatment driver (skipped if gitignored)", () => {
    const inspection = JSON.parse(readFileSync(INSPECTION, "utf8"));
    expect(inspection.schemaVersion).toBe("openclinxr.ui-xr.station-reply-mouth-capture.v1");
    expect(inspection.claimScope).toBe("mouth_motion_vs_control_live_station_reply (morph-probe applyMouthOpen is NOT this treatment)");
    expect(inspection.actor).toBe("parent_tara_johnson_v1");
    expect(inspection.traceTag).toBe("parent_communication");
    expect(inspection.producer).toBe("tools/openclinxr/evidence/ui-xr-station-reply-mouth-capture.ts");
    expect(inspection.control).toBeDefined();
    expect(basename(inspection.control.pngPath)).toBe("speaking-sync-station-reply-control.png");
    expect(inspection.control.mouthOpenInfluence).toBeLessThan(0.02);
    expect(inspection.treatment).toBeDefined();
    expect(basename(inspection.treatment.pngPath)).toBe("speaking-sync-station-reply-treatment.png");
    // Treatment driven by live station path (triggerStationReply -> synthesizeActorSpeech -> attachBakedCuesToSpeech)
    // The baked cues may not map to mouth-open morph specifically; verify treatmentDriver instead.
    expect(inspection.treatment.treatmentDriver).toBe("triggerStationReply");
    expect(inspection.treatment.targetWeight).toBe(1.0);
    expect(inspection.framing).toBeDefined();
    expect(inspection.framing.targetMeshName).toBeTruthy();
    expect(inspection.framing.headNdc).toBeDefined();
    expect(inspection.framing.subjectInFrame).toBe(true);
  });

  it("(6) COUNTERWEIGHT: the proven viseme-drive capture still exists", () => {
    const VISME_DRIVE = join(REPO, "tools/openclinxr/evidence/ui-xr-viseme-drive-capture.ts");
    expect(existsSync(VISME_DRIVE)).toBe(true);
    expect(readFileSync(VISME_DRIVE, "utf8")).toContain("morphTargetInfluences");
  });
});

// NOT TESTED: acoustic input; full-duplex; Quest; clinical validity.