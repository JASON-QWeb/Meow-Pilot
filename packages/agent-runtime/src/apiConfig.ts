import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { AiProviderId, ProviderConfigureParams, VoiceConfigureParams } from "@pet/protocol";

export type AiConfigSource = "env" | "local-config" | "api-md";

export type AiProviderConfig = {
  provider: AiProviderId;
  apiKey: string;
  model: string;
  baseUrl?: string;
  source: AiConfigSource;
};

export type AiSpeechConfig = AiProviderConfig & {
  voice: string;
};

export type ApiProviderConfig = {
  apiKey: string;
  baseUrl: string;
  model?: string;
  source: AiConfigSource;
};

export type XiaomiTtsConfig = ApiProviderConfig & {
  model: string;
  voice: string;
  instruction: string;
};

export type AiProviderDefinition = {
  id: AiProviderId;
  label: string;
  envPrefix: string;
  envKey: string;
  defaultModel: string;
  defaultBaseUrl?: string;
  capabilities: string[];
};

type LocalAiConfigFile = {
  provider: AiProviderId;
  apiKey: string;
  model: string;
  baseUrl?: string;
  updatedAt: string;
};

type LocalXiaomiVoiceConfigFile = {
  provider: "xiaomi";
  apiKey: string;
  baseUrl?: string;
  audioModel?: string;
  ttsModel?: string;
  voice?: string;
  instruction?: string;
  updatedAt: string;
};

const DEFAULT_TRANSCRIPTION_MODEL = "whisper-1";
const DEFAULT_SPEECH_MODEL = "tts-1";
const DEFAULT_SPEECH_VOICE = "alloy";
const DEFAULT_XIAOMI_MODEL = "mimo-v2.5-pro";
const DEFAULT_XIAOMI_AUDIO_MODEL = "mimo-v2.5";
const DEFAULT_XIAOMI_TTS_MODEL = "mimo-v2.5-tts";
const DEFAULT_XIAOMI_TTS_VOICE = "mimo_default";
const DEFAULT_XIAOMI_TTS_INSTRUCTION = "请用自然、亲切、简洁的普通话语气朗读，像桌面伙伴正在直接回应用户。";
const DEFAULT_XIAOMI_BASE_URL = "https://api.xiaomimimo.com/v1";

export const AI_PROVIDER_DEFINITIONS: AiProviderDefinition[] = [
  {
    id: "openai",
    label: "OpenAI",
    envPrefix: "OPENAI",
    envKey: "OPENAI_API_KEY",
    defaultModel: "gpt-4o-mini",
    capabilities: ["text", "vision", "tool-calling", "json-schema"],
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    envPrefix: "ANTHROPIC",
    envKey: "ANTHROPIC_API_KEY",
    defaultModel: "claude-3-5-haiku-latest",
    capabilities: ["text", "vision", "tool-calling", "json-schema"],
  },
  {
    id: "google",
    label: "Google Gemini",
    envPrefix: "GOOGLE",
    envKey: "GOOGLE_GENERATIVE_AI_API_KEY",
    defaultModel: "gemini-2.5-flash",
    capabilities: ["text", "vision", "tool-calling", "json-schema"],
  },
  {
    id: "xai",
    label: "xAI Grok",
    envPrefix: "XAI",
    envKey: "XAI_API_KEY",
    defaultModel: "grok-3-mini",
    capabilities: ["text", "vision", "tool-calling", "json-schema"],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    envPrefix: "DEEPSEEK",
    envKey: "DEEPSEEK_API_KEY",
    defaultModel: "deepseek-chat",
    capabilities: ["text", "tool-calling", "json-schema"],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    envPrefix: "OPENROUTER",
    envKey: "OPENROUTER_API_KEY",
    defaultModel: "openai/gpt-4o-mini",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    capabilities: ["text", "vision", "tool-calling", "json-schema"],
  },
  {
    id: "openai-compatible",
    label: "OpenAI-compatible",
    envPrefix: "OPENAI_COMPATIBLE",
    envKey: "OPENAI_COMPATIBLE_API_KEY",
    defaultModel: "gpt-4o-mini",
    capabilities: ["text", "vision", "tool-calling", "json-schema"],
  },
];

export function loadAiConfig(): AiProviderConfig | null {
  return loadLocalAiConfig() ?? loadUnifiedEnvConfig() ?? loadFirstProviderEnvConfig();
}

export function loadAiProviderConfig(provider: AiProviderId): AiProviderConfig | null {
  const unified = loadUnifiedEnvConfig();
  if (unified?.provider === provider) return unified;

  const local = loadLocalAiConfig();
  if (local?.provider === provider) return local;

  return loadProviderEnvConfig(provider);
}

export function saveLocalAiConfig(params: ProviderConfigureParams): AiProviderConfig {
  const provider = normalizeProvider(params.provider);
  const definition = getProviderDefinition(provider);
  const apiKey = requiredTrimmed(params.apiKey, "API key");
  const model = requiredTrimmed(params.model || definition.defaultModel, "Model");
  const baseUrl = normalizeOptional(params.baseUrl) ?? definition.defaultBaseUrl;

  if (provider === "openai-compatible" && !baseUrl) {
    throw new Error("OpenAI-compatible provider requires a base URL.");
  }

  const file: LocalAiConfigFile = {
    provider,
    apiKey,
    model,
    ...(baseUrl ? { baseUrl } : {}),
    updatedAt: new Date().toISOString(),
  };
  const path = localConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });

  return toConfig(file, "local-config");
}

export function saveLocalXiaomiVoiceConfig(params: VoiceConfigureParams): XiaomiTtsConfig {
  if (params.provider !== "xiaomi") {
    throw new Error(`Unsupported voice provider: ${params.provider}`);
  }

  const apiKey = requiredTrimmed(params.apiKey, "API key");
  const file: LocalXiaomiVoiceConfigFile = {
    provider: "xiaomi",
    apiKey,
    baseUrl: normalizeOptional(params.baseUrl) ?? DEFAULT_XIAOMI_BASE_URL,
    audioModel: normalizeOptional(params.audioModel) ?? DEFAULT_XIAOMI_AUDIO_MODEL,
    ttsModel: normalizeOptional(params.ttsModel) ?? DEFAULT_XIAOMI_TTS_MODEL,
    voice: normalizeOptional(params.voice) ?? DEFAULT_XIAOMI_TTS_VOICE,
    instruction: normalizeOptional(params.instruction) ?? DEFAULT_XIAOMI_TTS_INSTRUCTION,
    updatedAt: new Date().toISOString(),
  };
  const path = localXiaomiVoiceConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });

  return {
    apiKey: file.apiKey,
    baseUrl: file.baseUrl ?? DEFAULT_XIAOMI_BASE_URL,
    model: file.ttsModel ?? DEFAULT_XIAOMI_TTS_MODEL,
    voice: file.voice ?? DEFAULT_XIAOMI_TTS_VOICE,
    instruction: file.instruction ?? DEFAULT_XIAOMI_TTS_INSTRUCTION,
    source: "local-config",
  };
}

export function loadXiaomiConfig(): ApiProviderConfig | null {
  return loadLocalXiaomiVoiceConfig() ?? loadConfiguredXiaomi();
}

export function loadXiaomiAudioConfig(): ApiProviderConfig | null {
  const config = loadXiaomiConfig();
  if (!config) return null;

  return {
    ...config,
    baseUrl: normalizeOptional(process.env.XIAOMI_AUDIO_BASE_URL) ?? config.baseUrl,
    model: normalizeModel(process.env.XIAOMI_AUDIO_MODEL ?? localXiaomiAudioModel() ?? DEFAULT_XIAOMI_AUDIO_MODEL),
  };
}

export function loadXiaomiTtsConfig(): XiaomiTtsConfig | null {
  const config = loadXiaomiConfig();
  if (!config) return null;

  return {
    ...config,
    baseUrl: normalizeOptional(process.env.XIAOMI_TTS_BASE_URL) ?? config.baseUrl,
    model: normalizeModel(process.env.XIAOMI_TTS_MODEL ?? localXiaomiTtsModel() ?? DEFAULT_XIAOMI_TTS_MODEL),
    voice: process.env.XIAOMI_TTS_VOICE?.trim() || localXiaomiVoice() || DEFAULT_XIAOMI_TTS_VOICE,
    instruction: process.env.XIAOMI_TTS_INSTRUCTION?.trim() || localXiaomiInstruction() || DEFAULT_XIAOMI_TTS_INSTRUCTION,
  };
}

export function loadAiTranscriptionConfig(): AiProviderConfig | null {
  const dedicated = loadDedicatedOpenAiConfig("TRANSCRIPTION", DEFAULT_TRANSCRIPTION_MODEL);
  if (dedicated) return dedicated;

  const active = loadAiConfig();
  if (active?.provider === "openai") {
    return {
      ...active,
      model: normalizeOptional(process.env.PET_AI_TRANSCRIPTION_MODEL) ?? DEFAULT_TRANSCRIPTION_MODEL,
    };
  }

  const openai = loadProviderEnvConfig("openai");
  return openai
    ? {
        ...openai,
        model: normalizeOptional(process.env.PET_AI_TRANSCRIPTION_MODEL) ?? DEFAULT_TRANSCRIPTION_MODEL,
      }
    : null;
}

export function loadAiSpeechConfig(): AiSpeechConfig | null {
  const dedicated = loadDedicatedOpenAiConfig("SPEECH", DEFAULT_SPEECH_MODEL);
  const base =
    dedicated ??
    (() => {
      const active = loadAiConfig();
      if (active?.provider === "openai") {
        return {
          ...active,
          model: normalizeOptional(process.env.PET_AI_SPEECH_MODEL) ?? DEFAULT_SPEECH_MODEL,
        };
      }

      const openai = loadProviderEnvConfig("openai");
      return openai
        ? {
            ...openai,
            model: normalizeOptional(process.env.PET_AI_SPEECH_MODEL) ?? DEFAULT_SPEECH_MODEL,
          }
        : null;
    })();

  if (!base) return null;
  return {
    ...base,
    voice: normalizeOptional(process.env.PET_AI_SPEECH_VOICE) ?? DEFAULT_SPEECH_VOICE,
  };
}

export function getProviderDefinition(provider: AiProviderId) {
  const definition = AI_PROVIDER_DEFINITIONS.find((item) => item.id === provider);
  if (!definition) throw new Error(`Unsupported AI provider: ${provider}`);
  return definition;
}

export function isAiProviderId(value: string): value is AiProviderId {
  return AI_PROVIDER_DEFINITIONS.some((definition) => definition.id === value);
}

function loadUnifiedEnvConfig(): AiProviderConfig | null {
  const apiKey = normalizeOptional(process.env.PET_AI_API_KEY);
  if (!apiKey) return null;

  const provider = normalizeProvider(process.env.PET_AI_PROVIDER ?? "openai");
  const definition = getProviderDefinition(provider);
  const baseUrl = normalizeOptional(process.env.PET_AI_BASE_URL) ?? definition.defaultBaseUrl;
  if (provider === "openai-compatible" && !baseUrl) return null;

  return {
    provider,
    apiKey,
    model: normalizeOptional(process.env.PET_AI_MODEL) ?? definition.defaultModel,
    ...(baseUrl ? { baseUrl } : {}),
    source: "env",
  };
}

function loadLocalAiConfig(): AiProviderConfig | null {
  const path = localConfigPath();
  if (!existsSync(path)) return null;

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<LocalAiConfigFile>;
    if (!parsed.provider || !isAiProviderId(parsed.provider) || !parsed.apiKey || !parsed.model) return null;
    const definition = getProviderDefinition(parsed.provider);
    const baseUrl = normalizeOptional(parsed.baseUrl) ?? definition.defaultBaseUrl;
    if (parsed.provider === "openai-compatible" && !baseUrl) return null;

    return {
      provider: parsed.provider,
      apiKey: parsed.apiKey.trim(),
      model: parsed.model.trim(),
      ...(baseUrl ? { baseUrl } : {}),
      source: "local-config",
    };
  } catch {
    return null;
  }
}

function loadFirstProviderEnvConfig(): AiProviderConfig | null {
  for (const definition of AI_PROVIDER_DEFINITIONS) {
    const config = loadProviderEnvConfig(definition.id);
    if (config) return config;
  }
  return null;
}

function loadProviderEnvConfig(provider: AiProviderId): AiProviderConfig | null {
  const definition = getProviderDefinition(provider);
  const apiKey =
    normalizeOptional(process.env[definition.envKey]) ??
    (provider === "google" ? normalizeOptional(process.env.GOOGLE_API_KEY) : undefined);
  if (!apiKey) return loadProviderApiMdConfig(provider);

  const model =
    normalizeOptional(process.env[`${definition.envPrefix}_MODEL`]) ??
    normalizeOptional(process.env[`${definition.envPrefix}_AI_MODEL`]) ??
    definition.defaultModel;
  const baseUrl =
    normalizeOptional(process.env[`${definition.envPrefix}_BASE_URL`]) ??
    normalizeOptional(process.env[`${definition.envPrefix}_BASEURL`]) ??
    definition.defaultBaseUrl;
  if (provider === "openai-compatible" && !baseUrl) return null;

  return {
    provider,
    apiKey,
    model,
    ...(baseUrl ? { baseUrl } : {}),
    source: "env",
  };
}

function loadProviderApiMdConfig(provider: AiProviderId): AiProviderConfig | null {
  const apiMd = readApiMd();
  if (!apiMd) return null;

  const block = extractProviderBlock(apiMd, provider);
  if (!block) return null;

  const definition = getProviderDefinition(provider);
  const apiKey = findApiKey(block);
  if (!apiKey) return null;

  const baseUrl = findUrl(block) ?? definition.defaultBaseUrl;
  if (provider === "openai-compatible" && !baseUrl) return null;

  return {
    provider,
    apiKey,
    model: normalizeModel(process.env[`${definition.envPrefix}_MODEL`] ?? findFirstModel(block) ?? definition.defaultModel),
    ...(baseUrl ? { baseUrl } : {}),
    source: "api-md",
  };
}

function loadConfiguredXiaomi(): ApiProviderConfig | null {
  if (process.env.XIAOMI_API_KEY) {
    return {
      apiKey: process.env.XIAOMI_API_KEY,
      baseUrl: process.env.XIAOMI_BASE_URL ?? DEFAULT_XIAOMI_BASE_URL,
      model: normalizeModel(process.env.XIAOMI_MODEL ?? DEFAULT_XIAOMI_MODEL),
      source: "env",
    };
  }

  const apiMd = readApiMd();
  if (!apiMd) return null;

  const block = extractProviderBlock(apiMd, "xiaomi");
  if (!block) return null;

  const apiKey = findApiKey(block);
  if (!apiKey) return null;

  return {
    apiKey,
    baseUrl: findUrl(block) ?? DEFAULT_XIAOMI_BASE_URL,
    model: normalizeModel(process.env.XIAOMI_MODEL ?? findFirstModel(block) ?? DEFAULT_XIAOMI_MODEL),
    source: "api-md",
  };
}

function loadLocalXiaomiVoiceConfig(): ApiProviderConfig | null {
  const path = localXiaomiVoiceConfigPath();
  if (!existsSync(path)) return null;

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<LocalXiaomiVoiceConfigFile>;
    if (parsed.provider !== "xiaomi" || !parsed.apiKey) return null;
    return {
      apiKey: parsed.apiKey.trim(),
      baseUrl: normalizeOptional(parsed.baseUrl) ?? DEFAULT_XIAOMI_BASE_URL,
      model: normalizeOptional(parsed.audioModel) ?? DEFAULT_XIAOMI_AUDIO_MODEL,
      source: "local-config",
    };
  } catch {
    return null;
  }
}

function readLocalXiaomiVoiceConfig(): Partial<LocalXiaomiVoiceConfigFile> | null {
  const path = localXiaomiVoiceConfigPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Partial<LocalXiaomiVoiceConfigFile>;
  } catch {
    return null;
  }
}

function localXiaomiAudioModel() {
  return normalizeOptional(readLocalXiaomiVoiceConfig()?.audioModel);
}

function localXiaomiTtsModel() {
  return normalizeOptional(readLocalXiaomiVoiceConfig()?.ttsModel);
}

function localXiaomiVoice() {
  return normalizeOptional(readLocalXiaomiVoiceConfig()?.voice);
}

function localXiaomiInstruction() {
  return normalizeOptional(readLocalXiaomiVoiceConfig()?.instruction);
}

function loadDedicatedOpenAiConfig(kind: "TRANSCRIPTION" | "SPEECH", defaultModel: string): AiProviderConfig | null {
  const apiKey = normalizeOptional(process.env[`PET_AI_${kind}_API_KEY`]);
  if (!apiKey) return null;

  return {
    provider: "openai",
    apiKey,
    model: normalizeOptional(process.env[`PET_AI_${kind}_MODEL`]) ?? defaultModel,
    ...(normalizeOptional(process.env[`PET_AI_${kind}_BASE_URL`]) ? { baseUrl: normalizeOptional(process.env[`PET_AI_${kind}_BASE_URL`]) } : {}),
    source: "env",
  };
}

function toConfig(file: LocalAiConfigFile, source: AiConfigSource): AiProviderConfig {
  return {
    provider: file.provider,
    apiKey: file.apiKey,
    model: file.model,
    ...(file.baseUrl ? { baseUrl: file.baseUrl } : {}),
    source,
  };
}

function normalizeProvider(provider: string): AiProviderId {
  const normalized = provider.trim().toLowerCase();
  const aliases: Record<string, AiProviderId> = {
    claude: "anthropic",
    gemini: "google",
    grok: "xai",
    "openai-compatible-api": "openai-compatible",
    compatible: "openai-compatible",
  };
  const candidate = aliases[normalized] ?? normalized;
  if (!isAiProviderId(candidate)) {
    throw new Error(`Unsupported AI provider: ${provider}`);
  }
  return candidate;
}

function requiredTrimmed(value: string | undefined, label: string) {
  const trimmed = normalizeOptional(value);
  if (!trimmed) throw new Error(`${label} is required.`);
  return trimmed;
}

function normalizeOptional(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function readApiMd() {
  const configured = process.env.PET_API_MD_PATH;
  const candidates = [configured, join(homedir(), "Desktop", "api.md")].filter(Boolean) as string[];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, "utf8");
    }
  }
  return null;
}

function extractProviderBlock(content: string, provider: string) {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => normalize(line).startsWith(`${provider}:`) || normalize(line).startsWith(`${provider}：`));
  if (start === -1) return null;

  const block: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (index !== start && !line.trim().startsWith("模型") && /^[\p{L}\p{Script=Han}0-9_-]+\s*[:：]\s*$/u.test(line.trim())) {
      break;
    }
    block.push(line);
  }
  return block.join("\n");
}

function findApiKey(block: string) {
  return block.match(/api[-_ ]?key\s*[:：]\s*([^\s]+)/i)?.[1]?.trim();
}

function findUrl(block: string) {
  return block.match(/https?:\/\/[^\s]+/i)?.[0]?.trim();
}

function findFirstModel(block: string) {
  const modelLine = block
    .split(/\r?\n/)
    .find((line) => /mimo-|deepseek-|gpt-|claude-|gemini-|grok-/i.test(line) || line.toLowerCase().includes("model"));
  return modelLine?.match(/[A-Za-z0-9_.:/-]*(?:mimo|deepseek|gpt|claude|gemini|grok)[A-Za-z0-9_.:/-]*/i)?.[0];
}

function normalizeModel(model: string) {
  return model.trim().toLowerCase();
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function localConfigPath() {
  return process.env.PET_AI_CONFIG_PATH ?? resolve(findWorkspaceRoot(), ".pet", "ai-provider.json");
}

function localXiaomiVoiceConfigPath() {
  return process.env.PET_XIAOMI_VOICE_CONFIG_PATH ?? resolve(findWorkspaceRoot(), ".pet", "xiaomi-voice-provider.json");
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
