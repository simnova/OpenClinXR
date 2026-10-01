import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {prune} from '@gltf-transform/functions';
import {MeshoptSimplifier} from 'meshoptimizer';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const [input,output,report]=process.argv.slice(2);
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc=await io.read(input);
await MeshoptSimplifier.ready;
const primitives=doc.getRoot().listMeshes().flatMap(m=>m.listPrimitives());
assert.equal(primitives.length,1,'This bounded treatment expects one primitive');
const p=primitives[0],position=p.getAttribute('POSITION')!,normal=p.getAttribute('NORMAL')!,uv=p.getAttribute('TEXCOORD_0')!;
assert.ok(position&&normal&&uv);
const positions=new Float32Array(position.getCount()*3),attributes=new Float32Array(position.getCount()*5);
for(let i=0;i<position.getCount();i++) {
 positions.set(position.getElement(i,[]),i*3);
 attributes.set([...normal.getElement(i,[]),...uv.getElement(i,[])],i*5);
}
const indices=new Uint32Array(p.getIndices()!.getArray()!);
const [out,error]=MeshoptSimplifier.simplifyWithAttributes(indices,positions,3,attributes,5,[1,1,1,1,1],null,40000*3,1,['Permissive']);
assert.ok(out.length/3<=40000,`Budget not reached: ${out.length/3}`);
p.getIndices()!.setArray(out);
// Compact all original attributes with a shared remap; values and PBR bindings are unchanged.
const [remap,count]=MeshoptSimplifier.compactMesh(out);
for(const semantic of p.listSemantics()) {
 const a=p.getAttribute(semantic)!,old=a.getArray()!,width=a.getElementSize();
 const next=new (old.constructor as any)(count*width);
 for(let i=0;i<remap.length;i++) if(remap[i]<count) next.set(old.subarray(i*width,(i+1)*width),remap[i]*width);
 a.setArray(next);
}
await doc.transform(prune());await io.write(output,doc);
const result={method:'meshoptimizer simplifyWithAttributes',reason:'Existing iterate-optimize ladder plateaus above 88k on UV/normal seams',flags:['Permissive'],attributeWeights:{normal:[1,1,1],uv:[1,1]},targetTriangles:40000,targetError:1,reportedError:error,inputTriangles:indices.length/3,triangles:out.length/3,vertices:count,materialChanges:false,note:'Seam constraints relaxed; attribute-aware error used. Not a visual survival verdict.'};
writeFileSync(report,JSON.stringify(result,null,2)+'\n');console.log(result);
