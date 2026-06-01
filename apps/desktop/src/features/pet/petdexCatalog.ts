import chaosspriteDefaultSprite from "../../assets/petdex/chaossprite-default.png";
import noirWeblingSprite from "../../assets/petdex/noir-webling.webp";

export type PetdexTemplate = {
  slug: string;
  displayName: string;
  submittedBy: string;
  sprite: string;
  sourceUrl: string;
  accentColor: string;
};

export type PetdexSpriteStateId =
  | "idle"
  | "running-right"
  | "running-left"
  | "waving"
  | "jumping"
  | "failed"
  | "waiting"
  | "running"
  | "review";

export type PetdexSpriteState = {
  id: PetdexSpriteStateId;
  row: number;
  frames: number;
  durationMs: number;
};

export const petdexSpriteStates: Record<PetdexSpriteStateId, PetdexSpriteState> = {
  idle: { id: "idle", row: 0, frames: 6, durationMs: 1100 },
  "running-right": { id: "running-right", row: 1, frames: 8, durationMs: 1060 },
  "running-left": { id: "running-left", row: 2, frames: 8, durationMs: 1060 },
  waving: { id: "waving", row: 3, frames: 4, durationMs: 700 },
  jumping: { id: "jumping", row: 4, frames: 5, durationMs: 840 },
  failed: { id: "failed", row: 5, frames: 8, durationMs: 1220 },
  waiting: { id: "waiting", row: 6, frames: 6, durationMs: 1010 },
  running: { id: "running", row: 7, frames: 6, durationMs: 820 },
  review: { id: "review", row: 8, frames: 6, durationMs: 1030 },
};

const projectPetdexSource = (fileName: string) => `project:apps/desktop/src/assets/petdex/${fileName}`;

export const petdexTemplates: PetdexTemplate[] = [
  {
    slug: "noir-webling",
    displayName: "Noir Webling",
    submittedBy: "Petdex",
    sprite: noirWeblingSprite,
    sourceUrl: projectPetdexSource("noir-webling.webp"),
    accentColor: "#9ca3af",
  },
  {
    slug: "chaossprite-default",
    displayName: "chaossprite",
    submittedBy: "Petdex",
    sprite: chaosspriteDefaultSprite,
    sourceUrl: projectPetdexSource("chaossprite-default.png"),
    accentColor: "#fb7185",
  },
];

export const defaultPetdexTemplate = petdexTemplates[0]!;
export const friendPetdexTemplates = petdexTemplates.filter((template) => template.slug !== defaultPetdexTemplate.slug);

export function getPetdexTemplate(slug?: string) {
  return petdexTemplates.find((template) => template.slug === slug) ?? defaultPetdexTemplate;
}

export function pickPetdexTemplate(seed: string | number) {
  return pickTemplateFrom(seed, petdexTemplates);
}

export function pickFriendPetdexTemplate(seed: string | number) {
  return pickTemplateFrom(seed, friendPetdexTemplates);
}

function pickTemplateFrom(seed: string | number, templates: PetdexTemplate[]) {
  const value = String(seed);
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return templates[hash % templates.length] ?? defaultPetdexTemplate;
}
