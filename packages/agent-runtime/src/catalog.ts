import { spawnSync } from "node:child_process";
import type { ProviderSummary, SkillSummary } from "@pet/protocol";
import { loadXiaomiAudioConfig, loadXiaomiConfig, loadXiaomiTtsConfig } from "./apiConfig";

export const skills: SkillSummary[] = [
  {
    name: "daily-brief",
    description: "Create a concise day plan from calendar-like events and current priorities.",
    category: "productivity",
    permissions: ["calendar:read"],
    enabled: true,
    path: "skills/bundled/productivity/daily-brief",
  },
  {
    name: "music-companion",
    description: "Prepare a playable music surface with queue actions.",
    category: "media",
    permissions: ["network:music-provider"],
    enabled: true,
    path: "skills/bundled/media/music-companion",
  },
  {
    name: "video-companion",
    description: "Prepare a video surface with transcript and follow-up actions.",
    category: "media",
    permissions: ["network:video-provider"],
    enabled: true,
    path: "skills/bundled/media/video-companion",
  },
  {
    name: "search-cards",
    description: "Turn research queries into source cards and a filterable table.",
    category: "research",
    permissions: ["network:web"],
    enabled: true,
    path: "skills/bundled/research/search-cards",
  },
];

export function listProviders(): ProviderSummary[] {
  const xiaomi = loadXiaomiConfig();
  const audioInput = loadXiaomiAudioConfig();
  const tts = loadXiaomiTtsConfig();
  return [
    {
      id: "mock-local",
      label: "Mock Local Agent",
      mode: "mock",
      configured: true,
      capabilities: ["text", "tool-calling", "generated-ui"],
      source: "system",
    },
    {
      id: "xiaomi-mimo",
      label: "Xiaomi MiMo (regular API)",
      mode: "api",
      configured: Boolean(xiaomi),
      capabilities: [
        "text",
        ...(audioInput ? ["audio-in"] : []),
        ...(tts ? ["audio-out"] : []),
        "tool-calling",
        "json-schema",
      ],
      model: xiaomi?.model ?? "mimo-v2.5-pro",
      source: xiaomi?.source,
    },
    {
      id: "openai-api",
      label: "OpenAI-compatible API",
      mode: "api",
      configured: Boolean(process.env.OPENAI_API_KEY),
      capabilities: ["text", "vision", "tool-calling", "json-schema"],
      source: process.env.OPENAI_API_KEY ? "env" : undefined,
    },
    {
      id: "anthropic-api",
      label: "Anthropic API",
      mode: "api",
      configured: Boolean(process.env.ANTHROPIC_API_KEY),
      capabilities: ["text", "vision", "tool-calling"],
      source: process.env.ANTHROPIC_API_KEY ? "env" : undefined,
    },
    {
      id: "codex-cli",
      label: "Codex CLI Bridge",
      mode: "cli-bridge",
      configured: commandExists("codex"),
      capabilities: ["text", "tools", "workspace"],
      source: commandExists("codex") ? "system" : undefined,
    },
    {
      id: "claude-code-cli",
      label: "Claude Code CLI Bridge",
      mode: "cli-bridge",
      configured: commandExists("claude"),
      capabilities: ["text", "tools", "workspace"],
      source: commandExists("claude") ? "system" : undefined,
    },
  ];
}

function commandExists(command: string) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8", stdio: "ignore" });
  return result.status === 0;
}
