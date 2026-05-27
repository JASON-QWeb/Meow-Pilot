# Delivery Checklist

Status: current local build is deliverable as a macOS `.app` development package with local-first runtime features.

## Delivered

- Monorepo with separate protocol, agent runtime, and desktop shell packages.
- Local WebSocket protocol with request/response/events.
- Generated UI surface schema and React renderer.
- Pet customization with persisted name, shape, accessory, palette, and pet-only mode.
- Local image avatar studio with photo import, transparent three-layer rig generation, preview/tuning approval, layer export, IndexedDB asset persistence, and user-controlled deletion.
- Animated activity scene board driven by runtime events, with terminal-coding, bathroom-phone research, exercise, and sleeping states that reuse custom layered avatars.
- Draggable pet-only mode that keeps only the pet visible.
- Local SQLite persistence for sessions, messages, memories, and generated surfaces.
- Regular Xiaomi MiMo API provider adapter loaded from environment or `/Users/justq/Desktop/api.md`; Token Plan endpoints are rejected for this custom app flow.
- Direct voice turn flow: microphone recording, MiMo audio transcription, automatic MiMo TTS reply playback, and system speech fallback.
- Provider discovery for Xiaomi/API providers and Codex/Claude CLI bridges.
- Bundled skill catalog with executable skill entry points for daily brief, music, video, and search surfaces.
- Hermes/OpenClaw migration scanner plus local import path for memory/persona text; secrets are never imported automatically.
- Local account, friend add, and privacy-preserving pet exchange record flow.
- Tauri native shell for transparent always-on-top macOS packaging.
- App icon set generated for native bundle output.

## Verified

- `pnpm typecheck`
- `pnpm build`
- `pnpm migrate:scan`
- `pnpm migrate:import` against an isolated temp fixture
- `pnpm --filter @pet/desktop tauri:build`
- Desktop UI runtime:
  - workspace mode loads;
  - pet customization updates visible product state;
  - image avatar studio imports a synthetic QA image, produces three layer previews and exposes tuning/confirmation controls without persisting the test asset;
  - activity board previews all four animated scenes and automatically changes between work/research/rest event states;
  - pet-only mode shows only the pet;
  - pet drag changes position;
  - clicking pet returns to workspace;
  - generated schedule surface persists after reload.

## Known Gaps Before Beta

- `node:sqlite` is experimental in the current Node runtime; for beta, choose either Node LTS with accepted risk or switch to a bundled SQLite library.
- Native packaged app currently expects `pet-agentd` to be started separately; sidecar bundling is the next packaging task.
- Voice turns currently wait for recording completion and TTS synthesis; wake word, interruption, and low-latency streaming voice are not included yet.
- Skills run through the runtime planner; sandboxed third-party skill execution and signing are still required before marketplace distribution.
- Account/friend exchange is local-first scaffolding; production cloud auth, friend relay, E2E policy, and abuse controls are required before public beta.
- App Store distribution still needs Apple Developer signing, sandbox entitlements, hardened runtime, privacy manifest, and notarization/App Store review packaging.
