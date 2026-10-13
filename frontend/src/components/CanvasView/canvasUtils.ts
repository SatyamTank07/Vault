import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';

const NODE_WIDTH = 236;
const NODE_HEIGHT = 96;

export interface BackendCanvasNode {
  id: string;
  canvas_id: string;
  note: {
    id: string;
    title: string;
    content: string;
    created_at: string;
    updated_at: string;
    scheduled_date: string | null;
    scheduled_time: string | null;
    status: string;
    end_date?: string | null;
    recurrence_rule?: string | null;
    recurrence_interval?: number;
    recurrence_end_date?: string | null;
    parent_note_id?: string | null;
    canvas_only?: boolean;
  };
  position_x: number;
  position_y: number;
}

export interface CanvasData {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  nodes: BackendCanvasNode[];
}

export interface CanvasListItem {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

/**
 * Convert backend canvas nodes to React Flow nodes and edges.
 */
export function convertToReactFlow(backendNodes: BackendCanvasNode[]): {
  nodes: Node[];
  edges: Edge[];
} {
  const nodeIdByNoteId = new Map(backendNodes.map((bn) => [bn.note.id, bn.id]));
  // Nodes whose parent note is also on this canvas.
  const childNodeIds = new Set(
    backendNodes
      .filter((bn) => bn.note.parent_note_id && nodeIdByNoteId.has(bn.note.parent_note_id))
      .map((bn) => bn.id),
  );
  const nodes: Node[] = backendNodes.map((bn) => ({
    id: bn.id,
    type: 'mindMapNode',
    position: { x: bn.position_x, y: bn.position_y },
    data: {
      isRoot: !childNodeIds.has(bn.id),
      title: bn.note.title || 'Untitled',
      noteId: bn.note.id,
      note: bn.note,
      scheduledDate: bn.note.scheduled_date,
      scheduledTime: bn.note.scheduled_time,
      status: bn.note.status || 'todo',
      recurrenceRule: bn.note.recurrence_rule,
    },
  }));

  const edges: Edge[] = backendNodes.flatMap((bn) => {
    const parentNodeId = bn.note.parent_note_id ? nodeIdByNoteId.get(bn.note.parent_note_id) : undefined;
    if (!parentNodeId || parentNodeId === bn.id) return [];
    return [
      {
        id: `e-${parentNodeId}-${bn.id}`,
        source: parentNodeId,
        target: bn.id,
        type: 'default',
        animated: false,
      },
    ];
  });

  return { nodes, edges };
}

/**
 * Auto-layout nodes using the dagre algorithm (top-to-bottom tree).
 * Returns new nodes array with updated positions.
 */
export function autoLayout(nodes: Node[], edges: Edge[]): Node[] {
  if (nodes.length === 0) return nodes;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 100, ranksep: 140, marginx: 40, marginy: 40 });

  nodes.forEach((node) => {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    };
  });
}
