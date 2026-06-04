<p align="center">
  <img src="docs/demos/hero-pet-run.gif" alt="Meow Pilot desktop pet running preview" width="100%" />
</p>

<h1 align="center">🐾 Meow Pilot</h1>

<p align="center">
  <strong>Put an AI pet that can work, remember, and keep you company on your Mac desktop</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS-blue?style=flat-square&logo=apple" />
  <img src="https://img.shields.io/badge/Rust-000000?style=flat-square&logo=rust" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=node.js&logoColor=white" />
  <img src="https://img.shields.io/badge/pnpm-F69220?style=flat-square&logo=pnpm&logoColor=white" />
  <img src="https://img.shields.io/badge/local--first-private-green?style=flat-square" />
</p>

<p align="center">
  English · 中文
</p>

---

## Product Demos

<table>
<tr>
<td align="center" width="50%">

<img src="docs/demos/01-basic-dashboard.gif" alt="Basic dashboard, usage, memory, Skill, and settings switching" width="100%" />

**Home, model usage, memory, Skill, scheduled tasks, and more**

</td>
<td align="center" width="50%">

<img src="docs/demos/02-session-media-weather.gif" alt="Multi-session, local music, local video, and weather cards" width="100%" />

**Generative UI card interactions inside sessions**

</td>
</tr>
<tr>
<td align="center">

<img src="docs/demos/03-skill-exchange.gif" alt="Friend Skill exchange flow" width="100%" />

**Social: exchange Skills with real friends**

</td>
<td align="center">

<img src="docs/demos/04-pet-customization.gif" alt="Image studio switching Petdex characters and opening the custom image studio" width="100%" />

**Pet character selection and custom generation**

</td>
</tr>
<tr>
<td align="center" colspan="2">

<img src="docs/demos/05-pet-quick-actions.gif" alt="Desktop pet right-click quick menu, quick chat, usage, music, and video" width="620" />

**Quick actions from the pet right-click menu**

</td>
</tr>
</table>

---

## Covered Scenarios

| Scenario | Experience |
|:--|:--|
| **Quick chat** | Start from the desktop right-click menu, or open the multi-session workspace to continue chatting |
| **Play media** | Ask the pet to play music or videos |
| **Life cards** | Weather, plans, and reminders become small visual cards |
| **Long-term memory** | Preferences, personas, and daily details can keep accumulating locally |
| **Skill growth** | Exchange Skills with friends so the pet becomes more capable |
| **Character switching** | Preset characters and custom images can both become desktop companions |

---

## Quick Start

### Requirements

- macOS (Tauri desktop shell)
- Node.js ≥ 22
- pnpm ≥ 11
- Rust toolchain (Tauri build)

### Start Development Version

```bash
# Clone and install dependencies
pnpm install

# Start the native desktop app (recommended)
pnpm --filter @pet/desktop tauri:dev

# Debug Web UI + Agent Runtime only
pnpm dev
```

After launch, a transparent always-on-top desktop pet will appear. Click it to open the work window and start exploring!

### Package Release

```bash
# Build macOS .app
pnpm --filter @pet/desktop tauri:build

# Build DMG installer
pnpm --filter @pet/desktop tauri:build:dmg
```

Output path: `apps/desktop/src-tauri/target/release/bundle/macos/Pet Agent.app`

---

## Configuration

### Model API

We recommend setting this in the app under **Configuration → Model API**. Environment variables are also supported:

```bash
PET_AI_PROVIDER=openai          # deepseek / openai / anthropic / google / xai / openrouter
PET_AI_API_KEY=your-api-key
PET_AI_MODEL=gpt-4o-mini
PET_AI_BASE_URL=https://...     # optional
```

<details>
<summary> Supported provider-native variables</summary>

```bash
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GOOGLE_GENERATIVE_AI_API_KEY=...
XAI_API_KEY=...
DEEPSEEK_API_KEY=...
OPENROUTER_API_KEY=...
OPENAI_COMPATIBLE_API_KEY=...
OPENAI_COMPATIBLE_BASE_URL=https://your-endpoint/v1
```
</details>

### Voice Service

We recommend saving voice APIs in the app under **Configuration → Voice Model**. You can also use environment variables to connect supported voice services. Fill in the endpoint, model, and voice according to your provider:

```bash
# OpenAI or OpenAI-compatible STT/TTS voice endpoint (optional)
PET_AI_TRANSCRIPTION_API_KEY=...
PET_AI_TRANSCRIPTION_BASE_URL=https://your-stt-endpoint/v1
PET_AI_TRANSCRIPTION_MODEL=...
PET_AI_SPEECH_API_KEY=...
PET_AI_SPEECH_BASE_URL=https://your-tts-endpoint/v1
PET_AI_SPEECH_MODEL=...
PET_AI_SPEECH_VOICE=...
```

---

## Project Architecture

```
├── apps/desktop/              → React + Vite + Tauri desktop app
│   ├── src/features/          → Chat, pet, dashboard, A2UI Surface rendering
│   ├── src/services/          → WebSocket RPC client
│   └── src-tauri/             → Rust native shell & window management
├── packages/agent-runtime/    → Local Node.js Agent Runtime
│   ├── src/server.ts          → WebSocket RPC, event broadcast, task scheduling entrypoint
│   ├── src/kernel/            → ContextBuilder, AgentKernel, plan/tool/reflection orchestration
│   ├── src/tools/             → ToolRegistry, on-demand tool discovery, permissions and audit
│   ├── src/memory/            → Memory retrieval, explicit memories, session summary refresh
│   ├── src/skills/            → SKILL.md frontmatter scanning, search, and on-demand loading
│   ├── src/providers/         → AI SDK providers, voice, and multimodal adapters
│   ├── src/a2uiProtocol.ts    → A2UI envelope validation, conversion, and repair feedback
│   └── src/storage.ts         → SQLite, FTS5, vector index, audit, and runtime state
├── packages/protocol/         → Shared RPC, events, SurfaceSpec, A2UI, and tool types
└── skills/bundled/            → Built-in skill definitions
```

### Agent Runtime Capabilities

- Request flow: `chat.send` enters the Runtime, builds context, decides whether the task needs a Plan, streams the model, executes allowed tools, parses A2UI/Surface output, persists messages, and broadcasts events.
- Cost control: short Q&A can skip Plan and Reflection; complex work enables multi-step planning, tool calls, and final reflection.
- Tool orchestration: the model only sees core tools and task-relevant categories by default; it discovers more capabilities with `tool_search`, then receives only the allowed tool schemas.
- Safe execution: tools have concurrency limits, per-tool timeouts, compressed result backfill, permission approval, and audit records. File writes, deletes, moves, network access, installs, sudo, uploads, and process termination require user approval.
- Provider resilience: AI SDK providers support timeout, fallback, and short-term circuit breaking so a slow failing provider does not block every request.
- Memory and Skills: long-term memory uses SQLite FTS5 plus a local `memory_embeddings` vector index; session summaries refresh as conversations grow; Skills load frontmatter first and read full `SKILL.md` only when selected.

### A2UI Surface Overview

- When UI is useful, the model should call structured tools such as `surface_render` or `media_prepare`, or output an A2UI v0.10 envelope directly.
- The Runtime validates envelopes, component allowlists, and data model paths. Invalid UI is sent back for repair instead of being rendered.
- Valid A2UI is converted into `SurfaceSpec`, emitted through `ui.surface.create/update`, and rendered by the desktop `SurfaceRenderer` as cards, tables, forms, timelines, charts, or media players.
- User actions on a Surface return to the next Agent turn with the source surface id, then reuse the same permission, tool, and memory flow.
- Detailed runtime notes live in `docs/agent-orchestration.md`.

---

## Local Data

All data is stored entirely locally, with zero cloud dependency:

| File | Description |
|:--|:--|
| `.pet/pet-agentd.sqlite` | Sessions, messages, memories, session summaries, Skills, tool runs, permission audits |
| `.pet/ai-provider.json` | Model API configuration |

---
