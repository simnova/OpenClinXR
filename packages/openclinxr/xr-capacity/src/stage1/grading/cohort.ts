import { gradeCohort, median, quantile } from "../../stage0/reducer.js";
import { parseStage1Record } from "./parse.js";
import { gradeStage1Run, stage1ReleaseReasons } from "./run.js";
import type { Stage1Distribution, Stage1PairedDescription, Stage1Record, Stage1Release } from "./types.js";

function distribution(values: number[]): Stage1Distribution {
  if (!values.length || !values.every(Number.isFinite)) return { count: values.length, mean: null, median: null, p95: null, maximum: null };
  return { count: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length, median: median(values), p95: quantile(values, .95), maximum: Math.max(...values) };
}
function describe(record: Stage1Record | undefined) {
  if (!record) return null;
  const rows = record.xr.frames.filter(f => f.phase === 2);
  return { nonce: record.xr.identity.nonce, cadence: distribution(rows.slice(1).map((r, i) => r.receipt - rows[i]!.receipt)), cpu: distribution(rows.map(r => r.updateMs + r.submissionMs)) };
}
/** Input order is the released schedule; never sort/retry/select or pool conditions. */
export function gradeStage1Cohort(values: unknown[], release: Stage1Release) {
  const runs = values.map(r => gradeStage1Run(r, release));
  const reasons = stage1ReleaseReasons(release), records: Array<Stage1Record | null> = values.map(v => { try { return parseStage1Record(v); } catch { return null; } });
  if (reasons.length) return { candidatePass: false, valid: false, reasons, runs, modes: { off: null, duplex: null }, pairs: [], interpretation: "Invalid release; no replacement profile or pooled grade was manufactured.", notEvidenceFor: ["physical readiness"] };
  if (values.length !== 6 || new Set(records.map(r => r?.xr.identity.nonce)).size !== 6 || records.some((r, i) => !r || r.slot.nonce !== release.slots[i]?.nonce || r.mode !== release.slots[i]?.mode || r.slot.pair !== release.slots[i]?.pair || r.slot.position !== release.slots[i]?.position)) reasons.push("cohort-not-six-unique-ordered-slots");
  const off = records.filter((r): r is Stage1Record => r?.mode === "off"), duplex = records.filter((r): r is Stage1Record => r?.mode === "duplex");
  const modes = { off: gradeCohort(off.map(r => r.xr), release), duplex: gradeCohort(duplex.map(r => r.xr), release) };
  const pairs: Stage1PairedDescription[] = ([1, 2, 3] as const).map(pair => {
    const matched = records.filter((r): r is Stage1Record => r?.slot.pair === pair), a = describe(matched.find(r => r.mode === "off")), b = describe(matched.find(r => r.mode === "duplex"));
    return { pair, order: matched.map(r => r.mode), off: a, duplex: b, meanDifferences: {
      callbackIntervalMs: a?.cadence.mean !== null && a?.cadence.mean !== undefined && b?.cadence.mean !== null && b?.cadence.mean !== undefined ? b.cadence.mean - a.cadence.mean : null,
      xrMainThreadWallMs: a?.cpu.mean !== null && a?.cpu.mean !== undefined && b?.cpu.mean !== null && b?.cpu.mean !== undefined ? b.cpu.mean - a.cpu.mean : null,
    } };
  });
  const evidenceValid = reasons.length === 0 && runs.every(r => r.valid);
  if (!modes.off.candidatePass) reasons.push("off-three-run-repeatability-or-hard-gate");
  if (!modes.duplex.candidatePass) reasons.push("duplex-three-run-repeatability-or-hard-gate");
  return { candidatePass: reasons.length === 0 && runs.every(r => r.candidatePass), valid: evidenceValid, reasons, runs, modes, pairs,
    interpretation: "Three matched fresh OFF/duplex pairs with separate unchanged Stage0 hard and repeatability gates. Mean differences describe raw XR callback/main-thread spans only; no quantile subtraction or across-mode hard budget.",
    notEvidenceFor: ["physical speaker output or acoustic latency", "DAC underruns", "compositor/display FPS", "native CPU/GPU time or VRAM", "maximum capacity or thermal envelope", "clinical/scoring/exam validity"] };
}
