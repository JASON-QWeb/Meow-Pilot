import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { PetActivity, PetEmotion } from "@pet/protocol";
import { PetAvatar } from "./PetAvatar";
import type { PetPosition, PetProfile, PetRigAsset } from "./petProfile";

type DraggablePetOverlayProps = {
  profile: PetProfile;
  asset: PetRigAsset | null;
  emotion: PetEmotion;
  activity: PetActivity;
  active: boolean;
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

export function DraggablePetOverlay({ profile, asset, emotion, activity, active, position, onPositionChange, onOpenWork, dragWindow = false }: DraggablePetOverlayProps) {
  const dragRef = useRef<DragState | null>(null);
  const frameRef = useRef<number | null>(null);
  const pendingWindowPositionRef = useRef<PhysicalPosition | null>(null);

  useEffect(() => {
    return () => {
      window.removeEventListener("mousemove", handleGlobalMouseMove);
      window.removeEventListener("mouseup", handleGlobalMouseUp);
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

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

    if (!drag.moved) {
      onOpenWork();
    }
  }

  function handleDoubleClick(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    onOpenWork();
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

  return (
    <div
      className={`petOnlyLayer activity-${activity} ${active ? "active" : "resting"}`}
      style={dragWindow ? undefined : { transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}
      onMouseDown={handleMouseDown}
    >
      <PetAvatar
        profile={profile}
        asset={asset}
        emotion={emotion}
        size="overlay"
        draggable
        onDoubleClick={handleDoubleClick}
      />
      <span className="visuallyHidden">{activityCopy[activity]}</span>
    </div>
  );
}
