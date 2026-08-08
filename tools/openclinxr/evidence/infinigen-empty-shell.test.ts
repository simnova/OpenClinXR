import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#135). Two REDs. Both flip.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * A NARROW REOPEN OF MADR 0043 — measure-only. This slice does NOT adopt anything.
 *
 * MADR 0043 returned `verdict: reject_measured` for Infinigen Indoors as an environment source, on
 * 15,476,539 triangles. Its OWN CORRECTION section then broke that number down:
 *
 *     unique_assets (furniture, plants, trinkets)   11,362,518 faces
 *     room_wall + exterior + floor + ceiling            ~2,528 faces
 *
 * and stated plainly that rejecting the SHELL because the dining-room FURNITURE blew the budget
 * "is a category error, and the original write-up made it". It also retracted `parameterisable:
 * false` as too strong, and left the empty shell as `unevaluated_promising`.
 *
 * I reproduced the headline myself with glTF-Transform NodeIO against
 * `~/.openclinxr-tools/infinigen/exports/dining-room-seed0.glb`: 15,476,532 triangles, 159 meshes,
 * 175 materials, 14 textures, 1.09 GB on disk, with a single `Circle.010` at 5,637,854 triangles.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS SLICE MAY AND MAY NOT CONCLUDE — read this before writing any verdict
 *
 * 0043's Decision stands: Infinigen is NOT adopted as an `environmentId`-driven source for the
 * learner runtime. This slice measures whether a FURNITURE-FREE SHELL is viable, and nothing else.
 *
 *   DO NOT wire the shell into `apps/ui-xr` as a selectable environment. A peer round was explicit
 *   that doing so contradicts 0043's Decision until its full revisit checklist passes, and I would
 *   rather this land as an honest measurement than silently overturn a MADR.
 *   DO NOT claim adoption, Quest readiness, or clinical validity. `claimScope` is the measurement.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE CONFIG EXISTS — verified, do not invent a flag
 *
 *     <install>/infinigen_examples/configs_indoor/disable/no_objects.gin
 *
 * containing exactly:
 *
 *     compose_indoors.solve_large_enabled = False
 *     compose_indoors.solve_medium_enabled = False
 *     compose_indoors.solve_small_enabled = False
 *
 * 0043 records `-g no_objects.gin` at HelloRoom ~34 seconds. GENERATE WITH FURNITURE DISABLED AT
 * CONFIG TIME. Do not generate a furnished room and strip it — post-hoc stripping is how 0043 got
 * into the 15M-triangle argument in the first place.
 *
 * If the gin file is not present at the resolved install path, that is `inconclusive_blocked`:
 * report it and STOP. Do not substitute a flag name you have not seen.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE ENVIRONMENT IS A TRAP AND IT IS MINE — I asserted the opposite last cycle and was wrong
 *
 * I reported `~/.openclinxr-tools/infinigen` as a DURABLE install. It is not:
 *
 *     ~/.openclinxr-tools/infinigen/source -> /tmp/ocxr77_tools/infinigen-indoors
 *     ~/.openclinxr-tools/infinigen/venv   -> /tmp/ocxr77_tools/infinigen-venv
 *
 * Both are symlinks into `/tmp`, which macOS purges. I checked that the path existed and not what it
 * pointed at. The whole toolchain is one reboot from gone, and `external-tool-cagematch` is already
 * red today because mesh2motion lived in the same place.
 *
 * So: RESOLVE THE INSTALL BY REALPATH, record it in the report, and if the resolved tree is missing
 * return `inconclusive_blocked` rather than a false negative. Whether to re-home the install off
 * `/tmp` is a decision I am NOT making for you — if you do it, say so and say where.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * TRIANGLES ALONE ARE THE WRONG GATE
 *
 * A 2.5k-triangle shell dragging 95 MB of textures is not viable either. The full export is 1.09 GB
 * with 175 materials and 14 textures. Measure bytes, materials and textures alongside geometry, and
 * STRUCTURE — floor, at least two walls, a ceiling, a door opening — because a shell that clears
 * every budget by being empty is not a room.
 *
 * CALIBRATE THE BYTE AND TEXTURE BOUNDS FROM THE FIRST REAL EXPORT, and record that calibration in
 * the artifact before asserting on it (do not take a number from me — I do not have one). Hand-made
 * baselines for scale: `ed_exam_bay_v1` 204 triangles, `inpatient_ward_room_v1` 84.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WALL CLOCK: 0043 records ~34s for no_objects HelloRoom and ~23 minutes for a full furnished run.
 * D9 says execution duration is not a constraint, but a worker is not infinite — CAP the generate at
 * 30 minutes and return `inconclusive_blocked` on timeout rather than burning the slice.
 *
 * NOT KNOWN TO ME: whether `no_objects.gin` composes with a room-type restriction, whether the
 * export path produces glTF natively or needs a Blender hop (0043 suggests fbx/obj/usd), and whether
 * a furniture-free solve even terminates for a clinical-shaped room. Trace it; take nothing beyond
 * the verified gin file as fact.
 *
 * Verdict is exactly one of `shell_viable` / `reject_measured` / `inconclusive_blocked`.
 * ALL THREE CLOSE THIS ISSUE SUCCESSFULLY. A negative measured result is a successful cagematch.
 */

type ShellMeasure = {
  verdict: "shell_viable" | "reject_measured" | "inconclusive_blocked";
  verdictReason: string;
  resolvedInstallPath: string;
  installIsUnderTmp: boolean;
  ginConfigPath: string | null;
  generateSeconds: number | null;
  triangleCount: number;
  meshCount: number;
  materialCount: number;
  textureCount: number;
  exportBytes: number;
  hasFloor: boolean;
  hasCeiling: boolean;
  wallCount: number;
  hasDoorOpening: boolean;
  calibration: { triangleCeiling: number; byteCeiling: number; source: string };
  claimScope: string[];
  notEvidenceFor: string[];
};

type Inspect = () => Promise<ShellMeasure>;

const load = () =>
  import("./infinigen-empty-shell.js") as Promise<Record<string, unknown>>;

describe("an Infinigen shell without furniture is measured (#135)", () => {
  it("the measurement ran and reached a named verdict", async () => {
    const mod = await load();
    const inspect = mod["inspectInfinigenEmptyShell"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const r = await inspect!();
    expect(["shell_viable", "reject_measured", "inconclusive_blocked"]).toContain(r.verdict);
    expect(r.verdictReason.length, "a verdict with no stated reason is not a measurement").toBeGreaterThan(15);
    expect(
      r.resolvedInstallPath,
      "the install must be resolved by realpath — the ~/.openclinxr-tools path is a symlink into /tmp",
    ).toBeTruthy();
    expect(
      r.notEvidenceFor.join(" "),
      "must disclaim adoption — MADR 0043's Decision is not overturned by this slice",
    ).toMatch(/adopt/i);

    if (r.verdict === "inconclusive_blocked") return; // a blocked measurement closes successfully

    expect(r.ginConfigPath, "no gin config recorded for a run that was not blocked").toBeTruthy();
    expect(r.triangleCount, "no geometry measured").toBeGreaterThan(0);
    expect(r.exportBytes, "no export bytes measured").toBeGreaterThan(0);
    expect(
      r.calibration.source,
      "budget ceilings must be calibrated from this export, not taken from the orchestrator",
    ).toMatch(/calibrat|measur/i);
  }, 1_800_000);

  it("a viable shell is a ROOM, not merely a small mesh (COUNTERWEIGHT)", async () => {
    // A shell that clears every budget by being empty is not a room, and triangles alone cannot see
    // 95 MB of textures. Only `shell_viable` carries these obligations — a measured rejection or a
    // blocked run is a successful close and is exempt.
    const mod = await load();
    const inspect = mod["inspectInfinigenEmptyShell"] as Inspect;
    const r = await inspect();
    if (r.verdict !== "shell_viable") return;

    const broken: string[] = [];
    if (!r.hasFloor) broken.push("shell_viable with no floor");
    if (!r.hasCeiling) broken.push("shell_viable with no ceiling");
    if (r.wallCount < 2) broken.push(`shell_viable with ${r.wallCount} wall(s)`);
    if (!r.hasDoorOpening) broken.push("shell_viable with no door opening — a learner cannot enter");
    if (r.triangleCount > r.calibration.triangleCeiling) {
      broken.push(`${r.triangleCount} triangles over the calibrated ceiling ${r.calibration.triangleCeiling}`);
    }
    if (r.exportBytes > r.calibration.byteCeiling) {
      broken.push(
        `${r.exportBytes} bytes over the calibrated ceiling ${r.calibration.byteCeiling} — `
        + `the full furnished export was 1.09 GB and geometry alone cannot see texture payload`,
      );
    }
    expect(broken, `shell_viable was claimed but the shell is not a room:\n${broken.join("\n")}`).toEqual([]);
  }, 1_800_000);
});
