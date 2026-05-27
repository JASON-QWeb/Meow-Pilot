import { defaultRigSettings, type PetRigAsset, type PetRigLayer, type PetRigSettings } from "./petProfile";

const CANVAS_SIZE = 512;
const CONTENT_SIZE = 442;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export type PetImageSource = {
  name: string;
  dataUrl: string;
  hasTransparency: boolean;
};

export async function readPetImage(file: File): Promise<PetImageSource> {
  if (!file.type.startsWith("image/")) {
    throw new Error("请选择 JPG、PNG 或 WebP 图片。");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("图片大小不能超过 15 MB。");
  }

  const sourceDataUrl = await blobToDataUrl(file);
  const image = await loadImage(sourceDataUrl);
  const sourceHasTransparency = hasImageTransparency(image);
  const canvas = createCanvas();
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法处理图片。");

  context.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  const ratio = Math.min(CONTENT_SIZE / image.width, CONTENT_SIZE / image.height);
  const width = image.width * ratio;
  const height = image.height * ratio;
  context.drawImage(image, (CANVAS_SIZE - width) / 2, (CANVAS_SIZE - height) / 2, width, height);

  return {
    name: file.name,
    dataUrl: canvas.toDataURL("image/png"),
    hasTransparency: sourceHasTransparency,
  };
}

export async function createPetRig(source: PetImageSource, settings: PetRigSettings, existingId?: string): Promise<PetRigAsset> {
  const image = await loadImage(source.dataUrl);
  const foreground = createCanvas();
  const foregroundContext = foreground.getContext("2d");
  if (!foregroundContext) throw new Error("无法生成宠物拆件。");
  foregroundContext.translate(CANVAS_SIZE / 2 + settings.frameOffsetX, CANVAS_SIZE / 2 + settings.frameOffsetY);
  foregroundContext.scale(settings.frameScale / 100, settings.frameScale / 100);
  foregroundContext.drawImage(image, -CANVAS_SIZE / 2, -CANVAS_SIZE / 2, CANVAS_SIZE, CANVAS_SIZE);
  foregroundContext.setTransform(1, 0, 0, 1, 0, 0);

  if (settings.removeBackground && !source.hasTransparency) {
    removeFlatBackground(foregroundContext, settings.backgroundThreshold);
  }

  const styled = applyStyle(foreground, settings.artStyle);
  const layers = makeLayers(styled, settings);
  const now = new Date().toISOString();

  return {
    id: existingId ?? `rig_${crypto.randomUUID()}`,
    sourceName: source.name,
    sourceDataUrl: source.dataUrl,
    sourceHasTransparency: source.hasTransparency,
    previewDataUrl: styled.toDataURL("image/png"),
    layers,
    settings,
    createdAt: now,
    updatedAt: now,
  };
}

export function restoreRigSource(asset: PetRigAsset): PetImageSource {
  return {
    name: asset.sourceName,
    dataUrl: asset.sourceDataUrl,
    hasTransparency: asset.sourceHasTransparency ?? false,
  };
}

export function rigSettings(asset?: PetRigAsset | null) {
  return { ...defaultRigSettings, ...asset?.settings };
}

function makeLayers(canvas: HTMLCanvasElement, settings: PetRigSettings): PetRigLayer[] {
  const headEdge = Math.round((settings.headSplit / 100) * CANVAS_SIZE);
  const feetEdge = Math.round((settings.feetSplit / 100) * CANVAS_SIZE);
  return [
    {
      id: "feet",
      label: "脚部 / 底层",
      imageDataUrl: maskRows(canvas, feetEdge - 7, CANVAS_SIZE).toDataURL("image/png"),
      offsetX: 0,
      offsetY: 0,
    },
    {
      id: "body",
      label: "身体 / 中层",
      imageDataUrl: maskRows(canvas, headEdge - 6, feetEdge + 6).toDataURL("image/png"),
      offsetX: 0,
      offsetY: 0,
    },
    {
      id: "head",
      label: "头部 / 表情层",
      imageDataUrl: maskRows(canvas, 0, headEdge + 6).toDataURL("image/png"),
      offsetX: settings.headOffsetX,
      offsetY: settings.headOffsetY,
    },
  ];
}

function maskRows(source: HTMLCanvasElement, minY: number, maxY: number) {
  const canvas = createCanvas();
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  context.drawImage(source, 0, 0);
  context.globalCompositeOperation = "destination-in";
  context.fillStyle = "#000";
  context.fillRect(0, Math.max(0, minY), CANVAS_SIZE, Math.min(CANVAS_SIZE, maxY) - Math.max(0, minY));
  context.globalCompositeOperation = "source-over";
  return canvas;
}

function applyStyle(foreground: HTMLCanvasElement, style: PetRigSettings["artStyle"]) {
  if (style === "pixel") {
    const small = document.createElement("canvas");
    small.width = 96;
    small.height = 96;
    const smallContext = small.getContext("2d");
    const output = createCanvas();
    const outputContext = output.getContext("2d");
    if (!smallContext || !outputContext) return foreground;
    smallContext.imageSmoothingEnabled = false;
    smallContext.drawImage(foreground, 0, 0, small.width, small.height);
    outputContext.imageSmoothingEnabled = false;
    outputContext.drawImage(small, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
    return output;
  }

  if (style !== "sticker") return foreground;

  const silhouette = createCanvas();
  const silhouetteContext = silhouette.getContext("2d");
  const output = createCanvas();
  const outputContext = output.getContext("2d");
  if (!silhouetteContext || !outputContext) return foreground;

  const radius = 7;
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 10) {
    silhouetteContext.drawImage(foreground, Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  silhouetteContext.globalCompositeOperation = "source-in";
  silhouetteContext.fillStyle = "#ffffff";
  silhouetteContext.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  outputContext.drawImage(silhouette, 0, 0);
  outputContext.drawImage(foreground, 0, 0);
  return output;
}

function removeFlatBackground(context: CanvasRenderingContext2D, threshold: number) {
  const image = context.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  const samples = collectBorderColors(image.data);
  const softEdge = 34;

  for (let offset = 0; offset < image.data.length; offset += 4) {
    const alpha = image.data[offset + 3] ?? 0;
    if (alpha === 0) continue;

    const distance = nearestColorDistance(image.data, offset, samples);
    const matte = Math.min(1, Math.max(0, (distance - threshold) / softEdge));
    image.data[offset + 3] = Math.round(alpha * matte);
  }
  context.putImageData(image, 0, 0);
}

function collectBorderColors(data: Uint8ClampedArray) {
  const bounds = opaqueBounds(data);
  if (!bounds) return [[255, 255, 255] satisfies [number, number, number]];

  const colors: Array<[number, number, number]> = [];
  const increments = 8;
  for (let index = 0; index <= increments; index += 1) {
    const x = Math.round(bounds.minX + ((bounds.maxX - bounds.minX) * index) / increments);
    const y = Math.round(bounds.minY + ((bounds.maxY - bounds.minY) * index) / increments);
    colors.push(readColor(data, x, bounds.minY), readColor(data, x, bounds.maxY));
    colors.push(readColor(data, bounds.minX, y), readColor(data, bounds.maxX, y));
  }
  return colors;
}

function opaqueBounds(data: Uint8ClampedArray) {
  let minX = CANVAS_SIZE;
  let minY = CANVAS_SIZE;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < CANVAS_SIZE; y += 1) {
    for (let x = 0; x < CANVAS_SIZE; x += 1) {
      const alpha = data[(y * CANVAS_SIZE + x) * 4 + 3] ?? 0;
      if (alpha === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) return null;
  return { minX, minY, maxX, maxY };
}

function readColor(data: Uint8ClampedArray, x: number, y: number): [number, number, number] {
  const offset = (y * CANVAS_SIZE + x) * 4;
  return [data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0];
}

function nearestColorDistance(data: Uint8ClampedArray, offset: number, colors: Array<[number, number, number]>) {
  const red = data[offset] ?? 0;
  const green = data[offset + 1] ?? 0;
  const blue = data[offset + 2] ?? 0;
  return colors.reduce((distance, color) => {
    const next = Math.sqrt((red - color[0]) ** 2 + (green - color[1]) ** 2 + (blue - color[2]) ** 2);
    return Math.min(distance, next);
  }, Number.POSITIVE_INFINITY);
}

function createCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  return canvas;
}

function hasImageTransparency(image: HTMLImageElement) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(image.naturalWidth || image.width, CANVAS_SIZE);
  canvas.height = Math.min(image.naturalHeight || image.height, CANVAS_SIZE);
  const context = canvas.getContext("2d");
  if (!context) return false;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let index = 3; index < pixels.length; index += 4) {
    if ((pixels[index] ?? 255) < 250) return true;
  }
  return false;
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => reject(new Error("无法读取图片。")));
    image.src = dataUrl;
  });
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("无法读取图片。"));
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("无法读取图片。")));
    reader.readAsDataURL(blob);
  });
}
