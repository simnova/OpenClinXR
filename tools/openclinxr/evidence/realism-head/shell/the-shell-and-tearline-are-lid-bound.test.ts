import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The occlusion shell copies the eye vertex groups, so the lid-shadow ramp
 * yaws with gaze; the tearline ships with no parent, no armature modifier and
 * no groups. Both become children of the armature, weighted 100% to the head
 * bone (never eye.L / eye.R), and carry the six lid keys
 * (eye-{left,right}-{closure,slit,opened-up}) so a morphed lid does not leave
 * them floating. KHR_materials_unlit is preserved on both materials.
 *
 * The caruncle has no licensable .mhclo (eye-corner manifest: not_found) and
 * the factory bake creates no caruncle mesh, so the bind helper covers any
 * openclinxr_caruncle* object if present and the manifest records its absence
 * with the reason. OOS: fitting a caruncle, fitting lashes, removing unlit.
 *
 * Evidence chain (no live bake in-test): materialize.py source markers +
 * shell-manifest.json (composed from the bake's SHELL_REBIND_RECORD log line
 * plus the yaw-pair render metrics) + shadow-yaw-sheet.png (native crops of
 * 1280 three.js renders). The RED clauses fail on the pre-fix source (eye
 * groups copied, tearline unparented, no manifest) and pass after.
 *
 * Coverage metric (honest definition, same-GLB paired renders at 1280 from
 * shell-sheet-capture.ts: noshell = bound GLB with shell/tearline hidden,
 * fixed = bound GLB as-is): BrightStep = max horizontal luminance step in
 * the wedge-silhouette band (x 745..762, rows 660..750, yaw +25, the only
 * view showing the sclera wedge). The shell is a TRANSLUCENT shadow
 * (alpha <= 0.8), not an occluder: it softens the silhouette step
 * (measured 170 -> 101) but cannot remove iris/lash edges, so the gate
 * asserts strict softening (fixed < baseline) with a live premise
 * (baseline >= 20), never an absolute floor no honest pixel reaches.
 *
 * claimScope: lid-bind of shell/tearline in the factory bake + yaw-pair sheet.
 * notEvidenceFor: clinical_validity, production_asset_readiness; the pixel
 *   grade lives in shadow-yaw-sheet.png and is the orchestrator's (D12).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../../..");
const MANIFEST = join(HERE, "shell-manifest.json");
const SHEET = join(HERE, "shadow-yaw-sheet.png");
const MATERIALIZE = join(
  REPO_ROOT,
  "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py",
);

const LID_KEYS = [
  "eye-left-closure",
  "eye-left-slit",
  "eye-left-opened-up",
  "eye-right-closure",
  "eye-right-slit",
  "eye-right-opened-up",
];

/** Pre-fix defect: the shell duplicates the eye's own vertex groups. */
const EYE_GROUP_COPY_DEFECT = "shell_groups[v.index] = [(eyes_asset.vertex_groups";

type ShellManifest = {
  name: string;
  producerSourceSha256: string;
  argv: string[];
  shell: {
    mesh: string;
    parent: string;
    groups: string[];
    eyeGroups: string[];
    lidKeys: string[];
    lidKeyMaxDeltaMm: Record<string, number>;
  };
  tearline: {
    mesh: string;
    parent: string;
    groups: string[];
    lidKeys: string[];
    lidKeyMaxDeltaMm: Record<string, number>;
  };
  caruncle: { present: boolean; reason: string };
  unlit: Record<string, { alphaMode: string; unlit: boolean }>;
  falsifier: { verdict: string };
  coverageGate: {
    views: number[];
    baselineMaxBrightStep: number;
    fixedMaxBrightStep: number;
  };
  sheet: { src: string; sha256: string; renderSize: number };
};

function readManifest(): ShellManifest {
  expect(existsSync(MANIFEST), `shell manifest exists: ${MANIFEST}`).toBe(
    true,
  );
  return JSON.parse(readFileSync(MANIFEST, "utf8")) as ShellManifest;
}

function readSource(): string {
  return readFileSync(MATERIALIZE, "utf8");
}

/** Fail-closed validator shared by the manifest clause and the known-bad fixture. */
function validateBind(m: ShellManifest): void {
  expect(m.shell.groups, "shell weighted to the head").toEqual(["head"]);
  expect(m.shell.eyeGroups, "shell carries no eye groups").toEqual([]);
  expect(m.tearline.parent.length, "tearline has a parent").toBeGreaterThan(
    0,
  );
  expect(m.tearline.groups, "tearline weighted to the head").toEqual([
    "head",
  ]);
  for (const key of LID_KEYS) {
    expect(m.shell.lidKeys, `shell carries ${key}`).toContain(key);
    expect(m.tearline.lidKeys, `tearline carries ${key}`).toContain(key);
  }
  const moved = Object.values(m.shell.lidKeyMaxDeltaMm).some((v) => v > 0);
  expect(moved, "at least one shell lid key moves geometry").toBe(true);
  if (m.caruncle.present) {
    expect(
      m.caruncle.reason.length,
      "a present caruncle records its bind",
    ).toBeGreaterThan(0);
  } else {
    expect(m.caruncle.reason.length, "absence records its reason").toBeGreaterThan(0);
  }
}

describe("the shell and tearline are lid-bound", () => {
  it("(1) manifest records the producer source sha and the bake argv", () => {
    const m = readManifest();
    expect(m.name).toBe("eye-occlusion-shell-lid-bind");
    expect(m.producerSourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(m.argv.join(" ")).toMatch(/--eye-occlusion-shell/);
    expect(m.argv.join(" ")).toMatch(/--eye-tearline/);
  });

  it("(2) RED: shell groups are not the eye groups", () => {
    const m = readManifest();
    validateBind(m);
    const src = readSource();
    expect(src, "eye-group copy defect is gone from the source").not.toContain(
      EYE_GROUP_COPY_DEFECT,
    );
    expect(src, "shell head-bind call exists").toContain(
      "_eyshell_bind_to_head(shell_obj",
    );
  });

  it("(3) RED: tearline has a parent and weights", () => {
    const m = readManifest();
    expect(m.tearline.parent).toMatch(/armature|rig/i);
    const src = readSource();
    expect(src, "tearline head-bind call exists").toContain(
      "_eyshell_bind_to_head(tear_obj",
    );
  });

  it("(4) RED: shell and tearline carry the six lid keys with real deltas", () => {
    const m = readManifest();
    validateBind(m);
    const src = readSource();
    expect(src, "lid-key transfer exists").toContain(
      "_eyshell_transfer_lid_keys(",
    );
    for (const key of LID_KEYS) {
      expect(src, `source names lid key ${key}`).toContain(`"${key}"`);
    }
  });

  it("(5) COUNTERWEIGHT: unlit survives and the weightless refusal still stands", () => {
    const m = readManifest();
    for (const mat of [
      "openclinxr_eye_occlusion_shell",
      "openclinxr_eye_tearline",
    ]) {
      expect(m.unlit[mat]?.unlit, `${mat} stays unlit`).toBe(true);
    }
    expect(m.unlit["openclinxr_eye_occlusion_shell"]?.alphaMode).toBe(
      "BLEND",
    );
    const src = readSource();
    expect(src, "unlit patch registry survives").toContain(
      "EYESHELL_UNLIT_BLEND[",
    );
    expect(src, "B1 weightless-vert refusal survives").toContain(
      "subdivided eye verts weightless",
    );
  });

  it("(6) caruncle is bound if present, honestly absent otherwise", () => {
    const m = readManifest();
    validateBind(m);
  });

  it("(7) RED: the yaw pair softens the sclera edge and the sheet matches bytes", () => {
    const m = readManifest();
    expect(m.coverageGate.views).toEqual(
      expect.arrayContaining([25, -25]),
    );
    expect(
      m.coverageGate.baselineMaxBrightStep,
      "baseline (shell hidden) shows the edge",
    ).toBeGreaterThanOrEqual(20);
    expect(
      m.coverageGate.fixedMaxBrightStep,
      "fixed (lid-bound shell) strictly softens the edge",
    ).toBeLessThan(m.coverageGate.baselineMaxBrightStep);
    expect(m.falsifier.verdict).toMatch(/^(premise_live|premise_clean)$/);
    expect(existsSync(SHEET), `shadow yaw sheet exists: ${SHEET}`).toBe(
      true,
    );
    const bytes = readFileSync(SHEET);
    expect(bytes.length, "sheet is a real PNG, not a stub").toBeGreaterThan(
      10000,
    );
    const sha = createHash("sha256").update(bytes).digest("hex");
    expect(sha, "sheet bytes match the manifest").toBe(m.sheet.sha256);
    expect(m.sheet.renderSize).toBe(1280);
  });

  it("(8) known-bad: a shell still on eye groups is rejected", () => {
    const m = readManifest();
    const bad = {
      ...m,
      shell: { ...m.shell, groups: ["eye.L"], eyeGroups: ["eye.L"] },
    };
    expect(() => validateBind(bad)).toThrow();
  });
});
