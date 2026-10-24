import { mountCapacityLab } from "./lab.js";
const root = document.getElementById("app");
if (!root) throw new Error("Capacity lab requires an #app element");
document.title = "Capacity lab · OpenClinXR";
const lab = mountCapacityLab(root);
window.addEventListener("pagehide", () => lab.dispose(), { once: true });
