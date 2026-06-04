# 当前架构索引

状态：当前实现入口
日期：2026-06-04

本页只作为当前架构文档索引。旧版产品愿景与 MVP 草案已归档到 `docs/archive/architecture-draft-2026-05-21.md`，不再作为当前实现说明。

## 当前主线

- 桌面 Shell：`apps/desktop` 使用 React、Vite 和 Tauri，负责宠物窗口、工作台、聊天、A2UI Surface 渲染、权限面板和本地设置。
- Agent Runtime：`packages/agent-runtime` 是本地 Node.js WebSocket sidecar，负责会话、Agent 编排、工具、记忆、技能、Provider、调度任务和运行时事件。
- 协议层：`packages/protocol` 定义本地 RPC、事件、`SurfaceSpec`、A2UI envelope、工具、记忆、技能和权限类型。
- 本地数据：运行时以 SQLite 保存 session、message、memory、surface、tool run、permission audit、task、skill 和 provider 元数据。
- 内置技能：`skills/bundled` 提供 daily brief、media、search、todo/reminder 等运行时可发现的技能入口。

## 文档入口

| 文档 | 用途 |
|:--|:--|
| `docs/agent-orchestration.md` | 当前 Agent 编排、工具发现、记忆/Skill 上下文、A2UI 和权限审计流程 |
| `docs/delivery-checklist.md` | 当前可交付能力、已验证命令和 Beta 前缺口 |
| `docs/direct-macos-distribution.md` | macOS 直分发、签名、公证和 DMG 流程 |
| `docs/petdex-assets.md` | 内置 Petdex 素材来源、格式和运行时依赖说明 |
| `docs/media-provider-api-test.md` | Vidking 与 Lidarr 媒体 provider 调研和集成建议 |
| `docs/adr/0001-modular-desktop-shell.md` | 桌面 Shell 模块边界 ADR |
| `docs/reviews/social_system_priority.md` | 社交系统当前优先级复评 |

## 历史归档

以下文档保留为历史记录，不代表当前实现状态：

- `docs/archive/architecture-draft-2026-05-21.md`
- `docs/archive/meow_pilot_architecture_review.md`
- `docs/archive/meow_pilot_architecture_todo.md`
- `docs/archive/to_fix.md`

## 维护规则

- README 只保留产品能力和架构大纲，不展开实现参数。
- Agent Runtime、A2UI、工具和记忆策略的实现细节统一更新到 `docs/agent-orchestration.md`。
- 已完成的 review/todo 文档归档到 `docs/archive/`，避免和当前架构入口混用。
