import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import type { SkillSummary } from "@pet/protocol";
import type { PetStore } from "../storage";
import { findWorkspaceRoot } from "../workspace";

type SkillSource = NonNullable<SkillSummary["source"]>;

type SkillRoot = {
  root: string;
  source: SkillSource;
};

export class SkillService {
  private readonly contentCache = new Map<string, { mtimeMs: number; content: string }>();

  constructor(private readonly store: PetStore, private readonly workspaceRoot = findWorkspaceRoot()) {}

  refresh() {
    for (const skill of this.discover()) {
      const existing = this.store.getSkill(skill.name);
      this.store.upsertSkill({
        ...skill,
        enabled: existing?.enabled ?? skill.enabled,
        quarantined: existing?.quarantined ?? skill.quarantined,
        lastUsedAt: existing?.lastUsedAt,
      });
    }
    return this.list();
  }

  list() {
    return this.store.listSkills();
  }

  search(query?: string, limit = 5) {
    const normalized = query?.trim().toLowerCase();
    const skills = this.list().filter((skill) => skill.enabled && !skill.quarantined);
    const scored = skills.map((skill) => ({
      skill,
      score: normalized ? scoreSkill(skill, normalized) : 1,
    }));
    return scored
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || Number(Boolean(b.skill.lastUsedAt)) - Number(Boolean(a.skill.lastUsedAt)))
      .slice(0, Math.max(1, Math.min(limit, 12)))
      .map((item) => item.skill);
  }

  view(name: string) {
    const skill = this.store.getSkill(name);
    if (!skill?.path) return null;
    const skillFile = resolve(skill.path, "SKILL.md");
    if (!existsSync(skillFile)) return null;
    const stats = statSync(skillFile);
    const cached = this.contentCache.get(skill.path);
    if (cached && cached.mtimeMs === stats.mtimeMs) return { skill, content: cached.content };
    const content = readFileSync(skillFile, "utf8").slice(0, 24_000);
    this.contentCache.set(skill.path, { mtimeMs: stats.mtimeMs, content });
    return { skill, content };
  }

  setState(name: string, action: "enable" | "disable" | "quarantine") {
    if (action === "enable") return this.store.setSkillState(name, { enabled: true, quarantined: false });
    if (action === "disable") return this.store.setSkillState(name, { enabled: false });
    return this.store.setSkillState(name, { enabled: false, quarantined: true });
  }

  recordRun(name: string, params: { sessionId?: string; runId?: string; input?: string; status: string; result?: unknown }) {
    const now = new Date().toISOString();
    this.store.saveSkillRun({
      id: `skillrun_${crypto.randomUUID()}`,
      name,
      sessionId: params.sessionId,
      runId: params.runId,
      input: params.input,
      status: params.status,
      result: params.result,
      createdAt: now,
      completedAt: now,
    });
    this.store.setSkillState(name, { lastUsedAt: now });
  }

  private discover() {
    const found = new Map<string, SkillSummary>();
    for (const root of this.skillRoots()) {
      for (const skillFile of findSkillFiles(root.root, 4)) {
        const skill = readSkill(skillFile, root.source);
        if (!skill) continue;
        if (!found.has(skill.name)) found.set(skill.name, skill);
      }
    }
    return [...found.values()];
  }

  private skillRoots(): SkillRoot[] {
    return [
      { root: resolve(this.workspaceRoot, "skills"), source: "workspace" },
      { root: resolve(this.workspaceRoot, ".agents", "skills"), source: "project" },
      { root: resolve(homedir(), ".agents", "skills"), source: "user" },
      { root: resolve(homedir(), "Library", "Application Support", "Pet", "skills"), source: "managed" },
      { root: resolve(this.workspaceRoot, "skills", "bundled"), source: "bundled" },
    ];
  }
}

function readSkill(skillFile: string, source: SkillSource): SkillSummary | null {
  try {
    const raw = readFileSync(skillFile, "utf8");
    const frontmatter = parseFrontmatter(raw);
    const name = readScalar(frontmatter.name) ?? basename(dirname(skillFile));
    const description = readScalar(frontmatter.description) ?? "本地 Skill";
    const permissions = readPermissions(frontmatter.permissions);
    return {
      name,
      description,
      category: inferCategory(skillFile, frontmatter.category),
      permissions,
      enabled: true,
      path: dirname(skillFile),
      source,
      version: readScalar(frontmatter.version),
      tags: readList(frontmatter.tags),
    };
  } catch {
    return null;
  }
}

function parseFrontmatter(raw: string): Record<string, unknown> {
  if (!raw.startsWith("---")) return {};
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return {};
  const body = raw.slice(3, end).trim();
  const result: Record<string, unknown> = {};
  let activeKey: string | null = null;
  for (const line of body.split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (pair) {
      activeKey = pair[1]!;
      const value = pair[2]!.trim();
      result[activeKey] = value || [];
      continue;
    }
    const nestedPair = line.match(/^\s+([A-Za-z0-9_.-]+):\s*(.+)$/);
    if (nestedPair && activeKey) {
      const current = typeof result[activeKey] === "object" && !Array.isArray(result[activeKey]) ? result[activeKey] as Record<string, string> : {};
      current[nestedPair[1]!] = nestedPair[2]!.trim();
      result[activeKey] = current;
      continue;
    }
    const item = line.match(/^\s*-\s*(.+)$/);
    if (item && activeKey) {
      const current = Array.isArray(result[activeKey]) ? result[activeKey] as string[] : [];
      current.push(item[1]!.trim());
      result[activeKey] = current;
    }
  }
  return result;
}

function readPermissions(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.includes(":")) return [value.replace(/\s+/g, " ").trim()];
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).map(([key, val]) => `${key}:${String(val)}`);
  }
  return [];
}

function readScalar(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readList(value: unknown) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.trim()) return value.split(",").map((item) => item.trim()).filter(Boolean);
  return undefined;
}

function inferCategory(skillFile: string, category: unknown) {
  const explicit = readScalar(category);
  if (explicit) return explicit;
  const parts = skillFile.split(/[\\/]+/);
  const bundledIndex = parts.lastIndexOf("bundled");
  if (bundledIndex >= 0 && parts[bundledIndex + 1]) return parts[bundledIndex + 1]!;
  return "local";
}

function scoreSkill(skill: SkillSummary, query: string) {
  const text = `${skill.name} ${skill.description} ${skill.category} ${(skill.tags ?? []).join(" ")}`.toLowerCase();
  let score = 0;
  for (const token of query.split(/\s+/).filter(Boolean)) {
    if (skill.name.toLowerCase().includes(token)) score += 5;
    if (skill.category.toLowerCase().includes(token)) score += 3;
    if (text.includes(token)) score += 1;
  }
  return score;
}

function findSkillFiles(root: string, maxDepth: number): string[] {
  if (!existsSync(root) || maxDepth < 0) return [];
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const fullPath = join(root, entry);
    let stats;
    try {
      stats = statSync(fullPath);
    } catch {
      continue;
    }
    if (stats.isFile() && entry === "SKILL.md") {
      files.push(resolve(fullPath));
    } else if (stats.isDirectory() && !entry.startsWith(".") && maxDepth > 0) {
      files.push(...findSkillFiles(fullPath, maxDepth - 1));
    }
  }
  return files;
}
