import { Group, Scene } from "three";
import { describe, expect, it, vi } from "vitest";
import { buildStationRoomShell } from "./index.js";

type StationRoomContext = Parameters<typeof buildStationRoomShell>[0];

vi.mock("@openclinxr/xr-asset-loading", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@openclinxr/xr-asset-loading")>();
	return {
		...actual,
		addReusableExteriorPreEncounterRoom: (
			_ctx: unknown,
			scene: Scene,
			_theme: unknown,
			setAnteroom: (room: Group | null) => void,
		) => {
			const root = new Group();
			root.name = "openclinxr.reusable-pre-encounter-anteroom";
			scene.add(root);
			setAnteroom(root);
		},
	};
});

const SENTINEL = new Error("portal-root-bridge-sentinel-stop-before-gltf");

let bridgeOrder: string[] = [];

vi.mock("@openclinxr/xr-scene", () => ({
	mountStationEnvironmentForRuntime: () => {
		bridgeOrder.push("mount");
		throw SENTINEL;
	},
	loadInfinigenEnvironmentIntoStation: vi.fn(),
}));

vi.mock("@openclinxr/xr-station", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@openclinxr/xr-station")>();
	return {
		...actual,
		enableCaptureRendererShadowMap: vi.fn(),
		markFloorReceiveShadow: vi.fn(),
	};
});

function makeCtx(
	overrides: Partial<StationRoomContext> = {},
): StationRoomContext {
	const scene = new Scene();
	const bridging: Array<Group | null> = [];
	const panelCalls: string[] = [];
	const ctx = {
		scenarioId: () => "ed_chest_pain_priority_v1",
		encounterBundle: () => ({
			scenarioId: "ed_chest_pain_priority_v1",
			environment: {
				assetId: "e",
				blob: { blobName: "ed_chest_pain_priority_v1-env" },
			},
		}),
		scenarioTheme: () => ({ floorColor: 0x111111 }),
		sceneObjectPrefix: () => "t",
		selectedCaptureMode: () => "normal",
		isCaptureShadowPath: () => false,
		hideRoomForCleanCapture: () => false,
		edBayVisibleCapture: () => false,
		selectedScenarioRuntimeMismatch: () => false,
		activeEnvironmentId: () => "ed_trauma_bay",
		stationInteriorLightingVariantId: () => "default",
		runtimeSceneObjectPrefix: () => "t",
		assetLoadingContext: () => ({ clinicalPanel: () => ({}) }),
		iwsdkStationSceneObjects: {
			ambientLight: "a",
			keyLight: "k",
			floor: "f",
			environmentShell: "s",
			bed: "b",
			monitor: "m",
		},
		applyStationInteriorLightingForEnvironment: async () => ({
			rigApplied: true,
		}),
		addScenarioExpectationPanel: () => {
			panelCalls.push("panel");
			if (bridging.length === 0)
				throw new Error("panel ran before anteroom bridge");
		},
		onReusableExteriorAnteroom: (room: Group | null) => {
			bridging.length = 0;
			bridging.push(room);
			bridgeOrder.push("bridge");
		},
		resolveEmulatorRuntimeAssetUrl: () => "",
		isDynamicGeneratedEncounterSceneMode: () => false,
		...overrides,
	} as unknown as StationRoomContext;
	(
		ctx as unknown as {
			__bridging: unknown[];
			__panelCalls: string[];
			__scene: Scene;
		}
	).__bridging = bridging;
	(ctx as unknown as { __panelCalls: string[] }).__panelCalls = panelCalls;
	(ctx as unknown as { __scene: Scene }).__scene = scene;
	return ctx;
}

const extras = (ctx: StationRoomContext) =>
	ctx as unknown as {
		__bridging: Array<Group | null>;
		__panelCalls: string[];
		__scene: Scene;
	};

describe("portal root bridge", () => {
	it("(1) bridges the SAME created root via ctx before mount stops the run", async () => {
		bridgeOrder = [];
		const ctx = makeCtx();
		const { __bridging, __scene } = extras(ctx);
		const spy = vi.fn(ctx.onReusableExteriorAnteroom);
		ctx.onReusableExteriorAnteroom = spy;
		await expect(
			buildStationRoomShell(ctx, __scene, {} as never, {} as never),
		).rejects.toBe(SENTINEL);
		expect(spy).toHaveBeenCalledTimes(1);
		expect(__bridging).toHaveLength(1);
		const root = __bridging[0];
		expect(root).toBeInstanceOf(Group);
		expect(__scene.children).toContain(root);
		expect(spy.mock.calls[0]?.[0]).toBe(root);
		expect(bridgeOrder).toEqual(["bridge", "mount"]);
	});

	it("(2) missing optional setter still reaches the same controlled sentinel, no duplicate root", async () => {
		const { onReusableExteriorAnteroom: _dropped, ...withoutSetter } =
			makeCtx();
		void _dropped;
		const base = withoutSetter;
		const { __scene } = extras(base);
		const ctx = base;
		await expect(
			buildStationRoomShell(ctx, __scene, {} as never, {} as never),
		).rejects.toBe(SENTINEL);
		const roots = __scene.children.filter(
			(c) => c.name === "openclinxr.reusable-pre-encounter-anteroom",
		);
		expect(roots).toHaveLength(1);
	});
});
