import {describe,it,expect} from "vitest";
import {workletFlow} from "./run.test-support.js";
interface Summary{n:number;sumSquares:number;real400:number;imag400:number;real700:number;imag700:number;power400:number;power700:number}
function analyze(samples:Float64Array,rate:number):Summary{
 const h=workletFlow("monitor",rate);h.step(samples.length,[Float32Array.from(samples)]);
 const message=h.messages.find(m=>m.type==="report");if(!(message?.rows instanceof Float64Array))throw Error("no observed complete DSP row");const r=message.rows;
 return {n:r[23]!,sumSquares:r[24]!,real400:r[25]!,imag400:r[26]!,real700:r[27]!,imag700:r[28]!,power400:r[29]!,power700:r[30]!};
}
/** Independent direct-frequency oracle, deliberately no recurrence or implementation helper. */
function oracle(samples:Float64Array,rate:number):Summary{
 let sumSquares=0,real400=0,imag400=0,real700=0,imag700=0;
 for(let i=0;i<samples.length;i++){const x=samples[i]??0;sumSquares+=x*x;real400+=x*Math.cos(2*Math.PI*400*i/rate);imag400+=x*Math.sin(2*Math.PI*400*i/rate);real700+=x*Math.cos(2*Math.PI*700*i/rate);imag700+=x*Math.sin(2*Math.PI*700*i/rate);}
 const n=samples.length;return {n,sumSquares,real400,imag400,real700,imag700,power400:n?2*(real400**2+imag400**2)/(n*n):0,power700:n?2*(real700**2+imag700**2)/(n*n):0};
}
function gate(s:Summary,expected:400|700):boolean{const power=expected===400?s.power400:s.power700,other=expected===400?s.power700:s.power400;return Object.values(s).every(Number.isFinite)&&s.n>0&&s.sumSquares>0&&power>=.5*s.sumSquares/s.n&&power>=4*other;}
const tone=(n:number,rate:number,hz:number,phase:number,peak=.02)=>Float64Array.from({length:n},(_,i)=>peak*Math.sin(2*Math.PI*hz*i/rate+phase));
function noise(n:number):Float64Array{let state=0x4159a72d;return Float64Array.from({length:n},()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return ((state>>>0)/4294967296*2-1)*.02;});}
// Prospective fixed matrix: 2rates x2noninteger windows x3phases x2tones=24 positive controls; no fitting to media data.
describe('fixed coherent-tone calibration',()=>{
 for(const rate of [44100,48000])for(const n of [rate/2+3,rate/2+127])for(const phase of [0,.43,2.1])for(const hz of [400,700] as const)it(`correct${hz} rate${rate} N${n} phase${phase}`,()=>{
  const samples=Float64Array.from(Float32Array.from(tone(n,rate,hz,phase))),actual=analyze(samples,rate),expected=oracle(samples,rate);
  // Float64 recurrence vs direct trig: use an O(N*epsilon*sum|x|) coefficient roundoff bound, including near-zero quadratures.
  const coefficientBound=8*Number.EPSILON*n*samples.reduce((sum,x)=>sum+Math.abs(x),0);
  for(const key of Object.keys(expected) as Array<keyof Summary>){const bound=key.startsWith("real")||key.startsWith("imag")?Math.max(1e-12,coefficientBound):Math.max(1e-12,Math.abs(expected[key])*1e-8);expect(Math.abs(actual[key]-expected[key])).toBeLessThan(bound);}
  expect(gate(actual,hz)).toBe(true);expect(gate(actual,hz===400?700:400)).toBe(false);
 });
 for(const rate of [44100,48000]){
  it(`rejects silence/noise/unrelated tone/relay-as-downlink/mixed-tie rate${rate}`,()=>{const n=rate/2+3;
   for(const samples of [new Float64Array(n),noise(n),tone(n,rate,1100,.2)]){const actual=analyze(samples,rate);expect(gate(actual,400)).toBe(false);expect(gate(actual,700)).toBe(false);}
   expect(gate(analyze(tone(n,rate,400,.3),rate),700)).toBe(false);
   const mixed=Float64Array.from({length:n},(_,i)=>.01*Math.sin(2*Math.PI*400*i/rate)+.01*Math.sin(2*Math.PI*700*i/rate+.4));expect(gate(analyze(mixed,rate),400)).toBe(false);expect(gate(analyze(mixed,rate),700)).toBe(false);
  });
 }
 it('rejects an empty callback without inventing signal energy or a retained row',()=>{const h=workletFlow("monitor");expect(h.step(0,[new Float32Array(0)]).active).toBe(false);expect(h.messages).toEqual([expect.objectContaining({type:"fault",reason:"processor-shape",total:null})]);expect(h.messages.some(m=>m.type==="report")).toBe(false);});
});
