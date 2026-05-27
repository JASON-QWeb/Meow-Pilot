import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type ApiProviderConfig = {
  apiKey: string;
  baseUrl: string;
  model?: string;
  source: "env" | "api-md";
};

export type XiaomiTtsConfig = ApiProviderConfig & {
  model: string;
  voice: string;
  instruction: string;
};

const DEFAULT_XIAOMI_MODEL = "mimo-v2.5-pro";
const DEFAULT_XIAOMI_AUDIO_MODEL = "mimo-v2.5";
const DEFAULT_XIAOMI_TTS_MODEL = "mimo-v2.5-tts";
const DEFAULT_XIAOMI_TTS_VOICE = "mimo_default";
const DEFAULT_XIAOMI_TTS_INSTRUCTION = "请用自然、亲切、简洁的普通话语气朗读，像桌面伙伴正在直接回应用户。";
const DEFAULT_XIAOMI_BASE_URL = "https://api.xiaomimimo.com/v1";

export function loadXiaomiConfig(): ApiProviderConfig | null {
  const config = loadConfiguredXiaomi();
  if (!config || isTokenPlanBaseUrl(config.baseUrl)) return null;
  return config;
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

export function loadXiaomiAudioConfig(): ApiProviderConfig | null {
  const config = loadXiaomiConfig();
  if (!config) return null;

  return {
    ...config,
    baseUrl: process.env.XIAOMI_AUDIO_BASE_URL ?? config.baseUrl,
    model: normalizeModel(process.env.XIAOMI_AUDIO_MODEL ?? DEFAULT_XIAOMI_AUDIO_MODEL),
  };
}

export function loadXiaomiTtsConfig(): XiaomiTtsConfig | null {
  const config = loadXiaomiConfig();
  if (!config) return null;

  return {
    ...config,
    baseUrl: process.env.XIAOMI_TTS_BASE_URL ?? config.baseUrl,
    model: normalizeModel(process.env.XIAOMI_TTS_MODEL ?? DEFAULT_XIAOMI_TTS_MODEL),
    voice: process.env.XIAOMI_TTS_VOICE?.trim() || DEFAULT_XIAOMI_TTS_VOICE,
    instruction: process.env.XIAOMI_TTS_INSTRUCTION?.trim() || DEFAULT_XIAOMI_TTS_INSTRUCTION,
  };
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
    .find((line) => line.includes("MiMo-") || line.toLowerCase().includes("model"));
  return modelLine?.match(/MiMo-[A-Za-z0-9_.-]+/)?.[0];
}

function normalizeModel(model: string) {
  return model.trim().toLowerCase();
}

function isTokenPlanBaseUrl(baseUrl: string) {
  return /^https?:\/\/token-plan(?:-[a-z]+)?\.xiaomimimo\.com(?:\/|$)/i.test(baseUrl.trim());
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}
