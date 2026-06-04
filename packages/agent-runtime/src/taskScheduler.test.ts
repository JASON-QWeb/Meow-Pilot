import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PetStore } from "./storage";
import { TaskScheduler } from "./tasks/TaskScheduler";

test("TaskScheduler triggers due tasks and advances repeat schedules", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pet-task-scheduler-"));
  try {
    const store = new PetStore(join(dir, "pet-agentd.sqlite"));
    const task = store.createTask({
      title: "写日报",
      dueAt: "2026-06-01T10:00:00.000Z",
      repeat: "weekly",
      channel: "chat",
      now: "2026-06-01T09:00:00.000Z",
    });
    const triggered: string[] = [];
    const scheduler = new TaskScheduler(store, (event) => {
      triggered.push(event.task.id);
    });

    await scheduler.tick(new Date("2026-06-01T10:05:00.000Z"));

    const next = store.getTask(task.id);
    assert.deepEqual(triggered, [task.id]);
    assert.equal(next?.dueAt, "2026-06-08T10:00:00.000Z");
    assert.equal(next?.lastTriggeredAt, "2026-06-01T10:05:00.000Z");
    assert.equal(store.listTaskTriggers(task.id).length, 1);

    await scheduler.tick(new Date("2026-06-01T10:06:00.000Z"));
    assert.deepEqual(triggered, [task.id]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
