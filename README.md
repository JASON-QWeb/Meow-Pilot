# Desktop Pet Agent

Local-first desktop pet agent with memory, skills, generated UI surfaces, voice entry, user-generated pet avatars, social exchange scaffolding, and a Tauri macOS shell.

## What Runs Today

- `@pet/protocol`: typed local RPC, account/friend exchange records, pet emotion events, memory records, skills, providers, and generated UI surface schema.
- `@pet/agent-runtime`: local WebSocket agent daemon on `ws://127.0.0.1:4747`.
- `@pet/desktop`: React/Vite desktop shell on `http://127.0.0.1:5173`, packaged with Tauri for macOS.

The runtime reads regular Xiaomi MiMo API settings from environment variables or `/Users/justq/Desktop/api.md`, then falls back to local deterministic planning if the provider is unavailable. Token Plan endpoints are intentionally not used by this custom desktop application because Xiaomi limits those subscription keys to supported programming-tool scenarios. It streams turns, changes pet emotion, creates generated UI surfaces, proposes memory writes, runs bundled skills, and records local account/friend exchanges. Voice conversations record microphone audio locally, send a WAV copy through the runtime to `mimo-v2.5` for transcription, and play assistant replies synthesized by `mimo-v2.5-tts`.

Optional voice overrides:

```bash
XIAOMI_API_KEY=your-regular-mimo-api-key
XIAOMI_BASE_URL=https://api.xiaomimimo.com/v1
XIAOMI_AUDIO_MODEL=mimo-v2.5
XIAOMI_TTS_MODEL=mimo-v2.5-tts
XIAOMI_TTS_VOICE=mimo_default
XIAOMI_TTS_INSTRUCTION="请用自然、亲切的普通话语气朗读。"
```

If you configure Xiaomi in `/Users/justq/Desktop/api.md`, use a regular API key and `https://api.xiaomimimo.com/v1` for this app rather than a `token-plan-*` base URL.

## Desktop App Shape

The desktop shell is intentionally modular:

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

The workspace mode shows the product workbench. The pet-only mode shows only the user's customized pet shape and lets the user drag it around the desktop surface. The Tauri shell is configured as a transparent always-on-top macOS window.

## Image Avatar Studio

The pet customizer can import a local JPG, PNG, or WebP photo and build a desktop-ready layered avatar without uploading the source image. The studio generates three transparent PNG layers (`head`, `body`, and `feet`) following the layered-rig approach used by Live2D/Spine-style mascots and sprite-based desktop pets:

- choose natural, sticker-outline, or pixel presentation;
- adjust background removal, framing/zoom, layer boundaries, head alignment, and motion personality;
- review the generated component layers and download them before confirming;
- apply the approved rig to both workspace and draggable pet-only modes.
- delete an imported rig and its stored original/layers from the local asset database.

Layer images and the original normalized source are kept in IndexedDB on the device; the lightweight pet profile only stores the selected asset id. Transparent PNG imports preserve their existing alpha edges. The current local background-removal pass is intended for simple photo backgrounds; complex semantic cutouts can later be routed through an explicitly authorized image provider.

## Activity Scene Board

The workspace pet now lives inside an animated status board driven by runtime `pet.activity` events. Active coding tasks seat the selected pet at a terminal with moving code and coffee steam; lookup and documentation tasks put it in a tiled bathroom scrolling a phone. When a run ends, the board idles between a small exercise routine and a sleeping bedroom scene.

The board renders the currently selected classic or user-generated layered avatar inside every scene. Its preview buttons let the user inspect each animation without submitting a task; the next real task returns it to automatic mode.

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

The optional DMG command is available as `pnpm --filter @pet/desktop tauri:build:dmg`; it may require a normal interactive Finder session for DMG window styling.

## Try

- `听歌` opens a music media surface.
- `看视频` opens a video media surface.
- `今天日程` opens a calendar timeline surface.
- `查询桌面 Agent 架构` opens a research board.
- `记住我喜欢简洁但有温度的回答` creates a memory proposal.
- Click `Pet only` or `Place on desktop` to switch to the draggable pet-only surface.
- Use the Account/Friends panel to sign in locally, add a friend handle, and run a privacy-preserving pet exchange.
- Click the microphone, speak, then click it again to send a voice turn. The reply is automatically read with Xiaomi MiMo TTS; the speaker button replays the latest response.
- Under `Photo avatar`, click `从图片生成`, adjust the three generated layers, then apply the approved image rig as the desktop pet.
- Use the status-board preview buttons, or send `修复这个 TypeScript bug` and `查询 React 文档`, to see the coding and phone-research scenes switch automatically.

## Local Data

`pet-agentd` stores local data in `.pet/pet-agentd.sqlite` by default:

- sessions
- messages
- generated UI surfaces
- memories
- local account/friends/exchange records

For a packaged app, this path should move to the platform Application Support directory.
