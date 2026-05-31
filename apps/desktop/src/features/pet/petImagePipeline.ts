import { defaultRigSettings, type PetActionSpritesheet, type PetRigAsset, type PetRigLayer, type PetRigLayerId, type PetRigSettings } from "./petProfile";

const CANVAS_SIZE = 512;
const CONTENT_SIZE = 442;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const ACTION_FRAME_WIDTH = 192;
const ACTION_FRAME_HEIGHT = 208;
const ACTION_COLUMNS = 8;
const ACTION_ROWS = 9;
const ACTION_RENDER_SIZE = 176;
const ACTION_RENDER_TOP = 18;

type PetRigLayerCanvas = PetRigLayer & {
  canvas: HTMLCanvasElement;
};

type LayerPose = {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
};

type FramePose = {
  x: number;
  y: number;
  flipX: boolean;
  layers: Partial<Record<PetRigLayerId, Partial<LayerPose>>>;
};

type ActionDefinition = {
  row: number;
  frames: number;
  pose: (phase: number) => FramePose;
};

const rigLayerOrder = ["feet", "body", "head"] satisfies PetRigLayerId[];

export type PetImageSource = {
  name: string;
  dataUrl: string;
  hasTransparency: boolean;
};

export async function readPetImage(file: File): Promise<PetImageSource> {
  const sourceDataUrl = await readPetImageFileDataUrl(file);
  return readPetImageDataUrl(file.name, sourceDataUrl);
}

export async function readPetImageFileDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("请选择 JPG、PNG 或 WebP 图片。");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("图片大小不能超过 15 MB。");
  }

  return blobToDataUrl(file);
}

export async function readPetImageDataUrl(name: string, dataUrl: string): Promise<PetImageSource> {
  const image = await loadImage(dataUrl);
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
    name,
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

  const originalForeground = cloneCanvas(foreground);
  const originalStats = alphaStats(originalForeground);
  if (settings.removeBackground && !source.hasTransparency) {
    removeFlatBackground(foregroundContext, settings.backgroundThreshold);
    if (foregroundLooksBroken(alphaStats(foreground), originalStats)) {
      foregroundContext.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      foregroundContext.drawImage(originalForeground, 0, 0);
    }
  }

  const now = new Date().toISOString();
  const normalized = normalizeForeground(foreground);
  const styled = applyStyle(normalized, settings.artStyle);
  const layerCanvases = makeLayerCanvases(styled, settings);
  const layers = layerCanvases.map(({ canvas: _canvas, ...layer }) => layer);
  const actionSpritesheet = createActionSpritesheet(layerCanvases);

  return {
    id: existingId ?? `rig_${crypto.randomUUID()}`,
    sourceName: source.name,
    sourceDataUrl: source.dataUrl,
    sourceHasTransparency: source.hasTransparency,
    previewDataUrl: styled.toDataURL("image/png"),
    layers,
    actionSpritesheet,
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

function makeLayerCanvases(canvas: HTMLCanvasElement, settings: PetRigSettings): PetRigLayerCanvas[] {
  if (!settings.removeBackground) {
    const blankFeet = createCanvas();
    const blankHead = createCanvas();
    const bodyCanvas = cloneCanvas(canvas);
    return [
      {
        id: "feet",
        label: "底部 / 占位层",
        canvas: blankFeet,
        imageDataUrl: blankFeet.toDataURL("image/png"),
        offsetX: 0,
        offsetY: 0,
      },
      {
        id: "body",
        label: "完整图片 / 主层",
        canvas: bodyCanvas,
        imageDataUrl: bodyCanvas.toDataURL("image/png"),
        offsetX: 0,
        offsetY: 0,
      },
      {
        id: "head",
        label: "头部 / 占位层",
        canvas: blankHead,
        imageDataUrl: blankHead.toDataURL("image/png"),
        offsetX: 0,
        offsetY: 0,
      },
    ];
  }

  const headEdge = Math.round((settings.headSplit / 100) * CANVAS_SIZE);
  const feetEdge = Math.round((settings.feetSplit / 100) * CANVAS_SIZE);
  const feetCanvas = maskRows(canvas, feetEdge - 7, CANVAS_SIZE);
  const bodyCanvas = maskRows(canvas, headEdge - 6, feetEdge + 6);
  const headCanvas = maskRows(canvas, 0, headEdge + 6);
  return [
    {
      id: "feet",
      label: "脚部 / 底层",
      canvas: feetCanvas,
      imageDataUrl: feetCanvas.toDataURL("image/png"),
      offsetX: 0,
      offsetY: 0,
    },
    {
      id: "body",
      label: "身体 / 中层",
      canvas: bodyCanvas,
      imageDataUrl: bodyCanvas.toDataURL("image/png"),
      offsetX: 0,
      offsetY: 0,
    },
    {
      id: "head",
      label: "头部 / 表情层",
      canvas: headCanvas,
      imageDataUrl: headCanvas.toDataURL("image/png"),
      offsetX: settings.headOffsetX,
      offsetY: settings.headOffsetY,
    },
  ];
}

function createActionSpritesheet(layers: PetRigLayerCanvas[]): PetActionSpritesheet {
  const sheet = document.createElement("canvas");
  sheet.width = ACTION_FRAME_WIDTH * ACTION_COLUMNS;
  sheet.height = ACTION_FRAME_HEIGHT * ACTION_ROWS;
  const context = sheet.getContext("2d");
  if (!context) throw new Error("无法生成宠物动作图集。");

  for (const action of actionDefinitions) {
    for (let column = 0; column < ACTION_COLUMNS; column += 1) {
      const phase = (column % action.frames) / action.frames;
      context.save();
      context.translate(column * ACTION_FRAME_WIDTH, action.row * ACTION_FRAME_HEIGHT);
      drawActionFrame(context, layers, action.pose(phase));
      context.restore();
    }
  }

  const dataUrl = sheet.toDataURL("image/webp", 0.92);
  return {
    format: "petdex-8x9",
    dataUrl,
    mimeType: dataUrl.startsWith("data:image/webp") ? "image/webp" : "image/png",
    frameWidth: ACTION_FRAME_WIDTH,
    frameHeight: ACTION_FRAME_HEIGHT,
    columns: ACTION_COLUMNS,
    rows: ACTION_ROWS,
  };
}

const actionDefinitions: ActionDefinition[] = [
  { row: 0, frames: 6, pose: idlePose },
  { row: 1, frames: 8, pose: (phase) => runningPose(phase, false) },
  { row: 2, frames: 8, pose: (phase) => runningPose(phase, true) },
  { row: 3, frames: 4, pose: wavingPose },
  { row: 4, frames: 5, pose: jumpingPose },
  { row: 5, frames: 8, pose: failedPose },
  { row: 6, frames: 6, pose: waitingPose },
  { row: 7, frames: 6, pose: (phase) => runningPose(phase, false, true) },
  { row: 8, frames: 6, pose: reviewPose },
];

function drawActionFrame(context: CanvasRenderingContext2D, layers: PetRigLayerCanvas[], pose: FramePose) {
  for (const layerId of rigLayerOrder) {
    const layer = layers.find((item) => item.id === layerId);
    if (layer) drawRigLayer(context, layer, pose, pose.layers[layer.id] ?? {});
  }
}

function drawRigLayer(context: CanvasRenderingContext2D, layer: PetRigLayerCanvas, framePose: FramePose, layerPose: Partial<LayerPose>) {
  const scale = ACTION_RENDER_SIZE / CANVAS_SIZE;
  const motion = {
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    ...layerPose,
  };

  context.save();
  context.translate(ACTION_FRAME_WIDTH / 2 + framePose.x, ACTION_RENDER_TOP + ACTION_RENDER_SIZE / 2 + framePose.y);
  if (framePose.flipX) context.scale(-1, 1);
  context.translate((layer.offsetX + motion.x) * scale, (layer.offsetY + motion.y) * scale);
  context.rotate(motion.rotation);
  context.scale(motion.scaleX, motion.scaleY);
  context.drawImage(layer.canvas, -ACTION_RENDER_SIZE / 2, -ACTION_RENDER_SIZE / 2, ACTION_RENDER_SIZE, ACTION_RENDER_SIZE);
  context.restore();
}

function idlePose(phase: number): FramePose {
  const wave = Math.sin(phase * Math.PI * 2);
  return pose({
    y: wave * 1.4,
    layers: {
      body: { y: wave * 1.5, scaleY: 1 + wave * 0.012 },
      head: { y: -1.5 + wave * -1.8, rotation: wave * 0.018 },
    },
  });
}

function runningPose(phase: number, flipX: boolean, inPlace = false): FramePose {
  const wave = Math.sin(phase * Math.PI * 2);
  const hop = Math.abs(wave);
  const direction = flipX ? -1 : 1;
  return pose({
    x: inPlace ? wave * 2 : direction * wave * 4,
    y: -hop * 8,
    flipX,
    layers: {
      feet: { x: -direction * wave * 5, y: hop * 2, scaleY: 1 - hop * 0.08 },
      body: { x: direction * 2, y: -hop * 2, rotation: direction * 0.055, scaleX: 1 + hop * 0.035, scaleY: 1 - hop * 0.045 },
      head: { x: direction * 4, y: -hop * 5, rotation: direction * 0.08 },
    },
  });
}

function wavingPose(phase: number): FramePose {
  const wave = Math.sin(phase * Math.PI * 2);
  return pose({
    y: -1,
    layers: {
      body: { rotation: wave * 0.025, scaleY: 1 + Math.abs(wave) * 0.012 },
      head: { x: wave * 5, y: -3, rotation: wave * 0.11 },
    },
  });
}

function jumpingPose(phase: number): FramePose {
  const lift = Math.sin(phase * Math.PI);
  const stretch = Math.sin(phase * Math.PI * 2);
  return pose({
    y: -lift * 24,
    layers: {
      feet: { y: lift * 8, scaleX: 1 + lift * 0.05, scaleY: 1 - lift * 0.12 },
      body: { y: -lift * 5, scaleX: 1 - stretch * 0.025, scaleY: 1 + stretch * 0.045 },
      head: { y: -lift * 9, rotation: stretch * 0.045 },
    },
  });
}

function failedPose(phase: number): FramePose {
  const wobble = Math.sin(phase * Math.PI * 2);
  const slump = 1 - Math.cos(phase * Math.PI * 2);
  return pose({
    y: 5 + slump,
    layers: {
      feet: { y: 3 },
      body: { y: 4, rotation: wobble * 0.035, scaleY: 0.96 },
      head: { x: wobble * 3, y: 8, rotation: -0.12 + wobble * 0.05 },
    },
  });
}

function waitingPose(phase: number): FramePose {
  const wave = Math.sin(phase * Math.PI * 2);
  return pose({
    x: wave * 1.2,
    y: Math.cos(phase * Math.PI * 2) * 1.4,
    layers: {
      body: { scaleY: 1 + wave * 0.009 },
      head: { x: wave * 2, y: -2, rotation: wave * 0.04 },
    },
  });
}

function reviewPose(phase: number): FramePose {
  const wave = Math.sin(phase * Math.PI * 2);
  return pose({
    y: -1,
    layers: {
      body: { y: Math.abs(wave) * 1.4, scaleY: 1 + Math.abs(wave) * 0.012 },
      head: { x: wave * 4, y: -4, rotation: -0.08 + wave * 0.045 },
    },
  });
}

function pose(partial: Partial<FramePose>): FramePose {
  return {
    x: 0,
    y: 0,
    flipX: false,
    layers: {},
    ...partial,
  };
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

function normalizeForeground(source: HTMLCanvasElement) {
  const bounds = alphaStats(source);
  if (!bounds) return source;

  const width = bounds.maxX - bounds.minX + 1;
  const height = bounds.maxY - bounds.minY + 1;
  const scale = Math.min(CONTENT_SIZE / width, CONTENT_SIZE / height);
  if (!Number.isFinite(scale) || scale <= 0) return source;

  const output = createCanvas();
  const context = output.getContext("2d");
  if (!context) return source;

  const targetWidth = width * scale;
  const targetHeight = height * scale;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, bounds.minX, bounds.minY, width, height, (CANVAS_SIZE - targetWidth) / 2, (CANVAS_SIZE - targetHeight) / 2, targetWidth, targetHeight);
  return output;
}

function alphaStats(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  if (!context) return null;
  return opaqueBounds(context.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE).data, 12);
}

function foregroundLooksBroken(current: ReturnType<typeof alphaStats>, original: ReturnType<typeof alphaStats>) {
  if (!original) return false;
  if (!current) return true;

  const width = current.maxX - current.minX + 1;
  const height = current.maxY - current.minY + 1;
  return current.pixelCount < 1800 || width < 36 || height < 36 || current.pixelCount < original.pixelCount * 0.08;
}

function removeFlatBackground(context: CanvasRenderingContext2D, threshold: number) {
  const image = context.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  const bounds = opaqueBounds(image.data);
  if (!bounds) return;
  const samples = collectBorderColors(image.data);
  const backgroundMask = connectedBackgroundMask(image.data, bounds, samples, threshold);
  const hardLimit = threshold + 18;
  const softEdge = 30;

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const pixelIndex = y * CANVAS_SIZE + x;
      const offset = pixelIndex * 4;
      const alpha = image.data[offset + 3] ?? 0;
      if (alpha === 0) continue;

      if (backgroundMask[pixelIndex]) {
        image.data[offset + 3] = 0;
        continue;
      }

      if (!touchesBackground(backgroundMask, x, y)) continue;
      const distance = nearestColorDistance(image.data, offset, samples);
      if (distance >= hardLimit + softEdge) continue;
      const matte = Math.min(1, Math.max(0, (distance - hardLimit) / softEdge));
      image.data[offset + 3] = Math.round(alpha * matte);
    }
  }
  context.putImageData(image, 0, 0);
}

function connectedBackgroundMask(data: Uint8ClampedArray, bounds: NonNullable<ReturnType<typeof opaqueBounds>>, colors: Array<[number, number, number]>, threshold: number) {
  const mask = new Uint8Array(CANVAS_SIZE * CANVAS_SIZE);
  const queue = new Int32Array(CANVAS_SIZE * CANVAS_SIZE);
  const limit = threshold + 18;
  let head = 0;
  let tail = 0;

  const tryPush = (x: number, y: number) => {
    if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) return;
    const pixelIndex = y * CANVAS_SIZE + x;
    if (mask[pixelIndex]) return;
    const offset = pixelIndex * 4;
    if ((data[offset + 3] ?? 0) < 8) return;
    if (nearestColorDistance(data, offset, colors) > limit) return;
    mask[pixelIndex] = 1;
    queue[tail] = pixelIndex;
    tail += 1;
  };

  for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
    tryPush(x, bounds.minY);
    tryPush(x, bounds.maxY);
  }
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    tryPush(bounds.minX, y);
    tryPush(bounds.maxX, y);
  }

  while (head < tail) {
    const pixelIndex = queue[head] ?? 0;
    head += 1;
    const x = pixelIndex % CANVAS_SIZE;
    const y = Math.floor(pixelIndex / CANVAS_SIZE);
    tryPush(x + 1, y);
    tryPush(x - 1, y);
    tryPush(x, y + 1);
    tryPush(x, y - 1);
  }

  return mask;
}

function touchesBackground(mask: Uint8Array, x: number, y: number) {
  const pixelIndex = y * CANVAS_SIZE + x;
  return Boolean(
    (x > 0 && mask[pixelIndex - 1]) ||
      (x < CANVAS_SIZE - 1 && mask[pixelIndex + 1]) ||
      (y > 0 && mask[pixelIndex - CANVAS_SIZE]) ||
      (y < CANVAS_SIZE - 1 && mask[pixelIndex + CANVAS_SIZE]),
  );
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

function opaqueBounds(data: Uint8ClampedArray, alphaThreshold = 0) {
  let minX = CANVAS_SIZE;
  let minY = CANVAS_SIZE;
  let maxX = -1;
  let maxY = -1;
  let pixelCount = 0;
  for (let y = 0; y < CANVAS_SIZE; y += 1) {
    for (let x = 0; x < CANVAS_SIZE; x += 1) {
      const alpha = data[(y * CANVAS_SIZE + x) * 4 + 3] ?? 0;
      if (alpha <= alphaThreshold) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      pixelCount += 1;
    }
  }
  if (maxX < 0) return null;
  return { minX, minY, maxX, maxY, pixelCount };
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

function cloneCanvas(source: HTMLCanvasElement) {
  const clone = createCanvas();
  const context = clone.getContext("2d");
  if (context) context.drawImage(source, 0, 0);
  return clone;
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
