# 交付检查清单

状态：当前本地构建可作为 macOS `.app` 开发包交付，包含 local-first 运行时能力。

## 已交付

- Monorepo 拆分为 protocol、agent runtime 和 desktop shell 三个包。
- 本地 WebSocket 协议，支持 request/response/event。
- 生成式 UI surface schema 和 React renderer。
- 宠物自定义：名称、形状、配饰、色板和桌面宠物形象均可持久化。
- 本地图像头像工作室：图片导入、透明三层 rig 生成、预览/调参确认、图层导出、IndexedDB 素材持久化和用户主动删除。
- 由运行时事件驱动的桌面宠物状态，包含编码、查询、运动和休息状态，并复用自定义分层头像。
- Tauri 双窗口形态：`pet` 透明置顶常驻桌面，`work` 工作窗口由点击宠物打开，关闭时隐藏。
- 使用本地 SQLite 持久化 session、message、memory 和生成式 surface。
- 基于 AI SDK 的模型 provider router，支持 OpenAI、Anthropic、Google Gemini、xAI、DeepSeek、OpenRouter 和 OpenAI-compatible endpoint。
- 配置页 `模型 API` 面板可直接保存 provider、API key、模型和 Base URL 到本机 `.pet/ai-provider.json`。
- 语音回合：麦克风录音、AI SDK/OpenAI 转写、AI SDK/OpenAI TTS 自动回复播放，以及系统语音兜底。
- Provider discovery 覆盖 AI SDK API providers 和 Codex/Claude CLI bridge。
- 内置 skill catalog，提供 daily brief、music、video 和 search surface 的可执行入口。
- Hermes/OpenClaw 迁移扫描器和本地记忆/人格文本导入路径；secret 不会自动导入。
- 本地账号、添加好友和隐私保护的宠物交换记录流程。
- Tauri 原生壳，可打包为 macOS `.app`，并随包携带 agent runtime 单文件 bundle。
- 原生 bundle 图标集已生成。

## 已验证

- `pnpm typecheck`
- `pnpm build`
- `pnpm migrate:scan`
- `pnpm migrate:import`，使用隔离临时 fixture
- `pnpm --filter @pet/desktop tauri:build`
- 桌面 UI 运行时：
  - Tauri `.app` 可完成 app bundle 构建；
  - 宠物自定义会更新可见产品状态；
  - 图片头像工作室可导入合成 QA 图片，生成三层预览并暴露调参/确认控件，且不持久化测试素材；
  - 桌面宠物窗口和工作窗口在 Tauri 配置中分离；
  - 宠物窗口保持透明、置顶、可拖拽；
  - 点击宠物可打开工作窗口；
  - 生成的日程 surface 在 reload 后仍保留。

## Beta 前缺口

- 当前 Node runtime 中 `node:sqlite` 仍是实验能力；Beta 前需选择接受风险的 Node 版本，或切换为随包 SQLite 库。
- 打包应用已由 Tauri 拉起本地 runtime bundle；公开分发前仍需把 Node runtime 一起内嵌，避免依赖用户机器已有 `node`。
- 语音回合目前等待录音完成和 TTS 合成；唤醒词、打断和低延迟流式语音尚未包含。
- 技能当前通过运行时 planner 运行；三方技能市场化前仍需补沙箱执行、签名和权限审计。
- 账号/好友交换仍是 local-first 脚手架；公开 Beta 前需要生产云端 auth、好友中继、端到端策略和风控。
- App Store 分发仍需要 Apple Developer 签名、sandbox entitlements、hardened runtime、privacy manifest、公证和 App Store Review 打包。
