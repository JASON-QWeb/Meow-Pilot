import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, SessionSummary, SurfaceSpec } from "@pet/protocol";

export function usePetSessionState() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [activeRunIds, setActiveRunIds] = useState<string[]>([]);
  const [surfaces, setSurfaces] = useState<SurfaceSpec[]>([]);
  const [draftSurface, setDraftSurface] = useState<SurfaceSpec | null>(null);
  const [activeSurfaceId, setActiveSurfaceId] = useState<string | null>(null);

  const activeSurface = useMemo(
    () => surfaces.find((surface) => surface.id === activeSurfaceId) ?? surfaces[0],
    [activeSurfaceId, surfaces],
  );

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  return {
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
  };
}
