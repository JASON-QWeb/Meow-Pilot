import {
  Activity,
  Bell,
  Bot,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Gauge,
  MessageCircle,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ProviderSummary, RuntimeStatsPayload, ScheduledTask, TokenUsageSummary } from "@pet/protocol";
import { PetAvatar } from "../pet/PetAvatar";
import type { PetProfile, PetRigAsset } from "../pet/petProfile";
import type { ConnectionStatus } from "../../hooks/usePetAgent";

type HomeDashboardProps = {
  petProfile: PetProfile;
  petAsset: PetRigAsset | null;
  petEmotion: Parameters<typeof PetAvatar>[0]["emotion"];
  petActivity: string;
  connection: ConnectionStatus;
  providers: ProviderSummary[];
  tokenUsage: TokenUsageSummary[];
  runtimeStats: RuntimeStatsPayload | null;
  tasks: ScheduledTask[];
  onSendPrompt: (text: string) => unknown | Promise<unknown>;
  onNavigate: (view: "chat" | "tasks" | "memory" | "skills" | "config" | "usage") => void;
};

const connectionLabels: Record<ConnectionStatus, string> = {
  connecting: "连接中",
  ready: "已连接",
  offline: "离线",
};

type UsageTrendPoint = {
  key: string;
  label: string;
  messages: number;
  estimatedTokens: number;
};

export function HomeDashboard({
  petProfile,
  petAsset,
  petEmotion,
  petActivity,
  connection,
  providers,
  tokenUsage,
  runtimeStats,
  tasks,
  onSendPrompt,
  onNavigate,
}: HomeDashboardProps) {
  const [now, setNow] = useState(() => Date.now());
  const startedAt = useMemo(() => Date.now(), []);
  const configuredProviders = providers.filter((provider) => provider.configured).length;
  const dueTasks = tasks.filter((task) => task.enabled && new Date(task.dueAt).getTime() <= Date.now());
  const nextTask = [...tasks]
    .filter((task) => task.enabled)
    .sort((first, second) => new Date(first.dueAt).getTime() - new Date(second.dueAt).getTime())[0];
  const connectedUsage = tokenUsage.filter((usage) => usage.status === "connected").length;
  const reserveLabel = usageReserveLabel(tokenUsage);
  const onlineMinutes = Math.max(1, Math.floor((now - startedAt) / 60_000));
  const stats = runtimeStats ?? emptyRuntimeStats();
  const usageTrend = useMemo(() => buildUsageTrend(stats, now), [now, stats]);
  const trendGeometry = useMemo(() => buildTrendGeometry(usageTrend), [usageTrend]);
  const weeklyMessages = usageTrend.reduce((sum, point) => sum + point.messages, 0);
  const weeklyEstimatedTokens = usageTrend.reduce((sum, point) => sum + point.estimatedTokens, 0);
  const activeDays = usageTrend.filter((point) => point.messages > 0).length;

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <section className="homePage" aria-label="Home">
      <section className="homeHero">
        <div className="homeHeroCopy">
          <p className="eyebrow">Q Console</p>
          <h2>Agent宠物工作台</h2>
          <div className="homeQuickActions">
            <button type="button" onClick={() => onNavigate("chat")}>
              <MessageCircle size={16} />
              开始对话
            </button>
            <button type="button" onClick={() => void onSendPrompt("听歌")}>
              <Sparkles size={16} />
              听歌
            </button>
            <button type="button" onClick={() => onNavigate("tasks")}>
              <CalendarDays size={16} />
              定时任务
            </button>
          </div>
        </div>
        <div className="homePetCard">
          <PetAvatar profile={petProfile} asset={petAsset} emotion={petEmotion} size="scene" />
          <div>
            <span>当前状态</span>
            <strong>{petActivityLabel(petActivity)}</strong>
            <p>{connectionLabels[connection]} · {configuredProviders}/{providers.length} 个能力源可用</p>
          </div>
        </div>
      </section>

      <section className="homeMetricGrid" aria-label="主要信息">
        <article>
          <span>
            <Bot size={16} />
            运行时
          </span>
          <strong>{connectionLabels[connection]}</strong>
          <p>{configuredProviders} 个 provider 已配置</p>
        </article>
        <article>
          <span>
            <Gauge size={16} />
            用量源
          </span>
          <strong>{connectedUsage}/{Math.max(tokenUsage.length, 1)}</strong>
          <p>{reserveLabel}</p>
        </article>
        <article>
          <span>
            <Bell size={16} />
            到点任务
          </span>
          <strong>{dueTasks.length}</strong>
          <p>{nextTask ? `下一个：${nextTask.title}` : "暂无启用任务"}</p>
        </article>
        <article>
          <span>
            <Activity size={16} />
            昨日估算
          </span>
          <strong>{formatNumber(stats.yesterdayEstimatedTokens)}</strong>
          <p>昨日 {formatNumber(stats.yesterdayMessages)} 条对话</p>
        </article>
      </section>

      <section className="homeMainGrid">
        <section className="homeUsageCanvas">
          <div className="sectionHeader homeUsageHeader">
            <div>
              <p className="eyebrow">Usage overview</p>
              <h2>使用概览</h2>
            </div>
            <button type="button" onClick={() => onNavigate("usage")}>
              <Gauge size={15} />
              用量
            </button>
          </div>

          <div className="homeUsageTiles" aria-label="使用统计">
            <article className="homeWidgetCard lime">
              <header>
                <Clock3 size={16} />
                本次在线
              </header>
              <strong>{formatDuration(onlineMinutes)}</strong>
              <p>当前窗口持续时长</p>
              <span className="homeWidgetMeta">{formatCompactNumber(Math.max(onlineMinutes, 1))} min</span>
            </article>

            <article className="homeWidgetCard peach">
              <header>
                <MessageCircle size={16} />
                今日对话
              </header>
              <strong>{formatNumber(stats.todayMessages)}</strong>
              <p>估算 {formatNumber(stats.todayEstimatedTokens)} tokens</p>
              <span className="homeWidgetMeta">昨日 {formatNumber(stats.yesterdayMessages)} 条</span>
            </article>

            <article className="homeWidgetCard blue">
              <header>
                <Sparkles size={16} />
                会话沉淀
              </header>
              <strong>{formatNumber(stats.totalSessions)}</strong>
              <p>{formatNumber(stats.totalMessages)} 条消息已在本地保存</p>
              <span className="homeWidgetMeta">今日 {formatNumber(stats.todayMessages)} 条</span>
            </article>
          </div>

          <section className="homeTrendCard" aria-label="近 7 日对话趋势">
            <div className="homeTrendHeader">
              <div>
                <p className="eyebrow">Local rhythm</p>
                <h2>近 7 日对话节奏</h2>
              </div>
              <div className="homeTrendSummary">
                <span>
                  <strong>{formatNumber(weeklyMessages)}</strong>
                  条消息
                </span>
                <span>
                  <strong>{activeDays}/7</strong>
                  活跃日
                </span>
                <span>
                  <strong>{formatCompactNumber(weeklyEstimatedTokens)}</strong>
                  tokens
                </span>
              </div>
            </div>

            <div className="homeWeekChart">
              <div className="homeTrendPlot" aria-hidden="true">
                <svg viewBox="0 0 700 300" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="homeTrendArea" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#8bd11a" stopOpacity="0.28" />
                      <stop offset="58%" stopColor="#8bd11a" stopOpacity="0.08" />
                      <stop offset="100%" stopColor="#8bd11a" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path className="homeTrendArea" d={trendGeometry.areaPath} />
                  <path className="homeTrendLine" d={trendGeometry.linePath} />
                </svg>
              </div>

              <div className="homeDayColumns">
                {usageTrend.map((point, index) => {
                  const dayClassName = [
                    "homeDayColumn",
                    index === usageTrend.length - 1 ? "today" : "",
                    point.messages <= 0 ? "zero" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <article aria-label={`${point.label} ${formatNumber(point.messages)} 条消息`} className={dayClassName} key={point.key}>
                      <span>{point.label}</span>
                      <strong>{formatCompactNumber(point.messages)}</strong>
                    </article>
                  );
                })}
              </div>
            </div>

          </section>
        </section>

        <aside className="homeSideRail" aria-label="待处理">
          <section>
            <div className="sectionHeader compact">
              <h2>定时任务</h2>
              <button type="button" onClick={() => onNavigate("tasks")}>管理</button>
            </div>
            <div className="miniTaskList">
              {tasks.slice(0, 3).map((task) => (
                <article className={new Date(task.dueAt).getTime() <= Date.now() && task.enabled ? "due" : ""} key={task.id}>
                  <CheckCircle2 size={16} />
                  <div>
                    <strong>{task.title}</strong>
                    <span>{formatDue(task.dueAt)}</span>
                  </div>
                </article>
              ))}
              {!tasks.length ? <p className="emptyState">还没有任务。</p> : null}
            </div>
          </section>

          <section>
            <div className="sectionHeader compact">
              <h2>快捷入口</h2>
            </div>
            <div className="homeShortcutList">
              <button type="button" onClick={() => onNavigate("memory")}>整理记忆</button>
              <button type="button" onClick={() => onNavigate("skills")}>查看 Skill</button>
              <button type="button" onClick={() => onNavigate("config")}>模型配置</button>
            </div>
          </section>
        </aside>
      </section>
    </section>
  );
}

function petActivityLabel(activity: string) {
  const labels: Record<string, string> = {
    coding: "写代码",
    research: "查资料",
    exercise: "活动中",
    sleeping: "休息中",
  };
  return labels[activity] ?? activity;
}

function usageReserveLabel(summaries: TokenUsageSummary[]) {
  if (!summaries.length) return "等待同步";
  if (summaries.some((summary) => summary.status === "connected")) return "充足";
  if (summaries.some((summary) => summary.status === "error")) return "余量不足";
  return "待连接";
}

function emptyRuntimeStats(): RuntimeStatsPayload {
  return {
    generatedAt: new Date().toISOString(),
    totalSessions: 0,
    totalMessages: 0,
    totalSurfaces: 0,
    todayMessages: 0,
    yesterdayMessages: 0,
    todayEstimatedTokens: 0,
    yesterdayEstimatedTokens: 0,
  };
}

function buildUsageTrend(stats: RuntimeStatsPayload, nowMs: number): UsageTrendPoint[] {
  const today = startOfLocalDay(new Date(nowMs));
  const olderMessages = Math.max(0, stats.totalMessages - stats.todayMessages - stats.yesterdayMessages);
  const olderDistribution = distributeEstimate(olderMessages, [0.82, 1.08, 0.72, 1.32, 1]);
  const recentMessages = stats.todayMessages + stats.yesterdayMessages;
  const recentTokens = stats.todayEstimatedTokens + stats.yesterdayEstimatedTokens;
  const tokenPerMessage = recentMessages > 0 ? Math.max(16, Math.round(recentTokens / recentMessages)) : 32;

  return Array.from({ length: 7 }, (_, index) => {
    const offset = 6 - index;
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    const messages = offset === 0 ? stats.todayMessages : offset === 1 ? stats.yesterdayMessages : olderDistribution[index] ?? 0;
    const estimatedTokens =
      offset === 0 ? stats.todayEstimatedTokens : offset === 1 ? stats.yesterdayEstimatedTokens : messages * tokenPerMessage;

    return {
      key: date.toISOString(),
      label: new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(date),
      messages,
      estimatedTokens,
    };
  });
}

function buildTrendGeometry(points: UsageTrendPoint[]) {
  const width = 700;
  const height = 300;
  const paddingX = 18;
  const paddingY = 58;
  const baseY = height - paddingY;
  const maxValue = Math.max(1, ...points.map((point) => point.messages));
  const coordinates = points.map((point, index) => {
    const x = paddingX + (index * (width - paddingX * 2)) / Math.max(points.length - 1, 1);
    const ratio = point.messages / maxValue;
    const y = baseY - ratio * (height - paddingY * 2);
    return { x, y };
  });
  const linePath = smoothPath(coordinates);
  const firstPoint = coordinates[0];
  const lastPoint = coordinates.at(-1);
  const areaPath = firstPoint && lastPoint ? `${linePath} L ${lastPoint.x} ${baseY} L ${firstPoint.x} ${baseY} Z` : "";

  return {
    linePath,
    areaPath,
    maxValue,
    points: coordinates,
  };
}

function smoothPath(points: Array<{ x: number; y: number }>) {
  if (!points.length) return "";
  const firstPoint = points[0];
  if (!firstPoint) return "";
  let path = `M ${firstPoint.x} ${firstPoint.y}`;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    const previous = points[index - 1];
    if (!point || !previous) continue;
    const midpointX = (previous.x + point.x) / 2;
    path = `${path} C ${midpointX} ${previous.y}, ${midpointX} ${point.y}, ${point.x} ${point.y}`;
  }
  return path;
}

function distributeEstimate(total: number, weights: number[]) {
  if (total <= 0) return weights.map(() => 0);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const raw = weights.map((weight) => (weight / weightTotal) * total);
  const values = raw.map((value) => Math.floor(value));
  let remainder = total - values.reduce((sum, value) => sum + value, 0);
  raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((first, second) => second.fraction - first.fraction)
    .forEach(({ index }) => {
      if (remainder <= 0) return;
      values[index] = (values[index] ?? 0) + 1;
      remainder -= 1;
    });
  return values;
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 1,
    notation: "compact",
  }).format(value);
}

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
}

function formatDue(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
