import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #291's refuse gate checks that a phenotype is PRESENT. It does not check that it is SUFFICIENT —
 * so #276's failure mode is reachable through the schema #291 landed.
 *
 * MEASURED 2026-08-10, directly against `generate_mesh.build_source_body`, phenotype passed as
 * `params["phenotype"]`:
 *
 *   phenotype                                  | result
 *   -------------------------------------------|------------------------------
 *   {}                                          | REFUSED  (the gate works here)
 *   {"flush": 0.1}                              | BODY PRODUCED  fa0ff0d19b8b0da6
 *   {"flush","hair_color","eye_color"}          | BODY PRODUCED  559db1ed4c5454f3
 *   {"age": 8}                                  | BODY PRODUCED  ea0eb25db57bb949
 *   authored peds patient (24 fields)           | BODY PRODUCED  e9915a6cfca539b0
 *   authored peds parent  (24 fields)           | BODY PRODUCED  54e2501941645d92
 *   authored peds nurse   (24 fields)           | BODY PRODUCED  f2e2222d67675dc6
 *
 * The gate at `orchestrate_character.py` is `len(authored_phenotype) == 0`, and `generate_mesh.py`
 * enforces the same. So ONE key satisfies it — including `flush`, which is an affect value with no
 * bearing on body shape. An author who writes `phenotype: { flush: 0.1 }` on a case gets a fully
 * defaulted body and no warning. Separately measured: all 23 phenotype fields are read by the
 * pipeline and ALL 23 have an internal default, so nothing is structurally required.
 *
 * That is exactly #276 — "a missing phenotype that silently yields a generic adult is how six
 * humanoids became one body" — arriving through the new front door rather than the old one.
 *
 * WHAT SUFFICIENT MEANS HERE. At least one field that actually drives body GEOMETRY:
 * age, height_cm, build, bmi, body_profile, gender_presentation. Cosmetic and affect fields
 * (hair_color, eye_color, skin_tone, flush, anxious, brow_tension, age_wrinkle, clothing_*,
 * garmentLayers, ...) do not make a body distinguishable and must not satisfy the gate alone.
 *
 * THE CHEAP FIX THIS CONTRACT REFUSES: raising the threshold to a COUNT (`len >= 2`, `len >= 3`).
 * Contract (2) kills it — three cosmetic fields must still refuse. The opposite over-fix, demanding
 * all six body-shape fields, is killed by contract (3): `{age: 8}` alone must still be accepted,
 * because age genuinely drives child-versus-adult body defaults and forcing an author to invent a
 * bmi they do not know is how invented clinical content gets in.
 *
 * WHICH PROOFS ARE REDS AND WHICH ARE REGRESSION NETS (#227 asks that a brief say so):
 *   (1) and (2) are the REDs — they fail today and are the defect.
 *   (3), (4) and (5) PASS today and are regression nets. They exist to refuse over-tightening and to
 *   pin the empty-phenotype behaviour #291 already gets right. A fix that greens (1) and (2) by
 *   breaking any of them is not a fix.
 *
 * KNOWN-GOOD COLUMN: contract (4). The three authored peds actors must keep producing, byte-for-byte
 * the same bodies they produce today. A gate that refuses real authored cases is worse than the
 * defect.
 *
 * NOT TESTED: whether the six named fields are the RIGHT set — that is a generator question, and the
 * list is taken from which fields `build_source_body` uses to vary geometry, not from clinical
 * authority. Also untested: the `force_stub_mesh` escape hatch, which deliberately bypasses this.
 *
 * ## FIXED (#294)
 *
 * The gate now refuses an INSUFFICIENT phenotype, not merely an absent one.
 *
 * - `generate_mesh.py` defines `PHENOTYPE_BODY_SHAPE_FIELDS` (age, height_cm, build, bmi,
 *   body_profile, gender_presentation) and the shared predicate `phenotype_is_sufficient()`.
 *   `build_source_body` refuses when no body-shape field is present (was `len(phenotype) == 0`).
 * - `orchestrate_character.py` imports the SAME predicate — one shared helper, not two duplicated
 *   checks — and fails earlier with the case/actor context. The refusal stays a `SystemExit`,
 *   matching #291.
 * - PROOF-FIX (was "cannot pass as written"): `REPO_ROOT` was hardcoded to the main checkout
 *   (`/Volumes/files/src/openclinxr`), so re-running this test inside a worker worktree — which is
 *   exactly what the contract proof does — kept exercising MAIN's stale `len == 0` gate and could
 *   never turn green from a worktree edit. It is now resolved relative to this test file
 *   (`../../../..`), so the proof inspects the tree it runs in. All hashes and numbers in the
 *   measured table above are untouched.
 * - Measured after the fix: `{flush: 0.1}` REFUSES; `{flush, hair_color, eye_color}` REFUSES;
 *   `{age: 8}` still produces the body; the three authored peds actors still produce byte-identical
 *   bodies (contract (4) hashes unchanged); `{}` still refuses.
 *
 * ## FIXED (#302)
 *
 * The #302 height-macro solve changes contract (4)'s known-good baseline, and the change is the fix:
 * `normalized_anny_phenotype` now bisects the height macro against `anny.Anthropometry` instead of
 * the hand-fitted linear formula, so the two reachable adults produce different (correct) bodies and
 * the child refuses. Measured 2026-08-11: `patient_maya_johnson_v1` (125 cm) REFUSES — outside Anny's
 * reachable height band [~57, ~115.7] cm — and `parent_tara_johnson_v1` / `nurse_kevin_lee_v1`
 * produce bodies with the hashes now pinned in contract (4). The refusal channel is the same
 * `SystemExit` this contract already maps; nothing about the insufficiency gate changed.
 *
 * The solve applies ONLY to an AUTHORED `height_cm`. When `height_cm` is absent (contract (3)'s
 * `{age: 8}`), the legacy formula remains the unspecified-height default — there is no authored
 * target to miss, and solving toward a fabricated 170 cm would wrongly refuse an 8-year-old.
 *
 * Contract (3)'s `{age: 8}` body-hash pin was recalibrated for environment drift, not for this fix:
 * anny 0.6.0 was re-installed at 23:32 on 2026-08-10, ~1 hour AFTER the pin was measured (22:37),
 * which moved the float-level body hash. Verified: the ORIGINAL pre-fix generator produces the same
 * recalibrated hash `d1cd6be66a2b0a59` in this environment, so the old pin was already stale.
 */

// Tree-relative so the contract proof re-runs against the WORKTREE it runs in, not
// the main checkout (see ## FIXED (#294) above).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ANNY_DIR = `${REPO_ROOT}/tools/openclinxr/asset-pipeline/anny`;

type Outcome = { refused: boolean; hash: string | null };

/** Drive the real generator: refuse (SystemExit) versus a produced body, plus a stable signature. */
function buildOutcome(phenotypeJson: string): Outcome {
  const script = `
import sys, json, hashlib
sys.path.insert(0, ${JSON.stringify(ANNY_DIR)})
import generate_mesh as gm
ph = json.loads(${JSON.stringify(phenotypeJson)})
try:
    body = gm.build_source_body({"phenotype": ph})
except SystemExit:
    print(json.dumps({"refused": True, "hash": None})); raise SystemExit(0)
print(json.dumps({"refused": False, "hash": hashlib.sha256(repr(body).encode()).hexdigest()[:16]}))
`;
  const out = execFileSync("python3", ["-c", script], { cwd: REPO_ROOT, encoding: "utf8" });
  return JSON.parse(out.trim().split("\n").pop()!) as Outcome;
}

function authoredPhenotypes(): Array<{ actorId: string; phenotype: Record<string, unknown> }> {
  const script = `
import json
exp = json.load(open("packages/openclinxr/scenario-fixtures/generated/actor-phenotype.v1.json"))
def walk(o):
    if isinstance(o, dict):
        for k, v in o.items():
            if isinstance(v, dict) and isinstance(v.get("phenotype"), dict):
                # Derived (issue-293) entries carry descriptor_derived: they are
                # lookup output, not authored clinical content, and this clause
                # pins the AUTHORED known-good actors.
                if not v["phenotype"].get("descriptor_derived"):
                    yield k, v["phenotype"]
            else:
                yield from walk(v)
    elif isinstance(o, list):
        for v in o: yield from walk(v)
print(json.dumps(list(walk(exp))))
`;
  const out = execFileSync("python3", ["-c", script], { cwd: REPO_ROOT, encoding: "utf8" });
  const entries = JSON.parse(out.trim().split("\n").pop()!) as Array<[string, Record<string, unknown>]>;
  return entries.map(([actorId, phenotype]) => ({ actorId, phenotype }));
}

const COSMETIC_ONLY = { flush: 0.1, hair_color: "light_brown", eye_color: "hazel" };

describe("the phenotype gate refuses an insufficient phenotype, not merely an absent one", () => {
  it("(1) a single cosmetic field does not satisfy the gate — {flush: 0.1} must refuse", () => {
    expect(buildOutcome(JSON.stringify({ flush: 0.1 })).refused).toBe(true);
  });

  it(
    "(2) COUNTERWEIGHT: three cosmetic fields must still refuse — no count threshold can satisfy this contract",
    () => {
      expect(buildOutcome(JSON.stringify(COSMETIC_ONLY)).refused).toBe(true);
    },
  );

  it(
    "(3) COUNTERWEIGHT the other way: {age: 8} alone must be ACCEPTED — do not demand every body field",
    () => {
      const outcome = buildOutcome(JSON.stringify({ age: 8 }));
      expect(outcome.refused).toBe(false);
      // Hash recalibrated 2026-08-11: anny 0.6.0 was re-installed at 23:32 on 08-10,
      // after this pin was measured at 22:37 (see ## FIXED (#302)), moving the
      // float-level body hash from ea0eb25db57bb949 to d1cd6be66a2b0a59. The old
      // pin does not reproduce on the ORIGINAL generator in this environment either.
      expect(outcome.hash).toBe("d1cd6be66a2b0a59");
    },
  );

  it(
    "(4) KNOWN-GOOD: the reachable authored peds actors keep producing the same bodies; the child now refuses (#302)",
    () => {
      const authored = authoredPhenotypes();
      expect(authored.length).toBe(3);
      // Measured 2026-08-11 after the #302 height-macro solve (see ## FIXED (#302)
      // above): the child (125 cm) is outside Anny's reachable height band and now
      // refuses loudly; the two reachable adults produce bodies whose hashes changed
      // because the height macro is now solved against the model's own anthropometry.
      const expected = new Map<string, { hash?: string; refused?: boolean }>([
        ["patient_maya_johnson_v1", { refused: true }],
        ["parent_tara_johnson_v1", { hash: "b203a3a97db29d06" }],
        ["nurse_kevin_lee_v1", { hash: "6e926cada2b87565" }],
      ]);
      for (const { actorId, phenotype } of authored) {
        const expectation = expected.get(actorId);
        expect(expectation, `unexpected authored actor ${actorId}`).toBeDefined();
        const outcome = buildOutcome(JSON.stringify(phenotype));
        if (expectation!.refused) {
          expect(outcome.refused, `${actorId}: expected refusal (#302), got a body`).toBe(true);
        } else {
          expect(outcome.refused, `${actorId} refused`).toBe(false);
          expect(outcome.hash, `${actorId} body hash moved`).toBe(expectation!.hash);
        }
      }
    },
  );

  it("(5) the empty phenotype keeps refusing — #291's gate must not regress", () => {
    expect(buildOutcome("{}").refused).toBe(true);
  });
});
