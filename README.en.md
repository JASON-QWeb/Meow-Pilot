# Desktop Pet Agent

A local-first desktop pet agent with memory, skills, generated UI surfaces, voice entry, user-generated pet avatars, social exchange scaffolding, and a Tauri macOS shell.

Chinese version: [README.md](README.md)

## What Runs Today

- `@pet/protocol`: typed local RPC, account/friend exchange records, pet emotion events, memory records, skills, providers, and generated UI surface schema.
- `@pet/agent-runtime`: local WebSocket agent daemon on `ws://127.0.0.1:4747`.
- `@pet/desktop`: Tauri macOS app shell. The frontend uses `http://127.0.0.1:5173` in development; delivery starts the `.app`.

On launch, the app shows a transparent always-on-top draggable desktop pet window. The pet stays on top of the desktop background. Clicking the pet opens or focuses a separate work window. The work window has a right-side navigation rail for chat, friends, and settings. Chat handles text, voice, and streamed model output; music and video players appear inline inside the matching chat message. The pet does not move back into the work window; it changes state on the desktop according to the current task.

The runtime now uses AI SDK instead of hand-written provider requests. In the work window's `模型 API` panel, users can choose OpenAI, Anthropic, Google Gemini, xAI, DeepSeek, OpenRouter, or any OpenAI-compatible endpoint, then save an API key, model, and optional base URL. The local config is stored in `.pet/ai-provider.json`, and `.pet/` is ignored by git. Locally saved UI config takes precedence over environment variables and applies on the next chat turn. Voice input/output prefers Xiaomi MiMo and can auto-read a `xiaomi` block from `~/Desktop/api.md`.

When no model provider is configured, chat no longer falls back to local fake data; the runtime tells the user to configure a model API first.

## Model Configuration

The preferred path is the desktop `Model API` panel. You can also use unified environment variables:

```bash
PET_AI_PROVIDER=openai
PET_AI_API_KEY=your-api-key
PET_AI_MODEL=gpt-4o-mini
# For OpenRouter or OpenAI-compatible endpoints:
PET_AI_BASE_URL=https://openrouter.ai/api/v1
```

Provider-native environment variables are also supported:

```bash
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GOOGLE_GENERATIVE_AI_API_KEY=...
XAI_API_KEY=...
DEEPSEEK_API_KEY=...
OPENROUTER_API_KEY=...
OPENAI_COMPATIBLE_API_KEY=...
OPENAI_COMPATIBLE_BASE_URL=https://your-compatible-endpoint/v1
```

Voice transcription and TTS prefer Xiaomi MiMo. Configure it in the desktop `小米语音模型` panel, through environment variables, or with a `xiaomi` block in `~/Desktop/api.md`:

```bash
xiaomi:
api-key: ...
https://token-plan-cn.xiaomimimo.com/v1
```

Environment variables are also supported:

```bash
XIAOMI_API_KEY=...
XIAOMI_BASE_URL=https://api.xiaomimimo.com/v1
XIAOMI_AUDIO_MODEL=mimo-v2.5
XIAOMI_TTS_MODEL=mimo-v2.5-tts
XIAOMI_TTS_VOICE=mimo_default
```

If Xiaomi voice is not configured, the runtime attempts the existing OpenAI speech/transcription fallback.

## Desktop App Shape

```text
apps/desktop/src/
  services/               # local RPC clients and Tauri bridge boundary
  hooks/                  # app state orchestration
  features/
    pet/                  # pet profile, customization, renderer, drag overlay
    chat/                 # conversation panel
    surfaces/             # generated UI renderer
    runtime/              # account/friends/memory/skills/providers side panel
  config/                 # product defaults
  lib/                    # shared frontend utilities
```

The Tauri app defines two windows:

- `pet`: transparent, frameless, always-on-top, skipped from the taskbar, and always visible as the desktop pet.
- `work`: normal work window, hidden by default, opened by clicking the pet, and hidden instead of destroyed when closed.

During packaging, `@pet/agent-runtime` is built into a single runtime bundle and included in the `.app` resources. The Tauri shell starts the local runtime when the app launches.

## Image Avatar Studio

The pet customizer can import a local JPG, PNG, or WebP photo and build a desktop-ready layered avatar without uploading the source image. The studio generates three transparent PNG layers: `head`, `body`, and `feet`.

- Choose natural, sticker-outline, or pixel presentation.
- Adjust background removal, framing/zoom, layer boundaries, head alignment, and motion personality.
- Review generated component layers and download them before confirming.
- Apply the approved rig to the always-on desktop pet window.
- Delete an imported rig and its stored original/layers from the local asset database.

Layer images and the normalized source are kept in IndexedDB on the device; the lightweight pet profile only stores the selected asset id. Transparent PNG imports preserve their existing alpha edges.

## Desktop State

The desktop pet follows runtime `pet.activity` events. Coding, research, exercise, and rest states use different desktop markers and animation rhythms. Both classic and user-generated layered avatars are rendered in the desktop pet window.

## Commands

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm build
pnpm migrate:scan
pnpm migrate:import
pnpm --filter @pet/desktop tauri:build
```

`tauri:build` produces:

```text
apps/desktop/src-tauri/target/release/bundle/macos/Pet Agent.app
```

The optional DMG command is `pnpm --filter @pet/desktop tauri:build:dmg`; it may require an interactive Finder session for DMG window styling.

## Try

- Save a DeepSeek API key and model such as `deepseek-chat` in Settings, then send a normal prompt to verify real streamed output.
- `播放音乐 https://...mp3` renders an audio player inline in the chat message.
- `看视频 https://...mp4`, YouTube, or Bilibili links render video/embed players inline in the chat message.
- Without a playable link, media requests show a waiting player instead of fake songs or videos.
- Launch the `.app` to see the desktop pet first; click the pet to open the work window.
- Use the right-side navigation to switch between chat, friends, and settings.
- Use the Friends page to sign in locally, add a friend handle, and run a privacy-preserving pet exchange.
- Click the microphone, speak, then click it again to send a voice turn. With Xiaomi MiMo configured, Xiaomi handles transcription and TTS; otherwise the app attempts OpenAI voice or browser/system speech features.
- In Settings, adjust the pet name, shape, palette, and accessory directly; the desktop pet window updates in sync. Under `图片形象`, click `从图片生成`, adjust the three generated layers, then apply the approved image rig as the desktop pet.
- Send `修复这个 TypeScript bug` or `查询 React 文档` to see the desktop pet state switch automatically.

## Local Data

`pet-agentd` stores local data in `.pet/pet-agentd.sqlite` by default:

- sessions
- messages with optional inline chat players
- generated UI surfaces
- memories
- local account/friends/exchange records

For a packaged app, this path should move to the platform Application Support directory.
