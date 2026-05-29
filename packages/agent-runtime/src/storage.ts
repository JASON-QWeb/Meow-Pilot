import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AccountProfile, ChatMessage, FriendSummary, Memory, SocialExchangeRecord, SurfaceSpec } from "@pet/protocol";

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
};

type MemoryRow = {
  id: string;
  kind: Memory["kind"];
  scope: Memory["scope"];
  content: string;
  confidence: number;
  source: Memory["source"];
  created_at: string;
};

type SurfaceRow = {
  spec_json: string;
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

const defaultDbPath = resolve(findWorkspaceRoot(), ".pet", "pet-agentd.sqlite");
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

  getSession(id: string) {
    const row = this.db.prepare("SELECT id, title, created_at, updated_at FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
    return row ? toSession(row) : null;
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

  listMessages(sessionId: string): ChatMessage[] {
    const rows = this.db
      .prepare("SELECT id, role, content, created_at, run_id, surface_json FROM messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC")
      .all(sessionId) as MessageRow[];

    return rows.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
      runId: row.run_id ?? undefined,
      surface: parseOptionalJson<SurfaceSpec>(row.surface_json),
    }));
  }

  saveMessage(sessionId: string, message: ChatMessage) {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO messages (id, session_id, role, content, created_at, run_id, surface_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(message.id, sessionId, message.role, message.content, message.createdAt, message.runId ?? null, message.surface ? JSON.stringify(message.surface) : null);
    this.touchSession(sessionId, message.createdAt);
  }

  listMemories(): Memory[] {
    const rows = this.db
      .prepare("SELECT id, kind, scope, content, confidence, source, created_at FROM memories ORDER BY created_at DESC, rowid DESC")
      .all() as MemoryRow[];

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      scope: row.scope,
      content: row.content,
      confidence: row.confidence,
      source: row.source,
      createdAt: row.created_at,
    }));
  }

  saveMemory(memory: Memory) {
    this.db
      .prepare("INSERT OR REPLACE INTO memories (id, kind, scope, content, confidence, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(memory.id, memory.kind, memory.scope, memory.content, memory.confidence, memory.source, memory.createdAt);
  }

  listSurfaces(sessionId: string): SurfaceSpec[] {
    const rows = this.db
      .prepare("SELECT spec_json FROM surfaces WHERE session_id = ? ORDER BY created_at DESC, rowid DESC")
      .all(sessionId) as SurfaceRow[];

    return rows.map((row) => JSON.parse(row.spec_json) as SurfaceSpec);
  }

  saveSurface(sessionId: string, surface: SurfaceSpec) {
    this.db
      .prepare("INSERT OR REPLACE INTO surfaces (id, session_id, type, intent, title, spec_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(surface.id, sessionId, surface.type, surface.intent, surface.title ?? null, JSON.stringify(surface), surface.createdAt, new Date().toISOString());
    this.touchSession(sessionId);
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
        confidence REAL NOT NULL,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL
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
    `);
    this.addColumnIfMissing("messages", "surface_json", "TEXT");
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

function findWorkspaceRoot() {
  let cursor = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(resolve(cursor, "pnpm-workspace.yaml"))) {
      return cursor;
    }
    const parent = resolve(cursor, "..");
    if (parent === cursor) break;
    cursor = parent;
  }
  return process.cwd();
}
