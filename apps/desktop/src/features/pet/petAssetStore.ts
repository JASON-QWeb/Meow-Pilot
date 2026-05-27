import type { PetRigAsset } from "./petProfile";

const DATABASE_NAME = "pet-agent-assets";
const DATABASE_VERSION = 1;
const STORE_NAME = "pet-rigs";

export async function loadPetRigAsset(assetId?: string) {
  if (!assetId) return null;
  const database = await openDatabase();
  return new Promise<PetRigAsset | null>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(assetId);
    request.addEventListener("success", () => resolve((request.result as PetRigAsset | undefined) ?? null));
    request.addEventListener("error", () => reject(request.error ?? new Error("Unable to load pet asset.")));
  });
}

export async function savePetRigAsset(asset: PetRigAsset) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(asset);
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("error", () => reject(transaction.error ?? new Error("Unable to save pet asset.")));
  });
}

export async function deletePetRigAsset(assetId: string) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(assetId);
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("error", () => reject(transaction.error ?? new Error("Unable to delete pet asset.")));
  });
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error ?? new Error("Unable to open pet asset storage.")));
  });
}
