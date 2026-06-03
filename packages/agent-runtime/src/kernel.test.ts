import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AgentKernel } from "./kernel/AgentKernel";
import { ContextBuilder } from "./kernel/ContextBuilder";
import { MemoryService } from "./memory/MemoryService";
import { SkillService } from "./skills/SkillService";
import { PetStore } from "./storage";
import { ToolRegistry } from "./tools/ToolRegistry";

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

function createFixture() {
  const dir = mkdtempSync(join(tmpdir(), "pet-kernel-"));
  const store = new PetStore(join(dir, "pet-agentd.sqlite"));
  const memory = new MemoryService(store);
  const skills = new SkillService(store, dir);
  const tools = new ToolRegistry(store, memory, skills, dir);
  const contextBuilder = new ContextBuilder(store, memory, skills, () => tools.catalog());
  return { dir, store, memory, skills, tools, contextBuilder };
}

test("ContextBuilder includes tool schemas context without requiring a model", async () => {
  const fixture = createFixture();
  try {
    const session = fixture.store.createSession("上下文测试", new Date().toISOString());
    const context = await fixture.contextBuilder.build({ session, userText: "读取 README", history: [] });
    assert.match(context.context, /Meow Pilot/);
    assert.match(context.context, /file_read/);
    assert.equal(context.recentHistory.length, 0);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("AgentKernel returns a clear configuration message when no model is configured", async () => {
  await withNoModelConfig(async () => {
    const fixture = createFixture();
    try {
      const session = fixture.store.createSession("Agent 测试", new Date().toISOString());
      const events: Array<{ event: string; payload: unknown }> = [];
      const kernel = new AgentKernel({
        store: fixture.store,
        memory: fixture.memory,
        tools: fixture.tools,
        contextBuilder: fixture.contextBuilder,
        emit: (event, payload) => {
          events.push({ event, payload });
        },
      });
      const result = await kernel.run(session, "run_test", "你好");
      assert.match(result?.message.content ?? "", /还没有可用的模型 API 配置/);
      assert.equal(events.some((item) => item.event === "agent.lifecycle"), true);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });
});
