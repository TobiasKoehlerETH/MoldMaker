# MoldMaker Repository Guide

## Architecture

- `src-tauri`: trusted Rust/Tauri process; owns windows, dialogs, filesystem access, and commands.
- `src/renderer`: React UI running in Tauri’s WebView; native operations go through the typed adapter.
- `src/shared`: versionable native request schemas and cross-process types.

Keep the app offline-first. Add privileged capabilities as a shared contract, validated Rust command, and narrow renderer adapter. Never expose filesystem modules, absolute write access, or arbitrary native commands to the renderer.

## Commands

- `npm run check`: required before handoff; runs typecheck, lint, tests, and production build.
- `npm run dev`: local Tauri development.
- `npm run dist:win`: verified Windows NSIS package build.
- Release builds require the Tauri signing private key through the environment; never commit it.

Use `apply_patch` for authored edits. Preserve the model-dominant workspace and minimal-text/Lucide interaction style.
