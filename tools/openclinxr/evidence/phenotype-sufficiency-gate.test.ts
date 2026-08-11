import { execFileSync } from "node:child_process";
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
 */

const REPO_ROOT = "/Volumes/files/src/openclinxr";
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

function authoredPhenotypes(): Array<{ hash: string; phenotype: Record<string, unknown> }> {
  const script = `
import json
exp = json.load(open("packages/openclinxr/scenario-fixtures/generated/actor-phenotype.v1.json"))
def walk(o):
    if isinstance(o, dict):
        if isinstance(o.get("phenotype"), dict): yield o["phenotype"]
        for v in o.values(): yield from walk(v)
    elif isinstance(o, list):
        for v in o: yield from walk(v)
print(json.dumps(list(walk(exp))))
`;
  const out = execFileSync("python3", ["-c", script], { cwd: REPO_ROOT, encoding: "utf8" });
  const phenotypes = JSON.parse(out.trim().split("\n").pop()!) as Array<Record<string, unknown>>;
  // Measured today; these must not move.
  const expected = ["e9915a6cfca539b0", "54e2501941645d92", "f2e2222d67675dc6"];
  return phenotypes.map((phenotype, index) => ({ hash: expected[index]!, phenotype }));
}

const COSMETIC_ONLY = { flush: 0.1, hair_color: "light_brown", eye_color: "hazel" };

describe("the phenotype gate refuses an insufficient phenotype, not merely an absent one", () => {
  it.fails("(1) a single cosmetic field does not satisfy the gate — {flush: 0.1} must refuse", () => {
    expect(buildOutcome(JSON.stringify({ flush: 0.1 })).refused).toBe(true);
  });

  it.fails(
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
      expect(outcome.hash).toBe("ea0eb25db57bb949");
    },
  );

  it(
    "(4) KNOWN-GOOD: the three authored peds actors keep producing the same bodies, byte for byte",
    () => {
      const authored = authoredPhenotypes();
      expect(authored.length).toBe(3);
      for (const { hash, phenotype } of authored) {
        const outcome = buildOutcome(JSON.stringify(phenotype));
        expect(outcome.refused, `authored phenotype refused: ${JSON.stringify(phenotype).slice(0, 90)}`).toBe(false);
        expect(outcome.hash).toBe(hash);
      }
    },
  );

  it("(5) the empty phenotype keeps refusing — #291's gate must not regress", () => {
    expect(buildOutcome("{}").refused).toBe(true);
  });
});
