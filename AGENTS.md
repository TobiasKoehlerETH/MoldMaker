# MoldMaker Repository Guide

## Architecture

- `src/main`: trusted Electron process; owns windows, dialogs, filesystem access, and IPC handlers.
- `src/preload`: sandbox-compatible bridge; exposes only the typed `window.moldMaker` API.
- `src/renderer`: untrusted React UI; never import Node.js or Electron here.
- `src/shared`: versionable IPC contracts, Zod boundary schemas, and cross-process types.

Keep the app offline-first. Add privileged capabilities as a shared contract, validated main-process handler, and narrow preload wrapper. Never expose `ipcRenderer`, filesystem modules, absolute write access, or arbitrary channel names to the renderer.

## Commands

- `npm run check`: required before handoff; runs typecheck, lint, tests, and production build.
- `npm run dev`: local Electron development.
- `npm run dist:win`: verified Windows NSIS package build.

Use `apply_patch` for authored edits. Preserve the model-dominant workspace and minimal-text/Lucide interaction style.
