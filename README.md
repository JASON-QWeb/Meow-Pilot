<p align="center">
  <img src="docs/demos/hero-pet-run.gif" alt="Meow Pilot 桌面宠物跑动预览" width="100%" />
</p>

<h1 align="center">🐾 Meow Pilot</h1>

<p align="center">
  <strong>把会工作、会记忆、会陪伴的AI宠物放进你的 Mac 桌面</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS-blue?style=flat-square&logo=apple" />
  <img src="https://img.shields.io/badge/Rust-000000?style=flat-square&logo=rust" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=node.js&logoColor=white" />
  <img src="https://img.shields.io/badge/pnpm-F69220?style=flat-square&logo=pnpm&logoColor=white" />
</p>

<p align="center">
  <a href="README.en.md">English</a> · 中文
</p>

---

## 产品演示

<table>
<tr>
<td align="center" width="50%">

<img src="docs/demos/01-basic-dashboard.gif" alt="基础看板、用量、记忆、Skill 与配置切换" width="100%" />

**主页、模型用量、记忆、skill、定时任务等**

</td>
<td align="center" width="50%">

<img src="docs/demos/02-session-media-weather.gif" alt="多会话、本地音乐、本地视频与天气卡片" width="100%" />

**会话里内生成式UI卡片交互**

</td>
</tr>
<tr>
<td align="center">

<img src="docs/demos/03-skill-exchange.gif" alt="好友 Skill 交换流程" width="100%" />

**社交：与真实好友交换 Skill**

</td>
<td align="center">

<img src="docs/demos/04-pet-customization.gif" alt="形象工作室切换 Petdex 造型并打开自定义图片工作室" width="100%" />

**宠物造型选择与自定义生成**

</td>
</tr>
<tr>
<td align="center" colspan="2">

<img src="docs/demos/05-pet-quick-actions.gif" alt="桌面宠物右键快捷菜单、快速对话、用量、音乐与视频" width="620" />

**宠物右键菜单快捷操作**

</td>
</tr>
</table>

---

## 覆盖场景

| 场景 | 体验 |
|:--|:--|
| **随手聊天** | 从桌面右键开始问，也可以展开多会话工作台继续聊 |
| **任务代办** | 根据指令调用工具、处理文件、整理信息或完成工作流 |
| **播放媒体** | 让宠物播放音乐或视频 |
| **生活卡片** | 天气、计划、提醒直接变成可看的小卡片 |
| **长期记忆** | 偏好、人设、日常事项可持续沉淀在本地 |
| **Skill 养成** | 从好友那里交换 Skill，让宠物越来越会帮忙 |
| **形象切换** | 预设角色和自定义图片都能变成桌面小人 |

---

## 快速开始

### 环境要求

- macOS（Tauri 桌面壳）
- Node.js ≥ 22
- pnpm ≥ 11
- Rust toolchain（Tauri 构建）

### 启动开发版

```bash
# 克隆并安装依赖
pnpm install

# 启动原生桌面 App（推荐）
pnpm --filter @pet/desktop tauri:dev

# 仅调试 Web UI + Agent Runtime
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

## 配置

### 模型 API

推荐在 App 内「配置 → 模型 API」页面设置。也支持环境变量：

```bash
PET_AI_PROVIDER=openai          # deepseek / openai / anthropic / google / xai / openrouter
PET_AI_API_KEY=your-api-key
PET_AI_MODEL=gpt-4o-mini
PET_AI_BASE_URL=https://...     # 可选
```

<details>
<summary> 支持的 Provider 原生变量</summary>

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
# OpenAI 或兼容 OpenAI STT/TTS 协议的语音端点
PET_AI_TRANSCRIPTION_API_KEY=...
PET_AI_TRANSCRIPTION_BASE_URL=https://your-stt-endpoint/v1
PET_AI_TRANSCRIPTION_MODEL=...
PET_AI_SPEECH_API_KEY=...
PET_AI_SPEECH_BASE_URL=https://your-tts-endpoint/v1
PET_AI_SPEECH_MODEL=...
PET_AI_SPEECH_VOICE=...
```

---

## 项目架构

```
├── apps/desktop/              → React + Vite + Tauri 桌面应用
│   ├── src/features/          → 聊天、宠物、仪表盘、A2UI Surface 渲染
│   ├── src/services/          → WebSocket RPC 客户端
│   └── src-tauri/             → Rust 原生壳 & 窗口管理
├── packages/agent-runtime/    → 本地 Node.js Agent Runtime
│   ├── src/server.ts          → WebSocket RPC、事件广播、任务调度入口
│   ├── src/kernel/            → ContextBuilder、AgentKernel、计划/工具/反思编排
│   ├── src/tools/             → ToolRegistry、按需工具发现、权限和审计
│   ├── src/memory/            → 记忆检索、显式记忆、会话摘要刷新
│   ├── src/skills/            → SKILL.md frontmatter 扫描、检索和按需读取
│   ├── src/providers/         → AI SDK Provider、语音和多模态 adapter
│   ├── src/a2uiProtocol.ts    → A2UI envelope 校验、转换和修复反馈
│   └── src/storage.ts         → SQLite、FTS5、向量索引、审计和运行时状态
├── packages/protocol/         → 共享 RPC、事件、SurfaceSpec、A2UI 和工具类型
└── skills/bundled/            → 内置技能定义
```

### Agent Runtime 能力

- 请求流程：`chat.send` 进入 Runtime 后，先构建上下文，再按任务复杂度决定是否生成 Plan，随后流式调用模型、执行受限工具、解析 A2UI/Surface、落盘消息并广播事件。
- 成本控制：短问答可跳过 Plan 和 Reflection；复杂任务才启用多轮计划、工具调用和最终反思。
- 工具编排：默认只暴露核心工具和当前任务相关类别；需要更多能力时先通过 `tool_search` 发现，再把允许的 tool schema 传给模型。
- 安全执行：工具有并发上限、单工具超时、结果压缩、权限审批和审计记录；写文件、删除、移动、联网、安装、sudo、上传、kill 等操作需要用户确认。
- Provider 韧性：AI SDK Provider 支持超时、fallback 和短期熔断，避免慢失败 Provider 阻塞每次请求。
- 记忆与 Skill：长期记忆使用 SQLite FTS5 和本地 `memory_embeddings` 向量索引；会话摘要会随消息增长刷新；Skill 启动只加载 frontmatter，命中后再读取完整 `SKILL.md`。

### A2UI Surface 概览

- 模型需要 UI 时优先调用 `surface_render`、`media_prepare` 等结构化工具，也可以直接输出 A2UI v0.10 envelope。
- Runtime 会校验 envelope、组件白名单和数据模型路径；失败时把校验错误反馈给模型修复，不渲染不安全或不完整 UI。
- 校验通过后，A2UI 会转换成 `SurfaceSpec`，通过 `ui.surface.create/update` 推给桌面端，由 `SurfaceRenderer` 渲染为卡片、表格、表单、时间线、图表或媒体播放器。
- 用户在 Surface 上点击按钮或提交表单时，action 会带 surface id 回到下一轮 Agent turn，继续走同一套权限、工具和记忆链路。
- 详细流程见 `docs/agent-orchestration.md`。

---

## 本地数据

所有数据完全本地存储，零云端依赖：

| 文件 | 说明 |
|:--|:--|
| `.pet/pet-agentd.sqlite` | 会话、消息、记忆、会话摘要、Skill、工具运行、权限审计等数据 |
| `.pet/ai-provider.json` | 模型 API 配置 |

---
