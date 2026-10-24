import vm from 'node:vm';
import {describe, expect, it} from 'vitest';
import {classify} from "../entrypoints/audio-frame-tags.js";
import {decodeNodes, encodeNodes, NUMERIC_BOUNDS} from "../entrypoints/audio-frame-tags.js";
import {closeGraph,deadlineStep,ownedCloseConfirmed,requireBrowserCommandIdentity} from "../entrypoints/audio-frame-tags.js";
import {CONFIG, type NodeRecord, type Role} from "../entrypoints/audio-frame-tags.js";
import {WORKLET_SOURCE} from "../entrypoints/audio-frame-tags.js";

interface Message {kind: string; record?: Omit<NodeRecord,'tuples'>; buffer?: ArrayBuffer}
interface Instance {port: {onmessage: (event: {data: string}) => void}; nextId: number; process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean}
function fixture() {
  const constructors = new Map<string,new (options: unknown) => Instance>();
  const messages = new Map<Instance,Message[]>(); let constructing: Message[];
  const context = vm.createContext({sampleRate: 48000, currentFrame: 0, currentTime: 0,
    AudioWorkletProcessor: class {port = {onmessage: null, postMessage: (value: Message, transfer: ArrayBuffer[] = []) => constructing.push(structuredClone(value,{transfer}))};},
    registerProcessor: (name: string, processor: new (options: unknown) => Instance) => constructors.set(name,processor),
  });
  vm.runInContext(WORKLET_SOURCE,context);
  function create(role: Role) {constructing = []; const node = new (constructors.get(`quest-frame-tags-${role}-v1`)!)({processorOptions:{role}}); messages.set(node,constructing); return node;}
  function process(node: Instance, tag: number, q: number, input?: Float32Array, seconds = tag / 48000) {
    context['currentFrame'] = tag; context['currentTime'] = seconds;
    constructing = messages.get(node)!;
    const output = [new Float32Array(q).fill(9),new Float32Array(q).fill(9)];
    const alive = node.process(input ? [[input]] : [],[output]);
    return {output,alive};
  }
  function finish(node: Instance): NodeRecord {
    constructing = messages.get(node)!; node.port.onmessage({data:'stop'});
    const final = messages.get(node)!.find(m => m.kind === 'final')!;
    const record = final.record!;
    return {...record,tuples:Array.from(new Float64Array(final.buffer!).subarray(0,record.tupleRows * CONFIG.tupleWidth))};
  }
  return {create,process,finish,messages};
}
function pair(change?: (input: Float32Array, index: number) => void, jump = false) {
  const f = fixture(), checker = f.create('checker');
  for (let i=0;i<32;i++) f.process(checker,i*128,128);
  checker.port.onmessage({data:'activate'}); const producer = f.create('producer');
  for(let i=0;i<40;i++) {
    const signal=f.process(producer,4096+i*128+(jump&&i>0?384:0),128).output[0]!;
    change?.(signal,i); const observed=f.process(checker,4096+i*128,128,signal);
    expect(observed.output.every(channel=>channel.every(v=>v===0))).toBe(true);
  }
  return {producer:f.finish(producer),checker:f.finish(checker)};
}
describe('actual worklet and shared classifier',()=>{
  it('replays all seven native tuples exactly without calling index debt physical loss',()=>{
    const f=fixture(), n=f.create('producer');
    for(const tag of [13440,13952,14080,14208,14336,14464,14592])f.process(n,tag,128);
    const r=f.finish(n), grade=classify(r,null);
    expect([r.callbacks,r.frames,r.lastTag!+r.lastQuantum-r.firstTag!,grade.tagSpanDebt.producer]).toEqual([7,896,1280,384]);
    expect(r.tuples.slice(0,3)).toEqual([0,13440,128]);expect(r.firstTime).toBe(.28);
    expect(r.tuples.slice(7,10)).toEqual([1,13952,128]);
    expect(grade.globalTagContinuity).toBe('FAIL');expect(grade.callbackCoverage).toBe('UNEXERCISED');
  });
  it('keeps strict FAIL when independent observed IDs remain continuous',()=>{
    const r=pair(undefined,true), g=classify(r.producer,r.checker);
    expect(g.globalTagContinuity).toBe('FAIL');expect(g.observedContentContinuity).toBe('PASS');expect(g.savedIdIntersection).toBe(2048);
  });
  it.each(['gap','duplicate'] as const)('adjacent tags cannot hide a content %s',fault=>{
    const r=pair((a,i)=>{if(i===3)a[12]=fault==='gap'?a[12]!+1:a[11]!;});
    const g=classify(r.producer,r.checker);expect(g.globalTagContinuity).toBe('PASS');expect(g.observedContentContinuity).toBe('FAIL');
  });
  it('does not assert intermediate IDs inside a gapped saved range',()=>{
    const r=pair();r.checker.tuples=[0,0,128,128,2,127,2];r.checker.tupleRows=1;
    expect(classify(r.producer,r.checker).savedIdIntersection).toBe(0);
  });
  it('missing producer callbacks remain unexercised',()=>{
    const f=fixture(),c=f.create('checker');for(let i=0;i<40;i++)f.process(c,i*128,128);
    expect(classify(null,f.finish(c)).callbackCoverage).toBe('UNEXERCISED');
  });
  it('missing checker callbacks remain unexercised',()=>{
    const f=fixture(),p=f.create('producer');f.process(p,0,128);
    expect(classify(f.finish(p),null).observedContentContinuity).toBe('UNEXERCISED');
  });
  it('both constructed nodes with no callbacks do not prove continuity through absent time',()=>{
    const f=fixture();const p=f.finish(f.create('producer')),c=f.finish(f.create('checker'));
    expect(classify(p,c).globalTagContinuity).toBe('UNEXERCISED');expect(classify(p,c).callbackCoverage).toBe('UNEXERCISED');
  });
  it('uses the previous actual quantum for variable 64/192/256 blocks',()=>{
    const f=fixture(),n=f.create('producer');let tag=200;
    for(const q of [64,192,256,64,256]){f.process(n,tag,q);tag+=q;}
    const r=f.finish(n);expect(r.tagGaps).toBe(0);expect(r.frames).toBe(832);expect(classify(r,null).tagSpanDebt.producer).toBe(0);
  });
  it('retains actual first ID and missing prefix',()=>{
    const f=fixture(),p=f.create('producer'),c=f.create('checker');p.nextId=5;
    const a=f.process(p,0,128).output[0]!;f.process(c,0,128,a);const r=f.finish(c);
    expect(r.firstId).toBe(5);expect(r.missingPrefix).toBe(4);
  });
  it('cannot accept a first content observation before32 checker callbacks',()=>{
    const r=pair();r.checker.firstIdCallback=0;expect(classify(r.producer,r.checker).observedContentContinuity).toBe('FAIL');
  });
  it('cannot mask a missing declared firstID1 with a forged zero prefix count',()=>{
    const r=pair();r.checker.firstId=5;r.checker.missingPrefix=0;
    expect(classify(r.producer,r.checker).observedContentContinuity).toBe('FAIL');
  });
  it.each([Number.NaN,Infinity,-1,0.5])('zeros every checker channel before invalid input %s',value=>{
    const f=fixture(),c=f.create('checker'),input=new Float32Array(128).fill(value);
    expect(f.process(c,0,128,input).output.every(a=>a.every(x=>x===0))).toBe(true);
    const r=f.finish(c);expect(r.invalidSamples).toBe(128);expect(r.nonzeroOutputSamples).toBe(0);
  });
  it('never wraps the exact Float32 ordinal and remains alive for bounded observation',()=>{
    const f=fixture(),p=f.create('producer');p.nextId=CONFIG.maximumOrdinal;
    const x=f.process(p,0,64);expect(x.alive).toBe(true);expect(x.output[0]![0]).toBe(CONFIG.maximumOrdinal);expect(x.output[0]![1]).toBe(0);
    expect(f.finish(p).ordinalOverflow).toBe(true);
  });
  it('distinguishes prelude, activation prefix and zeros after actual input',()=>{
    const f=fixture(),c=f.create('checker');f.process(c,0,64);c.port.onmessage({data:'activate'});f.process(c,64,64);
    f.process(c,128,64,Float32Array.from({length:64},(_,i)=>i+1));f.process(c,192,64);
    const r=f.finish(c);expect([r.preludeZeros,r.activationPrefixZeros,r.postActivationZeros,r.zerosAfterFirstId]).toEqual([64,64,128,64]);
  });
  it('reports a same-clock inconsistency without outputting nonzero audio',()=>{
    const f=fixture(),c=f.create('checker');expect(f.process(c,0,128,undefined,1).output[0]!.every(v=>v===0)).toBe(true);expect(f.finish(c).invalidClock).toBe(1);
  });
  it('cannot hide a tag discontinuity at the independent safety stop',()=>{
    const f=fixture(),p=f.create('producer');f.process(p,0,128);expect(f.process(p,100000,128).alive).toBe(false);
    const message=f.messages.get(p)!.find(x=>x.kind==='final')!;expect(message.record!.tagGaps).toBe(1);
  });
  it('caps traces but continues lifetime counters and emits only one prelude and final',()=>{
    const f=fixture(),c=f.create('checker');for(let i=0;i<100;i++)f.process(c,i*128,128);
    const r=f.finish(c);expect([r.callbacks,r.tupleRows,r.omittedTuples,r.tuples.length]).toEqual([100,64,36,448]);
    expect(f.messages.get(c)!.map(x=>x.kind)).toEqual(['prelude','final']);
    expect(f.process(c,12800,128).alive).toBe(false);
  });
  it('round trips all retained aggregates/ranges exactly within the frozen serialization bound',()=>{
    const r=pair(),payload=encodeNodes(r.producer,r.checker);expect(decodeNodes(payload)).toEqual(r);expect(payload.length).toBeLessThanOrEqual(4096);
    expect(NUMERIC_BOUNDS.peakBytes).toBe(31488);expect(NUMERIC_BOUNDS.peakBytes).toBeLessThanOrEqual(CONFIG.numericLimitBytes);
  });
  it('refuses oversized serialization and malformed snapshot instead of truncating',()=>{
    const r=pair();r.checker.tuples=new Array(5000).fill(1234567);expect(()=>encodeNodes(r.producer,r.checker)).toThrow(/cap/);
    expect(()=>decodeNodes('[[[],[]],null]')).toThrow(/Malformed/);
  });
  it('accepts the exact4096-character boundary and refuses one over',()=>{
    expect(decodeNodes('[null,null]'.padEnd(4096,' '))).toEqual({producer:null,checker:null});
    expect(()=>decodeNodes('[null,null]'.padEnd(4097,' '))).toThrow(/cap/);
  });
  it('keeps all summary copies/scratch/metadata within256 reserved numeric slots',()=>{
    expect(Object.values(NUMERIC_BOUNDS.scalarSlots).reduce((a,b)=>a+b,0)*8).toBe(CONFIG.scalarReservationBytes);
    const r=pair();expect(()=>encodeNodes({...r.producer,firstTime:Infinity},r.checker)).toThrow(/Nonfinite/);
  });
});
describe('partial-construction cleanup',()=>{
  it('attempts every node and port even when a disconnect fails',async()=>{
    const calls:string[]=[];const context={state:'running',close:async()=>{calls.push('context');context.state='closed';}};
    const nodes=[0,1].map(i=>({disconnect(){calls.push(`node${i}`);if(!i)throw Error('owned disconnect failed');},port:{onmessage:null,close(){calls.push(`port${i}`);}}}));
    const result=await closeGraph(nodes,context,performance.now()+100);expect(calls).toEqual(['node0','port0','node1','port1','context']);expect(result.confirmed).toBe(false);
  });
  it('keeps a stalled context close explicitly unconfirmed',async()=>{
    const result=await closeGraph([],{state:'running',close:()=>new Promise<void>(()=>{})},performance.now()+5);
    expect(result.pendingContextClose).toBe(true);expect(result.confirmed).toBe(false);
  });
  it('handles a failure before context creation without inventing nodes',async()=>{
    expect((await closeGraph([],null,performance.now()+5)).confirmed).toBe(true);
  });
  it.each(['browser-disconnected','server-not-listening'])('rejected close is unconfirmed despite %s readback',()=>{
    expect(ownedCloseConfirmed(true,0,false,true)).toBe(false);
  });
  it('distinguishes absent, pending, fulfilled and still-open owner states',()=>{
    expect(ownedCloseConfirmed(false,0,false,false)).toBe(true);
    expect(ownedCloseConfirmed(false,1,false,false)).toBe(false);
    expect(ownedCloseConfirmed(true,1,true,true)).toBe(false);
    expect(ownedCloseConfirmed(true,0,true,false)).toBe(false);
    expect(ownedCloseConfirmed(true,0,true,true)).toBe(true);
  });
  it('refuses preflight/temp work when the original clock already expired',async()=>{
    let calls=0;const state={pending:0,stopped:false};
    await expect(deadlineStep(async()=>{calls++;},state,performance.now()-1)).rejects.toThrow(/deadline/);
    expect(calls).toBe(0);expect(state).toEqual({pending:0,stopped:true});
  });
  it('retains a pending temporary constructor and disposes its late owned result',async()=>{
    const state={pending:0,stopped:false};let birth!:(value:string)=>void,finishClose!:()=>void;
    let ownedPath:string|null=null,closeFulfilled=false;
    const outer=performance.now()+100;
    const creating=deadlineStep(()=>new Promise<string>(resolve=>{birth=resolve;}).then(async value=>{
      ownedPath=value;
      if(state.stopped)await deadlineStep(()=>new Promise<void>(resolve=>{finishClose=()=>{closeFulfilled=true;resolve();};}),state,outer,true);
      return value;
    }),state,performance.now()+5);
    await expect(creating).rejects.toThrow(/pending/);expect(state.pending).toBe(1);
    expect(ownedCloseConfirmed(false,state.pending,false,false)).toBe(false);
    birth('exact-owned-unique-temp');await Promise.resolve();await Promise.resolve();
    expect(ownedPath).toBe('exact-owned-unique-temp');expect(closeFulfilled).toBe(false);
    finishClose();await new Promise(resolve=>setTimeout(resolve,0));
    expect(state.pending).toBe(0);expect(closeFulfilled).toBe(true);
  });
  it('a late preflight completion cannot admit subsequent operations',async()=>{
    const state={pending:0,stopped:false};let finish!:()=>void,subsequent=0;
    const first=deadlineStep(()=>new Promise<void>(resolve=>{finish=resolve;}),state,performance.now()+5);
    await expect(first).rejects.toThrow(/deadline/);finish();await Promise.resolve();await Promise.resolve();
    await expect(deadlineStep(async()=>{subsequent++;},state,performance.now()+100)).rejects.toThrow(/admission/);
    expect(subsequent).toBe(0);
  });
});
describe('effective browser identity before page admission',()=>{
  const executable='/owned/Google Chrome for Testing';
  it('accepts only the exact planned executable and fixed headless profile',()=>{
    expect(()=>requireBrowserCommandIdentity({arguments:[executable,'--headless','--mute-audio']},executable)).not.toThrow();
  });
  it('rejects the observed04 headless-shell mismatch before any page action',()=>{
    let pageCreated=false;
    expect(()=>{
      requireBrowserCommandIdentity({arguments:['/owned/chrome-headless-shell','--headless','--mute-audio']},executable);
      pageCreated=true;
    }).toThrow(/Effective browser executable/);
    expect(pageCreated).toBe(false);
  });
  it.each([null,{}, {arguments:[]}, {arguments:[executable,1]}])('rejects absent or malformed actual command %j',command=>{
    expect(()=>requireBrowserCommandIdentity(command,executable)).toThrow(/Effective browser executable/);
  });
  it.each([{flags:[]},{flags:['--headless=false']}])('rejects a nonmatching headed command $flags even with the expected executable',({flags})=>{
    expect(()=>requireBrowserCommandIdentity({arguments:[executable,...flags,'--mute-audio']},executable)).toThrow(/headless profile/);
  });
});
