# 桌面宠物 Agent

一个 local-first 的桌面宠物 Agent，包含记忆、技能、生成式 UI surface、语音入口、用户自定义宠物头像、好友交换脚手架，以及 Tauri macOS 桌面壳。

English version: [README.en.md](README.en.md)

## 当前能力

- `@pet/protocol`：本地 RPC 类型、账号/好友交换记录、宠物情绪事件、记忆记录、技能、provider 和生成式 UI surface schema。
- `@pet/agent-runtime`：运行在 `ws://127.0.0.1:4747` 的本地 WebSocket Agent daemon。
- `@pet/desktop`：Tauri macOS App 壳。开发时前端地址为 `http://127.0.0.1:5173`，交付时启动的是 `.app`。

应用启动后默认显示一个透明、置顶、可拖拽的桌面宠物窗口。宠物始终留在桌面背景之上；点击宠物会打开或聚焦独立工作窗口。工作窗口右侧是导航栏，可在对话、好友、配置之间切换。对话页承接文字、语音和流式模型回复；音乐、视频播放器会以内联卡片出现在对应聊天消息里。宠物不会回到工作窗口里，而是根据当前任务在桌面窗口上改变状态。

运行时已经从手写 provider 请求切换为 AI SDK。用户可以在工作窗口的 `模型 API` 面板直接选择 OpenAI、Anthropic、Google Gemini、xAI、DeepSeek、OpenRouter 或任意 OpenAI-compatible endpoint，填写 API Key、模型和可选 Base URL 后保存。配置写入 `.pet/ai-provider.json`，该目录已被 `.gitignore` 排除；UI 保存的本机配置优先于环境变量，保存后下一轮对话立即生效。语音输入输出优先使用小米 MiMo 模型，并支持从 `~/Desktop/api.md` 自动读取 `xiaomi` 配置。

如果没有配置模型 provider，对话不会回落到本地假数据；运行时会在聊天中明确提示先配置模型 API。

## 模型配置

推荐在桌面 UI 的 `Model API` 面板配置。也可以用统一环境变量：

```bash
PET_AI_PROVIDER=openai
PET_AI_API_KEY=your-api-key
PET_AI_MODEL=gpt-4o-mini
# OpenRouter 或 OpenAI-compatible endpoint 可设置：
PET_AI_BASE_URL=https://openrouter.ai/api/v1
```

也支持 provider 原生环境变量：

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

语音转写和 TTS 优先使用小米 MiMo。可在配置页的 `小米语音模型` 面板保存 API Key，也可以通过环境变量或 `~/Desktop/api.md` 配置。`~/Desktop/api.md` 里的 provider block 示例：

```bash
xiaomi:
api-key: ...
https://token-plan-cn.xiaomimimo.com/v1
```

也支持环境变量：

```bash
XIAOMI_API_KEY=...
XIAOMI_BASE_URL=https://api.xiaomimimo.com/v1
XIAOMI_AUDIO_MODEL=mimo-v2.5
XIAOMI_TTS_MODEL=mimo-v2.5-tts
XIAOMI_TTS_VOICE=mimo_default
```

如果没有小米语音配置，运行时会尝试 OpenAI speech/transcription 作为兼容回退。

## 桌面应用结构

```text
apps/desktop/src/
  services/               # 本地 RPC client 和 Tauri bridge 边界
  hooks/                  # 应用状态编排
  features/
    pet/                  # 宠物档案、自定义、渲染、拖拽浮层
    chat/                 # 对话面板
    surfaces/             # 生成式 UI renderer
    runtime/              # 账号、好友、记忆、技能、provider 侧栏
  config/                 # 产品默认配置
  lib/                    # 前端共享工具
```

Tauri 配置了两个窗口：

- `pet`：透明、无边框、置顶、跳过任务栏的常驻宠物窗口。
- `work`：普通工作窗口，默认隐藏，点击宠物后打开；关闭时隐藏而不是退出宠物。

打包时会把 `@pet/agent-runtime` 构建为单文件 runtime bundle 并随 `.app` 放入资源目录，App 启动时由 Tauri 壳拉起本地 runtime。

## 图片头像工作室

宠物自定义器可以导入本地 JPG、PNG 或 WebP 图片，在不上传源图的情况下生成桌面可用的分层头像。工作室会生成 `head`、`body`、`feet` 三个透明 PNG 图层，并支持：

- 选择自然、贴纸描边或像素风格；
- 调整背景移除、构图缩放、图层边界、头部对齐和动作性格；
- 在确认前预览并下载生成图层；
- 将通过确认的 rig 应用到常驻桌面宠物窗口；
- 删除已导入 rig 及其本地保存的原图/图层。

图层和归一化后的源图保存在本机 IndexedDB；轻量宠物档案只保存选中的素材 id。透明 PNG 导入会保留原始 alpha 边缘。

## 桌面状态

桌面宠物会跟随运行时 `pet.activity` 事件进入不同状态。编码、查询、运动和休息会显示不同的桌面状态标记和动画节奏。经典宠物和用户生成的分层头像都会复用到桌面窗口中。

## 命令

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm build
pnpm migrate:scan
pnpm migrate:import
pnpm --filter @pet/desktop tauri:build
```

`tauri:build` 产物位置：

```text
apps/desktop/src-tauri/target/release/bundle/macos/Pet Agent.app
```

可选 DMG 命令为 `pnpm --filter @pet/desktop tauri:build:dmg`；DMG 窗口样式可能需要正常交互式 Finder 会话。

## 试用提示

- 先在配置页保存 DeepSeek API Key 和模型名，例如 `deepseek-chat`，再发送普通问题验证真实流式回复。
- `播放音乐 https://...mp3` 会在聊天消息内渲染音频播放器。
- `看视频 https://...mp4`、YouTube 或 Bilibili 链接会在聊天消息内渲染视频/嵌入播放器。
- 没有可播放链接时，媒体请求只会显示待连接播放器，不会生成假歌单或假视频。
- 启动 `.app` 后先看到桌面宠物；点击宠物打开工作窗口。
- 使用右侧导航切换对话、好友、配置。
- 在好友页可本地登录、添加好友 handle，并运行隐私保护的宠物交换。
- 点击麦克风开始录音，再次点击发送语音回合；配置小米 MiMo 后会用小米模型做转写和 TTS，否则会尝试 OpenAI 语音或系统语音能力。
- 在配置页直接调整名字、形态、配色和配饰；桌面宠物窗口会同步更新。在 `图片形象` 下点击 `从图片生成`，调整三层图像后应用为桌面宠物。
- 发送 `修复这个 TypeScript bug`、`查询 React 文档`，可查看桌面宠物状态自动切换。

## 本地数据

`pet-agentd` 默认把本地数据写到 `.pet/pet-agentd.sqlite`：

- session
- message（可携带聊天内联播放器）
- 生成式 UI surface
- memory
- 本地 account/friend/exchange 记录

打包应用后，这个路径应迁移到平台 Application Support 目录。
