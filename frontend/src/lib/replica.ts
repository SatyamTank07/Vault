import { apiFetch, isServerUnreachable } from './api';
import { isOnline, onServerWrite, subscribeConnectivity } from './connectivity';
import { clearLocalDb, loadSnapshot, saveSnapshot, type Snapshot } from './localDb';

/**
 * Keeps this device's copy of the vault (see localDb.ts) in step with the server, and answers
 * reads from it while the server is unreachable.
 */

let activeUserId: string | null = null;
let snapshot: Snapshot | null = null;
let loading: Promise<Snapshot | null> | null = null;
let pullTimer: ReturnType<typeof setTimeout> | null = null;

async function ensureLoaded(userId: string): Promise<Snapshot | null> {
  if (activeUserId !== userId) {
    activeUserId = userId;
    snapshot = null;
    loading = loadSnapshot(userId).catch((error) => {
      console.error('Failed to read the local copy:', error);
      return null;
    });
  }
  const loaded = await loading;
  if (activeUserId === userId && !snapshot) snapshot = loaded;
  return snapshot;
}

/**
 * Fetch a fresh snapshot and store it. Returns the freshest copy available: the new snapshot,
 * or the stored one when the server can't be reached (null if this device has never synced).
 */
export async function syncSnapshot(userId: string): Promise<Snapshot | null> {
  await ensureLoaded(userId);
  try {
    const response = await apiFetch('/api/sync/snapshot');
    if (response.ok) {
      const fresh: Snapshot = await response.json();
      if (activeUserId === userId) {
        snapshot = fresh;
        await saveSnapshot(userId, fresh);
      }
    } else if (!isServerUnreachable(response)) {
      console.error('Failed to sync:', response.status);
    }
  } catch (error) {
    if (!(error instanceof TypeError)) console.error('Failed to sync:', error);
  }
  return activeUserId === userId ? snapshot : null;
}

/** Refresh the local copy shortly after a change was saved on the server. */
function schedulePull() {
  if (!activeUserId) return;
  const userId = activeUserId;
  if (pullTimer) clearTimeout(pullTimer);
  pullTimer = setTimeout(() => {
    pullTimer = null;
    void syncSnapshot(userId);
  }, 1000);
}

onServerWrite(schedulePull);
subscribeConnectivity(() => {
  if (isOnline()) schedulePull();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * GET from the server when it is reachable; otherwise build the same response from the local copy.
 * `build` returns undefined for "not found".
 */
export async function cachedGet(path: string, build: (local: Snapshot) => unknown): Promise<Response> {
  try {
    const response = await apiFetch(path);
    if (!isServerUnreachable(response)) return response;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
  }

  const local = activeUserId ? await ensureLoaded(activeUserId) : null;
  if (!local) return jsonResponse({ detail: 'Vault is offline and this device has no saved copy yet.' }, 503);
  const body = build(local);
  return body === undefined ? jsonResponse({ detail: 'Not found' }, 404) : jsonResponse(body);
}

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

/** Drop the local copy for a user who logged out or lost their session. */
export async function forgetLocalCopy(userId: string): Promise<void> {
  if (activeUserId === userId) {
    activeUserId = null;
    snapshot = null;
    loading = null;
  }
  try {
    await clearLocalDb(userId);
  } catch (error) {
    console.error('Failed to clear the local copy:', error);
  }
}
