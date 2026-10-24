/** Embedded verbatim in the independent Stage2 monitor, with no captured PCM or per-sample allocation. */
export const COHERENT_TONE_DSP_SOURCE = `
class CoherentToneAccumulator {
 constructor(rate){this.rate=rate;this.n=0;this.sumSquares=0;this.real400=0;this.imag400=0;this.real700=0;this.imag700=0;this.c400=1;this.s400=0;this.c700=1;this.s700=0;
  this.dc400=Math.cos(2*Math.PI*400/rate);this.ds400=Math.sin(2*Math.PI*400/rate);this.dc700=Math.cos(2*Math.PI*700/rate);this.ds700=Math.sin(2*Math.PI*700/rate);}
 add(value){this.n++;if(Number.isFinite(value)){this.sumSquares+=value*value;this.real400+=value*this.c400;this.imag400+=value*this.s400;this.real700+=value*this.c700;this.imag700+=value*this.s700;}
  const next400=this.c400*this.dc400-this.s400*this.ds400;this.s400=this.s400*this.dc400+this.c400*this.ds400;this.c400=next400;
  const next700=this.c700*this.dc700-this.s700*this.ds700;this.s700=this.s700*this.dc700+this.c700*this.ds700;this.c700=next700;}
 summary(){const divisor=this.n*this.n;return {n:this.n,sumSquares:this.sumSquares,real400:this.real400,imag400:this.imag400,real700:this.real700,imag700:this.imag700,power400:divisor?2*(this.real400*this.real400+this.imag400*this.imag400)/divisor:0,power700:divisor?2*(this.real700*this.real700+this.imag700*this.imag700)/divisor:0};}
}
`;
