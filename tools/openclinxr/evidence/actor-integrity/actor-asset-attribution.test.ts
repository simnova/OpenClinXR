import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
	normalizePublicAssetPath,
	resolveActorLoadedPath,
} from "../actor-asset-attribution.js";
import { isBodyGarmentMeshName } from "./body-garment-mesh-name.js";

/**
 * Source211 — shared resolver + actual producer query proof.
 * Fixture rows mirror sealed ward-direct-source.json targetRows/allTaggedRows.
 */
const SEALED_ROWS = [
	{
		actorId: "patient_margaret_ellis_v1",
		assetPath: "/generated-humanoids/mpfb-gown-adult-patient.glb",
	},
	{
		actorId: "ward_nurse_patel_v1",
		assetPath: "/generated-humanoids/mpfb-clinical-nurse-adult.glb",
	},
	{
		actorId: "daughter_lena_ellis_v1",
		assetPath: "/generated-humanoids/mpfb-family-partner-adult.glb",
	},
	{
		actorId: "senior_resident_ward_v1",
		assetPath: "/generated-humanoids/mpfb-clinical-physician-adult.glb",
	},
] as const;

function callerLoadedUrl(
	rows: readonly { actorId: string; assetPath: string }[],
	actorId: string,
): string {
	const verdict = resolveActorLoadedPath(rows, actorId);
	return verdict.status === "matched" ? verdict.path : "";
}

// Extract the actual serialized query template from the producer via the TS AST.
let queryTemplate: string | null = null;
async function loadQueryTemplate(): Promise<string> {
	const path = new URL("../per-station-actor-integrity.ts", import.meta.url);
	const src = await readFile(path, "utf8");
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const ts = (await import("typescript")) as typeof import("typescript");
	const sf = ts.createSourceFile(
		"producer.ts",
		src,
		ts.ScriptTarget.Latest,
		true,
	);
	let found: string | null = null;
	function visit(node: import("typescript").Node): void {
		if (ts.isNoSubstitutionTemplateLiteral(node)) {
			const text = node.rawText ?? node.text;
			if (
				text.includes("openClinXrAssetPath") &&
				text.includes("__openClinXrDebugScene")
			) {
				found = text;
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(sf);
	if (!found) throw new Error("producer page.evaluate template not found");
	return found;
}

function buildQueryJs(template: string): string {
	// Producer chains .replace() calls to inject the shared recognizer + regex literals; replay them.
	return template
		.replace(
			"__SOURCE245_BODY_GARMENT_FN__",
			`(${isBodyGarmentMeshName.toString()})`,
		)
		.replace("REAL_GARMENT_RE", "/openclinxr_real_garment_/i")
		.replace(
			"LIBRARY_GARMENT_RE",
			"/makeclothes_library_(scrub|shirt|pant|trouser|gown)/i",
		);
}

type SceneNode = {
	name: string;
	userData: Record<string, unknown>;
	parent: SceneNode | null;
	children: SceneNode[];
	traverse: (cb: (o: SceneNode) => void) => void;
	isMesh?: boolean;
	isSkinnedMesh?: boolean;
	geometry?: unknown;
};

function makeNode(
	name: string,
	userData: Record<string, unknown>,
	parent: SceneNode | null = null,
): SceneNode {
	const node: SceneNode = {
		name,
		userData,
		parent,
		children: [],
		traverse(cb) {
			cb(node);
			for (const child of node.children) child.traverse(cb);
		},
	};
	if (parent) parent.children.push(node);
	return node;
}

// Synthetic minimal scene mirroring the sealed ward capture: misleading
// inherited nurse object name on the physician slot, correct physician direct tag.
function buildSyntheticScene(opts?: {
	ambiguousPhysician?: boolean;
}): SceneNode {
	const scene = makeNode("", {});
	const sceneObj = {
		traverse: (cb: (o: SceneNode) => void) => scene.traverse(cb),
	};
	void sceneObj;
	const mk = (actorId: string, objectName: string, directPath: string) => {
		const root = makeNode(objectName, { openClinXrActorId: actorId }, scene);
		makeNode(
			objectName + "_mesh",
			{ openClinXrActorId: actorId, openClinXrAssetPath: directPath },
			root,
		);
		return root;
	};
	mk(
		"patient_margaret_ellis_v1",
		"ed_chest_pain_adult_cast_glb",
		"/generated-humanoids/mpfb-gown-adult-patient.glb",
	);
	mk(
		"ward_nurse_patel_v1",
		"ed_chest_pain_adult_cast_nurse_glb",
		"/generated-humanoids/mpfb-clinical-nurse-adult.glb",
	);
	mk(
		"daughter_lena_ellis_v1",
		"ed_chest_pain_adult_cast_spouse_glb",
		"/generated-humanoids/mpfb-family-partner-adult.glb",
	);
	// Misleading inherited name: physician geometry still carries the nurse slot name.
	mk(
		"senior_resident_ward_v1",
		"ed_chest_pain_adult_cast_nurse_glb",
		"/generated-humanoids/mpfb-clinical-physician-adult.glb",
	);
	if (opts?.ambiguousPhysician) {
		const extra = makeNode(
			"stray_physician_mesh",
			{
				openClinXrActorId: "senior_resident_ward_v1",
				openClinXrAssetPath:
					"/generated-humanoids/mpfb-clinical-nurse-adult.glb",
			},
			scene,
		);
		void extra;
	}
	return scene;
}

function runQuery(
	queryJs: string,
	scene: SceneNode,
): {
	actors: Array<{
		actorId: string;
		diagnosticNames: string[];
		liveTriangleCount: number;
		hasGarmentRegionLive: boolean;
		liveMeshHeightMeters: number;
	}>;
	directRows: Array<{ actorId: string; assetPath: string }>;
} {
	const sandbox: Record<string, unknown> = {};
	sandbox["browserPageWindow"] = {
		__openClinXrDebugScene: {
			traverse: (cb: (o: SceneNode) => void) => scene.traverse(cb),
		},
	};
	sandbox["window"] = sandbox["browserPageWindow"];
	const wrapped = `globalThis.__r = (${queryJs});`;
	sandbox["globalThis"] = sandbox;
	vm.runInNewContext(wrapped, vm.createContext(sandbox as never));
	return (sandbox as Record<string, unknown>)["__r"] as {
		actors: Array<{
			actorId: string;
			diagnosticNames: string[];
			liveTriangleCount: number;
			hasGarmentRegionLive: boolean;
			liveMeshHeightMeters: number;
		}>;
		directRows: Array<{ actorId: string; assetPath: string }>;
	};
}

describe("shared attribution prefers the actual tagged path", () => {
	it("resolves the physician URI despite the misleading inherited nurse name", () => {
		const verdict = resolveActorLoadedPath(
			[...SEALED_ROWS],
			"senior_resident_ward_v1",
		);
		expect(verdict.status).toBe("matched");
		if (verdict.status !== "matched") throw new Error("expected matched");
		expect(verdict.path).toBe(
			"/generated-humanoids/mpfb-clinical-physician-adult.glb",
		);
		expect(verdict.raw).toBe(
			"/generated-humanoids/mpfb-clinical-physician-adult.glb",
		);
	});

	it("a fed nurse URI stays a mismatch against the expected physician path", () => {
		const nurseFed = callerLoadedUrl(
			[
				{
					actorId: "senior_resident_ward_v1",
					assetPath: "/generated-humanoids/mpfb-clinical-nurse-adult.glb",
				},
			],
			"senior_resident_ward_v1",
		);
		expect(nurseFed).toBe("/generated-humanoids/mpfb-clinical-nurse-adult.glb");
		expect(nurseFed).not.toBe(
			"/generated-humanoids/mpfb-clinical-physician-adult.glb",
		);
	});

	it("refuses ambiguous same-actor URIs instead of guessing", () => {
		const verdict = resolveActorLoadedPath(
			[
				{
					actorId: "senior_resident_ward_v1",
					assetPath: "/generated-humanoids/mpfb-clinical-physician-adult.glb",
				},
				{
					actorId: "senior_resident_ward_v1",
					assetPath: "/generated-humanoids/mpfb-clinical-nurse-adult.glb",
				},
			],
			"senior_resident_ward_v1",
		);
		expect(verdict.status).toBe("ambiguous");
	});

	it("refuses a missing direct tag instead of falling back to name/order", () => {
		expect(resolveActorLoadedPath([], "senior_resident_ward_v1").status).toBe(
			"missing",
		);
		expect(
			resolveActorLoadedPath(
				[{ actorId: "someone_else", assetPath: "/generated-humanoids/x.glb" }],
				"senior_resident_ward_v1",
			).status,
		).toBe("missing");
	});

	it("actual producer query: unique direct tag resolves, ambiguous stays UNKNOWN", async () => {
		if (queryTemplate === null) {
			queryTemplate = await loadQueryTemplate();
		}
		const template = queryTemplate;
		// Serialized query must not reference removed name-keyed lookups or asset evidence.
		expect(template).not.toContain("directByObjectName");
		expect(template).not.toContain("pathByObjectName");
		expect(template).not.toContain("assetEv");
		expect(template).toContain("openClinXrAssetPath");
		// Must parse as a real function expression (catches duplicate const).
		const queryJs = buildQueryJs(template);
		const vm2 = (await import("node:vm")).default;
		new vm2.Script(`(${queryJs})`);
		const scene = buildSyntheticScene();
		const result = runQuery(queryJs, scene);
		expect(result.directRows.length).toBe(4);
		expect(callerLoadedUrl(result.directRows, "senior_resident_ward_v1")).toBe(
			"/generated-humanoids/mpfb-clinical-physician-adult.glb",
		);
		const ambiguous = runQuery(
			queryJs,
			buildSyntheticScene({ ambiguousPhysician: true }),
		);
		expect(
			callerLoadedUrl(ambiguous.directRows, "senior_resident_ward_v1"),
		).toBe("");
	});

	it("treats only the known public filesystem prefix as the served namespace", () => {
		expect(
			normalizePublicAssetPath(
				"apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb",
			),
		).toBe("/generated-humanoids/mpfb-clinical-physician-adult.glb");
		expect(
			normalizePublicAssetPath(
				"/wrong-namespace/mpfb-clinical-physician-adult.glb",
			),
		).toBe("/wrong-namespace/mpfb-clinical-physician-adult.glb");
	});
});
