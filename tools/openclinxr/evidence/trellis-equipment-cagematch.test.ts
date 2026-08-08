import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#164) — LANE C CAGEMATCH. Can TRELLIS.2 produce a clinical prop better than our
 * parametric box, under the per-asset ceiling, deterministically enough to be a factory step?
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT — the shipped equipment and its licence posture must be
 * untouched. It is `it.fails` only because the module is absent.
 *
 * ## FIXED (#164)
 * Module `trellis-equipment-cagematch.ts` lands. Bake-off ran headlessly against live ComfyUI
 * (24 TRELLIS nodes, MPS). Verdict `reject_measured`: Trellis2MultiViewImageToShape hard-requires
 * `cumesh_vb` (CUDA CuMesh) inside shape generation — no macOS/MPS wheel. Contact sheet + pre-fix
 * on `.openclinxr/evidence/issue-164/`. Nothing promoted.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * A CAGEMATCH'S CONTRACT PROVES THE BAKE-OFF RAN AND WAS RECORDED — NEVER THAT A CANDIDATE WON.
 *
 * **`verdict: reject_measured` closes this issue successfully.** "TRELLIS.2 cannot clear 60,000
 * triangles / produces unusable topology / needs manual retopo per asset, here is the measured
 * reason" is exactly as valuable as an adoption. Do not tune anything to make it look good.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE ENVIRONMENT IS STAGED. IT WILL NOT BE YOUR BLOCKER.
 *
 *  - **24 TRELLIS nodes register** in a live ComfyUI (957 total). The chain is one graph:
 *    `Trellis2ImageToShape` / `Trellis2MultiViewImageToShape` → `Trellis2Simplify` →
 *    `Trellis2UVUnwrap` → `Trellis2RasterizePBR` → `Trellis2ExportGLB`
 *  - **`microsoft/TRELLIS.2-4B` weights are on disk** — 15 GB under `~/ComfyUI/models/trellis2`,
 *    licence **MIT**, verified at the HuggingFace source rather than taken from the wrapper
 *  - ComfyUI runs `--cpu` here. `torch.backends.mps.is_available()` is **true** but MPS is untested
 *    for this workload
 *  - **Boot is slow and that is normal**: the node metadata scan is ~72 s cold, ~2.6 s warm. A port
 *    answering is not proof it is your server (§9b) — I reported "zero nodes" three times and was
 *    wrong every time
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE SUBJECT IS THE ECG CART. NOT THE IV POLE. A PEER ROUND CORRECTED ME ON THIS.
 *
 * I first proposed an IV pole. It is the **worst** possible first subject: thin, vertical, mostly
 * empty air — precisely the geometry image-to-3D handles badly and a parametric builder handles well.
 * And `iv-pole-with-pump.glb` **already renders correctly**; it needs no work.
 *
 * The cart is the right subject: it has volume and a readable silhouette. #168 has just made it a
 * genuinely assembled object, so there is finally something whole to benchmark against — before that
 * it was a box floating above its own casters.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE INPUT IMAGE — MY DECISION, AND THE OBJECTION TO IT IS RECORDED
 *
 * Image-to-3D needs an input image, and a peer round named this the gating decision. The options and
 * why each is bad:
 *
 * | source | problem |
 * |---|---|
 * | photo | provenance and licence; clinical device branding |
 * | another generative image | a second model, a second licence, still not a factory seed |
 * | render of our own parametric cart | **"circular — the model copies boxes"** |
 *
 * **I choose the third, deliberately, and I am naming the objection because it is reasonable.**
 *
 * The reasoning: this is a **mesh refinement** task, not a from-nothing generation task. TRELLIS.2's
 * prior is trained on real objects; given multi-view renders of a box-shaped cart it should return a
 * cart-shaped object *with real surface form*. If instead it returns a box, **that is the answer** —
 * a measured negative result that closes the cagematch honestly.
 *
 * And it removes the entire licence and provenance minefield: our own asset, our own renders, zero
 * third-party imagery, fully repeatable. `Trellis2MultiViewImageToShape` exists for exactly this
 * shape of input.
 *
 * **If you believe circularity makes the result meaningless, say so in your report and run it anyway.**
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * TIME IS NOT A CONSTRAINT — BUT "NOT A FACTORY STEP" IS A REAL VERDICT
 *
 * Operator direction: *"a case can take DAYS to fully bake, time is not an issue."* So a slow result
 * is **not** a failure. What WOULD make this "not a factory step", per a peer round:
 *
 *  - **no determinism** — same graph + same input images must give the same output hash
 *  - **no headless script** — if an agent has to babysit a ComfyUI GUI, it is an art job
 *  - **no budget gate** — output must be measurable against `maxTriangles: 60000`
 *
 * Record all three. A slow-but-deterministic-and-scripted result is a **pass** on the factory
 * question even if the mesh is worse than ours.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE VERDICT ON APPEARANCE IS MINE, AND THE CONTRACT MUST NOT ASSERT BEAUTY
 *
 * A peer round was explicit about what the machine may assert: the GLB exists and loads, triangle
 * count under the ceiling, **AABB upright** (height ≫ width catches a lying mesh — #156 shipped one),
 * provenance and licence fields present, and a contact sheet containing **both** the parametric
 * original and the candidate.
 *
 * **It may not assert "looks like an ECG cart".** That is a pixel grade and it is mine.
 *
 * Use #163's isolated harness for the comparison sheet — this is a "is this thing right" question, so
 * it is isolated, not a room capture (§9f).
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - **How many views to render as input.** `Trellis2MultiViewImageToShape` takes several; more views
 *    should constrain the shape better and cost more. Say what you chose.
 *  - **Where `Trellis2Simplify` sits** — before or after UV unwrap and PBR raster. The chain allows
 *    both and they are not equivalent.
 *  - **Whether to attempt MPS or stay on `--cpu`.** MPS is available and untested. If you try it and
 *    it fails, that is a recorded finding, not a failure of the slice.
 *  - **What "deterministic" is measured as** — output file hash, vertex count, or AABB within epsilon.
 *    Seeded generative models rarely give byte-identical output; say what you measured and what
 *    tolerance you accepted.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands a candidate GLB that actually came out of TRELLIS.2 and clears the budget, and is
 * satisfiable by exporting the input cart unchanged. (2) forbids that by requiring the candidate to
 * differ measurably from the seed and by requiring the run to be reproducible. (3) is green today and
 * forbids buying either by promoting the candidate into `generated-humanoids/` or the shipped
 * equipment directory, or by disturbing the licence posture.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectTrellisEquipmentCagematch()`. What must
 * not change: geometry is measured from the **exported glTF via NodeIO**, and the candidate stays on
 * an evidence path.
 *
 * CALIBRATION — `.openclinxr/evidence/issue-164/pre-fix.json` BEFORE any generation: the CURRENT
 * `ecg-cart-12-lead.glb` measured on every axis the candidate will be measured on — triangle count,
 * AABB, part count, file size. That is the **known-good reference column** (§9h) the comparison needs.
 *
 * REQUIRED, the observable half: a contact sheet containing the **parametric original and the
 * candidate side by side**, via #163's harness, on disk for me to grade.
 *
 * IN-SCOPE VISUAL — answer EVERY line. Do not replace with a sentence:
 *     candidate_generated:   yes | no | blocked:<reason>
 *     candidate_upright:     yes | lying | not_visible
 *     candidate_vs_original: better | same | worse | not_comparable
 *     reads_as_equipment:    yes | no | not_visible
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS THE
 * OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT.
 *
 * SCOPE: whether TRELLIS.2 can produce a usable clinical prop on this machine, measured. Says NOTHING
 * about adopting it, replacing the parametric builders, humanoids, or rooms.
 */

const load = async () => import("./trellis-equipment-cagematch.js") as Promise<Record<string, unknown>>;

type AssetMeasure = {
  path: string;
  triangleCount: number;
  width: number;
  height: number;
  depth: number;
  partCount: number;
  fileBytes: number;
};

type CagematchRun = {
  /** "adopt" | "reject_measured" | "inconclusive_blocked". */
  verdict: string;
  verdictFreeText: string;
  /** The shipped parametric cart — the known-good reference column (§9h). */
  reference: AssetMeasure;
  /** The TRELLIS.2 output, or null when the run was blocked. */
  candidate: AssetMeasure | null;
  /** Where the candidate was written. Must NOT be a shipped asset path. */
  candidatePath: string | null;
  /** Input views rendered from the reference and fed to the model. */
  inputViewCount: number;
  /** Wall-clock for generation. Slow is acceptable; unrecorded is not. */
  generationMs: number | null;
  /** Ran without a human driving a GUI. */
  headlessScripted: boolean;
  /** Same graph + same inputs reproduced within the implementer's stated tolerance. */
  deterministicAcrossRuns: boolean | null;
  determinismMeasure: string;
  /** Model + prompt/seed + tool version, per MADR 0016. */
  provenance: Record<string, string> | null;
  /** Contact sheet with reference and candidate side by side. */
  contactSheetPath: string | null;
  /** Compute backend actually used. */
  backend: string;
};

type Inspect = () => Promise<CagematchRun>;

const VERDICTS = ["adopt", "reject_measured", "inconclusive_blocked"];

/** Per-asset ceiling — asset-registry/src/index.ts:595. */
const MAX_TRIANGLES = 60_000;

describe("can TRELLIS.2 produce a usable clinical prop (#164)", () => {
  it("the bake-off ran and reached a recorded verdict", async () => {
    // 24 TRELLIS nodes register and 15GB of MIT-licensed weights are on disk. Nothing has ever been
    // generated with them. reject_measured is a successful outcome; finishing without a verdict, or
    // without saying what blocked it, is not.
    const mod = await load();
    const inspect = mod["inspectTrellisEquipmentCagematch"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const run = await inspect!();
    expect(VERDICTS, `verdict "${run.verdict}" is not one of ${VERDICTS.join(" | ")}`).toContain(run.verdict);
    expect(run.verdictFreeText.length, "no free-text reason recorded for the verdict").toBeGreaterThan(40);

    // The reference must be measured whatever happens — it is the known-good column.
    expect(run.reference.triangleCount, "the shipped cart was not measured as a reference").toBeGreaterThan(0);

    if (run.verdict === "adopt") {
      expect(run.candidate, "adopt with no candidate measured").toBeTruthy();
      expect(run.candidate!.triangleCount, "candidate exceeds the per-asset ceiling")
        .toBeLessThanOrEqual(MAX_TRIANGLES);
      expect(run.contactSheetPath, "adopt with no contact sheet for grading").toBeTruthy();
    } else {
      expect(
        run.verdictFreeText,
        `verdict is ${run.verdict} but the text does not name what blocked or failed`,
      ).not.toHaveLength(0);
    }
  }, 3_600_000);

  it("the candidate is not the seed, and the run is a factory step", async () => {
    // Kills the cheap satisfaction of the first contract: exporting the input cart unchanged and
    // calling it generated. Also pins the three things a peer round said decide whether this is a
    // factory step at all, independent of mesh quality: determinism, headless scripting, budget.
    const mod = await load();
    const inspect = mod["inspectTrellisEquipmentCagematch"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const run = await inspect!();
    expect(run.inputViewCount, "no input views were rendered from the reference").toBeGreaterThan(0);
    expect(run.headlessScripted, "the run needed a human driving a GUI — that is an art job, not a factory step")
      .toBe(true);
    expect(run.determinismMeasure.length, "determinism was not measured or the measure was not named")
      .toBeGreaterThan(0);

    if (run.candidate) {
      // A candidate identical to the reference is the seed round-tripped, not a generation.
      const sameTris = run.candidate.triangleCount === run.reference.triangleCount;
      const sameBytes = run.candidate.fileBytes === run.reference.fileBytes;
      expect(
        sameTris && sameBytes,
        "the candidate is byte-identical to the reference — that is the seed, not a generation",
      ).toBe(false);
      expect(run.generationMs, "no generation time recorded").toBeTruthy();
      expect(run.provenance, "no provenance recorded (MADR 0016: model, prompt/seed, tool version)")
        .toBeTruthy();
    }
  }, 3_600_000);

  it("nothing was promoted and the licence posture is untouched (COUNTERWEIGHT)", async () => {
    // The cheap satisfaction is dropping the candidate into the shipped equipment directory so it
    // "loads". MIT on the model is not a free pass on a shipped asset, and #168 just corrected a
    // provenance ledger that certified six assets which never existed.
    const mod = await load();
    const inspect = mod["inspectTrellisEquipmentCagematch"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const run = await inspect!();
    if (run.candidatePath) {
      expect(
        /generated-humanoids|xr-assets\/medical-equipment/u.test(run.candidatePath),
        `candidate was written into a shipped asset path: ${run.candidatePath}`,
      ).toBe(false);
      expect(
        run.candidatePath.includes(".openclinxr/evidence"),
        `candidate is not on an evidence path: ${run.candidatePath}`,
      ).toBe(true);
    }

    // The shipped cart must be exactly what #168 landed.
    expect(run.reference.path.includes("medical-equipment"), "the reference is not the shipped cart").toBe(true);
    expect(run.reference.partCount, "the shipped cart lost its parts").toBeGreaterThan(2);
    expect(run.backend.length, "the compute backend was not recorded").toBeGreaterThan(0);
  }, 3_600_000);
});
