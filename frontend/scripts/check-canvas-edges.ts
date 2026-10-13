// Run from frontend/: node scripts/check-canvas-edges.ts
import assert from 'node:assert/strict';
import { convertToReactFlow, type BackendCanvasNode } from '../src/components/CanvasView/canvasUtils.ts';

function node(id: string, noteId: string, parentNoteId: string | null): BackendCanvasNode {
  return {
    id,
    canvas_id: 'c',
    position_x: 0,
    position_y: 0,
    note: {
      id: noteId,
      title: noteId,
      content: '',
      created_at: '',
      updated_at: '',
      scheduled_date: null,
      scheduled_time: null,
      status: 'todo',
      parent_note_id: parentNoteId,
    },
  };
}

const { edges } = convertToReactFlow([
  node('n-root', 'root', null),
  node('n-child', 'child', 'root'),
  // Parent lives on another canvas: no edge.
  node('n-offcanvas', 'offcanvas', 'elsewhere'),
  // Self-parent left over from bad data: no edge.
  node('n-self', 'self', 'self'),
]);

assert.deepEqual(
  edges.map((e) => [e.source, e.target]),
  [['n-root', 'n-child']],
);
console.log('canvas edge checks passed');
