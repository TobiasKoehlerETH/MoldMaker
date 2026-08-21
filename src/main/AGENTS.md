# Main Process

This is the only privileged application layer.

- Keep `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, and `webSecurity: true`.
- Deny unneeded permissions, navigation, and new windows.
- Validate every renderer payload with the shared Zod schemas before filesystem or OS access.
- Return typed, serializable results instead of leaking raw Electron errors or objects.
- Constrain writes to user-selected paths and validated file names.
