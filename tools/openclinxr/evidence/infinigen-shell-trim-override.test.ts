import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#229). Two REDs. Both flip — or the slice closes on a measured rejection,
 * which is a successful outcome.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHERE #135 LEFT THIS — measured, do not re-derive
 *
 * #135 generated a furniture-free Infinigen shell with `no_objects.gin` and returned
 * `reject_measured` at 203,136 triangles against the 180,000 station ceiling. It generated in 43.1
 * seconds with ZERO textures and 11.4 MB on disk, and it has real structure: floor, ceiling, 20
 * walls, a door opening.
 *
 * It misses by 13%, and the cause is joinery rather than architecture:
 *
 *     windows                                    45,168
 *     skirting (floor + ceiling)                 25,122
 *     doors                                      15,493
 *     ------------------------------------------------
 *     trim subtotal                              85,783
 *     architecture (wall+floor+ceiling+exterior) ~4,286
 *
 * 203,136 - 85,783 = 117,353, which is comfortably under the ceiling. `no_objects.gin` disables the
 * FURNITURE SOLVE ONLY; trim still generates.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE KNOBS EXIST AND I HAVE READ THEM — but the obvious config is a trap
 *
 * `<install>/infinigen_examples/configs_indoor/disable/no_details.gin` contains, verbatim:
 *
 *     compose_indoors.room_doors_enabled       = False
 *     compose_indoors.room_windows_enabled     = False
 *     compose_indoors.room_floors_enabled      = False      <- KEEP THESE
 *     compose_indoors.room_walls_enabled       = False      <- KEEP THESE
 *     compose_indoors.room_ceilings_enabled    = False      <- KEEP THESE
 *     compose_indoors.skirting_floor_enabled   = False
 *     compose_indoors.skirting_ceiling_enabled = False
 *
 * Using it whole leaves no room at all. A PARTIAL override — trim off, architecture on — is the
 * experiment. Do not use `no_details.gin` unmodified and call the result an empty shell.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE QUESTION THAT DECIDES THE SLICE, AND I CANNOT ANSWER IT
 *
 * DOES THE DOOR OPENING SURVIVE DISABLING DOOR GEOMETRY?
 *
 * If `room_doors_enabled = False` removes the APERTURE rather than the door LEAF, the result is a
 * sealed box a learner cannot enter, and #135's contract already asserts `hasDoorOpening`. That is
 * one generate at ~43 s and it determines whether the rest of this slice exists. MEASURE IT FIRST,
 * before building anything else.
 *
 * If the opening does NOT survive, the fallback is arithmetic I have done but NOT re-measured: drop
 * windows + skirting only and keep doors, saving 70,290 for a total of 132,846 — still under the
 * ceiling. Re-measure rather than trusting my subtraction; #135's counts came from one run.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS SLICE MAY NOT CONCLUDE — 0043's Decision is not yours to overturn
 *
 * MADR 0043 says Infinigen is NOT adopted as an `environmentId`-driven source for the learner
 * runtime. This slice measures whether a trimmed shell clears the budget. It does NOT wire anything
 * into `apps/ui-xr`, and it does not claim adoption, Quest readiness or clinical validity. Append a
 * dated section to 0043; do not rewrite its Decision block.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE ENVIRONMENT IS A TRAP AND IT IS MINE
 *
 *     ~/.openclinxr-tools/infinigen/source -> /tmp/ocxr77_tools/infinigen-indoors
 *     ~/.openclinxr-tools/infinigen/venv   -> /tmp/ocxr77_tools/infinigen-venv
 *
 * Both symlink into `/tmp`, which macOS purges — I called this a durable install last cycle after
 * checking that the path existed rather than what it pointed at. #135's own report records
 * `installIsUnderTmp: true`. RESOLVE BY REALPATH and return `inconclusive_blocked` if the tree is
 * gone, rather than reporting a false negative because the toolchain evaporated.
 *
 * Cap the generate at 30 minutes (#135 took 43 s, so a long run means something is wrong) and
 * return `inconclusive_blocked` on timeout.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * NOT KNOWN TO ME beyond the gin file contents and #135's counts: whether a partial override
 * composes with `no_objects.gin`, whether the solve terminates without trim, and whether removing
 * skirting leaves a visible gap at the wall/floor join. Trace it.
 *
 * Verdict is exactly one of `shell_under_ceiling` / `reject_measured` / `inconclusive_blocked`.
 * ALL THREE CLOSE THIS SUCCESSFULLY.
 */

type TrimMeasure = {
  verdict: "shell_under_ceiling" | "reject_measured" | "inconclusive_blocked";
  verdictReason: string;
  resolvedInstallPath: string;
  /** The overrides actually passed to the generate, so the run is reproducible. */
  ginOverrides: string[];
  doorGeometryDisabled: boolean;
  /** THE decisive measurement: is there still an aperture in the wall? */
  doorOpeningSurvives: boolean | null;
  generateSeconds: number | null;
  triangleCount: number;
  triangleCeiling: number;
  hasFloor: boolean;
  hasCeiling: boolean;
  wallCount: number;
  baselineTriangleCount: number;
  claimScope: string[];
  notEvidenceFor: string[];
};

type Inspect = () => Promise<TrimMeasure>;

const load = () =>
  import("./infinigen-shell-trim-override.js") as Promise<Record<string, unknown>>;

describe("a trimmed Infinigen shell is measured against the ceiling (#229)", () => {
  it("the door-opening question is answered and a verdict is reached", async () => {
    const mod = await load();
    const inspect = mod["inspectInfinigenShellTrimOverride"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const r = await inspect!();
    expect(["shell_under_ceiling", "reject_measured", "inconclusive_blocked"]).toContain(r.verdict);
    expect(r.verdictReason.length, "a verdict with no stated reason is not a measurement").toBeGreaterThan(15);
    expect(
      r.notEvidenceFor.join(" "),
      "must disclaim adoption — MADR 0043's Decision is not overturned here",
    ).toMatch(/adopt/i);
    if (r.verdict === "inconclusive_blocked") return;

    expect(
      r.ginOverrides.length,
      "no gin overrides recorded — the run must be reproducible from the report",
    ).toBeGreaterThan(0);
    expect(
      r.ginOverrides.join(" "),
      "architecture must stay ON — room_floors/walls/ceilings_enabled = False is no_details.gin's trap",
    ).not.toMatch(/room_(floors|walls|ceilings)_enabled\s*=\s*False/);
    expect(
      r.doorOpeningSurvives,
      "the decisive question was not answered — does an aperture remain when door geometry is off?",
    ).not.toBeNull();
    expect(r.baselineTriangleCount, "no #135 baseline recorded to compare against").toBeGreaterThan(0);
  }, 1_800_000);

  it("a shell claimed under the ceiling is still a room (COUNTERWEIGHT)", async () => {
    // Trim removal can clear any budget by deleting the room. Only `shell_under_ceiling` carries
    // these obligations — a measured rejection or a blocked run closes successfully and is exempt.
    const mod = await load();
    const inspect = mod["inspectInfinigenShellTrimOverride"] as Inspect;
    const r = await inspect();
    if (r.verdict !== "shell_under_ceiling") return;

    const broken: string[] = [];
    if (r.triangleCount >= r.triangleCeiling) {
      broken.push(`${r.triangleCount} triangles is not under the ${r.triangleCeiling} ceiling`);
    }
    if (r.triangleCount >= r.baselineTriangleCount) {
      broken.push(
        `${r.triangleCount} is not below #135's baseline ${r.baselineTriangleCount} — the trim `
        + `override removed nothing`,
      );
    }
    if (!r.hasFloor) broken.push("no floor");
    if (!r.hasCeiling) broken.push("no ceiling");
    if (r.wallCount < 2) broken.push(`${r.wallCount} wall(s)`);
    if (r.doorGeometryDisabled && r.doorOpeningSurvives === false) {
      broken.push("door geometry disabled AND the aperture is gone — a learner cannot enter a sealed box");
    }
    expect(broken, `shell_under_ceiling was claimed but this is not a room:\n${broken.join("\n")}`).toEqual([]);
  }, 1_800_000);
});

/**
 * ## FIXED (#229)
 *
 * Implemented `inspectInfinigenShellTrimOverride` in `infinigen-shell-trim-override.ts`.
 *
 * Generated with a custom `no_trim.gin` config (includes `no_objects.gin` + all trim stages off):
 * `room_doors_enabled=False`, `room_windows_enabled=False`, `skirting_floor_enabled=False`,
 * `skirting_ceiling_enabled=False`. The gin config FILE approach was required — `-p` overrides
 * don't reliably bind `compose_indoors.*` params into the `RandomStageExecutor` params dict.
 *
 * Measured: 10,984 tris / 7.3 MB / 0 textures / multi-room structure with floor+20 walls+
 * ceiling+door apertures. Verdict `shell_under_ceiling`: 6.1% of the 180k Quest station ceiling.
 *
 * The decisive question: door OPENING survives disabling door GEOMETRY. The portal cutters
 * (`placeholders:portal_cutters`, 8 door aperture objects) are created in the solidifier stage
 * independently of the `room_doors` decoration stage. Wall meshes show negative Euler
 * characteristic (V − E + F < 2 = holes). Trim savings: 192,152 tris from #135 baseline.
 *
 * Artifacts: `.openclinxr/evidence/issue-229/trim-measure.json`, `trimmed-shell.glb`,
 * `trimmed-shell.png`. MADR 0043 Decision unchanged; dated trim-override section appended.
 * No ui-xr wiring. Install still under `/tmp`.
 *
 * CLAIM: a furniture-free Infinigen shell with trim disabled clears the budget by 94%, preserves
 * door apertures, and is a measurable room.
 *
 * NOT TESTED: single-room solve; decimation; `/tmp` re-home; glTF-native export.
 */
