<p align="center">
  <img src="docs/demos/hero-pet-run.gif" alt="Purr Pilot desktop pet running preview" width="100%" />
</p>

<h1 align="center">🐾 Purr Pilot</h1>

<p align="center">
  <strong>A small AI companion for your Mac desktop: present, personal, and useful.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS-blue?style=flat-square&logo=apple" />
  <img src="https://img.shields.io/badge/local--first-private-green?style=flat-square" />
  <img src="https://img.shields.io/badge/desktop-pet-lime?style=flat-square" />
  <img src="https://img.shields.io/badge/license-Apache%202.0-blue?style=flat-square" />
</p>

<p align="center">
  <a href="docs/demos/purr-pilot-demo.mp4">Watch the full demo</a> · <a href="#-getting-started">Run it locally</a>
</p>

<p align="center">
  English · <a href="README.md">中文</a>
</p>

---

**Purr Pilot** is an AI pet that lives at the edge of your desktop. Open the full workspace when you need focus, or use the right-click quick panels for chat, music, video, usage, and status. It is designed to feel like a companion you keep around all day, with local-first data by default.

---

## ✨ Why It Feels Useful

<table>
<tr>
<td width="50%">

### A Companion On Your Desktop
The pet stays where you work. Click to open the workspace, or right-click for chat, usage, music, and video.

</td>
<td width="50%">

### Conversations Become Tools
Ask naturally and get media players, weather cards, reminders, and compact status panels inside the conversation.

</td>
</tr>
<tr>
<td>

### It Learns Your Rhythm
Sessions, preferences, and long-term memories stay local, so the pet can become more tuned to your habits over time.

</td>
<td>

### It Can Grow With Friends
Change the character, create your own pet image, and exchange Skills with friends to make your pet more capable.

</td>
</tr>
</table>

---

## 🎬 Product Demos

<p align="center">
  <a href="docs/demos/purr-pilot-demo.mp4">Watch the full demo video</a>
</p>

<table>
<tr>
<td align="center" width="50%">

<img src="docs/demos/01-basic-dashboard.gif" alt="Basic dashboard, usage, memory, Skill, and settings switching" width="100%" />

**Your Workspace At A Glance**
<sub>Home, live usage, memory, Skill, and settings switching</sub>

</td>
<td align="center" width="50%">

<img src="docs/demos/02-session-media-weather.gif" alt="Multi-session UI with local Jay Chou music, local Spider-Man video, and weather cards" width="100%" />

**Chat Turns Into Small Apps**
<sub>Multi-session, local music, local video, and weather cards</sub>

</td>
</tr>
<tr>
<td align="center">

<img src="docs/demos/03-skill-exchange.gif" alt="Two Skill exchanges with Bai Tao" width="100%" />

**Exchange Skills With Bai Tao**
<sub>Select a friend and receive two usable Skills</sub>

</td>
<td align="center">

<img src="docs/demos/04-pet-customization.gif" alt="Image studio switching Petdex characters while the desktop pet changes" width="100%" />

**Character Changes Sync Instantly**
<sub>Petdex switching and custom image studio</sub>

</td>
</tr>
<tr>
<td align="center" colspan="2">

<img src="docs/demos/05-pet-quick-actions.gif" alt="Desktop pet right-click quick menu, chat, usage, music, and video" width="620" />

**Useful Without Opening The Window**
<sub>Quick chat, live usage, music, video, and work states</sub>

</td>
</tr>
</table>

---

## 🖼️ What You Can Do

| Moment | Experience |
|:--|:--|
| 💬 **Ask Quickly** | Start from the desktop pet, then continue in the full multi-session workspace |
| 🎵 **Use Local Media** | Let the pet play desktop music or video without breaking your flow |
| 🌤️ **See Useful Cards** | Weather, plans, reminders, and summaries appear as compact cards |
| 🧠 **Keep Memory Local** | Preferences, persona, and long-term context can build up on your machine |
| 🧩 **Grow With Skills** | Exchange Skills with friends so the pet learns new workflows |
| 🎨 **Make It Yours** | Choose a preset character or turn your own image into the pet |

---

## 🐾 Characters And Interactive Cards

Purr Pilot ships with 18 Petdex characters, and you can upload an image to create your own desktop pet. Conversations can render music, video, weather, forms, timelines, and other compact interactive cards.

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
- `work` window — 1580×960, standard workspace, opened by clicking the pet

---

## 📦 Local Data

All data stored entirely on your machine — zero cloud dependency:

| File | Description |
|:--|:--|
| `.pet/pet-agentd.sqlite` | Sessions, messages, memories, skills, and all app data |
| `.pet/ai-provider.json` | Model API configuration |

Development data lives in `.pet/` within the repo (gitignored). Packaged apps write to the system `Application Support` directory.

---
