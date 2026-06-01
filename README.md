<p align="center">
  <img src="docs/demos/hero-pet-run.gif" alt="Purr Pilot 桌面宠物跑动预览" width="100%" />
</p>

<h1 align="center">🐾 Purr Pilot</h1>

<p align="center">
  <strong>把一个会工作、会记忆、会陪伴的小助手放进你的 Mac 桌面。</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS-blue?style=flat-square&logo=apple" />
  <img src="https://img.shields.io/badge/local--first-private-green?style=flat-square" />
  <img src="https://img.shields.io/badge/desktop-pet-lime?style=flat-square" />
  <img src="https://img.shields.io/badge/license-Apache%202.0-blue?style=flat-square" />
</p>

<p align="center">
  <a href="docs/demos/purr-pilot-demo.mp4">观看完整演示</a> · <a href="#-快速开始">立即运行</a>
</p>

<p align="center">
  <a href="README.en.md">English</a> · 中文
</p>

---

**Purr Pilot** 是一只常驻桌面边缘的 AI 宠物。它能在你需要时展开成工作台，也能只用右键快捷面板完成聊天、听歌、看视频、看用量和查看状态。数据优先保存在本地，适合每天开机就陪在旁边。

---

## ✨ 为什么想每天打开

<table>
<tr>
<td width="50%">

### 桌面边上的 AI 伙伴
小人常驻在桌面上，点击展开完整工作台，右键直接打开快捷对话、用量、音乐和视频。

</td>
<td width="50%">

### 会话变成可操作界面
一句话就能调出本地媒体、天气卡片、任务提醒和状态面板，不只是等一段文字回复。

</td>
</tr>
<tr>
<td>

### 会记住你的偏好
多会话、长期记忆和日常摘要都在本机沉淀，宠物会逐渐更懂你的工作节奏。

</td>
<td>

### 能养成也能社交
换造型、做自定义小人、和好友交换 Skill，让桌面宠物从工具变成自己的角色。

</td>
</tr>
</table>

---

## 🎬 产品演示

<p align="center">
  <a href="docs/demos/purr-pilot-demo.mp4">查看完整演示视频</a>
</p>

<table>
<tr>
<td align="center" width="50%">

<img src="docs/demos/01-basic-dashboard.gif" alt="基础看板、用量、记忆、Skill 与配置切换" width="100%" />

**工作台一眼掌握**
<sub>主页、真实用量、记忆、Skill 和配置快速切换</sub>

</td>
<td align="center" width="50%">

<img src="docs/demos/02-session-media-weather.gif" alt="多会话、周杰伦本地音乐、黑暗蜘蛛侠视频与天气卡片" width="100%" />

**会话里直接出现工具**
<sub>多会话、本地音乐、本地视频和天气卡片</sub>

</td>
</tr>
<tr>
<td align="center">

<img src="docs/demos/03-skill-exchange.gif" alt="与白桃连续交换两个 Skill" width="100%" />

**和白桃交换 Skill**
<sub>选择好友，连续接收两个可用 Skill</sub>

</td>
<td align="center">

<img src="docs/demos/04-pet-customization.gif" alt="形象工作室切换 Petdex 造型并打开自定义图片工作室" width="100%" />

**换造型马上同步到桌面**
<sub>Petdex 角色切换和自定义图片工作室</sub>

</td>
</tr>
<tr>
<td align="center" colspan="2">

<img src="docs/demos/05-pet-quick-actions.gif" alt="桌面宠物右键快捷菜单、快速对话、用量、音乐与视频" width="620" />

**不用打开窗口也能操作**
<sub>快速对话、真实用量、听歌、视频和工作状态</sub>

</td>
</tr>
</table>

---

## 🖼️ 你可以用它做什么

| 场景 | 体验 |
|:--|:--|
| 💬 **随手聊天** | 从桌面右键开始问，也可以展开多会话工作台继续聊 |
| 🎵 **本地媒体** | 让宠物播放桌面音乐或视频，不需要离开当前工作流 |
| 🌤️ **生活卡片** | 天气、计划、提醒直接变成可看的小卡片 |
| 🧠 **长期记忆** | 偏好、人设、日常事项可持续沉淀在本地 |
| 🧩 **Skill 养成** | 从好友那里交换 Skill，让宠物越来越会帮忙 |
| 🎨 **形象切换** | 预设角色和自定义图片都能变成桌面小人 |

---

## 🐾 角色和互动卡片

内置 18 款 Petdex 角色，也可以上传图片生成自己的桌面小人。聊天里不只返回文字，还会生成音乐、视频、天气、表单、时间线等互动卡片。

---

## 🚀 快速开始

### 环境要求

- macOS（Tauri 桌面壳）
- Node.js ≥ 22
- pnpm ≥ 11
- Rust toolchain（Tauri 构建）

### 启动开发版

```bash
# 克隆并安装依赖
pnpm install

# 🚀 启动原生桌面 App（推荐）
pnpm --filter @pet/desktop tauri:dev

# 💡 仅调试 Web UI + Agent Runtime
pnpm dev
```

启动后，一只透明置顶的桌面宠物会出现——点击它，打开工作窗口开始探索！

### 打包发布

```bash
# 构建 macOS .app
pnpm --filter @pet/desktop tauri:build

# 构建 DMG 安装包
pnpm --filter @pet/desktop tauri:build:dmg
```

产物路径：`apps/desktop/src-tauri/target/release/bundle/macos/Pet Agent.app`

---

## ⚙️ 配置

### 模型 API

推荐在 App 内「配置 → 模型 API」页面设置。也支持环境变量：

```bash
PET_AI_PROVIDER=openai          # deepseek / openai / anthropic / google / xai / openrouter
PET_AI_API_KEY=your-api-key
PET_AI_MODEL=gpt-4o-mini
PET_AI_BASE_URL=https://...     # 可选
```

<details>
<summary>📋 支持的 Provider 原生变量</summary>

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

### 语音服务

推荐在 App 内「配置 → 语音模型」页面保存语音 API。也可以用环境变量接入已支持的语音服务，按你的服务商实际端点、模型和 voice 填写即可：

```bash
# 小米 MiMo / 兼容语音端点
XIAOMI_API_KEY=...
XIAOMI_BASE_URL=https://your-voice-endpoint/v1
XIAOMI_AUDIO_MODEL=...
XIAOMI_TTS_MODEL=...
XIAOMI_TTS_VOICE=...

# OpenAI 或兼容 OpenAI STT/TTS 协议的语音端点（可选）
PET_AI_TRANSCRIPTION_API_KEY=...
PET_AI_TRANSCRIPTION_BASE_URL=https://your-stt-endpoint/v1
PET_AI_TRANSCRIPTION_MODEL=...
PET_AI_SPEECH_API_KEY=...
PET_AI_SPEECH_BASE_URL=https://your-tts-endpoint/v1
PET_AI_SPEECH_MODEL=...
PET_AI_SPEECH_VOICE=...
```

---

## 🏗️ 项目架构

```
├── apps/desktop/              → React + Vite + Tauri 桌面应用
│   ├── src/features/          → 聊天、宠物、仪表盘、A2UI 组件
│   ├── src/services/          → WebSocket RPC 客户端
│   └── src-tauri/             → Rust 原生壳 & 窗口管理
├── packages/agent-runtime/    → Node.js WebSocket Agent 服务
│   ├── providers/             → AI SDK & 语音集成
│   └── storage.ts             → SQLite 本地持久化
├── packages/protocol/         → 前后端共享类型协议
└── skills/bundled/            → 内置技能定义
```

**双窗口设计：**
- `pet` 窗口 — 180×180，透明无边框，全桌面置顶
- `work` 窗口 — 1580×960，标准工作区，点击宠物唤出

---

## 📦 本地数据

所有数据完全本地存储，零云端依赖：

| 文件 | 说明 |
|:--|:--|
| `.pet/pet-agentd.sqlite` | 会话、消息、记忆、技能等全部数据 |
| `.pet/ai-provider.json` | 模型 API 配置 |

开发模式存储于仓库内 `.pet/`（已被 `.gitignore` 排除）。打包后写入系统 `Application Support` 目录。

---
