import {it,expect} from 'vitest';
import {chromium} from 'playwright';
import {fileURLToPath} from 'node:url';
import {buildBrowserControlBundle} from './browser-bundle-helper.mjs';
it('actual GL strip decodes at bottom, preserves face/top pixels and restores renderer state',async()=>{
 const overlay=fileURLToPath(new URL('./observed-row-overlay.mjs',import.meta.url));
 const barcode=fileURLToPath(new URL('./observed-row-barcode.mjs',import.meta.url));
 const source=`import {Color,Scene,PerspectiveCamera,WebGLRenderer} from 'three';import {createObservedRowOverlay} from ${JSON.stringify(overlay)};import {decodeObservedRowBits} from ${JSON.stringify(barcode)};window.runOverlayControl=()=>{const r=new WebGLRenderer({preserveDrawingBuffer:true});r.setSize(1024,1024);document.body.append(r.domElement);const scene=new Scene();scene.background=new Color(0x336699);r.render(scene,new PerspectiveCamera());const gl=r.getContext(),pixels=new Uint8Array(1024*1024*4);const read=()=>gl.readPixels(0,0,1024,1024,gl.RGBA,gl.UNSIGNED_BYTE,pixels);const pixel=(x,y)=>Array.from(pixels.slice(((1023-y)*1024+x)*4,((1023-y)*1024+x)*4+4));read();const center=pixel(512,512),top=pixel(512,24);const o=createObservedRowOverlay();const marker=o.render(r,{callbackSerial:4294967295,generation:'control:9:65535',nodeSerial:65535});read();const layout=marker.layout;const getBits=y=>marker.bits.map((_,i)=>{const p=pixel(layout.x0+i*layout.cellPx+layout.cellPx/2,y);return (p[0]+p[1]+p[2])/3>=128?1:0;});const decoded=decodeObservedRowBits(getBits(layout.y0+layout.stripPx/2));let topRejected=false;try{decodeObservedRowBits(getBits(layout.stripPx/2));}catch{topRejected=true;}const result={decoded,centerPreserved:JSON.stringify(center)===JSON.stringify(pixel(512,512)),topPreserved:JSON.stringify(top)===JSON.stringify(pixel(512,24)),topRejected,autoClearRestored:r.autoClear,textureBytes:o.textureBytes};o.dispose();r.dispose();r.domElement.remove();return result;};`;
 let bundle;let browser;
 try{
  bundle=await buildBrowserControlBundle(source);
  browser=await chromium.launch({headless:true});
  try{const page=await browser.newPage();await page.setContent('<html><body></body></html>');await page.addScriptTag({content:bundle.code});const result=await page.evaluate(()=>window.runOverlayControl());expect(result.decoded).toMatchObject({callbackSerial:4294967295,generationN:65535,nodeSerial:65535});expect(result.centerPreserved).toBe(true);expect(result.topPreserved).toBe(true);expect(result.topRejected).toBe(true);expect(result.autoClearRestored).toBe(true);expect(result.textureBytes).toBe(896*48*4);}
  finally{try{await browser.close();}finally{bundle.dispose();}}
 }finally{bundle?.dispose();}
},20000);
