# Preload Bridge

Keep this file declarative and sandbox-compatible.

- Expose task-specific functions through `contextBridge`; never expose raw `ipcRenderer`.
- Use channel constants and types from `src/shared/electron-api.ts`.
- Do not add filesystem, shell, network, or process APIs to `window.moldMaker`.
- Mirror each addition with a validated main-process handler.
