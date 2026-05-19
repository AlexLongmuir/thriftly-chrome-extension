import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

function copyExtensionAssets() {
  return {
    name: "copy-extension-assets",
    buildStart() {
      rmSync("dist", { recursive: true, force: true });
    },
    closeBundle() {
      mkdirSync("dist", { recursive: true });
      copyFileSync("src/manifest.json", "dist/manifest.json");
      mkdirSync("dist/assets", { recursive: true });
      copyFileSync("public/icon.svg", "dist/assets/icon.svg");
    }
  };
}

export default defineConfig({
  plugins: [react(), copyExtensionAssets()],
  build: {
    outDir: "dist",
    emptyOutDir: false,
    rollupOptions: {
      input: {
        panel: resolve(__dirname, "panel.html"),
        background: resolve(__dirname, "src/background.ts"),
        contentScript: resolve(__dirname, "src/contentScript.ts")
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});
