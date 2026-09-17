export function inspectAuthoredAlpha(gltf,rows) {
 const errors=[];
 for(let index=0;index<(gltf.materials??[]).length;index++) {
  const authored=gltf.materials[index],observed=rows?.find(r=>r.gltfMaterialIndex===index);
  if(!observed){errors.push("material-observation-missing:"+index);continue;}
  const mode=authored.alphaMode??"OPAQUE",alpha=authored.pbrMetallicRoughness?.baseColorFactor?.[3]??1;
  if(observed.opacity!==alpha)errors.push("authored-opacity-mutated:"+index);
  if(observed.transparent!==(mode==="BLEND"))errors.push("authored-transparency-mutated:"+index);
  if(observed.alphaTest!==(mode==="MASK"?(authored.alphaCutoff??0.5):0))errors.push("authored-cutoff-mutated:"+index);
 }
 return errors;
}
