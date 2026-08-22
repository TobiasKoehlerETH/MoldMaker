import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

export default defineConfig({
  main: {
    // Bundle main-process validation code so the packaged app has no
    // production node_modules tree to ship alongside the asar.
    build: {
      externalizeDeps: false
    }
  },
  preload: {
    // Sandboxed preload scripts cannot resolve Node's module loader. Bundle
    // shared runtime dependencies (such as the IPC contract's zod import)
    // into the preload instead of leaving them as external requires.
    build: {
      externalizeDeps: false
    }
  },
  renderer: {
    resolve: {
      alias: {
        "@": resolve("src/renderer/src")
      }
    },
    plugins: [react(), tailwindcss()]
  }
});
