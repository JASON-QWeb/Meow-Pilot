import { WebSocketServer, type WebSocket } from "ws";
import {
  type AccountCurrentPayload,
  type AccountSignInParams,
  type AccountSignInPayload,
  type AgentDeltaEvent,
  type AgentLifecycleEvent,
  type ChatMessage,
  type ChatMessageEvent,
  type ChatSendParams,
  type ChatSendPayload,
  type ComponentNode,
  type FriendAddParams,
  type FriendAddPayload,
  type FriendListPayload,
  type HelloPayload,
  type LocalEventName,
  type LocalRpcMethod,
  type Memory,
  type MemoryProposalEvent,
  type PetActivityEvent,
  type PetEmotionEvent,
  type PetImageCutoutParams,
  type PetImageCutoutPayload,
  type ProviderConfigureParams,
  type ProviderConfigurePayload,
  type RpcRequest,
  type RpcResponse,
  type RuntimeStatsPayload,
  type SessionCreateParams,
  type SessionCreatePayload,
  type SessionDeleteParams,
  type SessionDeletePayload,
  type SessionListPayload,
  type SessionResumeParams,
  type SessionResumePayload,
  type SocialExchangeParams,
  type SocialExchangePayload,
  type SurfaceEvent,
  type SurfaceSpec,
  type TokenUsageListPayload,
  type VoiceSpeakParams,
  type VoiceSpeakPayload,
  type VoiceConfigureParams,
  type VoiceTranscribeParams,
  type VoiceTranscribePayload,
  isRpcRequest,
} from "@pet/protocol";
import { listProviders, skills } from "./catalog";
import { saveLocalAiConfig, saveLocalXiaomiVoiceConfig } from "./apiConfig";
import { streamWithAiSdk, synthesizeWithAiSdk, transcribeWithAiSdk } from "./providers/aiSdk";
import { cutoutPetImageWithConfiguredAi, PetImageCutoutError } from "./providers/openaiImageCutout";
import { synthesizeWithXiaomi, transcribeWithXiaomi } from "./providers/xiaomi";
import { PetStore, type RuntimeSession } from "./storage";
import { parseAgentSurfaceResponse } from "./surfaceProtocol";
import { listTokenUsage } from "./usage";

const PORT = Number(process.env.PET_AGENTD_PORT ?? 4747);
const HOST = process.env.PET_AGENTD_HOST ?? "127.0.0.1";
const clients = new Map<WebSocket, ClientState>();

type ClientState = {
  seq: number;
  activeRuns: Map<string, AbortController>;
};

type AgentRunOptions = {
  userMessageId?: string;
  source?: ChatSendParams["source"];
  surfaceAction?: ChatSendParams["surfaceAction"];
};

const store = new PetStore();

const methods: LocalRpcMethod[] = [
  "hello",
  "session.create",
  "session.list",
  "session.resume",
  "session.delete",
  "chat.send",
  "voice.transcribe",
  "voice.speak",
  "voice.configure",
  "agent.cancel",
  "runtime.stats",
  "account.current",
  "account.signIn",
  "friend.list",
  "friend.add",
  "social.exchange",
  "memory.list",
  "memory.commit",
  "memory.reject",
  "skill.list",
  "skill.run",
  "usage.list",
  "pet.image.cutout",
  "provider.configure",
  "provider.list",
];

const events: LocalEventName[] = [
  "agent.lifecycle",
  "agent.delta",
  "chat.message",
  "memory.proposal",
  "pet.emotion",
  "pet.activity",
  "ui.surface.create",
  "ui.surface.update",
  "ui.surface.delete",
];

const wss = new WebSocketServer({ host: HOST, port: PORT });

wss.on("connection", (socket) => {
  const state: ClientState = { seq: 0, activeRuns: new Map() };
  clients.set(socket, state);

  socket.on("message", (raw) => {
    void handleRawFrame(socket, state, raw.toString());
  });

  socket.on("close", () => {
    cancelActiveRuns(state);
    clients.delete(socket);
  });
});

wss.on("listening", () => {
  console.log(`[pet-agentd] listening on ws://${HOST}:${PORT}`);
});

async function handleRawFrame(socket: WebSocket, state: ClientState, raw: string) {
  let frame: unknown;
  try {
    frame = JSON.parse(raw);
  } catch {
    sendResponse(socket, {
      type: "res",
      id: "unknown",
      ok: false,
      error: { code: "BAD_JSON", message: "Frame must be valid JSON." },
    });
    return;
  }

  if (!isRpcRequest(frame)) {
    sendResponse(socket, {
      type: "res",
      id: "unknown",
      ok: false,
      error: { code: "BAD_FRAME", message: "Only request frames are accepted by pet-agentd." },
    });
    return;
  }

  try {
    await handleRequest(socket, state, frame);
  } catch (error) {
    sendResponse(socket, {
      type: "res",
      id: frame.id,
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Unknown runtime error.",
      },
    });
  }
}

async function handleRequest(socket: WebSocket, state: ClientState, request: RpcRequest) {
  switch (request.method) {
    case "hello": {
      const payload: HelloPayload = {
        serverName: "pet-agentd",
        protocolVersion: "0.1",
        features: {
          methods,
          events,
          surfaceVersion: "0.1",
        },
      };
      sendOk(socket, request.id, payload);
      return;
    }

    case "session.create": {
      const params = (request.params ?? {}) as SessionCreateParams;
      const now = new Date().toISOString();
      const session = store.createSession(params.title?.trim() || "桌面宠物会话", now);
      const welcomeMessage: ChatMessage = {
        id: `msg_${crypto.randomUUID()}`,
        role: "assistant",
        content: welcomeText(),
        createdAt: now,
      };
      store.saveMessage(session.id, welcomeMessage);
      const payload: SessionCreatePayload = { sessionId: session.id, title: session.title, messages: [welcomeMessage], surfaces: [] };
      sendOk(socket, request.id, payload);
      emit(socket, state, "chat.message", { sessionId: session.id, message: welcomeMessage } satisfies ChatMessageEvent);
      emitPet(socket, state, session.id, "idle", 0.45, "session-created");
      emitActivity(socket, state, session.id, "sleeping", false, "session-created");
      return;
    }

    case "session.list": {
      sendOk(socket, request.id, { sessions: store.listSessions() } satisfies SessionListPayload);
      return;
    }

    case "session.resume": {
      const params = (request.params ?? {}) as SessionResumeParams;
      const session = params.sessionId ? store.getSession(params.sessionId) : ensureSession();
      if (!session) {
        sendError(socket, request.id, "NOT_FOUND", "Session does not exist.");
        return;
      }
      const payload: SessionResumePayload = {
        sessionId: session.id,
        title: session.title,
        messages: store.listMessages(session.id),
        surfaces: store.listSurfaces(session.id),
      };
      sendOk(socket, request.id, payload);
      emitPet(socket, state, session.id, "idle", 0.45, "session-resumed");
      emitActivity(socket, state, session.id, "sleeping", false, "session-resumed");
      return;
    }

    case "session.delete": {
      const params = request.params as SessionDeleteParams | undefined;
      if (!params?.sessionId) {
        sendError(socket, request.id, "BAD_REQUEST", "session.delete requires sessionId.");
        return;
      }
      const deleted = store.deleteSession(params.sessionId);
      if (!deleted) {
        sendError(socket, request.id, "NOT_FOUND", "Session does not exist.");
        return;
      }
      sendOk(socket, request.id, { sessionId: params.sessionId, deleted: true } satisfies SessionDeletePayload);
      return;
    }

    case "chat.send": {
      const params = request.params as ChatSendParams | undefined;
      if (!params?.sessionId || !params.text?.trim()) {
        sendError(socket, request.id, "BAD_REQUEST", "chat.send requires sessionId and text.");
        return;
      }

      const session = store.getSession(params.sessionId);
      if (!session) {
        sendError(socket, request.id, "NOT_FOUND", "Session does not exist.");
        return;
      }

      const runId = `run_${crypto.randomUUID()}`;
      const abortController = startRun(state, runId);
      const shouldDisplayUserMessage = params.source !== "ui";
      const userMessage: ChatMessage | undefined = shouldDisplayUserMessage
        ? {
            id: `msg_${crypto.randomUUID()}`,
            role: "user",
            content: params.text,
            createdAt: new Date().toISOString(),
            runId,
          }
        : undefined;
      if (userMessage) {
        store.saveMessage(session.id, userMessage);
        emit(socket, state, "chat.message", { sessionId: session.id, message: userMessage } satisfies ChatMessageEvent);
      }
      sendOk(socket, request.id, { runId, status: "accepted" } satisfies ChatSendPayload);
      void runAgent(socket, state, session, runId, params.text, abortController, {
        userMessageId: userMessage?.id,
        source: params.source,
        surfaceAction: params.surfaceAction,
      });
      return;
    }

    case "agent.cancel": {
      cancelActiveRuns(state);
      sendOk(socket, request.id, { cancelled: true });
      const session = ensureSession();
      emitPet(socket, state, session.id, "idle", 0.4, "run-cancelled");
      emitActivity(socket, state, session.id, restActivity(), false, "run-cancelled");
      return;
    }

    case "runtime.stats": {
      sendOk(socket, request.id, store.getRuntimeStats() satisfies RuntimeStatsPayload);
      return;
    }

    case "voice.transcribe": {
      const params = request.params as VoiceTranscribeParams | undefined;
      if (!params?.audioData || params.audioData.length > 50_000_000) {
        sendError(socket, request.id, "BAD_REQUEST", "voice.transcribe requires base64 audio data smaller than 50 MB.");
        return;
      }

      const transcription = (await transcribeWithXiaomi(params.audioData)) ?? (await transcribeWithAiSdk(params.audioData));
      if (!transcription) {
        sendError(socket, request.id, "PROVIDER_UNAVAILABLE", "Voice input requires Xiaomi MiMo or OpenAI voice configuration.");
        return;
      }
      sendOk(socket, request.id, {
        text: transcription.text,
        model: transcription.model,
      } satisfies VoiceTranscribePayload);
      return;
    }

    case "voice.speak": {
      const params = request.params as VoiceSpeakParams | undefined;
      if (!params?.text?.trim()) {
        sendError(socket, request.id, "BAD_REQUEST", "voice.speak requires text.");
        return;
      }

      const speech = (await synthesizeWithXiaomi(params.text)) ?? (await synthesizeWithAiSdk(params.text));
      if (!speech) {
        sendError(socket, request.id, "PROVIDER_UNAVAILABLE", "Voice output requires Xiaomi MiMo or OpenAI voice configuration.");
        return;
      }
      sendOk(socket, request.id, {
        accepted: true,
        mode: speech.source === "xiaomi" ? "xiaomi-tts" : "ai-sdk-tts",
        audioData: speech.audioData,
        mimeType: speech.mimeType,
        model: speech.model,
        voice: speech.voice,
      } satisfies VoiceSpeakPayload);
      return;
    }

    case "voice.configure": {
      const params = request.params as VoiceConfigureParams | undefined;
      if (params?.provider !== "xiaomi" || !params.apiKey?.trim()) {
        sendError(socket, request.id, "BAD_REQUEST", "voice.configure requires Xiaomi provider and API key.");
        return;
      }
      try {
        saveLocalXiaomiVoiceConfig(params);
      } catch (error) {
        sendError(socket, request.id, "BAD_REQUEST", error instanceof Error ? error.message : "Invalid voice provider configuration.");
        return;
      }
      sendOk(socket, request.id, { providers: listProviders() });
      return;
    }

    case "account.current": {
      sendOk(socket, request.id, { account: store.getCurrentAccount() } satisfies AccountCurrentPayload);
      return;
    }

    case "account.signIn": {
      const params = request.params as AccountSignInParams | undefined;
      if (!params?.displayName?.trim()) {
        sendError(socket, request.id, "BAD_REQUEST", "account.signIn requires displayName.");
        return;
      }
      const account = store.signInLocal(params.displayName, params.handle);
      sendOk(socket, request.id, { account } satisfies AccountSignInPayload);
      return;
    }

    case "friend.list": {
      sendOk(socket, request.id, { friends: store.listFriends() } satisfies FriendListPayload);
      return;
    }

    case "friend.add": {
      const params = request.params as FriendAddParams | undefined;
      if (!params?.handle?.trim()) {
        sendError(socket, request.id, "BAD_REQUEST", "friend.add requires handle.");
        return;
      }
      const friend = store.addFriend(params.handle, params.displayName, params.petName);
      sendOk(socket, request.id, { friend } satisfies FriendAddPayload);
      return;
    }

    case "social.exchange": {
      const params = request.params as SocialExchangeParams | undefined;
      if (!params?.friendId) {
        sendError(socket, request.id, "BAD_REQUEST", "social.exchange requires friendId.");
        return;
      }
      const friend = store.getFriend(params.friendId);
      if (!friend) {
        sendError(socket, request.id, "NOT_FOUND", "Friend does not exist.");
        return;
      }
      const account = store.getCurrentAccount() ?? store.signInLocal("本地用户");
      const sharedSkills = skills.filter((skill) => skill.enabled).slice(0, 4).map((skill) => skill.name);
      const shareableMemories = store
        .listMemories()
        .filter((memory) => memory.scope === "social" || memory.scope === "shared")
        .slice(0, 6);
      const summary = [
        `${account.displayName} 的宠物和 ${friend.displayName} 完成了一次本地交换。`,
        `共享 skill: ${sharedSkills.join(", ") || "none"}.`,
        `共享记忆摘要 ${shareableMemories.length} 条；private 记忆只统计不外发。`,
        params.note?.trim() ? `备注: ${params.note.trim()}` : "",
      ]
        .filter(Boolean)
        .join(" ");
      const exchange = store.recordSocialExchange(friend.id, summary, sharedSkills, shareableMemories.length);
      sendOk(socket, request.id, { exchange } satisfies SocialExchangePayload);
      return;
    }

    case "memory.list": {
      sendOk(socket, request.id, { memories: store.listMemories() });
      return;
    }

    case "memory.commit": {
      const params = request.params as { proposal?: Memory } | undefined;
      if (params?.proposal) {
        store.saveMemory(params.proposal);
      }
      sendOk(socket, request.id, { memories: store.listMemories() });
      return;
    }

    case "memory.reject": {
      sendOk(socket, request.id, { rejected: true });
      return;
    }

    case "skill.list": {
      sendOk(socket, request.id, { skills });
      return;
    }

    case "skill.run": {
      const params = request.params as { sessionId?: string; name?: string; input?: string } | undefined;
      if (!params?.sessionId || !params.name) {
        sendError(socket, request.id, "BAD_REQUEST", "skill.run requires sessionId and name.");
        return;
      }
      const session = store.getSession(params.sessionId);
      if (!session) {
        sendError(socket, request.id, "NOT_FOUND", "Session does not exist.");
        return;
      }
      const prompt = `${params.name} ${params.input ?? ""}`.trim();
      const runId = `run_${crypto.randomUUID()}`;
      const abortController = startRun(state, runId);
      const userMessage: ChatMessage = {
        id: `msg_${crypto.randomUUID()}`,
        role: "user",
        content: `/${prompt}`,
        createdAt: new Date().toISOString(),
        runId,
      };
      store.saveMessage(session.id, userMessage);
      emit(socket, state, "chat.message", { sessionId: session.id, message: userMessage } satisfies ChatMessageEvent);
      sendOk(socket, request.id, { runId, status: "accepted" } satisfies ChatSendPayload);
      void runAgent(socket, state, session, runId, prompt, abortController);
      return;
    }

    case "usage.list": {
      sendOk(socket, request.id, { summaries: await listTokenUsage() } satisfies TokenUsageListPayload);
      return;
    }

    case "pet.image.cutout": {
      const params = request.params as PetImageCutoutParams | undefined;
      if (!params?.imageDataUrl) {
        sendError(socket, request.id, "BAD_REQUEST", "pet.image.cutout requires imageDataUrl.");
        return;
      }

      let payload: PetImageCutoutPayload | null;
      try {
        payload = await cutoutPetImageWithConfiguredAi(params);
      } catch (error) {
        if (error instanceof PetImageCutoutError) {
          sendError(socket, request.id, error.code, error.message);
          return;
        }
        throw error;
      }

      if (!payload) {
        sendError(socket, request.id, "PROVIDER_UNAVAILABLE", "AI 智能抠图需要先配置一个支持图片生成/编辑工具的模型。");
        return;
      }

      sendOk(socket, request.id, payload satisfies PetImageCutoutPayload);
      return;
    }

    case "provider.configure": {
      const params = request.params as ProviderConfigureParams | undefined;
      if (!params?.provider || !params.apiKey?.trim() || !params.model?.trim()) {
        sendError(socket, request.id, "BAD_REQUEST", "provider.configure requires provider, apiKey, and model.");
        return;
      }
      try {
        saveLocalAiConfig(params);
      } catch (error) {
        sendError(socket, request.id, "BAD_REQUEST", error instanceof Error ? error.message : "Invalid provider configuration.");
        return;
      }
      sendOk(socket, request.id, { providers: listProviders() } satisfies ProviderConfigurePayload);
      return;
    }

    case "provider.list": {
      sendOk(socket, request.id, { providers: listProviders() });
      return;
    }

    default:
      sendError(socket, request.id, "UNKNOWN_METHOD", `Unknown method: ${request.method}`);
  }
}

async function runAgent(
  socket: WebSocket,
  state: ClientState,
  session: RuntimeSession,
  runId: string,
  text: string,
  abortController: AbortController,
  options: AgentRunOptions = {},
) {
  emit(socket, state, "agent.lifecycle", { sessionId: session.id, runId, phase: "start" } satisfies AgentLifecycleEvent);
  emitActivity(socket, state, session.id, activityForTask(text), true, "task-start");
  emitPet(socket, state, session.id, "thinking", 0.72, "agent-routing");

  const actionSurface = options.surfaceAction ? store.getSurface(session.id, options.surfaceAction.surfaceId) : null;
  const agentText = options.surfaceAction ? buildSurfaceActionAgentText(text, options.surfaceAction, actionSurface) : text;
  const history = store.listMessages(session.id).filter((message) => message.id !== options.userMessageId);
  const inlineSurface = createInlineMediaSurface(agentText);
  const bufferA2ui = Boolean(inlineSurface) || shouldBufferA2ui(agentText);

  let rawAssistantText = "";
  let assistantText = "";
  let streamedAssistantText = "";
  let responseSurface: SurfaceSpec | undefined = inlineSurface;
  try {
    const directResponse = inlineSurface ? createInlineMediaResponse(inlineSurface) : createChartResponse(agentText) ?? (await createWeatherResponse(agentText, options.surfaceAction, actionSurface));
    if (directResponse) {
      assistantText = directResponse.text;
      responseSurface = directResponse.surface;
    } else {
      const stream = await streamWithAiSdk(agentText, history, abortController.signal);
      if (!stream) {
        assistantText = "还没有可用的模型 API 配置。请在配置页的“模型 API”里保存 DeepSeek API Key 和模型名，例如 deepseek-chat，然后再发送消息。";
        responseSurface = undefined;
      } else {
        for await (const chunk of stream.textStream) {
          if (!state.activeRuns.has(runId)) return;
          rawAssistantText += chunk;
          if (!bufferA2ui) {
            streamedAssistantText += chunk;
            emit(socket, state, "agent.delta", {
              sessionId: session.id,
              runId,
              text: chunk,
            } satisfies AgentDeltaEvent);
          }
        }
        const parsed = parseAgentSurfaceResponse(rawAssistantText, { now: new Date().toISOString(), userText: agentText });
        assistantText = parsed.text || (parsed.surface ? "我把回复整理成一张可交互卡片。" : "");
        responseSurface = inlineSurface ?? parsed.surface;
      }
    }
  } catch (error) {
    if (abortController.signal.aborted) return;
    const message = error instanceof Error ? error.message : "未知错误";
    console.warn(`[pet-agentd] AI SDK generation failed: ${message}`);
    assistantText = `模型调用失败：${message}`;
    responseSurface = undefined;
    emit(socket, state, "agent.lifecycle", { sessionId: session.id, runId, phase: "error", message } satisfies AgentLifecycleEvent);
  }

  if (!state.activeRuns.has(runId)) return;

  if (responseSurface) {
    store.saveSurface(session.id, responseSurface);
    emit(socket, state, "ui.surface.create", { sessionId: session.id, surface: responseSurface } satisfies SurfaceEvent);
  }

  const finalDeltaText = streamedAssistantText ? assistantText.slice(streamedAssistantText.length) : assistantText;
  if (finalDeltaText || responseSurface) {
    emit(socket, state, "agent.delta", {
      sessionId: session.id,
      runId,
      text: finalDeltaText,
      ...(responseSurface ? { surface: responseSurface } : {}),
    } satisfies AgentDeltaEvent);
  }

  const assistantMessage: ChatMessage = {
    id: `msg_${crypto.randomUUID()}`,
    role: "assistant",
    content: assistantText.trim() || (responseSurface ? "可交互卡片已生成。" : "模型没有返回文本。"),
    createdAt: new Date().toISOString(),
    runId,
    ...(responseSurface ? { surface: responseSurface } : {}),
  };
  store.saveMessage(session.id, assistantMessage);
  emit(socket, state, "chat.message", { sessionId: session.id, message: assistantMessage } satisfies ChatMessageEvent);
  emitPet(socket, state, session.id, "speaking", 0.55, "answer-ready");

  state.activeRuns.delete(runId);
  emit(socket, state, "agent.lifecycle", { sessionId: session.id, runId, phase: "end" } satisfies AgentLifecycleEvent);
  await sleep(600);
  if (state.activeRuns.size === 0) {
    emitPet(socket, state, session.id, "idle", 0.4, "turn-complete");
    emitActivity(socket, state, session.id, restActivity(), false, "turn-complete");
  }
}

function buildSurfaceActionAgentText(text: string, surfaceAction: NonNullable<ChatSendParams["surfaceAction"]>, surface: SurfaceSpec | null) {
  const action = surface?.actions?.find((candidate) => candidate.id === surfaceAction.actionId);
  const actionLabel = action?.label ?? text;
  const surfaceTitle = surface?.title ?? surface?.intent ?? surfaceAction.surfaceId;
  const surfaceContext = surface ? `\n当前卡片摘要：${JSON.stringify(compactSurfaceForPrompt(surface))}` : "";
  return [
    `内部 UI 事件：用户点击了「${surfaceTitle}」卡片上的「${actionLabel}」。`,
    "请基于这个动作和当前卡片继续回复，不要在回复中复述这条内部事件。",
    "如果需要可交互卡片，只输出 pet-surface fenced JSON block；如果不需要卡片，直接自然语言回答。",
    surfaceContext,
  ]
    .filter(Boolean)
    .join("\n");
}

function compactSurfaceForPrompt(surface: SurfaceSpec) {
  return {
    title: surface.title,
    intent: surface.intent,
    type: surface.type,
    data: surface.data,
    actions: surface.actions?.map((action) => ({ id: action.id, label: action.label })),
    layout: surface.layout,
  };
}

function shouldBufferA2ui(text: string) {
  const lower = text.toLowerCase();
  return containsAny(lower, ["卡片", "组件", "表格", "表单", "看板", "图表", "饼状图", "饼图", "播放器", "a2ui", "ui", "chart", "table", "form", "dashboard"]);
}

type WeatherAgentResponse = {
  text: string;
  surface?: SurfaceSpec;
};

function createInlineMediaResponse(surface: SurfaceSpec): WeatherAgentResponse | undefined {
  if (surface.layout.kind !== "media-player") return undefined;
  const mediaLabel = surface.layout.media === "music" ? "音频" : "视频";
  if (surface.layout.src || surface.layout.embedUrl) {
    return {
      text: `我把这个${mediaLabel}链接放进播放器了。`,
      surface,
    };
  }
  if (surface.layout.sourceUrl) {
    return {
      text: `这个来源不能直接内嵌播放，可以先打开原站；如果你有本地文件，也可以在播放器里选择文件。`,
      surface,
    };
  }
  return {
    text: `还没有可播放来源。你可以选择本地${mediaLabel}文件，或者发一个合法可播放链接。`,
    surface,
  };
}

function createChartResponse(text: string): WeatherAgentResponse | undefined {
  if (!isPieChartRequest(text)) return undefined;
  const segments = extractPieSegments(text);
  if (segments.length < 2) {
    return {
      text: "要画饼状图的话，把分类和数值发我就行，比如：直接搜索 40%、社交媒体 25%、广告 20%、其他 15%。",
    };
  }

  const now = new Date().toISOString();
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const rows = segments.map((segment) => ({
    label: segment.label,
    value: segment.value,
    percent: total ? `${Math.round((segment.value / total) * 100)}%` : "0%",
  }));

  return {
    text: "我按你给的数据生成了饼状图。",
    surface: {
      id: `surface_${crypto.randomUUID()}`,
      type: "panel",
      intent: "chat",
      title: "饼状图",
      layout: {
        kind: "stack",
        direction: "column",
        gap: "md",
        children: [
          {
            kind: "pie-chart",
            title: "占比分布",
            segments,
          },
          {
            kind: "table",
            columns: [
              { key: "label", label: "分类" },
              { key: "value", label: "数值" },
              { key: "percent", label: "占比" },
            ],
            rows,
          },
        ],
      },
      data: {
        source: "user-provided",
      },
      createdAt: now,
    },
  };
}

function isPieChartRequest(text: string) {
  const lower = text.toLowerCase();
  return containsAny(lower, ["饼状图", "饼图", "pie chart", "pie-chart"]);
}

function extractPieSegments(text: string) {
  const segments: Array<{ label: string; value: number }> = [];
  const normalized = text
    .replace(/[，、；;]/g, "\n")
    .replace(/\s+\|\s+/g, "\n");
  const pattern = /([^\d\n:：|]{1,40})[:：]?\s*(-?\d+(?:\.\d+)?)\s*%?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(normalized))) {
    const label = normalizePieLabel(match[1]);
    const value = Number(match[2]);
    if (!label || !Number.isFinite(value) || value <= 0) continue;
    if (segments.some((segment) => segment.label === label)) continue;
    segments.push({ label, value });
  }
  return segments.slice(0, 8);
}

function normalizePieLabel(value?: string) {
  if (!value) return undefined;
  const label = value
    .replace(/(请|帮我|生成|画|做|一个|一张|饼状图|饼图|占比|分布|数据|如下|分别是|为)/g, "")
    .replace(/[^\p{Script=Han}A-Za-z0-9 _.-]/gu, "")
    .trim();
  if (!label || /^(近|最近|过去|未来|第|前|top)$/i.test(label)) return undefined;
  if (/[天日周月年]$/.test(label)) return undefined;
  return label.slice(0, 40);
}

type WeatherLocation = {
  name: string;
  latitude: number;
  longitude: number;
  label: string;
  timezone?: string;
};

type OpenMeteoGeocodeResponse = {
  results?: Array<{
    name?: string;
    latitude?: number;
    longitude?: number;
    country?: string;
    admin1?: string;
    timezone?: string;
  }>;
};

type OpenMeteoForecastResponse = {
  timezone?: string;
  current?: {
    time?: string;
    temperature_2m?: number;
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    weather_code?: number;
    wind_speed_10m?: number;
  };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
  };
};

async function createWeatherResponse(agentText: string, surfaceAction?: ChatSendParams["surfaceAction"], surface?: SurfaceSpec | null): Promise<WeatherAgentResponse | undefined> {
  const isWeatherAction = Boolean(surfaceAction && (surfaceAction.actionId.startsWith("weather-") || surface?.intent === "weather"));
  if (!isWeatherAction && !isWeatherRequest(agentText)) return undefined;

  const days = surfaceAction?.actionId === "weather-7d" || wantsSevenDayForecast(agentText) ? 7 : 1;
  const surfaceLocation = readWeatherLocation(surface);
  const requestedLocation = extractWeatherLocation(agentText) ?? process.env.PET_WEATHER_LOCATION?.trim();

  if (!surfaceLocation && !requestedLocation) {
    return {
      text: "你想查哪个城市的天气？告诉我城市名后，我会用实时天气数据生成卡片。",
    };
  }

  try {
    const location = surfaceLocation ?? (await geocodeWeatherLocation(requestedLocation!));
    if (!location) {
      return {
        text: `没找到「${requestedLocation}」的天气位置。换一个城市名试试。`,
      };
    }

    const forecast = await fetchWeatherForecast(location, days);
    const now = new Date().toISOString();
    if (days >= 7) {
      return {
        text: `这是 ${location.label} 未来 7 天的实时天气预报。`,
        surface: buildSevenDayWeatherSurface(location, forecast, now),
      };
    }

    return {
      text: `这是 ${location.label} 的今日实时天气。`,
      surface: buildTodayWeatherSurface(location, forecast, now),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "天气数据获取失败。";
    return {
      text: `天气数据获取失败：${message}`,
    };
  }
}

function isWeatherRequest(text: string) {
  const lower = text.toLowerCase();
  return containsAny(lower, ["天气", "气温", "降雨", "下雨", "预报", "weather", "forecast", "temperature"]);
}

function wantsSevenDayForecast(text: string) {
  const lower = text.toLowerCase();
  return containsAny(lower, ["未来7天", "未来七天", "7天天气", "七天天气", "一周天气", "7-day", "seven-day", "weekly forecast"]);
}

function extractWeatherLocation(text: string) {
  const patterns = [
    /([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z\s.'-]{1,48})(?:的)?(?:今日|今天|当前|实时|未来(?:7|七)天|一周)?(?:天气|气温|预报)/u,
    /(?:天气|气温|预报).{0,12}(?:在|查|看|查询|查看)?\s*([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z\s.'-]{1,48})/u,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = cleanWeatherLocationCandidate(match?.[1]);
    if (candidate) return candidate;
  }

  return undefined;
}

function cleanWeatherLocationCandidate(value?: string) {
  if (!value) return undefined;
  let candidate = value
    .replace(/内部 UI 事件.*/g, "")
    .replace(/用户点击了/g, "")
    .replace(/卡片上?的?/g, "")
    .replace(/(帮我|请|给我|我要|我想|想看|查一下|查询|查|看看|查看|显示|生成|整理|一下)/g, "")
    .replace(/(今日|今天|当前|实时|明天|未来7天|未来七天|一周|七天|7天|的)$/g, "")
    .replace(/[「」"'`]/g, "")
    .trim();

  candidate = candidate.replace(/\s+/g, " ");
  const invalid = new Set(["天气", "气温", "预报", "今日", "今天", "未来", "未来7天", "未来七天", "卡片", "当前", "实时", "clear"]);
  if (!candidate || invalid.has(candidate.toLowerCase())) return undefined;
  return candidate;
}

function readWeatherLocation(surface?: SurfaceSpec | null): WeatherLocation | null {
  if (!surface || surface.intent !== "weather" || !isRecord(surface.data)) return null;
  const latitude = readNumber(surface.data.latitude);
  const longitude = readNumber(surface.data.longitude);
  const name = typeof surface.data.locationName === "string" ? surface.data.locationName : undefined;
  const label = typeof surface.data.locationLabel === "string" ? surface.data.locationLabel : name;
  const timezone = typeof surface.data.timezone === "string" ? surface.data.timezone : undefined;
  if (!name || !label || latitude === undefined || longitude === undefined) return null;
  return { name, label, latitude, longitude, timezone };
}

async function geocodeWeatherLocation(locationName: string): Promise<WeatherLocation | null> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", locationName);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "zh");
  url.searchParams.set("format", "json");
  const payload = await fetchJson<OpenMeteoGeocodeResponse>(url.toString());
  const first = payload.results?.[0];
  if (!first?.name || typeof first.latitude !== "number" || typeof first.longitude !== "number") return null;
  const label = [first.name, first.admin1, first.country].filter(Boolean).join(" · ");
  return {
    name: first.name,
    latitude: first.latitude,
    longitude: first.longitude,
    label,
    timezone: first.timezone,
  };
}

async function fetchWeatherForecast(location: WeatherLocation, days: number): Promise<OpenMeteoForecastResponse> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set("current", "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m");
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max");
  url.searchParams.set("forecast_days", String(days));
  url.searchParams.set("timezone", location.timezone || "auto");
  return fetchJson<OpenMeteoForecastResponse>(url.toString());
}

function buildTodayWeatherSurface(location: WeatherLocation, forecast: OpenMeteoForecastResponse, now: string): SurfaceSpec {
  const current = forecast.current ?? {};
  const daily = forecast.daily ?? {};
  const max = daily.temperature_2m_max?.[0];
  const min = daily.temperature_2m_min?.[0];
  const precip = daily.precipitation_probability_max?.[0];
  const weatherCode = current.weather_code ?? daily.weather_code?.[0];
  const summary = [
    weatherCode === undefined ? undefined : weatherCodeLabel(weatherCode),
    max === undefined || min === undefined ? undefined : `最高 ${formatTemperature(max)} / 最低 ${formatTemperature(min)}`,
    precip === undefined ? undefined : `最大降雨概率 ${formatPercent(precip)}`,
  ]
    .filter(Boolean)
    .join("，");

  return weatherSurfaceBase(location, "今日天气", now, {
    kind: "stack",
    direction: "column",
    gap: "md",
    children: [
      {
        kind: "text",
        variant: "body",
        text: `数据源 Open-Meteo，更新时间 ${formatWeatherTime(current.time ?? now)}。${summary || "暂无完整概况。"}`,
      },
      {
        kind: "metric-row",
        metrics: [
          { label: "气温", value: formatTemperature(current.temperature_2m), tone: "neutral" },
          { label: "体感", value: formatTemperature(current.apparent_temperature), tone: "neutral" },
          { label: "湿度", value: formatNullable(current.relative_humidity_2m, "%"), tone: "neutral" },
          { label: "风速", value: formatNullable(current.wind_speed_10m, " km/h"), tone: "neutral" },
        ],
      },
    ],
  }, [{ id: "weather-7d", label: "查看未来7天", style: "primary", icon: "calendar" }]);
}

function buildSevenDayWeatherSurface(location: WeatherLocation, forecast: OpenMeteoForecastResponse, now: string): SurfaceSpec {
  const daily = forecast.daily ?? {};
  const dates = daily.time ?? [];
  const rows = dates.slice(0, 7).map((date, index) => ({
    date: formatWeatherDate(date),
    weather: weatherCodeLabel(daily.weather_code?.[index]),
    temp: `${formatTemperature(daily.temperature_2m_min?.[index])} / ${formatTemperature(daily.temperature_2m_max?.[index])}`,
    rain: formatPercent(daily.precipitation_probability_max?.[index]),
  }));

  return weatherSurfaceBase(location, "未来7天天气", now, {
    kind: "stack",
    direction: "column",
    gap: "md",
    children: [
      {
        kind: "text",
        variant: "body",
        text: `数据源 Open-Meteo，按 ${forecast.timezone ?? location.timezone ?? "当地"} 时区返回。`,
      },
      {
        kind: "table",
        columns: [
          { key: "date", label: "日期" },
          { key: "weather", label: "天气" },
          { key: "temp", label: "低/高温" },
          { key: "rain", label: "降雨概率" },
        ],
        rows,
      },
    ],
  });
}

function weatherSurfaceBase(location: WeatherLocation, title: string, createdAt: string, layout: ComponentNode, actions?: SurfaceSpec["actions"]): SurfaceSpec {
  return {
    id: `surface_${crypto.randomUUID()}`,
    type: "panel",
    intent: "weather",
    title: `${location.name} ${title}`,
    layout,
    data: {
      source: "open-meteo",
      locationName: location.name,
      locationLabel: location.label,
      latitude: location.latitude,
      longitude: location.longitude,
      timezone: location.timezone,
    },
    ...(actions?.length ? { actions } : {}),
    createdAt,
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    const body = (await response.json().catch(() => null)) as T | { reason?: string; error?: string } | null;
    if (!response.ok) {
      const message = isRecord(body) && typeof body.reason === "string" ? body.reason : `HTTP ${response.status}`;
      throw new Error(message);
    }
    if (!body) throw new Error("天气服务没有返回 JSON。");
    return body as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("天气服务请求超时。");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function weatherCodeLabel(code?: number) {
  const labels: Record<number, string> = {
    0: "晴",
    1: "大部晴朗",
    2: "局部多云",
    3: "阴",
    45: "雾",
    48: "雾凇",
    51: "小毛毛雨",
    53: "毛毛雨",
    55: "较强毛毛雨",
    56: "冻毛毛雨",
    57: "较强冻毛毛雨",
    61: "小雨",
    63: "中雨",
    65: "大雨",
    66: "冻雨",
    67: "强冻雨",
    71: "小雪",
    73: "中雪",
    75: "大雪",
    77: "雪粒",
    80: "小阵雨",
    81: "阵雨",
    82: "强阵雨",
    85: "小阵雪",
    86: "强阵雪",
    95: "雷暴",
    96: "雷暴伴小冰雹",
    99: "雷暴伴强冰雹",
  };
  return code === undefined ? "未知" : labels[code] ?? `天气码 ${code}`;
}

function formatTemperature(value?: number) {
  return value === undefined ? "未知" : `${Math.round(value)}°C`;
}

function formatPercent(value?: number) {
  return value === undefined ? "未知" : `${Math.round(value)}%`;
}

function formatNullable(value?: number, suffix = "") {
  return value === undefined ? "未知" : `${Math.round(value)}${suffix}`;
}

function formatWeatherTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatWeatherDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function ensureSession() {
  const existing = store.getLatestSession();
  if (existing) return existing;

  const now = new Date().toISOString();
  const session = store.createSession("桌面宠物会话", now);
  const welcomeMessage: ChatMessage = {
    id: `msg_${crypto.randomUUID()}`,
    role: "assistant",
    content: welcomeText(),
    createdAt: now,
  };
  store.saveMessage(session.id, welcomeMessage);
  return session;
}

function welcomeText() {
  return "我是你的AI宠物Q，请问有什么需要我做的？";
}

function startRun(state: ClientState, runId: string) {
  const controller = new AbortController();
  state.activeRuns.set(runId, controller);
  return controller;
}

function cancelActiveRuns(state: ClientState) {
  for (const controller of state.activeRuns.values()) {
    controller.abort();
  }
  state.activeRuns.clear();
}

function createInlineMediaSurface(text: string): SurfaceSpec | undefined {
  const intent = inferMediaIntent(text);
  if (!intent) return undefined;

  const now = new Date().toISOString();
  const sourceUrl = extractFirstUrl(text);
  const playback = sourceUrl ? resolvePlayback(intent, sourceUrl) : { status: "needs-source" as const };
  const host = sourceUrl ? hostLabel(sourceUrl) : undefined;
  const layout = mediaPlayer({
    media: intent,
    title: mediaTitle(intent, sourceUrl, text),
    subtitle: sourceUrl ? `来源：${host ?? sourceUrl}` : "选择本地文件，或发送可播放链接",
    provider: host,
    posterTone: intent === "music" ? "aqua" : "rose",
    sourceUrl,
    ...playback,
  });
  const surface = surfaceBase("media", intent, intent === "music" ? "音乐播放器" : "视频播放器", layout, now);
  surface.actions = sourceUrl ? [{ id: "open", label: "打开来源", style: "secondary", icon: "external" }] : undefined;
  return surface;
}

function surfaceBase(type: SurfaceSpec["type"], intent: SurfaceSpec["intent"], title: string, layout: ComponentNode, createdAt: string): SurfaceSpec {
  return {
    id: `surface_${crypto.randomUUID()}`,
    type,
    intent,
    title,
    layout,
    createdAt,
  };
}

function mediaPlayer({
  media,
  title,
  subtitle,
  provider,
  posterTone,
  sourceUrl,
  src,
  embedUrl,
  mimeType,
  status,
}: {
  media: "music" | "video";
  title: string;
  subtitle: string;
  provider?: string;
  posterTone: "aqua" | "rose";
  sourceUrl?: string;
  src?: string;
  embedUrl?: string;
  mimeType?: string;
  status: "ready" | "needs-source" | "external-only";
}): ComponentNode {
  return {
    kind: "media-player",
    media,
    title,
    subtitle,
    provider,
    posterTone,
    sourceUrl,
    src,
    embedUrl,
    mimeType,
    status,
    controls: sourceUrl ? ["play", "pause", "open"] : ["play", "pause"],
  };
}

function inferMediaIntent(text: string): "music" | "video" | undefined {
  const lower = text.toLowerCase();
  const sourceUrl = extractFirstUrl(text);
  if (
    isMoviePlaybackRequest(lower) ||
    containsAny(lower, [
      "看视频",
      "视频",
      "video",
      "youtube",
      "youtu.be",
      "bilibili",
      "b站",
      "movie",
      "film",
      "clip",
    ])
  ) {
    return "video";
  }
  if (containsAny(lower, ["听歌", "音乐", "播放歌曲", "歌曲", "music", "song", "spotify", "audio", "podcast"])) return "music";
  if (sourceUrl && isVideoUrl(sourceUrl)) return "video";
  if (sourceUrl && isAudioUrl(sourceUrl)) return "music";
  return undefined;
}

function isMoviePlaybackRequest(lowerText: string) {
  return (
    /(播放|放|看|打开).{0,6}(电影|影片|剧集|电视剧)/.test(lowerText) ||
    /(电影|影片).{0,4}(播放|播放器)/.test(lowerText) ||
    /(追剧|看剧)/.test(lowerText) ||
    /(watch|play|open).{0,16}(movie|film|episode|show)/.test(lowerText)
  );
}

function extractFirstUrl(text: string) {
  const match = text.match(/https?:\/\/[^\s"'<>，。！？、)）\]]+/i);
  return match?.[0]?.replace(/[.,;:!?]+$/, "");
}

function resolvePlayback(media: "music" | "video", sourceUrl: string): { src?: string; embedUrl?: string; mimeType?: string; status: "ready" | "external-only" } {
  if (media === "music" && isAudioUrl(sourceUrl)) {
    return { src: sourceUrl, mimeType: mimeTypeFromUrl(sourceUrl), status: "ready" };
  }
  if (media === "video" && isVideoUrl(sourceUrl)) {
    return { src: sourceUrl, mimeType: mimeTypeFromUrl(sourceUrl), status: "ready" };
  }

  const embedUrl = media === "video" ? videoEmbedUrl(sourceUrl) : musicEmbedUrl(sourceUrl);
  return embedUrl ? { embedUrl, status: "ready" } : { status: "external-only" };
}

function videoEmbedUrl(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id ? `https://www.youtube.com/embed/${id}` : undefined;
    }
    if (host.endsWith("youtube.com")) {
      const id = url.searchParams.get("v") ?? url.pathname.match(/\/shorts\/([^/]+)/)?.[1] ?? url.pathname.match(/\/embed\/([^/]+)/)?.[1];
      return id ? `https://www.youtube.com/embed/${id}` : undefined;
    }
    if (host.endsWith("bilibili.com")) {
      const bvid = url.pathname.match(/\/video\/(BV[a-zA-Z0-9]+)/)?.[1];
      return bvid ? `https://player.bilibili.com/player.html?bvid=${bvid}&autoplay=0` : undefined;
    }
  } catch {
    return undefined;
  }
}

function musicEmbedUrl(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "open.spotify.com") {
      const [kind, id] = url.pathname.split("/").filter(Boolean);
      if (kind && id && ["album", "artist", "episode", "playlist", "show", "track"].includes(kind)) {
        return `https://open.spotify.com/embed/${kind}/${id}`;
      }
    }
  } catch {
    return undefined;
  }
}

function mediaTitle(media: "music" | "video", sourceUrl?: string, requestText = "") {
  if (!sourceUrl) {
    if (media === "video" && isMoviePlaybackRequest(requestText.toLowerCase())) {
      return "电影播放器";
    }
    return media === "music" ? "音乐播放器" : "视频播放器";
  }
  try {
    const url = new URL(sourceUrl);
    const lastPart = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? "");
    return lastPart || hostLabel(sourceUrl) || (media === "music" ? "音乐播放器" : "视频播放器");
  } catch {
    return media === "music" ? "音乐播放器" : "视频播放器";
  }
}

function hostLabel(sourceUrl: string) {
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function isAudioUrl(sourceUrl: string) {
  return /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)(\?.*)?$/i.test(sourceUrl);
}

function isVideoUrl(sourceUrl: string) {
  return /\.(mp4|m4v|mov|webm|ogv)(\?.*)?$/i.test(sourceUrl);
}

function mimeTypeFromUrl(sourceUrl: string) {
  const extension = sourceUrl.split("?")[0]?.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    wav: "audio/wav",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    opus: "audio/opus",
    flac: "audio/flac",
    mp4: "video/mp4",
    m4v: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    ogv: "video/ogg",
  };
  return extension ? types[extension] : undefined;
}

function containsAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function activityForTask(text: string): PetActivityEvent["activity"] {
  const lower = text.toLowerCase();
  if (
    containsAny(lower, [
      "查询",
      "天气",
      "气温",
      "预报",
      "搜索",
      "查一下",
      "查阅",
      "资料",
      "调研",
      "文档",
      "research",
      "search",
      "find",
      "lookup",
      "docs",
      "browse",
    ])
  ) {
    return "research";
  }
  return "coding";
}

function restActivity(): PetActivityEvent["activity"] {
  return Math.floor(Date.now() / 15_000) % 2 === 0 ? "sleeping" : "exercise";
}

function sendOk(socket: WebSocket, id: string, payload: unknown) {
  sendResponse(socket, { type: "res", id, ok: true, payload });
}

function sendError(socket: WebSocket, id: string, code: string, message: string) {
  sendResponse(socket, { type: "res", id, ok: false, error: { code, message } });
}

function sendResponse(socket: WebSocket, response: RpcResponse) {
  socket.send(JSON.stringify(response));
}

function emit(socket: WebSocket, state: ClientState, event: LocalEventName, payload: unknown) {
  void socket;
  void state;
  broadcast(event, payload);
}

function broadcast(event: LocalEventName, payload: unknown) {
  for (const [client, state] of clients) {
    if (client.readyState !== 1) continue;
    sendEvent(client, state, event, payload);
  }
}

function sendEvent(socket: WebSocket, state: ClientState, event: LocalEventName, payload: unknown) {
  state.seq += 1;
  socket.send(
    JSON.stringify({
      type: "event",
      event,
      payload,
      seq: state.seq,
      at: new Date().toISOString(),
    }),
  );
}

function emitPet(socket: WebSocket, state: ClientState, sessionId: string, emotion: PetEmotionEvent["emotion"], intensity: number, reason: string) {
  void socket;
  void state;
  broadcast("pet.emotion", { sessionId, emotion, intensity, reason } satisfies PetEmotionEvent);
}

function emitActivity(socket: WebSocket, state: ClientState, sessionId: string, activity: PetActivityEvent["activity"], active: boolean, reason: string) {
  void socket;
  void state;
  broadcast("pet.activity", { sessionId, activity, active, reason } satisfies PetActivityEvent);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
