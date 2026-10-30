import { useSyncExternalStore } from 'react';
import { apiFetch, isServerUnreachable, referencedUploads } from './api';
import { isOnline, subscribeConnectivity } from './connectivity';
import { decryptNote, encryptNote, getActiveVaultKey } from './crypto';
import {
  clearLocalDb,
  deleteLocalImages,
  deleteOutboxOps,
  getLocalImage,
  listLocalImages,
  loadOutbox,
  loadSnapshot,
  putLocalImage,
  putOutboxOp,
  saveSnapshot,
  type LocalNote,
  type Snapshot,
} from './localDb';
import { applyOp, cloneSnapshot, coalesce, emptySnapshot, type OpPayload, type OpType, type QueuedOp } from './ops';

/**
 * The vault as this device sees it: the last snapshot from the server plus the changes made here
 * that the server hasn't confirmed yet (the outbox). Every view reads from it and every change
 * goes into it, so the app works the same with or without the server; sync() pushes the outbox
 * and pulls a fresh snapshot whenever the server is reachable.
 */

const CLIENT_ID_KEY = 'vault_sync_client_id';
const PUSH_BATCH = 100;
const SYNC_DEBOUNCE_MS = 800;
const SYNC_INTERVAL_MS = 60_000;
const IMAGE_DOWNLOADS_AT_ONCE = 3;
export const SYNC_CONFLICT_EVENT = 'vault:sync-conflict';
export const SYNC_SIGN_IN_EVENT = 'vault:sync-sign-in';

let activeUserId: string | null = null;
let opening: Promise<void> | null = null;
/** Server state from the last snapshot. */
let base: Snapshot | null = null;
/** Pushed and accepted, but not yet reflected in `base` (cleared by the next snapshot). */
let confirmed: QueuedOp[] = [];
let outbox: QueuedOp[] = [];
let view: Snapshot | null = null;
let channel: BroadcastChannel | null = null;

const viewListeners = new Set<() => void>();

export interface SyncStatus {
  pending: number;
  syncing: boolean;
  /** The session expired; changes stay queued until the user signs in again. */
  signInRequired: boolean;
  lastSyncedAt: string | null;
}
let status: SyncStatus = { pending: 0, syncing: false, signInRequired: false, lastSyncedAt: null };
const statusListeners = new Set<() => void>();

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  statusListeners.forEach((listener) => listener());
}

export function getClientId(): string {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

function rebuild() {
  const next = cloneSnapshot(base ?? emptySnapshot());
  for (const op of [...confirmed, ...outbox]) applyOp(next, op);
  view = next;
  viewListeners.forEach((listener) => listener());
  if (status.pending !== outbox.length) setStatus({ pending: outbox.length });
}

async function reloadFromDb(userId: string) {
  const [snapshot, queued] = await Promise.all([loadSnapshot(userId), loadOutbox(userId)]);
  if (activeUserId !== userId) return;
  base = snapshot;
  const storedIds = new Set(queued.map((op) => op.op_id));
  outbox = [...queued, ...outbox.filter((op) => op.seq === undefined && !storedIds.has(op.op_id))];
  if (snapshot) setStatus({ lastSyncedAt: snapshot.server_time });
  rebuild();
}

function broadcastChange() {
  channel?.postMessage('changed');
}

/** Load this user's local copy and start syncing. Safe to call repeatedly. */
export function openReplica(userId: string): Promise<void> {
  if (activeUserId === userId && opening) return opening;
  closeReplica();
  activeUserId = userId;
  if ('BroadcastChannel' in window) {
    channel = new BroadcastChannel(`vault-store-${userId}`);
    // Another tab changed the outbox or pulled a snapshot.
    channel.onmessage = () => void reloadFromDb(userId);
  }
  opening = reloadFromDb(userId)
    .catch((error) => {
      console.error('Failed to read the local copy:', error);
      rebuild();
    })
    .then(() => sync());
  return opening;
}

/** Stop using the in-memory copy (the IndexedDB copy stays). */
export function closeReplica() {
  channel?.close();
  channel = null;
  activeUserId = null;
  opening = null;
  base = null;
  confirmed = [];
  outbox = [];
  view = null;
  setStatus({ pending: 0, syncing: false, signInRequired: false, lastSyncedAt: null });
  viewListeners.forEach((listener) => listener());
}

export function getView(): Snapshot {
  return view ?? emptySnapshot();
}

function subscribeView(listener: () => void) {
  viewListeners.add(listener);
  return () => viewListeners.delete(listener);
}

/** The current local copy; re-renders on every change. */
export function useReplica(): Snapshot | null {
  return useSyncExternalStore(subscribeView, () => view);
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (listener) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    () => status,
  );
}

export function hasPendingChanges(): boolean {
  return outbox.length > 0;
}

// ─── Changes ───

let inFlight = new Set<string>();

/** Make a change: show it now, and queue it for the server. */
export async function enqueue(type: OpType, payload: OpPayload): Promise<void> {
  const userId = activeUserId;
  if (!userId) return;

  if ((type === 'update_note' || type === 'delete_note') && payload.base_content_version === undefined) {
    // The version this device last got from the server, so the server can spot edits made elsewhere.
    const known = base?.notes.find((note) => note.id === payload.id);
    payload = { ...payload, base_content_version: known ? known.content_version : null };
  }

  let op: QueuedOp = { op_id: crypto.randomUUID(), type, payload, created_at: new Date().toISOString() };
  const last = outbox[outbox.length - 1];
  const merged = last && !inFlight.has(last.op_id) ? coalesce(last, op) : null;
  if (merged) {
    op = merged;
    outbox = [...outbox.slice(0, -1), op];
  } else {
    outbox = [...outbox, op];
  }
  rebuild();

  try {
    op.seq = await putOutboxOp(userId, op);
  } catch (error) {
    console.error('Failed to save a change on this device:', error);
  }
  broadcastChange();
  scheduleSync(SYNC_DEBOUNCE_MS);
}

// ─── Sync ───

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncRunning = false;
let syncAgain = false;

function scheduleSync(delay: number) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void sync();
  }, delay);
}

async function withSyncLock(userId: string, task: () => Promise<void>) {
  if (navigator.locks) {
    // One tab syncs at a time; the others pick up the result through the BroadcastChannel.
    await navigator.locks.request(`vault-sync-${userId}`, task);
  } else {
    await task();
  }
}

type Outcome = 'ok' | 'offline' | 'signin' | 'failed';

function classify(response: Response): Outcome | null {
  if (response.status === 401) return 'signin';
  if (isServerUnreachable(response)) return 'offline';
  if (!response.ok) return 'failed';
  return null;
}

/** Push queued changes, then pull a fresh snapshot. Runs at most once at a time. */
export async function sync(): Promise<void> {
  const userId = activeUserId;
  if (!userId) return;
  if (syncRunning) {
    syncAgain = true;
    return;
  }
  syncRunning = true;
  setStatus({ syncing: true });

  // Assigned inside the lock callback, which TypeScript's narrowing can't see.
  let outcome = 'ok' as Outcome;
  try {
    await withSyncLock(userId, async () => {
      outcome = await pushOutbox(userId);
      if (outcome === 'ok') outcome = await pullSnapshot(userId);
    });
  } catch (error) {
    // fetch rejects when the network is down; anything else is a bug worth seeing.
    if (!(error instanceof TypeError)) console.error('Sync failed:', error);
    outcome = 'offline';
  } finally {
    syncRunning = false;
    inFlight = new Set();
    if (activeUserId === userId) {
      setStatus({ syncing: false, signInRequired: outcome === 'signin' });
      if (outcome === 'signin') window.dispatchEvent(new CustomEvent(SYNC_SIGN_IN_EVENT));
    }
    if (syncAgain && activeUserId === userId) {
      syncAgain = false;
      scheduleSync(0);
    }
  }
}

/**
 * Re-read the outbox (another tab may have queued changes), keeping changes made here whose
 * IndexedDB write hasn't finished yet.
 */
async function refreshOutbox(userId: string, drop: Set<string> = new Set()) {
  const stored = (await loadOutbox(userId)).filter((op) => !drop.has(op.op_id));
  const storedIds = new Set(stored.map((op) => op.op_id));
  const unsaved = outbox.filter((op) => op.seq === undefined && !storedIds.has(op.op_id) && !drop.has(op.op_id));
  outbox = [...stored, ...unsaved];
}

async function pushOutbox(userId: string): Promise<Outcome> {
  await refreshOutbox(userId);
  if (activeUserId !== userId) return 'failed';

  for (let round = 0; outbox.length > 0 && round < 500; round++) {
    if (isImageOp(outbox[0])) {
      const op = outbox[0];
      inFlight = new Set([op.op_id]);
      const problem = await pushImageOp(userId, op);
      inFlight = new Set();
      if (problem) return problem;
      if (op.seq !== undefined) await deleteOutboxOps(userId, [op.seq]);
      await refreshOutbox(userId, new Set([op.op_id]));
      if (activeUserId !== userId) return 'failed';
      setStatus({ pending: outbox.length });
      broadcastChange();
      continue;
    }

    // JSON ops up to the next image op, so the server sees changes in the order they were made.
    const firstImage = outbox.findIndex(isImageOp);
    const batch = outbox.slice(0, Math.min(PUSH_BATCH, firstImage === -1 ? outbox.length : firstImage));
    inFlight = new Set(batch.map((op) => op.op_id));
    const response = await apiFetch(
      '/api/sync/push',
      {
        method: 'POST',
        body: JSON.stringify({
          client_id: getClientId(),
          ops: batch.map(({ op_id, type, payload }) => ({ op_id, type, payload })),
        }),
      },
      { suppressUnauthorizedEvent: true },
    );
    const problem = classify(response);
    if (problem) return problem;

    const { results } = (await response.json()) as { results: SyncResult[] };
    const done: QueuedOp[] = [];
    for (const result of results) {
      const op = batch.find((candidate) => candidate.op_id === result.op_id);
      if (!op) continue;
      if (result.result === 'conflict') {
        const resolved = await resolveConflict(op, result.note);
        if (!resolved) continue; // vault locked: leave it queued and try again later
      } else if (result.result === 'error') {
        console.error(`Sync dropped a change the server rejected (${op.type}):`, result.detail);
      }
      done.push(op);
    }

    await deleteOutboxOps(
      userId,
      done.map((op) => op.seq).filter((seq): seq is number => seq !== undefined),
    );
    const doneIds = new Set(done.map((op) => op.op_id));
    confirmed = [...confirmed, ...done.filter((op) => results.find((r) => r.op_id === op.op_id)?.result === 'applied')];
    await refreshOutbox(userId, doneIds);
    inFlight = new Set();
    if (activeUserId !== userId) return 'failed';
    setStatus({ pending: outbox.length });
    broadcastChange();
    if (done.length === 0) break;
  }
  return 'ok';
}

const isImageOp = (op: QueuedOp) => op.type === 'upload' || op.type === 'delete_upload';
const uploadPath = (noteId: string, filename: string) => `/api/uploads/${noteId}/${filename}`;

/** Send one queued image upload or delete. Returns a problem, or null when the op is done. */
async function pushImageOp(userId: string, op: QueuedOp): Promise<Outcome | null> {
  const { note_id: noteId, filename } = op.payload as { note_id: string; filename: string };
  const path = uploadPath(noteId, filename);

  if (op.type === 'delete_upload') {
    const response = await apiFetch(path, { method: 'DELETE' }, { suppressUnauthorizedEvent: true });
    // 404: already gone, which is the goal.
    return response.status === 404 ? null : classify(response);
  }

  const image = await getLocalImage(userId, path);
  if (!image) {
    console.error('Sync dropped an image upload whose bytes are missing:', path);
    return null;
  }
  const form = new FormData();
  form.append('file', new Blob([image.data], { type: 'application/octet-stream' }), filename);
  const query = `note_id=${encodeURIComponent(noteId)}&filename=${encodeURIComponent(filename)}`;
  const response = await apiFetch(`/api/upload?${query}`, { method: 'POST', body: form }, { suppressUnauthorizedEvent: true });
  const problem = classify(response);
  if (problem === 'failed') {
    console.error('Sync dropped an image upload the server rejected:', path, response.status);
    return null;
  }
  if (problem) return problem;
  await putLocalImage(userId, { ...image, pending: false });
  return null;
}

// ─── Images ───

/** Encrypted bytes of an uploaded image, from this device if it has them. */
export async function readLocalImage(path: string): Promise<ArrayBuffer | null> {
  if (!activeUserId) return null;
  try {
    return (await getLocalImage(activeUserId, path))?.data ?? null;
  } catch {
    return null;
  }
}

/** Keep a downloaded image's encrypted bytes for offline use. */
export async function rememberImage(path: string, data: ArrayBuffer): Promise<void> {
  if (!activeUserId) return;
  try {
    await putLocalImage(activeUserId, { path, data, pending: false });
  } catch (error) {
    console.error('Failed to keep an image on this device:', error);
  }
}

/**
 * Add an image (already encrypted) to a note. It gets its final URL at once and is uploaded by
 * the next sync, so this works offline. Returns the URL path to put in the note.
 */
export async function queueImageUpload(noteId: string, encrypted: Blob): Promise<string> {
  const userId = activeUserId;
  if (!userId) throw new Error('Vault is locked.');
  const filename = `${crypto.randomUUID()}.enc`;
  const path = uploadPath(noteId, filename);
  await putLocalImage(userId, { path, data: await encrypted.arrayBuffer(), pending: true });
  await enqueue('upload', { note_id: noteId, filename });
  return path;
}

/** Drop an image added during an edit that was then discarded. */
export async function discardUpload(path: string): Promise<void> {
  const userId = activeUserId;
  const match = /^\/api\/uploads\/([^/]+)\/([^/]+)$/.exec(path);
  if (!userId || !match) return;
  const [, noteId, filename] = match;

  const queued = outbox.find(
    (op) => op.type === 'upload' && op.payload.note_id === noteId && op.payload.filename === filename,
  );
  if (queued && !inFlight.has(queued.op_id)) {
    // Never reached the server: forget it here and nothing needs sending.
    outbox = outbox.filter((op) => op !== queued);
    if (queued.seq !== undefined) await deleteOutboxOps(userId, [queued.seq]);
    setStatus({ pending: outbox.length });
    broadcastChange();
  } else {
    await enqueue('delete_upload', { note_id: noteId, filename });
  }
  await deleteLocalImages(userId, [path]);
}

let imageSyncRunning = false;

/** Download images this device doesn't have yet, and drop ones that were deleted on the server. */
async function syncImages(userId: string, uploads: string[]) {
  if (imageSyncRunning) return;
  imageSyncRunning = true;
  try {
    const local = await listLocalImages(userId);
    const wanted = new Set(uploads);
    const stale = [...local].filter(([path, pending]) => !pending && !wanted.has(path)).map(([path]) => path);
    await deleteLocalImages(userId, stale);

    const missing = uploads.filter((path) => !local.has(path));
    const worker = async () => {
      for (let path = missing.shift(); path; path = missing.shift()) {
        if (activeUserId !== userId) return;
        try {
          const response = await apiFetch(path, {}, { suppressUnauthorizedEvent: true });
          if (!response.ok) {
            if (isServerUnreachable(response) || response.status === 401) return;
            continue;
          }
          await putLocalImage(userId, { path, data: await response.arrayBuffer(), pending: false });
        } catch {
          return; // offline again; the next sync carries on
        }
      }
    };
    await Promise.all(Array.from({ length: IMAGE_DOWNLOADS_AT_ONCE }, worker));
  } catch (error) {
    console.error('Failed to keep images offline:', error);
  } finally {
    imageSyncRunning = false;
  }
}

async function pullSnapshot(userId: string): Promise<Outcome> {
  const response = await apiFetch('/api/sync/snapshot', {}, { suppressUnauthorizedEvent: true });
  const problem = classify(response);
  if (problem) return problem;

  const fresh: Snapshot = await response.json();
  if (activeUserId !== userId) return 'failed';
  await saveSnapshot(userId, fresh);
  base = fresh;
  confirmed = [];
  await refreshOutbox(userId);
  setStatus({ lastSyncedAt: fresh.server_time });
  rebuild();
  broadcastChange();
  void syncImages(userId, fresh.uploads ?? []);
  return 'ok';
}

interface SyncResult {
  op_id: string;
  result: 'applied' | 'conflict' | 'not_found' | 'error';
  detail?: string | null;
  note?: LocalNote | null;
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * The same note was changed on another device since this one last synced. Keep both: this
 * device's text wins, and the other version becomes a new "conflicted copy" note.
 * Returns false when the vault is locked, so the change stays queued.
 */
async function resolveConflict(op: QueuedOp, serverNote: LocalNote | null | undefined): Promise<boolean> {
  if (op.type === 'delete_note') {
    // Deleted here, edited elsewhere: the server kept the edited note.
    window.dispatchEvent(new CustomEvent(SYNC_CONFLICT_EVENT, { detail: { kind: 'kept' } }));
    return true;
  }
  if (op.type !== 'update_note' || !serverNote) return true;

  const key = getActiveVaultKey();
  if (!key) return false;

  const { note: theirs } = await decryptNote(serverNote, key);
  const copyId = crypto.randomUUID();
  // The copy gets its own image files, so later edits or deletes of the original can't break it.
  let copyContent: string = theirs.content || '';
  for (const filename of referencedUploads(copyContent, serverNote.id)) {
    const source = uploadPath(serverNote.id, filename);
    let data = await readLocalImage(source);
    if (!data) {
      const response = await apiFetch(source, {}, { suppressUnauthorizedEvent: true });
      if (!response.ok) continue;
      data = await response.arrayBuffer();
    }
    const copiedPath = await queueImageUpload(copyId, new Blob([data]));
    copyContent = copyContent.split(source).join(copiedPath);
  }
  const copy = await encryptNote(
    { title: `${theirs.title || 'Untitled'} (conflicted copy ${today()})`, content: copyContent },
    key,
  );
  await enqueue('create_note', {
    id: copyId,
    title: copy.title,
    content: copy.content,
    canvas_only: false,
    referenced_uploads: referencedUploads(copyContent, copyId),
  });

  const ours = op.payload;
  if ('title' in ours || 'content' in ours) {
    await enqueue('update_note', {
      id: ours.id,
      base_content_version: serverNote.content_version,
      ...('title' in ours ? { title: ours.title } : {}),
      ...('content' in ours ? { content: ours.content } : {}),
      ...('referenced_uploads' in ours ? { referenced_uploads: ours.referenced_uploads } : {}),
    });
  }
  window.dispatchEvent(new CustomEvent(SYNC_CONFLICT_EVENT, { detail: { kind: 'copy', noteId: copyId } }));
  return true;
}

// Sync when the server comes back, when the tab is shown again, and now and then.
subscribeConnectivity(() => {
  if (isOnline()) scheduleSync(0);
});
window.addEventListener('online', () => scheduleSync(0));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') scheduleSync(0);
});
setInterval(() => {
  if (activeUserId && document.visibilityState === 'visible') void sync();
}, SYNC_INTERVAL_MS);

// ─── Read helpers ───

export function buildCanvasList(local: Snapshot) {
  return [...local.canvases].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
}

export function buildCanvas(local: Snapshot, canvasId: string) {
  const canvas = local.canvases.find((c) => c.id === canvasId);
  if (!canvas) return undefined;
  const notesById = new Map(local.notes.map((note) => [note.id, note]));
  return {
    ...canvas,
    nodes: local.canvas_nodes
      .filter((node) => node.canvas_id === canvasId && notesById.has(node.note_id))
      .map((node) => ({
        id: node.id,
        canvas_id: node.canvas_id,
        note: notesById.get(node.note_id)!,
        position_x: node.position_x,
        position_y: node.position_y,
      })),
  };
}

/** Drop the local copy for a user who logged out. */
export async function forgetLocalCopy(userId: string): Promise<void> {
  if (activeUserId === userId) closeReplica();
  try {
    await clearLocalDb(userId);
  } catch (error) {
    console.error('Failed to clear the local copy:', error);
  }
}
