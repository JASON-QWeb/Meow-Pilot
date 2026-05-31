<p align="center">
  <img src="apps/desktop/src/assets/petdex/noir-webling.webp" width="160" />
</p>

<h1 align="center">🐾 Purr Pilot — Your AI Desktop Pet Companion</h1>

<p align="center">
  <strong>A living AI pet that sits on your desktop — it chats, thinks, and works alongside you.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS-blue?style=flat-square&logo=apple" />
  <img src="https://img.shields.io/badge/runtime-local--first-green?style=flat-square" />
  <img src="https://img.shields.io/badge/tauri-v2-orange?style=flat-square&logo=tauri" />
  <img src="https://img.shields.io/badge/license-Apache%202.0-blue?style=flat-square" />
</p>

<p align="center">
  English · <a href="README.md">中文</a>
</p>

---

> **Purr Pilot** is more than a desktop widget — it's an AI companion with memory, skills, and a social circle. It lives on your desktop, always ready to chat, answer questions, play music, manage tasks, and even talk to you by voice. All data stays entirely on your machine. Zero cloud dependency. Zero privacy concerns.

---

## ✨ Key Highlights

<table>
<tr>
<td width="50%">

### 🖥️ Always-On Desktop Pet
A transparent, always-on-top window you can drag anywhere. Right-click for quick panels: instant chat, music player, and usage dashboard — no need to open the main window.

</td>
<td width="50%">

### 🧠 AI Chat & Memory
Multi-session chat with Markdown rendering, streaming responses, and generated interactive cards. The AI proactively suggests memory summaries, helping your pet remember your preferences and habits.

</td>
</tr>
<tr>
<td>

### 🎤 Voice Conversations
Voice input transcription and TTS playback. Enable "voice loop" mode for fully hands-free, voice-only interaction. Works with supported voice APIs, including Xiaomi MiMo, OpenAI, and OpenAI-compatible voice endpoints.

</td>
<td>

### 🎨 Customization & Petdex Collection
Choose from **18 pre-built characters** or upload any image — auto background removal, layer splitting, and Petdex action spritesheet generation. Your pet, your rules.

</td>
</tr>
<tr>
<td>

### 🔌 Multi-Model Freedom
Out-of-the-box support for DeepSeek, OpenAI, Anthropic, Google Gemini, xAI, OpenRouter, and any OpenAI-compatible endpoint. Switch freely, no vendor lock-in.

</td>
<td>

### 👥 Social & Skill Exchange
Add friends and build your pet's social circle. Exchange skills and memories between friends — make your pet smarter over time.

</td>
</tr>
</table>

---

## 🎬 Feature Demos

<!-- 
  📌 GIF Demo Section
  Place recorded GIFs in the repo (suggested path: docs/demos/) and replace the placeholders below.
  Recommended size: ~800×500, keep GIFs under 5MB.
-->

<table>
<tr>
<td align="center" width="50%">

<!-- TODO: Replace with desktop pet interaction GIF -->
<img src="https://placehold.co/800x500/1a1a2e/e0e0e0?text=🐾+Desktop+Pet" width="100%" />

**Desktop Pet · Always Ready**
<sub>Transparent overlay · Drag anywhere · Right-click quick panels</sub>

</td>
<td align="center" width="50%">

<!-- TODO: Replace with AI chat GIF -->
<img src="https://placehold.co/800x500/1a1a2e/e0e0e0?text=💬+AI+Chat" width="100%" />

**AI Chat · Streaming Responses**
<sub>Multi-session · Markdown · Generated interactive cards</sub>

</td>
</tr>
<tr>
<td align="center">

<!-- TODO: Replace with customization GIF -->
<img src="https://placehold.co/800x500/1a1a2e/e0e0e0?text=🎨+Image+Studio" width="100%" />

**Image Studio · Make It Yours**
<sub>Upload image · Auto cutout & rigging · Action spritesheet generation</sub>

</td>
<td align="center">

<!-- TODO: Replace with voice conversation GIF -->
<img src="https://placehold.co/800x500/1a1a2e/e0e0e0?text=🎤+Voice+Chat" width="100%" />

**Voice Chat · Hands Free**
<sub>Voice input · TTS playback · Full voice loop</sub>

</td>
</tr>
</table>

---

## 🖼️ Feature Overview

| Module | Description |
|:--|:--|
| 🏠 **Home Dashboard** | Pet status overview, 7-day message trend chart, scheduled tasks, quick action shortcuts |
| 💬 **Multi-Session Chat** | Session sidebar, Markdown rendering, streaming responses, voice input/output |
| 🎨 **Image Studio** | Petdex template gallery, custom image import, action spritesheet generation, zip export |
| 🧩 **Skill System** | 4 built-in core skills + 12 extended skills, friend-to-friend skill exchange |
| 📋 **Scheduled Tasks** | One-time / daily / weekly reminders via pet popup, chat, or voice notification |
| 🧠 **Memory Manager** | Pet persona, owner preferences, long-term memory — AI proposes, you approve |
| 📊 **Usage Tracking** | Per-provider token consumption with visual progress bars |
| ⚙️ **Settings** | One-stop model API and voice service configuration |

---

## 🐾 Petdex Character Collection

**18 built-in characters**, each with 9 action states (idle, run left/right, wave, jump, fail, wait, sprint, review):

`axobotl` · `boba` · `byte-bunny` · `capy` · `chaossprite` · `clawd` · `doraemon` · `ducduc` · `eve` · `fafa` · `golden-retriever` · `lulu-capybara` · `maodie` · `mochi` · `noir-webling` · `peri-the-owl` · `skillbit` · `yupi-penguin`

> 💡 Not enough? Upload any image and the **Image Studio** auto-generates a full Petdex-compatible action spritesheet!

---

## 🎯 A2UI — AI-Generated Interactive Interfaces

Your pet generates rich interactive cards inline — not just plain text:

- 📊 **Data Visuals** — Pie charts, metric dashboards, data tables
- 🎵 **Media Playback** — Inline music & video players
- 🌤️ **Weather Cards** — Real-time city weather (Open-Meteo)
- 📝 **Form Interactions** — Submittable input forms
- 📅 **Timelines** — Schedules & event displays

---

## 🚀 Getting Started

### Prerequisites

- macOS (Tauri desktop shell)
- Node.js ≥ 22
- pnpm ≥ 11
- Rust toolchain (for Tauri build)

### Development

```bash
# Install dependencies
pnpm install

# 🚀 Launch native desktop app (recommended)
pnpm --filter @pet/desktop tauri:dev

# 💡 Web UI + Agent Runtime only (no native window)
pnpm dev
```

After launch, a transparent always-on-top pet appears on your desktop — click it to open the work window and start exploring!

### Production Build

```bash
# Build macOS .app
pnpm --filter @pet/desktop tauri:build

# Build DMG installer
pnpm --filter @pet/desktop tauri:build:dmg
```

Output: `apps/desktop/src-tauri/target/release/bundle/macos/Pet Agent.app`

---

## ⚙️ Configuration

### Model API

The recommended way is to configure in-app via **Settings → Model API**. Environment variables are also supported:

```bash
PET_AI_PROVIDER=openai          # deepseek / openai / anthropic / google / xai / openrouter
PET_AI_API_KEY=your-api-key
PET_AI_MODEL=gpt-4o-mini
PET_AI_BASE_URL=https://...     # optional
```

<details>
<summary>📋 Supported provider-native variables</summary>

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

The recommended path is configuring voice APIs in-app via **Settings → Voice Model**. Environment variables are also supported; fill in the endpoint, model, and voice values from your provider:

```bash
# Xiaomi MiMo / compatible voice endpoint
XIAOMI_API_KEY=...
XIAOMI_BASE_URL=https://your-voice-endpoint/v1
XIAOMI_AUDIO_MODEL=...
XIAOMI_TTS_MODEL=...
XIAOMI_TTS_VOICE=...

# OpenAI or OpenAI-compatible STT/TTS endpoint (optional)
PET_AI_TRANSCRIPTION_API_KEY=...
PET_AI_TRANSCRIPTION_BASE_URL=https://your-stt-endpoint/v1
PET_AI_TRANSCRIPTION_MODEL=...
PET_AI_SPEECH_API_KEY=...
PET_AI_SPEECH_BASE_URL=https://your-tts-endpoint/v1
PET_AI_SPEECH_MODEL=...
PET_AI_SPEECH_VOICE=...
```

---

## 🏗️ Architecture

```
├── apps/desktop/              → React + Vite + Tauri desktop app
│   ├── src/features/          → Chat, pet, dashboard, A2UI components
│   ├── src/services/          → WebSocket RPC client
│   └── src-tauri/             → Rust native shell & window management
├── packages/agent-runtime/    → Node.js WebSocket agent server
│   ├── providers/             → AI SDK & voice integrations
│   └── storage.ts             → SQLite local persistence
├── packages/protocol/         → Shared frontend/backend type protocol
└── skills/bundled/            → Built-in skill definitions
```

**Dual-window design:**
- `pet` window — 180×180, transparent frameless, always-on-top across all desktops
- `work` window — 1160×760, standard workspace, opened by clicking the pet

---

## 📦 Local Data

All data stored entirely on your machine — zero cloud dependency:

| File | Description |
|:--|:--|
| `.pet/pet-agentd.sqlite` | Sessions, messages, memories, skills, and all app data |
| `.pet/ai-provider.json` | Model API configuration |

Development data lives in `.pet/` within the repo (gitignored). Packaged apps write to the system `Application Support` directory.

---

<p align="center">
  <sub>Built with ❤️ · Local-first · Your data, your control</sub>
</p>
