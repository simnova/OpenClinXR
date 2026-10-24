import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { vi } from "vitest";
import { type runStage2Media, STAGE2_PROTOCOL_SHA256, STAGE2_WORKLET_SOURCE } from "../../entrypoints/stage2.js";
import type { Stage2RunRecord } from "../../entrypoints/stage2.js";
export type MediaOptions = Parameters<typeof runStage2Media>[0];
export type Health = Stage2RunRecord["sources"]["uplink"]["total"];
export type Position = NonNullable<Stage2RunRecord["sources"]["uplink"]["origin"]>;
export type Bin = Stage2RunRecord["sources"]["uplink"]["bins"][number];
export interface WireMessage { type: string; sequence?: number; rows?: Float64Array | number; startup?: Float64Array; total?: Health; position?: Position; origin?: Position; command?: string; expected?: number; actual?: number; reason?: string; phase?: string; markerId?: string; }
export interface Processor { process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean; port: { onmessage: ((event: {data: unknown}) => void) | null }; total: Health; blocks: number; count: number; rows: Float64Array; overflow: number; coalesced: number; bin: {frames:number}; initialQuantum:number; targetBinFrames:number; }
/** Runs the public worklet artifact, with actual processor message/ACK protocol and independent input PCM. */
export function workletFlow(mode: "generator" | "monitor" = "generator", rate = 48000) {
 const messages: WireMessage[] = []; let Type: (new(options: {processorOptions:{mode:string}}) => Processor) | undefined;
 const clock = {frame:12037, rate};
 class Base { port = {onmessage:null as Processor["port"]["onmessage"], postMessage(value: WireMessage) {messages.push(structuredClone(value));}}; }
 runInNewContext(STAGE2_WORKLET_SOURCE, {AudioWorkletProcessor:Base, Float64Array, Float32Array, get currentFrame(){return clock.frame;}, get currentTime(){return clock.frame/clock.rate;}, get sampleRate(){return clock.rate;}, registerProcessor(_name:string, ctor:new(options:{processorOptions:{mode:string}})=>Processor){Type=ctor;}});
 if(!Type) throw Error("public worklet did not register"); const node=new Type({processorOptions:{mode}}); let cursor=0;
 const command=(data:unknown)=>node.port.onmessage?.({data});
 const ack=()=>{while(cursor<messages.length){const message=messages[cursor++];if(message?.type==="report")command({type:"ack",sequence:message.sequence});}};
 const step=(quantum=128, channels?:Float32Array[], autoAck=true)=>{const output=new Float32Array(quantum);const active=node.process(channels?[channels]:[],[[output]]);clock.frame+=quantum;if(autoAck)ack();return {output,active};};
 return {node,clock,messages,command,ack,step};
}
export const bytes='/* controlled module completion fixture; no actual browser or media */';
export const tick=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
export function setupFixture(pending:'module'|'resume'|'reject') {
 const abort=new AbortController(),instances:FakeContext[]=[],posts:string[]=[];let finishModule=()=>{},finishResume=()=>{};
 class FakeContext extends EventTarget {
  state='running';sampleRate=48000;currentTime=0;createdNodes=0;
  audioWorklet={addModule:vi.fn(()=>pending==='module'?new Promise<void>(r=>{finishModule=r;}):pending==='reject'?Promise.reject(Error('fixture module failed')):Promise.resolve())};
  constructor(){super();instances.push(this);}
  resume(){return pending==='resume'?new Promise<void>(r=>{finishResume=r;}):Promise.resolve();}
  close(){this.state='closed';return Promise.resolve();}
  createMediaStreamDestination(){this.createdNodes++;throw Error('late graph must not be created');}
 }
 vi.stubGlobal('isSecureContext',true);vi.stubGlobal('AudioContext',FakeContext);vi.stubGlobal('AudioWorkletNode',class {});vi.stubGlobal('RTCPeerConnection',class {});
 vi.stubGlobal('navigator',{userActivation:{isActive:true}});vi.stubGlobal('location',new URL('http://127.0.0.1:55555/'));
 const identity={browserBundleSha256:'a'.repeat(64),serverSourceSha256:'b'.repeat(64),protocolSha256:STAGE2_PROTOCOL_SHA256,fixtureConfigSha256:'c'.repeat(64),graderSourceSha256:'d'.repeat(64)},binding={runNonce:'test-run',peerTicket:'test-ticket',uplinkSourceId:'up',downlinkSourceId:'down'};
 vi.stubGlobal('fetch',async(input:URL|string)=>{const path=new URL(String(input)).pathname;if(path==='/worklet.js')return new Response(bytes);posts.push(path);if(path==='/stage2/close')return Response.json({...identityEnvelope(),closed:true,serverClockId:'server-clock',atServerMs:1,activePeers:0,closingPeers:0,ownedTasks:0,queuedControlBytes:0,pendingControls:0});return new Response('No peer allocated',{status:409});});
 function identityEnvelope(){return {identity,binding};}
 const options:MediaOptions={gatewayOrigin:'http://127.0.0.1:55555',workletUrl:'/worklet.js',expectedWorkletSha256:createHash('sha256').update(bytes).digest('hex'),driverStartedMs:3,signal:abort.signal,release:{schema:'quest-stage2-host-release.v1',identity,binding,mode:'positive',expectedEnvironment:{browser:{executablePath:'mock-only',version:'mock-only',launchFlags:[],timeOriginMs:performance.timeOrigin},driver:{processId:1,clockId:'node',timeOriginMs:1},runtime:{nodeVersion:'mock',pythonVersion:'mock',aiortcVersion:'mock',avVersion:'mock',aiohttpVersion:'mock',serverProcessId:2,serverClockId:'server-clock'},signalingOrigins:['http://127.0.0.1:55555'],iceServers:[],localInterfaces:[]}}};
 return {options,abort,instances,posts,finishModule:()=>finishModule(),finishResume:()=>finishResume()};
}

import { at, emptyHealth, fixture, history, recount, silenceBin, syncRows } from "../grading/fixtures.test-support.js";
import type { Stage2Mode } from "../../entrypoints/stage2.js";
export function negativeFixture(mode: Exclude<Stage2Mode, "positive">) {
  const f = fixture(mode); const r = f.record;
  r.outcome = "failed"; r.reason = `intentional ${mode}`;
  r.negative = { intendedFault: mode, injectedAtBrowserMs: 700, observed: true, prerequisites: { uplinkDecoded: true, remoteRtp: true, remoteDecoded: true, bothDirectionsReady: true, qualifiedFiveSeconds: true, actualRelay400Hz: true }, evidence: ["pure fixture only"] };
  if (mode !== "early-peer-close") {
    Object.assign(r.sources.uplink, history(400, 1, 128, "worklet-currentFrame", [["setup", 96000]]));
    Object.assign(r.sources.downlink, history(700, 1, 960, "generated-pts", [["setup", 96000]]));
    Object.assign(r.decoded.uplink, history(400, 2, 960, "decoded-pts", [["setup", 96000]]));
    Object.assign(r.decoded.downlink, history(700, 2, 128, "worklet-currentFrame", [["setup", 96000]]));
    r.marks = []; r.clientWindow = { startMs: null, terminalMs: null };
    r.lifecycle.readyMs = null; r.lifecycle.warmupStartedMs = null; r.lifecycle.warmupEndedMs = null;
    r.lifecycle.contextClosedMs = 2600; r.lifecycle.peerClosedServerMs = 102550; r.lifecycle.driverEndedMs = 12700;
    r.cleanup.closeSentMs = 2510; r.cleanup.closeReceivedMs = 2560;
    if (r.cleanup.serverClose) r.cleanup.serverClose.atServerMs = 102550;
  }
  if (mode === "uplink-only") {
    r.sources.downlink = { ...r.sources.downlink, kind: "absent", trackId: null, senderTrackId: null, senderDrivenCalls: null, unboundCalls: null, clockId: null, initialQuantum: null, targetBinFrames: null, origin: null, final: null, total: emptyHealth(), bins: [] };
    r.decoded.downlink = { ...r.decoded.downlink, origin: null, final: null, total: emptyHealth(), bins: [], sampleRate: null, channels: null, initialQuantum: null, targetBinFrames: null, firstDecodedAtLocalMs: null, firstNonzeroAtLocalMs: null, format: null };
    r.mappings.downlink = null; syncRows(r);
  } else if (mode === "relay-instead-of-independent-return") {
    r.sources.downlink.kind = "relay";
    for (const h of [r.sources.downlink, r.decoded.downlink]) for (const b of h.bins) {
      [b.tone.real400, b.tone.real700] = [b.tone.real700, b.tone.real400]; [b.tone.power400, b.tone.power700] = [b.tone.power700, b.tone.power400];
    }
  } else if (mode === "remote-output-disconnected") {
    const zero = r.decoded.downlink.bins[1]; if (!zero) throw new Error("fixture");
    silenceBin(zero); recount(r.decoded.downlink);
    for (const row of r.decoded.downlink.bins) if (row.frameStart >= zero.frameEnd) row.phase = "warmup";
    r.marks = [{ markerId: "observed-zero", command: "warmup", server: { sentMs: 1600, receivedMs: null, ack: null }, browser: { sentMs: 1600, receivedMs: 1610, ack: { markerId: "observed-zero", command: "warmup", uplinkSource: null, downlinkMonitor: { markerId: "observed-zero", command: "warmup", phase: "warmup", position: at(r.decoded.downlink, zero.frameEnd) } } } }];
    r.receiverDecodeEvidence = {
      healthyMonitor: { sequence: 0, observedAtBrowserMs: 600 },
      start: { receiverTrackId: "downlink-receiver", ssrc: 700, observedAtBrowserMs: 1700, totalSamplesReceived: 72000, concealedSamples: 0, totalAudioEnergy: .01, totalSamplesDuration: 1.5 },
      end: { receiverTrackId: "downlink-receiver", ssrc: 700, observedAtBrowserMs: 2300, totalSamplesReceived: 100000, concealedSamples: 0, totalAudioEnergy: .02, totalSamplesDuration: 2.1 },
    };
  } else {
    for (const h of [r.sources.uplink, r.sources.downlink, r.decoded.uplink, r.decoded.downlink]) {
      const kind = h.origin?.tag.kind ?? "worklet-currentFrame";
      Object.assign(h, history(kind === "decoded-pts" || h === r.sources.uplink ? 400 : 700, h.total.channels, h.initialQuantum ?? 128, kind, [["setup", 48000], ["warmup", 480000], ["qualified", 288000]]));
    }
    r.clientWindow.terminalMs = 17006; r.negative.injectedAtBrowserMs = 17005;
    const startUp = r.marks[2]?.server.ack?.uplinkDecoded; const startDown = r.marks[2]?.browser.ack?.downlinkMonitor;
    if (!startUp || !startDown) throw new Error("fixture");
    r.negative.preInjectionCheckpoint = { identity: r.identity, binding: r.binding, requestedAtBrowserMs: 16005, receivedAtBrowserMs: 16050, browserObservedAtMs: 16040, serverClockId: "python-clock", serverAtMs: 116040, uplinkDecoded: at(r.decoded.uplink, startUp.position.processedFrames + 240000), downlinkMonitor: at(r.decoded.downlink, startDown.position.processedFrames + 240000) };
    r.marks.pop(); // Peer closes intentionally before any completed END exchange.
    r.cleanup.closeSentMs = 17005; r.cleanup.closeReceivedMs = 17055;
    r.lifecycle.contextClosedMs = 17100; r.lifecycle.peerClosedServerMs = 117050; r.lifecycle.driverEndedMs = 27150;
    if (r.cleanup.serverClose) r.cleanup.serverClose.atServerMs = 117050;
  }
  syncRows(r);
  return f;
}

/** Actual runner + processor/observer, with controlled host objects and in-memory HTTP responses. */
export function graphFixture(){
 const base=setupFixture('reject');const tracks:FakeTrack[]=[],nodes:FakeNode[]=[],worklets:FakeWorklet[]=[],contexts:FakeContext[]=[],peers:FakePeer[]=[];
 class FakeTrack extends EventTarget {id='owned-generator';kind='audio';readyState='live';stop=vi.fn(()=>{this.readyState='ended';});constructor(){super();tracks.push(this);}}
 class FakeNode {disconnect=vi.fn<()=>void>();connect=vi.fn<()=>void>();constructor(){nodes.push(this);}}
 class FakeWorklet extends FakeNode {
  readonly flow=workletFlow();cursor=0;onprocessorerror:(()=>void)|null=null;
  port={onmessage:null as ((e:{data:unknown})=>void)|null,close:vi.fn<()=>void>(),postMessage:(data:{type:string})=>{this.flow.command(data);if(data.type==='stop'){for(let i=0;i<30;i++)if(!this.step())break;}else if(data.type==='mark')this.step();this.deliver();}};
  constructor(){super();worklets.push(this);this.connect=vi.fn(()=>{this.step();});}
  deliver(){while(this.cursor<this.flow.messages.length)this.port.onmessage?.({data:this.flow.messages[this.cursor++]});}
  step(){const {active}=this.flow.step(128,undefined,false);this.deliver();return active;}
 }
 class FakeContext extends EventTarget {state='running';sampleRate=48000;currentTime=0;audioWorklet={addModule:vi.fn(async()=>{})};constructor(){super();contexts.push(this);}resume(){return Promise.resolve();}close=vi.fn(async()=>{this.state='closed';});createMediaStreamDestination(){return Object.assign(new FakeNode(),{stream:{getAudioTracks:()=>[new FakeTrack()]}});}}
 class FakePeer extends EventTarget {connectionState='new';iceGatheringState='complete';localDescription={type:'offer',sdp:'fixture-sdp'};sender: {track:FakeTrack}|undefined;constructor(){super();peers.push(this);}addTrack(track:FakeTrack){this.sender={track};return this.sender;}getTransceivers(){return [{sender:this.sender,setCodecPreferences:vi.fn<()=>void>()}];}createOffer(){return Promise.resolve(this.localDescription);}setLocalDescription(){return Promise.resolve();}setRemoteDescription(){this.connectionState='connected';return Promise.resolve();}getStats(){throw Error('fixture paging observed');}close=vi.fn(()=>{this.connectionState='closed';});}
 vi.stubGlobal('AudioContext',FakeContext);vi.stubGlobal('AudioWorkletNode',FakeWorklet);vi.stubGlobal('RTCPeerConnection',FakePeer);vi.stubGlobal('RTCRtpSender',{getCapabilities:()=>({codecs:[{mimeType:'audio/opus'}]})});
 const source=fixture().record;let statsRequests=0;const requests:Array<{path:string;body:Record<string,unknown>}> = [];
 let override:((path:string,body:Record<string,unknown>)=>Response|Promise<Response|undefined>|undefined)|undefined;
 const defaultReply=(path:string,body:Record<string,unknown>):Response=>{
  const envelope={identity:base.options.release.identity,binding:base.options.release.binding};
  if(path==='/worklet.js')return new Response(bytes);
  if(path==='/stage2/offer')throw Error('fixture graph terminal');
  if(path==='/stage2/close')return Response.json({...envelope,closed:true,serverClockId:'server-clock',atServerMs:1,activePeers:0,closingPeers:0,ownedTasks:0,queuedControlBytes:0,pendingControls:0});
  if(path==='/stage2/stats'){
   statsRequests++;return Response.json({...envelope,schema:'quest-stage2-host-server-snapshot.v1',serverClockId:'server-clock',atServerMs:2,allocatedAtServerMs:1,iceState:'closed',dtlsState:'closed',uplinkDecoded:{...source.decoded.uplink,bins:undefined},downlinkSource:{...source.sources.downlink,bins:undefined},positions:{uplinkDecoded:source.decoded.uplink.final,downlinkSource:source.sources.downlink.final},bindings:{uplinkReceiver:{},downlinkSender:{}},selectedPair:null,marks:[],page:{history:body['history'],afterSequence:body['afterSequence'],nextAfterSequence:body['afterSequence'],totalAvailableRows:0,rows:[],final:true},resources:{reservation:source.resources.ownerReservations.python,activePeers:0,closingPeers:0,ownedTasks:0,pendingControls:0,queuedControlBytes:0,maximumConcurrentControls:1,maximumQueuedControlBytes:2,typedHealthBytes:0,knownPendingPayloadBytes:0,ownedControlBytes:0,dropped:0,rejected:0,overflow:0},close:null,outcome:'completed',reason:null});
  }
  throw Error('unexpected fake route '+path);
 };
 vi.stubGlobal('fetch',async(input:URL|string,init?:RequestInit)=>{const path=new URL(String(input)).pathname;let body:Record<string,unknown>={};if(init?.body instanceof Uint8Array)body=JSON.parse(new TextDecoder().decode(init.body));requests.push({path,body});return (await override?.(path,body))??defaultReply(path,body);});
 return {...base,tracks,nodes,worklets,contexts,peers,requests,source,defaultReply,get statsRequests(){return statsRequests;},respond(fn:NonNullable<typeof override>){override=fn;}};
}
