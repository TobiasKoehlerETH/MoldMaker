# MoldMaker architecture

MoldMaker is an offline Electron desktop application that turns a STEP part into
a printable two-part casting mold. Importing a STEP file produces a cavity block
split into a base and a top half, with an injection gate, air vents, and
clamping screw holes, previewed in 3D and exported as STEP and STL for each half.

Everything runs locally. There are no network calls at runtime, and the CAD
kernel ships as a WebAssembly bundle inside the app.

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
  └─ src/renderer/src/App.tsx           application shell and user actions
  └─ src/renderer/src/components/*      viewport and settings sidebar
  └─ src/renderer/src/viewport/modes.ts view state model
  └─ src/renderer/src/cad.ts            request/response bridge to the worker
          ▲
          │ postMessage with transferable buffers
          │
  src/renderer/src/cad-worker.ts        OpenCascade solid modelling, off the UI thread
```

The renderer runs without Node integration. The preload layer exposes the typed
`MoldMakerApi` from `src/shared/electron-api.ts`; native operations are handled
in the main process. Keep this boundary intact when adding capabilities.

Solid modelling runs in a web worker because building the mold takes seconds and
would otherwise freeze the UI. The worker owns the only OpenCascade instance.

## Important modules

| Area | File | Responsibility |
| --- | --- | --- |
| Main process | `src/main/index.ts` | Creates the BrowserWindow, applies navigation/permission restrictions, and registers IPC handlers. |
| Native files | `src/main/files.ts` | Opens STEP/project files, saves projects, exports generated files, and converts failures into `NativeResult` values. |
| Preload | `src/preload/index.ts` | Exposes the minimal `window.moldMaker` API through `contextBridge`. |
| Native contract | `src/shared/electron-api.ts` | IPC channel names, request validation, response types, and the renderer-facing API. |
| STEP reader | `src/shared/step.ts` | Minimal ISO 10303-21 parser; tessellates edge curves and reports bounds and cylindrical bores. |
| Mold plan | `src/shared/mold.ts` | Parameter schema and the fast preview plan: split axis, wall, gate, vents, and screw holes. |
| CAD contract | `src/shared/cad.ts` | Worker request/response types, including the preview meshes. |
| Project file | `src/shared/project.ts` | `.moldmaker` serialisation; embeds the STEP source so a project reopens standalone. |
| Vector maths | `src/shared/vec3.ts` | Shared vector helpers, bounding boxes, and planar distance. |
| CAD worker | `src/renderer/src/cad-worker.ts` | Builds the real solids with OpenCascade and emits STEP/STL blobs plus display meshes. |
| Worker bridge | `src/renderer/src/cad.ts` | Correlates worker requests and replies by id. |
| Renderer shell | `src/renderer/src/App.tsx` | Command bar, tool rail, generation lifecycle, and native actions. |
| Viewport | `src/renderer/src/components/viewport.tsx` | three.js scene, orbit camera, shading, explode, and click selection. |
| Settings sidebar | `src/renderer/src/components/inspector.tsx` | Collapsible left panel with mold parameters and view controls. |
| View model | `src/renderer/src/viewport/modes.ts` | Per-body visibility, shading presets, and explode state. |

## Flows

### Import a STEP file

1. `App.importStep()` calls `window.moldMaker.openStepFile()`.
2. `src/main/files.ts` opens an OS dialog restricted to `.step` and `.stp` and
   reads the bytes.
3. The renderer decodes the text, parses it with `readStepModel`, and stores the
   part, its source, and the default mold parameters.

### Generate the mold

Changing a parameter schedules a rebuild after a 250 ms debounce. The renderer
sends the STEP source and parameters to the CAD worker, which imports the solid,
orients the split axis to Z, applies shrinkage, cuts the cavity out of two boxes,
adds clamping screw holes and flow channels, then returns four export blobs and
three display meshes. `src/shared/mold.ts` computes the same plan cheaply for the
wireframe preview, so both use one set of rules via `flowPorts` and
`screwPoints`.

### Save, reopen, and export

Projects embed the STEP source, so reopening a `.moldmaker` file restores the
part and its parameters without the original CAD file. Export writes
`<name>-mold-lower.step`, `-upper.step`, `-lower.stl`, and `-upper.stl` into a
chosen directory. All inputs are validated with Zod before any dialog or write,
and filenames reject traversal, invalid Windows characters, control characters,
trailing periods or spaces, and duplicate names.

## Viewing the mold

View state lives in `viewport/modes.ts`. Each body — the cast part, the base
half, and the top half — carries its own visibility of `solid`, `ghost`, or
`hidden`. Four presets set all three at once; clicking a body in the viewport, or
its row in the sidebar, cycles that one body. The explode slider separates the
halves along the split axis by a fraction of the mold height. Hidden bodies are
left out of the scene entirely, so they are neither drawn nor clickable.

## Tooling

```bash
npm run check      # typecheck, lint, unit tests, production build
npm run dev        # local Electron development
npm run test:e2e   # Playwright drives the packaged app and writes feedback
npm run codegraph  # regenerate the ignored docs/code-graph/* files
```

Unit tests under `tests/` cover the STEP reader, the mold plan, the project file,
and the native contracts. The Playwright suite in `tests/e2e/` launches the real
Electron build, substitutes native dialog answers from the main process, and
captures screenshots.

## Build configuration

- `electron.vite.config.ts` defines separate main, preload, and renderer bundles
  and the `@/` renderer alias. The preload bundles its dependencies because
  sandboxed preload scripts cannot resolve Node's module loader.
- `tsconfig.node.json` type-checks Electron, config, and test code.
- `tsconfig.web.json` type-checks the React renderer and shared contracts.
- `vitest.config.ts` runs Node-environment tests under `tests/`.
- `playwright.config.ts` runs the Electron end-to-end suite.
