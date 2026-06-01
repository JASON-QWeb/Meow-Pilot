import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ChatMessage } from "@pet/protocol";
import { PetStore } from "./storage";

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
