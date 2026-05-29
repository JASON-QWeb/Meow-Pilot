import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import {
  experimental_generateSpeech as generateSpeech,
  experimental_transcribe as transcribe,
  streamText,
  type LanguageModel,
  type SpeechModel,
  type TranscriptionModel,
} from "ai";
import type { ChatMessage } from "@pet/protocol";
import {
  loadAiConfig,
  loadAiSpeechConfig,
  loadAiTranscriptionConfig,
  type AiProviderConfig,
  type AiSpeechConfig,
} from "../apiConfig";

export type AiSdkGeneration = {
  text: string;
  model: string;
  provider: AiProviderConfig["provider"];
  source: "ai-sdk";
};

export type AiSdkTextStream = {
  textStream: AsyncIterable<string>;
  model: string;
  provider: AiProviderConfig["provider"];
  source: "ai-sdk";
};

export type AiSdkTranscription = {
  text: string;
  model: string;
  provider: AiProviderConfig["provider"];
  source: "ai-sdk";
};

export type AiSdkSpeech = {
  audioData: string;
  mimeType: string;
  model: string;
  voice: string;
  provider: AiProviderConfig["provider"];
  source: "ai-sdk";
};

const MAX_SPEECH_CHARACTERS = 1200;
const SYSTEM_PROMPT =
  "你是一个产品化桌面宠物 Agent 的大脑。回答要简洁、有温度、可执行。不要声称你已经真实打开外部应用，除非工具结果明确说明。中文优先。";

export async function streamWithAiSdk(userText: string, history: ChatMessage[], abortSignal?: AbortSignal): Promise<AiSdkTextStream | null> {
  const config = loadAiConfig();
  if (!config) return null;

  const result = streamText({
    model: createLanguageModel(config),
    system: SYSTEM_PROMPT,
    messages: toModelMessages(userText, history),
    maxOutputTokens: 1024,
    temperature: 0.7,
    abortSignal,
  });

  return {
    textStream: result.textStream,
    model: config.model,
    provider: config.provider,
    source: "ai-sdk",
  };
}

export async function generateWithAiSdk(userText: string, history: ChatMessage[]): Promise<AiSdkGeneration | null> {
  const stream = await streamWithAiSdk(userText, history);
  if (!stream) return null;

  let text = "";
  for await (const delta of stream.textStream) {
    text += delta;
  }

  const trimmed = text.trim();
  if (!trimmed) return null;

  return {
    text: trimmed,
    model: stream.model,
    provider: stream.provider,
    source: "ai-sdk",
  };
}

export async function transcribeWithAiSdk(audioData: string): Promise<AiSdkTranscription | null> {
  const config = loadAiTranscriptionConfig();
  if (!config) return null;

  const audio = decodeAudioDataUrl(audioData);
  const result = await transcribe({
    model: createTranscriptionModel(config),
    audio,
  });

  const text = result.text.trim();
  if (!text) return null;

  return {
    text,
    model: config.model,
    provider: config.provider,
    source: "ai-sdk",
  };
}

export async function synthesizeWithAiSdk(text: string): Promise<AiSdkSpeech | null> {
  const config = loadAiSpeechConfig();
  if (!config) return null;

  const targetText = text.trim().slice(0, MAX_SPEECH_CHARACTERS);
  if (!targetText) return null;

  const result = await generateSpeech({
    model: createSpeechModel(config),
    text: targetText,
    voice: config.voice,
  });

  return {
    audioData: result.audio.base64,
    mimeType: result.audio.mediaType,
    model: config.model,
    voice: config.voice,
    provider: config.provider,
    source: "ai-sdk",
  };
}

function createLanguageModel(config: AiProviderConfig): LanguageModel {
  switch (config.provider) {
    case "openai":
      return createOpenAI({
        apiKey: config.apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      })(config.model);
    case "anthropic":
      return createAnthropic({
        apiKey: config.apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      })(config.model);
    case "google":
      return createGoogleGenerativeAI({
        apiKey: config.apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      })(config.model);
    case "xai":
      return createXai({
        apiKey: config.apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      })(config.model);
    case "deepseek":
      return createDeepSeek({
        apiKey: config.apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      })(config.model);
    case "openrouter":
      return createOpenAICompatible({
        name: "openrouter",
        apiKey: config.apiKey,
        baseURL: config.baseUrl ?? "https://openrouter.ai/api/v1",
        includeUsage: true,
        supportsStructuredOutputs: true,
      })(config.model);
    case "openai-compatible":
      if (!config.baseUrl) {
        throw new Error("OpenAI-compatible provider requires a base URL.");
      }
      return createOpenAICompatible({
        name: "openai-compatible",
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        includeUsage: true,
        supportsStructuredOutputs: true,
      })(config.model);
    default:
      return assertNever(config.provider);
  }
}

function toModelMessages(userText: string, history: ChatMessage[]) {
  return [
    ...history
      .slice(-8)
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: message.content,
      })),
    {
      role: "user" as const,
      content: userText,
    },
  ];
}

function createTranscriptionModel(config: AiProviderConfig): TranscriptionModel {
  if (config.provider !== "openai") {
    throw new Error("AI SDK voice transcription currently requires an OpenAI API key.");
  }
  return createOpenAI({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
  }).transcription(config.model);
}

function createSpeechModel(config: AiSpeechConfig): SpeechModel {
  if (config.provider !== "openai") {
    throw new Error("AI SDK speech currently requires an OpenAI API key.");
  }
  return createOpenAI({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
  }).speech(config.model);
}

function decodeAudioDataUrl(audioData: string) {
  const match = audioData.match(/^data:audio\/[-+.a-z0-9]+;base64,(?<base64>.+)$/i);
  if (!match?.groups?.base64) {
    throw new Error("Voice input must be a base64 audio data URL.");
  }
  return Buffer.from(match.groups.base64, "base64");
}

function assertNever(value: never): never {
  throw new Error(`Unsupported AI provider: ${value}`);
}
