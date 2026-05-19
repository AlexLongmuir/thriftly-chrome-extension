import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { build as buildWithEsbuild } from "esbuild";
import { defineConfig } from "vite";

function copyExtensionAssets() {
  return {
    name: "copy-extension-assets",
    apply: "build" as const,
    buildStart() {
      rmSync("dist", { recursive: true, force: true });
    },
    async closeBundle() {
      mkdirSync("dist", { recursive: true });
      copyFileSync("src/manifest.json", "dist/manifest.json");
      mkdirSync("dist/assets", { recursive: true });
      copyFileSync("public/icon.svg", "dist/assets/icon.svg");
      await buildWithEsbuild({
        entryPoints: ["src/contentScript.ts"],
        bundle: true,
        format: "iife",
        outfile: "dist/contentScript.js",
        target: "chrome116"
      });
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
        background: resolve(__dirname, "src/background.ts")
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});
