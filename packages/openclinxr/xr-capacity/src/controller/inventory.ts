import type {ControllerInventory} from './types.js';
export const PROTOCOL_SHA256='b28ffd62883b8c6add4e0a0c46734a6994bccfecbb19ddc9f80aeaa52f53c94d';
export const CLARIFICATIONS_SHA256='845dee89f41a17e0a7a2f3e47a62c87de271f8b9594a849e35bc95ec7e25f899';
export const PLAN_SHA256='050587f2c19b31a068ff04bdad33faebfa9be1ca7c0fa1fb6304c07ae7c83bc4';
export const INVENTORY:ControllerInventory={version:1,room:{callsPerView:8,trianglesPerView:46,geometries:3,materials:5,programDelta:1},controller:{geometries:2,materials:3,objects:4,programDelta:2},stereo:{callsBase:16,callsPerValidHand:4,trianglesBase:92,trianglesPerValidHand:24,linesPerValidHand:2}};
export function expectedContent(mask:number){const h=(mask&1?1:0)+(mask&2?1:0);return {calls:16+4*h,triangles:92+24*h,lines:2*h};}
