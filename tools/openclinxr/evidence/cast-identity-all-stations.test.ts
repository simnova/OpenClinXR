import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#102) — #96 fixed duplicate cast identity for the ED bay only. It did not
 * generalise, and nobody noticed because nobody had rendered the other stations.
 *
 * TWO `it.fails` FLIP. THE THIRD IS A COUNTERWEIGHT — the ED bay is already distinct since #96 and
 * must stay so. It is `it.fails` only because the module is absent.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS — I graded six never-rendered stations and all six were broken
 *
 *   oncology_bad_news_family_v1   TWO identical female meshes. The patient is "David Miller", male,
 *                                 saying "I want my sister here before we talk about the scan results".
 *   ed_stroke_alert_handoff_v1    THREE identical female meshes. Patient "Samuel Brooks", male.
 *
 * #96 fixed exactly this defect — byte-identical assets across roles — and its contract asserted it
 * for `ed_chest_pain_priority_v1` alone. Four fixes this session had that shape. Only #100's colour
 * fix generalised, because it changed a shared parse path rather than one scenario's data.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * THE CONSTRAINT THAT MAKES THIS SOLVABLE — measured, do not re-derive
 *
 *   distinct humanoid GLBs on disk (by content hash)   6
 *   distinct actors in the largest scenario            3
 *   scenarios                                         12
 *   total roles across all scenarios                  30
 *
 * Global uniqueness across 30 roles is IMPOSSIBLE with 6 bodies and is NOT what this asks. A learner
 * sees one station at a time, so the requirement is WITHIN-SCENARIO distinctness: at most 3 roles
 * per scenario, against 6 available bodies. **No new asset generation is needed or possible** — the
 * `anny` package is not importable here, and full `orchestrate_character` without it silently emits
 * ~0.8 MB stubs that pass file checks.
 *
 * Re-use ACROSS scenarios is fine and expected. Do not try to eliminate it.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * ON THE PEER ROUND. This generalises a contract whose design already survived one on #96 — identity
 * by CONTENT HASH rather than assetId string, because that defect had three distinct assetIds
 * (`..._glb`, `..._nurse_glb`, `..._spouse_glb`) resolving to one file. The only genuinely new
 * question was whether enough distinct bodies exist, and I answered it with the measurement above
 * rather than assuming. If you find a reason the #96 design does not transfer, say so and stop.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * SEX PRESENTATION IS PART OF THIS, and it is the sharper half. Two identical meshes is a bug you
 * can see; a male patient rendered as a female mesh is one a learner would find disorienting in a
 * communication station where addressing the right person is assessed. The scenarios name their
 * actors ("David Miller", "Samuel Brooks", "Aisha Khan"). **NOT DETERMINED** whether any structured
 * sex/gender field exists on the actor records or whether only the display name carries it — find
 * out, and if only names carry it, say so plainly rather than inferring sex from a name string.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * DO NOT FIX THE OTHER SURVEY DEFECTS HERE. The same six stations also show floating actors (psych),
 * nude actors (OB, peds), a giant occluding black box (peds), and an entirely unbuilt scenario
 * (ward delirium, which renders primitive monoliths and stub dialogue). Those are separate items.
 * This slice is cast identity only. If a fix here happens to help one of them, say so; do not chase.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THE THREE PULL APART. (1) demands within-scenario distinctness and is satisfiable by pointing
 * every role at a different arbitrary body regardless of role. (2) requires the body to suit the
 * role's own recorded provenance, so a nurse does not become the patient. (3) is green today and
 * forbids buying either by regressing the ED bay #96 already fixed.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectCastIdentityAcrossStations()`. Change
 * the call sites and say why if a different shape is better. What must not change: identity is
 * compared by resolved asset CONTENT, never by assetId string, and every scenario is enumerated from
 * what actually ships rather than a hardcoded list — a hardcoded list is how #96 stayed ED-only.
 *
 * IN-SCOPE VISUAL VERDICT required, naming stations: "in oncology the two figures are ___" and "in
 * ED stroke the three figures are ___". Capture with
 * `tsx tools/openclinxr/evidence/ui-xr-environment-room-capture.ts --scenario <id>` — it already
 * supports `--scenario`; `DEFAULT_SCENARIOS` at `:117-119` is a hardcoded pair and that is exactly
 * the blind spot this issue is about. Separately name any out-of-scope wrongness you see — the
 * object and what it looks like, not the word "deformed".
 *
 * SCOPE: whether two roles in the same station resolve to the same body. Says NOTHING about whether
 * any figure looks good, is dressed, or is clinically plausible — the last needs a clinician.
 */

const load = async () =>
  import("./cast-identity-all-stations.js") as Promise<Record<string, unknown>>;

type RoleAsset = {
  scenarioId: string;
  actorId: string;
  resolvedAssetPath: string;
  /** Content hash of the resolved GLB — never the assetId string. */
  assetContentHash: string;
  /** The scenario the asset's own provenance records it was generated for. */
  assetProvenanceScenarioId: string | null;
};
type Inspect = () => Promise<{ scenarios: string[]; roles: RoleAsset[] }>;

const ED = "ed_chest_pain_priority_v1";

const rolesIn = (roles: RoleAsset[], scenarioId: string) => roles.filter((r) => r.scenarioId === scenarioId);

describe("no station renders two roles as the same body (#102)", () => {
  it.fails("every scenario's roles resolve to distinct asset content", async () => {
    // The generalisation. #96 asserted this for the ED bay alone; oncology renders two identical
    // female meshes and ED stroke renders three.
    const mod = await load();
    const inspect = mod["inspectCastIdentityAcrossStations"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.scenarios.length, "fewer than the twelve shipped scenarios were enumerated").toBeGreaterThan(8);

    const offenders: string[] = [];
    for (const scenarioId of report.scenarios) {
      const roles = rolesIn(report.roles, scenarioId);
      if (roles.length < 2) continue;
      const hashes = roles.map((r) => r.assetContentHash);
      const dupes = hashes.filter((h, i) => hashes.indexOf(h) !== i);
      if (dupes.length > 0) {
        offenders.push(`${scenarioId}: ${roles.map((r) => `${r.actorId}=${r.assetContentHash.slice(0, 8)}`).join(", ")}`);
      }
    }
    expect(offenders, `stations rendering duplicate bodies:\n${offenders.join("\n")}`).toHaveLength(0);
  }, 900_000);

  it.fails("no role is played by an asset generated for a different station", async () => {
    // Kills the cheap satisfaction of the first contract: handing each role any unused body would
    // make them distinct while a peds child plays an adult stroke patient. Provenance is recorded at
    // generation and a runtime assignment cannot touch it.
    const mod = await load();
    const inspect = mod["inspectCastIdentityAcrossStations"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const mismatched = report.roles.filter(
      (r) => r.assetProvenanceScenarioId !== null && r.assetProvenanceScenarioId !== r.scenarioId,
    );
    expect(
      mismatched.map((r) => `${r.scenarioId}/${r.actorId} <- ${r.assetProvenanceScenarioId}`),
      "roles played by assets generated for another station",
    ).toHaveLength(0);
  }, 900_000);

  it.fails("the ED bay stays distinct (COUNTERWEIGHT — already true since #96)", async () => {
    // A generalisation that regresses the one station already fixed has traded one defect for
    // another. This is green today.
    const mod = await load();
    const inspect = mod["inspectCastIdentityAcrossStations"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const ed = rolesIn(report.roles, ED);
    expect(ed.length, "the ED bay resolved no roles").toBeGreaterThan(1);
    const hashes = ed.map((r) => r.assetContentHash);
    expect(new Set(hashes).size, "the ED bay regressed to shared bodies").toBe(hashes.length);
  }, 900_000);
});
