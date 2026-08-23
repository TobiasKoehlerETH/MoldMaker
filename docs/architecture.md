# MoldMaker architecture

MoldMaker is an offline-first React application packaged by Tauri. The web
layer owns the workspace, STEP preview parsing, OpenCascade WebAssembly worker,
and Three.js viewport. Rust owns only privileged desktop operations.

## Runtime boundaries

```text
Tauri window (Rust + system WebView)
  ├─ React renderer
  │   ├─ Zustand workspace state
  │   ├─ Three.js viewport
  │   ├─ OpenCascade Web Worker
  │   └─ native-api.ts ── invoke ──┐
  └─ Rust commands                  │
      ├─ native file dialogs       │
      ├─ validated file I/O ◄───────┘
      ├─ persisted dialog directory
      ├─ app metadata
      └─ signed updater plugin
```

The renderer never receives filesystem modules or arbitrary command access.
Rust validates filenames and duplicate exports again at the privileged
boundary. The Tauri dialog plugin supplies native open, save, and folder
pickers; selected paths are the only locations Rust reads or writes.

## Important modules

| Area | File | Responsibility |
| --- | --- | --- |
| Tauri runtime | `src-tauri/src/lib.rs` | Window commands, dialogs, filesystem access, and validation. |
| Updater | `src-tauri/tauri.conf.json`, `src/renderer/src/App.tsx` | Checks the GitHub release feed and installs signed updates. |
| Renderer adapter | `src/renderer/src/native-api.ts` | Typed command names and byte-array normalization. |
| Native contract | `src/shared/native-api.ts` | Zod request schemas and serializable response types. |
| STEP reader | `src/shared/step.ts` | Minimal ISO 10303-21 parser and preview bounds. |
| Mold plan | `src/shared/mold.ts` | Parameters and the fast wireframe plan. |
| CAD worker | `src/renderer/src/cad-worker.ts` | OpenCascade solids, meshes, and STEP export. |
| Worker bridge | `src/renderer/src/cad.ts` | Correlates worker requests and replies by id. |
| Renderer shell | `src/renderer/src/App.tsx` | Command bar, tool rail, generation lifecycle, and native actions. |
| Viewport | `src/renderer/src/components/viewport.tsx` | Three.js scene, orbit camera, shading, explode, and selection. |

## Flows

### Import and generate

`App.importStep()` invokes the typed Tauri adapter. Rust opens a native dialog
restricted to STEP extensions, reads the selected bytes, and returns them as a
serializable result. The renderer parses the text, stores the part, and sends
the source and parameters to the CAD worker after the existing debounce. The
worker imports the solid, orients the split axis to Z, applies shrinkage, cuts
the cavity, adds screw holes and flow channels, and returns display meshes.

### Save and export

Projects embed the STEP source, so reopening a `.moldmaker` file restores the
part, mold parameters, and viewport settings without the original CAD file.
Projects are saved automatically before switching projects; the first automatic
save opens a file dialog to choose the project path. Closing the application uses
the native window close behavior so it always exits cleanly.
The Save as project action remains available when a separate copy is needed.
Rust validates names, writes the requested bytes, and remembers the last
directory in the Tauri app-data directory. The returned result keeps the
existing success/cancel/error shape used by the UI.

### Update

On startup the renderer checks the signed GitHub `latest.json` feed. When a
newer release is returned, it adds a download action beside Settings in the
left rail. Clicking the action downloads and verifies the signed NSIS updater
bundle, installs it, and relaunches the app. The signing public key is shipped
in `tauri.conf.json`; the private key is never committed and is provided only
through local or GitHub Actions secrets.

## Tooling

```bash
npm run check      # typecheck, lint, unit tests, production web build
npm run dev        # local Tauri development
npm run dist:win   # Windows NSIS installer
```

`vite.config.ts` builds the renderer into `out/renderer`. Tauri loads that
directory in production and serves Vite during development. The Tauri config
defines the window, content security policy, application identifier, icon, and
Windows NSIS bundle and signed updater artifacts. The OpenCascade WebAssembly
asset remains in the web bundle because it is the CAD kernel, not a desktop
runtime dependency.
