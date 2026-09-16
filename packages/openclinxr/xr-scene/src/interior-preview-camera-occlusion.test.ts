/** Owner plant. Ordinary baseline: 2 failed / 3 passed on 252a9e1a. Header and assertion bodies immutable.
 * Baseline counterexample measured on 252a9e1a: full-width door leaf at z=2 blocks
 * every front-row candidate; selector restores blocked pool and returns eye
 * [-2.5999999,1.8,2.5999999] whose ray intersects the leaf. A deeper eye z=1
 * is inside room bounds and has a clear ray. This does not identify the red/grey
 * foreground in the retained browser observation as this synthetic door.
 */
/**
 * ## FIXED (tsk_e7dffd251d07d6e2)
 * Selector no longer restores the rejected doorway-row pool. Deeper room-derived
 * rows are searched only when every first-row eye is blocked; null if none clear.
 */
import {BoxGeometry,Group,Mesh,MeshStandardMaterial} from "three";
import {describe,expect,it} from "vitest";
import {collectDoorLeafWorldBoxes,deriveInteriorPreviewCamera,lookRayHitsAabb} from "./interior-preview-camera.js";

const actors=[{min:[-0.4,0,-1] as const,max:[0.4,1.8,-0.5] as const}];
function fixture(door?:{size:[number,number,number];position:[number,number,number]}){
 const station=new Group(),room=new Group();station.add(room);
 const interior=new Mesh(new BoxGeometry(6,3,6),new MeshStandardMaterial());interior.name="interior_bounds";interior.position.y=1.5;room.add(interior);
 const hull=new Mesh(new BoxGeometry(6.4,3.4,6.4),new MeshStandardMaterial());hull.name="exterior";hull.position.y=1.5;room.add(hull);
 if(door){const leaf=new Mesh(new BoxGeometry(...door.size),new MeshStandardMaterial());leaf.name="fixture-slot.door_leaf";leaf.position.fromArray(door.position);station.add(leaf);}
 return{station,room};
}
describe("the default interior camera does not restore a blocked candidate pool",()=>{
 it("finds a deeper clear interior eye when every doorway-row eye is occluded",()=>{
  const{station,room}=fixture({size:[6,3,0.2],position:[0,1.5,2]});
  const result=deriveInteriorPreviewCamera({roomRoot:room,actorWorldBoxes:actors});
  expect(result).not.toBeNull();if(!result)throw new Error("a clear measured interior eye exists");
  for(const box of collectDoorLeafWorldBoxes(station))expect(lookRayHitsAabb(result.eye.toArray(),result.lookAt.toArray(),box)).toBe(false);
  expect(result.eye.z).toBeLessThan(1.9);expect(result.eye.z).toBeGreaterThan(result.interiorMin.z+result.wallThicknessMeters);
  expect(result.eye.x).toBeGreaterThanOrEqual(result.interiorMin.x+result.wallThicknessMeters);expect(result.eye.x).toBeLessThanOrEqual(result.interiorMax.x-result.wallThicknessMeters);
 });
 it("returns null when no bounded interior candidate has a clear door ray",()=>{
  const{room}=fixture({size:[10,10,10],position:[0,1.5,0]});
  expect(deriveInteriorPreviewCamera({roomRoot:room,actorWorldBoxes:actors})).toBeNull();
 });
 it("preserves the existing doorway-row winner without an occluder",()=>{
  const{room}=fixture();const result=deriveInteriorPreviewCamera({roomRoot:room,actorWorldBoxes:actors});
  expect(result).not.toBeNull();expect(result!.eye.x).toBeCloseTo(-2.6,5);expect(result!.eye.z).toBeCloseTo(2.6,5);
 });
 it("preserves the existing winner when the door is off every relevant look ray",()=>{
  const a=fixture(),b=fixture({size:[0.1,0.1,0.1],position:[0,2.9,-2.5]});
  const before=deriveInteriorPreviewCamera({roomRoot:a.room,actorWorldBoxes:actors}),after=deriveInteriorPreviewCamera({roomRoot:b.room,actorWorldBoxes:actors});
  expect(after).not.toBeNull();expect(after!.eye.toArray()).toEqual(before!.eye.toArray());
 });
 it("does not manufacture a view with missing measured room or actors",()=>{
  expect(deriveInteriorPreviewCamera({roomRoot:new Group(),actorWorldBoxes:actors})).toBeNull();
  expect(deriveInteriorPreviewCamera({roomRoot:fixture().room,actorWorldBoxes:[]})).toBeNull();
 });
});
