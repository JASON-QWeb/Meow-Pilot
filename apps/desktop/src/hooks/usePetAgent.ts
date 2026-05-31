import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AccountCurrentPayload,
  AccountProfile,
  AccountSignInPayload,
  AgentDeltaEvent,
  AgentLifecycleEvent,
  ChatMessage,
  ChatMessageEvent,
  ChatSendPayload,
  FriendAddPayload,
  FriendListPayload,
  FriendSummary,
  HelloPayload,
  Memory,
  MemoryProposalEvent,
  PetActivityEvent,
  PetEmotion,
  PetEmotionEvent,
  ProviderConfigureParams,
  ProviderConfigurePayload,
  ProviderSummary,
  RpcEvent,
  RuntimeStatsPayload,
  SessionCreatePayload,
  SessionDeletePayload,
  SessionListPayload,
  SessionResumePayload,
  SessionSummary,
  SkillSummary,
  SocialExchangePayload,
  SocialExchangeRecord,
  SurfaceEvent,
  SurfaceSpec,
  TokenUsageListPayload,
  TokenUsageSummary,
  UIAction,
  VoiceSpeakPayload,
  VoiceConfigureParams,
  VoiceTranscribePayload,
} from "@pet/protocol";
import { PetAgentClient } from "../services/PetAgentClient";

export type ConnectionStatus = "connecting" | "ready" | "offline";

const WS_URL = import.meta.env.VITE_PET_AGENTD_URL ?? "ws://127.0.0.1:4747";

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function usePetAgent() {
  const client = useMemo(() => new PetAgentClient(WS_URL), []);
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [activeRunIds, setActiveRunIds] = useState<string[]>([]);
  const [petEmotion, setPetEmotion] = useState<PetEmotion>("idle");
  const [petActivity, setPetActivity] = useState<Omit<PetActivityEvent, "sessionId">>({
    activity: "sleeping",
    active: false,
    reason: "initial-rest",
  });
  const [surfaces, setSurfaces] = useState<SurfaceSpec[]>([]);
  const [draftSurface, setDraftSurface] = useState<SurfaceSpec | null>(null);
  const [activeSurfaceId, setActiveSurfaceId] = useState<string | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memoryProposal, setMemoryProposal] = useState<Memory | null>(null);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [tokenUsage, setTokenUsage] = useState<TokenUsageSummary[]>([]);
  const [runtimeStats, setRuntimeStats] = useState<RuntimeStatsPayload | null>(null);
  const [account, setAccount] = useState<AccountProfile | null>(null);
  const [friends, setFriends] = useState<FriendSummary[]>([]);
  const [latestExchange, setLatestExchange] = useState<SocialExchangeRecord | null>(null);

  const activeSurface = useMemo(
    () => surfaces.find((surface) => surface.id === activeSurfaceId) ?? surfaces[0],
    [activeSurfaceId, surfaces],
  );

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    if (petActivity.active) return;
    const interval = window.setInterval(() => {
      setPetActivity((current) =>
        current.active
          ? current
          : {
              activity: current.activity === "sleeping" ? "exercise" : "sleeping",
              active: false,
              reason: "idle-rotation",
            },
      );
    }, 12_000);
    return () => window.clearInterval(interval);
  }, [petActivity.active]);

  const refreshSideData = useCallback(async () => {
    const [memoryPayload, skillPayload, providerPayload, accountPayload, friendPayload, usagePayload, statsPayload] = await Promise.all([
      client.request<{ memories: Memory[] }>("memory.list"),
      client.request<{ skills: SkillSummary[] }>("skill.list"),
      client.request<{ providers: ProviderSummary[] }>("provider.list"),
      client.request<AccountCurrentPayload>("account.current"),
      client.request<FriendListPayload>("friend.list"),
      client.request<TokenUsageListPayload>("usage.list").catch(() => ({ summaries: [] })),
      client.request<RuntimeStatsPayload>("runtime.stats").catch(() => null),
    ]);
    setMemories(memoryPayload.memories);
    setSkills(skillPayload.skills);
    setProviders(providerPayload.providers);
    setAccount(accountPayload.account);
    setFriends(friendPayload.friends);
    setTokenUsage(usagePayload.summaries);
    setRuntimeStats(statsPayload);
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
    const disposeEvent = client.onEvent((event) => handleEvent(event));
    const disposeStatus = client.onStatus((status) => setConnection(status));

    setConnection("connecting");
    void initializeConnection();

    async function initializeConnection() {
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
    }

    return () => {
      disposed = true;
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
      case "memory.proposal": {
        const payload = frame.payload as MemoryProposalEvent;
        setMemoryProposal(payload.proposal);
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
      surfaceAction?: {
        surfaceId: string;
        actionId: string;
        value?: unknown;
      },
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

  const handleSurfaceAction = useCallback(
    async (action: UIAction, surface: SurfaceSpec) => {
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

  const saveMemoryText = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;
      const memory: Memory = {
        id: "mem_manual_profile",
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
    sendText,
    sendVoiceTranscript,
    transcribeVoice,
    speakText,
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
    saveMemoryText,
  };
}
