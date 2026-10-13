import type { Note } from '../components/NoteCard/NoteCard';

type TreeNote = Pick<Note, 'id' | 'parent_note_id'>;

/** Direct children of `parentId`. */
export function getChildren<T extends TreeNote>(notes: T[], parentId: string): T[] {
  return notes.filter((note) => note.parent_note_id === parentId);
}

/** Ids of every note above `noteId`, nearest first. Stops on cycles. */
export function getAncestorIds(notes: TreeNote[], noteId: string): string[] {
  const parentById = new Map(notes.map((note) => [note.id, note.parent_note_id ?? null]));
  const ancestors: string[] = [];
  let current = parentById.get(noteId) ?? null;
  while (current && current !== noteId && !ancestors.includes(current)) {
    ancestors.push(current);
    current = parentById.get(current) ?? null;
  }
  return ancestors;
}

/** Ids of every note below `noteId`. Stops on cycles. */
export function getDescendantIds(notes: TreeNote[], noteId: string): Set<string> {
  const childrenById = new Map<string, string[]>();
  for (const note of notes) {
    if (!note.parent_note_id) continue;
    const list = childrenById.get(note.parent_note_id) ?? [];
    list.push(note.id);
    childrenById.set(note.parent_note_id, list);
  }
  const descendants = new Set<string>();
  const stack = [...(childrenById.get(noteId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === noteId || descendants.has(id)) continue;
    descendants.add(id);
    stack.push(...(childrenById.get(id) ?? []));
  }
  return descendants;
}

/** Notes that may become the parent of `noteId`: not itself and not below it. */
export function getParentCandidates<T extends TreeNote>(notes: T[], noteId: string | null): T[] {
  if (!noteId) return notes;
  const blocked = getDescendantIds(notes, noteId);
  blocked.add(noteId);
  return notes.filter((note) => !blocked.has(note.id));
}

/** Notes that may be attached under `parentId`: not itself, its ancestors, or its current children. */
export function getAttachCandidates<T extends TreeNote>(notes: T[], parentId: string): T[] {
  const ancestors = new Set(getAncestorIds(notes, parentId));
  return notes.filter(
    (note) => note.id !== parentId && !ancestors.has(note.id) && note.parent_note_id !== parentId,
  );
}

/** Dated notes first (earliest first), then undated notes by title. */
export function sortByScheduleThenTitle<T extends Pick<Note, 'title' | 'scheduled_date'>>(notes: T[]): T[] {
  return [...notes].sort((a, b) => {
    if (a.scheduled_date && b.scheduled_date) return a.scheduled_date.localeCompare(b.scheduled_date);
    if (a.scheduled_date) return -1;
    if (b.scheduled_date) return 1;
    return (a.title || '').localeCompare(b.title || '');
  });
}
