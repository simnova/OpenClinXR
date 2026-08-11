import { NodeIO } from "@gltf-transform/core";
async function main() {
  const io = new NodeIO();
  const doc = await io.read("apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb");
  const root = doc.getRoot();
  const scenes = root.listScenes();
  const scene = scenes[0];
  console.log("scenes:", scenes.length, "scene children:", scene.listChildren().map(c => c.getName()));
  const walk = (n: any, depth: number) => {
    if (depth > 4) return;
    const kids = n.listChildren ? n.listChildren() : [];
    console.log("  ".repeat(depth) + (n.getName() || "?") + (n.getType ? " [" + n.getType() + "]" : ""));
    for (const k of kids) walk(k, depth + 1);
  };
  for (const c of scene.listChildren()) walk(c, 0);
}
main();
