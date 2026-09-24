import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));

/**
 * Room bake links created objects into the view layer.
 *
 * Measured 2026-09-24: a render script linked new cards with
 * bpy.context.collection.objects.link() after open_mainfile. That context
 * collection is not in the view layer, so every card rendered nothing (probe
 * card reported `in view layer: False`, pixel delta 0). The fix is
 * link_bake_object(), which links through the active layer collection and
 * raises if the object still lands outside the view layer. This test drives
 * the shipped bake source: no raw context-collection link may remain, every
 * creation site routes through the guard, and the guard text itself fails
 * closed on a missed link. No Blender in this test: it asserts the shipped
 * source carries the guard rather than re-implementing Blender linking.
 */

const BAKE_REL = "room-albedo-ao-bake.py";

async function bakeSource(): Promise<string> {
  return readFile(path.join(SRC, BAKE_REL), "utf8");
}

describe("the room bake links objects into the view layer", () => {
  it("(1) no raw bpy.context.collection.objects.link call remains", async () => {
    const src = await bakeSource();
    expect(src).not.toContain("bpy.context.collection.objects.link(");
  });

  it("(2) every object creation site routes through link_bake_object", async () => {
    const src = await bakeSource();
    const guardCalls = src.split("link_bake_object(").length - 1;
    // rig probe lights, legacy key, down softbox, up key, four wall washes:
    // at minimum the five link sites the bake had before the guard.
    expect(guardCalls).toBeGreaterThanOrEqual(5);
    expect(src).toContain("def link_bake_object(obj)");
  });

  it("(3) the guard fails closed when the link misses the view layer", async () => {
    const src = await bakeSource();
    expect(src).toContain("active_layer_collection");
    expect(src).toContain("view_layer.objects");
    expect(src).toMatch(/raise RuntimeError\(.*not in view layer/);
  });
});
