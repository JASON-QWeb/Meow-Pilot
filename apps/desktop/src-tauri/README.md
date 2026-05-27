# Native Desktop Shell

This directory is the Tauri wrapper for the desktop pet shell.

`pnpm --filter @pet/desktop tauri:build` builds the macOS `.app` bundle. The frontend and `pet-agentd` protocol are structured so the Tauri app can wrap the same Vite UI and later launch the agent runtime as a sidecar.

Planned native responsibilities:

- transparent always-on-top pet-only window;
- draggable window position backed by native window APIs;
- system tray/menu bar controls;
- microphone, notification, accessibility, and file permissions;
- Keychain access for provider credentials;
- signed auto-update channel for direct distribution.
