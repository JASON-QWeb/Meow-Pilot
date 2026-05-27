import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Memory } from "@pet/protocol";

type SourceKind = "hermes" | "openclaw";

type MigrationScan = {
  generatedAt: string;
  sources: SourceScan[];
};

type SourceScan = {
  kind: SourceKind;
  root: string;
  exists: boolean;
  summary: {
    memoryFiles: number;
    personaFiles: number;
    skillDirectories: number;
    sessionStores: number;
    configFiles: number;
    possibleSecretFiles: number;
    ttsOrMediaAssets: number;
  };
  artifacts: Artifact[];
  notes: string[];
};

type Artifact = {
  type: "memory" | "persona" | "skill" | "session-store" | "config" | "possible-secret" | "media";
  path: string;
  bytes?: number;
  risk: "low" | "medium" | "high";
  action: "candidate" | "requires-confirmation" | "never-import-automatically";
};

const sourceRoots: Array<{ kind: SourceKind; root: string }> = [
  { kind: "hermes", root: resolve(process.env.HERMES_HOME ?? join(homedir(), ".hermes")) },
  { kind: "openclaw", root: resolve(process.env.OPENCLAW_HOME ?? join(homedir(), ".openclaw")) },
];

const scan: MigrationScan = {
  generatedAt: new Date().toISOString(),
  sources: await Promise.all(sourceRoots.map(({ kind, root }) => scanSource(kind, root))),
};

const applyImport = process.argv.includes("--apply") || process.argv.includes("--import");

if (applyImport) {
  const result = await importMemories(scan);
  console.log(JSON.stringify({ ...scan, import: result }, null, 2));
} else {
  console.log(JSON.stringify(scan, null, 2));
}

async function scanSource(kind: SourceKind, root: string): Promise<SourceScan> {
  if (!existsSync(root)) {
    return {
      kind,
      root,
      exists: false,
      summary: emptySummary(),
      artifacts: [],
      notes: [`${kind} home was not found at ${root}.`],
    };
  }

  const artifacts: Artifact[] = [];
  await addKnownFiles(root, artifacts);
  await addSkillDirs(root, artifacts);
  await addSessionStores(root, artifacts);
  await addMediaAssets(root, artifacts);

  return {
    kind,
    root,
    exists: true,
    summary: summarize(artifacts),
    artifacts: artifacts.sort((a, b) => a.path.localeCompare(b.path)),
    notes: [
      "Dry-run scan only: no data was copied or uploaded.",
      "Possible secret files are counted and listed by path only; values are never read by this scanner.",
      "Skill directories should be scanned and permission-reviewed before install.",
    ],
  };
}

async function addKnownFiles(root: string, artifacts: Artifact[]) {
  const candidates: Array<Omit<Artifact, "bytes">> = [
    { type: "memory", path: join(root, "memories", "MEMORY.md"), risk: "medium", action: "requires-confirmation" },
    { type: "memory", path: join(root, "memories", "USER.md"), risk: "medium", action: "requires-confirmation" },
    { type: "memory", path: join(root, "MEMORY.md"), risk: "medium", action: "requires-confirmation" },
    { type: "memory", path: join(root, "USER.md"), risk: "medium", action: "requires-confirmation" },
    { type: "persona", path: join(root, "SOUL.md"), risk: "medium", action: "requires-confirmation" },
    { type: "config", path: join(root, "config.yaml"), risk: "medium", action: "requires-confirmation" },
    { type: "config", path: join(root, "config.json"), risk: "medium", action: "requires-confirmation" },
    { type: "config", path: join(root, "openclaw.json"), risk: "medium", action: "requires-confirmation" },
    { type: "possible-secret", path: join(root, ".env"), risk: "high", action: "never-import-automatically" },
    { type: "possible-secret", path: join(root, "secrets.json"), risk: "high", action: "never-import-automatically" },
  ];

  for (const candidate of candidates) {
    await addIfExists(candidate, artifacts);
  }
}

async function addSkillDirs(root: string, artifacts: Artifact[]) {
  const roots = [join(root, "skills"), join(root, ".agents", "skills")];
  for (const skillRoot of roots) {
    for (const skillPath of await findFiles(skillRoot, "SKILL.md", 4)) {
      artifacts.push({
        type: "skill",
        path: resolve(skillPath, ".."),
        bytes: (await stat(skillPath)).size,
        risk: "high",
        action: "requires-confirmation",
      });
    }
  }
}

async function addSessionStores(root: string, artifacts: Artifact[]) {
  const candidates = [
    join(root, "state.db"),
    join(root, "hermes_state.db"),
    join(root, "sessions.db"),
    join(root, "sessions"),
    join(root, "logs"),
  ];

  for (const candidate of candidates) {
    await addIfExists({ type: "session-store", path: candidate, risk: "medium", action: "requires-confirmation" }, artifacts);
  }
}

async function addMediaAssets(root: string, artifacts: Artifact[]) {
  const mediaRoots = [join(root, "tts"), join(root, "audio"), join(root, "assets"), join(root, "media")];
  for (const mediaRoot of mediaRoots) {
    if (!existsSync(mediaRoot)) continue;
    const matches = await findByExtension(mediaRoot, [".wav", ".mp3", ".ogg", ".m4a", ".png", ".jpg", ".jpeg", ".webp"], 3);
    for (const mediaPath of matches) {
      artifacts.push({
        type: "media",
        path: mediaPath,
        bytes: (await stat(mediaPath)).size,
        risk: "low",
        action: "candidate",
      });
    }
  }
}

async function addIfExists(candidate: Omit<Artifact, "bytes">, artifacts: Artifact[]) {
  if (!existsSync(candidate.path)) return;
  artifacts.push({
    ...candidate,
    path: resolve(candidate.path),
    bytes: (await stat(candidate.path)).size,
  });
}

async function findFiles(root: string, filename: string, maxDepth: number): Promise<string[]> {
  if (!existsSync(root) || maxDepth < 0) return [];

  const entries = await readdir(root, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isFile() && entry.name === filename) {
      found.push(resolve(fullPath));
      continue;
    }
    if (entry.isDirectory() && !entry.name.startsWith(".") && maxDepth > 0) {
      found.push(...(await findFiles(fullPath, filename, maxDepth - 1)));
    }
  }
  return found;
}

async function findByExtension(root: string, extensions: string[], maxDepth: number): Promise<string[]> {
  if (!existsSync(root) || maxDepth < 0) return [];

  const entries = await readdir(root, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isFile() && extensions.some((extension) => entry.name.toLowerCase().endsWith(extension))) {
      found.push(resolve(fullPath));
      continue;
    }
    if (entry.isDirectory() && !entry.name.startsWith(".") && maxDepth > 0) {
      found.push(...(await findByExtension(fullPath, extensions, maxDepth - 1)));
    }
  }
  return found;
}

function summarize(artifacts: Artifact[]): SourceScan["summary"] {
  return {
    memoryFiles: count(artifacts, "memory"),
    personaFiles: count(artifacts, "persona"),
    skillDirectories: count(artifacts, "skill"),
    sessionStores: count(artifacts, "session-store"),
    configFiles: count(artifacts, "config"),
    possibleSecretFiles: count(artifacts, "possible-secret"),
    ttsOrMediaAssets: count(artifacts, "media"),
  };
}

function emptySummary(): SourceScan["summary"] {
  return {
    memoryFiles: 0,
    personaFiles: 0,
    skillDirectories: 0,
    sessionStores: 0,
    configFiles: 0,
    possibleSecretFiles: 0,
    ttsOrMediaAssets: 0,
  };
}

function count(artifacts: Artifact[], type: Artifact["type"]) {
  return artifacts.filter((artifact) => artifact.type === type).length;
}

async function importMemories(scanResult: MigrationScan) {
  const { PetStore } = await import("../../packages/agent-runtime/src/storage");
  const store = new PetStore();
  const imported: Array<{ source: SourceKind; path: string; count: number }> = [];
  const skipped: Array<{ source: SourceKind; path: string; reason: string }> = [];

  for (const source of scanResult.sources) {
    for (const artifact of source.artifacts) {
      if (artifact.action === "never-import-automatically") {
        skipped.push({ source: source.kind, path: artifact.path, reason: "secret_or_sensitive_file" });
        continue;
      }
      if (artifact.type !== "memory" && artifact.type !== "persona") continue;

      const raw = await readTextCandidate(artifact.path);
      if (!raw) {
        skipped.push({ source: source.kind, path: artifact.path, reason: "empty_or_unreadable" });
        continue;
      }

      const items = extractMemoryItems(raw);
      if (items.length === 0) {
        skipped.push({ source: source.kind, path: artifact.path, reason: "no_importable_text" });
        continue;
      }

      for (const content of items) {
        store.saveMemory(toImportedMemory(source.kind, artifact, content));
      }
      imported.push({ source: source.kind, path: artifact.path, count: items.length });
    }
  }

  return {
    mode: "local_sqlite",
    imported,
    skipped,
    notes: [
      "Only memory/persona text was imported.",
      "Secrets, configs, sessions, media, and skills were not imported automatically.",
      "Run migrate:scan first when you want to review candidates without writing to the local store.",
    ],
  };
}

async function readTextCandidate(path: string) {
  try {
    const body = await readFile(path, "utf8");
    return body.trim();
  } catch {
    return "";
  }
}

function extractMemoryItems(raw: string) {
  const normalized = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("```"))
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, "").trim())
    .filter((line) => line && !line.match(/^#{1,6}\s*$/));

  const bullets = normalized.filter((line) => !line.startsWith("#") && line.length >= 8);
  if (bullets.length > 1) return bullets.map(limitMemoryText);

  const compact = normalized
    .map((line) => line.replace(/^#{1,6}\s*/, ""))
    .join("\n")
    .trim();
  return compact ? splitLongMemory(compact).map(limitMemoryText) : [];
}

function splitLongMemory(text: string) {
  if (text.length <= 1200) return [text];
  const paragraphs = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  return paragraphs.length > 1 ? paragraphs : [text.slice(0, 1200)];
}

function limitMemoryText(text: string) {
  return text.length <= 1200 ? text : `${text.slice(0, 1197)}...`;
}

function toImportedMemory(source: SourceKind, artifact: Artifact, content: string): Memory {
  const digest = createHash("sha256").update(`${source}:${artifact.path}:${content}`).digest("hex").slice(0, 24);
  return {
    id: `mem_import_${digest}`,
    kind: artifact.type === "persona" ? "pet_note" : "semantic",
    scope: "private",
    content: `[${source}] ${content}`,
    confidence: artifact.type === "persona" ? 0.74 : 0.82,
    source: "import",
    createdAt: new Date().toISOString(),
  };
}
