import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AccountCurrentPayload,
  AccountProfile,
  AccountSignInPayload,
  AgentDeltaEvent,
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
  ProviderSummary,
  RpcEvent,
  SessionResumePayload,
  SkillSummary,
  SocialExchangePayload,
  SocialExchangeRecord,
  SurfaceEvent,
  SurfaceSpec,
  UIAction,
  VoiceSpeakPayload,
  VoiceTranscribePayload,
} from "@pet/protocol";
import { PetAgentClient } from "../services/PetAgentClient";

export type ConnectionStatus = "connecting" | "ready" | "offline";

const WS_URL = import.meta.env.VITE_PET_AGENTD_URL ?? "ws://127.0.0.1:4747";

export function usePetAgent() {
  const client = useMemo(() => new PetAgentClient(WS_URL), []);
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [petEmotion, setPetEmotion] = useState<PetEmotion>("idle");
  const [petActivity, setPetActivity] = useState<Omit<PetActivityEvent, "sessionId">>({
    activity: "sleeping",
    active: false,
    reason: "initial-rest",
  });
  const [surfaces, setSurfaces] = useState<SurfaceSpec[]>([]);
  const [activeSurfaceId, setActiveSurfaceId] = useState<string | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memoryProposal, setMemoryProposal] = useState<Memory | null>(null);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [account, setAccount] = useState<AccountProfile | null>(null);
  const [friends, setFriends] = useState<FriendSummary[]>([]);
  const [latestExchange, setLatestExchange] = useState<SocialExchangeRecord | null>(null);

  const activeSurface = useMemo(
    () => surfaces.find((surface) => surface.id === activeSurfaceId) ?? surfaces[0],
    [activeSurfaceId, surfaces],
  );

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
    const [memoryPayload, skillPayload, providerPayload, accountPayload, friendPayload] = await Promise.all([
      client.request<{ memories: Memory[] }>("memory.list"),
      client.request<{ skills: SkillSummary[] }>("skill.list"),
      client.request<{ providers: ProviderSummary[] }>("provider.list"),
      client.request<AccountCurrentPayload>("account.current"),
      client.request<FriendListPayload>("friend.list"),
    ]);
    setMemories(memoryPayload.memories);
    setSkills(skillPayload.skills);
    setProviders(providerPayload.providers);
    setAccount(accountPayload.account);
    setFriends(friendPayload.friends);
  }, [client]);

  useEffect(() => {
    const disposeEvent = client.onEvent((event) => handleEvent(event));
    const disposeStatus = client.onStatus((status) => setConnection(status));

    setConnection("connecting");
    void (async () => {
      await client.connect();
      await client.request<HelloPayload>("hello", { clientName: "pet-desktop-web", protocolVersion: "0.1" });
      const session = await client.request<SessionResumePayload>("session.resume");
      setSessionId(session.sessionId);
      setMessages(session.messages);
      setSurfaces(session.surfaces);
      setActiveSurfaceId(session.surfaces[0]?.id ?? null);
      await refreshSideData();
    })().catch(() => setConnection("offline"));

    return () => {
      disposeEvent();
      disposeStatus();
      client.close();
    };
  }, [client, refreshSideData]);

  function handleEvent(frame: RpcEvent) {
    switch (frame.event) {
      case "chat.message": {
        const payload = frame.payload as ChatMessageEvent;
        setMessages((current) => [...current, payload.message]);
        if (payload.message.role === "assistant") {
          setDraft("");
        }
        break;
      }
      case "agent.delta": {
        const payload = frame.payload as AgentDeltaEvent;
        setDraft((current) => `${current}${current ? "\n" : ""}${payload.text}`);
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
    async (text: string, source: "text" | "voice" = "text") => {
      const trimmed = text.trim();
      if (!trimmed || !sessionId) return;

      setDraft("");
      return client.request<ChatSendPayload>("chat.send", { sessionId, text: trimmed, source });
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

      await sendText(`UI action from ${surface.title ?? surface.intent}: ${action.label}`);
    },
    [client, memoryProposal, sendText],
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

  return {
    connection,
    sessionId,
    messages,
    draft,
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
    account,
    friends,
    latestExchange,
    sendText,
    sendVoiceTranscript,
    transcribeVoice,
    speakText,
    handleSurfaceAction,
    commitMemoryProposal,
    rejectMemoryProposal,
    runSkill,
    signIn,
    addFriend,
    exchangeWithFriend,
  };
}
