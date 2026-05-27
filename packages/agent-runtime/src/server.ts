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
  type VoiceTranscribeParams,
  type VoiceTranscribePayload,
  isRpcRequest,
} from "@pet/protocol";
import { listProviders, skills } from "./catalog";
import { generateWithXiaomi, synthesizeWithXiaomi, transcribeWithXiaomi } from "./providers/xiaomi";
import { PetStore, type RuntimeSession } from "./storage";

const PORT = Number(process.env.PET_AGENTD_PORT ?? 4747);
const HOST = process.env.PET_AGENTD_HOST ?? "127.0.0.1";

type ClientState = {
  seq: number;
  activeRuns: Set<string>;
};

const store = new PetStore();

const methods: LocalRpcMethod[] = [
  "hello",
  "session.create",
  "session.resume",
  "chat.send",
  "voice.transcribe",
  "voice.speak",
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
  const state: ClientState = { seq: 0, activeRuns: new Set() };

  socket.on("message", (raw) => {
    void handleRawFrame(socket, state, raw.toString());
  });

  socket.on("close", () => {
    state.activeRuns.clear();
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
      const session = store.createSession(params.title?.trim() || "Desktop Pet Session", now);
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
      state.activeRuns.add(runId);
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
      void runAgent(socket, state, session, runId, params.text);
      return;
    }

    case "agent.cancel": {
      state.activeRuns.clear();
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

      const transcription = await transcribeWithXiaomi(params.audioData);
      if (!transcription) {
        sendError(socket, request.id, "PROVIDER_UNAVAILABLE", "Voice input requires a regular Xiaomi MiMo API configuration.");
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

      const speech = await synthesizeWithXiaomi(params.text);
      if (!speech) {
        sendError(socket, request.id, "PROVIDER_UNAVAILABLE", "Voice output requires a regular Xiaomi MiMo API configuration.");
        return;
      }
      sendOk(socket, request.id, {
        accepted: true,
        mode: "xiaomi-tts",
        audioData: speech.audioData,
        mimeType: speech.mimeType,
        model: speech.model,
        voice: speech.voice,
      } satisfies VoiceSpeakPayload);
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
      const account = store.getCurrentAccount() ?? store.signInLocal("Local User");
      const sharedSkills = skills.filter((skill) => skill.enabled).slice(0, 4).map((skill) => skill.name);
      const shareableMemories = store
        .listMemories()
        .filter((memory) => memory.scope === "social" || memory.scope === "shared")
        .slice(0, 6);
      const summary = [
        `${account.displayName} 的宠物和 ${friend.displayName} 完成了一次本地模拟交换。`,
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
      state.activeRuns.add(runId);
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
      void runAgent(socket, state, session, runId, prompt);
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

async function runAgent(socket: WebSocket, state: ClientState, session: RuntimeSession, runId: string, text: string) {
  emit(socket, state, "agent.lifecycle", { sessionId: session.id, runId, phase: "start" } satisfies AgentLifecycleEvent);
  emitActivity(socket, state, session.id, activityForTask(text), true, "task-start");
  emitPet(socket, state, session.id, "thinking", 0.72, "agent-routing");

  const plan = planResponse(text);
  for (const chunk of plan.chunks) {
    if (!state.activeRuns.has(runId)) return;
    await sleep(180);
    emit(socket, state, "agent.delta", { sessionId: session.id, runId, text: chunk } satisfies AgentDeltaEvent);
  }

  const modelText = await generateModelText(session, text).catch((error) => {
    console.warn(`[pet-agentd] Xiaomi model fallback: ${error instanceof Error ? error.message : "unknown error"}`);
    return null;
  });
  if (!state.activeRuns.has(runId)) return;

  const assistantMessage: ChatMessage = {
    id: `msg_${crypto.randomUUID()}`,
    role: "assistant",
    content: composeFinalText(modelText, plan.finalText, Boolean(plan.surface)),
    createdAt: new Date().toISOString(),
    runId,
  };
  store.saveMessage(session.id, assistantMessage);
  emit(socket, state, "chat.message", { sessionId: session.id, message: assistantMessage } satisfies ChatMessageEvent);

  if (plan.surface) {
    await sleep(120);
    store.saveSurface(session.id, plan.surface);
    emit(socket, state, "ui.surface.create", { sessionId: session.id, surface: plan.surface } satisfies SurfaceEvent);
  }

  if (plan.memoryProposal) {
    await sleep(80);
    emit(socket, state, "memory.proposal", { sessionId: session.id, proposal: plan.memoryProposal } satisfies MemoryProposalEvent);
    emitPet(socket, state, session.id, "needs_attention", 0.62, "memory-proposal");
  } else {
    emitPet(socket, state, session.id, "speaking", 0.55, "answer-ready");
  }

  state.activeRuns.delete(runId);
  emit(socket, state, "agent.lifecycle", { sessionId: session.id, runId, phase: "end" } satisfies AgentLifecycleEvent);
  await sleep(600);
  if (state.activeRuns.size === 0) {
    emitPet(socket, state, session.id, "idle", 0.4, "turn-complete");
    emitActivity(socket, state, session.id, restActivity(), false, "turn-complete");
  }
}

async function generateModelText(session: RuntimeSession, text: string) {
  const history = store.listMessages(session.id).slice(0, -1);
  const result = await generateWithXiaomi(text, history);
  return result?.text ?? null;
}

function composeFinalText(modelText: string | null, fallbackText: string, hasSurface: boolean) {
  const base = modelText?.trim() || fallbackText;
  if (!hasSurface) return base;
  if (base.includes("面板") || base.includes("窗口") || base.includes("surface")) return base;
  return `${base}\n\n我也准备了对应的交互面板，你可以直接在右侧继续操作。`;
}

function ensureSession() {
  const existing = store.getLatestSession();
  if (existing) return existing;

  const now = new Date().toISOString();
  const session = store.createSession("Desktop Pet Session", now);
  const welcomeMessage: ChatMessage = {
    id: `msg_${crypto.randomUUID()}`,
    role: "assistant",
    content: "我在。点我、打字，或者把一个任务丢过来，我会用界面把它接住。",
    createdAt: now,
  };
  store.saveMessage(session.id, welcomeMessage);
  return session;
}

function planResponse(text: string): {
  chunks: string[];
  finalText: string;
  surface?: SurfaceSpec;
  memoryProposal?: Memory;
} {
  const lower = text.toLowerCase();
  const now = new Date().toISOString();

  if (containsAny(lower, ["听歌", "音乐", "music", "song", "spotify", "music-companion"])) {
    const surface = surfaceBase("media", "music", "Music queue", mediaPlayer("music", "Late-night focus mix", "Lo-fi piano, soft percussion, 42 minutes", "Pet Music", "aqua"), now);
    surface.actions = [
      { id: "play", label: "Play", style: "primary", icon: "play" },
      { id: "queue", label: "Add Queue", style: "secondary", icon: "plus" },
      { id: "save", label: "Save", style: "secondary", icon: "check" },
    ];
    return {
      chunks: ["我先给你排一个不打扰思路的歌单。", "如果接上真实音乐 provider，这个窗口会直接变成播放器。"],
      finalText: "我准备了一个音乐播放面板。当前走本地技能外壳，接入 Spotify / Apple Music / 本地媒体后会直接播放和管理队列。",
      surface,
    };
  }

  if (containsAny(lower, ["看视频", "视频", "video", "youtube", "bilibili", "video-companion"])) {
    const surface = surfaceBase("media", "video", "Video room", mediaPlayer("video", "Product architecture walkthrough", "Generated preview with transcript-ready actions", "Pet Video", "rose"), now);
    surface.actions = [
      { id: "play", label: "Play", style: "primary", icon: "play" },
      { id: "open", label: "Open", style: "secondary", icon: "external" },
      { id: "save", label: "Save", style: "secondary", icon: "check" },
    ];
    return {
      chunks: ["我开一个视频面板。", "后面这里会承载 YouTube、Bilibili 或本地文件的播放和摘要。"],
      finalText: "视频面板已准备好。这里可以承载 YouTube、Bilibili 或本地文件播放，并挂接字幕、摘要和笔记技能。",
      surface,
    };
  }

  if (containsAny(lower, ["日程", "安排", "calendar", "schedule", "今天", "daily-brief"])) {
    const layout: ComponentNode = {
      kind: "stack",
      gap: "md",
      children: [
        {
          kind: "metric-row",
          metrics: [
            { label: "Focus blocks", value: "2", tone: "good" },
            { label: "Meetings", value: "3", tone: "neutral" },
            { label: "Open tasks", value: "5", tone: "warn" },
          ],
        },
        {
          kind: "timeline",
          items: [
            { id: "t1", time: "09:30", title: "Team sync", tone: "meeting" },
            { id: "t2", time: "11:00", title: "Deep work: memory schema", tone: "focus" },
            { id: "t3", time: "14:00", title: "Product review", tone: "meeting" },
            { id: "t4", time: "16:00", title: "Skill runtime spike", tone: "focus" },
          ],
        },
      ],
    };
    const surface = surfaceBase("panel", "calendar", "Today", layout, now);
    surface.actions = [
      { id: "brief", label: "Brief", style: "primary", icon: "calendar" },
      { id: "make-task", label: "Task", style: "secondary", icon: "plus" },
    ];
    return {
      chunks: ["我把今天切成可行动的时间线。", "现在是示例日程，接 Calendar 权限后会读取真实数据。"],
      finalText: "我生成了今天的日程面板。真实日历接入后，会只分享摘要给好友宠物，不泄露原始详情。",
      surface,
    };
  }

  if (containsAny(lower, ["查询", "搜索", "查一下", "research", "search", "find", "search-cards"])) {
    const layout: ComponentNode = {
      kind: "stack",
      gap: "md",
      children: [
        {
          kind: "list",
          items: [
            {
              id: "r1",
              title: "Local-first desktop agents",
              description: "Pattern: local daemon, typed UI surfaces, optional cloud sync.",
              meta: "design note",
              actionId: "open-r1",
            },
            {
              id: "r2",
              title: "Generated UI safety",
              description: "Prefer schema-rendered components before allowing sandboxed HTML bundles.",
              meta: "security note",
              actionId: "open-r2",
            },
            {
              id: "r3",
              title: "Skill provenance",
              description: "Track source, signature, permissions, version, and install batch.",
              meta: "runtime note",
              actionId: "open-r3",
            },
          ],
        },
        {
          kind: "table",
          columns: [
            { key: "area", label: "Area" },
            { key: "risk", label: "Risk" },
            { key: "next", label: "Next step" },
          ],
          rows: [
            { area: "UI DSL", risk: "medium", next: "schema validator" },
            { area: "Skills", risk: "high", next: "sandbox manifest" },
            { area: "Memory", risk: "high", next: "proposal flow" },
          ],
        },
      ],
    };
    const surface = surfaceBase("panel", "search", "Research board", layout, now);
    surface.actions = [
      { id: "refine", label: "Refine", style: "primary", icon: "search" },
      { id: "save-memory", label: "Remember", style: "secondary", icon: "check" },
    ];
    return {
      chunks: ["我先把查询结果整理成可筛选卡片。", "搜索工具接上后，这里会带来源、引用和后续动作。"],
      finalText: "我生成了一个查询面板。它支持卡片、表格、保存和继续追问，适合承接 web/search skill 的结果。",
      surface,
    };
  }

  if (containsAny(lower, ["记住", "remember", "偏好", "喜欢", "不要"])) {
    const proposal: Memory = {
      id: `mem_${crypto.randomUUID()}`,
      kind: "user_profile",
      scope: "private",
      content: text.replace(/^记住[:：]?\s*/, "").trim().slice(0, 240),
      confidence: 0.82,
      source: "chat",
      createdAt: now,
    };
    const layout: ComponentNode = {
      kind: "stack",
      gap: "sm",
      children: [
        { kind: "text", variant: "title", text: "Memory proposal" },
        { kind: "text", variant: "body", text: proposal.content },
      ],
    };
    const surface = surfaceBase("modal", "memory", "Memory", layout, now);
    surface.actions = [
      { id: "commit-memory", label: "Save", style: "primary", icon: "check" },
      { id: "reject-memory", label: "Ignore", style: "secondary" },
    ];
    return {
      chunks: ["我抓到了一条可能值得长期记住的信息。", "先作为提案给你确认，不会偷偷写入。"],
      finalText: "这条信息适合放进用户画像。我已经生成记忆提案，你确认后再写入。",
      surface,
      memoryProposal: proposal,
    };
  }

  const layout: ComponentNode = {
    kind: "stack",
    gap: "md",
    children: [
      {
        kind: "text",
        variant: "title",
        text: "Agent handoff",
      },
      {
        kind: "text",
        variant: "body",
        text: "I can already stream a turn, change the pet state, and create generated UI surfaces. Try asking for music, video, schedule, search, or memory.",
      },
      {
        kind: "list",
        items: [
          { id: "a", title: "听歌", description: "Opens a media surface with playback actions." },
          { id: "b", title: "今天日程", description: "Builds an interactive timeline panel." },
          { id: "c", title: "查询桌面 Agent 架构", description: "Creates research cards and a comparison table." },
        ],
      },
    ],
  };
  const surface = surfaceBase("panel", "chat", "Agent surface", layout, now);
  surface.actions = [{ id: "next", label: "Next", style: "primary", icon: "plus" }];
  return {
    chunks: ["我已经接上本地事件流。", "这轮会生成一个可交互面板，验证桌面宠物不是纯聊天框。"],
    finalText: "链路已跑通：宠物状态、聊天流、生成式 UI surface 都通过本地 WebSocket 协议更新。",
    surface,
  };
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

function mediaPlayer(media: "music" | "video", title: string, subtitle: string, provider: string, posterTone: "aqua" | "rose" | "amber" | "violet"): ComponentNode {
  return {
    kind: "media-player",
    media,
    title,
    subtitle,
    provider,
    posterTone,
    controls: media === "music" ? ["play", "pause", "queue", "save"] : ["play", "pause", "open", "save"],
  };
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
  emit(socket, state, "pet.emotion", { sessionId, emotion, intensity, reason } satisfies PetEmotionEvent);
}

function emitActivity(socket: WebSocket, state: ClientState, sessionId: string, activity: PetActivityEvent["activity"], active: boolean, reason: string) {
  emit(socket, state, "pet.activity", { sessionId, activity, active, reason } satisfies PetActivityEvent);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
