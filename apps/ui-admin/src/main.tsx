import "antd/dist/reset.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AdminApp } from "./App.js";
import "./styles.css";

const root = document.querySelector("#root");
if (!root) {
  throw new Error("Missing #root");
}

createRoot(root).render(
  <StrictMode>
    <AdminApp router="browser" />
  </StrictMode>,
);
