---
name: todo-reminder
description: Create, review, and update local todos and reminders through the task runtime.
permissions:
  task: create
  task: read
---

# Todo Reminder

## When to Use

Use when the user asks to create a todo, set a reminder, track a deadline, review open tasks, or reschedule a reminder.

## Procedure

1. For new reminders, call `task_create` with a clear title, ISO `dueAt` when known, repeat rule, channel, and short note when useful.
2. If the user gives a vague time, ask one concise follow-up before creating the task.
3. Prefer `pet` channel for lightweight nudges, `chat` for work reminders, and `voice` only when the user explicitly asks for spoken reminders.
4. Never claim a reminder was created unless `task_create` returns a persisted task.
5. For daily planning, combine task context with `calendar_read` and render a task or calendar Surface when helpful.
