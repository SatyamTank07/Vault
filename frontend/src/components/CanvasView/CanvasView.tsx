import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Lock, Plus, Wand2 } from 'lucide-react';
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { apiFetch } from '../../lib/api';
import { decryptNote, encryptNote } from '../../lib/crypto';
import type { Note } from '../NoteCard/NoteCard';
import { ConfirmModal } from '../ConfirmModal/ConfirmModal';
import { NoteModal } from '../NoteModal/NoteModal';
import MindMapNode from './MindMapNode';
import { CanvasSelector } from './CanvasSelector';
import { autoLayout, convertToReactFlow, type CanvasData, type CanvasListItem } from './canvasUtils';
import styles from './CanvasView.module.css';

interface CanvasViewProps {
  currentUserId: string;
  onOpenNote: (note: Note) => void;
  onRecurrenceClick: (note: Note) => void;
  fetchNotes: () => void;
  notes: Note[];
  cryptoKey: CryptoKey | null;
}

export const CanvasView: React.FC<CanvasViewProps> = ({
  currentUserId,
  onOpenNote,
  onRecurrenceClick,
  fetchNotes,
  notes,
  cryptoKey,
}) => {
  const storageKey = useMemo(() => `vault_last_canvas_id_${currentUserId}`, [currentUserId]);
  const [canvases, setCanvases] = useState<CanvasListItem[]>([]);
  const [activeCanvasId, setActiveCanvasId] = useState<string | null>(() => localStorage.getItem(storageKey) || null);
  const [canvasData, setCanvasData] = useState<CanvasData | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [parentNodeIdForNewNote, setParentNodeIdForNewNote] = useState<string | null>(null);
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

  useEffect(() => {
    setActiveCanvasId(localStorage.getItem(storageKey) || null);
  }, [storageKey]);

  useEffect(() => {
    if (activeCanvasId) {
      localStorage.setItem(storageKey, activeCanvasId);
    } else {
      localStorage.removeItem(storageKey);
    }
  }, [activeCanvasId, storageKey]);

  const fetchCanvases = useCallback(async () => {
    try {
      const response = await apiFetch('/api/canvases/');
      if (response.ok) {
        const data: CanvasListItem[] = await response.json();
        setCanvases(data);

        if (data.length > 0) {
          const savedId = localStorage.getItem(storageKey);
          const savedExists = data.some((canvas) => canvas.id === savedId);
          setActiveCanvasId(savedExists ? savedId : data[0].id);
        } else {
          setActiveCanvasId(null);
        }
      }
    } catch (error) {
      console.error('Failed to fetch canvases:', error);
    }
  }, [storageKey]);

  useEffect(() => {
    fetchCanvases();
  }, [fetchCanvases]);

  const fetchCanvasData = useCallback(
    async (canvasId: string) => {
      try {
        const response = await apiFetch(`/api/canvases/${canvasId}`);
        if (response.ok) {
          const data: CanvasData = await response.json();

          // Decrypt note titles and content in canvas nodes
          if (cryptoKey) {
            for (const node of data.nodes) {
              if (node.note) {
                const { note: decrypted } = await decryptNote(node.note as unknown as Note, cryptoKey);
                node.note = decrypted as unknown as typeof node.note;
              }
            }
          }

          setCanvasData(data);

          const { nodes: flowNodes, edges: flowEdges } = convertToReactFlow(data.nodes);
          
          // Only auto-layout if it's a brand new or completely untouched canvas (all nodes at 0,0)
          const allZero = flowNodes.length > 0 && flowNodes.every(n => n.position.x === 0 && n.position.y === 0);
          
          if (allZero) {
            const laidOutNodes = autoLayout(flowNodes, flowEdges);
            setNodes(laidOutNodes);
          } else {
            setNodes(flowNodes);
          }
          
          setEdges(flowEdges);
        }
      } catch (error) {
        console.error('Failed to fetch canvas:', error);
      }
    },
    [setEdges, setNodes, cryptoKey],
  );

  useEffect(() => {
    if (activeCanvasId) {
      fetchCanvasData(activeCanvasId);
    } else {
      setCanvasData(null);
      setNodes([]);
      setEdges([]);
    }
  }, [activeCanvasId, fetchCanvasData, setEdges, setNodes]);

  useEffect(() => {
    setNodes((prev) =>
      prev.map((node) => ({
        ...node,
        data: {
          ...node.data,
          onOpenNote: (note: Note) => onOpenNote(note),
          onAddBranch: (nodeId: string) => handleAddBranch(nodeId),
          onRemoveNode: (nodeId: string) => handleRemoveNode(nodeId),
          onUpdateSchedule: (nodeId: string, date: string | null, time: string | null, status: string) =>
            handleUpdateSchedule(nodeId, date, time, status),
          onRecurrenceClick: (note: Note) => onRecurrenceClick(note),
        },
      })),
    );
  }, [canvasData, onOpenNote, onRecurrenceClick, setNodes]);

  useEffect(() => {
    setNodes((prevNodes) =>
      prevNodes.map((node) => {
        const globalNote = notes.find((note) => note.id === node.data.noteId);
        if (!globalNote) {
          return node;
        }

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

        return node;
      }),
    );
  }, [notes, setNodes]);

  const handleCreateCanvas = async (name: string) => {
    try {
      const response = await apiFetch('/api/canvases/', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      if (response.ok) {
        const created = await response.json();
        setCanvases((prev) => [created, ...prev]);
        setActiveCanvasId(created.id);
      }
    } catch (error) {
      console.error('Failed to create canvas:', error);
    }
  };

  const handleRenameCanvas = async (id: string, name: string) => {
    try {
      const response = await apiFetch(`/api/canvases/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      });
      if (response.ok) {
        setCanvases((prev) => prev.map((canvas) => (canvas.id === id ? { ...canvas, name } : canvas)));
      }
    } catch (error) {
      console.error('Failed to rename canvas:', error);
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
          const response = await apiFetch(`/api/canvases/${id}`, { method: 'DELETE' });
          if (response.ok) {
            setCanvases((prev) => prev.filter((canvas) => canvas.id !== id));
            if (activeCanvasId === id) {
              setActiveCanvasId(null);
            }
            fetchNotes();
          }
        } catch (error) {
          console.error('Failed to delete canvas:', error);
        }
      },
    });
  };

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

  const handleSaveNewCanvasNode = async (
    noteData: Omit<Note, 'created_at' | 'updated_at' | 'scheduled_date' | 'scheduled_time' | 'status'>,
  ) => {
    if (!activeCanvasId) return;

    let newX = 0;
    let newY = 0;
    
    if (parentNodeIdForNewNote) {
      const parentNode = nodes.find((n) => n.id === parentNodeIdForNewNote);
      if (parentNode) {
        const siblingCount = edges.filter((e) => e.source === parentNodeIdForNewNote).length;
        // Stagger siblings horizontally to avoid perfect overlap
        newX = parentNode.position.x + (siblingCount > 0 ? (siblingCount % 2 === 0 ? siblingCount * 120 : -siblingCount * 120) : 0);
        newY = parentNode.position.y + 160;
      }
    } else if (nodes.length > 0) {
      // Find right-most root node to place next to it
      const maxX = Math.max(...nodes.map((n) => n.position.x));
      newX = maxX + 260;
      newY = nodes[0].position.y;
    }

    try {
      // Encrypt note before sending
      const dataToSend = cryptoKey ? await encryptNote(noteData, cryptoKey) : noteData;

      const noteResponse = await apiFetch('/notes/', {
        method: 'POST',
        body: JSON.stringify(dataToSend),
      });

      if (noteResponse.ok) {
        const newNote = await noteResponse.json();
        const canvasResponse = await apiFetch(`/api/canvases/${activeCanvasId}/nodes/`, {
          method: 'POST',
          body: JSON.stringify({
            note_id: newNote.id,
            parent_node_id: parentNodeIdForNewNote,
            position_x: newX,
            position_y: newY,
          }),
        });

        if (canvasResponse.ok) {
          fetchCanvasData(activeCanvasId);
          fetchNotes();
        }
      }
    } catch (error) {
      console.error('Failed to create canvas node via modal:', error);
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
          const response = await apiFetch(`/api/canvases/${activeCanvasId}/nodes/${nodeId}`, {
            method: 'DELETE',
          });
          if (response.ok) {
            fetchCanvasData(activeCanvasId);
          }
        } catch (error) {
          console.error('Failed to remove node:', error);
        }
      },
    });
  };

  const handleUpdateSchedule = async (nodeId: string, date: string | null, time: string | null, status: string) => {
    if (!activeCanvasId) return;

    const nodeToUpdate = nodes.find((node) => node.id === nodeId);
    if (!nodeToUpdate) return;
    const noteId = (nodeToUpdate.data as { noteId: string }).noteId;

    setNodes((prev) =>
      prev.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, scheduledDate: date, scheduledTime: time, status } } : node,
      ),
    );

    try {
      const response = await apiFetch(`/api/notes/${noteId}/schedule`, {
        method: 'PUT',
        body: JSON.stringify({
          scheduled_date: date,
          scheduled_time: time,
          clear_date: date === null,
          clear_time: time === null,
          status,
        }),
      });

      if (!response.ok && activeCanvasId) {
        fetchCanvasData(activeCanvasId);
      } else {
        fetchNotes();
      }
    } catch (error) {
      console.error('Failed to update schedule:', error);
      if (activeCanvasId) {
        fetchCanvasData(activeCanvasId);
      }
    }
  };

  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (!activeCanvasId) return;

      if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current);
      dragTimeoutRef.current = setTimeout(async () => {
        try {
          await apiFetch(`/api/canvases/${activeCanvasId}/nodes/${node.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              position_x: node.position.x,
              position_y: node.position.y,
            }),
          });
        } catch (error) {
          console.error('Failed to save node position:', error);
        }
      }, 500);
    },
    [activeCanvasId],
  );

  const onConnect = useCallback(
    async (connection: Connection) => {
      if (!activeCanvasId) return;
      if (connection.source === connection.target) return;

      setEdges((prevEdges) =>
        addEdge(
          {
            ...connection,
            type: 'default',
            animated: false,
          } as Edge,
          prevEdges,
        ),
      );

      try {
        const response = await apiFetch(`/api/canvases/${activeCanvasId}/nodes/${connection.target}`, {
          method: 'PUT',
          body: JSON.stringify({ parent_node_id: connection.source }),
        });

        if (response.ok) {
          fetchCanvasData(activeCanvasId);
        } else {
          fetchCanvasData(activeCanvasId);
        }
      } catch (error) {
        console.error('Failed to connect nodes:', error);
        fetchCanvasData(activeCanvasId);
      }
    },
    [activeCanvasId, fetchCanvasData, setEdges],
  );

  const handleAutoLayout = async () => {
    if (!activeCanvasId || nodes.length === 0) return;
    const laidOutNodes = autoLayout(nodes, edges);
    setNodes(laidOutNodes);
    
    // Save new positions to backend in background
    for (const node of laidOutNodes) {
      try {
        await apiFetch(`/api/canvases/${activeCanvasId}/nodes/${node.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            position_x: node.position.x,
            position_y: node.position.y,
          }),
        });
      } catch (error) {
        console.error('Failed to save layout position', error);
      }
    }
  };

  // Null-key guard
  if (!cryptoKey) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <Lock size={32} />
          <p>Vault locked</p>
        </div>
      </div>
    );
  }

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
          <div className={styles.canvasActions}>
            <button className={styles.addRootBtn} onClick={handleAutoLayout} title="Auto Layout Canvas">
              <Wand2 size={16} />
              Auto Layout
            </button>
            <button className={styles.addRootBtn} onClick={handleAddRootNote}>
              <Plus size={16} />
              Add Note
            </button>
          </div>
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
            <Controls showInteractive={false} className={styles.controls} />
            <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color="rgba(139, 92, 246, 0.15)" />
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
