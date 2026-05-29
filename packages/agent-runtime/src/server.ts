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
  type ProviderConfigureParams,
  type ProviderConfigurePayload,
  type RpcRequest,
  type RpcResponse,
  type SessionCreateParams,
  type SessionCreatePayload,
  type SessionResumePayload,
  type SocialExchangeParams,
  type SocialExchangePayload,
  type SurfaceEvent,
  type SurfaceSpec,
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
import { synthesizeWithXiaomi, transcribeWithXiaomi } from "./providers/xiaomi";
import { PetStore, type RuntimeSession } from "./storage";

const PORT = Number(process.env.PET_AGENTD_PORT ?? 4747);
const HOST = process.env.PET_AGENTD_HOST ?? "127.0.0.1";
const clients = new Map<WebSocket, ClientState>();

type ClientState = {
  seq: number;
  activeRuns: Map<string, AbortController>;
};

const store = new PetStore();

const methods: LocalRpcMethod[] = [
  "hello",
  "session.create",
  "session.resume",
  "chat.send",
  "voice.transcribe",
  "voice.speak",
  "voice.configure",
  "agent.cancel",
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
        content: "我在。点我、打字，或者把一个任务丢过来，我会用界面把它接住。",
        createdAt: now,
      };
      store.saveMessage(session.id, welcomeMessage);
      const payload: SessionCreatePayload = { sessionId: session.id, title: session.title };
      sendOk(socket, request.id, payload);
      emit(socket, state, "chat.message", { sessionId: session.id, message: welcomeMessage } satisfies ChatMessageEvent);
      emitPet(socket, state, session.id, "idle", 0.45, "session-created");
      emitActivity(socket, state, session.id, "sleeping", false, "session-created");
      return;
    }

    case "session.resume": {
      const session = ensureSession();
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
      const userMessage: ChatMessage = {
        id: `msg_${crypto.randomUUID()}`,
        role: "user",
        content: params.text,
        createdAt: new Date().toISOString(),
        runId,
      };
      store.saveMessage(session.id, userMessage);
      emit(socket, state, "chat.message", { sessionId: session.id, message: userMessage } satisfies ChatMessageEvent);
      sendOk(socket, request.id, { runId, status: "accepted" } satisfies ChatSendPayload);
      void runAgent(socket, state, session, runId, params.text, abortController);
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

async function runAgent(socket: WebSocket, state: ClientState, session: RuntimeSession, runId: string, text: string, abortController: AbortController) {
  emit(socket, state, "agent.lifecycle", { sessionId: session.id, runId, phase: "start" } satisfies AgentLifecycleEvent);
  emitActivity(socket, state, session.id, activityForTask(text), true, "task-start");
  emitPet(socket, state, session.id, "thinking", 0.72, "agent-routing");

  const history = store.listMessages(session.id).slice(0, -1);
  const inlineSurface = createInlineMediaSurface(text);
  if (inlineSurface) {
    emit(socket, state, "agent.delta", { sessionId: session.id, runId, text: "", surface: inlineSurface } satisfies AgentDeltaEvent);
  }

  let assistantText = "";
  try {
    const stream = await streamWithAiSdk(text, history, abortController.signal);
    if (!stream) {
      assistantText = "还没有可用的模型 API 配置。请在配置页的“模型 API”里保存 DeepSeek API Key 和模型名，例如 deepseek-chat，然后再发送消息。";
      emit(socket, state, "agent.delta", { sessionId: session.id, runId, text: assistantText, surface: inlineSurface } satisfies AgentDeltaEvent);
    } else {
      for await (const chunk of stream.textStream) {
        if (!state.activeRuns.has(runId)) return;
        assistantText += chunk;
        emit(socket, state, "agent.delta", { sessionId: session.id, runId, text: chunk } satisfies AgentDeltaEvent);
      }
    }
  } catch (error) {
    if (abortController.signal.aborted) return;
    const message = error instanceof Error ? error.message : "未知错误";
    console.warn(`[pet-agentd] AI SDK generation failed: ${message}`);
    assistantText = `模型调用失败：${message}`;
    emit(socket, state, "agent.delta", { sessionId: session.id, runId, text: assistantText } satisfies AgentDeltaEvent);
    emit(socket, state, "agent.lifecycle", { sessionId: session.id, runId, phase: "error", message } satisfies AgentLifecycleEvent);
  }

  if (!state.activeRuns.has(runId)) return;

  const assistantMessage: ChatMessage = {
    id: `msg_${crypto.randomUUID()}`,
    role: "assistant",
    content: assistantText.trim() || (inlineSurface ? "播放器已放在这条回复里。" : "模型没有返回文本。"),
    createdAt: new Date().toISOString(),
    runId,
    ...(inlineSurface ? { surface: inlineSurface } : {}),
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

function ensureSession() {
  const existing = store.getLatestSession();
  if (existing) return existing;

  const now = new Date().toISOString();
  const session = store.createSession("桌面宠物会话", now);
  const welcomeMessage: ChatMessage = {
    id: `msg_${crypto.randomUUID()}`,
    role: "assistant",
    content: "我在。点我、打字，或者把一个任务丢过来，我会用界面把它接住。",
    createdAt: now,
  };
  store.saveMessage(session.id, welcomeMessage);
  return session;
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
    title: mediaTitle(intent, sourceUrl),
    subtitle: sourceUrl ? `来源：${host ?? sourceUrl}` : "等待可播放链接",
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
  if (containsAny(lower, ["看视频", "视频", "video", "youtube", "youtu.be", "bilibili", "b站", "movie", "clip"])) return "video";
  if (containsAny(lower, ["听歌", "音乐", "播放歌曲", "歌曲", "music", "song", "spotify", "audio", "podcast"])) return "music";
  if (sourceUrl && isVideoUrl(sourceUrl)) return "video";
  if (sourceUrl && isAudioUrl(sourceUrl)) return "music";
  return undefined;
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

function mediaTitle(media: "music" | "video", sourceUrl?: string) {
  if (!sourceUrl) return media === "music" ? "音乐播放器" : "视频播放器";
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

function activityForTask(text: string): PetActivityEvent["activity"] {
  const lower = text.toLowerCase();
  if (
    containsAny(lower, [
      "查询",
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
