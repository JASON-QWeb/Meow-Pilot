import type { ChatMessage } from "@pet/protocol";
import { loadXiaomiAudioConfig, loadXiaomiConfig, loadXiaomiTtsConfig, type ApiProviderConfig } from "../apiConfig";

export type XiaomiGeneration = {
  text: string;
  model: string;
  source: "xiaomi";
};

export type XiaomiTranscription = {
  text: string;
  model: string;
  source: "xiaomi";
};

export type XiaomiSpeech = {
  audioData: string;
  mimeType: "audio/wav";
  model: string;
  voice: string;
  source: "xiaomi";
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
      reasoning_content?: string;
      audio?: {
        data?: string;
      };
    };
    delta?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

const MAX_SPEECH_CHARACTERS = 1200;

export async function generateWithXiaomi(userText: string, history: ChatMessage[]): Promise<XiaomiGeneration | null> {
  const config = loadXiaomiConfig();
  if (!config) return null;

  const messages = [
    {
      role: "system",
      content:
        "你是一个产品化桌面宠物 Agent 的大脑。回答要简洁、有温度、可执行。不要声称你已经真实打开外部应用，除非工具结果明确说明。中文优先。",
    },
    ...history.slice(-8).map((message) => ({
      role: message.role === "assistant" ? "assistant" : message.role === "system" ? "system" : "user",
      content: message.content,
    })),
    {
      role: "user",
      content: userText,
    },
  ];

  const body = await requestCompletion(config, {
    model: config.model,
    messages,
    max_completion_tokens: 1024,
    temperature: 0.7,
    top_p: 0.95,
    stream: false,
    thinking: {
      type: "disabled",
    },
  });

  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) return null;

  return {
    text,
    model: config.model ?? "mimo-v2.5-pro",
    source: "xiaomi",
  };
}

export async function transcribeWithXiaomi(audioData: string): Promise<XiaomiTranscription | null> {
  const config = loadXiaomiAudioConfig();
  if (!config) return null;
  if (!/^data:audio\/[-+.a-z0-9]+;base64,/i.test(audioData)) {
    throw new Error("Voice input must be a base64 audio data URL.");
  }

  const model = config.model ?? "mimo-v2.5";
  const body = await requestCompletion(config, {
    model,
    messages: [
      {
        role: "system",
        content: "你是准确的语音转写器。只输出录音中用户说出的文字，不回答问题，不添加解释或标点外的前后缀。",
      },
      {
        role: "user",
        content: [
          {
            type: "input_audio",
            input_audio: {
              data: audioData,
            },
          },
          {
            type: "text",
            text: "请逐字转写这段用户语音，只返回转写文本。",
          },
        ],
      },
    ],
    max_completion_tokens: 512,
    stream: false,
    thinking: {
      type: "disabled",
    },
  });

  const message = body.choices?.[0]?.message;
  const text = (message?.content || message?.reasoning_content)?.trim();
  if (!text) return null;

  return {
    text,
    model,
    source: "xiaomi",
  };
}

export async function synthesizeWithXiaomi(text: string): Promise<XiaomiSpeech | null> {
  const config = loadXiaomiTtsConfig();
  if (!config) return null;

  const targetText = text.trim().slice(0, MAX_SPEECH_CHARACTERS);
  if (!targetText) return null;

  const body = await requestCompletion(config, {
    model: config.model,
    messages: [
      {
        role: "user",
        content: config.instruction,
      },
      {
        role: "assistant",
        content: targetText,
      },
    ],
    audio: {
      format: "wav",
      voice: config.voice,
    },
    stream: false,
  });

  const audioData = body.choices?.[0]?.message?.audio?.data;
  if (!audioData) {
    throw new Error("Xiaomi TTS response did not include audio data.");
  }

  return {
    audioData,
    mimeType: "audio/wav",
    model: config.model,
    voice: config.voice,
    source: "xiaomi",
  };
}

async function requestCompletion(config: ApiProviderConfig, payload: unknown) {
  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "api-key": config.apiKey,
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const body = (await response.json().catch(() => ({}))) as ChatCompletionResponse;
  if (!response.ok) {
    throw new Error(body.error?.message ?? `Xiaomi model request failed with HTTP ${response.status}`);
  }
  return body;
}
