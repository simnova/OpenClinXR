import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CompileGraphCanvas, type CompileEdge } from "./CompileGraphCanvas.js";
import "./styles.css";

/** Fixture of skip-capable bakers only (body → wardrobe → equipment). */
const SHOT_EDGES: CompileEdge[] = [
  { from: "actor:patient_maya_johnson_v1:body", to: "actor:patient_maya_johnson_v1:wardrobe", kind: "body_to_clothing" },
  { from: "actor:parent_tara_johnson_v1:body", to: "actor:parent_tara_johnson_v1:wardrobe", kind: "body_to_clothing" },
  { from: "actor:patient_maya_johnson_v1:wardrobe", to: "equip:pulse_oximeter_equipment", kind: "wardrobe_to_equipment" },
  { from: "actor:patient_maya_johnson_v1:wardrobe", to: "equip:nebulizer_equipment", kind: "wardrobe_to_equipment" },
];

const root = document.querySelector("#root");
if (!root) {
  throw new Error("Missing #root");
}

createRoot(root).render(
  <StrictMode>
    <main className="compile-graph-shot" style={{ background: "#0a0a0a", color: "#ddd", padding: 16, minHeight: "100vh" }}>
      <h1 style={{ fontFamily: "system-ui", fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>
        OpenClinXR World Compile Graph
      </h1>
      <p style={{ fontFamily: "system-ui", fontSize: 13, color: "#888", margin: "0 0 16px" }}>
        Read-only baker DAG (Body → Wardrobe → Equipment). Faculty lock Table stays the write path — no wires.
      </p>
      <CompileGraphCanvas compileEdges={SHOT_EDGES} />
    </main>
  </StrictMode>,
);
