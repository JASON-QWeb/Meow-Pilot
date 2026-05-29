export type PetSpecies = "qbot-fox" | "nori-cat" | "momo-blob" | "luma-star";

export type PetAccessory = "none" | "bow" | "bell";

export type PetAppearance = "classic" | "layered-image";

export type PetArtStyle = "natural" | "sticker" | "pixel";

export type PetMotionStyle = "bounce" | "curious" | "calm";

export type PetRigLayerId = "feet" | "body" | "head";

export type PetRigSettings = {
  removeBackground: boolean;
  backgroundThreshold: number;
  frameScale: number;
  frameOffsetX: number;
  frameOffsetY: number;
  headSplit: number;
  feetSplit: number;
  headOffsetX: number;
  headOffsetY: number;
  artStyle: PetArtStyle;
  motionStyle: PetMotionStyle;
};

export type PetRigLayer = {
  id: PetRigLayerId;
  label: string;
  imageDataUrl: string;
  offsetX: number;
  offsetY: number;
};

export type PetRigAsset = {
  id: string;
  sourceName: string;
  sourceDataUrl: string;
  sourceHasTransparency: boolean;
  previewDataUrl: string;
  layers: PetRigLayer[];
  settings: PetRigSettings;
  createdAt: string;
  updatedAt: string;
};

export type PetProfile = {
  name: string;
  species: PetSpecies;
  primaryColor: string;
  accentColor: string;
  accessory: PetAccessory;
  appearance?: PetAppearance;
  assetId?: string;
};

export type PetPosition = {
  x: number;
  y: number;
};

export const defaultPetProfile: PetProfile = {
  name: "BabyQ",
  species: "qbot-fox",
  primaryColor: "#8b5cf6",
  accentColor: "#f04fd8",
  accessory: "none",
  appearance: "classic",
};

export const defaultPetPosition: PetPosition = {
  x: 48,
  y: 96,
};

export const speciesOptions: Array<{ value: PetSpecies; label: string }> = [
  { value: "qbot-fox", label: "QBot 狐猫" },
  { value: "nori-cat", label: "糯糯猫" },
  { value: "momo-blob", label: "团子形" },
  { value: "luma-star", label: "星星形" },
];

export const accessoryOptions: Array<{ value: PetAccessory; label: string }> = [
  { value: "none", label: "无" },
  { value: "bow", label: "蝴蝶结" },
  { value: "bell", label: "小铃铛" },
];

export const paletteOptions = [
  { label: "QBot", primaryColor: "#8b5cf6", accentColor: "#f04fd8" },
  { label: "薄荷", primaryColor: "#f7fbf8", accentColor: "#d5ebe5" },
  { label: "天空", primaryColor: "#f8fbff", accentColor: "#cfe1ff" },
  { label: "蜜桃", primaryColor: "#fff8f4", accentColor: "#ffd4c4" },
  { label: "丁香", primaryColor: "#fbf8ff", accentColor: "#ddd4ff" },
  { label: "柑橘", primaryColor: "#fffdf4", accentColor: "#ffe08a" },
];

export const defaultRigSettings: PetRigSettings = {
  removeBackground: true,
  backgroundThreshold: 46,
  frameScale: 100,
  frameOffsetX: 0,
  frameOffsetY: 0,
  headSplit: 44,
  feetSplit: 76,
  headOffsetX: 0,
  headOffsetY: 0,
  artStyle: "sticker",
  motionStyle: "bounce",
};
