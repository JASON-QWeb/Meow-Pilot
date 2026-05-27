import type { CSSProperties, PointerEventHandler } from "react";
import type { PetEmotion } from "@pet/protocol";
import type { PetProfile, PetRigAsset } from "./petProfile";

type PetAvatarProps = {
  profile: PetProfile;
  asset?: PetRigAsset | null;
  emotion: PetEmotion;
  size?: "stage" | "overlay" | "scene";
  draggable?: boolean;
  onClick?: () => void;
  onPointerDown?: PointerEventHandler<HTMLButtonElement>;
  onPointerMove?: PointerEventHandler<HTMLButtonElement>;
  onPointerUp?: PointerEventHandler<HTMLButtonElement>;
};

export function PetAvatar({ profile, asset, emotion, size = "stage", draggable = false, onClick, onPointerDown, onPointerMove, onPointerUp }: PetAvatarProps) {
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
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
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
