import "antd/dist/reset.css";
import { ConfigProvider } from "antd";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { FactoryStationCards } from "./FactoryStationCards.js";
import "./styles.css";

const root = document.querySelector("#root");
if (!root) {
  throw new Error("Missing #root");
}

createRoot(root).render(
  <StrictMode>
    <ConfigProvider>
      <main
        className="factory-station-shot"
        style={{ background: "#f5f5f5", padding: 16, minHeight: "100vh", maxWidth: 720 }}
      >
        <style>{`
          .factory-station-shot .station-queue-row {
            display: flex;
            flex-direction: column;
            align-items: stretch;
            gap: 12px;
            grid-template-columns: none;
          }
        `}</style>
        <FactoryStationCards
          values={{
            body_param: {
              actorId: "patient_maya_johnson_v1",
              ageYears: 8,
              sex: "female",
              heightCm: 128,
              garmentLayers: "short_sleeve_exam_tshirt",
            },
            clothing_generate: {
              actorId: "patient_maya_johnson_v1",
              garmentToken: "short_sleeve_exam_tshirt",
            },
            equipment_generate: {
              subjectId: "ecg-cart-imagine-box",
              packId: "ecg-cart-imagine-box",
              seed: 7,
              remesh: true,
              viewCount: 4,
              decimationTarget: 80000,
            },
            room_generate: {
              environmentId: "ed_bay_v1",
              infinigenPrompt: "ED bay, hard-surface, no logos",
              seed: 11,
              layoutVariant: "single_bay",
            },
          }}
        />
      </main>
    </ConfigProvider>
  </StrictMode>,
);
