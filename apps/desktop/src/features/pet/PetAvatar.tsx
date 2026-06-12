import type { CSSProperties, MouseEventHandler, PointerEventHandler } from "react";
import type { PetEmotion } from "@pet/protocol";
import { PetdexSprite } from "./PetdexSprite";
import { getPetdexTemplate, type PetdexSpriteStateId, type PetdexTemplate } from "./petdexCatalog";
import type { PetProfile, PetRigAsset } from "./petProfile";

type PetAvatarProps = {
  profile: PetProfile;
  asset?: PetRigAsset | null;
  emotion: PetEmotion;
  size?: "stage" | "overlay" | "scene";
  draggable?: boolean;
  spriteStateOverride?: PetdexSpriteStateId | null;
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
  spriteStateOverride,
  onClick,
  onDoubleClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: PetAvatarProps) {
  const customRig = profile.appearance === "layered-image" ? asset : null;
  const petdexTemplate = profile.appearance === "petdex-sprite" ? getPetdexTemplate(profile.petdexSlug) : null;
  const customSpriteTemplate = customRig?.actionSpritesheet ? customPetdexTemplate(customRig, profile.accentColor) : null;
  const spriteTemplate = petdexTemplate ?? customSpriteTemplate;
  const petdexScale = size === "stage" ? 0.82 : size === "overlay" ? 0.62 : 0.36;

  return (
    <button
      className={`petAvatar petAvatar-${size} species-${profile.species} emotion-${emotion} ${
        spriteTemplate ? `avatarPetdexRig ${customSpriteTemplate ? "avatarCustomActionRig" : ""}` : customRig ? "avatarLayeredRig" : "avatarProceduralRig"
      }`}
      style={
        {
          "--pet-primary": profile.primaryColor,
          "--pet-accent": profile.accentColor,
          "--petdex-accent": spriteTemplate?.accentColor,
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
      {spriteTemplate ? (
        <PetdexSprite
          template={spriteTemplate}
          state={spriteStateOverride ?? petdexStateForEmotion(emotion)}
          scale={petdexScale}
          className={customSpriteTemplate ? "customActionSpriteFrame" : ""}
          label={`${profile.name} 的 Petdex 形象`}
        />
      ) : customRig ? (
        <span className={`petRig motion-${customRig.settings.motionStyle}`}>
          {customRig.layers.map((layer) => (
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

function customPetdexTemplate(asset: PetRigAsset, accentColor: string): PetdexTemplate | null {
  if (!asset.actionSpritesheet) return null;
  return {
    slug: asset.id,
    displayName: asset.sourceName.replace(/\.[^.]+$/, "") || "自定义宠物",
    submittedBy: "local image",
    sprite: asset.actionSpritesheet.dataUrl,
    sourceUrl: "local-image",
    accentColor,
  };
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
