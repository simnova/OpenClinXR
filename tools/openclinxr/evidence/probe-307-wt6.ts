import { NodeIO } from "@gltf-transform/core";
async function main() {
  const io = new NodeIO();
  const doc = await io.read("apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb");
  const root = doc.getRoot();
  for (const n of root.listNodes()) {
    if (n.getMesh()) {
      const t = n.getTranslation(), r = n.getRotation(), s = n.getScale();
      console.log(n.getName().slice(0,40).padEnd(42), "T", t.map(v=>v.toFixed(4)).join(","), "Q", r.map(v=>v.toFixed(3)).join(","), "S", s.map(v=>v.toFixed(3)).join(","), "world", n.getWorldTranslation().map(v=>v.toFixed(3)).join(","));
    }
  }
}
main();
