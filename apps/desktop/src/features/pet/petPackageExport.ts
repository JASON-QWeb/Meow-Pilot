import type { PetRigAsset } from "./petProfile";

type ZipFile = {
  name: string;
  bytes: Uint8Array;
};

const encoder = new TextEncoder();
const crcTable = createCrcTable();

export async function buildPetdexPackage(asset: PetRigAsset): Promise<Blob> {
  if (!asset.actionSpritesheet) {
    throw new Error("当前素材还没有动作图集。");
  }

  const sprite = dataUrlToBytes(asset.actionSpritesheet.dataUrl);
  const spriteMimeType = sprite.mimeType || asset.actionSpritesheet.mimeType;
  const spriteExtension = spriteMimeType === "image/png" ? "png" : "webp";
  const spritePath = `spritesheet.${spriteExtension}`;
  const displayName = asset.sourceName.replace(/\.[^.]+$/, "") || "custom-pet";
  const petJson = {
    id: safePackageId(displayName),
    displayName,
    description: `A local Petdex-compatible pet generated from ${asset.sourceName}.`,
    spritesheetPath: spritePath,
    format: asset.actionSpritesheet.format,
    frameWidth: asset.actionSpritesheet.frameWidth,
    frameHeight: asset.actionSpritesheet.frameHeight,
    columns: asset.actionSpritesheet.columns,
    rows: asset.actionSpritesheet.rows,
  };

  return createStoredZip([
    { name: "pet.json", bytes: encoder.encode(JSON.stringify(petJson, null, 2)) },
    { name: spritePath, bytes: sprite.bytes },
  ]);
}

export async function buildPetRigLayerPackage(asset: PetRigAsset): Promise<Blob> {
  const preview = dataUrlToBytes(asset.previewDataUrl);
  const files: ZipFile[] = [
    {
      name: "pet-rig.json",
      bytes: encoder.encode(
        JSON.stringify(
          {
            id: asset.id,
            sourceName: asset.sourceName,
            createdAt: asset.createdAt,
            updatedAt: asset.updatedAt,
            settings: asset.settings,
            layers: asset.layers.map((layer) => ({
              id: layer.id,
              label: layer.label,
              path: `layers/${layer.id}.png`,
              offsetX: layer.offsetX,
              offsetY: layer.offsetY,
            })),
            actionSpritesheet: asset.actionSpritesheet
              ? {
                  path: `actions/spritesheet.${asset.actionSpritesheet.mimeType === "image/png" ? "png" : "webp"}`,
                  format: asset.actionSpritesheet.format,
                  frameWidth: asset.actionSpritesheet.frameWidth,
                  frameHeight: asset.actionSpritesheet.frameHeight,
                  columns: asset.actionSpritesheet.columns,
                  rows: asset.actionSpritesheet.rows,
                }
              : null,
          },
          null,
          2,
        ),
      ),
    },
    { name: "preview.png", bytes: preview.bytes },
    ...asset.layers.map((layer) => ({
      name: `layers/${layer.id}.png`,
      bytes: dataUrlToBytes(layer.imageDataUrl).bytes,
    })),
  ];

  if (asset.actionSpritesheet) {
    const sprite = dataUrlToBytes(asset.actionSpritesheet.dataUrl);
    files.push({
      name: `actions/spritesheet.${asset.actionSpritesheet.mimeType === "image/png" ? "png" : "webp"}`,
      bytes: sprite.bytes,
    });
  }

  return createStoredZip(files);
}

function createStoredZip(files: ZipFile[]) {
  const localParts: Array<Uint8Array> = [];
  const centralParts: Array<Uint8Array> = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const crc = crc32(file.bytes);
    const localHeader = createLocalHeader(nameBytes, file.bytes, crc);
    const centralHeader = createCentralHeader(nameBytes, file.bytes, crc, offset);
    localParts.push(localHeader, file.bytes);
    centralParts.push(centralHeader);
    offset += localHeader.byteLength + file.bytes.byteLength;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((size, part) => size + part.byteLength, 0);
  const endRecord = createEndRecord(files.length, centralSize, centralOffset);
  return new Blob([...localParts, ...centralParts, endRecord].map(toBlobPart), { type: "application/zip" });
}

function toBlobPart(bytes: Uint8Array): BlobPart {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function createLocalHeader(nameBytes: Uint8Array, bytes: Uint8Array, crc: number) {
  const header = new Uint8Array(30 + nameBytes.byteLength);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 10, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, bytes.byteLength, true);
  view.setUint32(22, bytes.byteLength, true);
  view.setUint16(26, nameBytes.byteLength, true);
  view.setUint16(28, 0, true);
  header.set(nameBytes, 30);
  return header;
}

function createCentralHeader(nameBytes: Uint8Array, bytes: Uint8Array, crc: number, localOffset: number) {
  const header = new Uint8Array(46 + nameBytes.byteLength);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 10, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint16(14, 0, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, bytes.byteLength, true);
  view.setUint32(24, bytes.byteLength, true);
  view.setUint16(28, nameBytes.byteLength, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, localOffset, true);
  header.set(nameBytes, 46);
  return header;
}

function createEndRecord(fileCount: number, centralSize: number, centralOffset: number) {
  const record = new Uint8Array(22);
  const view = new DataView(record.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, fileCount, true);
  view.setUint16(10, fileCount, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  view.setUint16(20, 0, true);
  return record;
}

function dataUrlToBytes(dataUrl: string) {
  const match = /^data:([^;,]+);base64,(.+)$/u.exec(dataUrl);
  if (!match) throw new Error("动作图集数据格式无效。");
  const binary = atob(match[2] ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return { bytes, mimeType: match[1] ?? "" };
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = (crc >>> 8) ^ (crcTable[(crc ^ (bytes[index] ?? 0)) & 0xff] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createCrcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function safePackageId(name: string) {
  return name
    .toLowerCase()
    .replace(/\.[^.]+$/u, "")
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48) || "custom-pet";
}
