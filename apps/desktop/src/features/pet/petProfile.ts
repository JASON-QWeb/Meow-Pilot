export type PetSpecies = "nori-cat" | "momo-blob" | "luma-star";

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
  name: "Nori",
  species: "nori-cat",
  primaryColor: "#f7fbf8",
  accentColor: "#d5ebe5",
  accessory: "bell",
  appearance: "classic",
};

export const defaultPetPosition: PetPosition = {
  x: 48,
  y: 96,
};

export const speciesOptions: Array<{ value: PetSpecies; label: string }> = [
  { value: "nori-cat", label: "Nori cat" },
  { value: "momo-blob", label: "Momo blob" },
  { value: "luma-star", label: "Luma star" },
];

export const accessoryOptions: Array<{ value: PetAccessory; label: string }> = [
  { value: "none", label: "None" },
  { value: "bow", label: "Bow" },
  { value: "bell", label: "Bell" },
];

export const paletteOptions = [
  { label: "Mint", primaryColor: "#f7fbf8", accentColor: "#d5ebe5" },
  { label: "Sky", primaryColor: "#f8fbff", accentColor: "#cfe1ff" },
  { label: "Peach", primaryColor: "#fff8f4", accentColor: "#ffd4c4" },
  { label: "Lilac", primaryColor: "#fbf8ff", accentColor: "#ddd4ff" },
  { label: "Citrus", primaryColor: "#fffdf4", accentColor: "#ffe08a" },
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
