import { NodeIO } from "@gltf-transform/core";
const io = new NodeIO();
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  console.log("==", f);
  for (const m of doc.getRoot().listMeshes()) {
    const n = m.getName() ?? "";
    if (/eyebrow|eyes_low_poly/i.test(n)) {
      for (const p of m.listPrimitives()) {
        const pos = p.getAttribute("POSITION"); const idx = p.getIndices();
        const arr = pos.getArray();
        let x0=1/0,x1=-1/0,y0=1/0,y1=-1/0;
        for (let i=0;i<pos.getCount();i++){const x=arr[i*3],y=arr[i*3+1];if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}
        console.log(" ", n, "verts", pos.getCount(), "idx", idx?.getCount(), "x", x0.toFixed(4), x1.toFixed(4), "y", y0.toFixed(4), y1.toFixed(4));
      }
    }
  }
}
