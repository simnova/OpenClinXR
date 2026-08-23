import { NodeIO } from "@gltf-transform/core";
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const norm=v=>Math.hypot(v[0],v[1],v[2]);
const SHARP_DEG=60;
const d = await new NodeIO().read("apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb");
for (const m of d.getRoot().listMeshes()) {
  for (const pr of m.listPrimitives()) {
    const matName = pr.getMaterial()?.getName() || "";
    const key = `${m.getName()}::${matName}`;
    if (!/makeclothes_library/i.test(matName) || /eyes/i.test(matName)) continue;
    if (!/ob_patient_aisha|mpfb-ob-patient-aisha/.test(m.getName()||"")) continue;
    const pos = pr.getAttribute("POSITION").getArray();
    const idx = pr.getIndices().getArray();
    const nT = idx.length/3;
    // coplanar + sharp join census (same algorithm family as the contract)
    let coplanar=0, coplanarSplit=0, sharp=0, sharpSplit=0;
    const edges = new Map();
    for (let t=0; t<idx.length; t+=3) {
      const i0=idx[t],i1=idx[t+1],i2=idx[t+2];
      const p0=[pos[i0*3],pos[i0*3+1],pos[i0*3+2]];
      const p1=[pos[i1*3],pos[i1*3+1],pos[i1*3+2]];
      const p2=[pos[i2*3],pos[i2*3+1],pos[i2*3+2]];
      const nn=cross(sub(p1,p0),sub(p2,p0));
      const nl=norm(nn);
      for (const [a,b] of [[i0,i1],[i1,i2],[i2,i0]]) {
        const k=a<b?`${a}_${b}`:`${b}_${a}`;
        if(!edges.has(k))edges.set(k,[]);
        edges.get(k).push({nn,nl});
      }
    }
    for (const [,tris] of edges) {
      if(tris.length!==2){continue;}
      const [A,B]=tris;
      const cosh=dot(A.nn,B.nn)/(A.nl*B.nl);
      const ang=Math.acos(Math.max(-1,Math.min(1,cosh)))*180/Math.PI;
      const split=A.nn.some((v,i)=>v!==B.nn[i])||A.nl!==B.nl;
      if(ang<5){coplanar++;if(split)coplanarSplit++;}
      if(ang>SHARP_DEG){sharp++;if(split)sharpSplit++;}
    }
    console.log(`${key}: tris=${nT} coplanar=${coplanar} coplanarSplit=${coplanarSplit} sharp=${sharp} sharpSplit=${sharpSplit}`);
  }
}
