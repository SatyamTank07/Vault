import { useSyncExternalStore } from 'react';
import { apiFetch, isServerUnreachable, referencedUploads } from './api';
import { isOnline, subscribeConnectivity } from './connectivity';
import { decryptNote, encryptNote, getActiveVaultKey } from './crypto';
import {
  clearLocalDb,
  deleteOutboxOps,
  loadOutbox,
  loadSnapshot,
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

  for (let round = 0; outbox.length > 0 && round < 20; round++) {
    const batch = outbox.slice(0, PUSH_BATCH);
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
  const copy = await encryptNote(
    { title: `${theirs.title || 'Untitled'} (conflicted copy ${today()})`, content: theirs.content || '' },
    key,
  );
  // Leave referenced_uploads out: the copy's images still live in the original note's folder.
  await enqueue('create_note', { id: copyId, title: copy.title, content: copy.content, canvas_only: false });

  const ours = op.payload;
  if ('title' in ours || 'content' in ours) {
    // Keep the images both versions use, so the copy's pictures survive this save.
    let referenced = ours.referenced_uploads as string[] | undefined;
    if (referenced) {
      referenced = [...new Set([...referenced, ...referencedUploads(theirs.content, serverNote.id)])];
    }
    await enqueue('update_note', {
      id: ours.id,
      base_content_version: serverNote.content_version,
      ...('title' in ours ? { title: ours.title } : {}),
      ...('content' in ours ? { content: ours.content } : {}),
      ...(referenced ? { referenced_uploads: referenced } : {}),
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
