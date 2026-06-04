import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AccountCurrentPayload,
  AccountProfile,
  AccountSignInPayload,
  AgentDeltaEvent,
  AgentLifecycleEvent,
  ChatMessage,
  ChatMessageEvent,
  ChatSendParams,
  ChatSendPayload,
  FriendAddPayload,
  FriendListPayload,
  FriendSummary,
  HelloPayload,
  Memory,
  MemoryProposalEvent,
  PermissionListPayload,
  PermissionRequest,
  PermissionRequestEvent,
  PermissionResolvePayload,
  PetActivityEvent,
  PetEmotionEvent,
  PetImageCutoutParams,
  PetImageCutoutPayload,
  ProviderConfigureParams,
  ProviderConfigurePayload,
  ProviderSummary,
  RpcEvent,
  RuntimeStatsPayload,
  SessionCreatePayload,
  SessionDeletePayload,
  SessionListPayload,
  SessionResumePayload,
  SkillSummary,
  SocialExchangePayload,
  SocialExchangeRecord,
  SurfaceEvent,
  SurfaceSpec,
  TaskChangedEvent,
  TaskCreateParams,
  TaskCreatePayload,
  TaskDeletePayload,
  TaskListPayload,
  TaskUpdateParams,
  TaskUpdatePayload,
  ScheduledTask,
  ToolAuditListPayload,
  ToolRunEvent,
  ToolRunRecord,
  TokenUsageListPayload,
  TokenUsageSummary,
  UIAction,
  VoiceSpeakPayload,
  VoiceConfigureParams,
  VoiceTranscribePayload,
} from "@pet/protocol";
import { PetAgentClient } from "../services/PetAgentClient";
import { usePetPresence } from "./usePetPresence";
import { usePetSessionState } from "./usePetSessionState";

export type ConnectionStatus = "connecting" | "ready" | "offline";

const WS_URL = import.meta.env.VITE_PET_AGENTD_URL ?? "ws://127.0.0.1:4747";

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function usePetAgent() {
  const client = useMemo(() => new PetAgentClient(WS_URL), []);
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");
  const sessionState = usePetSessionState();
  const {
    sessionId,
    setSessionId,
    sessionIdRef,
    sessions,
    setSessions,
    messages,
    setMessages,
    draft,
    setDraft,
    activeRunIds,
    setActiveRunIds,
    surfaces,
    setSurfaces,
    draftSurface,
    setDraftSurface,
    activeSurfaceId,
    setActiveSurfaceId,
    activeSurface,
  } = sessionState;
  const { petEmotion, petActivity, setPetEmotion, setPetActivity } = usePetPresence();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memoryProposal, setMemoryProposal] = useState<Memory | null>(null);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [tokenUsage, setTokenUsage] = useState<TokenUsageSummary[]>([]);
  const [runtimeStats, setRuntimeStats] = useState<RuntimeStatsPayload | null>(null);
  const [account, setAccount] = useState<AccountProfile | null>(null);
  const [friends, setFriends] = useState<FriendSummary[]>([]);
  const [latestExchange, setLatestExchange] = useState<SocialExchangeRecord | null>(null);
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTask[]>([]);
  const [pendingPermissions, setPendingPermissions] = useState<PermissionRequest[]>([]);
  const [toolRuns, setToolRuns] = useState<ToolRunRecord[]>([]);

  const refreshSideData = useCallback(async () => {
    const [memoryPayload, skillPayload, providerPayload, accountPayload, friendPayload, taskPayload, usagePayload, statsPayload, permissionPayload, toolAuditPayload] = await Promise.all([
      client.request<{ memories: Memory[] }>("memory.list"),
      client.request<{ skills: SkillSummary[] }>("skill.list"),
      client.request<{ providers: ProviderSummary[] }>("provider.list"),
      client.request<AccountCurrentPayload>("account.current"),
      client.request<FriendListPayload>("friend.list"),
      client.request<TaskListPayload>("task.list").catch(() => ({ tasks: [] })),
      client.request<TokenUsageListPayload>("usage.list").catch(() => ({ summaries: [] })),
      client.request<RuntimeStatsPayload>("runtime.stats").catch(() => null),
      client.request<PermissionListPayload>("permission.list", { status: "pending", limit: 80 }).catch(() => ({ requests: [] })),
      client.request<ToolAuditListPayload>("tool.audit.list", { limit: 80 }).catch(() => ({ runs: [] })),
    ]);
    setMemories(memoryPayload.memories);
    setSkills(skillPayload.skills);
    setProviders(providerPayload.providers);
    setAccount(accountPayload.account);
    setFriends(friendPayload.friends);
    setScheduledTasks(taskPayload.tasks);
    setTokenUsage(usagePayload.summaries);
    setRuntimeStats(statsPayload);
    setPendingPermissions(permissionPayload.requests);
    setToolRuns(toolAuditPayload.runs);
  }, [client]);

  const refreshRuntimeStats = useCallback(async () => {
    const payload = await client.request<RuntimeStatsPayload>("runtime.stats");
    setRuntimeStats(payload);
    return payload;
  }, [client]);

  const refreshSessionList = useCallback(async () => {
    const payload = await client.request<SessionListPayload>("session.list");
    setSessions(payload.sessions);
    return payload.sessions;
  }, [client]);

  const applySessionPayload = useCallback((session: Pick<SessionResumePayload, "sessionId" | "title" | "messages" | "surfaces">) => {
    sessionIdRef.current = session.sessionId;
    setSessionId(session.sessionId);
    setMessages(session.messages);
    setSurfaces(session.surfaces);
    setActiveSurfaceId(session.surfaces[0]?.id ?? null);
  }, []);

  useEffect(() => {
    let disposed = false;
    let connecting = false;
    let reconnectTimer: number | undefined;
    const disposeEvent = client.onEvent((event) => handleEvent(event));
    const disposeStatus = client.onStatus((status) => {
      setConnection(status);
      if (status === "offline") scheduleReconnect();
    });

    setConnection("connecting");
    void initializeConnection();

    function scheduleReconnect() {
      if (disposed || connecting || reconnectTimer) return;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        void initializeConnection();
      }, 750);
    }

    async function initializeConnection() {
      if (connecting) return;
      connecting = true;
      try {
        for (let attempt = 0; attempt < 30; attempt += 1) {
          try {
            await client.connect();
            if (disposed) return;
            await client.request<HelloPayload>("hello", { clientName: "pet-desktop-web", protocolVersion: "0.1" });
            const session = await client.request<SessionResumePayload>("session.resume");
            if (disposed) return;
            applySessionPayload(session);
            await refreshSessionList();
            await refreshSideData();
            return;
          } catch {
            client.close();
            if (disposed) return;
            setConnection(attempt > 2 ? "offline" : "connecting");
            await sleep(Math.min(250 + attempt * 150, 1_500));
          }
        }
        if (!disposed) setConnection("offline");
      } finally {
        connecting = false;
      }
    }

    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      disposeEvent();
      disposeStatus();
      client.close();
    };
  }, [applySessionPayload, client, refreshRuntimeStats, refreshSessionList, refreshSideData]);

  function handleEvent(frame: RpcEvent) {
    switch (frame.event) {
      case "chat.message": {
        const payload = frame.payload as ChatMessageEvent;
        if (payload.sessionId !== sessionIdRef.current) break;
        setMessages((current) => (current.some((message) => message.id === payload.message.id) ? current : [...current, payload.message]));
        void refreshSessionList().catch(() => undefined);
        void refreshRuntimeStats().catch(() => undefined);
        if (payload.message.role === "assistant") {
          setDraft("");
          setDraftSurface(null);
        }
        break;
      }
      case "agent.lifecycle": {
        const payload = frame.payload as AgentLifecycleEvent;
        if (payload.sessionId !== sessionIdRef.current) break;
        if (payload.phase === "start") {
          setActiveRunIds((current) => (current.includes(payload.runId) ? current : [...current, payload.runId]));
        } else {
          setActiveRunIds((current) => current.filter((runId) => runId !== payload.runId));
        }
        break;
      }
      case "agent.delta": {
        const payload = frame.payload as AgentDeltaEvent;
        if (payload.sessionId !== sessionIdRef.current) break;
        if (payload.surface) setDraftSurface(payload.surface);
        setDraft((current) => `${current}${payload.text}`);
        break;
      }
      case "pet.emotion": {
        const payload = frame.payload as PetEmotionEvent;
        setPetEmotion(payload.emotion);
        break;
      }
      case "pet.activity": {
        const payload = frame.payload as PetActivityEvent;
        setPetActivity({ activity: payload.activity, active: payload.active, reason: payload.reason });
        break;
      }
      case "ui.surface.create": {
        const payload = frame.payload as SurfaceEvent;
        if (payload.sessionId !== sessionIdRef.current) break;
        setSurfaces((current) => [payload.surface, ...current.filter((surface) => surface.id !== payload.surface.id)]);
        setActiveSurfaceId(payload.surface.id);
        break;
      }
      case "ui.surface.update": {
        const payload = frame.payload as SurfaceEvent;
        if (payload.sessionId !== sessionIdRef.current) break;
        setSurfaces((current) => current.map((surface) => (surface.id === payload.surface.id ? payload.surface : surface)));
        break;
      }
      case "task.changed": {
        const payload = frame.payload as TaskChangedEvent;
        setScheduledTasks(payload.tasks);
        break;
      }
      case "memory.proposal": {
        const payload = frame.payload as MemoryProposalEvent;
        setMemoryProposal(payload.proposal);
        break;
      }
      case "permission.request": {
        const payload = frame.payload as PermissionRequestEvent;
        setPendingPermissions((current) => [payload.request, ...current.filter((item) => item.id !== payload.request.id)]);
        break;
      }
      case "tool.run": {
        const payload = frame.payload as ToolRunEvent;
        setToolRuns((current) => [payload.run, ...current.filter((run) => run.id !== payload.run.id)].slice(0, 80));
        if (payload.run.permissionId && payload.run.status !== "pending_permission") {
          setPendingPermissions((current) => current.filter((item) => item.id !== payload.run.permissionId));
        }
        void refreshRuntimeStats().catch(() => undefined);
        break;
      }
      default:
        break;
    }
  }

  const sendMessage = useCallback(
    async (
      text: string,
      source: "text" | "voice" | "ui" = "text",
      surfaceAction?: ChatSendParams["surfaceAction"],
    ) => {
      const trimmed = text.trim();
      if (!trimmed || !sessionId) return;

      setDraft("");
      setDraftSurface(null);
      return client.request<ChatSendPayload>("chat.send", { sessionId, text: trimmed, source, ...(surfaceAction ? { surfaceAction } : {}) });
    },
    [client, sessionId],
  );

  const sendText = useCallback((text: string) => sendMessage(text), [sendMessage]);
  const sendVoiceTranscript = useCallback((text: string) => sendMessage(text, "voice"), [sendMessage]);

  const transcribeVoice = useCallback(
    (audioData: string) => client.request<VoiceTranscribePayload>("voice.transcribe", { audioData }),
    [client],
  );

  const speakText = useCallback(
    (text: string) => client.request<VoiceSpeakPayload>("voice.speak", { text }),
    [client],
  );

  const cutoutPetImage = useCallback(
    (params: PetImageCutoutParams) => client.request<PetImageCutoutPayload>("pet.image.cutout", params),
    [client],
  );

  const handleSurfaceAction = useCallback(
    async (action: UIAction, surface: SurfaceSpec, value?: unknown) => {
      if (action.id === "commit-memory" && memoryProposal) {
        await client.request("memory.commit", { proposal: memoryProposal });
        setMemories((current) => [memoryProposal, ...current.filter((memory) => memory.id !== memoryProposal.id)]);
        setMemoryProposal(null);
        return;
      }

      if (action.id === "reject-memory") {
        await client.request("memory.reject", { proposalId: memoryProposal?.id });
        setMemoryProposal(null);
        return;
      }

      await sendMessage(action.label, "ui", {
        surfaceId: surface.id,
        actionId: action.id,
        name: action.id,
        sourceComponentId: action.sourceComponentId,
        context: action.context,
        dataModel: surface.data,
        value,
      });
    },
    [client, memoryProposal, sendMessage],
  );

  const commitMemoryProposal = useCallback(async () => {
    if (!memoryProposal) return;
    await client.request("memory.commit", { proposal: memoryProposal });
    setMemories((current) => [memoryProposal, ...current.filter((memory) => memory.id !== memoryProposal.id)]);
    setMemoryProposal(null);
  }, [client, memoryProposal]);

  const rejectMemoryProposal = useCallback(async () => {
    if (!memoryProposal) return;
    await client.request("memory.reject", { proposalId: memoryProposal.id });
    setMemoryProposal(null);
  }, [client, memoryProposal]);

  const runSkill = useCallback(
    async (name: string) => {
      if (!sessionId) return;
      await client.request("skill.run", { sessionId, name });
    },
    [client, sessionId],
  );

  const resumeSession = useCallback(
    async (targetSessionId: string) => {
      if (targetSessionId === sessionIdRef.current) return;
      const session = await client.request<SessionResumePayload>("session.resume", { sessionId: targetSessionId });
      setDraft("");
      setDraftSurface(null);
      setActiveRunIds([]);
      applySessionPayload(session);
      await refreshSessionList();
    },
    [applySessionPayload, client, refreshSessionList],
  );

  const createSession = useCallback(async () => {
    const payload = await client.request<SessionCreatePayload>("session.create", { title: "新会话" });
    setDraft("");
    setDraftSurface(null);
    setActiveRunIds([]);
    applySessionPayload({
      sessionId: payload.sessionId,
      title: payload.title,
      messages: payload.messages ?? [],
      surfaces: payload.surfaces ?? [],
    });
    await refreshSessionList();
    await refreshRuntimeStats().catch(() => undefined);
  }, [applySessionPayload, client, refreshRuntimeStats, refreshSessionList]);

  const deleteSession = useCallback(
    async (targetSessionId: string) => {
      await client.request<SessionDeletePayload>("session.delete", { sessionId: targetSessionId });
      const nextSessions = await refreshSessionList();
      await refreshRuntimeStats().catch(() => undefined);
      if (targetSessionId !== sessionIdRef.current) return;

      const nextSession = nextSessions[0];
      if (nextSession) {
        const session = await client.request<SessionResumePayload>("session.resume", { sessionId: nextSession.id });
        setActiveRunIds([]);
        applySessionPayload(session);
        return;
      }

      await createSession();
    },
    [applySessionPayload, client, createSession, refreshRuntimeStats, refreshSessionList],
  );

  const signIn = useCallback(
    async (displayName: string) => {
      const payload = await client.request<AccountSignInPayload>("account.signIn", { displayName });
      setAccount(payload.account);
    },
    [client],
  );

  const addFriend = useCallback(
    async (handle: string) => {
      const payload = await client.request<FriendAddPayload>("friend.add", { handle });
      setFriends((current) => [payload.friend, ...current.filter((friend) => friend.id !== payload.friend.id)]);
    },
    [client],
  );

  const exchangeWithFriend = useCallback(
    async (friendId: string) => {
      const payload = await client.request<SocialExchangePayload>("social.exchange", { friendId });
      setLatestExchange(payload.exchange);
      const friendPayload = await client.request<FriendListPayload>("friend.list");
      setFriends(friendPayload.friends);
    },
    [client],
  );

  const configureProvider = useCallback(
    async (params: ProviderConfigureParams) => {
      const payload = await client.request<ProviderConfigurePayload>("provider.configure", params);
      setProviders(payload.providers);
      const usagePayload = await client.request<TokenUsageListPayload>("usage.list").catch(() => ({ summaries: [] }));
      setTokenUsage(usagePayload.summaries);
    },
    [client],
  );

  const configureVoice = useCallback(
    async (params: VoiceConfigureParams) => {
      const payload = await client.request<ProviderConfigurePayload>("voice.configure", params);
      setProviders(payload.providers);
      const usagePayload = await client.request<TokenUsageListPayload>("usage.list").catch(() => ({ summaries: [] }));
      setTokenUsage(usagePayload.summaries);
    },
    [client],
  );

  const refreshTokenUsage = useCallback(async () => {
    const usagePayload = await client.request<TokenUsageListPayload>("usage.list");
    setTokenUsage(usagePayload.summaries);
  }, [client]);

  const createTask = useCallback(
    async (params: TaskCreateParams) => {
      const payload = await client.request<TaskCreatePayload>("task.create", params);
      setScheduledTasks((current) => [payload.task, ...current.filter((task) => task.id !== payload.task.id)]);
      return payload;
    },
    [client],
  );

  const updateTask = useCallback(
    async (taskId: string, updates: Omit<TaskUpdateParams, "taskId">) => {
      const payload = await client.request<TaskUpdatePayload>("task.update", { taskId, ...updates });
      setScheduledTasks((current) => current.map((task) => (task.id === payload.task.id ? payload.task : task)));
      return payload;
    },
    [client],
  );

  const deleteTask = useCallback(
    async (taskId: string) => {
      const payload = await client.request<TaskDeletePayload>("task.delete", { taskId });
      setScheduledTasks((current) => current.filter((task) => task.id !== payload.taskId));
      return payload;
    },
    [client],
  );

  const resolvePermission = useCallback(
    async (permissionId: string, approved: boolean) => {
      const payload = await client.request<PermissionResolvePayload>("permission.resolve", { permissionId, approved });
      setPendingPermissions((current) => current.filter((request) => request.id !== permissionId || payload.request.status === "pending"));
      if (payload.run) {
        setToolRuns((current) => [payload.run!, ...current.filter((run) => run.id !== payload.run!.id)].slice(0, 80));
      }
      await refreshRuntimeStats().catch(() => undefined);
      return payload;
    },
    [client, refreshRuntimeStats],
  );

  const saveMemoryText = useCallback(
    async (content: string, id = "mem_manual_profile") => {
      const trimmed = content.trim();
      if (!trimmed) return;
      const memory: Memory = {
        id,
        kind: "user_profile",
        scope: "private",
        content: trimmed,
        confidence: 0.92,
        source: "import",
        createdAt: new Date().toISOString(),
      };
      await client.request("memory.commit", { proposal: memory });
      setMemories((current) => [memory, ...current.filter((item) => item.id !== memory.id)]);
    },
    [client],
  );

  return {
    connection,
    sessionId,
    sessions,
    messages,
    draft,
    isAgentRunning: activeRunIds.length > 0,
    draftSurface,
    petEmotion,
    petActivity,
    surfaces,
    activeSurface,
    activeSurfaceId,
    setActiveSurfaceId,
    memories,
    memoryProposal,
    skills,
    providers,
    tokenUsage,
    runtimeStats,
    account,
    friends,
    latestExchange,
    scheduledTasks,
    pendingPermissions,
    toolRuns,
    sendText,
    sendVoiceTranscript,
    transcribeVoice,
    speakText,
    cutoutPetImage,
    handleSurfaceAction,
    resumeSession,
    createSession,
    deleteSession,
    commitMemoryProposal,
    rejectMemoryProposal,
    runSkill,
    signIn,
    addFriend,
    exchangeWithFriend,
    configureProvider,
    configureVoice,
    refreshTokenUsage,
    createTask,
    updateTask,
    deleteTask,
    resolvePermission,
    saveMemoryText,
  };
}
