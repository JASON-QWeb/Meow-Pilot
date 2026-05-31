import axobotlSprite from "../../assets/petdex/axobotl.webp";
import bobaSprite from "../../assets/petdex/boba.webp";
import byteBunnySprite from "../../assets/petdex/byte-bunny.webp";
import capySprite from "../../assets/petdex/capy.webp";
import chaosspriteDefaultSprite from "../../assets/petdex/chaossprite-default.png";
import clawdSprite from "../../assets/petdex/clawd.webp";
import doraemonSprite from "../../assets/petdex/doraemon.webp";
import ducducSprite from "../../assets/petdex/ducduc.webp";
import eveSprite from "../../assets/petdex/eve.webp";
import fafaSprite from "../../assets/petdex/fafa.webp";
import goldenRetrieverSprite from "../../assets/petdex/golden-retriever.webp";
import luluCapybaraSprite from "../../assets/petdex/lulu-capybara.webp";
import maodieSprite from "../../assets/petdex/maodie.webp";
import mochiSprite from "../../assets/petdex/mochi.webp";
import noirWeblingSprite from "../../assets/petdex/noir-webling.webp";
import periTheOwlSprite from "../../assets/petdex/peri-the-owl.webp";
import skillbitSprite from "../../assets/petdex/skillbit.webp";
import yupiPenguinSprite from "../../assets/petdex/yupi-penguin.webp";

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

export const petdexTemplates: PetdexTemplate[] = [
  {
    slug: "noir-webling",
    displayName: "Noir Webling",
    submittedBy: "local zip",
    sprite: noirWeblingSprite,
    sourceUrl: "/Users/justq/Downloads/noir-webling.zip",
    accentColor: "#9ca3af",
  },
  {
    slug: "doraemon",
    displayName: "Doraemon",
    submittedBy: "local zip",
    sprite: doraemonSprite,
    sourceUrl: "/Users/justq/Downloads/zip.zip",
    accentColor: "#38bdf8",
  },
  {
    slug: "eve",
    displayName: "EVE",
    submittedBy: "local zip",
    sprite: eveSprite,
    sourceUrl: "/Users/justq/Downloads/zip (1).zip",
    accentColor: "#60a5fa",
  },
  {
    slug: "chaossprite-default",
    displayName: "chaossprite",
    submittedBy: "local zip",
    sprite: chaosspriteDefaultSprite,
    sourceUrl: "/Users/justq/Downloads/zip (2).zip",
    accentColor: "#fb7185",
  },
  {
    slug: "yupi-penguin",
    displayName: "Yupi Penguin",
    submittedBy: "local zip",
    sprite: yupiPenguinSprite,
    sourceUrl: "/Users/justq/Downloads/zip (3).zip",
    accentColor: "#60a5fa",
  },
  {
    slug: "capy",
    displayName: "Capy",
    submittedBy: "local zip",
    sprite: capySprite,
    sourceUrl: "/Users/justq/Downloads/zip (4).zip",
    accentColor: "#f59e0b",
  },
  {
    slug: "fafa",
    displayName: "fafa",
    submittedBy: "local zip",
    sprite: fafaSprite,
    sourceUrl: "/Users/justq/Downloads/zip (5).zip",
    accentColor: "#a8a29e",
  },
  {
    slug: "clawd",
    displayName: "Clawd",
    submittedBy: "local zip",
    sprite: clawdSprite,
    sourceUrl: "/Users/justq/Downloads/zip (6).zip",
    accentColor: "#c084fc",
  },
  {
    slug: "ducduc",
    displayName: "ducduc",
    submittedBy: "local zip",
    sprite: ducducSprite,
    sourceUrl: "/Users/justq/Downloads/zip (7).zip",
    accentColor: "#facc15",
  },
  {
    slug: "maodie",
    displayName: "耄耋",
    submittedBy: "local zip",
    sprite: maodieSprite,
    sourceUrl: "/Users/justq/Downloads/zip (8).zip",
    accentColor: "#fb923c",
  },
  {
    slug: "boba",
    displayName: "Boba",
    submittedBy: "railly",
    sprite: bobaSprite,
    sourceUrl: "https://petdex.crafter.run/pets/boba",
    accentColor: "#f7c76b",
  },
  {
    slug: "byte-bunny",
    displayName: "Byte Bunny",
    submittedBy: "railly",
    sprite: byteBunnySprite,
    sourceUrl: "https://petdex.crafter.run/pets/byte-bunny",
    accentColor: "#7dd3fc",
  },
  {
    slug: "lulu-capybara-2",
    displayName: "噜噜",
    submittedBy: "gitcjp",
    sprite: luluCapybaraSprite,
    sourceUrl: "https://petdex.crafter.run/pets/lulu-capybara-2",
    accentColor: "#f4a261",
  },
  {
    slug: "mochi",
    displayName: "Mochi",
    submittedBy: "Aoi",
    sprite: mochiSprite,
    sourceUrl: "https://petdex.crafter.run/pets/mochi",
    accentColor: "#f8b4d9",
  },
  {
    slug: "axobotl",
    displayName: "Axobotl",
    submittedBy: "Joel E.",
    sprite: axobotlSprite,
    sourceUrl: "https://petdex.crafter.run/pets/axobotl",
    accentColor: "#8dd7cf",
  },
  {
    slug: "peri-the-owl",
    displayName: "Peri the Owl",
    submittedBy: "asyncsan",
    sprite: periTheOwlSprite,
    sourceUrl: "https://petdex.crafter.run/pets/peri-the-owl",
    accentColor: "#c4b5fd",
  },
  {
    slug: "golden-retriever",
    displayName: "Golden Retriever",
    submittedBy: "Prem S.",
    sprite: goldenRetrieverSprite,
    sourceUrl: "https://petdex.crafter.run/pets/golden-retriever",
    accentColor: "#fbbf24",
  },
  {
    slug: "skillbit",
    displayName: "Skillbit",
    submittedBy: "Shreyansh S.",
    sprite: skillbitSprite,
    sourceUrl: "https://petdex.crafter.run/pets/skillbit",
    accentColor: "#a7f3d0",
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
