# ADR 0001: Modular Desktop Shell Boundaries

Date: 2026-05-21

## Decision

Keep the desktop product shell split into independent feature modules:

- `services/`: transport adapters, starting with the local `pet-agentd` WebSocket client.
- `hooks/`: state orchestration that binds services to UI.
- `features/pet/`: pet profile, customization, rendering, drag behavior, and Tauri window behavior.
- `features/chat/`: conversation-specific UI.
- `features/surfaces/`: generated UI rendering from the shared `SurfaceSpec` schema.
- `features/runtime/`: account, friends, memory, skills, providers, exchange history, and permission panels.

The desktop shell must treat `pet-agentd` as a separate runtime, not as an implementation detail of React. Tauri should wrap the same frontend and bridge to the same runtime protocol.

## Context

The product needs to grow into a real desktop app with:

- a transparent draggable pet-only mode;
- a full chat/workbench mode;
- generated UI windows;
- user-customized pet appearance;
- local memory, skills, providers, and cloud/friend systems.

Putting all of that into one app component makes it hard to evolve the web shell inside Tauri, add native windows, or test generated UI safely.

## Consequences

- New runtime capabilities should first extend `@pet/protocol`.
- New UI surface components should live in `features/surfaces/` and consume schema, not model-specific text.
- Native desktop concerns should be isolated behind service/feature boundaries rather than threaded through chat components.
- Pet-only behavior is a first-class shell mode, so the product can ship as an always-on desktop companion instead of only a chat app.
