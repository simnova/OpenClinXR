import { vi } from "vitest";

const mockWindow = { location: { search: "" }, __openClinXrSceneAssetEvidence: undefined, __openClinXrXrEntryEvidence: undefined, __openClinXrDebugScene: undefined, __openClinXrDeclaredEquipmentMountEvidence: undefined };
globalThis.window = mockWindow as unknown as Window & typeof globalThis;
vi.stubGlobal("window", mockWindow as never);
vi.stubGlobal("performance", { now: () => 100 } as never);