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
  type FriendAddParams,
  type FriendAddPayload,
  type FriendListPayload,
  type HelloPayload,
  type LocalEventName,
  type LocalRpcMethod,
  type Memory,
  type MemoryProposeParams,
  type MemoryProposePayload,
  type MemoryQueryParams,
  type MemoryQueryPayload,
  type PermissionListPayload,
  type PermissionRequest,
  type PermissionRequestEvent,
  type PermissionResolveParams,
  type PermissionResolvePayload,
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
  type SkillManageParams,
  type SkillManagePayload,
  type SkillSearchParams,
  type SkillSearchPayload,
  type SocialExchangeParams,
  type SocialExchangePayload,
  type SurfaceEvent,
  type SurfaceSpec,
  type ToolAuditListPayload,
  type ToolCatalogPayload,
  type ToolInvokeParams,
  type ToolInvokePayload,
  type ToolRunEvent,
  type ToolRunRecord,
  type TokenUsageListPayload,
  type VoiceSpeakParams,
  type VoiceSpeakPayload,
  type VoiceConfigureParams,
  type VoiceTranscribeParams,
  type VoiceTranscribePayload,
  isRpcRequest,
} from "@pet/protocol";
import { listProviders } from "./catalog";
import { saveLocalAiConfig, saveLocalXiaomiVoiceConfig } from "./apiConfig";
import { synthesizeWithAiSdk, transcribeWithAiSdk } from "./providers/aiSdk";
import { cutoutPetImageWithConfiguredAi, PetImageCutoutError } from "./providers/openaiImageCutout";
import { synthesizeWithXiaomi, transcribeWithXiaomi } from "./providers/xiaomi";
import { PetStore, type RuntimeSession } from "./storage";
import { listTokenUsage } from "./usage";
import { AgentKernel, type AgentContinuation, type AgentToolResult } from "./kernel/AgentKernel";
import { ContextBuilder } from "./kernel/ContextBuilder";
import { MemoryService } from "./memory/MemoryService";
import { SkillService } from "./skills/SkillService";
import { ToolRegistry } from "./tools/ToolRegistry";
import { logger } from "./logger";
import { loadConfiguredMcpTools } from "./mcp/McpBridge";
import {
  createChartResponse,
  createInlineMediaResponse,
  createInlineMediaSurface,
  createWeatherResponse,
  type DirectAgentResponse,
} from "./directResponses";

const PORT = Number(process.env.PET_AGENTD_PORT ?? 4747);
const HOST = process.env.PET_AGENTD_HOST ?? "127.0.0.1";
const clients = new Map<WebSocket, ClientState>();
const activeSessionRuns = new Map<string, { runId: string; controller: AbortController }>();
const pendingAgentContinuations = new Map<string, PendingAgentContinuation>();
const permissionToContinuation = new Map<string, string>();

type ClientState = {
  seq: number;
  activeRuns: Map<string, AbortController>;
};

type AgentRunOptions = {
  userMessageId?: string;
  attachments?: ChatMessage["attachments"];
  source?: ChatSendParams["source"];
  surfaceAction?: ChatSendParams["surfaceAction"];
};

type PendingAgentContinuation = {
  continuation: AgentContinuation;
  resolvedResults: Map<string, AgentToolResult>;
};

const store = new PetStore();
const memoryService = new MemoryService(store);
const skillService = new SkillService(store);
skillService.refresh();
const toolRegistry = new ToolRegistry(store, memoryService, skillService);
void loadConfiguredMcpTools(toolRegistry);
const contextBuilder = new ContextBuilder(store, memoryService, skillService, () => toolRegistry.catalog());

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
  "memory.query",
  "memory.propose",
  "memory.commit",
  "memory.reject",
  "skill.list",
  "skill.search",
  "skill.view",
  "skill.run",
  "skill.manage",
  "tool.catalog",
  "tool.invoke",
  "tool.audit.list",
  "permission.list",
  "permission.resolve",
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
  "permission.request",
  "tool.run",
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
  logger.info("agentd.listening", { host: HOST, port: PORT });
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
    logger.error("rpc.failed", {
      id: frame.id,
      method: frame.method,
      error: serializeServerError(error),
    });
    sendResponse(socket, {
      type: "res",
      id: frame.id,
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: `Internal runtime error. Reference: ${frame.id}`,
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
      const abortController = startRun(state, session.id, runId);
      const shouldDisplayUserMessage = params.source !== "ui";
      const userMessage: ChatMessage | undefined = shouldDisplayUserMessage
        ? {
            id: `msg_${crypto.randomUUID()}`,
            role: "user",
            content: params.text,
            attachments: normalizeChatAttachments(params.attachments),
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
        attachments: normalizeChatAttachments(params.attachments),
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
      const sharedSkills = skillService
        .list()
        .filter((skill) => skill.enabled && !skill.quarantined)
        .slice(0, 4)
        .map((skill) => skill.name);
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

    case "memory.query": {
      const params = (request.params ?? {}) as MemoryQueryParams;
      sendOk(socket, request.id, { memories: memoryService.query(params.query, params.kinds, params.limit ?? 8) } satisfies MemoryQueryPayload);
      return;
    }

    case "memory.propose": {
      const params = request.params as MemoryProposeParams | undefined;
      if (!params?.content?.trim()) {
        sendError(socket, request.id, "BAD_REQUEST", "memory.propose requires content.");
        return;
      }
      const proposal = memoryService.propose(params);
      sendOk(socket, request.id, { proposal } satisfies MemoryProposePayload);
      return;
    }

    case "memory.commit": {
      const params = request.params as { proposal?: Memory } | undefined;
      if (params?.proposal) {
        memoryService.commit(params.proposal, params.proposal.sourceType ?? "manual", params.proposal.sourceId ?? request.id);
      }
      sendOk(socket, request.id, { memories: store.listMemories() });
      return;
    }

    case "memory.reject": {
      sendOk(socket, request.id, { rejected: true });
      return;
    }

    case "skill.list": {
      sendOk(socket, request.id, { skills: skillService.refresh() });
      return;
    }

    case "skill.search": {
      const params = (request.params ?? {}) as SkillSearchParams;
      sendOk(socket, request.id, { skills: skillService.search(params.query, params.limit ?? 5) } satisfies SkillSearchPayload);
      return;
    }

    case "skill.view": {
      const params = request.params as { name?: string } | undefined;
      if (!params?.name) {
        sendError(socket, request.id, "BAD_REQUEST", "skill.view requires name.");
        return;
      }
      const view = skillService.view(params.name);
      if (!view) {
        sendError(socket, request.id, "NOT_FOUND", "Skill does not exist or has no SKILL.md.");
        return;
      }
      sendOk(socket, request.id, view);
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
      const abortController = startRun(state, session.id, runId);
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

    case "skill.manage": {
      const params = request.params as SkillManageParams | undefined;
      if (!params?.name || !params.action) {
        sendError(socket, request.id, "BAD_REQUEST", "skill.manage requires name and action.");
        return;
      }
      const currentSkill = store.getSkill(params.name);
      if (!currentSkill) {
        sendError(socket, request.id, "NOT_FOUND", "Skill does not exist.");
        return;
      }
      const payload = await toolRegistry.invoke({
        name: "skill_manage",
        input: { name: params.name, action: params.action },
        source: "ui",
      });
      emit(socket, state, "tool.run", { run: payload.run } satisfies ToolRunEvent);
      if (payload.run.permissionId) {
        const permission = store.getPermission(payload.run.permissionId);
        if (permission) emit(socket, state, "permission.request", { request: permission } satisfies PermissionRequestEvent);
      }
      if (payload.run.status === "success" && payload.result && typeof payload.result === "object" && "skill" in payload.result) {
        sendOk(socket, request.id, payload.result as SkillManagePayload);
        return;
      }
      sendOk(socket, request.id, { skill: currentSkill } satisfies SkillManagePayload);
      return;
    }

    case "tool.catalog": {
      sendOk(socket, request.id, { tools: toolRegistry.catalog() } satisfies ToolCatalogPayload);
      return;
    }

    case "tool.invoke": {
      const params = request.params as ToolInvokeParams | undefined;
      if (!params?.name) {
        sendError(socket, request.id, "BAD_REQUEST", "tool.invoke requires name.");
        return;
      }
      const payload = await toolRegistry.invoke(params);
      emit(socket, state, "tool.run", { run: payload.run } satisfies ToolRunEvent);
      if (payload.run.permissionId) {
        const permission = store.getPermission(payload.run.permissionId);
        if (permission) emit(socket, state, "permission.request", { request: permission } satisfies PermissionRequestEvent);
      }
      sendOk(socket, request.id, payload satisfies ToolInvokePayload);
      return;
    }

    case "tool.audit.list": {
      const params = request.params as { limit?: number } | undefined;
      sendOk(socket, request.id, { runs: store.listToolRuns(params?.limit ?? 60) } satisfies ToolAuditListPayload);
      return;
    }

    case "permission.list": {
      const params = request.params as { status?: "pending" | "approved" | "denied"; limit?: number } | undefined;
      sendOk(socket, request.id, { requests: store.listPermissions(params?.status, params?.limit ?? 60) } satisfies PermissionListPayload);
      return;
    }

    case "permission.resolve": {
      const params = request.params as PermissionResolveParams | undefined;
      if (!params?.permissionId) {
        sendError(socket, request.id, "BAD_REQUEST", "permission.resolve requires permissionId.");
        return;
      }
      const payload = await toolRegistry.resolvePermission(params.permissionId, params.approved);
      const responsePayload: PermissionResolvePayload = {
        request: payload.request,
        ...("run" in payload ? { run: payload.run, result: payload.result } : {}),
      };
      if (responsePayload.run) emit(socket, state, "tool.run", { run: responsePayload.run } satisfies ToolRunEvent);
      const resumed = responsePayload.run ? resumePendingAgentIfReady(socket, state, responsePayload.request, responsePayload.run, responsePayload.result) : false;
      if (!resumed && responsePayload.request.sessionId) {
        const targetSession = store.getSession(responsePayload.request.sessionId);
        if (targetSession) {
          const assistantMessage: ChatMessage = {
            id: `msg_${crypto.randomUUID()}`,
            role: "assistant",
            content: permissionResolutionText(responsePayload),
            createdAt: new Date().toISOString(),
            runId: responsePayload.request.runId,
          };
          store.saveMessage(targetSession.id, assistantMessage);
          emit(socket, state, "chat.message", { sessionId: targetSession.id, message: assistantMessage } satisfies ChatMessageEvent);
        }
      }
      sendOk(socket, request.id, responsePayload);
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
  const actionSurface = options.surfaceAction ? store.getSurface(session.id, options.surfaceAction.surfaceId) : null;
  const agentText = options.surfaceAction ? buildSurfaceActionAgentText(text, options.surfaceAction, actionSurface) : text;

  try {
    const inlineSurface = createInlineMediaSurface(agentText);
    const directResponse = inlineSurface ? createInlineMediaResponse(inlineSurface) : createChartResponse(agentText) ?? (await createWeatherResponse(agentText, options.surfaceAction, actionSurface));
    if (directResponse) {
      await finishDirectAgent(socket, state, session, runId, agentText, directResponse);
      return;
    }

    const kernel = new AgentKernel({
      store,
      memory: memoryService,
      tools: toolRegistry,
      contextBuilder,
      emit: (event, payload) => emit(socket, state, event, payload),
    });
    const result = await kernel.run(session, runId, agentText, {
      userMessageId: options.userMessageId,
      abortSignal: abortController.signal,
      isActive: () => state.activeRuns.has(runId),
    });
    if (!result || !state.activeRuns.has(runId)) return;
    if (result.continuation) savePendingAgentContinuation(result.continuation);
    emit(socket, state, "chat.message", { sessionId: session.id, message: result.message } satisfies ChatMessageEvent);
  } catch (error) {
    if (abortController.signal.aborted) return;
    const message = error instanceof Error ? error.message : "未知错误";
    const clientMessage = redactSensitiveText(message);
    logger.warn("agent.generation_failed", { error: serializeServerError(error), sessionId: session.id, runId });
    emit(socket, state, "agent.lifecycle", { sessionId: session.id, runId, phase: "error", message: clientMessage } satisfies AgentLifecycleEvent);
    const assistantText = `模型调用失败：${clientMessage}`;
    emit(socket, state, "agent.delta", {
      sessionId: session.id,
      runId,
      text: assistantText,
    } satisfies AgentDeltaEvent);
    const assistantMessage: ChatMessage = {
      id: `msg_${crypto.randomUUID()}`,
      role: "assistant",
      content: assistantText,
      createdAt: new Date().toISOString(),
      runId,
    };
    store.saveMessage(session.id, assistantMessage);
    emit(socket, state, "chat.message", { sessionId: session.id, message: assistantMessage } satisfies ChatMessageEvent);
    emitPet(socket, state, session.id, "needs_attention", 0.68, "agent-error");
  } finally {
    finishRun(state, session.id, runId);
    if (state.activeRuns.size === 0) {
      await sleep(300);
      emitActivity(socket, state, session.id, restActivity(), false, "turn-complete");
    }
  }
}

function savePendingAgentContinuation(continuation: AgentContinuation) {
  const pending: PendingAgentContinuation = {
    continuation,
    resolvedResults: new Map(),
  };
  pendingAgentContinuations.set(continuation.runId, pending);
  for (const item of continuation.pendingTools) {
    permissionToContinuation.set(item.permissionId, continuation.runId);
  }
}

function resumePendingAgentIfReady(
  socket: WebSocket,
  state: ClientState,
  request: PermissionRequest,
  run: ToolRunRecord,
  result: unknown,
) {
  const continuationRunId = permissionToContinuation.get(request.id);
  if (!continuationRunId) return false;
  const pending = pendingAgentContinuations.get(continuationRunId);
  if (!pending) {
    permissionToContinuation.delete(request.id);
    return false;
  }

  const pendingTool = pending.continuation.pendingTools.find((item) => item.permissionId === request.id);
  if (!pendingTool) return true;
  pending.resolvedResults.set(request.id, {
    call: pendingTool.call,
    value: {
      tool: pendingTool.call.toolName,
      status: run.status,
      result,
    },
    permissionId: request.id,
  });
  permissionToContinuation.delete(request.id);

  const allResolved = pending.continuation.pendingTools.every((item) => pending.resolvedResults.has(item.permissionId));
  if (!allResolved) return true;

  pendingAgentContinuations.delete(continuationRunId);
  const session = store.getSession(pending.continuation.sessionId);
  if (!session) return true;

  const abortController = startRun(state, session.id, pending.continuation.runId);
  void runAgentContinuation(socket, state, session, pending.continuation, [...pending.resolvedResults.values()], abortController);
  return true;
}

async function runAgentContinuation(
  socket: WebSocket,
  state: ClientState,
  session: RuntimeSession,
  continuation: AgentContinuation,
  resolvedResults: AgentToolResult[],
  abortController: AbortController,
) {
  try {
    const kernel = new AgentKernel({
      store,
      memory: memoryService,
      tools: toolRegistry,
      contextBuilder,
      emit: (event, payload) => emit(socket, state, event, payload),
    });
    const result = await kernel.resume(session, continuation, resolvedResults, {
      abortSignal: abortController.signal,
      isActive: () => state.activeRuns.has(continuation.runId),
    });
    if (!result || !state.activeRuns.has(continuation.runId)) return;
    if (result.continuation) savePendingAgentContinuation(result.continuation);
    emit(socket, state, "chat.message", { sessionId: session.id, message: result.message } satisfies ChatMessageEvent);
  } catch (error) {
    if (abortController.signal.aborted) return;
    const message = redactSensitiveText(error instanceof Error ? error.message : "未知错误");
    logger.warn("agent.continuation_failed", { error: serializeServerError(error), sessionId: session.id, runId: continuation.runId });
    emit(socket, state, "agent.lifecycle", { sessionId: session.id, runId: continuation.runId, phase: "error", message } satisfies AgentLifecycleEvent);
    const assistantText = `权限确认后的模型续跑失败：${message}`;
    emit(socket, state, "agent.delta", { sessionId: session.id, runId: continuation.runId, text: assistantText } satisfies AgentDeltaEvent);
    const assistantMessage: ChatMessage = {
      id: `msg_${crypto.randomUUID()}`,
      role: "assistant",
      content: assistantText,
      createdAt: new Date().toISOString(),
      runId: continuation.runId,
    };
    store.saveMessage(session.id, assistantMessage);
    emit(socket, state, "chat.message", { sessionId: session.id, message: assistantMessage } satisfies ChatMessageEvent);
    emitPet(socket, state, session.id, "needs_attention", 0.68, "agent-continuation-error");
  } finally {
    finishRun(state, session.id, continuation.runId);
    if (state.activeRuns.size === 0) {
      await sleep(300);
      emitActivity(socket, state, session.id, restActivity(), false, "turn-complete");
    }
  }
}

async function finishDirectAgent(
  socket: WebSocket,
  state: ClientState,
  session: RuntimeSession,
  runId: string,
  text: string,
  response: DirectAgentResponse,
) {
  emit(socket, state, "agent.lifecycle", { sessionId: session.id, runId, phase: "start" } satisfies AgentLifecycleEvent);
  emitActivity(socket, state, session.id, activityForTask(text), true, "task-start");
  emitPet(socket, state, session.id, "thinking", 0.72, "agent-direct-surface");

  if (!state.activeRuns.has(runId)) return;
  if (response.surface) {
    store.saveSurface(session.id, response.surface);
    emit(socket, state, "ui.surface.create", { sessionId: session.id, surface: response.surface } satisfies SurfaceEvent);
  }
  emit(socket, state, "agent.delta", {
    sessionId: session.id,
    runId,
    text: response.text,
    ...(response.surface ? { surface: response.surface } : {}),
  } satisfies AgentDeltaEvent);
  const assistantMessage: ChatMessage = {
    id: `msg_${crypto.randomUUID()}`,
    role: "assistant",
    content: response.text.trim() || (response.surface ? "可交互卡片已生成。" : "已处理。"),
    createdAt: new Date().toISOString(),
    runId,
    ...(response.surface ? { surface: response.surface } : {}),
  };
  store.saveMessage(session.id, assistantMessage);
  emit(socket, state, "chat.message", { sessionId: session.id, message: assistantMessage } satisfies ChatMessageEvent);
  emitPet(socket, state, session.id, "speaking", 0.55, "answer-ready");
  emit(socket, state, "agent.lifecycle", { sessionId: session.id, runId, phase: "end" } satisfies AgentLifecycleEvent);
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

function startRun(state: ClientState, sessionId: string, runId: string) {
  const existing = activeSessionRuns.get(sessionId);
  if (existing && existing.runId !== runId) {
    existing.controller.abort();
  }
  const controller = new AbortController();
  state.activeRuns.set(runId, controller);
  activeSessionRuns.set(sessionId, { runId, controller });
  return controller;
}

function finishRun(state: ClientState, sessionId: string, runId: string) {
  state.activeRuns.delete(runId);
  if (activeSessionRuns.get(sessionId)?.runId === runId) {
    activeSessionRuns.delete(sessionId);
  }
}

function cancelActiveRuns(state: ClientState) {
  for (const controller of state.activeRuns.values()) {
    controller.abort();
  }
  for (const [sessionId, run] of activeSessionRuns) {
    if (state.activeRuns.has(run.runId)) activeSessionRuns.delete(sessionId);
  }
  state.activeRuns.clear();
}

function containsAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle));
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

function permissionResolutionText(payload: PermissionResolvePayload) {
  if (payload.request.status === "denied") {
    return `已取消工具调用：${payload.request.toolName}。`;
  }
  if (!payload.run) {
    return `权限已确认：${payload.request.toolName}。`;
  }
  const statusText = payload.run.status === "success" ? "已执行" : payload.run.status === "failed" ? "执行失败" : payload.run.status === "denied" ? "已取消" : "等待确认";
  return `${statusText}工具：${payload.run.toolName}。${payload.run.summary ?? ""}`.trim();
}

function normalizeChatAttachments(attachments: ChatMessage["attachments"] | undefined): ChatMessage["attachments"] {
  return (attachments ?? [])
    .filter((attachment) => attachment.kind === "image" && /^data:image\/(png|jpeg|webp);base64,/i.test(attachment.dataUrl))
    .slice(0, 4)
    .map((attachment) => ({
      id: attachment.id || `att_${crypto.randomUUID()}`,
      kind: "image" as const,
      dataUrl: attachment.dataUrl.slice(0, 12_000_000),
      mimeType: attachment.mimeType,
      name: attachment.name?.slice(0, 120),
    }));
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

function serializeServerError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactSensitiveText(error.message),
      stack: error.stack ? redactSensitiveText(error.stack) : undefined,
    };
  }
  return redactSensitiveText(String(error));
}

function redactSensitiveText(value: string) {
  return value
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-****")
    .replace(/(api[-_ ]?key\s*[:=]\s*)[^\s,;]+/gi, "$1****");
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
