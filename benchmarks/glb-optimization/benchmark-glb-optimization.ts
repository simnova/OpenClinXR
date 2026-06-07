import { createReadStream, statSync } from "node:fs";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { NodeIO, type Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRDracoMeshCompression, KHRTextureBasisu } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { chromium, type Browser, type Page } from "playwright";

const require = createRequire(import.meta.url);
const draco3d = require("draco3d") as { createDecoderModule: () => Promise<unknown> };
let dracoDecoderModule: Promise<unknown> | null = null;

type Sample = {
  id: string;
  category: "animated_humanoid" | "medium_humanoid" | "equipment_prop" | "environment";
  sourcePath: string;
  notes: string;
};

type ToolVariant = {
  id: string;
  family: "gltf-transform" | "gltfpack" | "blender" | "combination";
  label: string;
  command: (inputPath: string, outputPath: string, tempDir: string) => Promise<CommandResult>;
  webxrNotes: string;
};

type CommandResult = {
  ok: boolean;
  commandLine: string;
  elapsedMs: number;
  stdout: string;
  stderr: string;
  error?: string;
};

type Metrics = {
  meshes: number;
  primitives: number;
  skins: number;
  animations: number;
  materials: number;
  textures: number;
  vertices: number;
  triangles: number;
  extensionsUsed: string[];
};

type BrowserMetrics = {
  ok: boolean;
  screenshotPath: string | null;
  loadMs: number;
  firstFrameMs: number;
  averageFrameMs: number;
  fpsEstimate: number;
  drawCalls: number;
  triangles: number;
  visible: boolean;
  nonBackgroundPixelRatio: number;
  error?: string;
};

type VariantResult = {
  sampleId: string;
  category: Sample["category"];
  sourcePath: string;
  inputPath: string;
  variantId: string;
  family: ToolVariant["family"];
  label: string;
  outputPath: string;
  command: CommandResult;
  originalBytes: number;
  optimizedBytes: number | null;
  compressionRatio: number | null;
  percentSmaller: number | null;
  sourceMetrics: Metrics;
  optimizedMetrics: Metrics | null;
  browserMetrics: BrowserMetrics | null;
  usableAsBrowserReviewFixture: boolean;
  usableAsWebXrRuntimeReplacement: false;
  blockers: string[];
  webxrNotes: string;
};

type BenchmarkReport = {
  schemaVersion: "openclinxr.glb-optimization-cagematch.v1";
  generatedAt: string;
  runId: string;
  samples: Sample[];
  results: VariantResult[];
  winners: Array<{
    sampleId: string;
    sizeWinner: string | null;
    browserReviewWinner: string | null;
    recommendedPipeline: string;
  }>;
  globalRecommendation: string[];
  notEvidenceFor: string[];
};

const ROOT = process.cwd();
const BENCH_ROOT = "benchmarks/glb-optimization";
const INPUT_ROOT = path.join(BENCH_ROOT, "input");
const OUTPUT_ROOT = path.join(BENCH_ROOT, "output");
const REPORT_ROOT = path.join(BENCH_ROOT, "reports");
const BLENDER_SCRIPT = path.join(BENCH_ROOT, "blender_decimate_draco.py");

const SAMPLES: Sample[] = [
  {
    id: "peds_patient_child_animated",
    category: "animated_humanoid",
    sourcePath: "apps/ui-xr/public/generated-humanoids/peds_patient_child.glb",
    notes: "Large generated pediatric patient with skin, morph targets, and procedural role animations.",
  },
  {
    id: "adult_standard_humanoid",
    category: "medium_humanoid",
    sourcePath: "apps/ui-xr/public/xr-assets/humanoids/variants/adult-standard-generated-human.glb",
    notes: "Medium generated humanoid variant for baseline body/runtime delivery.",
  },
  {
    id: "ecg_cart_prop",
    category: "equipment_prop",
    sourcePath: "apps/ui-xr/public/xr-assets/medical-equipment/ecg-cart-12-lead.glb",
    notes: "Small multi-mesh clinical prop.",
  },
  {
    id: "pediatric_bay_environment",
    category: "environment",
    sourcePath: "apps/ui-xr/dist/xr-assets/environment/pediatric_urgent_care_bay_environment.glb",
    notes: "Environment shell from built UI-XR assets; copied for benchmark only.",
  },
];

const VARIANTS: ToolVariant[] = [
  {
    id: "original_copy",
    family: "combination",
    label: "Original copy baseline",
    command: async (input, output) => {
      const started = performance.now();
      await mkdir(path.dirname(output), { recursive: true });
      await copyFile(input, output);
      return {
        ok: true,
        commandLine: `cp ${input} ${output}`,
        elapsedMs: round(performance.now() - started),
        stdout: "",
        stderr: "",
      };
    },
    webxrNotes: "Baseline browser visibility and load time for fair comparison.",
  },
  {
    id: "gltf_transform_meshopt",
    family: "gltf-transform",
    label: "glTF-Transform optimize meshopt",
    command: (input, output) => run("pnpm", ["exec", "gltf-transform", "optimize", input, output, "--compress", "meshopt", "--texture-compress", "false", "--simplify", "false"]),
    webxrNotes: "Requires Meshopt decoder in browser/runtime.",
  },
  {
    id: "gltf_transform_draco",
    family: "gltf-transform",
    label: "glTF-Transform optimize Draco",
    command: (input, output) => run("pnpm", ["exec", "gltf-transform", "optimize", input, output, "--compress", "draco", "--texture-compress", "false", "--simplify", "false"]),
    webxrNotes: "Requires Draco decoder; usually slower decode than Meshopt for runtime.",
  },
  {
    id: "gltf_transform_webp",
    family: "gltf-transform",
    label: "glTF-Transform meshopt + WebP textures",
    command: (input, output) => run("pnpm", ["exec", "gltf-transform", "optimize", input, output, "--compress", "meshopt", "--texture-compress", "webp", "--texture-size", "1024", "--simplify", "false"]),
    webxrNotes: "WebP helps network size for textured assets but not GPU memory.",
  },
  {
    id: "gltf_transform_ktx2",
    family: "gltf-transform",
    label: "glTF-Transform meshopt + KTX2/Basis",
    command: (input, output) => run("pnpm", ["exec", "gltf-transform", "optimize", input, output, "--compress", "meshopt", "--texture-compress", "ktx2", "--texture-size", "1024", "--simplify", "false"]),
    webxrNotes: "Preferred WebXR texture target when local KTX encoder is installed and visual quality passes.",
  },
  {
    id: "gltfpack_cc",
    family: "gltfpack",
    label: "gltfpack -cc keep names/materials/extras",
    command: (input, output) => run("pnpm", ["exec", "gltfpack", "-i", input, "-o", output, "-cc", "-kn", "-km", "-ke"]),
    webxrNotes: "Meshoptimizer compression; requires Meshopt decoder.",
  },
  {
    id: "gltfpack_cc_tc_si",
    family: "gltfpack",
    label: "gltfpack -cc -tc -si 0.75",
    command: (input, output) => run("pnpm", ["exec", "gltfpack", "-i", input, "-o", output, "-cc", "-tc", "-si", "0.75", "-kn", "-km", "-ke"]),
    webxrNotes: "Aggressive WebXR candidate: Meshopt + KTX2 texture path + simplification.",
  },
  {
    id: "blender_decimate_draco",
    family: "blender",
    label: "Blender decimate 0.65 + Draco export",
    command: (input, output) => run(process.env.BLENDER_PATH || "/opt/homebrew/bin/blender", ["--background", "--python", BLENDER_SCRIPT, "--", "--input", input, "--output", output, "--ratio", "0.65"], 240_000),
    webxrNotes: "Useful for geometry reduction, but can damage rig/morph fidelity.",
  },
  {
    id: "gltfpack_then_gltf_transform",
    family: "combination",
    label: "gltfpack -cc then glTF-Transform prune",
    command: async (input, output, tempDir) => {
      const mid = path.join(tempDir, "gltfpack_mid.glb");
      const first = await run("pnpm", ["exec", "gltfpack", "-i", input, "-o", mid, "-cc", "-kn", "-km", "-ke"]);
      if (!first.ok) return first;
      const second = await run("pnpm", ["exec", "gltf-transform", "optimize", mid, output, "--compress", "false", "--texture-compress", "false", "--simplify", "false"]);
      return {
        ...second,
        commandLine: `${first.commandLine} && ${second.commandLine}`,
        elapsedMs: first.elapsedMs + second.elapsedMs,
        stdout: `${first.stdout}\n${second.stdout}`.trim(),
        stderr: `${first.stderr}\n${second.stderr}`.trim(),
      };
    },
    webxrNotes: "Combination check for post-gltfpack cleanup; expected to preserve Meshopt requirement.",
  },
];

async function main(): Promise<void> {
  const runId = readArg("--run-id") ?? new Date().toISOString().slice(0, 10);
  const sampleLimit = Number(readArg("--sample-limit") ?? SAMPLES.length);
  const samples = SAMPLES.slice(0, sampleLimit).filter((sample) => sampleExists(sample));
  await Promise.all([mkdir(INPUT_ROOT, { recursive: true }), mkdir(OUTPUT_ROOT, { recursive: true }), mkdir(REPORT_ROOT, { recursive: true })]);

  const browserServer = await startStaticServer(5219);
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 1 });
    await setupBrowserPage(page, 5219);
    const results: VariantResult[] = [];
    for (const sample of samples) {
      const inputPath = await copySample(sample);
      for (const variant of VARIANTS) {
        results.push(await runVariant(sample, inputPath, variant, page, runId));
      }
    }

    const report: BenchmarkReport = {
      schemaVersion: "openclinxr.glb-optimization-cagematch.v1",
      generatedAt: new Date().toISOString(),
      runId,
      samples,
      results,
      winners: buildWinners(samples, results),
      globalRecommendation: buildGlobalRecommendation(results),
      notEvidenceFor: [
        "b_plus_visual_realism_gate",
        "quest_readiness",
        "production_asset_readiness",
        "learner_readiness",
        "clinical_validity",
        "scoring_validity",
      ],
    };
    const jsonPath = path.join(REPORT_ROOT, `glb-optimization-cagematch-${runId}.json`);
    const mdPath = path.join(REPORT_ROOT, `glb-optimization-cagematch-${runId}.md`);
    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await writeFile(mdPath, renderMarkdown(report), "utf8");
    await writeFile(path.join(BENCH_ROOT, "latest-report.md"), renderMarkdown(report), "utf8");
    console.log(JSON.stringify({ jsonPath, mdPath, latest: path.join(BENCH_ROOT, "latest-report.md"), resultCount: results.length }, null, 2));
  } finally {
    if (browser) await browser.close();
    browserServer.close();
  }
}

async function runVariant(sample: Sample, inputPath: string, variant: ToolVariant, page: Page, runId: string): Promise<VariantResult> {
  const sampleOutputRoot = path.join(OUTPUT_ROOT, runId, sample.id, variant.id);
  const outputPath = path.join(sampleOutputRoot, `${sample.id}.${variant.id}.glb`);
  await mkdir(sampleOutputRoot, { recursive: true });
  const originalBytes = (await stat(inputPath)).size;
  const sourceMetrics = await readMetrics(inputPath);
  const command = await variant.command(inputPath, outputPath, sampleOutputRoot);
  const outputExists = command.ok && await fileExists(outputPath);
  const optimizedBytes = outputExists ? (await stat(outputPath)).size : null;
  const optimizedMetrics = outputExists ? await readMetrics(outputPath).catch(() => null) : null;
  const screenshotPath = outputExists ? path.join(sampleOutputRoot, `${sample.id}.${variant.id}.png`) : null;
  const browserMetrics = outputExists ? await measureInBrowser(page, outputPath, screenshotPath ?? undefined).catch((error: unknown) => ({
    ok: false,
    screenshotPath,
    loadMs: 0,
    firstFrameMs: 0,
    averageFrameMs: 0,
    fpsEstimate: 0,
    drawCalls: 0,
    triangles: 0,
    visible: false,
    nonBackgroundPixelRatio: 0,
    error: error instanceof Error ? error.message : String(error),
  })) : null;
  const compressionRatio = optimizedBytes ? round(optimizedBytes / originalBytes) : null;
  const percentSmaller = compressionRatio === null ? null : round((1 - compressionRatio) * 100);
  const blockers = buildBlockers(variant.id, command, sourceMetrics, optimizedMetrics, browserMetrics, percentSmaller);
  return {
    sampleId: sample.id,
    category: sample.category,
    sourcePath: sample.sourcePath,
    inputPath,
    variantId: variant.id,
    family: variant.family,
    label: variant.label,
    outputPath,
    command,
    originalBytes,
    optimizedBytes,
    compressionRatio,
    percentSmaller,
    sourceMetrics,
    optimizedMetrics,
    browserMetrics,
    usableAsBrowserReviewFixture: blockers.length === 0,
    usableAsWebXrRuntimeReplacement: false,
    blockers: [...blockers, "webxr_runtime_replacement_requires_real_ui_xr_or_quest_evidence"],
    webxrNotes: variant.webxrNotes,
  };
}

function buildBlockers(
  variantId: string,
  command: CommandResult,
  sourceMetrics: Metrics,
  optimizedMetrics: Metrics | null,
  browserMetrics: BrowserMetrics | null,
  percentSmaller: number | null,
): string[] {
  const blockers: string[] = [];
  if (!command.ok) blockers.push("optimizer_command_failed");
  if (!optimizedMetrics) blockers.push("optimized_glb_metrics_unavailable");
  if (variantId !== "original_copy" && (percentSmaller === null || percentSmaller < 2)) blockers.push("size_reduction_below_2_percent");
  if (optimizedMetrics) {
    if (sourceMetrics.skins > 0 && optimizedMetrics.skins < sourceMetrics.skins) blockers.push("skin_count_regressed");
    if (sourceMetrics.animations > 0 && optimizedMetrics.animations < sourceMetrics.animations) blockers.push("animation_count_regressed");
    if (optimizedMetrics.triangles <= 0) blockers.push("triangle_count_zero");
  }
  if (!browserMetrics?.ok) blockers.push("browser_load_failed");
  if (browserMetrics && !browserMetrics.visible) blockers.push("browser_visual_visibility_failed");
  if (variantId === "original_copy") blockers.push("baseline_not_an_optimization_candidate");
  return blockers;
}

async function measureInBrowser(page: Page, glbPath: string, screenshotPath?: string): Promise<BrowserMetrics> {
  const urlPath = `/${glbPath.split(path.sep).map(encodeURIComponent).join("/")}`;
  const metrics = await page.evaluate(async (assetUrl) => {
    return await window.openClinXrRunGlbBenchmark(assetUrl);
  }, urlPath) as BrowserMetrics;
  if (screenshotPath) {
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    metrics.screenshotPath = screenshotPath;
  }
  return metrics;
}

async function setupBrowserPage(page: Page, port: number): Promise<void> {
  await page.goto(`http://127.0.0.1:${port}/__openclinxr_glb_benchmark_viewer.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.openClinXrRunGlbBenchmark === "function", null, { timeout: 30_000 });
}

function viewerHtml(): string {
  return `
    <html>
      <head>
        <script type="importmap">
          {
            "imports": {
              "three": "/apps/arena/model-vetting-studio/node_modules/three/build/three.module.js",
              "three/addons/": "/apps/arena/model-vetting-studio/node_modules/three/examples/jsm/"
            }
          }
        </script>
      </head>
      <body><canvas id="stage" width="1280" height="960"></canvas></body>
      <script type="module">
        import * as THREE from 'three';
        import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
        import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
        import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
        import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

        const canvas = document.getElementById('stage');
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
        renderer.setSize(1280, 960, false);
        renderer.setClearColor(new THREE.Color('#18211d'));
        const scene = new THREE.Scene();
        scene.background = new THREE.Color('#18211d');
        scene.add(new THREE.AmbientLight('#ffffff', 2.0));
        const light = new THREE.DirectionalLight('#ffffff', 2.5);
        light.position.set(3, 4, 5);
        scene.add(light);
        const camera = new THREE.PerspectiveCamera(35, 1280 / 960, 0.01, 100);
        const loader = new GLTFLoader();
        const draco = new DRACOLoader();
        draco.setDecoderPath('/apps/arena/model-vetting-studio/node_modules/three/examples/jsm/libs/draco/');
        loader.setDRACOLoader(draco);
        loader.setMeshoptDecoder(MeshoptDecoder);
        await MeshoptDecoder.ready;
        const ktx2 = new KTX2Loader();
        ktx2.setTranscoderPath('/apps/arena/model-vetting-studio/node_modules/three/examples/jsm/libs/basis/');
        ktx2.detectSupport(renderer);
        loader.setKTX2Loader(ktx2);

        window.openClinXrRunGlbBenchmark = async (assetUrl) => {
          for (const child of [...scene.children]) {
            if (child.userData.benchmarkModel) scene.remove(child);
          }
          renderer.info.reset();
          const start = performance.now();
          let gltf;
          try {
            gltf = await loader.loadAsync(assetUrl);
          } catch (error) {
            return { ok: false, screenshotPath: null, loadMs: performance.now() - start, firstFrameMs: 0, averageFrameMs: 0, fpsEstimate: 0, drawCalls: 0, triangles: 0, visible: false, nonBackgroundPixelRatio: 0, error: error instanceof Error ? error.message : String(error) };
          }
          const loadMs = performance.now() - start;
          const model = buildCaptureModel(gltf.scene);
          model.userData.benchmarkModel = true;
          scene.add(model);
          model.updateMatrixWorld(true);
          const box = computeBaseMeshBounds(model);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          const scale = 2.2 / Math.max(size.y, 0.001);
          model.scale.setScalar(scale);
          model.updateMatrixWorld(true);
          const scaledBox = computeBaseMeshBounds(model);
          const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
          model.position.set(-scaledCenter.x, -scaledBox.min.y, -scaledCenter.z);
          model.updateMatrixWorld(true);
          camera.position.set(0, 1.2, 5);
          camera.lookAt(0, 1, 0);
          const firstFrameStart = performance.now();
          renderer.render(scene, camera);
          const firstFrameMs = performance.now() - firstFrameStart;
          const frameTimes = [];
          for (let index = 0; index < 60; index += 1) {
            const frameStart = performance.now();
            model.rotation.y += Math.PI / 180;
            renderer.render(scene, camera);
            frameTimes.push(performance.now() - frameStart);
          }
          const averageFrameMs = frameTimes.reduce((sum, value) => sum + value, 0) / frameTimes.length;
          const pixels = new Uint8Array(canvas.width * canvas.height * 4);
          const gl = renderer.getContext();
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          let nonBackground = 0;
          for (let index = 0; index < pixels.length; index += 4) {
            const red = pixels[index], green = pixels[index + 1], blue = pixels[index + 2];
            if (Math.abs(red - 24) + Math.abs(green - 33) + Math.abs(blue - 29) > 28) nonBackground += 1;
          }
          return {
            ok: true,
            screenshotPath: null,
            loadMs: Number(loadMs.toFixed(2)),
            firstFrameMs: Number(firstFrameMs.toFixed(2)),
            averageFrameMs: Number(averageFrameMs.toFixed(2)),
            fpsEstimate: Number((1000 / Math.max(averageFrameMs, 0.001)).toFixed(1)),
            drawCalls: renderer.info.render.calls,
            triangles: renderer.info.render.triangles,
            visible: nonBackground / (canvas.width * canvas.height) > 0.01,
            nonBackgroundPixelRatio: Number((nonBackground / (canvas.width * canvas.height)).toFixed(4))
          };
        };

        function buildCaptureModel(sourceScene) {
          sourceScene.updateMatrixWorld(true);
          const captureModel = new THREE.Group();
          sourceScene.traverse((object) => {
            if (!object.isMesh || !object.geometry) return;
            const mesh = new THREE.Mesh(object.geometry, object.material);
            mesh.name = (object.name || 'mesh') + '_benchmark_capture_clone';
            mesh.frustumCulled = false;
            mesh.applyMatrix4(object.matrixWorld);
            captureModel.add(mesh);
          });
          return captureModel;
        }

        function computeBaseMeshBounds(model) {
          const bounds = new THREE.Box3();
          const point = new THREE.Vector3();
          model.traverse((object) => {
            if (!object.isMesh || !object.geometry) return;
            const position = object.geometry.getAttribute('position');
            if (!position) return;
            object.updateMatrixWorld(true);
            for (let index = 0; index < position.count; index += 1) {
              point.fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld);
              bounds.expandByPoint(point);
            }
          });
          if (bounds.isEmpty()) {
            bounds.setFromCenterAndSize(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 2, 1));
          }
          return bounds;
        }
      </script>
    </html>
  `;
}

async function readMetrics(filePath: string): Promise<Metrics> {
  const io = new NodeIO()
    .registerExtensions([...ALL_EXTENSIONS, EXTMeshoptCompression, KHRDracoMeshCompression, KHRTextureBasisu])
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "draco3d.decoder": await getDracoDecoderModule() });
  const document = await io.read(filePath);
  return metrics(document);
}

function getDracoDecoderModule(): Promise<unknown> {
  dracoDecoderModule ??= draco3d.createDecoderModule();
  return dracoDecoderModule;
}

function metrics(document: Document): Metrics {
  const root = document.getRoot();
  const primitives = root.listMeshes().flatMap((mesh) => mesh.listPrimitives());
  return {
    meshes: root.listMeshes().length,
    primitives: primitives.length,
    skins: root.listSkins().length,
    animations: root.listAnimations().length,
    materials: root.listMaterials().length,
    textures: root.listTextures().length,
    vertices: primitives.reduce((sum, primitive) => sum + (primitive.getAttribute("POSITION")?.getCount() ?? 0), 0),
    triangles: primitives.reduce((sum, primitive) => sum + Math.floor((primitive.getIndices()?.getCount() ?? 0) / 3), 0),
    extensionsUsed: root.listExtensionsUsed().map((extension) => extension.extensionName).sort(),
  };
}

async function copySample(sample: Sample): Promise<string> {
  const dest = path.join(INPUT_ROOT, `${sample.id}.glb`);
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(sample.sourcePath, dest);
  return dest;
}

function sampleExists(sample: Sample): boolean {
  try {
    return statSync(sample.sourcePath).isFile();
  } catch {
    return false;
  }
}

function buildWinners(samples: Sample[], results: VariantResult[]): BenchmarkReport["winners"] {
  return samples.map((sample) => {
    const sampleResults = results.filter((result) => result.sampleId === sample.id);
    const completed = sampleResults.filter((result) => result.command.ok && result.optimizedBytes !== null);
    const sizeWinner = completed.sort((a, b) => (a.optimizedBytes ?? Infinity) - (b.optimizedBytes ?? Infinity))[0]?.variantId ?? null;
    const usable = sampleResults.filter((result) => result.usableAsBrowserReviewFixture);
    const browserReviewWinner = usable.sort((a, b) => (b.percentSmaller ?? -Infinity) - (a.percentSmaller ?? -Infinity))[0]?.variantId ?? null;
    return {
      sampleId: sample.id,
      sizeWinner,
      browserReviewWinner,
      recommendedPipeline: browserReviewWinner
        ? `${browserReviewWinner} is the best current browser-visible review fixture candidate for this sample.`
        : "No variant cleared browser review fixture gates; keep original or debug decoder/attribute regressions.",
    };
  });
}

function buildGlobalRecommendation(results: VariantResult[]): string[] {
  const usableByVariant = new Map<string, VariantResult[]>();
  for (const result of results.filter((item) => item.usableAsBrowserReviewFixture)) {
    usableByVariant.set(result.variantId, [...(usableByVariant.get(result.variantId) ?? []), result]);
  }
  const ranked = [...usableByVariant.entries()]
    .map(([variantId, variantResults]) => ({
      variantId,
      count: variantResults.length,
      averageSavings: variantResults.reduce((sum, result) => sum + (result.percentSmaller ?? 0), 0) / variantResults.length,
    }))
    .sort((a, b) => b.count - a.count || b.averageSavings - a.averageSavings);
  return [
    ranked[0]
      ? `Current browser-visible winner: ${ranked[0].variantId} across ${ranked[0].count} sample(s), average savings ${round(ranked[0].averageSavings)}%.`
      : "No optimizer variant is broadly safe as a browser review fixture yet.",
    "For virtual patients, do not adopt quantization/Meshopt/Draco into WebXR runtime assets until Model Vetting Studio and UI-XR loader evidence both show visible skinned bodies, animations, and morph targets.",
    "For mobile VR, KTX2/BasisU remains the desired texture path when assets actually contain textures and local encoder/browser support is proven.",
  ];
}

function renderMarkdown(report: BenchmarkReport): string {
  const rows = report.results.map((result) => [
    result.sampleId,
    result.variantId,
    result.family,
    formatBytes(result.originalBytes),
    result.optimizedBytes === null ? "failed" : formatBytes(result.optimizedBytes),
    result.percentSmaller === null ? "-" : `${result.percentSmaller}%`,
    result.browserMetrics?.ok ? `${result.browserMetrics.loadMs}ms` : "failed",
    result.browserMetrics?.ok ? `${result.browserMetrics.drawCalls}` : "-",
    result.browserMetrics?.ok ? `${result.browserMetrics.triangles}` : "-",
    result.browserMetrics?.ok ? `${result.browserMetrics.averageFrameMs}ms` : "-",
    result.usableAsBrowserReviewFixture ? "yes" : "no",
    result.blockers.join(", "),
  ]);
  return `# OpenClinXR GLB Optimization Cagematch

Generated: ${report.generatedAt}

Claim boundary: local browser benchmark only. Not evidence for Quest, production, learner, clinical, scoring, or B+ readiness.

## Samples

| Sample | Category | Source | Notes |
| --- | --- | --- | --- |
${report.samples.map((sample) => `| ${sample.id} | ${sample.category} | \`${sample.sourcePath}\` | ${sample.notes} |`).join("\n")}

## Results

| Sample | Variant | Family | Original | Optimized | Smaller | Browser load | Draw calls | Triangles | Avg frame | Review usable | Blockers |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
${rows.map((row) => `| ${row.join(" | ")} |`).join("\n")}

## Winners

| Sample | Size winner | Browser review winner | Recommendation |
| --- | --- | --- | --- |
${report.winners.map((winner) => `| ${winner.sampleId} | ${winner.sizeWinner ?? "-"} | ${winner.browserReviewWinner ?? "-"} | ${winner.recommendedPipeline} |`).join("\n")}

## Recommendation

${report.globalRecommendation.map((item) => `- ${item}`).join("\n")}

## Not Evidence For

${report.notEvidenceFor.map((item) => `- ${item}`).join("\n")}
`;
}

async function startStaticServer(port: number): Promise<http.Server> {
  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    if (requestUrl.pathname === "/__openclinxr_glb_benchmark_viewer.html") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(viewerHtml());
      return;
    }
    const filePath = path.normalize(path.join(ROOT, decodeURIComponent(requestUrl.pathname)));
    if (!filePath.startsWith(ROOT)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    try {
      const stats = await stat(filePath);
      if (!stats.isFile()) throw new Error("not file");
      response.writeHead(200, { "content-type": contentType(filePath), "content-length": stats.size });
      createReadStream(filePath).pipe(response);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return server;
}

function run(command: string, args: string[], timeoutMs = 120_000): Promise<CommandResult> {
  const started = performance.now();
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: ROOT, env: process.env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        commandLine: [command, ...args].join(" "),
        elapsedMs: round(performance.now() - started),
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        error: code === 0 ? undefined : `exit_${code}`,
      });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        commandLine: [command, ...args].join(" "),
        elapsedMs: round(performance.now() - started),
        stdout,
        stderr,
        error: error.message,
      });
    });
  });
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".js")) return "text/javascript";
  if (filePath.endsWith(".wasm")) return "application/wasm";
  if (filePath.endsWith(".glb")) return "model/gltf-binary";
  if (filePath.endsWith(".json")) return "application/json";
  if (filePath.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

function formatBytes(bytes: number): string {
  if (bytes > 1024 * 1024) return `${round(bytes / 1024 / 1024)} MB`;
  if (bytes > 1024) return `${round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

declare global {
  interface Window {
    openClinXrRunGlbBenchmark(assetUrl: string): Promise<BrowserMetrics>;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
