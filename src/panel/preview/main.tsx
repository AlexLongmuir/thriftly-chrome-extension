import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../App";
import { installPreviewHarness } from "./harness";
import "../fonts";
import "../styles.css";

installPreviewHarness();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
