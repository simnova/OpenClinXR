import { describe, expect, it } from "vitest";
import { NodeIO } from "@gltf-transform/core";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * INVARIANT: a re-bake that removes something an asset carried says so in its commit message.
 *
 * ## THE DEFECT THIS EXISTS FOR, and it has surfaced three times
 *
 * A slice regenerates a humanoid for ONE property and silently discards the others. Its own
 * contract passes, because that contract measures the property the slice was about.
 *
 *     f3bf8d13  "fix(#651): the ED patient's body is the height his case declares"
 *               re-baked mpfb-gown-adult-patient 166.6 -> 177.6 cm. Its contract measured HEIGHT
 *               and passed 3/3. It also replaced the hospital gown with cargo_pants, and the
 *               gowned-patient station rendered a patient in trousers for a day. Nobody noticed
 *               until the bytes were read by hand.
 *
 * #681 and #688 are the same shape from other directions: a stale bake keeping an iris the case no
 * longer declares, and six assets losing both phenotype channels when a shared manifest went
 * missing. One structural gap, three appearances.
 *
 * ## THE INVARIANT IS SELF-MAINTAINING — no pin table
 *
 * #682 records FIVE stale pin tables in this tree, so this deliberately pins nothing. It compares
 * each shipped humanoid's two most recent COMMITTED revisions and asks whether a material class
 * present in the older one is absent from the newer. The reference is the asset's own history, so
 * it cannot go stale and it needs no maintenance when the cast grows.
 *
 * A drop is legitimate whenever it is DECLARED: the commit that removed the class names that class
 * in its message. That is the whole rule.
 *
 * ## MEASURED 2026-08-26 on 9e9c67fe — the sweep over all eleven shipped humanoids
 *
 *     mpfb-gown-adult-patient   e0d36c44   DROPPED lower_garment (+real_garment)   DECLARED
 *     the other ten             --         no class dropped in the latest revision
 *
 * `e0d36c44` is #684 replacing the base trousers with the gown, and its message says
 * "cargo_pants are REPLACED by the gown". So the guard is green today by a real declaration
 * rather than by an absence of drops.
 *
 * ## WHY THE DECLARATION TOKENS EXCLUDE "gown"
 *
 * `f3bf8d13`'s message contains the word "gown" exactly once, inside the asset filename
 * `mpfb-gown-adult-patient`. A token list that accepted it would let every commit touching that
 * asset declare a garment drop by naming the file. The tokens are the CLASS vocabulary only, and
 * clause (3) pins that this specific historical failure is still detected.
 *
 * claimScope: whether a material class disappeared between a shipped humanoid's two most recent
 *   revisions without the removing commit naming it.
 * notEvidenceFor: whether a declared drop was a good idea; whether anything OTHER than a material
 *   class was dropped (bone counts, morph targets, textures and provenance fields are unguarded);
 *   drops older than the previous revision.
 */

const GENERATED = "apps/ui-xr/public/generated-humanoids";

/** Coarse enough to survive a re-bake renaming a material within the same class. */
const MATERIAL_CLASSES: ReadonlyArray<readonly [string, RegExp]> = [
  ["skin", /mpfb_skin|_skin_/],
  ["eyes", /_eyes_/],
  ["hair", /_hair_|fitted_hair/],
  ["eyebrow", /eyebrow/],
  ["eyelash", /eyelash/],
  ["teeth", /teeth/],
  ["tongue", /tongue/],
  ["footwear", /footwear/],
  ["lower_garment", /(cargo|scrub|trouser)_pants/],
  ["upper_garment", /t_shirt|scrub_shirt|lab_coat/],
  ["real_garment", /openclinxr_real_garment/],
];

/**
 * Words that count as declaring a class in a commit message. CLASS VOCABULARY ONLY — never an
 * asset name, or a commit could declare a drop by naming the file it edited (see the header).
 */
const DECLARATION_TOKENS: Readonly<Record<string, readonly string[]>> = {
  skin: ["skin"],
  eyes: ["eye", "eyes", "iris"],
  hair: ["hair"],
  eyebrow: ["eyebrow", "brow"],
  eyelash: ["eyelash", "lash"],
  teeth: ["teeth", "tooth"],
  tongue: ["tongue"],
  footwear: ["footwear", "shoe", "shoes", "boot", "boots"],
  lower_garment: ["lower_garment", "cargo", "pants", "trouser", "trousers"],
  upper_garment: ["upper_garment", "t_shirt", "t-shirt", "shirt", "lab_coat"],
  real_garment: ["real_garment", "garment"],
};

const scratch = mkdtempSync(join(tmpdir(), "rebake-invariant-"));

function shippedHumanoids(): string[] {
  return execFileSync("git", ["ls-files", `${GENERATED}/mpfb-*.glb`], { encoding: "utf8" })
    .trim().split("\n").filter(Boolean);
}

/** `<sha> <subject>` newest first, for one path. */
function revisions(path: string): Array<{ sha: string; subject: string }> {
  const out = execFileSync("git", ["log", "--format=%h %s", "--", path], { encoding: "utf8" }).trim();
  if (!out) return [];
  return out.split("\n").map((l) => ({ sha: l.slice(0, l.indexOf(" ")), subject: l.slice(l.indexOf(" ") + 1) }));
}

function commitMessage(sha: string): string {
  return execFileSync("git", ["log", "-1", "--format=%B", sha], { encoding: "utf8" }).toLowerCase();
}

async function classesAt(sha: string, path: string): Promise<Set<string>> {
  const bytes = execFileSync("git", ["show", `${sha}:${path}`], { maxBuffer: 1 << 30 });
  const file = join(scratch, "rev.glb");
  writeFileSync(file, bytes);
  const names = (await new NodeIO().read(file)).getRoot().listMaterials().map((m) => m.getName());
  return new Set(MATERIAL_CLASSES.filter(([, re]) => names.some((n) => re.test(n))).map(([k]) => k));
}

/** Classes present at `older` and absent at `newer`, whose removal `newer`'s message does not name. */
async function undeclaredDrops(path: string, older: string, newer: string): Promise<string[]> {
  const before = await classesAt(older, path);
  const after = await classesAt(newer, path);
  const dropped = [...before].filter((c) => !after.has(c));
  if (dropped.length === 0) return [];
  const message = commitMessage(newer);
  return dropped.filter(
    (c) => !(DECLARATION_TOKENS[c] ?? []).some((t) => new RegExp(`\\b${t}\\b`).test(message)),
  );
}

describe("a rebake declares what it drops (#689)", () => {
  it("(1) no shipped humanoid silently lost a material class in its latest revision", async () => {
    const offences: string[] = [];
    for (const path of shippedHumanoids()) {
      const revs = revisions(path);
      if (revs.length < 2) continue;
      const undeclared = await undeclaredDrops(path, revs[1]!.sha, revs[0]!.sha);
      if (undeclared.length) {
        offences.push(`${path.split("/").pop()} lost [${undeclared.join(", ")}] at ${revs[0]!.sha} "${revs[0]!.subject}"`);
      }
    }
    expect(
      offences,
      "a re-bake removed a material class and its commit message does not name it. Either restore "
        + "the class, or amend the message to say which class was removed and why — a declared "
        + "replacement is legitimate and passes (see e0d36c44, which names cargo_pants). Do NOT "
        + "widen MATERIAL_CLASSES or DECLARATION_TOKENS to make this pass; that is the defect this "
        + "guard exists for.",
    ).toEqual([]);
  }, 300_000);

  it("(2) COUNTERWEIGHT: every class in the taxonomy still matches somewhere in the shipped cast", async () => {
    // Refuses the way clause (1) goes green about nothing. If a pattern stops matching — a renamed
    // material convention, a broken regex — that class can never be seen as dropped, and clause (1)
    // passes having measured one fewer dimension.
    //
    // MEASURED: an earlier version required each ASSET to match >= 8 of the 11 classes. A
    // destructive probe that broke the `skin` pattern left it GREEN, because 10 of 11 still cleared
    // the floor. An aggregate over classes cannot see one dead pattern. This tests every pattern
    // individually instead: each must match at least one shipped humanoid.
    const unmatched: string[] = [];
    const seen = new Set<string>();
    for (const path of shippedHumanoids()) {
      const revs = revisions(path);
      if (revs.length === 0) continue;
      for (const c of await classesAt(revs[0]!.sha, path)) seen.add(c);
    }
    for (const [name] of MATERIAL_CLASSES) if (!seen.has(name)) unmatched.push(name);
    expect(
      unmatched,
      "these material-class patterns match no shipped humanoid, so clause (1) can never detect "
        + "their removal. Either the naming convention changed and the pattern needs updating, or "
        + "the class genuinely left the cast and its entry should be removed in a commit that says "
        + "so. Do not delete an entry to silence this.",
    ).toEqual([]);
  }, 300_000);

  it("(3) COUNTERWEIGHT: the predicate still catches f3bf8d13, the drop that motivated this guard", async () => {
    // The destructive probe, made permanent. f3bf8d13 re-baked mpfb-gown-adult-patient for HEIGHT
    // and removed real_garment without naming it; its message's only "gown" is inside the asset
    // filename. If a future edit to MATERIAL_CLASSES or DECLARATION_TOKENS stops this firing, the
    // guard has been widened into uselessness and this clause says so before clause (1) goes quiet.
    const path = `${GENERATED}/mpfb-gown-adult-patient.glb`;
    const undeclared = await undeclaredDrops(path, "f3bf8d13^", "f3bf8d13");
    expect(
      undeclared,
      "f3bf8d13 removed real_garment from the gowned patient without naming it, and the predicate "
        + "no longer detects that. RESTORATION: revert whatever widened MATERIAL_CLASSES or "
        + "DECLARATION_TOKENS. In particular 'gown' must NOT be a declaration token — it appears in "
        + "the asset's own filename, so accepting it lets any commit touching this asset declare a "
        + "garment drop by naming the file.",
    ).toEqual(["real_garment"]);
  }, 300_000);
});
