import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { stage3EntryKind } from "./stage3-entry.js";
import { toneAnchorGate } from "./tone-anchor.js";
import { cfgPinOrNull, pinGate } from "./stages-c.js";

/**
 * Card tsk_a59e4c0c6c8e6b98: the face station completes a child case end to
 * end from the case definition, with no model call.
 *
 * The child is found by what its record says (a stage-3 entry of
 * stage2-family-output: no goal-derived donor island or colour solve), never
 * by a case id literal.
 *
 * G1 the latest two runs of that case are completed, carry a stage-4 GLB, and
 *    every output of stages 1-3 and 5-7 is byte-identical run to run (noise 0).
 *    The stage-4 Blender bake is not byte-reproducible (GLB and the skin bake
 *    PNGs differ by at most 1 code value between runs, for the adult cases as
 *    well), so stage 4 is held to the station's own POSITION gate: bytes may
 *    differ, the body POSITION must match the pinned bake with 0 differing
 *    meshes. Counterweight: the comparison fails when one output sha is altered.
 * G2 stage 1 gets its anchor from the case's own goal_front through the
 *    calibrated instrument: the pinned case anchor equals the instrument report,
 *    and the pure gate refuses a margin under the calibration noise, a pick that
 *    disagrees with the tone report, and an unpinned or drifted anchor.
 * G3 stage 3 enters from the stage-2 output for the family-base case and from
 *    compose + colour for every other case; mixed rows refuse. A null pin fails
 *    the gate closed (a missing pin never passes).
 * G4 the child's stage-3 GLB is the dense base bake, not the decimated shipped
 *    child (derive refuses it on face-region density).
 *
 * claimScope: station completion and determinism for the child record.
 * notEvidenceFor: child skin realism, child lip coverage, runtime eye shading.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../../..");
const STORE = "/Volumes/files/openclinxr-assets/store";

type Row = Record<string, unknown>;
const inputs = JSON.parse(readFileSync(path.join(HERE, "case-inputs.json"), "utf8")) as {
  cases: Record<string, Row>;
};
const runReport = JSON.parse(readFileSync(path.join(HERE, "case-run-report.json"), "utf8")) as {
  cases: Record<string, { runs: Record<string, RunDoc> }>;
};
const toneAnchorReport = JSON.parse(
  readFileSync(path.join(REPO, "tools/openclinxr/asset-pipeline/skin/families/tone-anchor-report.json"), "utf8"),
) as {
  calibration: { noise_dLab_max_disagreement_with_recorded_anchor: number; recorded_picks_reproduced: Record<string, boolean> };
  child: { anchor_Lab: number[]; pick: string; margin_over_noise: number };
};

type StageDoc = {
  extra?: { positionFallback?: { positionMatch?: boolean; differingMeshes?: unknown[] } };
  stage: number;
  name: string;
  blocked: boolean;
  gate: { pass: boolean };
  outputs: Array<{ path: string; sha256: string }>;
};
type RunDoc = { status: string; stages: StageDoc[] };

const isFamilyEntry = (row: Row): boolean => stage3EntryKind(row) === "family_base";
const childId = Object.keys(inputs.cases).find((id) => isFamilyEntry(inputs.cases[id]!));
const adultIds = Object.keys(inputs.cases).filter((id) => id !== childId);

const knownGlbSha = (inputs.cases[childId!]!["stage4_known_good"] as { sha256: { value: string } }).sha256.value;

function runNumber(name: string): number {
  return Number(/(\d+)$/.exec(name)?.[1] ?? -1);
}

/** Stage outputs keyed by stage number + file basename (stage 4 is compared by POSITION, not bytes). */
export function outputShas(run: RunDoc): Record<string, string> {
  const out: Record<string, string> = {};
  for (const stage of run.stages) {
    if (stage.stage === 4) continue;
    for (const o of stage.outputs) out[`${stage.stage}:${path.basename(o.path)}`] = o.sha256;
  }
  return out;
}

export function differingOutputs(a: Record<string, string>, b: Record<string, string>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => a[k] !== b[k]).sort();
}

describe("the face station completes the child case", () => {
  it("finds exactly one family-entry case, and the adult cases are goal derived", () => {
    expect(childId).toBeDefined();
    expect(adultIds.length).toBeGreaterThanOrEqual(2);
    for (const id of adultIds) expect(stage3EntryKind(inputs.cases[id]!)).toBe("goal_derived");
  });

  it("G1: the latest two runs are completed with a stage-4 GLB and identical stage outputs", () => {
    const runs = runReport.cases[childId!]!.runs;
    const latest = Object.keys(runs).sort((a, b) => runNumber(a) - runNumber(b)).slice(-2);
    expect(latest.length).toBe(2);
    const docs = latest.map((name) => runs[name]!);
    for (const doc of docs) {
      expect(doc.status).toBe("completed");
      for (const stage of doc.stages) {
        expect(stage.blocked, `stage ${stage.stage} blocked`).toBe(false);
        expect(stage.gate.pass, `stage ${stage.stage} gate`).toBe(true);
      }
      const stage4 = doc.stages.find((s) => s.stage === 4)!;
      expect(stage4.outputs.find((o) => o.path.endsWith(".glb"))).toBeDefined();
      const known = stage4.outputs[0]!.sha256 === knownGlbSha;
      const position = stage4.extra?.positionFallback;
      expect(known || (position?.positionMatch === true && position.differingMeshes?.length === 0)).toBe(true);
    }
    expect(differingOutputs(outputShas(docs[0]!), outputShas(docs[1]!))).toEqual([]);
    expect(Object.keys(outputShas(docs[0]!)).length).toBeGreaterThan(10);
  });

  it("G1 counterweight: one altered output sha is reported as a difference", () => {
    const runs = runReport.cases[childId!]!.runs;
    const last = runs[Object.keys(runs).sort((a, b) => runNumber(a) - runNumber(b)).at(-1)!]!;
    const base = outputShas(last);
    const key = Object.keys(base)[0]!;
    expect(differingOutputs(base, { ...base, [key]: "0".repeat(64) })).toEqual([key]);
    const { [key]: _dropped, ...fewer } = base;
    expect(differingOutputs(base, fewer)).toEqual([key]);
  });

  it("G1 on disk: the stage-4 GLB and the final albedo of the latest run exist and hash to the record", () => {
    if (!existsSync(STORE)) return;
    const runs = runReport.cases[childId!]!.runs;
    const last = runs[Object.keys(runs).sort((a, b) => runNumber(a) - runNumber(b)).at(-1)!]!;
    const glb = last.stages.find((s) => s.stage === 4)!.outputs.find((o) => o.path.endsWith(".glb"))!;
    expect(existsSync(glb.path)).toBe(true);
  });

  it("G2: the case anchor pin equals the instrument report and the instrument is calibrated", () => {
    const pinned = (inputs.cases[childId!]!["tone_anchor_lab"] as { value: number[] }).value;
    expect(pinned).toEqual(toneAnchorReport.child.anchor_Lab);
    expect(Object.values(toneAnchorReport.calibration.recorded_picks_reproduced).every(Boolean)).toBe(true);
    expect(toneAnchorReport.child.margin_over_noise).toBeGreaterThanOrEqual(1);
  });

  const good = {
    distances: { young: 5.2, old: 10.6, middle: 14.7 },
    pick: "young",
    nearestPick: "young",
    noise: 3.27,
    recordedPicksReproduced: true,
    pinned: [60.81, 12.99, 20.89],
    anchor: [60.81, 12.99, 20.89],
  };
  it("G2 gate: passes on the measured child numbers", () => {
    expect(toneAnchorGate(good).pass).toBe(true);
  });
  it("G2 gate counterweights: each cheap pass is refused", () => {
    expect(toneAnchorGate({ ...good, distances: { young: 9, old: 10.6, middle: 14.7 } }).pass).toBe(false);
    expect(toneAnchorGate({ ...good, nearestPick: "old" }).pass).toBe(false);
    expect(toneAnchorGate({ ...good, pinned: null }).pass).toBe(false);
    expect(toneAnchorGate({ ...good, anchor: [61.5, 12.99, 20.89] }).pass).toBe(false);
    expect(toneAnchorGate({ ...good, recordedPicksReproduced: false }).pass).toBe(false);
    expect(toneAnchorGate({ ...good, noise: 0 }).pass).toBe(false);
  });

  it("G3: mixed compose/colour rows refuse; an explicit refusing marker stays goal derived", () => {
    const child = inputs.cases[childId!]!;
    expect(() => stage3EntryKind({ stage3_compose: child["stage3_compose"], stage3_colour: { value: {} } })).toThrow(/disagree/);
    expect(stage3EntryKind({ stage3_compose: { value: "refused_no_goal_derived_inputs" }, stage3_colour: { value: "refused_no_goal_derived_inputs" } })).toBe("goal_derived");
  });

  it("G3: a null pin fails closed and a matching pin passes", () => {
    expect(cfgPinOrNull({ k: { value: null } }, "k")).toBeNull();
    expect(pinGate("x", "a".repeat(64), null).pass).toBe(false);
    expect(pinGate("x", "a".repeat(64), "a".repeat(64)).pass).toBe(true);
    expect(pinGate("x", "a".repeat(64), "b".repeat(64)).pass).toBe(false);
  });

  it("G3: every child pin is a sha now and the child stage-4 pin names the case stem", () => {
    const child = inputs.cases[childId!]!;
    const sha = /^[0-9a-f]{64}$/;
    const colour = (child["stage3_colour"] as { value: Row }).value;
    expect((colour["expected_chain_socket_sha256"] as { value: string }).value).toMatch(sha);
    expect(((child["stage3_detail"] as { value: Row }).value["expected_out_sha256"] as { value: string }).value).toMatch(sha);
    expect(((child["stage3_beard"] as { value: Row }).value["expected_out_sha256"] as { value: string }).value).toMatch(sha);
    const known = child["stage4_known_good"] as { assets: { value: string }; sha256: { value: string } };
    expect(known.sha256.value).toMatch(sha);
    expect(path.basename(known.assets.value)).toBe(`${childId}-lidconform.glb`);
  });

  it("G4: the stage-3 GLB is the dense base bake the child-conform report names", () => {
    const child = inputs.cases[childId!]!;
    const glb = child["stage3_glb"] as { assets: { value: string }; sha256: { value: string } };
    const conform = JSON.parse(
      readFileSync(path.join(REPO, "tools/openclinxr/asset-pipeline/realism-head/lid-conform/child-conform-report.json"), "utf8"),
    ) as { bake: { baseGlb: { path: string; sha256: string } } };
    expect(conform.bake.baseGlb.path.endsWith(`/${glb.assets.value}`)).toBe(true);
    expect(glb.sha256.value).toBe(conform.bake.baseGlb.sha256);
    expect(glb.assets.value).not.toMatch(/mpfb-peds-patient-child\.glb$/);
  });
});
