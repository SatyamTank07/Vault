import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CurrentUser } from './api';

/**
 * The on-device copy of a user's vault, as the server stores it: note titles and content stay
 * ciphertext, so nothing here is readable without the vault secret.
 */

export interface LocalNote {
  id: string;
  title: string;
  content: string | null;
  created_at: string | null;
  updated_at: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  status: string | null;
  canvas_name: string | null;
  recurrence_rule: string | null;
  recurrence_interval: number | null;
  recurrence_end_date: string | null;
  end_date: string | null;
  parent_note_id: string | null;
  canvas_only: boolean;
}

export interface LocalCanvas {
  id: string;
  name: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface LocalCanvasNode {
  id: string;
  canvas_id: string;
  note_id: string;
  position_x: number;
  position_y: number;
  mirrored: boolean;
}

export interface LocalOccurrence {
  id: string;
  note_id: string;
  occurrence_date: string;
  status: string;
  skipped: boolean;
}

export interface Snapshot {
  server_time: string;
  notes: LocalNote[];
  canvases: LocalCanvas[];
  canvas_nodes: LocalCanvasNode[];
  occurrences: LocalOccurrence[];
}

interface VaultDB extends DBSchema {
  meta: { key: string; value: unknown };
  notes: { key: string; value: LocalNote };
  canvases: { key: string; value: LocalCanvas };
  canvasNodes: { key: string; value: LocalCanvasNode };
  occurrences: { key: string; value: LocalOccurrence };
}

const DATA_STORES = ['notes', 'canvases', 'canvasNodes', 'occurrences'] as const;
const CACHED_USER_KEY = 'vault_cached_user';

const dbName = (userId: string) => `vault-${userId}`;
const openConnections = new Map<string, Promise<IDBPDatabase<VaultDB>>>();

function openLocalDb(userId: string): Promise<IDBPDatabase<VaultDB>> {
  let connection = openConnections.get(userId);
  if (!connection) {
    connection = openDB<VaultDB>(dbName(userId), 1, {
      upgrade(db) {
        db.createObjectStore('meta');
        for (const store of DATA_STORES) {
          db.createObjectStore(store, { keyPath: 'id' });
        }
      },
    });
    openConnections.set(userId, connection);
  }
  return connection;
}

/** Replace the whole local copy with a snapshot from the server, in one transaction. */
export async function saveSnapshot(userId: string, snapshot: Snapshot): Promise<void> {
  const db = await openLocalDb(userId);
  const tx = db.transaction(['meta', ...DATA_STORES], 'readwrite');
  const notes = tx.objectStore('notes');
  const canvases = tx.objectStore('canvases');
  const canvasNodes = tx.objectStore('canvasNodes');
  const occurrences = tx.objectStore('occurrences');
  // Queue every request synchronously so the transaction stays open; tx.done reports any failure.
  void Promise.all(DATA_STORES.map((store) => tx.objectStore(store).clear()));
  snapshot.notes.forEach((row) => void notes.put(row));
  snapshot.canvases.forEach((row) => void canvases.put(row));
  snapshot.canvas_nodes.forEach((row) => void canvasNodes.put(row));
  snapshot.occurrences.forEach((row) => void occurrences.put(row));
  void tx.objectStore('meta').put(snapshot.server_time, 'server_time');
  await tx.done;
}

/** The local copy, or null if this device has never synced for this user. */
export async function loadSnapshot(userId: string): Promise<Snapshot | null> {
  const db = await openLocalDb(userId);
  const serverTime = (await db.get('meta', 'server_time')) as string | undefined;
  if (!serverTime) return null;
  const [notes, canvases, canvasNodes, occurrences] = await Promise.all([
    db.getAll('notes'),
    db.getAll('canvases'),
    db.getAll('canvasNodes'),
    db.getAll('occurrences'),
  ]);
  return { server_time: serverTime, notes, canvases, canvas_nodes: canvasNodes, occurrences };
}

/** Forget everything this device holds for a user (logout, expired session, deleted account). */
export async function clearLocalDb(userId: string): Promise<void> {
  const connection = openConnections.get(userId);
  openConnections.delete(userId);
  if (connection) {
    (await connection).close();
  }
  await deleteDB(dbName(userId));
}

/** The signed-in user's profile, kept so the vault can be unlocked while the server is unreachable. */
export function getCachedUser(): CurrentUser | null {
  try {
    const raw = localStorage.getItem(CACHED_USER_KEY);
    return raw ? (JSON.parse(raw) as CurrentUser) : null;
  } catch {
    return null;
  }
}

export function setCachedUser(user: CurrentUser) {
  localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
}

export function clearCachedUser() {
  localStorage.removeItem(CACHED_USER_KEY);
}
