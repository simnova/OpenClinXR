#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const HERE = resolve("tools/openclinxr/evidence/hair-p7");
const REQUIRED = ["p7_groom.py", "cap-debug.png", "guides-debug.png", "p7-sheet.png",
  "target-vs-p7.png", "row-p7.json", "check-p7.mjs", "RESULT.txt"];

function validate(row, checkFiles = true) {
  const e = [];
  const need = (ok, id) => { if (!ok) e.push(id); };
  if (checkFiles) for (const f of REQUIRED) need(existsSync(resolve(HERE, f)), `exists:${f}`);
  need(row?.blender_version === "5.1.1", "blender-version");
  const c = row?.s0_cap || {};
  need(c.area_cm2 >= 550 && c.area_cm2 <= 750, "s0-area");
  need(c.g_line_max_step_mm <= 3.0, "s0-hairline-step");
  need(c.boundary_components === 1 && c.max_hole_cm2 <= 1.0, "s0-hole");
  need(JSON.stringify(c.scale) === "[1,1,1]", "s0-scale");
  const g = row?.s1_guides || {};
  need(g.guide_count >= 150 && g.guide_count <= 250, "s1-guide-count");
  need(g.points_per_guide === 24, "s1-points");
  need(g.forehead_crossings === 0, "s1-forehead");
  need(g.face_to_root_max_mm <= 9.0, "s1-face-cover");
  need(g.inside_collider_points === 0, "s1-inside");
  need(g.above_chin_max_mm <= 15.0, "s1-above-chin");
  need(g.below_chin_p95_mm <= 35.0, "s1-below-p95");
  need(g.below_chin_max_mm <= 60.0, "s1-below-max");
  need(g.tip_neighbour_outliers_pct < 2.0, "s1-tips");
  need(g.profile_d2_sign_changes <= 2, "s1-profile");
  const s2 = row?.s2_children || {};
  const ctl = row?.s2_diagnosis?.control_uv_sphere_8_guides || {};
  need(ctl.curves > 0, "s2-control");
  need((s2.uv_attach_readback?.u_range ?? 0) > 0.1
    && (s2.uv_attach_readback?.v_range ?? 0) > 0.1, "s2-uv-range");
  for (const p of ["2k", "50k"]) {
    need(s2.passes?.[p]?.curves > 0, `s2-${p}-curves`);
  }
  const passes = s2.passes || {};
  const keys = Object.keys(passes);
  need(keys.length === 0 || keys.every(k => passes[k]?.point_counts?.length === 1),
    "s2-uniform");
  need(s2.clump_factor === 0 && !s2.noise && !s2.frizz && !s2.curl && !s2.roll
    && !s2.duplicate, "s2-forbidden");
  if (keys.length) need(s2.profile_is_last === true, "s2-profile-last");
  const s2failed = (row?.failed?.gates || []).some(x => x.id.startsWith("s2-"));
  if (!s2failed) need(row?.s3_judge?.stop_bar_is_report_not_gate === true, "s3-report");
  return e;
}

function clone(x) { return JSON.parse(JSON.stringify(x)); }

function honestRow() {
  return {
    blender_version: "5.1.1",
    s0_cap: { area_cm2: 650, g_line_max_step_mm: 2, boundary_components: 1,
      max_hole_cm2: 0, scale: [1, 1, 1] },
    s1_guides: { guide_count: 200, points_per_guide: 24, forehead_crossings: 0,
      face_to_root_max_mm: 8, inside_collider_points: 0, above_chin_max_mm: 12,
      below_chin_p95_mm: 30, below_chin_max_mm: 55,
      tip_neighbour_outliers_pct: 1, profile_d2_sign_changes: 2 },
    s2_diagnosis: { control_uv_sphere_8_guides: { curves: 40 } },
    s2_children: { uv_attach_readback: { u_range: 0.27, v_range: 0.66 },
      passes: { "2k": { curves: 2000, point_counts: [9] },
        "50k": { curves: 50000, point_counts: [9] } },
      clump_factor: 0, noise: false, frizz: false, curl: false, roll: false,
      duplicate: false, profile_is_last: true },
    s3_judge: { stop_bar_is_report_not_gate: true },
    failed: null,
  };
}

function selfTest() {
  if (validate(honestRow(), false).length) throw new Error("honest fixture did not pass");
  console.log("PASS honest row");
  const cases = [
    ["s0-area", r => r.s0_cap.area_cm2 = 751],
    ["s0-hairline-step", r => r.s0_cap.g_line_max_step_mm = 3.01],
    ["s0-hole", r => r.s0_cap.boundary_components = 2],
    ["s0-scale", r => r.s0_cap.scale = [.1, .1, .1]],
    ["s1-guide-count", r => r.s1_guides.guide_count = 149],
    ["s1-points", r => r.s1_guides.points_per_guide = 22],
    ["s1-forehead", r => r.s1_guides.forehead_crossings = 1],
    ["s1-face-cover", r => r.s1_guides.face_to_root_max_mm = 9.01],
    ["s1-inside", r => r.s1_guides.inside_collider_points = 1],
    ["s1-above-chin", r => r.s1_guides.above_chin_max_mm = 15.01],
    ["s1-below-p95", r => r.s1_guides.below_chin_p95_mm = 35.01],
    ["s1-below-max", r => r.s1_guides.below_chin_max_mm = 60.01],
    ["s1-tips", r => r.s1_guides.tip_neighbour_outliers_pct = 2],
    ["s1-profile", r => r.s1_guides.profile_d2_sign_changes = 3],
    ["s2-control", r => r.s2_diagnosis.control_uv_sphere_8_guides.curves = 0],
    ["s2-uv-range", r => r.s2_children.uv_attach_readback.v_range = 0.05],
    ["s2-2k-curves", r => r.s2_children.passes["2k"].curves = 0],
    ["s2-50k-curves", r => r.s2_children.passes["50k"].curves = 0],
    ["s2-uniform", r => r.s2_children.passes["2k"].point_counts = [9, 10]],
    ["s2-forbidden", r => r.s2_children.clump_factor = 0.5],
    ["s2-profile-last", r => r.s2_children.profile_is_last = false],
    ["s3-report", r => delete r.s3_judge],
  ];
  for (const [id, mutate] of cases) {
    const planted = honestRow(); mutate(planted);
    const errors = validate(planted, false);
    if (!errors.includes(id)) throw new Error(`planted ${id} was not rejected: ${errors}`);
    console.log(`PASS planted violation ${id}`);
  }
  // failed-record consistency: matching record passes, mismatched record fails.
  const rec = honestRow(); rec.s1_guides.above_chin_max_mm = 99;
  rec.failed = { gates: [{ id: "s1-above-chin", measured: 99, threshold: "<= 15 mm" }] };
  const errs = validate(rec, false);
  const ids = new Set((rec.failed.gates || []).map(x => x.id));
  if (errs.length !== 1 || !ids.has(errs[0])) throw new Error("failed-record match broken");
  console.log("PASS failed-record consistency");
  const bad = honestRow(); bad.failed = { gates: [{ id: "s1-above-chin", measured: 99 }] };
  const errs2 = validate(bad, false);
  const ids2 = new Set((bad.failed.gates || []).map(x => x.id));
  if (JSON.stringify([...errs2].sort()) === JSON.stringify([...ids2].sort()))
    throw new Error("mismatched failed record was accepted");
  console.log("PASS failed-record mismatch rejected");
  console.log(`PASS self-test (${cases.length} planted violations rejected)`);
}

const args = process.argv.slice(2);
if (args[0] === "--self-test") {
  selfTest();
} else {
  const file = resolve(args[0] || `${HERE}/row-p7.json`);
  const row = JSON.parse(readFileSync(file, "utf8"));
  const errors = validate(row, true);
  const recorded = new Set((row.failed?.gates || []).map(x => x.id));
  const match = JSON.stringify([...errors].sort()) === JSON.stringify([...recorded].sort());
  if (!match) {
    console.error(`FAIL errors=[${errors}] recorded=[${[...recorded]}]`);
    process.exit(1);
  }
  console.log(`PASS ${file} (${row.failed ? `recorded ${row.failed.gates.map(x => x.id).join(",")}` : "all gates"})`);
}
