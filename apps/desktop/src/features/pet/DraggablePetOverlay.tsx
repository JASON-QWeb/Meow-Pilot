import { useEffect, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from "react";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Gauge, MessageCircle, Music, Send, Video, Volume2, X } from "lucide-react";
import type { ChatMessage, PetActivity, PetEmotion, TokenUsageSummary } from "@pet/protocol";
import { PetAvatar } from "./PetAvatar";
import type { PetPosition, PetProfile, PetRigAsset } from "./petProfile";

type DraggablePetOverlayProps = {
  profile: PetProfile;
  asset: PetRigAsset | null;
  emotion: PetEmotion;
  activity: PetActivity;
  active: boolean;
  tokenUsage: TokenUsageSummary[];
  messages: ChatMessage[];
  isAgentRunning?: boolean;
  position: PetPosition;
  onPositionChange: (position: PetPosition) => void;
  onOpenWork: () => void;
  onSendPrompt: (text: string) => unknown | Promise<unknown>;
  dragWindow?: boolean;
};

type DragState = {
  startX: number;
  startY: number;
  startScreenX: number;
  startScreenY: number;
  originX: number;
  originY: number;
  originWindowX?: number;
  originWindowY?: number;
  moved: boolean;
};

type OverlayMode = "menu" | "usage" | "chat" | "music" | "video" | null;
type LocalMedia = { url: string; name: string; mimeType: string; objectUrl?: boolean };

const activityCopy: Record<PetActivity, string> = {
  coding: "编码中",
  research: "查资料",
  exercise: "活动中",
  sleeping: "休息中",
};
const collapsedWindowSize = { width: 180, height: 180 };
const expandedWindowSize = { width: 540, height: 380 };

export function DraggablePetOverlay({
  profile,
  asset,
  emotion,
  activity,
  active,
  tokenUsage,
  messages,
  isAgentRunning = false,
  position,
  onPositionChange,
  onOpenWork,
  onSendPrompt,
  dragWindow = false,
}: DraggablePetOverlayProps) {
  const dragRef = useRef<DragState | null>(null);
  const frameRef = useRef<number | null>(null);
  const pendingWindowPositionRef = useRef<PhysicalPosition | null>(null);
  const musicInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [overlayMode, setOverlayMode] = useState<OverlayMode>(null);
  const [quickChatDraft, setQuickChatDraft] = useState("");
  const [localTrack, setLocalTrack] = useState<LocalMedia | null>(null);
  const [localVideo, setLocalVideo] = useState<LocalMedia | null>(null);
  const overlayOpen = overlayMode !== null;
  const tokenRows = buildTokenProgressRows(tokenUsage);
  const recentMessages = messages.filter((message) => message.role !== "system").slice(-4);
  const activeTrack = localTrack;
  const activeVideo = localVideo;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOverlayMode(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousemove", handleGlobalMouseMove);
      window.removeEventListener("mouseup", handleGlobalMouseUp);
      window.removeEventListener("keydown", handleKeyDown);
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!dragWindow) return;
    void resizePetWindow(overlayOpen).catch(() => undefined);
  }, [dragWindow, overlayOpen]);

  useEffect(
    () => () => {
      revokeLocalMedia(localTrack);
    },
    [localTrack],
  );

  useEffect(
    () => () => {
      revokeLocalMedia(localVideo);
    },
    [localVideo],
  );

  function clamp(nextX: number, nextY: number): PetPosition {
    const width = 150;
    const height = 150;
    return {
      x: Math.max(8, Math.min(window.innerWidth - width, nextX)),
      y: Math.max(8, Math.min(window.innerHeight - height, nextY)),
    };
  }

  function handleMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    beginDrag(event.clientX, event.clientY, event.screenX, event.screenY);
    window.addEventListener("mousemove", handleGlobalMouseMove);
    window.addEventListener("mouseup", handleGlobalMouseUp, { once: true });
  }

  function handleGlobalMouseMove(event: globalThis.MouseEvent) {
    updateDrag(event.clientX, event.clientY, event.screenX, event.screenY);
  }

  function handleGlobalMouseUp() {
    window.removeEventListener("mousemove", handleGlobalMouseMove);
    endDrag();
  }

  function beginDrag(clientX: number, clientY: number, screenX: number, screenY: number) {
    dragRef.current = {
      startX: clientX,
      startY: clientY,
      startScreenX: screenX,
      startScreenY: screenY,
      originX: position.x,
      originY: position.y,
      moved: false,
    };
    setDragging(true);

    if (dragWindow) {
      const currentWindow = getCurrentWindow();
      void currentWindow
        .outerPosition()
        .then((origin) => {
          if (dragRef.current) {
            dragRef.current.originWindowX = origin.x;
            dragRef.current.originWindowY = origin.y;
          }
        })
        .catch(() => {
          void currentWindow.startDragging().catch(() => undefined);
        });
    }
  }

  function updateDrag(clientX: number, clientY: number, screenX: number, screenY: number) {
    const drag = dragRef.current;
    if (!drag) return;

    const deltaX = clientX - drag.startX;
    const deltaY = clientY - drag.startY;
    const deltaScreenX = screenX - drag.startScreenX;
    const deltaScreenY = screenY - drag.startScreenY;
    if (Math.abs(deltaScreenX) + Math.abs(deltaScreenY) > 5 || Math.abs(deltaX) + Math.abs(deltaY) > 5) {
      drag.moved = true;
    }

    if (dragWindow) {
      if (drag.originWindowX === undefined || drag.originWindowY === undefined) return;
      scheduleWindowMove(drag.originWindowX + deltaScreenX, drag.originWindowY + deltaScreenY);
      return;
    }

    onPositionChange(clamp(drag.originX + deltaX, drag.originY + deltaY));
  }

  function endDrag() {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDragging(false);

    if (!drag.moved) {
      onOpenWork();
    }
  }

  function handleDoubleClick(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    onOpenWork();
  }

  function handleContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setOverlayMode((current) => (current === "menu" ? null : "menu"));
  }

  function stopOverlayControl(event: ReactMouseEvent<HTMLElement>) {
    event.stopPropagation();
  }

  async function submitQuickChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = quickChatDraft.trim();
    if (!text) return;
    setQuickChatDraft("");
    await onSendPrompt(text);
  }

  function chooseLocalTrack(file?: File) {
    if (!file) return;
    setLocalTrack((current) => {
      revokeLocalMedia(current);
      return {
        url: URL.createObjectURL(file),
        name: file.name,
        mimeType: file.type,
        objectUrl: true,
      };
    });
  }

  function chooseLocalVideo(file?: File) {
    if (!file) return;
    setLocalVideo((current) => {
      revokeLocalMedia(current);
      return {
        url: URL.createObjectURL(file),
        name: file.name,
        mimeType: file.type,
        objectUrl: true,
      };
    });
  }

  function closeOverlay(event?: ReactMouseEvent<HTMLElement>) {
    if (event) stopOverlayControl(event);
    setOverlayMode(null);
  }

  function renderOverlayPanel() {
    if (overlayMode === "menu") {
      return (
        <aside className="petOverlayPanel petOverlayMenu" aria-label="宠物快捷菜单" onMouseDown={stopOverlayControl} onContextMenu={stopOverlayControl}>
          <header className="petOverlayMenuHeader">
            <button type="button" aria-label="关闭快捷菜单" onClick={closeOverlay}>
              <X size={15} />
            </button>
          </header>
          <div className="petContextActions">
            <button type="button" onClick={() => setOverlayMode("usage")}>
              <Gauge size={17} />
              <span>模型用量</span>
            </button>
            <button type="button" onClick={() => setOverlayMode("chat")}>
              <MessageCircle size={17} />
              <span>快速对话</span>
            </button>
            <button type="button" onClick={() => setOverlayMode("music")}>
              <Music size={17} />
              <span>听歌</span>
            </button>
            <button type="button" onClick={() => setOverlayMode("video")}>
              <Video size={17} />
              <span>视频</span>
            </button>
          </div>
        </aside>
      );
    }

    if (overlayMode === "usage") {
      return (
        <aside className="petOverlayPanel petUsageBoard" aria-label="模型用量" onMouseDown={stopOverlayControl} onContextMenu={stopOverlayControl}>
          <header>
            <div>
              <strong>模型用量</strong>
              <p>{tokenRows.length} 条额度</p>
            </div>
            <button type="button" aria-label="关闭模型用量" onClick={closeOverlay}>
              <X size={15} />
            </button>
          </header>
          <div className="petTokenProgressList">
            {tokenRows.map((row) => (
              <section className={`petTokenProgress ${row.accent}`} key={row.id}>
                <div className="petTokenProgressLabel">
                  <span>{row.label}</span>
                  <strong>{row.value}</strong>
                </div>
                <div className="petTokenProgressTrack">
                  <span className={row.pending ? "pending" : ""} style={row.pending ? undefined : { width: `${row.percent}%` }} />
                </div>
              </section>
            ))}
          </div>
        </aside>
      );
    }

    if (overlayMode === "chat") {
      return (
        <aside className="petOverlayPanel petQuickChat" aria-label="快速对话" onMouseDown={stopOverlayControl} onContextMenu={stopOverlayControl}>
          <header>
            <div>
              <strong>快速对话</strong>
              <p>{isAgentRunning ? "正在回复" : "当前会话"}</p>
            </div>
            <button type="button" aria-label="关闭快速对话" onClick={closeOverlay}>
              <X size={15} />
            </button>
          </header>
          <div className="petQuickChatMessages">
            {recentMessages.map((message, index) => (
              <article className={message.role === "user" ? "user" : "assistant"} key={message.id ?? `${message.role}-${index}`}>
                <span>{message.role === "user" ? "你" : profile.name}</span>
                <p>{message.content}</p>
              </article>
            ))}
            {!recentMessages.length ? <p className="petOverlayEmpty">直接输入一句话开始。</p> : null}
          </div>
          <form className="petQuickChatForm" onSubmit={(event) => void submitQuickChat(event)}>
            <input value={quickChatDraft} onChange={(event) => setQuickChatDraft(event.currentTarget.value)} placeholder="输入消息" />
            <button type="submit" aria-label="发送快速对话" disabled={!quickChatDraft.trim()}>
              <Send size={15} />
            </button>
          </form>
        </aside>
      );
    }

    if (overlayMode === "music") {
      return (
        <aside className="petOverlayPanel petMusicPanel" aria-label="音乐播放器" onMouseDown={stopOverlayControl} onContextMenu={stopOverlayControl}>
          <header>
            <div>
              <strong>音乐播放器</strong>
              <p>{activeTrack ? activeTrack.name : "选择本地歌曲"}</p>
            </div>
            <button type="button" aria-label="关闭音乐播放器" onClick={closeOverlay}>
              <X size={15} />
            </button>
          </header>
          {activeTrack ? (
            <div className="petMusicPlayer">
              <Music size={24} />
              <audio controls preload="metadata" src={activeTrack.url}>
                {activeTrack.mimeType ? <source src={activeTrack.url} type={activeTrack.mimeType} /> : null}
              </audio>
            </div>
          ) : (
            <button className="petMusicPicker" type="button" onClick={() => musicInputRef.current?.click()}>
              <Volume2 size={18} />
              选择歌曲播放
            </button>
          )}
          {activeTrack ? (
            <button className="petMusicReplace" type="button" onClick={() => musicInputRef.current?.click()}>
              换一首
            </button>
          ) : null}
          <input
            className="visuallyHidden"
            ref={musicInputRef}
            type="file"
            accept="audio/*"
            onChange={(event) => {
              chooseLocalTrack(event.currentTarget.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
        </aside>
      );
    }

    if (overlayMode === "video") {
      return (
        <aside className="petOverlayPanel petVideoPanel" aria-label="视频播放器" onMouseDown={stopOverlayControl} onContextMenu={stopOverlayControl}>
          <header>
            <div>
              <strong>视频播放器</strong>
              <p>{activeVideo ? activeVideo.name : "选择本地视频"}</p>
            </div>
            <button type="button" aria-label="关闭视频播放器" onClick={closeOverlay}>
              <X size={15} />
            </button>
          </header>
          {activeVideo ? (
            <div className="petVideoPlayer">
              <video
                autoPlay
                muted
                loop
                playsInline
                controls
                preload="auto"
                src={activeVideo.url}
                onLoadedMetadata={(event) => prepareVideoPreview(event.currentTarget)}
                onCanPlay={(event) => void event.currentTarget.play().catch(() => undefined)}
              >
                {activeVideo.mimeType ? <source src={activeVideo.url} type={activeVideo.mimeType} /> : null}
              </video>
            </div>
          ) : (
            <button className="petVideoPicker" type="button" onClick={() => videoInputRef.current?.click()}>
              <Video size={18} />
              选择视频播放
            </button>
          )}
          {activeVideo ? (
            <button className="petVideoReplace" type="button" onClick={() => videoInputRef.current?.click()}>
              换一个
            </button>
          ) : null}
          <input
            className="visuallyHidden"
            ref={videoInputRef}
            type="file"
            accept="video/*"
            onChange={(event) => {
              chooseLocalVideo(event.currentTarget.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
        </aside>
      );
    }

    return null;
  }

  function scheduleWindowMove(x: number, y: number) {
    pendingWindowPositionRef.current = new PhysicalPosition(Math.round(x), Math.round(y));
    if (frameRef.current !== null) return;

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const next = pendingWindowPositionRef.current;
      pendingWindowPositionRef.current = null;
      if (next) {
        void getCurrentWindow().setPosition(next).catch(() => undefined);
      }
    });
  }

  async function resizePetWindow(expanded: boolean) {
    const nextSize = expanded ? expandedWindowSize : collapsedWindowSize;
    const currentWindow = getCurrentWindow();
    const [position, size, scaleFactor] = await Promise.all([
      currentWindow.outerPosition(),
      currentWindow.outerSize(),
      currentWindow.scaleFactor(),
    ]);
    const currentLogicalWidth = size.width / scaleFactor;
    const currentLogicalHeight = size.height / scaleFactor;

    if (Math.abs(currentLogicalWidth - nextSize.width) < 1 && Math.abs(currentLogicalHeight - nextSize.height) < 1) return;

    const nextX = position.x - Math.round(((nextSize.width - currentLogicalWidth) * scaleFactor) / 2);
    const nextY = position.y - Math.round(((nextSize.height - currentLogicalHeight) * scaleFactor) / 2);
    await currentWindow.setResizable(true).catch(() => undefined);
    await currentWindow.setSize(new LogicalSize(nextSize.width, nextSize.height));
    await currentWindow.setPosition(new PhysicalPosition(nextX, nextY));
    await currentWindow.setResizable(false).catch(() => undefined);
  }

  return (
    <div
      className={`petOnlyLayer activity-${activity} ${active ? "active" : "resting"} ${dragging ? "dragging" : ""} ${overlayOpen ? "overlayOpen" : ""} mode-${overlayMode ?? "idle"}`}
      style={dragWindow ? undefined : { transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
    >
      <PetAvatar
        profile={profile}
        asset={asset}
        emotion={emotion}
        size="overlay"
        draggable
        onDoubleClick={handleDoubleClick}
      />
      {renderOverlayPanel()}
      <span className="visuallyHidden">{activityCopy[activity]}</span>
    </div>
  );
}

type TokenProgressRow = {
  id: string;
  label: string;
  value: string;
  accent: TokenUsageSummary["accent"];
  percent: number;
  pending: boolean;
};

function buildTokenProgressRows(summaries: TokenUsageSummary[]): TokenProgressRow[] {
  const rows = summaries
    .filter((summary) => summary.status !== "unconfigured")
    .flatMap((summary) =>
      summary.metrics.map((metric, index) => {
        const percent = typeof metric.percent === "number" ? clampPercent(metric.percent) : 0;
        return {
          id: `${summary.id}-${index}`,
          label: `${summary.label} · ${metric.label}`,
          value: metric.value,
          accent: summary.accent,
          percent,
          pending: typeof metric.percent !== "number",
        };
      }),
    )
    .filter((row) => !row.pending || row.value !== "未配置")
    .slice(0, 6);

  if (rows.length) return rows;

  return [
    {
      id: "token-sync-pending",
      label: "Token",
      value: "等待同步",
      accent: "mint",
      percent: 0,
      pending: true,
    },
  ];
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function revokeLocalMedia(media: LocalMedia | null) {
  if (media?.objectUrl) URL.revokeObjectURL(media.url);
}

function prepareVideoPreview(video: HTMLVideoElement) {
  if (Number.isFinite(video.duration) && video.duration > 45 && video.currentTime < 1) {
    video.currentTime = 30;
  }
  void video.play().catch(() => undefined);
}
