// Run from frontend/: node scripts/check-stream-grouping.ts
import assert from 'node:assert/strict';
import { groupChildMarkers } from '../src/components/TimeStreamView/streamGrouping.ts';
import type { TimeStreamEvent } from '../src/components/TimeStreamView/TimeStreamCanvas.tsx';

function ev(id: string, start: string, end: string, extra: Partial<TimeStreamEvent> = {}): TimeStreamEvent {
  return {
    id,
    start_date: start,
    end_date: end,
    status: 'todo',
    canvas_name: null,
    is_span: start !== end,
    is_recurring: false,
    parent_note_id: null,
    note: { id } as TimeStreamEvent['note'],
    ...extra,
  };
}

const events = [
  ev('spanish', '2026-10-01', '2026-12-31'),
  ev('grammar', '2026-10-12', '2026-10-12', { parent_note_id: 'spanish' }),
  ev('outside', '2027-01-05', '2027-01-05', { parent_note_id: 'spanish' }),
  ev('podcast', '2026-11-01', '2026-11-20', { parent_note_id: 'spanish' }),
  ev('drill_2026-10-14', '2026-10-14', '2026-10-14', {
    parent_note_id: 'spanish',
    is_recurring: true,
    note: { id: 'drill' } as TimeStreamEvent['note'],
  }),
  ev('orphan', '2026-10-15', '2026-10-15', { parent_note_id: 'not-loaded' }),
  ev('solo', '2026-10-16', '2026-10-16'),
];

const { laneEvents, markersByParent } = groupChildMarkers(events);
assert.deepEqual(
  laneEvents.map((e) => e.id),
  ['spanish', 'outside', 'podcast', 'drill_2026-10-14', 'orphan', 'solo'],
);
assert.deepEqual([...markersByParent.keys()], ['spanish']);
assert.deepEqual(markersByParent.get('spanish')!.map((e) => e.id), ['grammar']);

// Edge dates are inside the span.
const edges = groupChildMarkers([
  ev('p', '2026-10-01', '2026-10-31'),
  ev('first', '2026-10-01', '2026-10-01', { parent_note_id: 'p' }),
  ev('last', '2026-10-31', '2026-10-31', { parent_note_id: 'p' }),
]);
assert.deepEqual(edges.markersByParent.get('p')!.map((e) => e.id), ['first', 'last']);

// A single-day parent is not a span, so its children keep their own lanes.
const flat = groupChildMarkers([
  ev('day', '2026-10-01', '2026-10-01'),
  ev('kid', '2026-10-01', '2026-10-01', { parent_note_id: 'day' }),
]);
assert.equal(flat.markersByParent.size, 0);
assert.equal(flat.laneEvents.length, 2);

console.log('stream grouping checks passed');
