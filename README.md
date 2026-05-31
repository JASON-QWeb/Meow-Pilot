# 桌面宠物 Agent

一个 local-first 的桌面宠物 Agent，包含 Tauri macOS 桌面壳、本地 Agent runtime、聊天、语音、模型配置、宠物自定义和本地数据存储。

English version: [README.en.md](README.en.md)

## 快速启动 App 开发版

本项目的“App 版本”指 Tauri 原生桌面壳。开发时不要只跑 `pnpm dev`，否则只会启动 Web 前端和 runtime，看不到真正的 `.app` 窗口。

```bash
cd /Users/justq/Documents/Pet
pnpm install
pnpm --filter @pet/desktop tauri:dev
```

启动后会先出现一个透明、置顶的桌面宠物窗口；点击宠物会打开工作窗口。Tauri dev 会自动启动 Vite 前端，地址是 `http://127.0.0.1:5173`。debug 模式下 Tauri 壳也会自动拉起 `@pet/agent-runtime`，运行在 `ws://127.0.0.1:4747`，通常不用再单独执行 `pnpm dev`。

## 常用命令

```bash
# 原生 App 开发版
pnpm --filter @pet/desktop tauri:dev

# 只调试 Web UI 和 runtime，不启动原生 App 窗口
pnpm dev

# 类型检查
pnpm typecheck

# 构建所有 workspace 包
pnpm build

# 打包 macOS .app
pnpm --filter @pet/desktop tauri:build
```

`.app` 打包产物位置：

```text
apps/desktop/src-tauri/target/release/bundle/macos/Pet Agent.app
```

如需 DMG：

```bash
pnpm --filter @pet/desktop tauri:build:dmg
```

## 项目结构

```text
apps/desktop/              # React + Vite + Tauri 桌面端
apps/desktop/src-tauri/    # Tauri Rust 壳和窗口配置
packages/agent-runtime/    # 本地 WebSocket Agent daemon
packages/protocol/         # 前后端共享类型和协议
```

Tauri 配置了两个窗口：

- `pet`：透明、无边框、置顶的桌面宠物窗口。
- `work`：普通工作窗口，默认隐藏，点击宠物后打开。

## 宠物形象与动作图集

工作窗口的“形象”页支持两类宠物素材：

- 内置 Petdex 模板：使用 1536×1872 的 spritesheet，每帧 192×208，包含待机、左右跑、挥手、跳跃、失败、等待、奔跑、思考等动作行。
- 自定义图片：导入 JPG、PNG 或 WebP 后，本机自动生成三层拆件和同规格 Petdex 动作图集。应用后桌面宠物会优先播放这张自定义动作图集，旧素材会回退到三层拆件动画。

图片工作室可以导出兼容 Petdex 结构的 zip 包，里面包含 `pet.json` 和 `spritesheet.webp`（在不支持 WebP canvas 导出的环境里会导出 `spritesheet.png`）。

## 模型配置

推荐启动 App 后在配置页的 `模型 API` 面板里保存 provider、API Key、模型名和可选 Base URL。本机配置写入 `.pet/ai-provider.json`，不会提交到 git。

也可以用环境变量：

```bash
PET_AI_PROVIDER=openai
PET_AI_API_KEY=your-api-key
PET_AI_MODEL=gpt-4o-mini
PET_AI_BASE_URL=https://openrouter.ai/api/v1
```

还支持这些 provider 原生变量：

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

没有配置模型时，对话不会使用假数据，runtime 会提示先配置模型 API。

## 语音配置

语音转写和 TTS 优先使用小米 MiMo。可以在配置页保存，也可以用环境变量：

```bash
XIAOMI_API_KEY=...
XIAOMI_BASE_URL=https://api.xiaomimimo.com/v1
XIAOMI_AUDIO_MODEL=mimo-v2.5
XIAOMI_TTS_MODEL=mimo-v2.5-tts
XIAOMI_TTS_VOICE=mimo_default
```

也支持从 `~/Desktop/api.md` 自动读取 `xiaomi` 配置：

```text
xiaomi:
api-key: ...
https://token-plan-cn.xiaomimimo.com/v1
```

如果没有小米语音配置，runtime 会尝试 OpenAI speech/transcription 兼容回退。

## 本地数据

开发模式下数据默认写入仓库内的 `.pet/`：

```text
.pet/pet-agentd.sqlite
.pet/ai-provider.json
```

`.pet/` 已被 `.gitignore` 排除。打包后的 App 会把 runtime 数据写入系统 Application Support 目录。
