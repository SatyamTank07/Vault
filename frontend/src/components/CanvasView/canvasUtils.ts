import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';

const NODE_WIDTH = 220;
const NODE_HEIGHT = 64;

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
    status: string;
  };
  parent_node_id: string | null;
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
  const nodes: Node[] = backendNodes.map((bn) => ({
    id: bn.id,
    type: 'mindMapNode',
    position: { x: bn.position_x, y: bn.position_y },
    data: {
      title: bn.note.title || 'Untitled',
      noteId: bn.note.id,
      note: bn.note,
      scheduledDate: bn.note.scheduled_date,
      status: bn.note.status || 'todo',
    },
  }));

  const edges: Edge[] = backendNodes
    .filter((bn) => bn.parent_node_id !== null)
    .map((bn) => ({
      id: `e-${bn.parent_node_id}-${bn.id}`,
      source: bn.parent_node_id!,
      target: bn.id,
      type: 'default',
      animated: false,
      style: { stroke: '#8B5CF6', strokeWidth: 2 },
    }));

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
