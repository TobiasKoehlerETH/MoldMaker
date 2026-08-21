# MoldMaker architecture

MoldMaker is an offline Electron desktop application for creating molds from STEP files. The application is currently in the CAD foundation phase: it can open a STEP file, track the imported file in the UI, and expose validated native file operations, while the 3D viewport and mold-generation workflow are still placeholders.

## Runtime boundaries

```text
Electron main process
  └─ src/main/index.ts        window lifecycle and security policy
  └─ src/main/files.ts        native dialogs and filesystem operations
          ▲
          │ IPC channels and shared Zod contracts
          │
  src/preload/index.ts        contextBridge; the only renderer-to-native bridge
          ▲
          │ window.moldMaker
          │
React renderer
  └─ src/renderer/src/App.tsx application shell and user actions
  └─ src/renderer/src/store/app-store.ts UI state
  └─ src/renderer/src/components/ui/* reusable controls
```

The renderer runs without Node integration. The preload layer exposes the typed `MoldMakerApi` from `src/shared/electron-api.ts`; native operations are handled in the main process. Keep this boundary intact when adding capabilities.

## Important modules

| Area | File | Responsibility |
| --- | --- | --- |
| Main process | `src/main/index.ts` | Creates the BrowserWindow, applies navigation/permission restrictions, and registers IPC handlers. |
| Native files | `src/main/files.ts` | Opens STEP/project files, saves projects, exports generated files, and converts failures into `NativeResult` values. |
| Preload | `src/preload/index.ts` | Exposes the minimal `window.moldMaker` API through `contextBridge`. |
| Shared contract | `src/shared/electron-api.ts` | Defines IPC channel names, request validation, response types, and the renderer-facing API. |
| Renderer shell | `src/renderer/src/App.tsx` | Builds the command bar, tool rail, viewport placeholder, inspector, and import interaction. |
| Renderer state | `src/renderer/src/store/app-store.ts` | Stores the imported filename and user-visible status. |
| UI primitives | `src/renderer/src/components/ui/*` | Shared button and tooltip components. |
| Tests | `tests/electron-api.test.ts` | Verifies project payload validation and export filename safety. |

## Current flows

### Open STEP

1. `App.openStep()` sets the status to `Opening…`.
2. The renderer calls `window.moldMaker.openStepFile()`.
3. Preload invokes the `files:open-step` channel.
4. `src/main/files.ts` opens an OS file dialog restricted to `.step` and `.stp`, then reads the selected bytes.
5. The renderer stores the filename and shows `STEP loaded`; cancellation returns to `Ready`.

### Save project and export files

The native handlers already exist, but the current shell does not yet wire buttons to them. Both inputs are validated with Zod before any dialog or write occurs. Filenames reject traversal, invalid Windows characters, control characters, trailing periods/spaces, and duplicate export names (case-insensitive).

## Tooling

Run the normal quality gate with:

```bash
npm run check
```

Generate the dependency graph and refresh the checked-in documentation artifacts with:

```bash
npm run codegraph
```

The graph is generated from `src/` using Madge and TypeScript resolution. The generated files are:

- `docs/code-graph/dependencies.json` — machine-readable module dependency data and circular-dependency results.
- `docs/code-graph/dependencies.mmd` — Mermaid flowchart that can be rendered in Mermaid-compatible viewers.

The graph intentionally excludes `node_modules`, `out`, `release`, tests, and sample assets by starting at `src/`. Re-run it after moving modules or changing imports.

## Build configuration

- `electron.vite.config.ts` defines separate main, preload, and renderer bundles and the `@/` renderer alias.
- `tsconfig.node.json` type-checks Electron/config/test code.
- `tsconfig.web.json` type-checks the React renderer and shared contracts.
- `vitest.config.ts` runs Node-environment tests under `tests/`.
- `eslint.config.mjs` applies Node and browser globals to their respective boundaries.

## Near-term extension points

The next major feature seams are the STEP parser/geometry service, a renderer-side model/view state, project serialization, and actual mold-generation/export commands. New native work should add a shared contract first, then a preload method, then a main-process handler, with renderer behavior and tests layered on top.
