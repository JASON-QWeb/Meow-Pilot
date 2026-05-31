import { Bell, CalendarDays, Check, Clock, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

export type ScheduledTaskRepeat = "once" | "daily" | "weekly";

export type ScheduledTask = {
  id: string;
  title: string;
  dueAt: string;
  repeat: ScheduledTaskRepeat;
  channel: "pet" | "chat" | "voice";
  enabled: boolean;
  createdAt: string;
  completedAt?: string;
};

type ScheduledTasksPanelProps = {
  tasks: ScheduledTask[];
  onChange: (tasks: ScheduledTask[]) => void;
};

const repeatLabels: Record<ScheduledTaskRepeat, string> = {
  once: "一次",
  daily: "每天",
  weekly: "每周",
};

const channelLabels: Record<ScheduledTask["channel"], string> = {
  pet: "宠物提醒",
  chat: "聊天提醒",
  voice: "语音提醒",
};

export function ScheduledTasksPanel({ tasks, onChange }: ScheduledTasksPanelProps) {
  const defaultDue = nextHourInputValue();
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState(defaultDue);
  const [repeat, setRepeat] = useState<ScheduledTaskRepeat>("once");
  const [channel, setChannel] = useState<ScheduledTask["channel"]>("pet");

  const sortedTasks = useMemo(
    () => [...tasks].sort((first, second) => new Date(first.dueAt).getTime() - new Date(second.dueAt).getTime()),
    [tasks],
  );
  const dueCount = sortedTasks.filter((task) => task.enabled && new Date(task.dueAt).getTime() <= Date.now()).length;

  return (
    <section className="taskPage" aria-label="定时任务">
      <section className="taskComposerPanel">
        <div className="panelTitle">
          <span className="titleIcon green">
            <Clock size={24} />
          </span>
          <div>
            <p className="eyebrow">Schedule</p>
            <h2>定时任务</h2>
          </div>
        </div>

        <div className="taskStats">
          <article>
            <span>全部任务</span>
            <strong>{tasks.length}</strong>
          </article>
          <article>
            <span>当前到点</span>
            <strong>{dueCount}</strong>
          </article>
        </div>

        <form
          className="taskForm"
          onSubmit={(event) => {
            event.preventDefault();
            addTask();
          }}
        >
          <label className="spanTwo">
            <span>任务内容</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：18:30 提醒我休息眼睛" />
          </label>
          <label>
            <span>提醒时间</span>
            <input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
          </label>
          <label>
            <span>重复</span>
            <select value={repeat} onChange={(event) => setRepeat(event.target.value as ScheduledTaskRepeat)}>
              <option value="once">一次</option>
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
            </select>
          </label>
          <label>
            <span>提醒方式</span>
            <select value={channel} onChange={(event) => setChannel(event.target.value as ScheduledTask["channel"])}>
              <option value="pet">宠物提醒</option>
              <option value="chat">聊天提醒</option>
              <option value="voice">语音提醒</option>
            </select>
          </label>
          <button className="taskAddButton" type="submit">
            <Plus size={16} />
            添加任务
          </button>
        </form>
      </section>

      <section className="taskListPanel">
        <div className="taskListHeader">
          <h3>任务列表</h3>
          <span>{dueCount ? `${dueCount} 个任务到点` : "没有到点任务"}</span>
        </div>
        <div className="taskList">
          {sortedTasks.map((task) => {
            const due = task.enabled && new Date(task.dueAt).getTime() <= Date.now();
            return (
              <article className={`taskCard ${due ? "due" : ""} ${task.enabled ? "" : "disabled"}`} key={task.id}>
                <div className="taskCardIcon">
                  {due ? <Bell size={19} /> : <CalendarDays size={19} />}
                </div>
                <div>
                  <h3>{task.title}</h3>
                  <p>
                    {formatDue(task.dueAt)} · {repeatLabels[task.repeat]} · {channelLabels[task.channel]}
                  </p>
                </div>
                <div className="taskCardActions">
                  <button type="button" title="完成一次" onClick={() => completeTask(task.id)}>
                    <Check size={16} />
                  </button>
                  <button type="button" title="删除" onClick={() => deleteTask(task.id)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            );
          })}
          {!sortedTasks.length ? <p className="emptyState">还没有定时任务。添加一个提醒后，助手会在本机记住它。</p> : null}
        </div>
      </section>
    </section>
  );

  function addTask() {
    const value = title.trim();
    if (!value || !dueAt) return;
    const task: ScheduledTask = {
      id: `task_${crypto.randomUUID()}`,
      title: value,
      dueAt: new Date(dueAt).toISOString(),
      repeat,
      channel,
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    onChange([task, ...tasks]);
    setTitle("");
    setDueAt(nextHourInputValue());
    setRepeat("once");
    setChannel("pet");
  }

  function completeTask(taskId: string) {
    onChange(
      tasks.map((task) => {
        if (task.id !== taskId) return task;
        if (task.repeat === "daily") return { ...task, dueAt: addDays(task.dueAt, 1), completedAt: new Date().toISOString() };
        if (task.repeat === "weekly") return { ...task, dueAt: addDays(task.dueAt, 7), completedAt: new Date().toISOString() };
        return { ...task, enabled: false, completedAt: new Date().toISOString() };
      }),
    );
  }

  function deleteTask(taskId: string) {
    onChange(tasks.filter((task) => task.id !== taskId));
  }
}

export function createDefaultTasks(): ScheduledTask[] {
  const now = Date.now();
  return [
    {
      id: "task_water_break",
      title: "喝水和活动肩颈",
      dueAt: new Date(now + 42 * 60_000).toISOString(),
      repeat: "daily",
      channel: "pet",
      enabled: true,
      createdAt: new Date(now - 3_600_000).toISOString(),
    },
    {
      id: "task_evening_review",
      title: "整理今天未完成事项",
      dueAt: new Date(now + 4 * 3_600_000).toISOString(),
      repeat: "daily",
      channel: "chat",
      enabled: true,
      createdAt: new Date(now - 7_200_000).toISOString(),
    },
  ];
}

function formatDue(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function nextHourInputValue() {
  const date = new Date(Date.now() + 3_600_000);
  date.setMinutes(0, 0, 0);
  return toInputValue(date);
}

function toInputValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function addDays(value: string, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}
