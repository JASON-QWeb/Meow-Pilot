import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MemoryService } from "./memory/MemoryService";
import { SkillService } from "./skills/SkillService";
import { PetStore } from "./storage";
import { ToolRegistry } from "./tools/ToolRegistry";

function createRuntimeFixture() {
  const dir = mkdtempSync(join(tmpdir(), "pet-agent-runtime-"));
  const store = new PetStore(join(dir, "pet-agentd.sqlite"));
  const memory = new MemoryService(store);
  const skills = new SkillService(store, dir);
  const tools = new ToolRegistry(store, memory, skills, dir);
  return { dir, store, memory, skills, tools };
}

test("ToolRegistry requires confirmation before writing files and executes after approval", async () => {
  const fixture = createRuntimeFixture();
  try {
    const payload = await fixture.tools.invoke({
      name: "file_write",
      input: { path: "notes/agent.txt", content: "hello agent" },
      source: "agent",
    });

    assert.equal(payload.run.status, "pending_permission");
    assert.ok(payload.run.permissionId);
    assert.equal(existsSync(join(fixture.dir, "notes", "agent.txt")), false);

    const resolved = await fixture.tools.resolvePermission(payload.run.permissionId, true);
    assert.ok("run" in resolved);
    assert.equal(resolved.run?.status, "success");
    assert.equal(readFileSync(join(fixture.dir, "notes", "agent.txt"), "utf8"), "hello agent");
    assert.equal(fixture.store.listPermissions("approved").length, 1);
    assert.equal(fixture.store.listToolRuns(10)[0]?.toolName, "file_write");
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("file_patch replaces every matching occurrence after approval", async () => {
  const fixture = createRuntimeFixture();
  try {
    const filePath = join(fixture.dir, "notes.txt");
    writeFileSync(filePath, "alpha beta alpha beta alpha");
    const pending = await fixture.tools.invoke({
      name: "file_patch",
      input: { path: "notes.txt", search: "alpha", replace: "omega" },
      source: "agent",
    });

    assert.equal(pending.run.status, "pending_permission");
    const resolved = await fixture.tools.resolvePermission(pending.run.permissionId!, true);

    assert.ok("run" in resolved);
    assert.equal(resolved.run?.status, "success");
    assert.equal(readFileSync(filePath, "utf8"), "omega beta omega beta omega");
    assert.deepEqual(resolved.result, { path: filePath, replacements: 3 });
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("task_create persists reminders after approval", async () => {
  const fixture = createRuntimeFixture();
  try {
    let changed = false;
    const tools = new ToolRegistry(fixture.store, fixture.memory, fixture.skills, fixture.dir, [], {
      onTaskChanged: () => {
        changed = true;
      },
    });
    const pending = await tools.invoke({
      name: "task_create",
      input: {
        title: "提醒我站起来活动",
        dueAt: "2026-06-01T10:00:00.000Z",
        repeat: "daily",
        channel: "pet",
      },
    });

    assert.equal(pending.run.status, "pending_permission");
    assert.equal(fixture.store.listTasks().length, 0);

    const resolved = await tools.resolvePermission(pending.run.permissionId!, true);
    assert.ok("run" in resolved);
    assert.equal(resolved.run?.status, "success");
    assert.equal(fixture.store.listTasks()[0]?.title, "提醒我站起来活动");
    assert.equal(fixture.store.listTasks()[0]?.repeat, "daily");
    assert.equal(changed, true);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("surface_update writes the patched SurfaceSpec and emits the callback", async () => {
  const fixture = createRuntimeFixture();
  try {
    const session = fixture.store.createSession("surface test", "2026-06-01T00:00:00.000Z");
    const surface = {
      id: "surface_one",
      type: "panel" as const,
      intent: "task" as const,
      title: "旧标题",
      layout: {
        kind: "stack" as const,
        direction: "column" as const,
        gap: "md" as const,
        children: [{ kind: "text" as const, variant: "body" as const, text: "旧内容" }],
      },
      createdAt: "2026-06-01T00:00:00.000Z",
    };
    fixture.store.saveSurface(session.id, surface);

    let emittedTitle = "";
    const tools = new ToolRegistry(fixture.store, fixture.memory, fixture.skills, fixture.dir, [], {
      onSurfaceUpdated: (_sessionId, updated) => {
        emittedTitle = updated.title ?? "";
      },
    });
    const payload = await tools.invoke(
      {
        name: "surface_update",
        input: { surfaceId: surface.id, patch: { title: "新标题", data: { progress: 1 } } },
      },
      { sessionId: session.id },
    );

    assert.equal(payload.run.status, "success");
    assert.equal(fixture.store.getSurface(session.id, surface.id)?.title, "新标题");
    assert.deepEqual(fixture.store.getSurface(session.id, surface.id)?.data, { progress: 1 });
    assert.equal(emittedTitle, "新标题");
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("calendar_read consumes the packaged EventKit helper output", async () => {
  const fixture = createRuntimeFixture();
  const previousHelper = process.env.PET_NATIVE_CALENDAR_HELPER;
  try {
    const helper = join(fixture.dir, "pet-calendar-helper");
    writeFileSync(
      helper,
      [
        "#!/bin/sh",
        "printf '%s\\n' '{\"source\":\"eventkit\",\"available\":true,\"authorizationStatus\":\"fullAccess\",\"range\":{\"start\":\"2026-06-01T00:00:00.000Z\",\"end\":\"2026-06-02T00:00:00.000Z\"},\"events\":[{\"id\":\"event_1\",\"title\":\"设计评审\",\"start\":\"2026-06-01T10:00:00.000Z\",\"end\":\"2026-06-01T10:30:00.000Z\",\"calendar\":\"工作\",\"allDay\":false}],\"summary\":\"读取到 1 个日程。\"}'",
      ].join("\n"),
    );
    chmodSync(helper, 0o755);
    process.env.PET_NATIVE_CALENDAR_HELPER = helper;

    const payload = await fixture.tools.invoke({
      name: "calendar_read",
      input: { start: "2026-06-01T00:00:00.000Z", days: 1 },
      source: "agent",
    });

    assert.equal(payload.run.status, "success");
    assert.equal((payload.result as { source?: string }).source, "eventkit");
    assert.equal((payload.result as { events?: unknown[] }).events?.length, 1);
    assert.equal(payload.run.summary, "读取到 1 个日程。");
  } finally {
    if (previousHelper === undefined) {
      delete process.env.PET_NATIVE_CALENDAR_HELPER;
    } else {
      process.env.PET_NATIVE_CALENDAR_HELPER = previousHelper;
    }
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("ToolRegistry allows read-only terminal commands and holds dangerous commands for approval", async () => {
  const fixture = createRuntimeFixture();
  try {
    const readPayload = await fixture.tools.invoke({
      name: "terminal_exec",
      input: { command: "pwd", cwd: "." },
      source: "agent",
    });
    assert.equal(readPayload.run.status, "success");
    assert.equal(readPayload.run.cwd, fixture.dir);

    const dangerousPayload = await fixture.tools.invoke({
      name: "terminal_exec",
      input: { command: "rm -rf notes", cwd: "." },
      source: "agent",
    });
    assert.equal(dangerousPayload.run.status, "pending_permission");
    assert.ok(dangerousPayload.run.permissionId);
    assert.equal(fixture.store.listPermissions("pending").length, 1);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("ToolRegistry exposes schemas for native AI SDK tool calling", () => {
  const fixture = createRuntimeFixture();
  try {
    const catalog = fixture.tools.catalog();
    assert.ok(catalog.length >= 24);
    assert.equal(catalog.every((item) => item.inputSchema && item.inputSchema.type === "object"), true);
    assert.ok(catalog.some((item) => item.name === "file_list"));
    assert.ok(catalog.some((item) => item.name === "clipboard"));
    assert.ok(catalog.some((item) => item.name === "browser_open"));
    assert.ok(catalog.some((item) => item.name === "system_info"));
    assert.deepEqual(Object.keys(fixture.tools.aiSdkTools()).sort(), catalog.map((item) => item.name).sort());
    assert.deepEqual(Object.keys(fixture.tools.aiSdkTools(["file_read", "web_search"])).sort(), ["file_read", "web_search"]);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("ToolRegistry supports dynamic tool registration", async () => {
  const fixture = createRuntimeFixture();
  try {
    fixture.tools.register({
      summary: {
        name: "dynamic_echo",
        description: "测试动态注册工具。",
        category: "system",
        permissionLevel: "read",
        inputSchema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
          additionalProperties: false,
        },
      },
      run: (input) => ({ output: { text: input.text }, summary: String(input.text ?? "") }),
    });
    assert.ok(fixture.tools.catalog().some((tool) => tool.name === "dynamic_echo"));
    const payload = await fixture.tools.invoke({ name: "dynamic_echo", input: { text: "hello" } });
    assert.equal(payload.run.status, "success");
    assert.deepEqual(payload.result, { text: "hello" });
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("MemoryService and SkillService expose searchable runtime context without loading full skill bodies", () => {
  const fixture = createRuntimeFixture();
  try {
    const proposal = fixture.memory.propose({
      content: "用户喜欢中文界面和清晰的工具审计记录。",
      kind: "user_profile",
      source: "chat",
      confidence: 0.95,
    });
    fixture.memory.commit(proposal, "test", "memory");
    assert.equal(fixture.memory.query("工具审计", ["user_profile"], 4)[0]?.id, proposal.id);

    const skillDir = join(fixture.dir, "skills", "audit-helper");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: audit-helper",
        "description: 汇总工具运行、权限确认和审计记录。",
        "category: dev",
        "permissions:",
        "  - memory:read",
        "  - file:read",
        "tags: audit,runtime",
        "---",
        "只在需要审计工具运行时读取全文。",
      ].join("\n"),
    );

    const skills = fixture.skills.refresh();
    assert.equal(skills.some((skill) => skill.name === "audit-helper"), true);
    assert.equal(fixture.skills.search("审计", 3)[0]?.name, "audit-helper");
    assert.match(fixture.skills.view("audit-helper")?.content ?? "", /只在需要审计工具运行时读取全文/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("SkillService invalidates cached SKILL.md content when the file changes", () => {
  const fixture = createRuntimeFixture();
  try {
    const skillDir = join(fixture.dir, "skills", "cache-helper");
    mkdirSync(skillDir, { recursive: true });
    const skillFile = join(skillDir, "SKILL.md");
    writeFileSync(skillFile, "---\nname: cache-helper\ndescription: cache test\n---\nfirst version\n");
    fixture.skills.refresh();
    assert.match(fixture.skills.view("cache-helper")?.content ?? "", /first version/);

    writeFileSync(skillFile, "---\nname: cache-helper\ndescription: cache test\n---\nsecond version\n");
    assert.match(fixture.skills.view("cache-helper")?.content ?? "", /second version/);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("skill_run executes run.sh only after approval", async () => {
  const fixture = createRuntimeFixture();
  try {
    const skillDir = join(fixture.dir, "skills", "exec-helper");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: exec-helper\ndescription: executable skill\n---\nexec\n");
    const outputPath = join(skillDir, "output.txt");
    writeFileSync(join(skillDir, "run.sh"), `#!/bin/sh\nprintf "%s" "$PET_SKILL_INPUT" > "${outputPath}"\nprintf "ran:%s" "$PET_SKILL_INPUT"\n`);
    chmodSync(join(skillDir, "run.sh"), 0o755);
    fixture.skills.refresh();

    const pending = await fixture.tools.invoke({ name: "skill_run", input: { name: "exec-helper", input: "payload" } });
    assert.equal(pending.run.status, "pending_permission");
    assert.equal(existsSync(outputPath), false);

    const resolved = await fixture.tools.resolvePermission(pending.run.permissionId!, true);
    assert.ok("run" in resolved);
    assert.equal(resolved.run?.status, "success");
    assert.equal(readFileSync(outputPath, "utf8"), "payload");
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});
