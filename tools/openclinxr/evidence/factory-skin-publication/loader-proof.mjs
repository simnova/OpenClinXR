/** Owner-only proof: real UI-XR route/loader, job-local response substitution, no asset promotion. */
import { chromium } from '../lib/slotted-playwright.ts';
import { readFileSync,writeFileSync,mkdirSync,existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname,resolve } from 'node:path';
const args=process.argv.slice(2);const arg=n=>{const i=args.indexOf('--'+n);if(i<0||!args[i+1])throw Error('missing '+n);return args[i+1];};
const url=new URL(arg('url'));if(!['127.0.0.1','localhost'].includes(url.hostname))throw Error('local UI only');
url.searchParams.set('openclinxrScenarioId','peds_asthma_parent_anxiety_v1');
if([...url.searchParams.keys()].some(k=>/comparator/i.test(k)))throw Error('actual scenario route required');
const output=resolve(arg('output'));if(existsSync(output)||existsSync(output+'.png'))throw Error('retained attempt output already exists');const bytes=readFileSync(resolve(arg('finished')));const materialName=arg('material');
const hash=b=>createHash('sha256').update(b).digest('hex');
if(bytes.toString('ascii',0,4)!=='glTF')throw Error('invalid GLB');
const jlen=bytes.readUInt32LE(12);const doc=JSON.parse(bytes.toString('utf8',20,20+jlen));const bin=bytes.subarray(28+jlen);const mat=doc.materials.filter(m=>m.name===materialName);if(mat.length!==1)throw Error('skin material ambiguous');
function image(index){const image=doc.images[doc.textures[index].source];const view=doc.bufferViews[image.bufferView];if(image.mimeType!=='image/png'||view.buffer!==0)throw Error('embedded PNG required');return bin.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength).toString('base64');}
const normalScale=mat[0].normalTexture.scale??1;
const expected={albedo:image(mat[0].pbrMetallicRoughness.baseColorTexture.index),normal:image(mat[0].normalTexture.index)};
const target='/xr-assets/humanoids/candidates/mpfb-peds-parent-aisha.motion-bind.glb';
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:960}});let fetched;const pending=[];
 page.on('response',r=>{if(new URL(r.url()).pathname===target)pending.push(r.body().then(b=>{fetched=hash(b);}));});
 await page.route('**'+target+'*',route=>route.fulfill({status:200,contentType:'model/gltf-binary',body:bytes}));
 await page.goto(url.href,{waitUntil:'networkidle'});
 // Current UI may require explicit ordinary station start; never load a standalone model viewer.
 const start=page.getByRole('button',{name:/enter|start station|start experience/i}).first();if(await start.isVisible().catch(()=>false))await start.click();
 await page.waitForFunction(()=>{const s=window.__openClinXrDebugScene;let found=false;s?.traverse(o=>{if(o.userData?.openClinXrActorId==='parent_tara_johnson_v1'&&o.userData?.openClinXrAssetPath)found=true;});return found;},{},{timeout:90000});
 const loaded=await page.evaluate(async({expected,materialName})=>{
  const digest=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const pixels=async image=>{const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);return {width:c.width,height:c.height,rgbaSha256:await digest(ctx.getImageData(0,0,c.width,c.height).data)};};
  const decoded={};for(const[k,b64]of Object.entries(expected)){const b=Uint8Array.from(atob(b64),x=>x.charCodeAt(0));decoded[k]=await pixels(await createImageBitmap(new Blob([b],{type:'image/png'})));}
  const roots=[];window.__openClinXrDebugScene.traverse(o=>{if(o.userData?.openClinXrActorId==='parent_tara_johnson_v1'&&o.userData?.openClinXrAssetPath)roots.push(o);});
  const materials=new Set();for(const root of roots)root.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material])if(m?.name===materialName)materials.add(m);});
  const bindings=[];for(const m of materials)bindings.push({albedo:await pixels(m.map?.image),normal:await pixels(m.normalMap?.image),normalScale:[m.normalScale.x,m.normalScale.y],color:[m.color.r,m.color.g,m.color.b]});
  return {actorId:'parent_tara_johnson_v1',scenarioId:window.__openClinXrDebugScene.userData.openClinXrEncounterDoorwayTheme?.scenarioId,assetPaths:roots.map(r=>r.userData.openClinXrAssetPath),decoded,bindings};
 },{expected,materialName});
 await Promise.all(pending);if(fetched!==hash(bytes))throw Error('actual loader network-body hash mismatch');
 if(loaded.scenarioId!=='peds_asthma_parent_anxiety_v1'||!loaded.bindings.length)throw Error('actual Tara skin not staged');
 for(const b of loaded.bindings){if(b.normalScale[0]!==normalScale||b.normalScale[1]!==normalScale)throw Error('loaded normalScale mismatch');}
 for(const b of loaded.bindings)for(const k of ['albedo','normal'])if(JSON.stringify(b[k])!==JSON.stringify(loaded.decoded[k]))throw Error('loaded '+k+' pixels mismatch');
 mkdirSync(dirname(output),{recursive:true});await page.screenshot({path:output+'.png'});
 writeFileSync(output,JSON.stringify({schemaVersion:1,probe:'actual-ui-xr-loader',url:url.href,finishedSha256:hash(bytes),networkBodySha256:fetched,materialName,...loaded},null,2)+'\n',{flag:'wx'});
}finally{await browser.close();}
