import type { CSSProperties, MouseEventHandler, PointerEventHandler } from "react";
import type { PetEmotion } from "@pet/protocol";
import { PetdexSprite } from "./PetdexSprite";
import { getPetdexTemplate, type PetdexSpriteStateId } from "./petdexCatalog";
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
  const petdexTemplate = profile.appearance === "petdex-sprite" ? getPetdexTemplate(profile.petdexSlug) : null;
  const petdexScale = size === "stage" ? 0.82 : size === "overlay" ? 0.62 : 0.36;

  return (
    <button
      className={`petAvatar petAvatar-${size} species-${profile.species} emotion-${emotion} ${
        petdexTemplate ? "avatarPetdexRig" : customRig ? "avatarLayeredRig" : "avatarProceduralRig"
      }`}
      style={
        {
          "--pet-primary": profile.primaryColor,
          "--pet-accent": profile.accentColor,
          "--petdex-accent": petdexTemplate?.accentColor,
        } as CSSProperties
      }
      type="button"
      aria-label={`${profile.name} 桌面宠物`}
      data-draggable={draggable}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <span className="petGlow" />
      {petdexTemplate ? (
        <PetdexSprite template={petdexTemplate} state={petdexStateForEmotion(emotion)} scale={petdexScale} label={`${profile.name} 的 Petdex 形象`} />
      ) : customRig ? (
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
        <span className="petModel" aria-hidden="true">
          <span className="petModelShadow" />
          <span className="petModelStage">
            <span className="petModelTail">
              <span />
            </span>
            <span className="petModelLeg petModelLegLeft">
              <span />
            </span>
            <span className="petModelLeg petModelLegRight">
              <span />
            </span>
            <span className="petModelTorso">
              <span className="petModelBelly" />
              <span className="petModelChestLight" />
            </span>
            <span className="petModelArm petModelArmLeft">
              <span />
            </span>
            <span className="petModelArm petModelArmRight">
              <span />
            </span>
            <span className="petModelHead">
              <span className="petModelEar petModelEarLeft">
                <span />
              </span>
              <span className="petModelEar petModelEarRight">
                <span />
              </span>
              <span className="petModelFacePlate" />
              <span className="petModelEye petModelEyeLeft" />
              <span className="petModelEye petModelEyeRight" />
              <span className="petModelCheek petModelCheekLeft" />
              <span className="petModelCheek petModelCheekRight" />
              <span className="petModelMuzzle">
                <span className="petModelNose" />
                <span className="petModelMouth" />
              </span>
            </span>
            {profile.accessory !== "none" ? (
              <span className={`petModelAccessory ${profile.accessory}`}>
                <span />
              </span>
            ) : null}
            <span className="petModelSpark petModelSparkOne" />
            <span className="petModelSpark petModelSparkTwo" />
          </span>
        </span>
      )}
    </button>
  );
}

function petdexStateForEmotion(emotion: PetEmotion): PetdexSpriteStateId {
  const states: Record<PetEmotion, PetdexSpriteStateId> = {
    idle: "idle",
    listening: "waiting",
    thinking: "review",
    speaking: "waving",
    celebrating: "jumping",
    needs_attention: "jumping",
  };
  return states[emotion];
}
