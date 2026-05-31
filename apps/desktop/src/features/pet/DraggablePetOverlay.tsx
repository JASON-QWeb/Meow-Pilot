import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { PetActivity, PetEmotion, TokenUsageSummary } from "@pet/protocol";
import { PetAvatar } from "./PetAvatar";
import type { PetPosition, PetProfile, PetRigAsset } from "./petProfile";

type DraggablePetOverlayProps = {
  profile: PetProfile;
  asset: PetRigAsset | null;
  emotion: PetEmotion;
  activity: PetActivity;
  active: boolean;
  tokenUsage: TokenUsageSummary[];
  position: PetPosition;
  onPositionChange: (position: PetPosition) => void;
  onOpenWork: () => void;
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

const activityCopy: Record<PetActivity, string> = {
  coding: "编码中",
  research: "查资料",
  exercise: "活动中",
  sleeping: "休息中",
};
const collapsedWindowSize = { width: 180, height: 180 };
const expandedWindowSize = { width: 420, height: 380 };

export function DraggablePetOverlay({
  profile,
  asset,
  emotion,
  activity,
  active,
  tokenUsage,
  position,
  onPositionChange,
  onOpenWork,
  dragWindow = false,
}: DraggablePetOverlayProps) {
  const dragRef = useRef<DragState | null>(null);
  const frameRef = useRef<number | null>(null);
  const pendingWindowPositionRef = useRef<PhysicalPosition | null>(null);
  const [dragging, setDragging] = useState(false);
  const [tokenBoardOpen, setTokenBoardOpen] = useState(false);
  const tokenRows = buildTokenProgressRows(tokenUsage);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setTokenBoardOpen(false);
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
    void resizePetWindow(tokenBoardOpen).catch(() => undefined);
  }, [dragWindow, tokenBoardOpen]);

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
    setTokenBoardOpen((current) => !current);
  }

  function stopOverlayControl(event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
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
    const [position, size] = await Promise.all([currentWindow.outerPosition(), currentWindow.outerSize()]);

    if (size.width === nextSize.width && size.height === nextSize.height) return;

    const nextX = position.x - Math.round((nextSize.width - size.width) / 2);
    const nextY = position.y - Math.round((nextSize.height - size.height) / 2);
    await currentWindow.setSize(new PhysicalSize(nextSize.width, nextSize.height));
    await currentWindow.setPosition(new PhysicalPosition(nextX, nextY));
  }

  return (
    <div
      className={`petOnlyLayer activity-${activity} ${active ? "active" : "resting"} ${dragging ? "dragging" : ""} ${tokenBoardOpen ? "tokenBoardOpen" : ""}`}
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
      {tokenBoardOpen ? (
        <aside className="petTokenBoard" aria-label="Token 进度条" onMouseDown={stopOverlayControl} onClick={(event) => event.stopPropagation()}>
          <header>
            <div>
              <strong>Token 进度</strong>
              <p>{tokenRows.length} 条额度</p>
            </div>
            <button
              type="button"
              aria-label="关闭 Token 进度"
              onClick={(event) => {
                stopOverlayControl(event);
                setTokenBoardOpen(false);
              }}
            >
              ×
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
      ) : null}
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
