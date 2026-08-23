# Renderer

This is an untrusted web surface.

- Use React, Tailwind, shadcn primitives, Zustand, and Lucide; do not import Node.js or Electron.
- Access native operations only through the typed `moldMaker` adapter in `src/renderer/src/native-api.ts`.
- The update icon is rendered only when the signed Tauri updater reports a newer release; installation must use the updater plugin and relaunch the app after success.
- Keep the Three.js/model viewport dominant; inspectors should overlay or collapse instead of consuming the canvas.
- Prefer icons, tooltips, direct manipulation, and short labels over explanatory UI text.
- Preserve keyboard focus, accessible names, and system light/dark behavior.
