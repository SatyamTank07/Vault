// Run from frontend/: node scripts/check-note-tree.ts
import assert from 'node:assert/strict';
import {
  getAncestorIds,
  getAttachCandidates,
  getChildren,
  getDescendantIds,
  getParentCandidates,
  parentSaveOrder,
  sortByScheduleThenTitle,
  withLiveHierarchy,
} from '../src/lib/noteTree.ts';

const notes = [
  { id: 'root', parent_note_id: null },
  { id: 'a', parent_note_id: 'root' },
  { id: 'b', parent_note_id: 'root' },
  { id: 'a1', parent_note_id: 'a' },
  { id: 'loose', parent_note_id: null },
  // A cycle left over from old canvas data must not hang anything.
  { id: 'x', parent_note_id: 'y' },
  { id: 'y', parent_note_id: 'x' },
];
const ids = (list: { id: string }[]) => list.map((n) => n.id).sort();

assert.deepEqual(ids(getChildren(notes, 'root')), ['a', 'b']);
assert.deepEqual(getAncestorIds(notes, 'a1'), ['a', 'root']);
assert.deepEqual(getAncestorIds(notes, 'root'), []);
assert.deepEqual([...getDescendantIds(notes, 'root')].sort(), ['a', 'a1', 'b']);
assert.deepEqual(ids(getParentCandidates(notes, 'a')), ['b', 'loose', 'root', 'x', 'y']);
assert.deepEqual(ids(getParentCandidates(notes, null)), ids(notes));
assert.deepEqual(ids(getAttachCandidates(notes, 'a')), ['b', 'loose', 'x', 'y']);
assert.deepEqual(getAncestorIds(notes, 'x'), ['y']);
assert.deepEqual([...getDescendantIds(notes, 'x')].sort(), ['y']);

const sorted = sortByScheduleThenTitle([
  { id: '1', title: 'Zeta', scheduled_date: null },
  { id: '2', title: 'Later', scheduled_date: '2026-11-02' },
  { id: '3', title: 'Alpha', scheduled_date: null },
  { id: '4', title: 'Sooner', scheduled_date: '2026-10-12' },
]);
assert.deepEqual(sorted.map((n) => n.id), ['4', '2', '3', '1']);

// Parent changes are saved before the note when setting (so a hide sticks) and after when clearing.
assert.equal(parentSaveOrder(null, 'p'), 'before');
assert.equal(parentSaveOrder('p', 'q'), 'before');
assert.equal(parentSaveOrder('p', null), 'after');
assert.equal(parentSaveOrder('p', 'p'), 'none');
assert.equal(parentSaveOrder(null, null), 'none');
assert.equal(parentSaveOrder('p', undefined), 'none');

// A stale copy (e.g. cached by the Calendar) takes its hierarchy fields from the live list.
const live = new Map([['n', { id: 'n', parent_note_id: 'p', canvas_only: true }]]);
const stale = { id: 'n', parent_note_id: null, canvas_only: false, scheduled_date: '2026-10-14' };
assert.deepEqual(withLiveHierarchy(stale, live), {
  id: 'n',
  parent_note_id: 'p',
  canvas_only: true,
  scheduled_date: '2026-10-14',
});
assert.equal(withLiveHierarchy(stale, new Map()), stale);

console.log('note tree checks passed');
