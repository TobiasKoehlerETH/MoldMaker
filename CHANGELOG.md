# Changelog

## [0.1.1] — 2026-08-28

- Replaced syringe-port coordinate fields with direct X/Y positioning sliders.
- Constrained the injection point so the complete syringe bore remains within
  the molded part, including after diameter changes and when loading projects.
- Made injection-point movement continuous instead of snapping between sampled
  model vertices.

## [0.1.0] — 2026-08-23

- Replaced Electron with a Rust/Tauri desktop runtime.
- Preserved STEP import, mold generation, 3D inspection, project save/open,
  and STEP export behavior.
- Added signed GitHub Release updates with an in-app download/install action.
- Reduced the Windows installer from roughly 101 MB to roughly 8 MB.
- Removed obsolete Electron runtime code, generated build artifacts, icon
  explorations, and the Electron-specific end-to-end harness.

[0.1.1]: https://github.com/TobiasKoehlerETH/MoldMaker/releases/tag/v0.1.1
[0.1.0]: https://github.com/TobiasKoehlerETH/MoldMaker/releases/tag/v0.1.0
