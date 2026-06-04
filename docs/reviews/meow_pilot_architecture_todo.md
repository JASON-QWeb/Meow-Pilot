# Meow Pilot 架构 Review TODO

来源：`docs/reviews/meow_pilot_architecture_review.md`

## P1：功能可用性

- [x] 增加 Runtime 侧 `TaskScheduler`，让定时任务能由后端触发，而不是只存在于前端 `localStorage`。
- [x] 为任务增加持久化能力，补齐 `tasks` 表、CRUD、状态流转和触发记录。
- [x] 将 `task_create` 工具接入真实任务存储，并和后端调度器联动。
- [x] 接入真实日历数据，替换 `calendar_read` 桩实现。优先评估 macOS EventKit 或 `icalBuddy`。
- [x] 实现 `surface_update` 的真实更新能力：写回状态、推送 `ui.surface.update` 事件、刷新已渲染 Surface。
- [x] 补齐缺失的内置 `todo/reminder` 技能，并让它使用真实任务工具链。

## P2：稳定性与可靠性

- [x] 为前端增加 React Error Boundary，至少覆盖聊天、Surface、宠物定制、记忆、技能等主要功能区。
- [x] 为 SQLite 多步写入增加事务保护，优先覆盖记忆保存、技能管理、任务创建、社交交换等关键路径。
- [x] 修复 `file_patch` 只替换首次匹配的问题，改为可控的全量替换或 line-based patch。
- [x] 为 WebSocket RPC 增加基础频率限制，避免异常客户端打爆 Runtime。
- [x] 统一 token 估算逻辑，避免 `ContextBuilder` 和 storage 使用不同规则。
- [x] 扩展 sub-agent 能力，允许传入受限工具子集，例如 `file_read`、`web_search`。

## P3：工程质量

- [x] 为核心前端逻辑补单元测试，优先覆盖 RPC client、Surface renderer、权限审批状态流。
- [x] 为 Runtime 关键服务补测试，优先覆盖 AgentKernel、TaskScheduler、PetStore、ToolRegistry。
- [x] 拆分单体 CSS，按 feature 或组件作用域迁移，降低样式冲突风险。
- [x] 在 CI 中加入 data-policy 检查，例如执行 `pnpm test:data-policy`。
- [x] 在 CI 中加入 Tauri 构建检查，可先设置为允许失败，后续再收紧。
- [x] 评估并逐步引入 i18n 框架，先抽离高频界面文案。

## P4：长期演进

- [x] 拆分 `usePetAgent` 巨型 Hook，按会话、消息、权限、Surface、宠物状态等领域拆成多个 Hook 或 Context。
- [x] 为聊天记录、工具审计、记忆列表等长列表加入虚拟列表。
- [x] 重新评估社交系统优先级；若继续推进，补齐真实消息、技能交换和网络协议。
- [x] 为 Friends 和 Skills 去除硬编码模拟数据，改为完全由运行时或本地数据驱动。

## 建议执行顺序

1. 先做任务后端闭环：`TaskScheduler`、`tasks` 表、`task_create`、`todo/reminder` 技能。
2. 再做日历和 Surface 更新，补齐 daily brief 与动态 UI 的真实能力。
3. 接着补 Error Boundary、SQLite 事务、`file_patch` 修复和 WebSocket 限流。
4. 最后推进测试、CI、CSS 拆分和 `usePetAgent` 拆分。
