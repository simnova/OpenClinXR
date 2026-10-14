import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * RED: after the post-strip body subdiv, only the Tara prefix reclaims the
 * exact body mesh name. MPFB's subdiv bake swaps body mesh data via
 * data.copy(), which keeps a `.001` suffix on assignment; a `_body.001` name
 * fails /_body$/ (every-actor-has-brows-lashes-and-teeth.test.ts clauses).
 *
 * The factory mesh prefix is the body identity (D11): the post-subdiv
 * re-claim must derive `prefix_body` for EVERY subject — ob_patient_aisha,
 * the aisha-ref stems' subjects, reference-path subjects — never one
 * hard-coded literal. Loosening /_body$/ so `.001` passes is refused.
 *
 * No Blender needed: mesh_prefix_for_subject is pure Python, extracted via
 * ast and executed in isolation; the reclaim block is checked structurally.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const MATERIALIZE = join(HERE, "..", "materialize_mpfb_humanoid_candidate.py");
const SRC: string = readFileSync(MATERIALIZE, "utf8");

const BODY_RE = /_body$/;

/** Subject identities the reclaim must derive — at least 2, never 1 literal. */
const SUBJECTS: Array<{ subjectId: string; eyeColourReference: string | null }> = [
  { subjectId: "ob_patient_aisha", eyeColourReference: null },
  { subjectId: "peds_nurse_kevin", eyeColourReference: null },
  { subjectId: "peds_anxious_parent", eyeColourReference: "peds_anxious_parent" },
];

function resolvePrefixes(): Array<{ subjectId: string; eyeColourReference: string | null; prefix: string }> {
  const script = [
    "import ast, json, sys",
    "path = sys.argv[1]",
    "cases = json.loads(sys.argv[2])",
    "tree = ast.parse(open(path, encoding='utf-8').read())",
    "wanted = {'MESH_PREFIX_BY_EYE_COLOUR_REFERENCE': None, 'mesh_prefix_for_subject': None}",
    "for node in tree.body:",
    "    if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id in wanted:",
    "        wanted[node.targets[0].id] = node",
    "    if isinstance(node, ast.FunctionDef) and node.name in wanted:",
    "        wanted[node.name] = node",
    "assert all(v is not None for v in wanted.values()), sorted(k for k, v in wanted.items() if v is None)",
    "mod = ast.Module(body=[wanted['MESH_PREFIX_BY_EYE_COLOUR_REFERENCE'], wanted['mesh_prefix_for_subject']], type_ignores=[])",
    "ns = {}",
    "exec(compile(mod, path, 'exec'), ns)",
    "out = [{'subjectId': c['subjectId'], 'eyeColourReference': c['eyeColourReference'], 'prefix': ns['mesh_prefix_for_subject'](c['subjectId'], c['eyeColourReference'])} for c in cases]",
    "print(json.dumps(out))",
  ].join("\n");
  const raw = execFileSync("python3", ["-c", script, MATERIALIZE, JSON.stringify(SUBJECTS)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(raw) as Array<{ subjectId: string; eyeColourReference: string | null; prefix: string }>;
}

/** Source slice between the subdiv bake and the shade-smooth line. */
function postSubdivBlock(): string {
  const start = SRC.search(/bake_modifiers_remove_helpers\(\s*\n?\s*human,\s*bake_masks=False,\s*bake_subdiv=True/);
  expect(start, "post-strip subdiv bake call site missing").toBeGreaterThanOrEqual(0);
  const end = SRC.indexOf('print("BODY_SHADE_SMOOTH True")', start);
  expect(end, "BODY_SHADE_SMOOTH marker missing after subdiv").toBeGreaterThan(start);
  return SRC.slice(start, end);
}

describe("the body mesh name reclaim covers every subject", () => {
  it("(1) RED: the derived prefix_body matches /_body$/ for >= 2 subject ids", () => {
    const rows = resolvePrefixes();
    expect(rows.length, "test must derive the name for at least 2 subject ids").toBeGreaterThanOrEqual(2);
    const exported = new Set(rows.map((r) => `${r.prefix}_body`));
    expect(exported.size, "derivation must not collapse every subject to 1 literal").toBeGreaterThanOrEqual(2);
    for (const r of rows) {
      expect(`${r.prefix}_body`, `${r.subjectId} exported body name`).toMatch(BODY_RE);
    }
    const aisha = rows.find((r) => r.subjectId === "ob_patient_aisha");
    expect(aisha, "ob_patient_aisha must be a derived subject").toBeDefined();
    expect(`${aisha!.prefix}_body`).toMatch(BODY_RE);
  });

  it("(2) RED: the post-subdiv reclaim calls claim_mesh_data_name (the .001 purge)", () => {
    expect(SRC).toMatch(/mesh\.users == 0/);
    const block = postSubdivBlock();
    expect(block, "post-subdiv block must re-claim the body name").toContain("claim_mesh_data_name(human,");
  });

  it("(3) RED: the post-subdiv reclaim is derived per subject, not one Tara literal", () => {
    const block = postSubdivBlock();
    // Tara-only guard: the planted RED gates the reclaim on one prefix.
    expect(block, "reclaim gated on one Tara literal — generalize to every subject").not.toMatch(
      /==\s*["']mpfb_parent_tara_johnson_v1["']/,
    );
    // Hard-coding one Aisha name is the symmetric cheap fix — refused.
    expect(block, "reclaim must derive the name, not hard-code one literal").not.toMatch(
      /claim_mesh_data_name\(human,\s*["']mpfb_/,
    );
    // Derivation must cover both creation routes: the reference path
    // (mpfb_<reference>) and the default-macro path (mesh_prefix_for_subject).
    expect(block, "reclaim must derive via mesh_prefix_for_subject").toContain(
      "mesh_prefix_for_subject(subject_id",
    );
    expect(block, "reclaim must cover the reference path too").toContain("args.reference");
  });
});
