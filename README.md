# MoldMaker

MoldMaker turns a finished part's STEP file into a printable two-part RTV silicone injection mold. It runs locally in a small Rust/Tauri desktop shell: upload the part, inspect the automatically generated tool, then export both mold halves as STEP.

## Workflow

1. Select **Import STEP** and choose the finished part.
2. MoldMaker rotates the thinnest part axis onto the split direction, adds a shrinkage-compensated cavity, printable walls, four clamping screw holes, one syringe gate, and up to two air vents.
3. Inspect the exact OpenCascade result in the CAD viewport. Shading modes include solid, transparent, ghosted half, full edges, hidden cast part, and exploded view.
4. Select **Export mold**. The chosen directory receives `*-lower.step` and `*-upper.step`.

The defaults target a general RTV workflow: 6 mm lateral walls, 2 mm top clearance, 1 mm base clearance, a 3.2 mm syringe port, 0.8 mm vents, and 0.2% scale compensation. Confirm shrinkage against the silicone datasheet and inspect the split/gate placement before printing, especially for parts with deep undercuts.

## Desktop build

The UI and CAD worker are bundled with Vite. Native dialogs, file access, app metadata, installer packaging, and signed updates are provided by Tauri in `src-tauri`.

```bash
npm run dev
npm run dist:win
```

`npm run dist:win` requires `TAURI_SIGNING_PRIVATE_KEY` when updater artifacts
are enabled. Keep the private key outside the repository. The GitHub release
workflow uses the same key from repository secrets and publishes `latest.json`
alongside the signed NSIS update bundle.

When a newer GitHub release is available, MoldMaker shows a download icon in
the left rail. Selecting it downloads, verifies, installs, and relaunches the
application automatically.

## Testing

```bash
npm run check
cargo check --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

## Preview

![MoldMaker with a sample loaded](docs/images/sample-loaded.png)
