import { Bone, Group } from "three";
import { describe, expect, it, vi } from "vitest";
import * as metrics from "../../../../packages/openclinxr/xr-pose/src/hob-contact-metrics.js";
import { raiseSupineFeetOntoSeat, reapplyStoredSupineFootFlex } from "../../../../packages/openclinxr/xr-pose/src/hob-extremity-flex.js";
import { applySupinePoseHoldingIncline } from "../../../../packages/openclinxr/xr-pose/src/supine-deck-plant.js";

function rig(){
 const root=new Group(); const shin=new Bone();shin.name="lowerleg01L";shin.rotation.set(.1,.2,.3);root.add(shin);
 for(const name of ["upperleg01L","upperleg01R","lowerleg01R","spine01","spine03","head"]){const b=new Bone();b.name=name;root.add(b);}
 root.userData.openClinXrSupineFootFlexDeltas={shinL:{axis:"x",delta:.25}};
 return {root,shin};
}
describe("supine flex replay",()=>{
 it("does not double the flex already applied during planting",()=>{const {root,shin}=rig();const spy=vi.spyOn(metrics,"measureSeatClearanceMeters").mockImplementation(()=>shin.rotation.x < -.01 ? 0 : -1);try{expect(raiseSupineFeetOntoSeat(root,.5)).toBeGreaterThan(0);const planted=shin.rotation.x;reapplyStoredSupineFootFlex(root);expect(shin.rotation.x).toBe(planted);}finally{spy.mockRestore();}});
 it("does not accumulate over 120 production MPFB holding frames",()=>{const {root,shin}=rig();applySupinePoseHoldingIncline(root);const q=shin.quaternion.clone();const position=root.position.clone();for(let i=0;i<120;i++)applySupinePoseHoldingIncline(root);expect(shin.rotation.x).toBeCloseTo(.35,12);expect(shin.quaternion.toArray()).toEqual(q.toArray());expect(root.position.toArray()).toEqual(position.toArray());});
 it("does not mistake quaternion round-trip rounding for a new animation pose",()=>{const {root,shin}=rig();shin.rotation.set(.007,.003,.009);reapplyStoredSupineFootFlex(root);const corrected=shin.quaternion.clone();for(let i=0;i<120;i++){shin.quaternion.copy(shin.quaternion.clone().normalize());reapplyStoredSupineFootFlex(root);}expect(shin.rotation.x).toBeCloseTo(.257,12);expect(shin.quaternion.angleTo(corrected)).toBeLessThan(1e-7);});
 it("reapplies after an absolute pose resets the bone",()=>{const {root,shin}=rig();for(let i=0;i<120;i++){shin.rotation.x=.1;reapplyStoredSupineFootFlex(root);expect(shin.rotation.x).toBeCloseTo(.35,12);}});
 it("preserves a new animation input instead of restoring a cached first pose",()=>{const {root,shin}=rig();reapplyStoredSupineFootFlex(root);shin.rotation.x=.7;reapplyStoredSupineFootFlex(root);expect(shin.rotation.x).toBeCloseTo(.95,12);reapplyStoredSupineFootFlex(root);expect(shin.rotation.x).toBeCloseTo(.95,12);expect(shin.rotation.y).toBe(.2);expect(shin.rotation.z).toBe(.3);});
 it("leaves bones unchanged without stored flex",()=>{const {root,shin}=rig();delete root.userData.openClinXrSupineFootFlexDeltas;const q=shin.quaternion.clone();reapplyStoredSupineFootFlex(root);expect(shin.quaternion.toArray()).toEqual(q.toArray());});
 it("ignores missing bones and invalid deltas or axes",()=>{const {root,shin}=rig();root.userData.openClinXrSupineFootFlexDeltas={shinL:{axis:"bad",delta:.25},unknown:{axis:"x",delta:.3},shinR:{axis:"x",delta:NaN}};const q=shin.quaternion.clone();reapplyStoredSupineFootFlex(root);expect(shin.quaternion.toArray()).toEqual(q.toArray());});
});
