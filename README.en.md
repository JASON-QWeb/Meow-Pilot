# Desktop Pet Agent

A local-first desktop pet agent with a Tauri macOS shell, local agent runtime, chat, voice, model configuration, pet customization, and local data storage.

Chinese version: [README.md](README.md)

## Start The App In Development

The "app version" is the native Tauri desktop shell. Do not use only `pnpm dev` when you want the real app window; that command starts the web frontend and runtime without the native `.app` shell.

```bash
cd /Users/justq/Documents/Pet
pnpm install
pnpm --filter @pet/desktop tauri:dev
```

After startup, a transparent always-on-top desktop pet window appears first. Click the pet to open the work window. Tauri dev starts the Vite frontend automatically at `http://127.0.0.1:5173`. In debug mode, the Tauri shell also starts `@pet/agent-runtime` on `ws://127.0.0.1:4747`, so you normally do not need to run `pnpm dev` separately.

## Common Commands

```bash
# Native app development
pnpm --filter @pet/desktop tauri:dev

# Web UI and runtime only, without the native app window
pnpm dev

# Type checking
pnpm typecheck

# Build all workspace packages
pnpm build

# Package the macOS .app
pnpm --filter @pet/desktop tauri:build
```

The `.app` bundle is produced at:

```text
apps/desktop/src-tauri/target/release/bundle/macos/Pet Agent.app
```

To build a DMG:

```bash
pnpm --filter @pet/desktop tauri:build:dmg
```

## Project Structure

```text
apps/desktop/              # React + Vite + Tauri desktop app
apps/desktop/src-tauri/    # Tauri Rust shell and window config
packages/agent-runtime/    # Local WebSocket agent daemon
packages/protocol/         # Shared frontend/backend types and protocol
```

The Tauri app defines two windows:

- `pet`: transparent, frameless, always-on-top desktop pet window.
- `work`: normal work window, hidden by default and opened by clicking the pet.

## Model Configuration

The recommended path is to start the app and save the provider, API key, model name, and optional base URL in the `模型 API` settings panel. Local config is written to `.pet/ai-provider.json` and is not committed to git.

You can also use environment variables:

```bash
PET_AI_PROVIDER=openai
PET_AI_API_KEY=your-api-key
PET_AI_MODEL=gpt-4o-mini
PET_AI_BASE_URL=https://openrouter.ai/api/v1
```

Provider-native variables are supported too:

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

If no model is configured, chat does not use fake data. The runtime asks you to configure a model API first.

## Voice Configuration

Voice transcription and TTS prefer Xiaomi MiMo. Configure it in the settings panel or with environment variables:

```bash
XIAOMI_API_KEY=...
XIAOMI_BASE_URL=https://api.xiaomimimo.com/v1
XIAOMI_AUDIO_MODEL=mimo-v2.5
XIAOMI_TTS_MODEL=mimo-v2.5-tts
XIAOMI_TTS_VOICE=mimo_default
```

The runtime can also auto-read a `xiaomi` block from `~/Desktop/api.md`:

```text
xiaomi:
api-key: ...
https://token-plan-cn.xiaomimimo.com/v1
```

If Xiaomi voice is not configured, the runtime attempts the OpenAI speech/transcription fallback.

## Local Data

In development, local data is written under the repository `.pet/` directory:

```text
.pet/pet-agentd.sqlite
.pet/ai-provider.json
```

`.pet/` is ignored by git. Packaged apps write runtime data to the system Application Support directory.
