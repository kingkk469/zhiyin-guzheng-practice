export type ReviewRun = {
  id: string;
  createdAt: string;
  appVersion: string;
  result: unknown;
};
export type ReviewSample = {
  id: string;
  createdAt: string;
  name: string;
  audio: Blob;
  truth: string;
  runs: ReviewRun[];
};
const DB = "zhiyin-review-samples-v1";
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("samples", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error("请关闭其他旧版页面后重试保存。"));
  });
}
export async function listSamples(): Promise<ReviewSample[]> {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("samples", "readonly");
      const req = tx.objectStore("samples").getAll();
      tx.oncomplete = () =>
        resolve(
          (req.result as ReviewSample[]).sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt),
          ),
        );
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
// Read + update in one transaction so audio, corrections and runs cannot overwrite each other.
export async function updateSample(
  id: string,
  change: (old: ReviewSample | undefined) => ReviewSample,
): Promise<ReviewSample> {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("samples", "readwrite"),
        store = tx.objectStore("samples");
      const req = store.get(id);
      let value: ReviewSample;
      req.onsuccess = () => {
        try {
          value = change(req.result);
          store.put(value);
        } catch (error) {
          tx.abort();
          reject(error);
        }
      };
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export function newSample(audio: Blob, name: string): ReviewSample {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    name,
    audio,
    truth: "",
    runs: [],
  };
}
export function audioFilename(sample: ReviewSample) {
  const type = sample.audio.type.split(";")[0];
  const extension = (
    {
      "audio/mp4": "m4a",
      "audio/webm": "webm",
      "audio/ogg": "ogg",
      "audio/wav": "wav",
      "audio/x-wav": "wav",
      "audio/mpeg": "mp3",
    } as Record<string, string>
  )[type];
  return `原始录音-${sample.id}.${extension ?? sample.name.match(/\.(m4a|wav|mp3|webm|ogg|aac|mp4)$/i)?.[1] ?? "audio"}`;
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
