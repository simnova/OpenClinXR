import {it, expect} from "vitest";
import {execFileSync} from "node:child_process";
import {mkdirSync, writeFileSync, readFileSync} from "node:fs";
import {resolve} from "node:path";
import {randomUUID} from "node:crypto";
import {chromium} from "playwright";
import {fileURLToPath} from "node:url";

it("installed browser tees decode a painted 1024 marker and keep the original tracks live", async () => {
  const observer = fileURLToPath(new URL("./native-track-observer.mjs", import.meta.url));
  const barcode = fileURLToPath(new URL("./observed-row-barcode.mjs", import.meta.url));
  const source = `import {startNativeTrackObserver,nativeTrackObserverSupported} from ${JSON.stringify(observer)};
import {encodeObservedRowMarker} from ${JSON.stringify(barcode)};
window.runNativeTrackControl=async()=>{
 const support=nativeTrackObserverSupported();
 if(support.status!=="available") return {support};
 const context=new AudioContext({sampleRate:22050});
 await context.resume();
 const osc=context.createOscillator(); osc.frequency.value=220;
 const dest=context.createMediaStreamDestination(); osc.connect(dest); osc.start();
 const canvas=document.createElement("canvas"); canvas.width=1024; canvas.height=1024;
 document.body.append(canvas);
 const g=canvas.getContext("2d");
 g.fillStyle="#336699"; g.fillRect(0,0,1024,1024);
 const marker=encodeObservedRowMarker({callbackSerial:88,generation:"clock-patient:turn-1:7",nodeSerial:3});
 const {layout,bits}=marker;
 for(let i=0;i<bits.length;i++){
  g.fillStyle=bits[i]?"#fff":"#000";
  g.fillRect(layout.x0+i*layout.cellPx,layout.y0,layout.cellPx,layout.stripPx);
 }
 const canvasStream=canvas.captureStream(15);
 const audioTrack=dest.stream.getAudioTracks()[0];
 const videoTrack=canvasStream.getVideoTracks()[0];
 const first=startNativeTrackObserver({audioTrack,videoTrack});
 canvasStream.getVideoTracks()[0].requestFrame?.();
 await new Promise((r)=>setTimeout(r,400));
 const snap=await first.stop();
 const liveAfterStop={audio:audioTrack.readyState,video:videoTrack.readyState};
 g.fillStyle="#000"; g.fillRect(0,layout.y0,1024,layout.stripPx);
 const second=startNativeTrackObserver({audioTrack,videoTrack});
 canvasStream.getVideoTracks()[0].requestFrame?.();
 await new Promise((r)=>setTimeout(r,600));
 const tampered=await second.stop();
 osc.stop();
 const afterOsc={audio:audioTrack.readyState};
 await context.close();
 return {
  support,
  audioFramesObserved:snap.audioFramesObserved,
  videoFramesObserved:snap.videoFramesObserved,
  audioClosed:snap.audioClosed,
  videoClosed:snap.videoClosed,
  sampleCount:snap.sampleCount,
  marked:snap.videoRows.filter((r)=>r.markerKind==="marked").map((r)=>r.decoded),
  tamperedKinds:[...new Set(tampered.videoRows.map((r)=>r.markerKind))],
  tamperedVideoFrames:tampered.videoFramesObserved,
  liveAfterStop,
  cloneAudioReadyState:snap.cloneAudioReadyState,
  cloneVideoReadyState:snap.cloneVideoReadyState,
  audioEpoch:snap.audioRows[0]?.timestampEpoch,
  videoEpoch:snap.videoRows[0]?.timestampEpoch,
  afterOsc
 };
};`;
  const buildRoot = fileURLToPath(new URL("./tmp/native-track-" + randomUUID() + "/", import.meta.url));
  mkdirSync(buildRoot, { recursive: true });
  const entry = resolve(buildRoot, "control.js");
  const bundle = resolve(buildRoot, "control.bundle.js");
  writeFileSync(entry, source);
  execFileSync("bun", ["build", entry, "--target=browser", "--format=iife", "--outfile=" + bundle], { cwd: process.cwd(), encoding: "utf8" });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<html><body></body></html>");
    await page.addScriptTag({ content: readFileSync(bundle, "utf8") });
    const result = await page.evaluate(() => window.runNativeTrackControl());
    expect(result.support.status).toBe("available");
    expect(result.audioFramesObserved).toBeGreaterThan(0);
    expect(result.audioClosed).toBe(result.audioFramesObserved);
    expect(result.videoClosed).toBe(result.videoFramesObserved);
    expect(result.sampleCount).toBeGreaterThan(0);
    expect(result.marked[0]).toMatchObject({ callbackSerial: 88, generationN: 7, nodeSerial: 3 });
    expect(result.tamperedVideoFrames).toBeGreaterThan(0);
    expect(result.tamperedKinds.some((k) => k === "excluded-checksum" || k === "unmarked")).toBe(true);
    expect(result.liveAfterStop.audio).toBe("live");
    expect(result.audioEpoch).toBe("audio-data-capture-ticks");
    expect(result.videoEpoch).toBe("video-frame-relative-first-ticks");
  } finally {
    await browser.close();
  }
}, 20000);
