import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#60) — every shipped humanoid carries a stray Blender primitive.
 *
 * MEASURED, not inferred. Loading each runtime GLB in Blender shows a mesh literally named
 * `Icosphere`, `verts=42`, `h=2.000 x=1.902 y=2.000` — a 2 metre sphere enclosing a 1.25 metre child
 * figure. Present in all three `generated-humanoids/*.glb` and in the `anny-real-garment/current`
 * patient assets. `Icosphere` is Blender's default primitive name, so nothing renamed it and nothing
 * deliberately placed it.
 *
 * WHY IT MATTERS MORE THAN TIDINESS. At 42 vertices it is invisible to every gate this project has:
 * face counts, file sizes, texture manifests, vertex totals. It already cost real time — it made a
 * render of a SOUND asset look like a shredded upper body, and it produced a 2× disagreement between
 * two instruments that were both working correctly (the proportions probe measures the skinned body
 * mesh; a whole-file renderer measured everything, and the sphere sat between them).
 *
 * THE TWO CONTRACTS EXIST BECAUSE EITHER ALONE IS GAMEABLE.
 *
 * A name denylist alone is defeated by renaming `Icosphere` to `bounds_helper` and shipping the same
 * 2 metre sphere. A size check alone is defeated by shrinking it. Together they require the geometry
 * to actually go.
 *
 * The peer round rejected the allowlist I proposed: legitimate meshes are added routinely
 * (`openclinxr_real_garment_*`, LODs), so an allowlist fails on honest work while a denylist of
 * Blender defaults only fires on scratch objects.
 *
 * NOT VERIFIED, AND DO NOT ASSUME: what creates it. A grep of `automate_blender.py` did not find it —
 * primitives there are created and renamed to project names. It may come from the Anny import, a
 * leftover default scene object, or a bake helper. It also has NOT been shown to be unused: before
 * deleting, check whether anything parents to it, references it by name, skins to it, or uses it as a
 * bounds/IBL proxy.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectHumanoidMeshHygiene({ glbPath })`
 * returning `{ meshes, violations }`. Change the call sites and say why if a different shape is
 * better. What must not change: the geometry is gone, not renamed, and not merely shrunk.
 */

const load = async () => import("./humanoid-mesh-hygiene-probe.js") as Promise<Record<string, unknown>>;

type MeshInfo = { name: string; vertexCount: number; extent: number };
type Inspect = (input: { glbPath: string }) => Promise<{ meshes: MeshInfo[]; violations: string[] }>;

const SHIPPED = [
  "apps/ui-xr/public/generated-humanoids/peds_anxious_parent.glb",
  "apps/ui-xr/public/generated-humanoids/peds_nurse_kevin.glb",
  "apps/ui-xr/public/generated-humanoids/peds_patient_child.glb",
];

describe("shipped humanoids carry no scratch geometry (#60)", () => {
  it.fails("no shipped humanoid contains a mesh named after a Blender default primitive", async () => {
    const mod = await load();
    const inspect = mod["inspectHumanoidMeshHygiene"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    for (const glbPath of SHIPPED) {
      const { meshes } = await inspect!({ glbPath });
      const defaults = meshes.filter((m) => /^(Icosphere|Sphere|Cube|Plane|Cylinder|Cone|Torus|Circle)(\.\d+)?$/u.test(m.name));
      expect(defaults.map((m) => m.name), glbPath).toEqual([]);
    }
  }, 120_000);

  it.fails("no shipped humanoid contains a mesh far larger than its body, whatever it is called", async () => {
    // Kills the rename: `Icosphere` -> `bounds_helper` keeps the same 2m sphere and would pass the
    // check above. The body is the largest LEGITIMATE mesh, so nothing should dwarf it.
    const mod = await load();
    const inspect = mod["inspectHumanoidMeshHygiene"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    for (const glbPath of SHIPPED) {
      const { meshes } = await inspect!({ glbPath });
      const body = meshes.reduce((a, b) => (b.vertexCount > a.vertexCount ? b : a), meshes[0]!);
      const oversized = meshes.filter((m) => m.name !== body.name && m.extent >= body.extent * 1.5);
      expect(oversized.map((m) => `${m.name}:${m.extent.toFixed(2)}`), glbPath).toEqual([]);
    }
  }, 120_000);
});
