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

输出格式：需要 UI 时只输出一个 pet-surface fenced JSON block，可以在 answer 中放一句自然语言说明。surface 使用扁平组件列表和 root，类似 A2UI 的 adjacency list；不要输出实现代码。

\`\`\`pet-surface
{
  "answer": "我把结果整理成可交互卡片，你可以直接继续操作。",
  "surface": {
    "title": "卡片标题",
    "type": "panel",
    "intent": "chat",
    "root": "root",
    "components": [
      {"id": "root", "kind": "stack", "direction": "column", "gap": "md", "children": ["summary", "items"]},
      {"id": "summary", "kind": "text", "variant": "body", "text": "简短说明"},
      {"id": "items", "kind": "list", "items": [{"id": "i1", "title": "下一步", "description": "可点击继续", "actionId": "refine"}]}
    ],
    "actions": [
      {"id": "refine", "label": "继续细化", "style": "primary", "icon": "plus"}
    ]
  }
}
\`\`\`

普通问答也可以直接回答文本；但不要把 UI 当作代码发给用户。`;

export async function streamWithAiSdk(userText: string, history: ChatMessage[], abortSignal?: AbortSignal): Promise<AiSdkTextStream | null> {
  const config = loadAiConfig();
  if (!config) return null;

  const result = streamText({
    model: createLanguageModel(config),
    system: SYSTEM_PROMPT,
    messages: toModelMessages(userText, history),
    maxOutputTokens: 2048,
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
