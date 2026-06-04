import type { ScheduledTask, TaskTriggerRecord } from "@pet/protocol";
import type { PetStore } from "../storage";

export type TaskSchedulerEvent = {
  task: ScheduledTask;
  nextTask: ScheduledTask;
  trigger: TaskTriggerRecord;
};

export class TaskScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly store: PetStore,
    private readonly onDue: (event: TaskSchedulerEvent) => void | Promise<void>,
    private readonly intervalMs = Number(process.env.PET_TASK_SCHEDULER_INTERVAL_MS ?? 30_000),
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, Math.max(5_000, this.intervalMs));
    this.timer.unref?.();
    void this.tick();
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick(now = new Date()) {
    if (this.running) return;
    this.running = true;
    try {
      const dueTasks = this.store.listDueTasks(now);
      for (const task of dueTasks) {
        const event = this.store.withTransaction(() => {
          const trigger = this.store.recordTaskTrigger(task.id, task.channel, "sent", `提醒：${task.title}`, now.toISOString());
          const nextTask = this.store.completeTask(task.id, now.toISOString());
          if (!nextTask) return null;
          return { task, nextTask, trigger };
        });
        if (event) await this.onDue(event);
      }
    } finally {
      this.running = false;
    }
  }
}
