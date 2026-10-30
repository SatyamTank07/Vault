import type { LocalCanvasNode, LocalNote, Snapshot } from './localDb';

/**
 * Changes made on this device, queued until the server confirms them (POST /api/sync/push).
 * Payloads use the server's field names; note title/content are already encrypted.
 *
 * applyOp replays a change on the local copy so the UI shows it straight away. It mirrors the
 * rules in backend/crud.py closely enough for the offline period; the next snapshot from the
 * server replaces the result either way.
 */

export type OpType =
  | 'create_note'
  | 'update_note'
  | 'delete_note'
  | 'set_parent'
  | 'set_schedule'
  | 'set_occurrence'
  | 'create_canvas'
  | 'rename_canvas'
  | 'delete_canvas'
  | 'create_canvas_node'
  | 'move_canvas_node'
  | 'delete_canvas_node'
  // Images: sent to the upload routes rather than /api/sync/push; nothing to apply locally.
  | 'upload'
  | 'delete_upload';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OpPayload = Record<string, any>;

export interface QueuedOp {
  /** IndexedDB key; also the queue order. Unset until stored. */
  seq?: number;
  op_id: string;
  type: OpType;
  payload: OpPayload;
  /** When the change was made on this device (ISO). Used as the local updated_at. */
  created_at: string;
}

/** Fields of NoteUpdate (backend/schemas.py) an update_note may change. */
const NOTE_UPDATE_FIELDS = [
  'title',
  'content',
  'scheduled_date',
  'scheduled_time',
  'end_date',
  'status',
  'recurrence_rule',
  'recurrence_interval',
  'recurrence_end_date',
  'canvas_only',
] as const;

export function emptySnapshot(): Snapshot {
  return { server_time: '', notes: [], canvases: [], canvas_nodes: [], occurrences: [] };
}

export function cloneSnapshot(snapshot: Snapshot): Snapshot {
  return {
    server_time: snapshot.server_time,
    notes: snapshot.notes.map((note) => ({ ...note })),
    canvases: snapshot.canvases.map((canvas) => ({ ...canvas })),
    canvas_nodes: snapshot.canvas_nodes.map((node) => ({ ...node })),
    occurrences: snapshot.occurrences.map((occ) => ({ ...occ })),
  };
}

const findNote = (view: Snapshot, id: string | null | undefined) =>
  id ? view.notes.find((note) => note.id === id) : undefined;
const nodesOf = (view: Snapshot, noteId: string) => view.canvas_nodes.filter((node) => node.note_id === noteId);

function refreshCanvasName(view: Snapshot, note: LocalNote) {
  const first = nodesOf(view, note.id)[0];
  note.canvas_name = first ? view.canvases.find((c) => c.id === first.canvas_id)?.name ?? null : null;
}

/** _enforce_visibility: a note may be canvas-only only while it has a parent or a canvas node. */
function enforceVisibility(view: Snapshot, note: LocalNote) {
  if (note.canvas_only && !note.parent_note_id && nodesOf(view, note.id).length === 0) {
    note.canvas_only = false;
  }
}

function isSelfOrDescendant(view: Snapshot, candidateId: string, ancestorId: string): boolean {
  const seen = new Set<string>();
  let current: string | null | undefined = candidateId;
  while (current && !seen.has(current)) {
    if (current === ancestorId) return true;
    seen.add(current);
    current = findNote(view, current)?.parent_note_id;
  }
  return false;
}

/** _mirror_onto_parent_canvas: put the child on the parent's canvas. */
function mirrorOntoParentCanvas(view: Snapshot, parent: LocalNote, child: LocalNote) {
  const parentNode = nodesOf(view, parent.id)[0];
  if (!parentNode) return;
  if (nodesOf(view, child.id).some((node) => node.canvas_id === parentNode.canvas_id)) return;
  view.canvas_nodes.push({
    // Stable, so rebuilding the local copy doesn't remount the node.
    id: `mirror-${parentNode.canvas_id}-${child.id}`,
    canvas_id: parentNode.canvas_id,
    note_id: child.id,
    position_x: parentNode.position_x,
    position_y: parentNode.position_y + 150,
    mirrored: true,
  });
  refreshCanvasName(view, child);
}

function removeMirroredNodes(view: Snapshot, note: LocalNote, keepCanvasId: string | null = null) {
  view.canvas_nodes = view.canvas_nodes.filter(
    (node) => !(node.note_id === note.id && node.mirrored && node.canvas_id !== keepCanvasId),
  );
  refreshCanvasName(view, note);
}

/** Server-side clean-up shared by create_note and update_note. */
function normalizeSchedule(note: LocalNote) {
  if (!note.scheduled_date) {
    note.scheduled_time = null;
    note.end_date = null;
    note.recurrence_rule = null;
    note.recurrence_interval = 1;
    note.recurrence_end_date = null;
  } else if (note.end_date && note.scheduled_date > note.end_date) {
    note.end_date = note.scheduled_date;
  }
  if (note.scheduled_date && note.status == null) note.status = 'todo';
}

function deleteNote(view: Snapshot, noteId: string) {
  view.notes = view.notes.filter((note) => note.id !== noteId);
  view.canvas_nodes = view.canvas_nodes.filter((node) => node.note_id !== noteId);
  view.occurrences = view.occurrences.filter((occ) => occ.note_id !== noteId);
  for (const child of view.notes.filter((note) => note.parent_note_id === noteId)) {
    child.parent_note_id = null;
    enforceVisibility(view, child);
  }
}

/** Apply one queued change to the local copy, in place. Changes that don't fit (e.g. a missing note) are skipped. */
export function applyOp(view: Snapshot, op: QueuedOp): void {
  const p = op.payload;
  const now = op.created_at;

  switch (op.type) {
    case 'create_note': {
      if (findNote(view, p.id)) return;
      const note: LocalNote = {
        id: p.id,
        title: p.title ?? '',
        content: p.content ?? null,
        created_at: now,
        updated_at: now,
        scheduled_date: p.scheduled_date || null,
        scheduled_time: p.scheduled_date ? p.scheduled_time || null : null,
        status: p.status ?? null,
        canvas_name: null,
        recurrence_rule: p.recurrence_rule || null,
        recurrence_interval: p.recurrence_interval ?? 1,
        recurrence_end_date: p.recurrence_end_date || null,
        end_date: p.scheduled_date ? p.end_date || null : null,
        parent_note_id: null,
        canvas_only: !!p.canvas_only,
        content_version: 1,
      };
      normalizeSchedule(note);
      view.notes.push(note);
      const parent = findNote(view, p.parent_note_id);
      if (parent) {
        note.parent_note_id = parent.id;
        mirrorOntoParentCanvas(view, parent, note);
      }
      enforceVisibility(view, note);
      return;
    }

    case 'update_note': {
      const note = findNote(view, p.id);
      if (!note) return;
      const target = note as unknown as Record<string, unknown>;
      for (const field of NOTE_UPDATE_FIELDS) {
        if (!(field in p)) continue;
        if (field === 'canvas_only' && p.canvas_only == null) continue;
        target[field] = p[field];
      }
      enforceVisibility(view, note);
      normalizeSchedule(note);
      note.updated_at = now;
      return;
    }

    case 'delete_note':
      deleteNote(view, p.id);
      return;

    case 'set_parent': {
      const note = findNote(view, p.id);
      if (!note) return;
      if (!p.parent_note_id) {
        note.parent_note_id = null;
        removeMirroredNodes(view, note);
        enforceVisibility(view, note);
      } else {
        const parent = findNote(view, p.parent_note_id);
        if (!parent || isSelfOrDescendant(view, parent.id, note.id)) return;
        if (parent.id !== note.parent_note_id) {
          removeMirroredNodes(view, note, nodesOf(view, parent.id)[0]?.canvas_id ?? null);
        }
        note.parent_note_id = parent.id;
        mirrorOntoParentCanvas(view, parent, note);
      }
      note.updated_at = now;
      return;
    }

    case 'set_schedule': {
      const note = findNote(view, p.id);
      if (!note) return;
      if (p.scheduled_date != null) {
        note.scheduled_date = p.scheduled_date;
        if (!note.status) note.status = 'todo';
      }
      if (p.clear_date) {
        note.scheduled_date = null;
        note.scheduled_time = null;
        note.end_date = null;
        note.recurrence_rule = null;
        note.recurrence_interval = 1;
        note.recurrence_end_date = null;
      }
      if (p.scheduled_time != null) note.scheduled_time = p.scheduled_time;
      if (p.clear_time) note.scheduled_time = null;
      if (p.end_date != null) note.end_date = p.end_date;
      if (p.clear_end_date) note.end_date = null;
      if (p.status != null) note.status = p.status;
      note.updated_at = now;
      return;
    }

    case 'set_occurrence': {
      if (!findNote(view, p.note_id)) return;
      let occ = view.occurrences.find((o) => o.note_id === p.note_id && o.occurrence_date === p.occurrence_date);
      if (!occ) {
        occ = {
          id: `local-${p.note_id}-${p.occurrence_date}`,
          note_id: p.note_id,
          occurrence_date: p.occurrence_date,
          status: 'todo',
          skipped: false,
        };
        view.occurrences.push(occ);
      }
      if (p.status != null) occ.status = p.status;
      if (p.skipped != null) occ.skipped = p.skipped;
      return;
    }

    case 'create_canvas':
      if (view.canvases.some((c) => c.id === p.id)) return;
      view.canvases.push({ id: p.id, name: p.name || 'Untitled', created_at: now, updated_at: now });
      return;

    case 'rename_canvas': {
      const canvas = view.canvases.find((c) => c.id === p.id);
      if (!canvas || p.name == null) return;
      canvas.name = p.name;
      canvas.updated_at = now;
      view.notes.forEach((note) => refreshCanvasName(view, note));
      return;
    }

    case 'delete_canvas': {
      const doomed = view.canvas_nodes
        .filter((node) => node.canvas_id === p.id && findNote(view, node.note_id)?.canvas_only)
        .map((node) => node.note_id);
      const touched = view.canvas_nodes.filter((node) => node.canvas_id === p.id).map((node) => node.note_id);
      view.canvases = view.canvases.filter((c) => c.id !== p.id);
      view.canvas_nodes = view.canvas_nodes.filter((node) => node.canvas_id !== p.id);
      new Set(doomed).forEach((noteId) => deleteNote(view, noteId));
      for (const noteId of touched) {
        const note = findNote(view, noteId);
        if (note) refreshCanvasName(view, note);
      }
      return;
    }

    case 'create_canvas_node': {
      const note = findNote(view, p.note_id);
      if (!note || !view.canvases.some((c) => c.id === p.canvas_id)) return;
      if (view.canvas_nodes.some((node) => node.id === p.id)) return;
      if (p.canvas_only != null) note.canvas_only = p.canvas_only;
      if (p.parent_note_id) {
        const parent = findNote(view, p.parent_note_id);
        if (!parent || isSelfOrDescendant(view, parent.id, note.id)) return;
        note.parent_note_id = parent.id;
      }
      const node: LocalCanvasNode = {
        id: p.id,
        canvas_id: p.canvas_id,
        note_id: note.id,
        position_x: p.position_x ?? 0,
        position_y: p.position_y ?? 0,
        mirrored: false,
      };
      view.canvas_nodes.push(node);
      refreshCanvasName(view, note);
      return;
    }

    case 'move_canvas_node': {
      const node = view.canvas_nodes.find((n) => n.id === p.id);
      if (!node) return;
      if (p.position_x != null) node.position_x = p.position_x;
      if (p.position_y != null) node.position_y = p.position_y;
      return;
    }

    case 'delete_canvas_node': {
      const node = view.canvas_nodes.find((n) => n.id === p.id);
      if (!node) return;
      view.canvas_nodes = view.canvas_nodes.filter((n) => n.id !== p.id);
      const note = findNote(view, node.note_id);
      if (note) {
        if (nodesOf(view, note.id).length === 0) note.canvas_only = false;
        refreshCanvasName(view, note);
      }
      return;
    }
  }
}

/**
 * Fold a new change into the newest queued one when the result is the same, so a burst of edits
 * (typing, dragging) becomes one op. Returns the merged op, or null when they must stay separate.
 */
export function coalesce(last: QueuedOp, next: QueuedOp): QueuedOp | null {
  const sameTarget = last.payload.id === next.payload.id;
  if (!sameTarget) return null;

  if (last.type === 'update_note' && next.type === 'update_note') {
    return {
      ...last,
      payload: { ...last.payload, ...next.payload, base_content_version: last.payload.base_content_version },
    };
  }
  if (last.type === 'create_note' && next.type === 'update_note') {
    const fields = { ...next.payload };
    delete fields.base_content_version;
    return { ...last, payload: { ...last.payload, ...fields } };
  }
  if (last.type === 'move_canvas_node' && next.type === 'move_canvas_node') {
    return { ...last, payload: next.payload };
  }
  if (last.type === 'rename_canvas' && next.type === 'rename_canvas') {
    return { ...last, payload: next.payload };
  }
  return null;
}
