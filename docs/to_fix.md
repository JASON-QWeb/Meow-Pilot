# to_fix 清单

本文档记录本轮安全与 Agent 架构修复项。下方“原文记录”保留用户输入原文；“修复进度”只按实际已完成代码修复打勾。

## 修复进度

- [x] C-3: API Key 明文存储并可能泄露到 Git
- [x] server.ts:204 对客户端返回脱敏错误，详细错误仅记录服务端日志
- [x] A-1: 文本解析工具调用 — 应使用原生 Function Calling
- [x] A-2: 无 Token 计数 / 上下文窗口管理
- [x] A-3: 工具结果注入为 user 角色消息
- [x] A-4: 权限阻塞立即终止整个 Run
- [x] A-5: LLM 生成不流式传输到客户端
- [x] A-6: 无 Provider 重试/降级机制
- [x] A-7: 全部 18 个工具硬编码在单文件
- [x] A-8: 工具无 inputSchema
- [x] A-9: 会话摘要为截断拼接而非 LLM 生成
- [x] A-11: 双重 System Prompt 冲突
- [x] A-12: server.ts 1645 行单体文件
- [x] A-13: 测试覆盖极低
- [x] A-14: 工具顺序执行无并行
- [x] A-15: maxOutputTokens/temperature 硬编码
- [x] A-16: web_fetch 用正则去 HTML 丢失结构
- [x] A-17: DuckDuckGo 搜索脆弱 HTML 抓取
- [x] A-18: 无记忆去重/冲突解决
- [x] A-19: 记忆无容量限制 / 过期不生效
- [x] A-20: Skill 仅 prompt-only 无可执行能力
- [x] A-21: findWorkspaceRoot() 重复 4 次
- [x] A-22: 并发 Agent Run 无互斥
- [x] A-23: Skill 内容缓存无失效
- [x] G-1: 规划与任务分解
- [x] G-2: 自我反思与评估
- [x] G-3: 多模态输入（视觉）
- [x] G-6: MCP 协议支持
- [x] G-7: 结构化输出
- [x] G-8: 多 Agent 协调
- [x] G-9: 结构化日志
- [x] G-10: 缺失关键工具

## 原文记录

```text
C-3: API Key 明文存储并可能泄露到 Git
属性	值
文件	
apiConfig.ts:166
, .pet/ai-provider.json
影响	API Key 被盗、产生未授权费用、数据泄露
API Key 以明文 JSON 写入 .pet/ai-provider.json。虽然文件权限设为 0o600，但：

.pet/ 未在 .gitignore 中——可能被意外提交到 Git
当前 .pet/ai-provider.json 中实际存储了真实 key：sk-21334aeb...
provider.list RPC 通过未认证的 WebSocket 暴露配置信息
apiConfig.ts:510 还从桌面 api.md 文件读取 key——更容易暴露 错误消息泄露内部路径	
server.ts:204
对客户端返回脱敏错误，详细错误仅记录服务端日志IMPORTANT；🔴 CRITICAL
A-1: 文本解析工具调用 — 应使用原生 Function Calling
文件	
AgentKernel.ts:180-198
当前通过正则匹配 ```pet-tool ``` 代码块来解析 LLM 的工具调用。这是最关键的架构缺陷：

LLM 频繁输出格式错误的 JSON、缺少闭合栅栏、或混入文本
parseToolCalls() 静默吞掉解析错误 (catch { continue })
无 JSON Schema 校验工具输入
嵌套代码块可能导致正则失败
所有主流 Provider（OpenAI/Anthropic/Google/xAI/DeepSeek）都支持原生 tool calling，AI SDK 也已内置支持。

diff

// 当前：正则解析文本
- const raw = await this.generate(prompt, messages);
- const calls = parseToolCalls(raw);
// 建议：使用 AI SDK 原生 tools
+ const result = await streamText({
+   model: createLanguageModel(config),
+   system: systemPrompt,
+   messages,
+   tools: {
+     terminal_exec: tool({ parameters: z.object({ command: z.string(), cwd: z.string().optional() }), ... }),
+     file_read: tool({ parameters: z.object({ path: z.string() }), ... }),
+   },
+ });
A-2: 无 Token 计数 / 上下文窗口管理
文件	
ContextBuilder.ts
, 
aiSdk.ts:103-110
系统完全没有 Token 计数或上下文管理：

maxOutputTokens: 2048 硬编码，不区分模型
取最近 12 条消息（slice(-12)）无 token 测量
System prompt (~2000 tokens) + 工具目录 + 记忆 + skill + 用户文本 拼接为一个字符串，无大小保护
工具结果逐轮累积无截断
修复：实现 token 预算系统——估算每部分 token 数，动态裁剪历史、记忆、skill 上下文，确保不超过模型上下文窗口。

🟠 HIGH
#	问题	文件	说明
A-3	工具结果注入为 user 角色消息	
AgentKernel.ts:126-131
应使用 AI SDK 的 tool 角色 + tool_call_id
A-4	权限阻塞立即终止整个 Run	
AgentKernel.ts:106-116
任一工具需审批 → 整轮废弃，无恢复机制。应实现可恢复 Run。
A-5	LLM 生成不流式传输到客户端	
AgentKernel.ts:140-151
onChunk 已存在但从未接线。用户在生成期间无反馈。
A-6	无 Provider 重试/降级机制	
aiSdk.ts:99-118
模型调用失败直接报错，无重试无备选 Provider
A-7	全部 18 个工具硬编码在单文件	
ToolRegistry.ts:199-416
711 行单方法，无插件架构，无动态注册
A-8	工具无 inputSchema	
ToolRegistry.ts:199-416
protocol 定义了 inputSchema 字段但从未使用。LLM 只能猜参数名
A-9	会话摘要为截断拼接而非 LLM 生成	
MemoryService.ts:85-91
取最后 16 条消息 × 160 字截断拼接 ≠ 真正的摘要；A-11	双重 System Prompt 冲突	
aiSdk.ts:55-97
 + 
ContextBuilder.ts:20-38
SYSTEM_PROMPT(system 角色) + ContextBuilder(user 角色) 两套指令可能矛盾
A-12	server.ts 1645 行单体文件	
server.ts
含 36+ RPC handler + 天气/媒体/图表生成 + 工具函数，违反单一职责
A-13	测试覆盖极低	
tools.test.ts
, 
storage.test.ts
仅 2 个测试文件 ~170 行。AgentKernel/ContextBuilder/surfaceProtocol/RPC 零测试
🟡 MEDIUM
#	问题	文件
A-14	工具顺序执行无并行	
AgentKernel.ts:96-124
A-15	maxOutputTokens/temperature 硬编码	
aiSdk.ts:107-108
A-16	web_fetch 用正则去 HTML 丢失结构	
ToolRegistry.ts:394
A-17	DuckDuckGo 搜索脆弱 HTML 抓取	
ToolRegistry.ts:534-548
A-18	无记忆去重/冲突解决	
MemoryService.ts
A-19	记忆无容量限制 / 过期不生效	
storage.ts
A-20	Skill 仅 prompt-only 无可执行能力	
SkillService.ts
A-21	findWorkspaceRoot() 重复 4 次	4 个文件各自复制粘贴
A-22	并发 Agent Run 无互斥	
server.ts:315-320
A-23	Skill 内容缓存无失效	
SkillService.ts:50-59
Part III — 缺失的 Agent 能力 (10 项)
与前沿 Agent 系统（Claude Code、Cursor Agent、AutoGPT、Devin 等）对比，Meow Pilot 缺失以下关键能力：

能力差距矩阵
#	能力	严重度	当前状态	建议方案
G-1	规划与任务分解	🔴 CRITICAL	无。单轮 ≤5 工具循环	工具执行前先让 LLM 生成显式步骤计划，跟踪完成状态，支持计划修订
G-2	自我反思与评估	🟠 HIGH	无	最终回答后添加反思步骤：检查是否充分回答了用户问题
G-3	多模态输入（视觉）	🟠 HIGH	文本 only	支持图片附件，发送 multi-part content 到 vision 模型立即修；G-6	MCP 协议支持	🟠 MEDIUM	自有 WS RPC	通过 @ai-sdk/mcp 接入 MCP 生态
G-7	结构化输出	🟠 MEDIUM	正则解析自由文本	使用 AI SDK 的 generateObject() + Zod Schema
G-8	多 Agent 协调	🟡 MEDIUM	单 Agent	支持子 Agent 委派（研究 Agent、代码 Agent）
G-9	结构化日志	🟠 HIGH	仅一处 console.warn	pino/winston + 请求/工具/LLM 调用全链路日志
G-10	缺失关键工具	🟠 HIGH	18 个工具	补充：file_list、clipboard、notification、browser_open、screenshot、system_info
G-1 规划能力 — 详细说明
当前 Agent 收到用户消息后直接进入"生成 → 解析工具 → 执行 → 回填"循环，最多 5 轮。对于多步骤复杂任务（如"帮我重构这个模块"），完全依赖 LLM 在 5 轮内自行编排——没有显式计划、步骤追踪或计划修订。

Mermaid diagram
建议架构：

Mermaid diagram
G-3 多模态 — 详细说明
aiSdk.ts:235-248
 中 toModelMessages() 仅创建文本内容部分。虽然配置的 Provider 大多支持 vision，但用户无法发送图片。宠物图片抠图功能是独立的，不经过 Agent Kernel复：将 .pet/ 加入 .gitignore。长期使用 macOS Keychain 存储密钥。RPC 返回 key 时使用掩码（如 sk-****a705）。
```
