# GLB Optimization Cagematch

Local benchmark for OpenClinXR browser/WebXR GLB delivery candidates.

The harness copies representative source models into `benchmarks/glb-optimization/input/`, writes optimized assets under `benchmarks/glb-optimization/output/`, opens every result in a browser Three.js scene, and writes a Markdown report.

Generated inputs, outputs, and JSON reports are ignored. The source-controlled parts are the benchmark harness, helper scripts, and the latest Markdown summary when intentionally refreshed.

Run:

```sh
pnpm benchmark:glb-optimization
```

Or:

```sh
benchmarks/glb-optimization/optimize-glbs.sh
```

Current scope:

- glTF-Transform optimize variants: Meshopt, Draco, WebP, KTX2/Basis when local encoder support exists.
- gltfpack variants: Meshopt compression, texture compression/simplification.
- Blender: decimate + Draco export.
- Combination pass: gltfpack followed by glTF-Transform.

The report distinguishes browser review fixture usability from WebXR/runtime replacement. A variant can reduce size and still fail if it does not render in the browser.
