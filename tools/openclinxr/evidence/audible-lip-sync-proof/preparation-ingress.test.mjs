import {it,expect,vi,afterEach} from "vitest";
import {selectPreparationCues} from "../../../../apps/ui-xr/src/prepared-actor-audio.ts";
const doc={mouthCues:[{value:"B",start:0,end:1}]};
const diagnostic=[{phoneme:"DD",atSecond:0,durationSeconds:1}];
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it("default cue input uses canonical semantics even in DEV fixture",()=>{
 vi.stubEnv("DEV",true);vi.stubGlobal("window",{location:{search:"?openclinxrSpeakFixture=1"}});
 expect(selectPreparationCues({mouthCues:doc})).toEqual([{phoneme:"SS",atSecond:0,durationSeconds:1}]);
});
it("explicit private approximate data accepted only in actual DEV fixture",()=>{
 vi.stubEnv("DEV",true);vi.stubGlobal("window",{location:{search:"?openclinxrSpeakFixture=1"}});
 expect(selectPreparationCues({mouthCues:doc,diagnosticCues:diagnostic})).toEqual(diagnostic);
});
it("actual production refuses private diagnostic data despite enabled fixture URL",()=>{
 vi.stubEnv("DEV",false);vi.stubGlobal("window",{location:{search:"?openclinxrSpeakFixture=1"}});
 expect(()=>selectPreparationCues({mouthCues:doc,diagnosticCues:diagnostic})).toThrow("diagnostic-cues-ingress-refused");
});
it("actual DEV without fixture ingress refuses private diagnostic data",()=>{
 vi.stubEnv("DEV",true);vi.stubGlobal("window",{location:{search:""}});
 expect(()=>selectPreparationCues({mouthCues:doc,diagnosticCues:diagnostic})).toThrow("diagnostic-cues-ingress-refused");
});
