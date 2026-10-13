import type { TimeStreamEvent } from './TimeStreamCanvas';

export interface StreamGroups {
  /** Events that keep their own lane. */
  laneEvents: TimeStreamEvent[];
  /** Child events drawn as dots on their parent's bar, keyed by parent note id. */
  markersByParent: Map<string, TimeStreamEvent[]>;
}

/**
 * Pull single-day, non-recurring children that fall inside their parent's span
 * onto the parent's bar. Every other event keeps its own lane.
 */
export function groupChildMarkers(events: TimeStreamEvent[]): StreamGroups {
  const spansByNoteId = new Map<string, TimeStreamEvent>();
  for (const ev of events) {
    if (ev.is_span && !ev.is_recurring) spansByNoteId.set(ev.note.id, ev);
  }

  const laneEvents: TimeStreamEvent[] = [];
  const markersByParent = new Map<string, TimeStreamEvent[]>();
  for (const ev of events) {
    const parent = ev.parent_note_id ? spansByNoteId.get(ev.parent_note_id) : undefined;
    if (
      parent &&
      !ev.is_recurring &&
      !ev.is_span &&
      ev.start_date >= parent.start_date &&
      ev.start_date <= parent.end_date
    ) {
      const list = markersByParent.get(parent.note.id) ?? [];
      list.push(ev);
      markersByParent.set(parent.note.id, list);
    } else {
      laneEvents.push(ev);
    }
  }
  return { laneEvents, markersByParent };
}
