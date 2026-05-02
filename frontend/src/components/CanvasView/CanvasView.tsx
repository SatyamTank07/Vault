import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Plus } from 'lucide-react';
import MindMapNode from './MindMapNode';
import { CanvasSelector } from './CanvasSelector';
import {
  convertToReactFlow,
  autoLayout,
  type CanvasData,
  type CanvasListItem,
} from './canvasUtils';
import type { Note } from '../NoteCard/NoteCard';
import { NoteModal } from '../NoteModal/NoteModal';
import { ConfirmModal } from '../ConfirmModal/ConfirmModal';
import styles from './CanvasView.module.css';

const API_BASE_URL = 'http://localhost:8000';

interface CanvasViewProps {
  onOpenNote: (note: Note) => void;
  fetchNotes: () => void;
  notes: Note[];
}

export const CanvasView: React.FC<CanvasViewProps> = ({ onOpenNote, fetchNotes, notes }) => {
  const [canvases, setCanvases] = useState<CanvasListItem[]>([]);
  const [activeCanvasId, setActiveCanvasId] = useState<string | null>(
    localStorage.getItem('vault_last_canvas_id') || null
  );
  const [canvasData, setCanvasData] = useState<CanvasData | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);

  const dragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [confirmModalConfig, setConfirmModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const nodeTypes = useMemo(() => ({ mindMapNode: MindMapNode }), []);

  // ── Sync activeCanvasId to localStorage ─────────────────────
  useEffect(() => {
    if (activeCanvasId) {
      localStorage.setItem('vault_last_canvas_id', activeCanvasId);
    } else {
      localStorage.removeItem('vault_last_canvas_id');
    }
  }, [activeCanvasId]);

  // ── Fetch canvases list ───────────────────────────────────
  const fetchCanvases = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/canvases/`);
      if (res.ok) {
        const data: CanvasListItem[] = await res.json();
        setCanvases(data);

        // Auto-select logic
        if (data.length > 0) {
          const savedId = localStorage.getItem('vault_last_canvas_id');
          const savedExists = data.some((c) => c.id === savedId);
          if (savedExists) {
            setActiveCanvasId(savedId);
          } else {
            // Fallback to the first (most recent) canvas
            setActiveCanvasId(data[0].id);
          }
        } else {
          setActiveCanvasId(null);
        }
      }
    } catch (err) {
      console.error('Failed to fetch canvases:', err);
    }
  }, []);

  useEffect(() => {
    fetchCanvases();
  }, [fetchCanvases]);

  // ── Fetch active canvas data ──────────────────────────────
  const fetchCanvasData = useCallback(async (canvasId: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/canvases/${canvasId}`);
      if (res.ok) {
        const data: CanvasData = await res.json();
        setCanvasData(data);

        const { nodes: rfNodes, edges: rfEdges } = convertToReactFlow(data.nodes);
        const laid = autoLayout(rfNodes, rfEdges);
        setNodes(laid);
        setEdges(rfEdges);
      }
    } catch (err) {
      console.error('Failed to fetch canvas:', err);
    }
  }, [setNodes, setEdges]);

  useEffect(() => {
    if (activeCanvasId) {
      fetchCanvasData(activeCanvasId);
    } else {
      setCanvasData(null);
      setNodes([]);
      setEdges([]);
    }
  }, [activeCanvasId, fetchCanvasData, setNodes, setEdges]);

  // ── Inject callbacks into node data ───────────────────────
  // We need to inject onOpenNote, onAddBranch, onRemoveNode, onUpdateSchedule into every node's data
  // so MindMapNode can call them.
  useEffect(() => {
    setNodes((prev) =>
      prev.map((node) => ({
        ...node,
        data: {
          ...node.data,
          onOpenNote: (note: Note) => {
            onOpenNote(note);
          },
          onAddBranch: (nodeId: string) => handleAddBranch(nodeId),
          onRemoveNode: (nodeId: string) => handleRemoveNode(nodeId),
          onUpdateSchedule: (nodeId: string, date: string | null, status: string) =>
            handleUpdateSchedule(nodeId, date, status),
        },
      }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasData]);

  // ── Sync with global notes updates ────────────────────────
  useEffect(() => {
    setNodes((prevNodes) =>
      prevNodes.map((node) => {
        const globalNote = notes.find((n) => n.id === node.data.noteId);
        if (globalNote) {
          const currentNote = node.data.note as Note;
          if (
            globalNote.title !== node.data.title ||
            globalNote.content !== currentNote?.content ||
            globalNote.updated_at !== currentNote?.updated_at
          ) {
            return {
              ...node,
              data: {
                ...node.data,
                title: globalNote.title,
                note: globalNote,
              },
            };
          }
        }
        return node;
      })
    );
  }, [notes, setNodes]);

  // ── Canvas CRUD handlers ──────────────────────────────────
  const handleCreateCanvas = async (name: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/canvases/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const created = await res.json();
        setCanvases((prev) => [created, ...prev]);
        setActiveCanvasId(created.id);
      }
    } catch (err) {
      console.error('Failed to create canvas:', err);
    }
  };

  const handleRenameCanvas = async (id: string, name: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/canvases/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        setCanvases((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
      }
    } catch (err) {
      console.error('Failed to rename canvas:', err);
    }
  };

  const handleDeleteCanvas = (id: string) => {
    setConfirmModalConfig({
      isOpen: true,
      title: 'Delete Canvas',
      message: 'Are you sure you want to delete this canvas? All notes inside it will also be deleted permanently.',
      confirmText: 'Delete',
      onConfirm: async () => {
        setConfirmModalConfig((prev) => ({ ...prev, isOpen: false }));
        try {
          const res = await fetch(`${API_BASE_URL}/api/canvases/${id}`, { method: 'DELETE' });
          if (res.ok) {
            setCanvases((prev) => prev.filter((c) => c.id !== id));
            if (activeCanvasId === id) {
              setActiveCanvasId(null);
            }
            // The backend now deletes all notes in this canvas, so we must refresh the grid notes
            fetchNotes();
          }
        } catch (err) {
          console.error('Failed to delete canvas:', err);
        }
      }
    });
  };

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [parentNodeIdForNewNote, setParentNodeIdForNewNote] = useState<string | null>(null);

  // ── Node actions ──────────────────────────────────────────
  const handleAddRootNote = () => {
    if (!activeCanvasId) return;
    setParentNodeIdForNewNote(null);
    setIsCreateModalOpen(true);
  };

  const handleAddBranch = (parentNodeId: string) => {
    if (!activeCanvasId) return;
    setParentNodeIdForNewNote(parentNodeId);
    setIsCreateModalOpen(true);
  };

  const handleSaveNewCanvasNode = async (noteData: Omit<Note, 'created_at' | 'updated_at' | 'scheduled_date' | 'status'>) => {
    if (!activeCanvasId) return;

    try {
      // 1. Create the new note in the system
      const noteRes = await fetch(`${API_BASE_URL}/notes/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(noteData),
      });

      if (noteRes.ok) {
        const newNote = await noteRes.json();

        // 2. Add it to the canvas
        const canvasRes = await fetch(`${API_BASE_URL}/api/canvases/${activeCanvasId}/nodes/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            note_id: newNote.id,
            parent_node_id: parentNodeIdForNewNote,
            position_x: 0,
            position_y: 0,
          }),
        });

        if (canvasRes.ok) {
          fetchCanvasData(activeCanvasId);
          fetchNotes(); // sync grid view
        }
      }
    } catch (err) {
      console.error('Failed to create canvas node via modal:', err);
    }

    setIsCreateModalOpen(false);
    setParentNodeIdForNewNote(null);
  };

  const handleRemoveNode = (nodeId: string) => {
    if (!activeCanvasId) return;
    setConfirmModalConfig({
      isOpen: true,
      title: 'Remove Node',
      message: 'Remove this node from canvas? (Note will not be deleted)',
      confirmText: 'Remove',
      onConfirm: async () => {
        setConfirmModalConfig((prev) => ({ ...prev, isOpen: false }));
        try {
          const res = await fetch(
            `${API_BASE_URL}/api/canvases/${activeCanvasId}/nodes/${nodeId}`,
            { method: 'DELETE' }
          );
          if (res.ok) {
            fetchCanvasData(activeCanvasId);
          }
        } catch (err) {
          console.error('Failed to remove node:', err);
        }
      }
    });
  };

  // ── Schedule update (date & status) ───────────────────────
  const handleUpdateSchedule = async (nodeId: string, date: string | null, status: string) => {
    if (!activeCanvasId) return;

    // Optimistic update
    setNodes((prev) =>
      prev.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, scheduledDate: date, status } }
          : node
      )
    );

    try {
      await fetch(
        `${API_BASE_URL}/api/canvases/${activeCanvasId}/nodes/${nodeId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scheduled_date: date,
            clear_date: date === null,
            status,
          }),
        }
      );
    } catch (err) {
      console.error('Failed to update schedule:', err);
      // Revert on failure
      if (activeCanvasId) fetchCanvasData(activeCanvasId);
    }
  };

  // ── Drag position save (debounced) ────────────────────────
  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (!activeCanvasId) return;

      if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current);
      dragTimeoutRef.current = setTimeout(async () => {
        try {
          await fetch(
            `${API_BASE_URL}/api/canvases/${activeCanvasId}/nodes/${node.id}`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                position_x: node.position.x,
                position_y: node.position.y,
              }),
            }
          );
        } catch (err) {
          console.error('Failed to save node position:', err);
        }
      }, 500);
    },
    [activeCanvasId]
  );

  // ── Connect Nodes (Drag Edge) ─────────────────────────────
  const onConnect = useCallback(
    async (connection: Connection) => {
      if (!activeCanvasId) return;
      if (connection.source === connection.target) return;

      // Update visually first
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            type: 'default',
            animated: false,
          } as Edge,
          eds
        )
      );

      try {
        const res = await fetch(
          `${API_BASE_URL}/api/canvases/${activeCanvasId}/nodes/${connection.target}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parent_node_id: connection.source }),
          }
        );

        if (res.ok) {
          // Re-fetch to apply auto-layout since tree structure changed
          fetchCanvasData(activeCanvasId);
        } else {
          fetchCanvasData(activeCanvasId); // Revert on failure
        }
      } catch (err) {
        console.error('Failed to connect nodes:', err);
        fetchCanvasData(activeCanvasId);
      }
    },
    [activeCanvasId, setEdges, fetchCanvasData]
  );

  // ── Render ────────────────────────────────────────────────
  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <CanvasSelector
          canvases={canvases}
          activeCanvasId={activeCanvasId}
          onSelect={setActiveCanvasId}
          onCreate={handleCreateCanvas}
          onRename={handleRenameCanvas}
          onDelete={handleDeleteCanvas}
        />
        {activeCanvasId && (
          <button className={styles.addRootBtn} onClick={handleAddRootNote}>
            <Plus size={16} />
            Add Note
          </button>
        )}
      </div>

      <div className={styles.canvasArea}>
        {!activeCanvasId ? (
          <div className={styles.emptyState}>
            <p>Select a canvas or create a new one to start mapping your ideas.</p>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            onNodeDragStop={onNodeDragStop}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            minZoom={0.2}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
          >
            <Controls
              showInteractive={false}
              className={styles.controls}
            />
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1.5}
              color="rgba(139, 92, 246, 0.15)"
            />
          </ReactFlow>
        )}
      </div>

      <NoteModal
        isOpen={isCreateModalOpen}
        onClose={() => {
          setIsCreateModalOpen(false);
          setParentNodeIdForNewNote(null);
        }}
        onSave={handleSaveNewCanvasNode}
      />

      <ConfirmModal
        isOpen={confirmModalConfig.isOpen}
        title={confirmModalConfig.title}
        message={confirmModalConfig.message}
        confirmText={confirmModalConfig.confirmText}
        onConfirm={confirmModalConfig.onConfirm}
        onCancel={() => setConfirmModalConfig((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};
