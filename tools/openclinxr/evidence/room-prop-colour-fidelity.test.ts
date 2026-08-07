import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#100) — 76 of 78 authored room-prop colours are discarded at parse.
 *
 * ALL THREE ARE `it.fails` AND ALL THREE FLIP TO `it(`. They are not all REDs:
 *   (1) and (2) are REDs — behaviour that does not exist.
 *   (3) is a COUNTERWEIGHT — a genuinely malformed colour must STILL fall back rather than throw.
 *       The fallback exists for a reason and must survive the fix.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * THE DEFECT, MEASURED
 *
 * `main.ts:6219-6220` — the ONLY site in the repo that turns a manifest colour into a material:
 *
 *     Number.isFinite(Number.parseInt(prop.colorHex, 16)) ? Number.parseInt(prop.colorHex, 16) : 0xd9dde3
 *     Number.isFinite(Number.parseInt(prop.accentColorHex, 16)) ? … : 0x2563eb
 *
 *     Number.parseInt("#fef3c7", 16)  ->  NaN  ->  fallback wins
 *
 * Across the generated scene manifests under `apps/ui-xr/public/xr-assets/generated`:
 *
 *     76  values carry a leading '#'   (rejected)
 *      2  values are bare hex           (work — both `111827`, ED only)
 *     10  scenarios affected
 *
 * A PEER ROUND CORRECTED MY FIRST FRAMING and the correction matters for the fixture: it is NOT
 * "every prop is the same grey". The two bare values work, so ED bodies can be dark. But `#`
 * primaries collapse to `0xd9dde3` (`main.ts:6265-6269`) and ACCENTS are almost all `#`, so they
 * collapse to `0x2563eb` essentially everywhere including ED. Assert BOTH channels.
 *
 * ROOT CAUSE UNDERNEATH THE SYMPTOM: `EncounterRuntimeRoomProp` declares `colorHex: string` and
 * `accentColorHex: string` (`runtime-bundles.ts:102-103`) with NO CONVENTION ANYWHERE. The producer
 * authors CSS hex (`generated-ed-station-runtime-bundle.ts:568-571, 635, 652-655`), the consumer
 * expects bare, and nothing pins it. Whatever you change, **pin the convention where the type lives**
 * or this drifts back.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * FIX THE CONSUMER FIRST — this is a decision, not an assumption
 *
 * The peer round argued it and I agree: the factory AND the publication payload tests already ship
 * CSS `#` (`encounter-publication-payloads.test.ts:1315-1316`), so a producer-only fix leaves every
 * already-shipped public manifest broken until a full regeneration, and ED's accents would still be
 * `#`. Normalising at the producer as well is welcome, but NOT INSTEAD.
 *
 * If you conclude otherwise after looking, say why in the commit message and do it your way — but
 * say it, because "it is only one character" is exactly the reasoning that produced this bug.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THE FIXTURE USES ODD HEXES — a peer round killed my first version
 *
 * My REDs were "colours match the manifest" plus "two props differ from each other". Both pass on a
 * WRONG FIX: paint by `semanticRole` from a fixed palette. The factory reuses the same four hexes
 * across templates (`#f8fafc`, `#eff6ff`, `#fef3c7`, `#f3e8ff`), so a role-keyed palette matches most
 * scenarios AND produces distinct props while ignoring the manifest entirely.
 *
 * So the fixture below uses colours that appear NOWHERE in the template set, and asserts PER PROP ID
 * on BOTH channels. A palette lookup cannot produce `0x3b0f6d` for a prop that asks for it.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * ASSERT MATERIALS, NOT A PARSE HELPER. A helper returning the right number is the #55 class — green
 * about nothing. Read `material.color.getHex()` off built meshes. The peer round's cheaper honest
 * instrument: call the room-prop builder under vitest with three.js rather than standing up the page.
 * If that requires extracting it from `main.ts`, that is fine and reduces a god-file under a
 * shrink-only ratchet — do NOT raise its ceiling.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `buildRoomPropMaterialColours({ props })`.
 * Change the call sites and say why if a different shape is better. What must not change: colours are
 * read from BUILT MATERIALS, both channels are asserted, and the fixture's values are not in the
 * factory's template palette.
 *
 * NOT DETERMINED: whether the two bare `111827` values are deliberate or accidental; whether any
 * non-runtime consumer depends on the `#` form; what the rooms actually look like once colours land —
 * this may reveal the geometry is better than it appears, or worse.
 *
 * IN-SCOPE VISUAL VERDICT required: "the room now reads as ___". I grade the re-rendered capture and
 * that closes this. Separately name any out-of-scope wrongness — the object and what it looks like.
 *
 * SCOPE: whether authored prop colours reach the renderer. Says NOTHING about whether the palette is
 * well chosen or clinically appropriate, nor about fixture geometry (#97's residual).
 *
 * ## FIXED (#100)
 *
 * Consumer-first: `parseRuntimeRoomPropColorHex` (packages/openclinxr/asset-registry/src/runtime-room-prop-color.ts)
 * strips optional leading `#` and pins the CSS-hex convention next to `EncounterRuntimeRoomProp`
 * (`colorHex` / `accentColorHex` JSDoc in runtime-bundles.ts). `main.ts` createDetailedEdRoomProps
 * uses `roomPropColourNumbers` from extracted `apps/ui-xr/src/room-prop-materials.ts` (no ceiling raise).
 * Evidence asserts `material.color.getHex()` via `buildRoomPropMaterialColours`, not the helper alone.
 * Malformed input still falls back to 0xd9dde3 / 0x2563eb. Not a role-keyed palette.
 */

const load = async () =>
  import("./room-prop-colour-fidelity.js") as Promise<Record<string, unknown>>;

type PropInput = { propId: string; colorHex: string; accentColorHex: string };
type PropColours = { propId: string; bodyColor: number; accentColor: number };
type Build = (input: { props: PropInput[] }) => Promise<{ props: PropColours[] }>;

/**
 * Deliberately NOT the factory's template palette (#f8fafc / #eff6ff / #fef3c7 / #f3e8ff). A
 * role-keyed or index-keyed palette cannot produce these by accident.
 */
const ODD_FIXTURE: PropInput[] = [
  { propId: "probe_alpha", colorHex: "#3b0f6d", accentColorHex: "#c2410c" },
  { propId: "probe_beta", colorHex: "#0b3d2e", accentColorHex: "#7e1d3f" },
  { propId: "probe_bare", colorHex: "5c1a8b", accentColorHex: "1f6f4a" },
];

describe("authored room-prop colours reach the renderer (#100)", () => {
  it("both channels match the authored value, with or without a leading hash", async () => {
    // The whole defect. `#`-prefixed values currently become 0xd9dde3 / 0x2563eb regardless of what
    // was authored. Bare values already work and must continue to.
    const mod = await load();
    const build = mod["buildRoomPropMaterialColours"] as Build | undefined;
    expect(build).toBeTypeOf("function");

    const report = await build!({ props: ODD_FIXTURE });
    const byId = new Map(report.props.map((p) => [p.propId, p]));

    expect(byId.get("probe_alpha")?.bodyColor).toBe(0x3b0f6d);
    expect(byId.get("probe_alpha")?.accentColor).toBe(0xc2410c);
    expect(byId.get("probe_beta")?.bodyColor).toBe(0x0b3d2e);
    expect(byId.get("probe_beta")?.accentColor).toBe(0x7e1d3f);
    // Bare hex already parses today — the fix must not break it.
    expect(byId.get("probe_bare")?.bodyColor).toBe(0x5c1a8b);
    expect(byId.get("probe_bare")?.accentColor).toBe(0x1f6f4a);
  }, 300_000);

  it("a real shipped manifest's colours survive to materials", async () => {
    // The fixture above proves the parse. This proves the wiring: real authored data, read back off
    // built materials. A fix that only handles synthetic input is not a fix.
    const mod = await load();
    const build = mod["buildRoomPropMaterialColours"] as Build | undefined;
    const fromManifest = mod["roomPropsFromShippedManifest"] as
      | ((scenarioId: string) => Promise<PropInput[]>)
      | undefined;
    expect(build).toBeTypeOf("function");
    expect(fromManifest, "expose a way to read a real shipped manifest").toBeTypeOf("function");

    const props = await fromManifest!("ed_chest_pain_priority_v1");
    expect(props.length, "no room props in the shipped ED manifest").toBeGreaterThan(0);

    const report = await build!({ props });
    const declared = new Map(props.map((p) => [p.propId, p]));
    for (const built of report.props) {
      const want = declared.get(built.propId);
      if (!want) continue;
      const expected = Number.parseInt(want.colorHex.replace(/^#/u, ""), 16);
      expect(
        built.bodyColor,
        `${built.propId} authored ${want.colorHex} rendered 0x${built.bodyColor.toString(16)}`,
      ).toBe(expected);
    }
  }, 300_000);

  it("a genuinely malformed colour still falls back rather than throwing (COUNTERWEIGHT)", async () => {
    // The fallback exists for a reason. A fix that makes bad input throw would break scene loading
    // for one typo, which is worse than a grey prop.
    const mod = await load();
    const build = mod["buildRoomPropMaterialColours"] as Build | undefined;
    expect(build).toBeTypeOf("function");

    const report = await build!({
      props: [{ propId: "probe_bad", colorHex: "not-a-colour", accentColorHex: "" }],
    });
    const bad = report.props.find((p) => p.propId === "probe_bad");
    expect(bad, "malformed prop was dropped entirely instead of falling back").toBeDefined();
    expect(bad!.bodyColor).toBe(0xd9dde3);
    expect(bad!.accentColor).toBe(0x2563eb);
  }, 300_000);
});
