import { spawnSync } from "node:child_process";
import type { ProviderSummary, SkillSummary } from "@pet/protocol";
import { AI_PROVIDER_DEFINITIONS, loadAiProviderConfig, loadAiSpeechConfig, loadAiTranscriptionConfig, loadXiaomiAudioConfig, loadXiaomiTtsConfig } from "./apiConfig";

export const skills: SkillSummary[] = [
  {
    name: "daily-brief",
    description: "根据日程和当前优先级生成简洁的当天计划。",
    category: "productivity",
    permissions: ["calendar:read"],
    enabled: true,
    path: "skills/bundled/productivity/daily-brief",
  },
  {
    name: "music-companion",
    description: "生成可播放的音乐界面和队列动作。",
    category: "media",
    permissions: ["network:music-provider"],
    enabled: true,
    path: "skills/bundled/media/music-companion",
  },
  {
    name: "video-companion",
    description: "生成视频界面，并预留字幕、摘要和后续动作。",
    category: "media",
    permissions: ["network:video-provider"],
    enabled: true,
    path: "skills/bundled/media/video-companion",
  },
  {
    name: "search-cards",
    description: "把查询任务整理成来源卡片和可筛选表格。",
    category: "research",
    permissions: ["network:web"],
    enabled: true,
    path: "skills/bundled/research/search-cards",
  },
];

export function listProviders(): ProviderSummary[] {
  const transcription = loadAiTranscriptionConfig();
  const speech = loadAiSpeechConfig();
  const xiaomiAudio = loadXiaomiAudioConfig();
  const xiaomiSpeech = loadXiaomiTtsConfig();
  const codexConfigured = commandExists("codex");
  const claudeConfigured = commandExists("claude");
  return [
    ...AI_PROVIDER_DEFINITIONS.map((definition) => {
      const config = loadAiProviderConfig(definition.id);
      return {
        id: definition.id,
        label: definition.label,
        mode: "api" as const,
        configured: Boolean(config),
        capabilities: [
          ...definition.capabilities,
          ...(definition.id === "openai" && transcription ? ["audio-in"] : []),
          ...(definition.id === "openai" && speech ? ["audio-out"] : []),
        ],
        model: config?.model ?? definition.defaultModel,
        source: config?.source,
      };
    }),
    {
      id: "xiaomi-voice",
      label: "Xiaomi MiMo 语音",
      mode: "api" as const,
      configured: Boolean(xiaomiAudio || xiaomiSpeech),
      capabilities: [
        ...(xiaomiAudio ? ["audio-in"] : []),
        ...(xiaomiSpeech ? ["audio-out"] : []),
      ],
      model: xiaomiSpeech?.model ?? xiaomiAudio?.model ?? "mimo-v2.5-tts",
      source: xiaomiSpeech?.source ?? xiaomiAudio?.source,
    },
    {
      id: "codex-cli",
      label: "Codex CLI 桥接",
      mode: "cli-bridge",
      configured: codexConfigured,
      capabilities: ["text", "tools", "workspace"],
      source: codexConfigured ? "system" : undefined,
    },
    {
      id: "claude-code-cli",
      label: "Claude Code CLI 桥接",
      mode: "cli-bridge",
      configured: claudeConfigured,
      capabilities: ["text", "tools", "workspace"],
      source: claudeConfigured ? "system" : undefined,
    },
  ];
}

function commandExists(command: string) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8", stdio: "ignore" });
  return result.status === 0;
}
