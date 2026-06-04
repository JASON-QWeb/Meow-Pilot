import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AccountProfile,
  ChatMessage,
  FriendSummary,
  Memory,
  PermissionRequest,
  RuntimeStatsPayload,
  ScheduledTask,
  SessionSummary,
  SkillSummary,
  SocialExchangeRecord,
  SurfaceSpec,
  TaskTriggerRecord,
  ToolRunRecord,
} from "@pet/protocol";
import { findWorkspaceRoot } from "./workspace";
import { estimateTokens } from "./tokens";

export type RuntimeSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

type SessionRow = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  role: ChatMessage["role"];
  content: string;
  created_at: string;
  run_id: string | null;
  surface_json?: string | null;
  attachments_json?: string | null;
};

type MemoryRow = {
  id: string;
  kind: Memory["kind"];
  scope: Memory["scope"];
  content: string;
  summary?: string | null;
  confidence: number;
  source: Memory["source"];
  source_type?: Memory["sourceType"] | null;
  source_id?: string | null;
  visibility?: Memory["visibility"] | null;
  pii_tags_json?: string | null;
  created_at: string;
  updated_at?: string | null;
  expires_at?: string | null;
};

type SurfaceRow = {
  spec_json: string;
};

type TaskRow = {
  id: string;
  title: string;
  due_at: string;
  repeat: ScheduledTask["repeat"];
  channel: ScheduledTask["channel"];
  enabled: number;
  note: string | null;
  created_at: string;
  updated_at: string | null;
  completed_at: string | null;
  last_triggered_at: string | null;
};

type TaskTriggerRow = {
  id: string;
  task_id: string;
  triggered_at: string;
  channel: ScheduledTask["channel"];
  status: TaskTriggerRecord["status"];
  summary: string | null;
};

type SessionSummaryRow = SessionRow & {
  message_count: number;
};

type AccountRow = {
  id: string;
  handle: string;
  display_name: string;
  avatar_seed: string;
  created_at: string;
};

type FriendRow = {
  id: string;
  handle: string;
  display_name: string;
  status: FriendSummary["status"];
  pet_name: string | null;
  last_exchange_at: string | null;
};

type SocialExchangeRow = {
  id: string;
  friend_id: string;
  direction: SocialExchangeRecord["direction"];
  summary: string;
  shared_skills_json: string;
  shared_memory_count: number;
  created_at: string;
};

type RuntimeStatsRow = {
  total_sessions: number;
  total_messages: number;
  total_surfaces: number;
};

type MessageContentRow = {
  content: string;
  created_at: string;
};

type SessionSummaryTextRow = {
  summary: string;
};

type ToolRunRow = {
  id: string;
  session_id: string | null;
  run_id: string | null;
  tool_name: string;
  input_json: string;
  output_json: string | null;
  status: ToolRunRecord["status"];
  permission_id: string | null;
  exit_code: number | null;
  cwd: string | null;
  created_at: string;
  completed_at: string | null;
  summary: string | null;
  risk: string | null;
};

type PermissionRow = {
  id: string;
  session_id: string | null;
  run_id: string | null;
  tool_name: string;
  title: string;
  description: string;
  permission_level: PermissionRequest["permissionLevel"];
  risk: string;
  input_json: string;
  diff: string | null;
  command: string | null;
  cwd: string | null;
  status: PermissionRequest["status"];
  created_at: string;
  resolved_at: string | null;
};

type SkillRow = {
  name: string;
  description: string;
  category: string;
  permissions_json: string;
  enabled: number;
  path: string | null;
  source: SkillSummary["source"] | null;
  version: string | null;
  tags_json: string | null;
  quarantined: number;
  last_used_at: string | null;
  updated_at: string;
};

type SkillRunRow = {
  id: string;
  name: string;
  session_id: string | null;
  run_id: string | null;
  input: string | null;
  status: string;
  result_json: string | null;
  created_at: string;
  completed_at: string | null;
};

const defaultDbPath = resolve(findWorkspaceRoot(), ".pet", "pet-agentd.sqlite");
const DEFAULT_MEMORY_LIMIT = 1_000;
const legacyTemplateAssistantMessages = [
  "我准备了一个音乐播放面板。当前走本地技能外壳，接入 Spotify / Apple Music / 本地媒体后会直接播放和管理队列。",
  "视频面板已准备好。这里可以承载 YouTube、Bilibili 或本地文件播放，并挂接字幕、摘要和笔记技能。",
  "我生成了今天的日程面板。真实日历接入后，会只分享摘要给好友宠物，不泄露原始详情。",
  "我生成了一个查询面板。它支持卡片、表格、保存和继续追问，适合承接 web/search skill 的结果。",
  "这条信息适合放进用户画像。我已经生成记忆提案，你确认后再写入。",
  "链路已跑通：宠物状态、聊天流、生成式 UI surface 都通过本地 WebSocket 协议更新。",
];

export class PetStore {
  private readonly db: DatabaseSync;
  private transactionDepth = 0;

  constructor(dbPath = process.env.PET_AGENTD_DB ?? defaultDbPath) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
    this.seedDefaults();
  }

  getLatestSession() {
    const row = this.db.prepare("SELECT id, title, created_at, updated_at FROM sessions ORDER BY updated_at DESC LIMIT 1").get() as SessionRow | undefined;
    return row ? toSession(row) : null;
  }

  withTransaction<T>(fn: () => T): T {
    if (this.transactionDepth > 0) {
      this.transactionDepth += 1;
      try {
        return fn();
      } finally {
        this.transactionDepth -= 1;
      }
    }

    this.db.exec("BEGIN IMMEDIATE");
    this.transactionDepth = 1;
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.transactionDepth = 0;
    }
  }

  getSession(id: string) {
    const row = this.db.prepare("SELECT id, title, created_at, updated_at FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
    return row ? toSession(row) : null;
  }

  listSessions(): SessionSummary[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            sessions.id,
            sessions.title,
            sessions.created_at,
            sessions.updated_at,
            COUNT(messages.id) AS message_count
          FROM sessions
          LEFT JOIN messages ON messages.session_id = sessions.id
          GROUP BY sessions.id
          ORDER BY sessions.updated_at DESC, sessions.created_at DESC
        `,
      )
      .all() as SessionSummaryRow[];

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: row.message_count,
    }));
  }

  createSession(title: string, now = new Date().toISOString()) {
    const session: RuntimeSession = {
      id: `ses_${crypto.randomUUID()}`,
      title,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare("INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(session.id, session.title, session.createdAt, session.updatedAt);
    return session;
  }

  touchSession(sessionId: string, now = new Date().toISOString()) {
    this.db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, sessionId);
  }

  deleteSession(sessionId: string) {
    const result = this.db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
    return result.changes > 0;
  }

  listMessages(sessionId: string): ChatMessage[] {
    const rows = this.db
      .prepare("SELECT id, role, content, created_at, run_id, surface_json, attachments_json FROM messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC")
      .all(sessionId) as MessageRow[];

    return rows.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
      runId: row.run_id ?? undefined,
      surface: parseOptionalJson<SurfaceSpec>(row.surface_json),
      attachments: parseOptionalJson<ChatMessage["attachments"]>(row.attachments_json),
    }));
  }

  saveMessage(sessionId: string, message: ChatMessage) {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO messages (id, session_id, role, content, created_at, run_id, surface_json, attachments_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        message.id,
        sessionId,
        message.role,
        message.content,
        message.createdAt,
        message.runId ?? null,
        message.surface ? JSON.stringify(message.surface) : null,
        message.attachments ? JSON.stringify(message.attachments) : null,
      );
    this.touchSession(sessionId, message.createdAt);
  }

  listMemories(): Memory[] {
    const now = new Date().toISOString();
    const rows = this.db
      .prepare(
        `
          SELECT id, kind, scope, content, summary, confidence, source, source_type, source_id,
                 visibility, pii_tags_json, created_at, updated_at, expires_at
          FROM memories
          WHERE expires_at IS NULL OR expires_at > ?
          ORDER BY created_at DESC, rowid DESC
        `,
      )
      .all(now) as MemoryRow[];

    return rows.map(toMemory);
  }

  queryMemories(query?: string, kinds?: Memory["kind"][], limit = 8): Memory[] {
    const normalizedLimit = Math.max(1, Math.min(limit, 24));
    const kindSet = new Set(kinds ?? []);
    const filterKinds = (memory: Memory) => (kindSet.size ? kindSet.has(memory.kind) : true);

    if (query?.trim()) {
      const escaped = query
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => part.replace(/["']/g, ""))
        .join(" OR ");
      try {
        const rows = this.db
          .prepare(
            `
              SELECT m.id, m.kind, m.scope, m.content, m.summary, m.confidence, m.source,
                     m.source_type, m.source_id, m.visibility, m.pii_tags_json,
                     m.created_at, m.updated_at, m.expires_at
              FROM memories_fts f
              JOIN memories m ON m.id = f.id
              WHERE memories_fts MATCH ?
                AND (m.expires_at IS NULL OR m.expires_at > ?)
              ORDER BY rank
              LIMIT ?
            `,
          )
          .all(escaped || query.trim(), new Date().toISOString(), normalizedLimit * 2) as MemoryRow[];
        const matches = rows.map(toMemory).filter(filterKinds).slice(0, normalizedLimit);
        if (matches.length) return matches;
      } catch {
        // Fallback below if FTS is unavailable or query syntax is too broad.
      }

      const needle = query.trim().toLowerCase();
      return this.listMemories()
        .filter(filterKinds)
        .filter((memory) => `${memory.content} ${memory.summary ?? ""}`.toLowerCase().includes(needle))
        .slice(0, normalizedLimit);
    }

    return this.listMemories().filter(filterKinds).slice(0, normalizedLimit);
  }

  saveMemory(memory: Memory) {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare("SELECT id, created_at FROM memories WHERE kind = ? AND scope = ? AND lower(content) = lower(?) LIMIT 1")
      .get(memory.kind, memory.scope, memory.content) as { id: string; created_at: string } | undefined;
    const savedMemory: Memory = {
      ...memory,
      id: existing?.id ?? memory.id,
      createdAt: existing?.created_at ?? memory.createdAt,
      updatedAt: now,
    };
    this.db
      .prepare(
        `
          INSERT OR REPLACE INTO memories (
            id, kind, scope, content, summary, confidence, source, source_type, source_id,
            visibility, pii_tags_json, created_at, updated_at, expires_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        savedMemory.id,
        savedMemory.kind,
        savedMemory.scope,
        savedMemory.content,
        savedMemory.summary ?? null,
        savedMemory.confidence,
        savedMemory.source,
        savedMemory.sourceType ?? savedMemory.source,
        savedMemory.sourceId ?? null,
        savedMemory.visibility ?? "local_only",
        savedMemory.piiTags ? JSON.stringify(savedMemory.piiTags) : null,
        savedMemory.createdAt,
        savedMemory.updatedAt ?? now,
        savedMemory.expiresAt ?? null,
      );
    this.indexMemory(savedMemory);
    this.enforceMemoryLimit();
  }

  linkMemory(memoryId: string, sourceType: string, sourceId: string, now = new Date().toISOString()) {
    this.db
      .prepare("INSERT OR IGNORE INTO memory_links (memory_id, source_type, source_id, created_at) VALUES (?, ?, ?, ?)")
      .run(memoryId, sourceType, sourceId, now);
  }

  getSessionSummary(sessionId: string): string | null {
    const row = this.db
      .prepare("SELECT summary FROM session_summaries WHERE session_id = ? ORDER BY updated_at DESC LIMIT 1")
      .get(sessionId) as SessionSummaryTextRow | undefined;
    return row?.summary ?? null;
  }

  saveSessionSummary(sessionId: string, summary: string, now = new Date().toISOString()) {
    this.db
      .prepare("INSERT OR REPLACE INTO session_summaries (session_id, summary, updated_at) VALUES (?, ?, ?)")
      .run(sessionId, summary, now);
  }

  listToolRuns(limit = 40): ToolRunRecord[] {
    const rows = this.db
      .prepare(
        `
          SELECT id, session_id, run_id, tool_name, input_json, output_json, status, permission_id,
                 exit_code, cwd, created_at, completed_at, summary, risk
          FROM tool_runs
          ORDER BY created_at DESC, rowid DESC
          LIMIT ?
        `,
      )
      .all(Math.max(1, Math.min(limit, 200))) as ToolRunRow[];
    return rows.map(toToolRun);
  }

  getToolRunByPermission(permissionId: string): ToolRunRecord | null {
    const row = this.db
      .prepare(
        `
          SELECT id, session_id, run_id, tool_name, input_json, output_json, status, permission_id,
                 exit_code, cwd, created_at, completed_at, summary, risk
          FROM tool_runs
          WHERE permission_id = ?
          ORDER BY created_at DESC, rowid DESC
          LIMIT 1
        `,
      )
      .get(permissionId) as ToolRunRow | undefined;
    return row ? toToolRun(row) : null;
  }

  saveToolRun(run: ToolRunRecord) {
    this.db
      .prepare(
        `
          INSERT OR REPLACE INTO tool_runs (
            id, session_id, run_id, tool_name, input_json, output_json, status, permission_id,
            exit_code, cwd, created_at, completed_at, summary, risk
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        run.id,
        run.sessionId ?? null,
        run.runId ?? null,
        run.toolName,
        JSON.stringify(run.input ?? {}),
        run.output === undefined ? null : JSON.stringify(run.output),
        run.status,
        run.permissionId ?? null,
        run.exitCode ?? null,
        run.cwd ?? null,
        run.createdAt,
        run.completedAt ?? null,
        run.summary ?? null,
        run.risk ?? null,
      );
  }

  listPermissions(status?: PermissionRequest["status"], limit = 50): PermissionRequest[] {
    const rows = (
      status
        ? this.db
            .prepare(
              `
                SELECT id, session_id, run_id, tool_name, title, description, permission_level, risk,
                       input_json, diff, command, cwd, status, created_at, resolved_at
                FROM permissions_audit
                WHERE status = ?
                ORDER BY created_at DESC, rowid DESC
                LIMIT ?
              `,
            )
            .all(status, Math.max(1, Math.min(limit, 200)))
        : this.db
            .prepare(
              `
                SELECT id, session_id, run_id, tool_name, title, description, permission_level, risk,
                       input_json, diff, command, cwd, status, created_at, resolved_at
                FROM permissions_audit
                ORDER BY created_at DESC, rowid DESC
                LIMIT ?
              `,
            )
            .all(Math.max(1, Math.min(limit, 200)))
    ) as PermissionRow[];
    return rows.map(toPermission);
  }

  getPermission(id: string): PermissionRequest | null {
    const row = this.db
      .prepare(
        `
          SELECT id, session_id, run_id, tool_name, title, description, permission_level, risk,
                 input_json, diff, command, cwd, status, created_at, resolved_at
          FROM permissions_audit
          WHERE id = ?
        `,
      )
      .get(id) as PermissionRow | undefined;
    return row ? toPermission(row) : null;
  }

  savePermission(request: PermissionRequest) {
    this.db
      .prepare(
        `
          INSERT OR REPLACE INTO permissions_audit (
            id, session_id, run_id, tool_name, title, description, permission_level, risk,
            input_json, diff, command, cwd, status, created_at, resolved_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        request.id,
        request.sessionId ?? null,
        request.runId ?? null,
        request.toolName,
        request.title,
        request.description,
        request.permissionLevel,
        request.risk,
        JSON.stringify(request.input ?? {}),
        request.diff ?? null,
        request.command ?? null,
        request.cwd ?? null,
        request.status,
        request.createdAt,
        request.resolvedAt ?? null,
      );
  }

  resolvePermission(id: string, status: "approved" | "denied", now = new Date().toISOString()): PermissionRequest | null {
    this.db.prepare("UPDATE permissions_audit SET status = ?, resolved_at = ? WHERE id = ?").run(status, now, id);
    return this.getPermission(id);
  }

  upsertSkill(skill: SkillSummary, now = new Date().toISOString()) {
    this.db
      .prepare(
        `
          INSERT OR REPLACE INTO skills (
            name, description, category, permissions_json, enabled, path, source,
            version, tags_json, quarantined, last_used_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        skill.name,
        skill.description,
        skill.category,
        JSON.stringify(skill.permissions ?? []),
        skill.enabled ? 1 : 0,
        skill.path ?? null,
        skill.source ?? null,
        skill.version ?? null,
        skill.tags ? JSON.stringify(skill.tags) : null,
        skill.quarantined ? 1 : 0,
        skill.lastUsedAt ?? null,
        now,
      );
  }

  listSkills(): SkillSummary[] {
    const rows = this.db
      .prepare(
        `
          SELECT name, description, category, permissions_json, enabled, path, source,
                 version, tags_json, quarantined, last_used_at, updated_at
          FROM skills
          ORDER BY quarantined ASC, enabled DESC, category ASC, name ASC
        `,
      )
      .all() as SkillRow[];
    return rows.map(toSkill);
  }

  getSkill(name: string): SkillSummary | null {
    const row = this.db
      .prepare(
        `
          SELECT name, description, category, permissions_json, enabled, path, source,
                 version, tags_json, quarantined, last_used_at, updated_at
          FROM skills
          WHERE name = ?
        `,
      )
      .get(name) as SkillRow | undefined;
    return row ? toSkill(row) : null;
  }

  setSkillState(name: string, updates: { enabled?: boolean; quarantined?: boolean; lastUsedAt?: string }) {
    const current = this.getSkill(name);
    if (!current) return null;
    const next: SkillSummary = {
      ...current,
      enabled: updates.enabled ?? current.enabled,
      quarantined: updates.quarantined ?? current.quarantined,
      lastUsedAt: updates.lastUsedAt ?? current.lastUsedAt,
    };
    this.upsertSkill(next);
    return next;
  }

  saveSkillRun(params: {
    id: string;
    name: string;
    sessionId?: string;
    runId?: string;
    input?: string;
    status: string;
    result?: unknown;
    createdAt: string;
    completedAt?: string;
  }) {
    this.db
      .prepare(
        `
          INSERT OR REPLACE INTO skill_runs (
            id, name, session_id, run_id, input, status, result_json, created_at, completed_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        params.id,
        params.name,
        params.sessionId ?? null,
        params.runId ?? null,
        params.input ?? null,
        params.status,
        params.result === undefined ? null : JSON.stringify(params.result),
        params.createdAt,
        params.completedAt ?? null,
      );
  }

  listSurfaces(sessionId: string): SurfaceSpec[] {
    const rows = this.db
      .prepare("SELECT spec_json FROM surfaces WHERE session_id = ? ORDER BY created_at DESC, rowid DESC")
      .all(sessionId) as SurfaceRow[];

    return rows.map((row) => JSON.parse(row.spec_json) as SurfaceSpec);
  }

  getSurface(sessionId: string, surfaceId: string): SurfaceSpec | null {
    const row = this.db
      .prepare("SELECT spec_json FROM surfaces WHERE session_id = ? AND id = ?")
      .get(sessionId, surfaceId) as SurfaceRow | undefined;
    return row ? (JSON.parse(row.spec_json) as SurfaceSpec) : null;
  }

  getRuntimeStats(now = new Date()): RuntimeStatsPayload {
    const totals = this.db
      .prepare(
        `
          SELECT
            (SELECT COUNT(*) FROM sessions) AS total_sessions,
            (SELECT COUNT(*) FROM messages) AS total_messages,
            (SELECT COUNT(*) FROM surfaces) AS total_surfaces
        `,
      )
      .get() as RuntimeStatsRow;
    const rows = this.db.prepare("SELECT content, created_at FROM messages WHERE role != ?").all("system") as MessageContentRow[];
    const todayKey = localDateKey(now);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = localDateKey(yesterday);
    let todayMessages = 0;
    let yesterdayMessages = 0;
    let todayEstimatedTokens = 0;
    let yesterdayEstimatedTokens = 0;

    for (const row of rows) {
      const key = localDateKey(new Date(row.created_at));
      if (key !== todayKey && key !== yesterdayKey) continue;
      const tokens = estimateTokens(row.content);
      if (key === todayKey) {
        todayMessages += 1;
        todayEstimatedTokens += tokens;
      } else {
        yesterdayMessages += 1;
        yesterdayEstimatedTokens += tokens;
      }
    }

    return {
      generatedAt: now.toISOString(),
      totalSessions: totals.total_sessions,
      totalMessages: totals.total_messages,
      totalSurfaces: totals.total_surfaces,
      todayMessages,
      yesterdayMessages,
      todayEstimatedTokens,
      yesterdayEstimatedTokens,
    };
  }

  saveSurface(sessionId: string, surface: SurfaceSpec) {
    this.db
      .prepare("INSERT OR REPLACE INTO surfaces (id, session_id, type, intent, title, spec_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(surface.id, sessionId, surface.type, surface.intent, surface.title ?? null, JSON.stringify(surface), surface.createdAt, new Date().toISOString());
    this.touchSession(sessionId);
  }

  updateSurface(sessionId: string, surface: SurfaceSpec) {
    const existing = this.getSurface(sessionId, surface.id);
    if (!existing) return null;
    this.saveSurface(sessionId, surface);
    return surface;
  }

  listTasks(): ScheduledTask[] {
    const rows = this.db
      .prepare(
        `
          SELECT id, title, due_at, repeat, channel, enabled, note, created_at,
                 updated_at, completed_at, last_triggered_at
          FROM tasks
          ORDER BY enabled DESC, due_at ASC, created_at DESC
        `,
      )
      .all() as TaskRow[];
    return rows.map(toTask);
  }

  getTask(taskId: string): ScheduledTask | null {
    const row = this.db
      .prepare(
        `
          SELECT id, title, due_at, repeat, channel, enabled, note, created_at,
                 updated_at, completed_at, last_triggered_at
          FROM tasks
          WHERE id = ?
        `,
      )
      .get(taskId) as TaskRow | undefined;
    return row ? toTask(row) : null;
  }

  createTask(params: {
    title: string;
    dueAt?: string;
    repeat?: ScheduledTask["repeat"];
    channel?: ScheduledTask["channel"];
    note?: string;
    enabled?: boolean;
    now?: string;
  }): ScheduledTask {
    const now = params.now ?? new Date().toISOString();
    const task: ScheduledTask = {
      id: `task_${crypto.randomUUID()}`,
      title: params.title.trim(),
      dueAt: normalizeDueAt(params.dueAt, now),
      repeat: normalizeRepeat(params.repeat),
      channel: normalizeChannel(params.channel),
      enabled: params.enabled ?? true,
      note: params.note?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    this.saveTask(task);
    return task;
  }

  updateTask(taskId: string, updates: Partial<Pick<ScheduledTask, "title" | "dueAt" | "repeat" | "channel" | "enabled" | "note" | "completedAt">>, now = new Date().toISOString()) {
    const current = this.getTask(taskId);
    if (!current) return null;
    const next: ScheduledTask = {
      ...current,
      ...("title" in updates ? { title: (updates.title ?? current.title).trim() || current.title } : {}),
      ...("dueAt" in updates ? { dueAt: normalizeDueAt(updates.dueAt, current.dueAt) } : {}),
      ...("repeat" in updates ? { repeat: normalizeRepeat(updates.repeat) } : {}),
      ...("channel" in updates ? { channel: normalizeChannel(updates.channel) } : {}),
      ...("enabled" in updates ? { enabled: Boolean(updates.enabled) } : {}),
      ...("note" in updates ? { note: updates.note?.trim() || undefined } : {}),
      ...("completedAt" in updates ? { completedAt: updates.completedAt ?? undefined } : {}),
      updatedAt: now,
    };
    this.saveTask(next);
    return next;
  }

  completeTask(taskId: string, now = new Date().toISOString()) {
    const task = this.getTask(taskId);
    if (!task) return null;
    const next = advanceTaskAfterTrigger(task, now);
    this.saveTask(next);
    return next;
  }

  deleteTask(taskId: string) {
    const result = this.db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId);
    return result.changes > 0;
  }

  listDueTasks(now = new Date()): ScheduledTask[] {
    const rows = this.db
      .prepare(
        `
          SELECT id, title, due_at, repeat, channel, enabled, note, created_at,
                 updated_at, completed_at, last_triggered_at
          FROM tasks
          WHERE enabled = 1
            AND due_at <= ?
            AND (last_triggered_at IS NULL OR last_triggered_at < due_at)
          ORDER BY due_at ASC, created_at ASC
          LIMIT 20
        `,
      )
      .all(now.toISOString()) as TaskRow[];
    return rows.map(toTask);
  }

  recordTaskTrigger(taskId: string, channel: ScheduledTask["channel"], status: TaskTriggerRecord["status"], summary?: string, now = new Date().toISOString()) {
    const record: TaskTriggerRecord = {
      id: `tasktr_${crypto.randomUUID()}`,
      taskId,
      channel,
      status,
      summary,
      triggeredAt: now,
    };
    this.db
      .prepare("INSERT INTO task_triggers (id, task_id, triggered_at, channel, status, summary) VALUES (?, ?, ?, ?, ?, ?)")
      .run(record.id, record.taskId, record.triggeredAt, record.channel, record.status, record.summary ?? null);
    return record;
  }

  listTaskTriggers(taskId?: string, limit = 80): TaskTriggerRecord[] {
    const boundedLimit = Math.max(1, Math.min(limit, 200));
    const rows = (
      taskId
        ? this.db
            .prepare("SELECT id, task_id, triggered_at, channel, status, summary FROM task_triggers WHERE task_id = ? ORDER BY triggered_at DESC LIMIT ?")
            .all(taskId, boundedLimit)
        : this.db
            .prepare("SELECT id, task_id, triggered_at, channel, status, summary FROM task_triggers ORDER BY triggered_at DESC LIMIT ?")
            .all(boundedLimit)
    ) as TaskTriggerRow[];
    return rows.map(toTaskTrigger);
  }

  saveTask(task: ScheduledTask) {
    this.db
      .prepare(
        `
          INSERT INTO tasks (
            id, title, due_at, repeat, channel, enabled, note,
            created_at, updated_at, completed_at, last_triggered_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            due_at = excluded.due_at,
            repeat = excluded.repeat,
            channel = excluded.channel,
            enabled = excluded.enabled,
            note = excluded.note,
            updated_at = excluded.updated_at,
            completed_at = excluded.completed_at,
            last_triggered_at = excluded.last_triggered_at
        `,
      )
      .run(
        task.id,
        task.title,
        task.dueAt,
        task.repeat,
        task.channel,
        task.enabled ? 1 : 0,
        task.note ?? null,
        task.createdAt,
        task.updatedAt ?? null,
        task.completedAt ?? null,
        task.lastTriggeredAt ?? null,
      );
  }

  getCurrentAccount(): AccountProfile | null {
    const row = this.db.prepare("SELECT id, handle, display_name, avatar_seed, created_at FROM accounts ORDER BY created_at ASC LIMIT 1").get() as AccountRow | undefined;
    return row ? toAccount(row) : null;
  }

  signInLocal(displayName: string, handle?: string, now = new Date().toISOString()): AccountProfile {
    const normalizedHandle = normalizeHandle(handle || displayName);
    const existing = this.getCurrentAccount();
    const account: AccountProfile = {
      id: existing?.id ?? `acct_${crypto.randomUUID()}`,
      handle: normalizedHandle,
      displayName: displayName.trim(),
      avatarSeed: existing?.avatarSeed ?? crypto.randomUUID().slice(0, 8),
      createdAt: existing?.createdAt ?? now,
    };
    this.db
      .prepare("INSERT OR REPLACE INTO accounts (id, handle, display_name, avatar_seed, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(account.id, account.handle, account.displayName, account.avatarSeed, account.createdAt);
    return account;
  }

  listFriends(): FriendSummary[] {
    const rows = this.db
      .prepare("SELECT id, handle, display_name, status, pet_name, last_exchange_at FROM friends ORDER BY last_exchange_at IS NULL ASC, last_exchange_at DESC, display_name ASC")
      .all() as FriendRow[];
    return rows.map(toFriend);
  }

  getFriend(id: string): FriendSummary | null {
    const row = this.db
      .prepare("SELECT id, handle, display_name, status, pet_name, last_exchange_at FROM friends WHERE id = ?")
      .get(id) as FriendRow | undefined;
    return row ? toFriend(row) : null;
  }

  addFriend(handle: string, displayName?: string, petName?: string, now = new Date().toISOString()): FriendSummary {
    const normalizedHandle = normalizeHandle(handle);
    const existing = this.db
      .prepare("SELECT id, handle, display_name, status, pet_name, last_exchange_at FROM friends WHERE handle = ?")
      .get(normalizedHandle) as FriendRow | undefined;
    const friend: FriendSummary = existing
      ? {
          ...toFriend(existing),
          displayName: displayName?.trim() || existing.display_name,
          petName: petName?.trim() || existing.pet_name || undefined,
        }
      : {
          id: `fr_${crypto.randomUUID()}`,
          handle: normalizedHandle,
          displayName: displayName?.trim() || normalizedHandle,
          status: "accepted",
          petName: petName?.trim() || undefined,
        };

    this.db
      .prepare("INSERT OR REPLACE INTO friends (id, handle, display_name, status, pet_name, last_exchange_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(friend.id, friend.handle, friend.displayName, friend.status, friend.petName ?? null, friend.lastExchangeAt ?? null, now);
    return friend;
  }

  recordSocialExchange(friendId: string, summary: string, sharedSkills: string[], sharedMemoryCount: number, now = new Date().toISOString()): SocialExchangeRecord {
    return this.withTransaction(() => {
      const exchange: SocialExchangeRecord = {
        id: `sx_${crypto.randomUUID()}`,
        friendId,
        direction: "local",
        summary,
        sharedSkills,
        sharedMemoryCount,
        createdAt: now,
      };
      this.db
        .prepare("INSERT INTO social_exchanges (id, friend_id, direction, summary, shared_skills_json, shared_memory_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(exchange.id, exchange.friendId, exchange.direction, exchange.summary, JSON.stringify(exchange.sharedSkills), exchange.sharedMemoryCount, exchange.createdAt);
      this.db.prepare("UPDATE friends SET last_exchange_at = ? WHERE id = ?").run(now, friendId);
      return exchange;
    });
  }

  listSocialExchanges(friendId?: string): SocialExchangeRecord[] {
    const rows = (
      friendId
        ? this.db
            .prepare("SELECT id, friend_id, direction, summary, shared_skills_json, shared_memory_count, created_at FROM social_exchanges WHERE friend_id = ? ORDER BY created_at DESC")
            .all(friendId)
        : this.db
            .prepare("SELECT id, friend_id, direction, summary, shared_skills_json, shared_memory_count, created_at FROM social_exchanges ORDER BY created_at DESC")
            .all()
    ) as SocialExchangeRow[];
    return rows.map(toSocialExchange);
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        run_id TEXT,
        surface_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages(session_id, created_at);

      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        scope TEXT NOT NULL,
        content TEXT NOT NULL,
        summary TEXT,
        confidence REAL NOT NULL,
        source TEXT NOT NULL,
        source_type TEXT,
        source_id TEXT,
        visibility TEXT,
        pii_tags_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        expires_at TEXT
      );

      CREATE TABLE IF NOT EXISTS memory_links (
        memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (memory_id, source_type, source_id)
      );

      CREATE TABLE IF NOT EXISTS session_summaries (
        session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
        summary TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS surfaces (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        intent TEXT NOT NULL,
        title TEXT,
        spec_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_surfaces_session_created ON surfaces(session_id, created_at);

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        due_at TEXT NOT NULL,
        repeat TEXT NOT NULL,
        channel TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        completed_at TEXT,
        last_triggered_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_enabled_due ON tasks(enabled, due_at);

      CREATE TABLE IF NOT EXISTS task_triggers (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        triggered_at TEXT NOT NULL,
        channel TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_task_triggers_task_created ON task_triggers(task_id, triggered_at);

      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        handle TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        avatar_seed TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS friends (
        id TEXT PRIMARY KEY,
        handle TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        status TEXT NOT NULL,
        pet_name TEXT,
        last_exchange_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS social_exchanges (
        id TEXT PRIMARY KEY,
        friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
        direction TEXT NOT NULL,
        summary TEXT NOT NULL,
        shared_skills_json TEXT NOT NULL,
        shared_memory_count INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_social_exchanges_friend_created ON social_exchanges(friend_id, created_at);

      CREATE TABLE IF NOT EXISTS tool_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        run_id TEXT,
        tool_name TEXT NOT NULL,
        input_json TEXT NOT NULL,
        output_json TEXT,
        status TEXT NOT NULL,
        permission_id TEXT,
        exit_code INTEGER,
        cwd TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        summary TEXT,
        risk TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_tool_runs_created ON tool_runs(created_at);
      CREATE INDEX IF NOT EXISTS idx_tool_runs_session ON tool_runs(session_id, created_at);

      CREATE TABLE IF NOT EXISTS permissions_audit (
        id TEXT PRIMARY KEY,
        session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        run_id TEXT,
        tool_name TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        permission_level TEXT NOT NULL,
        risk TEXT NOT NULL,
        input_json TEXT NOT NULL,
        diff TEXT,
        command TEXT,
        cwd TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_permissions_status_created ON permissions_audit(status, created_at);

      CREATE TABLE IF NOT EXISTS skills (
        name TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        permissions_json TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        path TEXT,
        source TEXT,
        version TEXT,
        tags_json TEXT,
        quarantined INTEGER NOT NULL DEFAULT 0,
        last_used_at TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS skill_runs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        run_id TEXT,
        input TEXT,
        status TEXT NOT NULL,
        result_json TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS skill_quarantine (
        name TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        package_json TEXT NOT NULL,
        scan_json TEXT,
        created_at TEXT NOT NULL
      );
    `);
    this.addColumnIfMissing("messages", "surface_json", "TEXT");
    this.addColumnIfMissing("messages", "attachments_json", "TEXT");
    this.addColumnIfMissing("memories", "summary", "TEXT");
    this.addColumnIfMissing("memories", "source_type", "TEXT");
    this.addColumnIfMissing("memories", "source_id", "TEXT");
    this.addColumnIfMissing("memories", "visibility", "TEXT");
    this.addColumnIfMissing("memories", "pii_tags_json", "TEXT");
    this.addColumnIfMissing("memories", "updated_at", "TEXT");
    this.addColumnIfMissing("memories", "expires_at", "TEXT");
    this.ensureMemoryFts();
    for (const memory of this.listMemories()) {
      this.indexMemory(memory);
    }
    this.db.prepare("UPDATE social_exchanges SET direction = ? WHERE direction = ?").run("local", "local-simulated");
  }

  private seedDefaults() {
    this.db.prepare("DELETE FROM memories WHERE id = ?").run("mem_local_first");
    this.db
      .prepare("DELETE FROM surfaces WHERE title IN (?, ?, ?, ?, ?, ?)")
      .run("音乐队列", "视频窗口", "今日日程", "查询看板", "Agent 面板", "记忆");
    for (const content of legacyTemplateAssistantMessages) {
      this.db.prepare("DELETE FROM messages WHERE role = ? AND content = ?").run("assistant", content);
    }
  }

  private addColumnIfMissing(table: string, column: string, definition: string) {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (rows.some((row) => row.name === column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  private ensureMemoryFts() {
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
          id UNINDEXED,
          content,
          summary,
          kind,
          scope
        );
      `);
    } catch {
      // Some embedded SQLite builds may omit FTS5. Query code has a fallback.
    }
  }

  private indexMemory(memory: Memory) {
    try {
      this.db.prepare("DELETE FROM memories_fts WHERE id = ?").run(memory.id);
      this.db
        .prepare("INSERT INTO memories_fts (id, content, summary, kind, scope) VALUES (?, ?, ?, ?, ?)")
        .run(memory.id, memory.content, memory.summary ?? "", memory.kind, memory.scope);
    } catch {
      // FTS indexing is best-effort for older SQLite builds.
    }
  }

  private enforceMemoryLimit() {
    const configured = Number(process.env.PET_MEMORY_MAX_ITEMS);
    const limit = Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : DEFAULT_MEMORY_LIMIT;
    this.db
      .prepare(
        `
          DELETE FROM memories
          WHERE id IN (
            SELECT id FROM memories
            ORDER BY COALESCE(updated_at, created_at) DESC, created_at DESC
            LIMIT -1 OFFSET ?
          )
        `,
      )
      .run(limit);
    try {
      this.db.prepare("DELETE FROM memories_fts WHERE id NOT IN (SELECT id FROM memories)").run();
    } catch {
      // FTS cleanup is best-effort.
    }
  }
}

function toSession(row: SessionRow): RuntimeSession {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toAccount(row: AccountRow): AccountProfile {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    avatarSeed: row.avatar_seed,
    createdAt: row.created_at,
  };
}

function toFriend(row: FriendRow): FriendSummary {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    status: row.status,
    petName: row.pet_name ?? undefined,
    lastExchangeAt: row.last_exchange_at ?? undefined,
  };
}

function toSocialExchange(row: SocialExchangeRow): SocialExchangeRecord {
  return {
    id: row.id,
    friendId: row.friend_id,
    direction: row.direction,
    summary: row.summary,
    sharedSkills: JSON.parse(row.shared_skills_json) as string[],
    sharedMemoryCount: row.shared_memory_count,
    createdAt: row.created_at,
  };
}

function toTask(row: TaskRow): ScheduledTask {
  return {
    id: row.id,
    title: row.title,
    dueAt: row.due_at,
    repeat: normalizeRepeat(row.repeat),
    channel: normalizeChannel(row.channel),
    enabled: Boolean(row.enabled),
    note: row.note ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    lastTriggeredAt: row.last_triggered_at ?? undefined,
  };
}

function toTaskTrigger(row: TaskTriggerRow): TaskTriggerRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    triggeredAt: row.triggered_at,
    channel: normalizeChannel(row.channel),
    status: row.status,
    summary: row.summary ?? undefined,
  };
}

function advanceTaskAfterTrigger(task: ScheduledTask, now: string): ScheduledTask {
  if (task.repeat === "daily") {
    return {
      ...task,
      dueAt: addDaysPast(task.dueAt, 1, now),
      completedAt: now,
      lastTriggeredAt: now,
      updatedAt: now,
    };
  }
  if (task.repeat === "weekly") {
    return {
      ...task,
      dueAt: addDaysPast(task.dueAt, 7, now),
      completedAt: now,
      lastTriggeredAt: now,
      updatedAt: now,
    };
  }
  return {
    ...task,
    enabled: false,
    completedAt: now,
    lastTriggeredAt: now,
    updatedAt: now,
  };
}

function addDaysPast(value: string, days: number, now: string) {
  const due = new Date(value);
  const current = new Date(now);
  do {
    due.setDate(due.getDate() + days);
  } while (due.getTime() <= current.getTime());
  return due.toISOString();
}

function normalizeDueAt(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function normalizeRepeat(value: unknown): ScheduledTask["repeat"] {
  return value === "daily" || value === "weekly" || value === "once" ? value : "once";
}

function normalizeChannel(value: unknown): ScheduledTask["channel"] {
  return value === "chat" || value === "voice" || value === "pet" ? value : "pet";
}

function toMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    kind: row.kind,
    scope: row.scope,
    content: row.content,
    summary: row.summary ?? undefined,
    confidence: row.confidence,
    source: row.source,
    sourceType: row.source_type ?? undefined,
    sourceId: row.source_id ?? undefined,
    visibility: row.visibility ?? undefined,
    piiTags: parseOptionalJson<string[]>(row.pii_tags_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? undefined,
    expiresAt: row.expires_at ?? undefined,
  };
}

function toToolRun(row: ToolRunRow): ToolRunRecord {
  return {
    id: row.id,
    sessionId: row.session_id ?? undefined,
    runId: row.run_id ?? undefined,
    toolName: row.tool_name,
    input: parseOptionalJson<Record<string, unknown>>(row.input_json) ?? {},
    output: parseOptionalJson<unknown>(row.output_json),
    status: row.status,
    permissionId: row.permission_id ?? undefined,
    exitCode: row.exit_code ?? undefined,
    cwd: row.cwd ?? undefined,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
    summary: row.summary ?? undefined,
    risk: row.risk ?? undefined,
  };
}

function toPermission(row: PermissionRow): PermissionRequest {
  return {
    id: row.id,
    sessionId: row.session_id ?? undefined,
    runId: row.run_id ?? undefined,
    toolName: row.tool_name,
    title: row.title,
    description: row.description,
    permissionLevel: row.permission_level,
    risk: row.risk,
    input: parseOptionalJson<Record<string, unknown>>(row.input_json) ?? {},
    diff: row.diff ?? undefined,
    command: row.command ?? undefined,
    cwd: row.cwd ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? undefined,
  };
}

function toSkill(row: SkillRow): SkillSummary {
  return {
    name: row.name,
    description: row.description,
    category: row.category,
    permissions: parseOptionalJson<string[]>(row.permissions_json) ?? [],
    enabled: Boolean(row.enabled),
    path: row.path ?? undefined,
    source: row.source ?? undefined,
    version: row.version ?? undefined,
    tags: parseOptionalJson<string[]>(row.tags_json),
    quarantined: Boolean(row.quarantined),
    lastUsedAt: row.last_used_at ?? undefined,
  };
}

function parseOptionalJson<T>(value?: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function normalizeHandle(value: string) {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || `user-${crypto.randomUUID().slice(0, 6)}`;
}

function localDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
