// Actual local Chromium execution with synthetic capture and muted physical output; never Quest/acoustic evidence.
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
const root=resolve(import.meta.dirname,'../../..'), dist=join(root,'dist/stage1/audio');
const {DUPLEX_WORKLET_SOURCE}=await import(join(dist,'worklet.js'));
const sha=createHash('sha256').update(DUPLEX_WORKLET_SOURCE).digest('hex');
const job=await mkdtemp(join(tmpdir(),'quest-stage1-audio-host-'));
const wav=Buffer.alloc(44+48000*2);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(96000,40);for(let i=0;i<48000;i++)wav.writeInt16LE(Math.round(0.01*32767*Math.sin(2*Math.PI*997*i/48000)),44+i*2);const wavPath=join(job,'generated-lowgain.wav');await writeFile(wavPath,wav);
let browser,server;
try {
 server=createServer(async(req,res)=>{
  if(req.url==='/'){res.setHeader('content-type','text/html');res.end(`<button id="prepare">Prepare synthetic host audio</button><script type="module">
import {prepareDuplexAudio} from '/engine.js';
window.result=null;window.error=null;const signal=new AbortController().signal;
document.querySelector('button').onclick=async()=>{try{window.audio=await prepareDuplexAudio({signal,runNonce:'host-synthetic-only',workletUrl:'/duplex-worklet.js',expectedWorkletSha256:'${sha}',inputClass:'synthetic-host',onFault:r=>window.fault=r});window.audio.notifyXRSessionCreated();window.ready=true;}catch(e){window.error={message:e.message,record:e.record};}};
</script>`);return;}
  res.setHeader('content-type','text/javascript');
  if(req.url==='/duplex-worklet.js'){res.end(DUPLEX_WORKLET_SOURCE);return;}
  try{const name=new URL(req.url,'http://localhost').pathname.slice(1);if(!['engine.js','config.js','recorder.js','worklet.js'].includes(name))throw Error();res.end(await readFile(join(dist,name)));}catch{res.statusCode=404;res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--mute-audio',`--use-file-for-fake-audio-capture=${wavPath}`]});
 const page=await browser.newPage();const consoleErrors=[];page.on('pageerror',e=>consoleErrors.push(e.message));
 await page.goto(`http://127.0.0.1:${port}`);await page.click('#prepare');
 await page.waitForFunction(()=>window.ready||window.error,null,{timeout:20000});
 const preparationError=await page.evaluate(()=>window.error);if(preparationError)throw Error(JSON.stringify(preparationError));
 await page.evaluate(()=>window.audio.mark('warmup-start',performance.now()));
 await page.waitForTimeout(700);await page.evaluate(()=>window.audio.mark('sample-start',performance.now()));
 await page.waitForTimeout(1300);await page.evaluate(()=>window.audio.mark('sample-end',performance.now()));
 const result=await page.evaluate(async()=>window.audio.stop('Host synthetic sanity completed'));
 const checks={stopped:result.outcome==='stopped',syntheticLabel:result.source.input==='synthetic-host',actualWorklet:result.input.frames>0&&result.output.frames>0,inputActive:result.input.nonzeroSamples>0,outputActive:result.output.nonzeroSamples>0,noMonitoring:result.input.zeroOutputNonzeroSamples===0,sourceHash:result.source.workletSha256===sha,threeMarks:result.marks.length===3,allMarkAcks:result.marks.every(m=>m.receivedMs-m.sentMs<=1000),noGaps:result.input.frameDiscontinuities===0&&result.output.frameDiscontinuities===0,framesRecount:['input','output'].every(k=>result[k].windows.reduce((n,w)=>n+w.frames,0)===result[k].frames),finalDrained:result.input.finalReceived&&result.output.finalReceived,zeroOwnedResources:Object.values(result.ownership.remaining).every(n=>n===0)&&Object.values(result.cleanup.remaining).every(n=>n===0),typedBudget:result.memory.ownedTypedBytes+result.memory.maximumKnownPayloadBytes<=result.memory.capBytes,noPageErrors:consoleErrors.length===0};
 const receipt={schema:'quest-stage1-host-audio-sanity.v1',at:new Date().toISOString(),scope:'Actual desktop Chromium, explicitly fake microphone and muted physical output; no XR/headset/acoustic evidence',workletSha256:sha,browserVersion:browser.version(),checks,pass:Object.values(checks).every(Boolean),result,consoleErrors};
 const path=join(job,'receipt.json');await writeFile(path,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({path,pass:receipt.pass,checks}));if(!receipt.pass)process.exitCode=1;
} catch(error){const path=join(job,'failure.json');await writeFile(path,JSON.stringify({error:String(error)},null,2));console.log(JSON.stringify({failure:path,error:String(error)}));process.exitCode=1;}
finally {await browser?.close();await new Promise(r=>server?server.close(r):r());await rm(wavPath,{force:true});}
