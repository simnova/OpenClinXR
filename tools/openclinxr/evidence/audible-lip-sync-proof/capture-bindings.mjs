/** Native one-playthrough oracle. General transport seek/rate controls are separate proof cases. */
export function inspectNativeCaptureBindings(report){
 const errors=[];const need=(ok,why)=>{if(!ok)errors.push(why);};
 const segments=report?.segments??[],tap=report?.playedTap??{};
 need(segments.length===1,'native-capture-requires-one-source-generation');
 if(segments.length!==1)return errors;
 const source=segments[0];
 need(source.offset===0&&source.rate===1,'native-capture-requires-zero-offset-unit-rate');
 need(Number.isInteger(report.contextSampleRate)&&report.contextSampleRate===report.decodedSampleRate,'native-context-domain-mismatch');
 const scheduled=source.when*report.contextSampleRate;
 need(Number.isFinite(scheduled)&&Math.abs(scheduled-Math.round(scheduled))<1e-7,'source-start-not-on-integer-context-sample');
 need(tap.sourceGeneration===source.generation&&tap.sourceNodeSerial===source.nodeSerial,'tap-source-node-identity-mismatch');
 need(tap.sourceStartContextSample===Math.round(scheduled),'tap-source-start-sample-mismatch');
 return errors;
}
