import type { AiProviderId, PetImageCutoutParams, PetImageCutoutPayload } from "@pet/protocol";
import { loadAiConfig, type AiProviderConfig } from "../apiConfig";

const DEFAULT_RESPONSES_IMAGE_SIZE = "1024x1024";
const DEFAULT_RESPONSES_IMAGE_QUALITY = "medium";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

type CutoutErrorCode = "BAD_REQUEST" | "PROVIDER_UNAVAILABLE" | "UPSTREAM_ERROR";

type ResponsesImageGenerationOutput = {
  type?: string;
  result?: string;
};

type ResponsesImageGenerationResponse = {
  output?: ResponsesImageGenerationOutput[];
  error?: {
    message?: string;
  };
};

export class PetImageCutoutError extends Error {
  constructor(
    message: string,
    readonly code: CutoutErrorCode,
  ) {
    super(message);
    this.name = "PetImageCutoutError";
  }
}

export async function cutoutPetImageWithConfiguredAi(params: PetImageCutoutParams): Promise<PetImageCutoutPayload | null> {
  decodeDataUrl(params.imageDataUrl);

  const config = loadAiConfig();
  if (!config) return null;

  if (!canUseResponsesImageGeneration(config.provider)) {
    throw new PetImageCutoutError(
      `当前已配置模型（${config.provider} / ${config.model}）不能直接返回透明 PNG。AI 抠图需要支持 Responses image_generation 工具的多模态图片编辑模型。`,
      "PROVIDER_UNAVAILABLE",
    );
  }

  return cutoutWithResponsesImageGeneration(params, config);
}

async function cutoutWithResponsesImageGeneration(params: PetImageCutoutParams, config: AiProviderConfig): Promise<PetImageCutoutPayload> {
  const baseUrl = (config.baseUrl ?? DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, "");

  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: petCutoutPrompt() },
            { type: "input_image", image_url: params.imageDataUrl, detail: "high" },
          ],
        },
      ],
      tools: [
        {
          type: "image_generation",
          action: "edit",
          background: "transparent",
          output_format: "png",
          size: DEFAULT_RESPONSES_IMAGE_SIZE,
          quality: DEFAULT_RESPONSES_IMAGE_QUALITY,
        },
      ],
      tool_choice: "required",
    }),
  });

  if (!response.ok) {
    throw new PetImageCutoutError(await responsesApiErrorMessage(response, config), "UPSTREAM_ERROR");
  }

  const payload = (await response.json()) as ResponsesImageGenerationResponse;
  const imageBase64 = payload.output?.find((item) => item.type === "image_generation_call" && item.result)?.result;
  if (!imageBase64) {
    throw new PetImageCutoutError("当前模型没有返回图片数据。请确认该模型支持 Responses image_generation 工具。", "UPSTREAM_ERROR");
  }

  return {
    imageDataUrl: `data:image/png;base64,${imageBase64}`,
    mimeType: "image/png",
    model: config.model,
    provider: config.provider,
    source: "responses-image-generation",
  };
}

function petCutoutPrompt() {
  return [
    "Create a clean transparent-background PNG cutout of the real pet in the source image.",
    "Preserve the pet's identity, pose, clothing, collar, harness, fur color, proportions, and visible expression.",
    "Remove the entire background, floor, furniture, people, shadows, leash, loose cables, reflections, and any object that is not part of the pet or its worn accessories.",
    "Keep the full visible pet body included, centered, with natural edge feathering.",
    "Do not add text, stickers, new accessories, borders, or a replacement background.",
  ].join(" ");
}

function decodeDataUrl(dataUrl: string) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\r\n]+)$/.exec(dataUrl);
  if (!match) {
    throw new PetImageCutoutError("AI 抠图只支持 base64 图片数据。", "BAD_REQUEST");
  }

  const mimeType = match[1] ?? "image/png";
  if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType)) {
    throw new PetImageCutoutError("AI 抠图只支持 PNG、JPG 或 WebP 图片。", "BAD_REQUEST");
  }

  const bytes = Buffer.from((match[2] ?? "").replace(/\s/g, ""), "base64");
  if (bytes.byteLength <= 0) {
    throw new PetImageCutoutError("图片数据为空。", "BAD_REQUEST");
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new PetImageCutoutError("图片大小不能超过 15 MB。", "BAD_REQUEST");
  }

  return {
    mimeType,
    bytes,
  };
}

async function responsesApiErrorMessage(response: Response, config: AiProviderConfig) {
  const fallback = `当前模型图片编辑失败（${config.provider} / ${config.model}，HTTP ${response.status}）。`;
  const text = await response.text().catch(() => "");
  if (!text) return fallback;

  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    return parsed.error?.message ? `当前模型图片编辑失败：${parsed.error.message}` : fallback;
  } catch {
    return `${fallback} ${text.slice(0, 240)}`;
  }
}

function canUseResponsesImageGeneration(provider: AiProviderId) {
  return provider === "openai" || provider === "openai-compatible";
}
