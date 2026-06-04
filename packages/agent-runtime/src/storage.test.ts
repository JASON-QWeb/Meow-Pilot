import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ChatMessage, Memory } from "@pet/protocol";
import { MemoryService } from "./memory/MemoryService";
import { PetStore } from "./storage";

function withNoModelConfig<T>(fn: () => Promise<T>) {
  const keys = [
    "PET_AI_CONFIG_PATH",
    "PET_AI_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "GOOGLE_API_KEY",
    "XAI_API_KEY",
    "DEEPSEEK_API_KEY",
    "OPENROUTER_API_KEY",
    "OPENAI_COMPATIBLE_API_KEY",
    "PET_API_MD_PATH",
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  process.env.PET_AI_CONFIG_PATH = join(tmpdir(), `missing-${crypto.randomUUID()}.json`);
  return fn().finally(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function makeMessages(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `msg_${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `第 ${index + 1} 条消息，用于验证摘要刷新。`,
    createdAt: new Date(2026, 5, 1, 0, index).toISOString(),
  }));
}

test("PetStore persists sessions, messages, and derives runtime stats from the database", () => {
  const dir = mkdtempSync(join(tmpdir(), "pet-store-"));
  const dbPath = join(dir, "pet-agentd.sqlite");
  const runtimeStatsPath = join(dir, "runtime-stats.json");
  const previousOverride = process.env.PET_RUNTIME_STATS_PATH;
  process.env.PET_RUNTIME_STATS_PATH = runtimeStatsPath;
  writeFileSync(
    runtimeStatsPath,
    JSON.stringify({
      totalSessions: 999,
      totalMessages: 999,
      todayMessages: 999,
    }),
  );

  try {
    const store = new PetStore(dbPath);
    const session = store.createSession("真实会话", "2026-06-01T02:00:00.000Z");
    const userMessage: ChatMessage = {
      id: "msg_user",
      role: "user",
      content: "今天帮我整理真实任务",
      createdAt: "2026-06-01T02:01:00.000Z",
    };
    const assistantMessage: ChatMessage = {
      id: "msg_assistant",
      role: "assistant",
      content: "已记录到本地数据库。",
      createdAt: "2026-05-31T02:01:00.000Z",
    };

    store.saveMessage(session.id, userMessage);
    store.saveMessage(session.id, assistantMessage);

    const messages = store.listMessages(session.id);
    assert.equal(messages.length, 2);
    assert.deepEqual(
      messages.map((message) => message.content).sort(),
      [assistantMessage.content, userMessage.content].sort(),
    );

    const stats = store.getRuntimeStats(new Date("2026-06-01T12:00:00.000Z"));
    assert.equal(stats.totalSessions, 1);
    assert.equal(stats.totalMessages, 2);
    assert.equal(stats.todayMessages, 1);
    assert.equal(stats.yesterdayMessages, 1);
    assert.ok(stats.todayEstimatedTokens > 0);
    assert.ok(stats.yesterdayEstimatedTokens > 0);
  } finally {
    if (previousOverride === undefined) {
      delete process.env.PET_RUNTIME_STATS_PATH;
    } else {
      process.env.PET_RUNTIME_STATS_PATH = previousOverride;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PetStore deduplicates memories and hides expired memories", () => {
  const dir = mkdtempSync(join(tmpdir(), "pet-store-memory-"));
  const dbPath = join(dir, "pet-agentd.sqlite");

  try {
    const store = new PetStore(dbPath);
    const base: Memory = {
      id: "mem_one",
      kind: "semantic",
      scope: "private",
      content: "用户希望默认使用中文文档。",
      confidence: 0.9,
      source: "chat",
      createdAt: "2026-06-01T00:00:00.000Z",
    };
    store.saveMemory(base);
    store.saveMemory({ ...base, id: "mem_duplicate", confidence: 0.95 });
    store.saveMemory({
      ...base,
      id: "mem_expired",
      content: "这是一条已经过期的记忆。",
      expiresAt: "2020-01-01T00:00:00.000Z",
    });

    const memories = store.listMemories();
    assert.equal(memories.filter((memory) => memory.content === base.content).length, 1);
    assert.equal(memories.some((memory) => memory.id === "mem_expired"), false);
    assert.equal(store.queryMemories("已经过期", undefined, 5).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PetStore ranks memory vector matches before falling back to literal search", () => {
  const dir = mkdtempSync(join(tmpdir(), "pet-store-memory-vector-"));
  const dbPath = join(dir, "pet-agentd.sqlite");

  try {
    const store = new PetStore(dbPath);
    const base: Memory = {
      id: "mem_docs",
      kind: "semantic",
      scope: "private",
      content: "用户希望项目文档默认使用中文。",
      confidence: 0.9,
      source: "chat",
      createdAt: "2026-06-01T00:00:00.000Z",
    };
    store.saveMemory(base);
    store.saveMemory({
      ...base,
      id: "mem_music",
      content: "用户喜欢晚上听轻音乐。",
    });

    assert.equal(store.queryMemories("中文文档", undefined, 5)[0]?.id, "mem_docs");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("MemoryService refreshes session summaries after additional messages", async () => {
  await withNoModelConfig(async () => {
    const dir = mkdtempSync(join(tmpdir(), "pet-store-summary-"));
    const dbPath = join(dir, "pet-agentd.sqlite");

    try {
      const store = new PetStore(dbPath);
      const memory = new MemoryService(store);
      const session = store.createSession("摘要刷新", "2026-06-01T00:00:00.000Z");
      const firstBatch = makeMessages(18);
      const firstSummary = await memory.ensureSessionSummary(session.id, firstBatch);
      const firstRecord = store.getSessionSummaryRecord(session.id);
      assert.ok(firstSummary);
      assert.equal(firstRecord?.messageCount, 18);

      const secondSummary = await memory.ensureSessionSummary(session.id, makeMessages(38));
      const secondRecord = store.getSessionSummaryRecord(session.id);
      assert.ok(secondSummary);
      assert.equal(secondRecord?.messageCount, 38);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("PetStore persists scheduled tasks and advances repeating tasks", () => {
  const dir = mkdtempSync(join(tmpdir(), "pet-store-tasks-"));
  const dbPath = join(dir, "pet-agentd.sqlite");

  try {
    const store = new PetStore(dbPath);
    const task = store.createTask({
      title: "整理今日待办",
      dueAt: "2026-06-01T09:00:00.000Z",
      repeat: "daily",
      channel: "chat",
      note: "只提醒一次",
      now: "2026-06-01T08:00:00.000Z",
    });

    assert.equal(store.listTasks().length, 1);
    assert.equal(store.listDueTasks(new Date("2026-06-01T09:01:00.000Z"))[0]?.id, task.id);

    const trigger = store.recordTaskTrigger(task.id, task.channel, "sent", "提醒已发送", "2026-06-01T09:01:00.000Z");
    const next = store.completeTask(task.id, "2026-06-01T09:01:00.000Z");

    assert.equal(trigger.taskId, task.id);
    assert.equal(next?.enabled, true);
    assert.equal(next?.dueAt, "2026-06-02T09:00:00.000Z");
    assert.equal(store.listTaskTriggers(task.id).length, 1);

    const updated = store.updateTask(task.id, { completedAt: "2026-06-01T10:00:00.000Z" });
    assert.equal(updated?.repeat, "daily");
    assert.equal(updated?.channel, "chat");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
