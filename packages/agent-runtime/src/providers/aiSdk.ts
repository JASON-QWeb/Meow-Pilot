import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import {
  experimental_generateSpeech as generateSpeech,
  experimental_transcribe as transcribe,
  generateObject,
  jsonSchema,
  streamText,
  type LanguageModel,
  type ModelMessage,
  type SpeechModel,
  type ToolSet,
  type TranscriptionModel,
} from "ai";
import type { ChatMessage } from "@pet/protocol";
import {
  loadAiConfig,
  loadAiConfigCandidates,
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

export type AiSdkToolCall = {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
};

export type AiSdkAgentStep = {
  text: string;
  toolCalls: AiSdkToolCall[];
  model: string;
  provider: AiProviderConfig["provider"];
  source: "ai-sdk";
};

export type AgentPlan = {
  goal: string;
  steps: Array<{
    id: string;
    title: string;
    status: "pending" | "in_progress" | "completed";
    requiresTool?: boolean;
  }>;
};

export type AgentReflection = {
  complete: boolean;
  issues: string[];
  finalAnswer?: string;
};

export type SessionSummaryObject = {
  summary: string;
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
const PROVIDER_TIMEOUT_MS = Number(process.env.PET_AI_PROVIDER_TIMEOUT_MS ?? 30_000);
const PROVIDER_CIRCUIT_FAILURES = Number(process.env.PET_AI_PROVIDER_CIRCUIT_FAILURES ?? 2);
const PROVIDER_CIRCUIT_COOLDOWN_MS = Number(process.env.PET_AI_PROVIDER_CIRCUIT_COOLDOWN_MS ?? 60_000);
const providerHealth = new Map<string, { failures: number; skipUntil: number }>();
const SYSTEM_PROMPT = `你是一个产品化桌面宠物 Agent 的大脑。回答要简洁、有温度、可执行。不要声称你已经真实打开外部应用，除非工具结果明确说明。中文优先。

这不是代码生成聊天。用户请求“卡片、界面、组件、表格、表单、看板、日程、任务、查询结果、播放器”等可视化结果，且可交互 UI 能明显提升可读性或操作性时，生成宿主可渲染的声明式 UI 数据，而不是 React/Vue/HTML/CSS/JSX/TSX 代码。普通问答不要硬塞卡片。

不要编造实时数据或图表数据。天气、价格、新闻、用量、日程等需要真实来源的数据，如果上下文没有工具结果或明确来源，就先说明缺少必要信息/让用户补充，不要用 mock 数据凑卡片。用户只说“饼状图/柱状图/趋势图”但没有给数据时，先要数据，不要自造“直接搜索 40%”这类示例。

可用的受控组件目录：
- stack: {kind:"stack", direction:"column"|"row", gap:"xs"|"sm"|"md"|"lg", children:["component_id"...]}
- text: {kind:"text", variant:"title"|"subtitle"|"body"|"caption", text:string}
- list: {kind:"list", items:[{id,title,description?,meta?,actionId?}]}
- table: {kind:"table", columns:[{key,label}], rows:[{[key]:string|number|boolean}]}
- timeline: {kind:"timeline", items:[{id,time,title,tone?}]}
- form: {kind:"form", fields:[{id,label,type,value?,options?}], submitActionId:string}
- metric-row: {kind:"metric-row", metrics:[{label,value,tone?}]}
- pie-chart: {kind:"pie-chart", title?, segments:[{label,value:number,color?}]}
- media-player: {kind:"media-player", media:"music"|"video", title, subtitle?, provider?, sourceUrl?, src?, embedUrl?, status?, controls:["play"|"pause"|"queue"|"open"|"save"]}

图表规则：用户给了分类+数值时，用 pie-chart/table/metric-row 这类真实组件，不要用 emoji 或“图表占位”文本模拟图表。
媒体规则：没有明确可播放 URL 时，不要说已经能播放；可以生成播放器占位并提示用户选择本地文件或提供合法来源链接。不要承诺下载、抓取或绕过版权平台。

需要 UI 时优先调用 surface_render 或 media_prepare 这类结构化工具，不要输出 React/Vue/HTML/CSS/JSX/TSX 代码，也不要用自由文本模拟组件。普通问答直接回答文本。`;

export async function streamAgentStepWithAiSdk(params: {
  instructions: string;
  messages: ModelMessage[];
  tools?: ToolSet;
  abortSignal?: AbortSignal;
  onChunk?: (chunk: string) => void;
}): Promise<AiSdkAgentStep | null> {
  const configs = loadAiConfigCandidates();
  if (!configs.length) return null;

  let lastError: unknown;
  const candidates = availableConfigs(configs);
  for (const config of candidates) {
    let emitted = false;
    const timeout = withProviderTimeout(params.abortSignal);
    try {
      const result = await runAgentStep(config, { ...params, abortSignal: timeout.signal }, () => {
        emitted = true;
      });
      markProviderSuccess(config);
      return result;
    } catch (error) {
      lastError = error;
      if (!params.abortSignal?.aborted) markProviderFailure(config);
      if (params.abortSignal?.aborted || emitted) throw error;
    } finally {
      timeout.cleanup();
    }
  }

  throw lastError instanceof Error ? lastError : new Error("All configured AI providers failed.");
}

export async function streamWithAiSdk(userText: string, history: ChatMessage[], abortSignal?: AbortSignal): Promise<AiSdkTextStream | null> {
  const config = loadAiConfig();
  if (!config) return null;

  const result = streamText({
    model: createLanguageModel(config),
    system: SYSTEM_PROMPT,
    messages: toModelMessages(userText, history),
    maxOutputTokens: maxOutputTokensFor(config),
    temperature: temperatureFor(config),
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

export async function generateAgentPlanWithAiSdk(params: {
  userText: string;
  context: string;
  abortSignal?: AbortSignal;
}): Promise<AgentPlan | null> {
  return generateStructuredWithFallback<AgentPlan>({
    schemaName: "agent_plan",
    schemaDescription: "显式任务计划，供本地 Agent 执行和修订。",
    schema: jsonSchema<AgentPlan>({
      type: "object",
      properties: {
        goal: { type: "string" },
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              status: { type: "string", enum: ["pending", "in_progress", "completed"] },
              requiresTool: { type: "boolean" },
            },
            required: ["id", "title", "status"],
            additionalProperties: false,
          },
        },
      },
      required: ["goal", "steps"],
      additionalProperties: false,
    }),
    system: "你是 Meow Pilot 的计划器。输出 2-6 个短步骤，第一步通常为 in_progress。只规划，不执行。",
    prompt: [`上下文：`, params.context.slice(0, 8_000), "", "用户请求：", params.userText].join("\n"),
    abortSignal: params.abortSignal,
  });
}

export async function generateAgentReflectionWithAiSdk(params: {
  userText: string;
  finalText: string;
  abortSignal?: AbortSignal;
}): Promise<AgentReflection | null> {
  return generateStructuredWithFallback<AgentReflection>({
    schemaName: "agent_reflection",
    schemaDescription: "最终回答质量检查。",
    schema: jsonSchema<AgentReflection>({
      type: "object",
      properties: {
        complete: { type: "boolean" },
        issues: { type: "array", items: { type: "string" } },
        finalAnswer: { type: "string" },
      },
      required: ["complete", "issues"],
      additionalProperties: false,
    }),
    system: "你是 Meow Pilot 的最终检查器。判断回答是否充分回应用户请求；只指出真实缺口，不追求冗长。",
    prompt: [`用户请求：${params.userText}`, "", `最终回答：${params.finalText}`].join("\n"),
    abortSignal: params.abortSignal,
  });
}

export async function generateSessionSummaryWithAiSdk(messages: ChatMessage[], abortSignal?: AbortSignal): Promise<string | null> {
  const transcript = messages
    .filter((message) => message.role !== "system")
    .slice(-32)
    .map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content.replace(/\s+/g, " ").slice(0, 600)}`)
    .join("\n");
  if (!transcript.trim()) return null;

  const result = await generateStructuredWithFallback<SessionSummaryObject>({
    schemaName: "session_summary",
    schemaDescription: "中文会话摘要。",
    schema: jsonSchema<SessionSummaryObject>({
      type: "object",
      properties: {
        summary: { type: "string" },
      },
      required: ["summary"],
      additionalProperties: false,
    }),
    system: "你是 Meow Pilot 的会话摘要器。用中文总结用户目标、已做决定、关键上下文和未完成事项；不要逐条复制原文。",
    prompt: transcript,
    abortSignal,
  });
  return result?.summary?.trim() || null;
}

async function generateStructuredWithFallback<T>(params: {
  schemaName: string;
  schemaDescription: string;
  schema: ReturnType<typeof jsonSchema<T>>;
  system: string;
  prompt: string;
  abortSignal?: AbortSignal;
}): Promise<T | null> {
  const configs = loadAiConfigCandidates();
  if (!configs.length) return null;

  let lastError: unknown;
  const candidates = availableConfigs(configs);
  for (const config of candidates) {
    const timeout = withProviderTimeout(params.abortSignal);
    try {
      const result = await generateObject({
        model: createLanguageModel(config),
        schema: params.schema,
        schemaName: params.schemaName,
        schemaDescription: params.schemaDescription,
        system: params.system,
        prompt: params.prompt,
        maxOutputTokens: 900,
        temperature: 0,
        abortSignal: timeout.signal,
      });
      markProviderSuccess(config);
      return result.object as T;
    } catch (error) {
      lastError = error;
      if (!params.abortSignal?.aborted) markProviderFailure(config);
      if (params.abortSignal?.aborted) throw error;
    } finally {
      timeout.cleanup();
    }
  }

  if (lastError) throw lastError instanceof Error ? lastError : new Error("Structured generation failed.");
  return null;
}

function availableConfigs(configs: AiProviderConfig[]) {
  const now = Date.now();
  const available = configs.filter((config) => {
    const health = providerHealth.get(providerKey(config));
    return !health?.skipUntil || health.skipUntil <= now;
  });
  return available.length ? available : configs;
}

function markProviderSuccess(config: AiProviderConfig) {
  providerHealth.delete(providerKey(config));
}

function markProviderFailure(config: AiProviderConfig) {
  const key = providerKey(config);
  const current = providerHealth.get(key) ?? { failures: 0, skipUntil: 0 };
  const failures = current.failures + 1;
  const skipUntil = failures >= PROVIDER_CIRCUIT_FAILURES ? Date.now() + PROVIDER_CIRCUIT_COOLDOWN_MS : 0;
  providerHealth.set(key, { failures, skipUntil });
}

function providerKey(config: AiProviderConfig) {
  return `${config.provider}:${config.model}:${config.baseUrl ?? ""}`;
}

function withProviderTimeout(parent?: AbortSignal) {
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(PROVIDER_TIMEOUT_MS) && PROVIDER_TIMEOUT_MS > 0 ? PROVIDER_TIMEOUT_MS : 30_000;
  const timeout = setTimeout(() => controller.abort(new Error(`AI provider timed out after ${timeoutMs} ms.`)), timeoutMs);
  const onAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) onAbort();
  else parent?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      parent?.removeEventListener("abort", onAbort);
    },
  };
}

async function runAgentStep(
  config: AiProviderConfig,
  params: {
    instructions: string;
    messages: ModelMessage[];
    tools?: ToolSet;
    abortSignal?: AbortSignal;
    onChunk?: (chunk: string) => void;
  },
  markEmitted: () => void,
): Promise<AiSdkAgentStep> {
  const result = streamText({
    model: createLanguageModel(config),
    system: params.instructions,
    messages: params.messages,
    tools: params.tools,
    maxOutputTokens: maxOutputTokensFor(config),
    temperature: temperatureFor(config),
    abortSignal: params.abortSignal,
  });

  let text = "";
  for await (const chunk of result.textStream) {
    text += chunk;
    markEmitted();
    params.onChunk?.(chunk);
  }

  const toolCalls = (await result.toolCalls)
    .filter((call) => !call.invalid)
    .map((call) => ({
      toolCallId: call.toolCallId,
      toolName: String(call.toolName),
      input: isRecord(call.input) ? call.input : {},
    }));

  return {
    text,
    toolCalls,
    model: config.model,
    provider: config.provider,
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

export function chatMessagesToModelMessages(history: ChatMessage[], userText?: string, attachments: ChatMessage["attachments"] = []): ModelMessage[] {
  const messages: ModelMessage[] = history
    .filter((message) => message.role !== "system")
    .map((message) => toModelMessage(message));

  if (userText !== undefined) {
    messages.push(toUserModelMessage(userText, attachments));
  }
  return messages;
}

function toModelMessage(message: ChatMessage): ModelMessage {
  if (message.role === "assistant") return { role: "assistant", content: message.content };
  return toUserModelMessage(message.content, message.attachments);
}

function toUserModelMessage(text: string, attachments: ChatMessage["attachments"] = []): ModelMessage {
  if (!attachments?.length) return { role: "user", content: text };
  return {
    role: "user",
    content: [
      { type: "text", text },
      ...attachments.map((attachment) => ({
        type: "image" as const,
        image: attachment.dataUrl,
        mediaType: attachment.mimeType,
      })),
    ],
  };
}

function maxOutputTokensFor(config: AiProviderConfig) {
  const configured = Number(process.env.PET_AI_MAX_OUTPUT_TOKENS);
  if (Number.isFinite(configured) && configured > 0) return Math.floor(configured);
  if (/gpt-4\.1|gpt-4o|claude|gemini-2\.5|grok-3/i.test(config.model)) return 4096;
  return 2048;
}

function temperatureFor(_config: AiProviderConfig) {
  const configured = Number(process.env.PET_AI_TEMPERATURE);
  return Number.isFinite(configured) ? Math.max(0, Math.min(2, configured)) : 0.4;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
