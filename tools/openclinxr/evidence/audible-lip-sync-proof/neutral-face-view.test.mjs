import {test} from 'vitest';
import assert from 'node:assert/strict';
import {Bone, BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Group, Layers, Mesh, MeshBasicMaterial, PerspectiveCamera, PropertyBinding, Skeleton, SkinnedMesh, Vector3} from 'three';
import {identifyHeadGeometry, fitNeutralHeadCamera, readOwnedArticulation, isDeformingFacialPrimitive, subtreeExcludedFromJudgingLayer} from './neutral-face-view.mjs';

function actor() {
  const root = new Group(), head = new Bone(), left = new Bone(), right = new Bone(), jaw = new Bone();
  head.name='head'; left.name='eye.L'; right.name='eye.R'; jaw.name='jaw';
  head.position.y=1.6; left.position.set(.03,.06,.09); right.position.set(-.03,.06,.09); jaw.position.set(0,.02,.04);
  head.add(left,right,jaw); root.add(head);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute([-.1,1.5,-.08,.1,1.8,.12,-.1,1.8,.12,.1,1.5,-.08],3));
  geometry.setAttribute('skinIndex',new Uint16BufferAttribute(Array(4).fill([0,0,0,0]).flat(),4));
  geometry.setAttribute('skinWeight',new Float32BufferAttribute(Array(4).fill([1,0,0,0]).flat(),4));
  geometry.morphAttributes.position=[new Float32BufferAttribute([0,.02,0, 0,.02,0, 0,.02,0, 0,.02,0],3)];
  root.updateMatrixWorld(true);
  const mesh = new SkinnedMesh(geometry,new MeshBasicMaterial()); root.add(mesh);
  mesh.morphTargetDictionary={viseme_aa:0}; mesh.morphTargetInfluences=[0];
  mesh.bind(new Skeleton([head,left,right,jaw])); root.updateMatrixWorld(true);
  return {root,head,left,right,jaw,mesh};
}
for (const pose of ['standing','supine']) test(`current posed head geometry fits without clipping: ${pose}`,()=>{
  const a=actor(); if(pose==='supine') a.root.rotation.x=-Math.PI/2;
  const result=fitNeutralHeadCamera(identifyHeadGeometry(a.root),new PerspectiveCamera(35,1,.001,10),a.root);
  assert.equal(result.sampledHeadVertices,4);
  assert.ok(Math.abs(result.projectedBounds.minY)<1 && Math.abs(result.projectedBounds.maxY)<1);
  const up=new Vector3(...result.headUp);
  assert.ok(up.distanceTo(pose==='standing'?new Vector3(0,1,0):new Vector3(0,0,-1))<1e-6);
});
test('missing facial skeleton fails closed, no body bounds fallback',()=>assert.throws(()=>identifyHeadGeometry(new Group()),/head-rig-missing/));
test('coincident eyes fail closed instead of camera guessing',()=>{
  const a=actor();a.right.position.copy(a.left.position);
  assert.throws(()=>fitNeutralHeadCamera(identifyHeadGeometry(a.root),new PerspectiveCamera(35,1),a.root),/eye-axis-degenerate/);
});
test('dominant non-head skin membership is excluded',()=>{
  const a=actor(); const body=new Bone();body.name='body';a.root.add(body);
  a.mesh.bind(new Skeleton([a.head,a.left,a.right,body]));
  a.mesh.geometry.attributes.skinIndex.setXYZW(0,3,0,0,0);
  a.mesh.geometry.attributes.skinWeight.setXYZW(0,.9,.1,0,0);
  assert.equal(identifyHeadGeometry(a.root).meshes[0].indices.length,3);
});

test('consumed capture uses neutral canvas and one host facial writer',async()=>{
  const {readFile}=await import('node:fs/promises');
  const source=await readFile(new URL('./capture-page.mjs',import.meta.url),'utf8');
  assert.match(source,/const canvas = neutralView.canvas/);
  assert.match(source,/session.slot.root !== ownedRoot/);
  assert.doesNotMatch(source,/updateGeneratedHumanoidAnimations\s*\(/);
  assert.match(source,/finally\s*\{[\s\S]*playerStopError[\s\S]*finally\s*\{[\s\S]*neutralView\.dispose/);
  assert.match(source,/if \(playerStopError\) throw playerStopError/);
  assert.doesNotMatch(source,/player\.stop\(\)\.catch\(\(\) => undefined\)/);
  assert.match(source,/!ownedSession\.player\.ended\(\)/);
  assert.match(source,/clinicalScene\.onAfterRender/);
  assert.match(source,/readOwnedArticulation/);
  assert.match(source,/targetIndex/);
  assert.match(source,/contextCurrentTime: context\.currentTime/);
  assert.match(source,/recorder\.onstart/);
  assert.match(source,/mediarecorder-onstart-timeout/);
  assert.match(source,/requestFrame/);
  assert.match(source,/idleCueVisibility/);
  assert.match(source,/subtreeExcludedFromJudgingLayer/);
  assert.ok(source.indexOf('excludeHostCues(idleCueList)')<source.indexOf('captureStream(30)'));
  assert.ok(source.indexOf('recorder.start()')<source.indexOf('neutralView.render()'));
  assert.ok(source.indexOf('requestFrame')<source.indexOf('await recorderStarted'));
  assert.ok(source.indexOf('await recorderStarted')<source.indexOf('bridge.fire()'));
  assert.ok(source.indexOf('createNeutralFaceView({')<source.indexOf('bridge.fire()'));
  assert.match(source,/const row = \{/);
  assert.match(source,/row\.evaluationFraming = neutralView\.render\(row\)/);
  assert.ok(source.indexOf('const row =')>source.indexOf('clinicalScene.onAfterRender'));
  assert.ok(source.indexOf('const row =')<source.indexOf('neutralView.render(row)'));
  assert.ok(source.indexOf('neutralView.render(row)')<source.indexOf('frames.push(row)'));
  assert.doesNotMatch(source,/innerHTML|createElement\(['"]div['"]\)|position:\s*['"]absolute['"]/);
});

test('visible cues on layer 0 are excluded from judging camera layer 30',()=>{
  const camera=new Layers(); camera.set(30);
  const cue=new Layers(); cue.set(0);
  const asset=new Layers(); asset.set(30);
  assert.equal(camera.test(cue),false);
  assert.equal(camera.test(asset),true);
});

test('exclusion guard walks cue descendants; one eligible child fails closed',()=>{
  const cue=new Group(); const child=new Mesh(new BufferGeometry(),new MeshBasicMaterial());
  child.visible=true; cue.add(child);
  cue.layers.set(30); child.layers.set(30);
  cue.traverse((object)=>object.layers.set(0));
  assert.equal(subtreeExcludedFromJudgingLayer(cue,30),true);
  child.layers.set(30);
  assert.equal(subtreeExcludedFromJudgingLayer(cue,30),false);
  assert.equal((cue.layers.mask & (1<<30))===0,true);
});

test('GLTFLoader sanitized eye bone names resolve without anatomical fallback',()=>{
  const a=actor();a.left.name=PropertyBinding.sanitizeNodeName('eye.L');a.right.name=PropertyBinding.sanitizeNodeName('eye.R');
  assert.equal(identifyHeadGeometry(a.root).eyes.left,a.left);
});

test('fitted hair is containment only and does not enter head skin indices',()=>{
  const a=actor();
  const hair=new Mesh(new BufferGeometry().setAttribute('position',new Float32BufferAttribute([0,2,0,.1,2,0,0,2.1,0],3)),new MeshBasicMaterial());
  hair.name='Hair';
  a.root.add(hair);
  const rig=identifyHeadGeometry(a.root);
  assert.equal(rig.meshes.length,1);
  assert.equal(rig.meshes[0].indices.length,4);
  assert.equal(rig.containMeshes.length,1);
  assert.equal(rig.containMeshes[0].object,hair);
  const result=fitNeutralHeadCamera(rig,new PerspectiveCamera(35,1,.001,10),a.root);
  assert.equal(result.sampledHeadVertices,4);
  assert.equal(result.containedHairVertices,3);
});

test('head subtree jaw is recorded, body-weighted vertices stay excluded',()=>{
  const a=actor();
  assert.equal(identifyHeadGeometry(a.root).jaw,a.jaw);
});

test('jaw articulation is local and head-relative, not world-motion success',()=>{
  const a=actor();a.root.rotation.x=-Math.PI/2;a.root.updateMatrixWorld(true);
  a.jaw.rotation.x=0.2;a.root.updateMatrixWorld(true);
  const art=readOwnedArticulation(identifyHeadGeometry(a.root));
  assert.equal(art.jaw.name,'jaw');
  assert.ok(Math.abs(art.jaw.quaternionLocal[0]-a.jaw.quaternion.x)<1e-9);
  assert.ok(Math.abs(art.jaw.positionLocal[1]-a.jaw.position.y)<1e-9);
  assert.equal(art.jaw.matrixRelativeToHead.length,16);
  assert.equal(art.jaw.matrixWorld.length,16);
  assert.ok(Math.abs(art.jaw.matrixWorld[14]-art.jaw.positionLocal[1])>1);
});

test('attach and world-transform refusal sit inside restore protection',async()=>{
  const {readFile}=await import('node:fs/promises');
  const source=await readFile(new URL('./neutral-face-view.mjs',import.meta.url),'utf8');
  const attach=source.indexOf('scene.attach(slot.actorSlot)');
  const tryPos=source.indexOf('try {',source.indexOf('createNeutralFaceView'));
  const catchPos=source.indexOf('} catch',tryPos);
  assert.ok(tryPos>=0 && tryPos<attach && attach<catchPos);
  assert.match(source,/attached && slot\.actorSlot\.parent !== originalParent/);
});

test('capture does not wait for activeSpeech before prepare and uses isolated @fs helper',async()=>{
  const {readFile}=await import('node:fs/promises');
  const capture=await readFile(new URL('./capture.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(capture,/waitForFunction\(\(\) => \{[\s\S]*activeSpeech[\s\S]*prepare/);
  assert.match(capture,/neutralFaceModuleUrl: "\/@fs\/" \+ resolve\(repo,/);
  assert.doesNotMatch(capture,/__openClinXrDebugRenderer/);
  assert.doesNotMatch(capture,/head-box-from-geometry\.js/);
  assert.match(capture,/if \(!process\.env\.NODE_ENV\) process\.env\.NODE_ENV = "test"/);
  assert.match(capture,/waitStableMainTransform/);
  assert.match(capture,/helperModule/);
  const required=capture.slice(capture.indexOf('const requiredModules'),capture.indexOf('];',capture.indexOf('const requiredModules')));
  assert.doesNotMatch(required,/neutral-face-view/);
});

test('head-weighted garment without facial morphs cannot expand face bounds',()=>{
  const a=actor();
  const gownGeom=new BufferGeometry();
  gownGeom.setAttribute('position',new Float32BufferAttribute([-.4,1.2,-.2,.4,2.1,.3,-.4,2.1,.3,.4,1.2,-.2],3));
  gownGeom.setAttribute('skinIndex',new Uint16BufferAttribute(Array(4).fill([0,0,0,0]).flat(),4));
  gownGeom.setAttribute('skinWeight',new Float32BufferAttribute(Array(4).fill([1,0,0,0]).flat(),4));
  const gown=new SkinnedMesh(gownGeom,new MeshBasicMaterial()); gown.name='gown';
  a.root.add(gown); gown.bind(a.mesh.skeleton); a.root.updateMatrixWorld(true);
  const rig=identifyHeadGeometry(a.root);
  assert.equal(isDeformingFacialPrimitive(a.mesh),true);
  assert.equal(isDeformingFacialPrimitive(gown),false);
  assert.equal(rig.meshes.length,1);
  assert.equal(rig.meshes[0].object,a.mesh);
  const result=fitNeutralHeadCamera(rig,new PerspectiveCamera(35,1,.001,10),a.root);
  assert.equal(result.sampledHeadVertices,4);
});

test('missing deforming face primitive fails closed',()=>{
  const a=actor();
  a.mesh.morphTargetDictionary={}; a.mesh.morphTargetInfluences=[]; a.mesh.geometry.morphAttributes={};
  assert.throws(()=>identifyHeadGeometry(a.root),/face-primitive-missing/);
});

test('skinned fitted hair is containment and does not enter face indices',()=>{
  const a=actor();
  const hairGeom=new BufferGeometry();
  hairGeom.setAttribute('position',new Float32BufferAttribute([0,2,0,.1,2,0,0,2.1,0],3));
  hairGeom.setAttribute('skinIndex',new Uint16BufferAttribute(Array(3).fill([0,0,0,0]).flat(),4));
  hairGeom.setAttribute('skinWeight',new Float32BufferAttribute(Array(3).fill([1,0,0,0]).flat(),4));
  const hair=new SkinnedMesh(hairGeom,new MeshBasicMaterial()); hair.name='Hair';
  a.root.add(hair); hair.bind(a.mesh.skeleton); a.root.updateMatrixWorld(true);
  const rig=identifyHeadGeometry(a.root);
  assert.equal(rig.meshes[0].indices.length,4);
  assert.equal(rig.containMeshes.length,1);
  assert.equal(rig.containMeshes[0].object,hair);
  const result=fitNeutralHeadCamera(rig,new PerspectiveCamera(35,1,.001,10),a.root);
  assert.equal(result.sampledHeadVertices,4);
  assert.equal(result.containedHairVertices,3);
});

const OWNED_HAIR='makeclothes_library_hair_toigo_blunt_bob_with_bangs_mpfb_robert_reference_mesh';
const OWNED_NOT_HAIR=[
  'makeclothes_library_toigo_t_shirt_mpfb_robert_reference_mesh',
  'makeclothes_library_toigo_t_shirt',
  'openclinxr_declared_upper_layers__hospital_gown_mesh',
  'openclinxr_declared_upper_layers__hospital_gown',
  'mpfb_robert_reference_body',
  'makeclothes_library_footwear_toigo_mj_cloth_shoes_mpfb_robert_reference_mesh',
  'openclinxr_real_garment_peds_upper_v1_mesh',
  'openclinxr_fitted_eyebrow_mindfront_eyebrows_05_mpfb_robert_reference_mesh',
];

test('owned GLB hair name is fitted-hair containment; gown/t-shirt/body/shoes/garment are not',async()=>{
  const {isFittedHairMeshName}=await import('../../../../packages/openclinxr/xr-scene/dist/index.js');
  assert.equal(isFittedHairMeshName(OWNED_HAIR),true);
  for (const name of OWNED_NOT_HAIR) assert.equal(isFittedHairMeshName(name),false);
  const a=actor();
  const hair=new Mesh(new BufferGeometry().setAttribute('position',new Float32BufferAttribute([0,2,0,.1,2,0,0,2.1,0],3)),new MeshBasicMaterial());
  hair.name=OWNED_HAIR;
  a.root.add(hair);
  for (const name of OWNED_NOT_HAIR) {
    const geom=new BufferGeometry();
    geom.setAttribute('position',new Float32BufferAttribute([-.4,1.2,-.2,.4,2.4,.3,-.4,2.4,.3,.4,1.2,-.2],3));
    geom.setAttribute('skinIndex',new Uint16BufferAttribute(Array(4).fill([0,0,0,0]).flat(),4));
    geom.setAttribute('skinWeight',new Float32BufferAttribute(Array(4).fill([1,0,0,0]).flat(),4));
    const garment=new SkinnedMesh(geom,new MeshBasicMaterial()); garment.name=name;
    a.root.add(garment); garment.bind(a.mesh.skeleton);
  }
  a.root.updateMatrixWorld(true);
  const rig=identifyHeadGeometry(a.root);
  assert.equal(rig.containMeshes.length,1);
  assert.equal(rig.containMeshes[0].object.name,OWNED_HAIR);
  assert.equal(rig.meshes.length,1);
  assert.equal(rig.meshes[0].object,a.mesh);
  const result=fitNeutralHeadCamera(rig,new PerspectiveCamera(35,1,.001,10),a.root);
  assert.equal(result.sampledHeadVertices,4);
  assert.equal(result.containedHairVertices,3);
  assert.equal(result.hairContainment[0].accessorCount,3);
  assert.equal(result.hairContainment[0].sampledCount,3);
  assert.ok(result.projectedBounds.maxY<1);
});

test('separate-skeleton posed hair crown is framed; face-only camera clips it; garments stay out',()=>{
  const a=actor();
  const hairHead=new Bone(); hairHead.name='head';
  const hairLeft=new Bone(); hairLeft.name='eye.L';
  const hairRight=new Bone(); hairRight.name='eye.R';
  hairHead.position.y=1.6; hairLeft.position.set(.03,.06,.09); hairRight.position.set(-.03,.06,.09);
  hairHead.add(hairLeft,hairRight); a.root.add(hairHead);
  const hairGeom=new BufferGeometry();
  hairGeom.setAttribute('position',new Float32BufferAttribute([0,.35,0,.04,.35,0,0,.35,.04],3));
  hairGeom.setAttribute('skinIndex',new Uint16BufferAttribute(Array(3).fill([0,0,0,0]).flat(),4));
  hairGeom.setAttribute('skinWeight',new Float32BufferAttribute(Array(3).fill([1,0,0,0]).flat(),4));
  const hair=new SkinnedMesh(hairGeom,new MeshBasicMaterial());
  hair.name=OWNED_HAIR;
  a.root.add(hair);
  hair.bind(new Skeleton([hairHead,hairLeft,hairRight]));
  hairHead.position.y=2.35;
  a.root.updateMatrixWorld(true);
  const rig=identifyHeadGeometry(a.root);
  assert.equal(rig.containMeshes[0].object,hair);
  assert.equal(rig.containMeshes[0].indices.length,3);
  assert.notEqual(hair.skeleton,a.mesh.skeleton);
  const faceCam=new PerspectiveCamera(35,1,.001,10);
  fitNeutralHeadCamera({...rig,containMeshes:[]},faceCam,a.root);
  const crown=new Vector3();
  hair.getVertexPosition(0,crown).applyMatrix4(hair.matrixWorld);
  const faceNdc=crown.clone().project(faceCam);
  assert.ok(Math.abs(faceNdc.y)>1,'face-only frustum must miss the posed crown');
  const cam=new PerspectiveCamera(35,1,.001,10);
  const result=fitNeutralHeadCamera(rig,cam,a.root);
  assert.equal(result.sampledHeadVertices,4);
  assert.equal(result.containedHairVertices,3);
  assert.equal(result.hairContainment[0].skeletonSharedWithFace,false);
  assert.equal(result.hairContainment[0].accessorCount,3);
  assert.equal(result.hairContainment[0].sampledCount,3);
  assert.ok(result.hairContainment[0].worldVertexAfterUpdate[1]>2.5);
  assert.ok(result.hairContainment[0].projectedExtrema.maxY<1);
  assert.ok(Math.abs(crown.clone().project(cam).y)<1);
  assert.ok(result.projectedBounds.maxY<1);
});

test('neutral overlay is a GL barcode after the authored scene, not a DOM overlay',async()=>{
  const {readFile}=await import('node:fs/promises');
  const source=await readFile(new URL('./neutral-face-view.mjs',import.meta.url),'utf8');
  assert.match(source,/encodeObservedRowMarker/);
  assert.match(source,/OrthographicCamera/);
  assert.match(source,/renderer\.render\(overlayScene,overlayCam\)/);
  assert.match(source,/autoClear=false/);
  assert.doesNotMatch(source,/innerHTML|createElement\(['"]div['"]\)/);
  assert.match(source,/marker:\{version:marker\.version,checksum:marker\.checksum/);
  assert.match(source,/containMeshes\?\?\[\]/);
  assert.match(source,/for\(const \{object\} of contain\)object\.skeleton\?\.update\(\)/);
});
