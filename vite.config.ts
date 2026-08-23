import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/renderer",
  resolve: {
    alias: {
      "@": resolve("src/renderer/src")
    }
  },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../../out/renderer",
    emptyOutDir: true
  },
  server: {
    port: 1420,
    strictPort: true
  }
});
