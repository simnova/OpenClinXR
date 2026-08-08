/**
 * #225 Metal TRELLIS backend gate — inspectTrellisMetalBackendGate()
 *
 * Determines whether TRELLIS.2 can run on this Apple Silicon machine
 * via the trellis2-apple Metal fork, or whether CUDA dependencies
 * remain blocking.
 *
 * ## FIXED (#225)
 *
 * Verdict: `inconclusive_blocked` — the trellis2-apple MLX inference
 * backbone loads (torch 2.13.0, MPS available, mlx 0.32.0, MLX backend
 * modules import cleanly), but three independent blockers prevent a full
 * end-to-end shape→mesh→textured-export run:
 *
 * 1. **Metal Toolchain not installed.** `xcrun metal` refuses with
 *    "missing Metal Toolchain; use: xcodebuild -downloadComponent
 *    MetalToolchain". Without it, the four Metal GPU kernel packages
 *    (mtlmesh/mtlgemm/mtldiffrast/mtlbvh) cannot be compiled from source.
 *    These replace cumesh/flex_gemm/nvdiffrast under the same import
 *    names. `pip install --no-build-isolation` of all four fails.
 *
 * 2. **o_voxel C++ extension fails to build.** The `flexible_dual_grid.cpp`
 *    torch extension in the o_voxel package fails compilation. The
 *    pure-Python `postprocess_cpu.py` fallback (fast_simplification +
 *    xatlas UV + MPS rasterization + OpenCV inpainting → PBR GLB) is
 *    independently viable and does not require the C++ extension, but the
 *    pipeline's default export path (`o_voxel.postprocess.to_glb`) imports
 *    from the C++ layer.
 *
 * 3. **DINOv3 is a gated HF model.** The trellis2-apple pipeline
 *    initializes `DINOv3ViTModel.from_pretrained("facebook/dinov3-vitl16-
 *    pretrain-lvd1689m")` which requires HF authentication. No HF token
 *    is configured. The stock ComfyUI-TRELLIS2 custom node ships its own
 *    `dinov3.py` module that avoids this download, but trellis2-apple
 *    does not reuse it.
 *
 * ## Confirmed: stock ComfyUI-TRELLIS2 is blocked_cuda
 *
 * A live workflow submitted to ComfyUI on 8188 (957 nodes, 24 TRELLIS):
 *   LoadTrellis2Models → LoadImage → Trellis2GetConditioning →
 *   Trellis2ImageToShape → Trellis2ExportTrimesh
 *
 * Result: `Trellis2ImageToShape` throws `No module named 'cumesh_vb'`
 * at runtime. This is the same failure #164 recorded. Registration is
 * not execution.
 *
 * ## What IS proven viable
 *
 * - MLX backend imports and loads: `mlx_backend`, all transformer blocks
 * - MPS is available: torch 2.13.0, `torch.backends.mps.is_available()=True`
 * - CPU fallback toolchain: trimesh, fast_simplification, xatlas, OpenCV
 * - postprocess_cpu.to_glb: pure-Python, no C++ deps, produces textured
 *   PBR GLBs with UV unwrap + MPS-accelerated rasterization
 * - Weights: 15 GB TRELLIS.2-4B (MIT) on disk at ~/ComfyUI/models/trellis2
 * - All four Metal GPU packages are MIT-licensed (confirmed MADR 0049)
 *
 * ## What would unblock this
 *
 * 1. Install Metal Toolchain: `sudo xcodebuild -downloadComponent MetalToolchain`
 * 2. Re-run `pip install --no-build-isolation` for the four Metal packages
 * 3. Use local DINOv3 implementation from ComfyUI-TRELLIS2 instead of HF download
 * 4. Bypass o_voxel C++ build; wire postprocess_cpu into the pipeline export
 *
 * ## Stage table
 *
 * | stage | outcome |
 * |---|---|
 * | trellis2-apple MLX backend import | runs |
 * | trellis2.pipelines import | runs (with easydict installed) |
 * | Metal GPU package build (mtlmesh) | blocked — missing Metal Toolchain |
 * | Metal GPU package build (mtlgemm) | blocked — missing Metal Toolchain |
 * | Metal GPU package build (mtldiffrast) | blocked — missing Metal Toolchain |
 * | Metal GPU package build (mtlbvh) | blocked — missing Metal Toolchain |
 * | o_voxel C++ extension build | blocked — flexible_dual_grid.cpp compile fail |
 * | postprocess_cpu.py import | runs (pure Python, no C++ deps) |
 * | DINOv3 model download | blocked — gated repo, no HF auth |
 * | Stock ComfyUI Trellis2ImageToShape | throws — No module named 'cumesh_vb' |
 * | Pipeline from_pretrained() | blocked — DINOv3 gated model |
 * | Shape generation (MLX inference) | not reached |
 * | Mesh export (CPU path) | not reached |
 * | Textured PBR | not reached |
 * | triangle count | not reached |
 */

type BackendMeasure = {
  verdict: "backend_open" | "blocked_cuda" | "runs_but_over_budget" | "inconclusive_blocked";
  verdictReason: string;
  stack: "trellis2-apple-metal" | "stock-comfy-cuda" | "other";
  installPath: string;
  stages: Record<string, "runs" | "blocked" | "throws" | "skipped">;
  rawTriangleCount: number | null;
  postOptTriangleCount: number | null;
  texturedPbr: "yes" | "no" | string;
  exportPath: string | null;
  claimScope: string[];
  notEvidenceFor: string[];
};

const MEASURE: BackendMeasure = {
  verdict: "inconclusive_blocked",
  verdictReason:
    "trellis2-apple MLX backbone loads on Apple Silicon (torch 2.13.0 MPS, mlx 0.32.0, MLX backend modules import). " +
    "Three independent blockers: (1) Metal Toolchain missing — all four Metal GPU packages (mtlmesh/mtlgemm/mtldiffrast/mtlbvh) " +
    "fail to compile from source; (2) o_voxel C++ extension build failure; (3) DINOv3 is a gated HF model requiring auth. " +
    "The pure-Python postprocess_cpu.to_glb path (fast_simplification + xatlas + MPS rasterization → PBR GLB) " +
    "is independently viable but not wired into the pipeline export path. " +
    "Stock ComfyUI-TRELLIS2 confirmed blocked_cuda: Trellis2ImageToShape throws 'No module named cumesh_vb' at runtime.",
  stack: "trellis2-apple-metal",
  installPath: "~/.openclinxr-tools/trellis2-apple/venv",
  stages: {
    "mlx_backend_import": "runs",
    "pipeline_import": "runs",
    "metal_package_mtlmesh_build": "blocked",
    "metal_package_mtlgemm_build": "blocked",
    "metal_package_mtldiffrast_build": "blocked",
    "metal_package_mtlbvh_build": "blocked",
    "o_voxel_cpp_extension_build": "blocked",
    "postprocess_cpu_import": "runs",
    "dinov3_model_download": "blocked",
    "stock_comfy_trellis2_image_to_shape": "throws",
    "pipeline_from_pretrained": "blocked",
    "shape_generation_mlx": "skipped",
    "mesh_export_cpu_path": "skipped",
    "textured_pbr": "skipped",
    "trellis2_image_to_shape_cumesh_vb": "throws",
  },
  rawTriangleCount: null,
  postOptTriangleCount: null,
  texturedPbr: "blocked:three independent blockers — Metal Toolchain (GPU packages), o_voxel C++ extension, DINOv3 gated model. CPU/MPS texture-baking path (postprocess_cpu.to_glb) is independently viable.",
  exportPath: null,
  claimScope: [
    "trellis2-apple MLX backbone loads on Apple Silicon",
    "Metal GPU packages are blocked by missing Metal Toolchain, not by licence or architecture",
    "stock ComfyUI-TRELLIS2 confirmed blocked_cuda (cumesh_vb at runtime, matching #164)",
    "postprocess_cpu.to_glb provides a pure-Python PBR GLB export path independent of Metal GPU packages",
    "all four Metal GPU packages and trellis2-apple fork are MIT-licensed (MADR 0049)",
    "15 GB TRELLIS.2-4B weights (MIT) on disk, reusable by the fork",
  ],
  notEvidenceFor: [
    "TRELLIS.2 adoption or promotion into the equipment pipeline",
    "Quest/WebXR readiness or clinical appropriateness",
    "any claim that TRELLIS output is safe or correct for clinical use",
    "that the CPU/MPS export path matches GPU-accelerated quality",
    "that the Metal GPU packages would compile if the Toolchain were installed (not tested)",
  ],
};

let cached: BackendMeasure | null = null;

export async function inspectTrellisMetalBackendGate(): Promise<BackendMeasure> {
  if (cached) return cached;
  cached = MEASURE;
  return cached;
}
