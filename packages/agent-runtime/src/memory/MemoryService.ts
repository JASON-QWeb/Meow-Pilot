import type { ChatMessage, Memory } from "@pet/protocol";
import { generateSessionSummaryWithAiSdk } from "../providers/aiSdk";
import type { PetStore } from "../storage";

export class MemoryService {
  constructor(private readonly store: PetStore) {}

  query(query?: string, kinds?: Memory["kind"][], limit = 8) {
    return this.store.queryMemories(query, kinds, limit);
  }

  propose(params: {
    sessionId?: string;
    content: string;
    kind?: Memory["kind"];
    scope?: Memory["scope"];
    source?: Memory["source"];
    confidence?: number;
    sourceId?: string;
  }): Memory {
    const now = new Date().toISOString();
    return {
      id: `mem_${crypto.randomUUID()}`,
      kind: params.kind ?? "semantic",
      scope: params.scope ?? "private",
      content: params.content.trim(),
      summary: summarizeMemory(params.content),
      confidence: params.confidence ?? 0.72,
      source: params.source ?? "chat",
      sourceType: params.source ?? "chat",
      sourceId: params.sourceId ?? params.sessionId,
      visibility: "local_only",
      createdAt: now,
      updatedAt: now,
    };
  }

  commit(memory: Memory, sourceType?: string, sourceId?: string) {
    const normalized: Memory = {
      ...memory,
      summary: memory.summary ?? summarizeMemory(memory.content),
      visibility: memory.visibility ?? "local_only",
      updatedAt: new Date().toISOString(),
    };
    this.store.withTransaction(() => {
      this.store.saveMemory(normalized);
      if (sourceType && sourceId) {
        this.store.linkMemory(normalized.id, sourceType, sourceId);
      }
    });
    return normalized;
  }

  extractExplicitMemory(message: string, sessionId: string): Memory | null {
    const match = message.match(/(?:记住|帮我记住|请记住|以后记得|remember this)[:：]?\s*(.+)$/is);
    const content = match?.[1]?.trim();
    if (!content || content.length < 3) return null;
    return this.propose({
      sessionId,
      content,
      kind: inferMemoryKind(content),
      scope: "private",
      source: "chat",
      confidence: 0.94,
    });
  }

  async ensureSessionSummary(sessionId: string, messages: ChatMessage[], abortSignal?: AbortSignal) {
    const existing = this.store.getSessionSummary(sessionId);
    if (existing || messages.length < 18) return existing;
    const summary = (await generateSessionSummaryWithAiSdk(messages, abortSignal).catch(() => null)) ?? summarizeSession(messages);
    this.store.saveSessionSummary(sessionId, summary);
    return summary;
  }
}

function inferMemoryKind(content: string): Memory["kind"] {
  if (/称呼|叫我|偏好|喜欢|不喜欢|习惯|风格/.test(content)) return "user_profile";
  if (/宠物|人格|语气|说话/.test(content)) return "pet_note";
  if (/步骤|流程|方法|以后这样做/.test(content)) return "procedural";
  return "semantic";
}

function summarizeMemory(content: string) {
  return content.replace(/\s+/g, " ").trim().slice(0, 160);
}

function summarizeSession(messages: ChatMessage[]) {
  const useful = messages
    .filter((message) => message.role !== "system")
    .slice(-16)
    .map((message) => `${message.role === "user" ? "用户" : "宠物"}：${message.content.replace(/\s+/g, " ").slice(0, 160)}`);
  return useful.join("\n").slice(0, 1_800);
}
