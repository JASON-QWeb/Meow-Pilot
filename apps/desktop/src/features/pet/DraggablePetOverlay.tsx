import { useRef, type PointerEvent } from "react";
import type { PetEmotion } from "@pet/protocol";
import { PetAvatar } from "./PetAvatar";
import type { PetPosition, PetProfile, PetRigAsset } from "./petProfile";

type DraggablePetOverlayProps = {
  profile: PetProfile;
  asset: PetRigAsset | null;
  emotion: PetEmotion;
  position: PetPosition;
  onPositionChange: (position: PetPosition) => void;
  onOpenChat: () => void;
};

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
};

export function DraggablePetOverlay({ profile, asset, emotion, position, onPositionChange, onOpenChat }: DraggablePetOverlayProps) {
  const dragRef = useRef<DragState | null>(null);

  function clamp(nextX: number, nextY: number): PetPosition {
    const width = 150;
    const height = 150;
    return {
      x: Math.max(8, Math.min(window.innerWidth - width, nextX)),
      y: Math.max(8, Math.min(window.innerHeight - height, nextY)),
    };
  }

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
      moved: false,
    };
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 5) {
      drag.moved = true;
    }

    onPositionChange(clamp(drag.originX + deltaX, drag.originY + deltaY));
  }

  function handlePointerUp(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;

    if (!drag.moved) {
      onOpenChat();
    }
  }

  return (
    <div className="petOnlyLayer" style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}>
      <PetAvatar
        profile={profile}
        asset={asset}
        emotion={emotion}
        size="overlay"
        draggable
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
    </div>
  );
}
