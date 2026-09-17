import {it,expect} from 'vitest';
import {inspectNativeCaptureBindings} from './capture-bindings.mjs';
import {validateReport} from './validate.mjs';
function coherent(){return{decodedSampleRate:22050,contextSampleRate:22050,segments:[{when:2,offset:0,rate:1,generation:'actorA:1',nodeSerial:1}],playedTap:{sourceGeneration:'actorA:1',sourceNodeSerial:1,sourceStartContextSample:44100}};}
it('native source/tap node and integer sample identities agree in a positive binding control',()=>expect(inspectNativeCaptureBindings(coherent())).toEqual([]));
for(const [name,mutate,why] of[
 ['old node under same generation',r=>r.playedTap.sourceNodeSerial=9,'tap-source-node-identity-mismatch'],
 ['old generation under same node',r=>r.playedTap.sourceGeneration='actorA:old','tap-source-node-identity-mismatch'],
 ['unrelated source start sample',r=>r.playedTap.sourceStartContextSample=44101,'tap-source-start-sample-mismatch'],
 ['fractional source start',r=>r.segments[0].when+=0.1/22050,'source-start-not-on-integer-context-sample'],
 ['resampled context smuggled into native identity',r=>r.contextSampleRate=48000,'native-context-domain-mismatch'],
 ['multiple source generations',r=>r.segments.push({...r.segments[0],nodeSerial:2}),'native-capture-requires-one-source-generation'],
 ['nonzero offset',r=>r.segments[0].offset=1,'native-capture-requires-zero-offset-unit-rate'],
 ['non-native rate',r=>r.segments[0].rate=2,'native-capture-requires-zero-offset-unit-rate'],
])it(name+' is refused without weakening the native waveform proof',()=>{const r=coherent();mutate(r);expect(inspectNativeCaptureBindings(r)).toContain(why);});

it('actual report validator is wired to the native source-node identity refusal',()=>{
 const r=coherent();r.playedTap.sourceNodeSerial=9;
 expect(validateReport(r,process.cwd())).toContain('tap-source-node-identity-mismatch');
});
