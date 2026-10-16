import type { GameBlueprint } from "@/lib/blueprint/types";
import { normalizeDraft, type NewGameDraft } from "@/lib/creation/draft";
import { draftToBlueprint } from "@/lib/creation/blueprint-from-draft";

const DATABASE = "slots-studio";
const STORE = "creation-drafts";
const KEY = "current-manual-project";
const LEGACY_KEY = "studio.newgame.draft.v1";
const FALLBACK_KEY = "studio.newgame.document.v2";

export interface DraftDocument {
  version: 2;
  id: string;
  createdAt: string;
  updatedAt: string;
  form: NewGameDraft;
  blueprint: GameBlueprint;
}

export function draftDocument(form: NewGameDraft, id: string, createdAt: string): DraftDocument {
  const updatedAt = new Date().toISOString();
  const blueprint = draftToBlueprint(form, { id, now: createdAt });
  blueprint.meta.updatedAt = updatedAt;
  return { version: 2, id, createdAt, updatedAt, form, blueprint };
}

let database: Promise<IDBDatabase> | null = null;
function openDatabase(): Promise<IDBDatabase> {
  if (!database) database = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("Browser database is unavailable")); return; }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onerror = () => { database = null; reject(request.error ?? new Error("Cannot open draft storage")); };
    request.onblocked = () => { database = null; reject(new Error("Close older studio tabs to unlock draft storage")); };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); database = null; };
      resolve(db);
    };
  });
  return database;
}

async function readIndexed(): Promise<DraftDocument | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(KEY);
    request.onsuccess = () => resolve((request.result as DraftDocument | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
}

/** All writes are serialized; clearing a created draft cannot race an old save. */
let writeQueue: Promise<unknown> = Promise.resolve();
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeQueue.catch(() => undefined).then(operation);
  writeQueue = result;
  return result;
}
async function writeIndexed(document: DraftDocument | null): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    if (document) store.put(document, KEY); else store.delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not save draft"));
    tx.onabort = () => reject(tx.error ?? new Error("Draft save interrupted"));
  });
}

function normalizeDocument(value: unknown): DraftDocument | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<DraftDocument>;
  if (raw.version !== 2 || !raw.form) return null;
  const form = normalizeDraft(raw.form);
  const id = typeof raw.id === "string" ? raw.id : "draft-manual";
  const createdAt = typeof raw.createdAt === "string" && Number.isFinite(Date.parse(raw.createdAt)) ? raw.createdAt : new Date().toISOString();
  const document = draftDocument(form, id, createdAt);
  document.updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : document.updatedAt;
  document.blueprint.meta.updatedAt = document.updatedAt;
  return document;
}

export const draftStore = {
  async load(): Promise<DraftDocument | null> {
    let document: DraftDocument | null = null;
    try { document = normalizeDocument(await readIndexed()); } catch { /* use full fallback below */ }
    try {
      const fallback = localStorage.getItem(FALLBACK_KEY);
      if (fallback) {
        const raw: unknown = JSON.parse(fallback);
        if (raw && typeof raw === "object" && "clearedAt" in raw && typeof raw.clearedAt === "string") {
          if (!document || Date.parse(document.updatedAt) <= Date.parse(raw.clearedAt)) return null;
        } else {
          const fallbackDocument = normalizeDocument(raw);
          if (fallbackDocument && (!document || Date.parse(fallbackDocument.updatedAt) >= Date.parse(document.updatedAt))) document = fallbackDocument;
        }
      }
      if (document) return document;
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (!legacy) return null;
      document = draftDocument(normalizeDraft(JSON.parse(legacy)), "draft-manual", new Date().toISOString());
      await this.save(document);
      localStorage.removeItem(LEGACY_KEY);
      return document;
    } catch { return document; }
  },

  save(document: DraftDocument): Promise<void> {
    return enqueue(async () => {
      try {
        await writeIndexed(document);
        try { localStorage.removeItem(FALLBACK_KEY); } catch { /* storage denied */ }
      } catch {
        // Never strip artwork. Either the complete draft is saved or we report a failure.
        localStorage.setItem(FALLBACK_KEY, JSON.stringify(document));
      }
    });
  },

  clear(): Promise<void> {
    return enqueue(async () => {
      let indexedCleared = false;
      try { await writeIndexed(null); indexedCleared = true; } catch { /* record a fallback tombstone below */ }
      if (indexedCleared) localStorage.removeItem(FALLBACK_KEY);
      else localStorage.setItem(FALLBACK_KEY, JSON.stringify({ clearedAt: new Date().toISOString() }));
      localStorage.removeItem(LEGACY_KEY);
    });
  },
};
