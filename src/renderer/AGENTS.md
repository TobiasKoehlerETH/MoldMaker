# Renderer

This is an untrusted web surface.

- Use React, Tailwind, shadcn primitives, Zustand, and Lucide; do not import Node.js or Electron.
- Access native operations only through typed `window.moldMaker` methods.
- Keep the Three.js/model viewport dominant; inspectors should overlay or collapse instead of consuming the canvas.
- Prefer icons, tooltips, direct manipulation, and short labels over explanatory UI text.
- Preserve keyboard focus, accessible names, and system light/dark behavior.
