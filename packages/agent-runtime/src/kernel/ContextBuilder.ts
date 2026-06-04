import type { ChatMessage, SkillSummary, ToolSummary } from "@pet/protocol";
import type { MemoryService } from "../memory/MemoryService";
import type { SkillService } from "../skills/SkillService";
import type { PetStore, RuntimeSession } from "../storage";
import { estimateTokens } from "../tokens";

export class ContextBuilder {
  constructor(
    private readonly store: PetStore,
    private readonly memory: MemoryService,
    private readonly skills: SkillService,
    private readonly tools: () => ToolSummary[],
  ) {}

  async build(params: { session: RuntimeSession; userText: string; history: ChatMessage[]; abortSignal?: AbortSignal }) {
    const tokenBudget = contextTokenBudget();
    const sessionSummary = await this.memory.ensureSessionSummary(params.session.id, params.history, params.abortSignal);
    const relevantMemories = takeWithinBudget(this.memory.query(params.userText, undefined, 12), tokenBudget * 0.18, (memory) => memory.content);
    const candidateSkills = takeWithinBudget(this.skills.search(params.userText, 8), tokenBudget * 0.12, (skill) => `${skill.name} ${skill.description}`);
    const recentHistory = trimHistory(params.history.filter((message) => message.role !== "system"), tokenBudget * 0.38);

    const context = [
      "你是 Meow Pilot 的本地桌面宠物 Agent Runtime。",
      "你可以直接回答，也可以通过原生工具调用请求 runtime 执行工具。危险工具会先请求用户确认。",
      "不要声称已经执行工具，除非工具结果明确返回成功。",
      "如果工具返回 pending_permission，说明正在等待用户授权；不要重复请求同一个危险操作。",
      "",
      "可用工具：",
      ...this.tools().map((tool) => `- ${tool.name} (${tool.permissionLevel}): ${tool.description}`),
      "",
      sessionSummary ? `会话摘要：\n${sessionSummary}` : "",
      relevantMemories.length ? `相关长期记忆：\n${relevantMemories.map((memory) => `- [${memory.kind}/${memory.scope}] ${memory.content}`).join("\n")}` : "",
      candidateSkills.length ? `候选 Skill：\n${formatSkills(candidateSkills)}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      context,
      recentHistory,
      relevantMemories,
      candidateSkills,
    };
  }
}

function formatSkills(skills: SkillSummary[]) {
  return skills
    .map((skill) => `- ${skill.name}: ${skill.description} 权限=${skill.permissions.join(", ") || "none"}`)
    .join("\n");
}

function trimHistory(history: ChatMessage[], budget: number) {
  const trimmed: ChatMessage[] = [];
  let used = 0;
  for (const message of [...history].reverse()) {
    const cost = estimateTokens(message.content);
    if (trimmed.length && used + cost > budget) break;
    trimmed.push(message);
    used += cost;
  }
  return trimmed.reverse();
}

function takeWithinBudget<T>(items: T[], budget: number, text: (item: T) => string) {
  const result: T[] = [];
  let used = 0;
  for (const item of items) {
    const cost = estimateTokens(text(item));
    if (result.length && used + cost > budget) break;
    result.push(item);
    used += cost;
  }
  return result;
}

function contextTokenBudget() {
  const configured = Number(process.env.PET_CONTEXT_TOKEN_BUDGET);
  return Number.isFinite(configured) && configured > 4096 ? Math.floor(configured) : 24_000;
}
