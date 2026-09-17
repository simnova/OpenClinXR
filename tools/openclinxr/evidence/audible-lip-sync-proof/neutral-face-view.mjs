import {Box3, Color, DirectionalLight, HemisphereLight, PerspectiveCamera, PropertyBinding, Quaternion, Scene, Vector3, WebGLRenderer} from "three";
import {isFittedHairMeshName} from "../../../../packages/openclinxr/xr-scene/dist/index.js";
import {createObservedRowOverlay} from "./observed-row-overlay.mjs";

const components = ["getX", "getY", "getZ", "getW"];
const vec = (bone) => bone.getWorldPosition(new Vector3());
const requireVector = (v, reason) => { if (!Number.isFinite(v.lengthSq()) || v.lengthSq() < 1e-10) throw new Error(reason); return v.normalize(); };
const eyeName = (side) => {
  const authored = `eye.${side}`;
  return [authored, PropertyBinding.sanitizeNodeName(authored)];
};

function facialMorphNames(dict) {
  return Object.keys(dict ?? {}).filter((name) => name.startsWith("viseme_") || name === "mouth-open");
}

/** Real deforming face: viseme/mouth-open target with nonzero morph position deltas. Garments with head weights do not qualify. */
export function isDeformingFacialPrimitive(object) {
  const dict = object?.morphTargetDictionary;
  const names = facialMorphNames(dict);
  if (!names.length || !object.morphTargetInfluences) return false;
  const morphPos = object.geometry?.morphAttributes?.position;
  if (!morphPos?.length) return false;
  for (const name of names) {
    const attr = morphPos[dict[name]];
    if (!attr) continue;
    for (let i = 0; i < attr.count; i++) {
      if (attr.getX(i) || attr.getY(i) || attr.getZ(i)) return true;
    }
  }
  return false;
}

function headDominantIndices(object, members) {
  const {skinIndex,skinWeight,position}=object.geometry.attributes;
  if (!skinIndex || !skinWeight || !position) return [];
  const indices=[];
  for(let i=0;i<position.count;i++){
    let best=-1,weight=0;
    for(let k=0;k<4;k++){const w=skinWeight[components[k]](i);if(w>weight){weight=w;best=skinIndex[components[k]](i);}}
    if(weight>0 && members.has(object.skeleton.bones[best]))indices.push(i);
  }
  return indices;
}

/** Facial morph primitive + head-joint verts of those primitives only. Fitted hair (incl. skinned) is containment. */
export function identifyHeadGeometry(root) {
  const meshes=[]; const containMeshes=[]; let head, eyes, bindQuaternion, jaw;
  root.traverse((object) => {
    if (!object.isSkinnedMesh || !object.skeleton) return;
    const skeleton=object.skeleton;
    const index=skeleton.bones.findIndex((bone) => bone.name === "head");
    if(index < 0)return;
    head ??= skeleton.bones[index];
    const left=skeleton.bones.find((bone)=>eyeName("L").includes(bone.name));
    const right=skeleton.bones.find((bone)=>eyeName("R").includes(bone.name));
    if(left && right)eyes ??= {left,right};
    if(!bindQuaternion){const bind=skeleton.boneInverses[index].clone().invert();bind.decompose(new Vector3(),bindQuaternion=new Quaternion(),new Vector3());}
  });
  if(!head || !eyes || !bindQuaternion)throw new Error("neutral-head-rig-missing");
  const members=new Set();
  head.traverse((bone)=>{
    if(!bone.isBone)return;
    members.add(bone);
    if(bone.name === "jaw" || bone.name === PropertyBinding.sanitizeNodeName("jaw")) jaw ??= bone;
  });
  root.traverse((object) => {
    if (!object.isMesh || !object.geometry?.attributes?.position) return;
    if (isFittedHairMeshName(object.name) || isFittedHairMeshName(object.userData?.name) || isFittedHairMeshName(object.geometry?.name)) {
      containMeshes.push({object,indices:Array.from({length:object.geometry.attributes.position.count},(_,i)=>i)});
      return;
    }
    if (!object.isSkinnedMesh || !isDeformingFacialPrimitive(object)) return;
    const indices=headDominantIndices(object, members);
    if(indices.length)meshes.push({object,indices});
  });
  if(!meshes.length)throw new Error("neutral-face-primitive-missing");
  const localUp=new Vector3(0,1,0).applyQuaternion(bindQuaternion.clone().invert());
  return {head,eyes,jaw,meshes,containMeshes,localUp,bindQuaternion};
}

/** getVertexPosition is mesh-local after bindMatrixInverse (shader skinning_vertex). World needs matrixWorld for skinned and unskinned. */
export function skinnedWorldPoint(object, index, target) {
  object.getVertexPosition(index, target);
  return target.applyMatrix4(object.matrixWorld);
}

export function bindInverseMatchesWorld(object) {
  if (!object?.isSkinnedMesh || !object.bindMatrixInverse) return null;
  const product=object.bindMatrixInverse.clone().multiply(object.matrixWorld);
  const identity=product.elements;
  let max=0;
  for (let i=0;i<16;i++) max=Math.max(max, Math.abs(identity[i]-(i%5===0?1:0)));
  return max;
}

export function fitNeutralHeadCamera(rig, camera, root) {
  root.updateWorldMatrix(true,true);
  const contain=rig.containMeshes??[];
  const preBindRefresh=contain.map(({object,indices})=>({
    bindMode:object.bindMode??null,
    bindMatrixInverse:object.bindMatrixInverse?Array.from(object.bindMatrixInverse.elements):null,
    bindInverseWorldResidual:bindInverseMatchesWorld(object),
    worldVertex:indices.length?skinnedWorldPoint(object,indices[0],new Vector3()).toArray():null,
  }));
  root.updateMatrixWorld(true);
  const hairBefore=contain.map(({object,indices})=>indices.length?skinnedWorldPoint(object,indices[0],new Vector3()).toArray():null);
  for(const {object} of rig.meshes)object.skeleton?.update();
  for(const {object} of contain)object.skeleton?.update();
  const faceSkeleton=rig.meshes[0]?.object.skeleton;
  const eyeMid=vec(rig.eyes.left).add(vec(rig.eyes.right)).multiplyScalar(.5);
  const right=requireVector(vec(rig.eyes.right).sub(vec(rig.eyes.left)),"neutral-eye-axis-degenerate");
  const up=rig.localUp.clone().applyQuaternion(rig.head.getWorldQuaternion(new Quaternion()));
  up.addScaledVector(right,-up.dot(right));requireVector(up,"neutral-head-up-degenerate");
  const front=requireVector(right.clone().cross(up),"neutral-head-front-degenerate");
  const faceOffset=eyeMid.clone().sub(vec(rig.head));const sign=front.dot(faceOffset);
  if(!Number.isFinite(sign) || Math.abs(sign)<1e-5)throw new Error("neutral-face-front-ambiguous");
  if(sign<0)front.negate();
  const points=[];const bounds=new Box3();
  const sample=({object,indices})=>{
    for(const i of indices){
      const p=skinnedWorldPoint(object,i,new Vector3());
      points.push(p);
      const d=p.clone().sub(eyeMid);
      bounds.expandByPoint(new Vector3(d.dot(right),d.dot(up),d.dot(front)));
    }
  };
  for(const mesh of rig.meshes)sample(mesh);
  const sampledHeadVertices=points.length;
  for(const mesh of rig.containMeshes??[])sample(mesh);
  if(sampledHeadVertices<3 || !Number.isFinite(bounds.min.x+ bounds.max.y))throw new Error("neutral-head-bounds-refused");
  const centerLocal=bounds.getCenter(new Vector3());const center=eyeMid.clone().addScaledVector(right,centerLocal.x).addScaledVector(up,centerLocal.y).addScaledVector(front,centerLocal.z);
  const size=bounds.getSize(new Vector3());const tan=Math.tan(camera.fov*Math.PI/360);
  // 0.85 is a framing target, never a perceptual acceptance floor.
  const distance=Math.max(size.y/(2*tan*.85),size.x/(2*tan*camera.aspect*.85))+size.z/2;
  camera.position.copy(center).addScaledVector(front,distance);camera.up.copy(up);camera.near=Math.max(.001,distance-size.z);camera.far=distance+size.z+1;camera.lookAt(center);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
  const ndc=points.map((p)=>p.clone().project(camera));
  if(ndc.some((p)=>![p.x,p.y,p.z].every(Number.isFinite) || Math.abs(p.x)>1 || Math.abs(p.y)>1 || p.z < -1 || p.z>1))throw new Error("neutral-head-clipped");
  const hairNdc=ndc.slice(sampledHeadVertices);
  const hairContainment=contain.map(({object,indices},hi)=>{
    const subset=hairNdc.slice(0,indices.length); hairNdc.splice(0,indices.length);
    return {
      name:object.name??null,
      geometryName:object.geometry?.name??null,
      userDataName:object.userData?.name??null,
      accessorCount:object.geometry.attributes.position.count,
      sampledCount:indices.length,
      isSkinned:!!object.isSkinnedMesh,
      skeletonSharedWithFace:!!(object.skeleton&&faceSkeleton&&object.skeleton===faceSkeleton),
      skeletonUpdated:true,
      preBindRefresh:preBindRefresh[hi],
      bindMode:object.bindMode??null,
      bindInverseWorldResidual:bindInverseMatchesWorld(object),
      worldMatrix:Array.from(object.matrixWorld.elements),
      bindMatrixInverse:object.bindMatrixInverse?Array.from(object.bindMatrixInverse.elements):null,
      worldVertexBeforeUpdate:hairBefore[hi],
      worldVertexAfterUpdate:indices.length?points[sampledHeadVertices+contain.slice(0,hi).reduce((n,m)=>n+m.indices.length,0)].toArray():null,
      projectedExtrema:subset.length?{minX:Math.min(...subset.map(p=>p.x)),maxX:Math.max(...subset.map(p=>p.x)),minY:Math.min(...subset.map(p=>p.y)),maxY:Math.max(...subset.map(p=>p.y))}:null,
    };
  });
  return {
    cameraMatrixWorld:Array.from(camera.matrixWorld.elements),
    viewport:[1024,1024],
    headBounds:bounds.toJSON?.() ?? {min:bounds.min.toArray(),max:bounds.max.toArray()},
    sampledHeadVertices,
    containedHairVertices:points.length-sampledHeadVertices,
    hairContainment,
    headMatrixWorld:Array.from(rig.head.matrixWorld.elements),
    bindQuaternion:rig.bindQuaternion.toArray(),
    jawMatrixWorld:rig.jaw?Array.from(rig.jaw.matrixWorld.elements):null,
    faceFront:front.toArray(),
    headUp:up.toArray(),
    projectedBounds:{minX:Math.min(...ndc.map(p=>p.x)),maxX:Math.max(...ndc.map(p=>p.x)),minY:Math.min(...ndc.map(p=>p.y)),maxY:Math.max(...ndc.map(p=>p.y))},
    clippingChecked:true,
  };
}

export function readOwnedArticulation(rig) {
  const jaw = rig?.jaw;
  if (!jaw) return { jaw: null };
  const relative = jaw.matrixWorld.clone().premultiply(rig.head.matrixWorld.clone().invert());
  return {
    jaw: {
      name: jaw.name,
      quaternionLocal: jaw.quaternion.toArray(),
      positionLocal: jaw.position.toArray(),
      matrixWorld: Array.from(jaw.matrixWorld.elements),
      matrixRelativeToHead: Array.from(relative.elements),
    },
  };
}

export function createNeutralFaceView(slot) {
  if(!slot?.actorSlot || !slot.root || !slot.actorSlot.parent)throw new Error("neutral-owned-slot-required");
  const rig=identifyHeadGeometry(slot.root);
  const originalParent=slot.actorSlot.parent;const scene=new Scene();scene.background=new Color(0x202329);
  originalParent.updateWorldMatrix(true,true);const before=slot.actorSlot.matrixWorld.clone();
  let canvas,renderer,attached=false; const layerMasks=[];
  const restore=()=>{
    for(const [object,mask] of layerMasks)object.layers.mask=mask;
    if(attached && slot.actorSlot.parent !== originalParent) originalParent.attach(slot.actorSlot);
    renderer?.dispose();canvas?.remove();
  };
  try {
  scene.attach(slot.actorSlot);attached=true;slot.actorSlot.updateWorldMatrix(true,true);
  if(before.elements.some((value,i)=>Math.abs(value-slot.actorSlot.matrixWorld.elements[i])>1e-7))throw new Error("neutral-reparent-world-transform-changed");
  canvas=document.createElement("canvas");canvas.dataset.openClinXrNeutralFace="true";document.body.append(canvas);
  renderer=new WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(1);renderer.setSize(1024,1024);
  // Isolate authored asset objects from host cue/label objects without hiding any asset primitive.
  slot.actorSlot.traverse((object)=>{layerMasks.push([object,object.layers.mask]);object.layers.set(30);});
  const fill = new HemisphereLight(0xffffff,0x6e7788,2); fill.layers.set(30);
  scene.add(fill);const key=new DirectionalLight(0xffffff,2);key.layers.set(30);scene.add(key,key.target);
  const camera=new PerspectiveCamera(35,1,.001,10);camera.layers.set(30);
  const rowOverlay=createObservedRowOverlay();
  let framing;
  return {canvas,getRig(){return rig;},excludeHostCues(cues){for(const cue of cues)cue?.traverse((object)=>object.layers.set(0));},render(row){framing=fitNeutralHeadCamera(rig,camera,slot.root);key.position.copy(camera.position);key.target.position.copy(rig.head.getWorldPosition(new Vector3()));renderer.autoClear=true;renderer.render(scene,camera);framing={...framing,canvasSize:[canvas.width,canvas.height],rendererDrawingBuffer:[renderer.domElement.width,renderer.domElement.height],overlayLayout:rowOverlay.layout};let marker=null;if(row){marker=rowOverlay.render(renderer,row);framing={...framing,marker:{version:marker.version,checksum:marker.checksum,callbackSerial:marker.callbackSerial,generation:marker.generation,generationN:marker.generationN,nodeSerial:marker.nodeSerial,layout:marker.layout}};}return framing;},dispose(){rowOverlay.dispose();restore();},getFraming(){return framing;}};
  } catch(error) {
    restore();
    throw error;
  }
}

export function subtreeExcludedFromJudgingLayer(root, layer = 30) {
  if (!root) return false;
  const mask = 1 << layer;
  let excluded = true;
  root.traverse((object) => { if ((object.layers.mask & mask) !== 0) excluded = false; });
  return excluded;
}
