import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#189). Three REDs. All three flip.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, GRADED IN PIXELS
 *
 * `peds_asthma_parent_anxiety_v1` is the only station in the bank that had never been rendered.
 * Captured 2026-08-08: the parent figure stands **nude and bald** in a paediatric respiratory
 * encounter. The child in the same room renders correctly — blue top, jeans, hair.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE ASSETS ARE FINE — measured with glTF-Transform NodeIO, trust these, do not re-derive
 *
 *   actor   real garment tris   painted cloth tris   scalp tris   renders correctly
 *   child          3860            6680 + 2152          796            YES
 *   parent   4149 + 4529          2192 + 2800         3428            NO (nude, bald)
 *   nurse    3936 + 3939          2160 + 2824         3480            occluded in capture
 *
 * The parent's garment materials are mauve (0.62,0.28,0.38) and grey (0.42,0.36,0.40) against skin
 * at (0.76,0.53,0.43). **Not a colour collision.** The scalp is dark brown (0.12,0.07,0.04), 3428
 * tris, and the rendered head is bald — whatever suppresses the garments suppresses the hair.
 *
 * What renders is the 18272-tri `anny_base` SKIN primitive alone, while the separate garment meshes,
 * the painted cloth primitives on that same base, and the scalp primitive do not.
 *
 * **Not a load failure.** A failed load produces the 1266-tri primitive dummy (#187) — this is a
 * detailed 18272-tri body. #187 also wrapped the post-load compose step in try/catch and made it
 * loud, so the console may now name the cause.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE CAUSE IS NOT KNOWN TO ME BEYOND THAT MEASUREMENT — trace it yourself.
 *
 * Candidates, UNORDERED, and they may all be wrong: a traverse setting visible=false per child; a
 * material swap on the composed actor; a mesh-name filter that matches the child's naming and not
 * the parent's; a partially-composed actor where the compose step threw. I have NOT distinguished
 * between these and the answer may be none of them. Name the interaction you actually find.
 *
 * FIRST MEASUREMENT, before any product edit: dump every mesh in the LIVE scene for all three actors
 * — name, visible, frustumCulled, material name, world AABB, triangles — and diff parent against
 * child. Same generator, same station: whatever differs is the defect. **The child is the
 * known-good column.**
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SIGNATURE IS YOURS. These read `inspectActorGarmentPresence()`. What must not change:
 *  - stations and actors enumerated DYNAMICALLY from what ships, never a literal list — a hardcoded
 *    list is what hid ten un-captured rooms for weeks
 *  - `inFile` comes from the exported glTF; `inScene` from the live scene graph. The whole defect is
 *    that those two disagree, so a report built from one of them proves nothing
 *  - Blender is never the instrument (#60)
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT MUST NOT HAPPEN — the cheap green has a name
 *
 * Forcing every garment mesh visible reopens #73: painted clothing was removed from torsos wearing
 * real garments precisely because two layers fought, and an open cardigan cannot cover what painted
 * trousers used to. A garment that appears must NOT double with a painted region already covering
 * the same area, and **no actor may be made to look dressed by hiding body geometry.** Contract 3
 * asserts both.
 *
 * No new `eslint-disable`, `@ts-expect-error`, `@ts-expect-error` or `OPENCLAW_SKIP_HOOKS` in source
 * paths — merge-kill fails the land regardless of the comment justifying it. Never raise a
 * file-size ceiling; split instead. Do not run full `orchestrate_character` — without the `anny`
 * package it silently writes ~0.8 MB stub GLBs that pass file checks.
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS
 * THE OPPOSITE DIRECTION FROM THE DEFECT — say so IN THE FIRST REPORT YOU WRITE, at the moment you
 * find it, BEFORE running a corrected version. Running a corrected version afterwards is fine and
 * expected. A broken proof is my defect and I need to see it at discovery.
 *
 * SCOPE: whether meshes present in an asset reach the rendered scene. Says NOTHING about garment
 * QUALITY or realism — #46 froze those claims and this is presence, not quality. Says nothing about
 * the black volume in the same station, the untextured slab props (#186), or bare feet (#188).
 */

const load = async () =>
  import("./actor-garment-presence-in-scene.js") as Promise<Record<string, unknown>>;

type MeshRow = {
  meshName: string;
  /** Present in the exported glTF for this actor's cast asset. */
  inFile: boolean;
  /** Present in the live three.js scene graph under this actor's root. */
  inScene: boolean;
  visible: boolean | null;
  frustumCulled: boolean | null;
  materialName: string | null;
  triangles: number;
  /** Classified from the mesh/material name: real garment, painted cloth region, scalp, skin, other. */
  kind: "real_garment" | "painted_cloth" | "scalp" | "skin" | "other";
};

type ActorRow = {
  scenarioId: string;
  actorId: string;
  assetBasename: string;
  meshes: MeshRow[];
};

type Report = {
  /** Enumerated dynamically from shipped scenarios and their casts. */
  actors: ActorRow[];
  claimScope: string;
  notEvidenceFor: string[];
};

type Inspect = () => Promise<Report>;

const dropped = (a: ActorRow, kind: MeshRow["kind"]) =>
  a.meshes.filter((m) => m.kind === kind && m.inFile && (!m.inScene || m.visible === false));

describe("what an asset contains is what the room renders (#189)", () => {
  it("every actor renders the garment meshes its asset contains", async () => {
    // The parent carries 8678 triangles of real garment and 4992 of painted cloth, in mauve and grey
    // against skin. It renders nude. The child, from the same generator in the same station, does not.
    const mod = await load();
    const inspect = mod["inspectActorGarmentPresence"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.actors.length, "fewer than 20 actors enumerated — is the list hardcoded?")
      .toBeGreaterThanOrEqual(20);

    const missing = report.actors
      .flatMap((a) => [...dropped(a, "real_garment"), ...dropped(a, "painted_cloth")]
        .map((m) => `${a.scenarioId}/${a.actorId}: ${m.meshName} (${m.triangles} tris, inScene=${m.inScene}, visible=${m.visible})`));
    expect(missing, "garment meshes present in the asset that do not reach the rendered scene").toEqual([]);
  }, 900_000);

  it("the scalp mesh reaches the scene when the asset has one", async () => {
    // 3428 triangles of dark brown scalp on a head that renders bald. Whatever suppresses the
    // garments suppresses the hair — if that turns out to be a second cause, say so and file it.
    const mod = await load();
    const inspect = mod["inspectActorGarmentPresence"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const bald = report.actors
      .flatMap((a) => dropped(a, "scalp").map((m) => `${a.scenarioId}/${a.actorId}: ${m.meshName} (${m.triangles} tris)`));
    expect(bald, "scalp geometry present in the asset that does not reach the rendered scene").toEqual([]);
  }, 900_000);

  it("no actor is dressed by hiding the body (COUNTERWEIGHT)", async () => {
    // Two cheap wrong answers. (a) Force everything visible — reopens #73, where painted clothing was
    // removed from torsos wearing real garments because the two layers fought. (b) Hide body geometry
    // so the figure reads as clothed. Both are refused here.
    const mod = await load();
    const inspect = mod["inspectActorGarmentPresence"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();

    // (a) A real garment and a painted cloth region must not BOTH render on the same actor.
    const doubled = report.actors
      .filter((a) => {
        const live = (k: MeshRow["kind"]) =>
          a.meshes.some((m) => m.kind === k && m.inScene && m.visible !== false);
        return live("real_garment") && live("painted_cloth");
      })
      .map((a) => `${a.scenarioId}/${a.actorId}`);
    expect(doubled, "actors rendering a real garment AND a painted cloth region over the same body").toEqual([]);

    // (b) Skin geometry that exists in the file must still be in the scene. Hiding the body is not
    // clothing it.
    const hiddenBody = report.actors
      .flatMap((a) => dropped(a, "skin").map((m) => `${a.scenarioId}/${a.actorId}: ${m.meshName}`));
    expect(hiddenBody, "body geometry removed from the scene — hiding the body is not dressing it").toEqual([]);

    expect(report.notEvidenceFor.join(" ").toLowerCase()).toContain("clinical");
  }, 900_000);
});
