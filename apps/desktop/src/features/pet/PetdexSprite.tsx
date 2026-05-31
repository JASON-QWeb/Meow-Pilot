import type { CSSProperties } from "react";
import { petdexSpriteStates, type PetdexSpriteStateId, type PetdexTemplate } from "./petdexCatalog";

type PetdexSpriteProps = {
  template: PetdexTemplate;
  state?: PetdexSpriteStateId;
  scale?: number;
  animated?: boolean;
  className?: string;
  label?: string;
};

export function PetdexSprite({ template, state = "idle", scale = 1, animated = true, className = "", label }: PetdexSpriteProps) {
  const spriteState = petdexSpriteStates[state] ?? petdexSpriteStates.idle;
  const spriteImage = `url("${template.sprite.replace(/"/g, '\\"')}")`;

  return (
    <span
      className={`petdexSpriteFrame ${className}`}
      role="img"
      aria-label={label ?? `${template.displayName} Petdex sprite`}
      style={{ "--petdex-scale": scale, "--petdex-accent": template.accentColor } as CSSProperties}
    >
      <span
        className={animated ? "petdexSprite" : "petdexSpriteStatic"}
        style={
          {
            backgroundImage: spriteImage,
            backgroundPosition: animated ? undefined : `0 ${spriteState.row * -208}px`,
            "--sprite-row": spriteState.row,
            "--sprite-frames": spriteState.frames,
            "--sprite-duration": `${spriteState.durationMs}ms`,
          } as CSSProperties
        }
      />
    </span>
  );
}
