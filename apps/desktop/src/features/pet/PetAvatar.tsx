import type { CSSProperties, MouseEventHandler, PointerEventHandler } from "react";
import type { PetEmotion } from "@pet/protocol";
import qbotMascotUrl from "../../assets/qbot-mascot.png";
import type { PetProfile, PetRigAsset } from "./petProfile";

type PetAvatarProps = {
  profile: PetProfile;
  asset?: PetRigAsset | null;
  emotion: PetEmotion;
  size?: "stage" | "overlay" | "scene";
  draggable?: boolean;
  onClick?: () => void;
  onDoubleClick?: MouseEventHandler<HTMLButtonElement>;
  onPointerDown?: PointerEventHandler<HTMLButtonElement>;
  onPointerMove?: PointerEventHandler<HTMLButtonElement>;
  onPointerUp?: PointerEventHandler<HTMLButtonElement>;
  onPointerCancel?: PointerEventHandler<HTMLButtonElement>;
};

export function PetAvatar({
  profile,
  asset,
  emotion,
  size = "stage",
  draggable = false,
  onClick,
  onDoubleClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: PetAvatarProps) {
  const customRig = profile.appearance === "layered-image" && asset;

  return (
    <button
      className={`petAvatar petAvatar-${size} species-${profile.species} emotion-${emotion}`}
      style={
        {
          "--pet-primary": profile.primaryColor,
          "--pet-accent": profile.accentColor,
        } as CSSProperties
      }
      type="button"
      aria-label={`${profile.name} desktop pet`}
      data-draggable={draggable}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <span className="petGlow" />
      {customRig ? (
        <span className={`petRig motion-${asset.settings.motionStyle}`}>
          {asset.layers.map((layer) => (
            <span
              className={`petRigLayer layer-${layer.id}`}
              style={{ "--layer-x": `${layer.offsetX}px`, "--layer-y": `${layer.offsetY}px` } as CSSProperties}
              key={layer.id}
            >
              <img src={layer.imageDataUrl} alt="" draggable={false} />
            </span>
          ))}
        </span>
      ) : profile.species === "qbot-fox" || profile.appearance === "classic" ? (
        <span className="petMascot">
          <img className="petMascotImage" src={qbotMascotUrl} alt="" draggable={false} />
        </span>
      ) : (
        <span className="petBody">
          <span className="petEar left" />
          <span className="petEar right" />
          {profile.accessory !== "none" ? <span className={`petAccessory ${profile.accessory}`} /> : null}
          <span className="petFace">
            <span className="petEye left" />
            <span className="petEye right" />
            <span className="petMouth" />
          </span>
        </span>
      )}
    </button>
  );
}
