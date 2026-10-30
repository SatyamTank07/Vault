import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Lock, Wand2 } from 'lucide-react';
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  Panel,
  useViewport,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { referencedUploads } from '../../lib/api';
import { buildCanvas, buildCanvasList, enqueue, getView, useReplica } from '../../lib/replica';
import { useResolvedTheme } from '../../lib/theme';
import { decryptNote, encryptNote } from '../../lib/crypto';
import type { Note } from '../NoteCard/NoteCard';
import { ConfirmModal } from '../ConfirmModal/ConfirmModal';
import { NoteModal } from '../NoteModal/NoteModal';
import MindMapNode from './MindMapNode';
import { CanvasSelector } from './CanvasSelector';
import { Toolbar } from '../ui/Toolbar';
import ui from '../ui/ui.module.css';
import { autoLayout, convertToReactFlow, type CanvasData, type CanvasListItem } from './canvasUtils';
import styles from './CanvasView.module.css';

function ZoomChip() {
  const { zoom } = useViewport();
  return <span className={styles.zoomChip}>{Math.round(zoom * 100)}%</span>;
}

export interface CanvasViewActions {
  /** Open the new-note flow on the active canvas. Returns false when no canvas is open. */
  createNote: () => boolean;
}

interface CanvasViewProps {
  actionsRef?: React.Ref<CanvasViewActions>;
  currentUserId: string;
  onOpenNote: (note: Note) => void;
  onRecurrenceClick: (note: Note) => void;
  notes: Note[];
  cryptoKey: CryptoKey | null;
}

export const CanvasView: React.FC<CanvasViewProps> = ({
  actionsRef,
  currentUserId,
  onOpenNote,
  onRecurrenceClick,
  notes,
  cryptoKey,
}) => {
  const storageKey = useMemo(() => `vault_last_canvas_id_${currentUserId}`, [currentUserId]);
  const replica = useReplica();
  // Re-read from the local copy only when something on screen changed, not on every sync.
  const canvasListKey = useMemo(() => JSON.stringify(replica?.canvases ?? []), [replica]);
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
  const theme = useResolvedTheme();

  // Edges touching a selected node are drawn in the accent color.
  const styledEdges = useMemo(() => {
    const selectedIds = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
    if (selectedIds.size === 0) return edges;
    return edges.map((e) =>
      selectedIds.has(e.source) || selectedIds.has(e.target) ? { ...e, className: styles.hotEdge } : e,
    );
  }, [nodes, edges]);

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
    const data = buildCanvasList(getView()) as unknown as CanvasListItem[];
    setCanvases(data);

    if (data.length > 0) {
      const savedId = localStorage.getItem(storageKey);
      const savedExists = data.some((canvas) => canvas.id === savedId);
      setActiveCanvasId(savedExists ? savedId : data[0].id);
    } else {
      setActiveCanvasId(null);
    }
  }, [storageKey]);

  useEffect(() => {
    fetchCanvases();
  }, [fetchCanvases, canvasListKey]);

  const activeCanvasKey = useMemo(
    () => (activeCanvasId && replica ? JSON.stringify(buildCanvas(replica, activeCanvasId) ?? null) : ''),
    [replica, activeCanvasId],
  );

  const fetchCanvasData = useCallback(
    async (canvasId: string) => {
      try {
        const data = buildCanvas(getView(), canvasId) as CanvasData | undefined;
        if (data) {

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
  }, [activeCanvasId, activeCanvasKey, fetchCanvasData, setEdges, setNodes]);

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
    const id = crypto.randomUUID();
    await enqueue('create_canvas', { id, name });
    setActiveCanvasId(id);
  };

  const handleRenameCanvas = async (id: string, name: string) => {
    await enqueue('rename_canvas', { id, name });
  };

  const handleDeleteCanvas = (id: string) => {
    setConfirmModalConfig({
      isOpen: true,
      title: 'Delete canvas',
      message: 'Notes that live only on this canvas will be deleted for good. Notes shown in Grid and Schedule are kept.',
      confirmText: 'Delete',
      onConfirm: async () => {
        setConfirmModalConfig((prev) => ({ ...prev, isOpen: false }));
        if (activeCanvasId === id) {
          setActiveCanvasId(null);
        }
        await enqueue('delete_canvas', { id });
      },
    });
  };

  useImperativeHandle(
    actionsRef,
    () => ({
      createNote: () => {
        if (!activeCanvasId) return false;
        setParentNodeIdForNewNote(null);
        setIsCreateModalOpen(true);
        return true;
      },
    }),
    [activeCanvasId],
  );

  const handleAddBranch = (parentNodeId: string) => {
    if (!activeCanvasId) return;
    setParentNodeIdForNewNote(parentNodeId);
    setIsCreateModalOpen(true);
  };

  const handleSaveNewCanvasNode = async (
    noteData: Omit<Note, 'created_at' | 'updated_at'>,
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
      // The parent and canvas_only go with the node call, not the note call: the
      // note call would mirror a duplicate node, and the visibility rule would
      // reset canvas_only before the node exists.
      const parentNodeData = parentNodeIdForNewNote
        ? (nodes.find((n) => n.id === parentNodeIdForNewNote)?.data as { noteId?: string } | undefined)
        : undefined;
      const parentNoteId = parentNodeData?.noteId ?? noteData.parent_note_id ?? null;
      const notePayload = {
        ...noteData,
        parent_note_id: null,
        canvas_only: false,
        referenced_uploads: referencedUploads(noteData.content, noteData.id),
      };

      // Encrypt note before sending
      const dataToSend = cryptoKey ? await encryptNote(notePayload, cryptoKey) : notePayload;

      await enqueue('create_note', dataToSend);
      await enqueue('create_canvas_node', {
        canvas_id: activeCanvasId,
        id: crypto.randomUUID(),
        note_id: noteData.id,
        parent_note_id: parentNoteId,
        canvas_only: noteData.canvas_only ?? true,
        position_x: newX,
        position_y: newY,
      });
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
      title: 'Remove from canvas',
      message: 'The node leaves this canvas. The note itself is kept.',
      confirmText: 'Remove',
      onConfirm: async () => {
        setConfirmModalConfig((prev) => ({ ...prev, isOpen: false }));
        await enqueue('delete_canvas_node', { id: nodeId });
      },
    });
  };

  const handleUpdateSchedule = async (nodeId: string, date: string | null, time: string | null, status: string) => {
    if (!activeCanvasId) return;

    const nodeToUpdate = nodes.find((node) => node.id === nodeId);
    if (!nodeToUpdate) return;
    const noteId = (nodeToUpdate.data as { noteId: string }).noteId;

    // Clearing the date also clears the repeat (the server does the same).
    const clearedRepeat =
      date === null
        ? {
            recurrenceRule: null,
            note: { ...(nodeToUpdate.data.note as object), recurrence_rule: null, recurrence_interval: 1, recurrence_end_date: null },
          }
        : {};
    setNodes((prev) =>
      prev.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, scheduledDate: date, scheduledTime: time, status, ...clearedRepeat } }
          : node,
      ),
    );

    await enqueue('set_schedule', {
      id: noteId,
      scheduled_date: date,
      scheduled_time: time,
      clear_date: date === null,
      clear_time: time === null,
      status,
    });
  };

  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (!activeCanvasId) return;

      if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current);
      dragTimeoutRef.current = setTimeout(() => {
        void enqueue('move_canvas_node', { id: node.id, position_x: node.position.x, position_y: node.position.y });
      }, 500);
    },
    [activeCanvasId],
  );

  const onConnect = useCallback(
    async (connection: Connection) => {
      if (!activeCanvasId) return;
      if (connection.source === connection.target) return;

      const noteIdOf = (nodeId: string | null) =>
        (nodes.find((n) => n.id === nodeId)?.data as { noteId?: string } | undefined)?.noteId;
      const sourceNoteId = noteIdOf(connection.source);
      const targetNoteId = noteIdOf(connection.target);
      if (!sourceNoteId || !targetNoteId) return;

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

      // A note has one parent, so the local copy re-derives the edges (an old edge may disappear).
      await enqueue('set_parent', { id: targetNoteId, parent_note_id: sourceNoteId });
    },
    [activeCanvasId, nodes, setEdges],
  );

  const handleAutoLayout = async () => {
    if (!activeCanvasId || nodes.length === 0) return;
    const laidOutNodes = autoLayout(nodes, edges);
    setNodes(laidOutNodes);
    
    for (const node of laidOutNodes) {
      await enqueue('move_canvas_node', { id: node.id, position_x: node.position.x, position_y: node.position.y });
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
      <Toolbar
        left={
          <CanvasSelector
            canvases={canvases}
            activeCanvasId={activeCanvasId}
            onSelect={setActiveCanvasId}
            onCreate={handleCreateCanvas}
            onRename={handleRenameCanvas}
            onDelete={handleDeleteCanvas}
          />
        }
        right={
          activeCanvasId ? (
            <button
              type="button"
              className={`${ui.btn} ${ui.ghost} ${ui.sm}`}
              onClick={handleAutoLayout}
              disabled={nodes.length === 0}
            >
              <Wand2 size={14} />
              Auto layout
            </button>
          ) : null
        }
      />

      <div className={styles.canvasArea}>
        {!activeCanvasId ? (
          <div className={ui.empty}>
            <strong>{canvases.length ? 'Pick a canvas' : 'No canvases yet'}</strong>
            {canvases.length
              ? 'Choose one from the canvas menu to start mapping.'
              : 'Create one from the canvas menu to start mapping your ideas.'}
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={styledEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            onNodeDragStop={onNodeDragStop}
            colorMode={theme}
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 1.1 }}
            minZoom={0.2}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
          >
            <Controls showInteractive={false} className={styles.controls} position="bottom-left" />
            <Background variant={BackgroundVariant.Dots} gap={24} size={1.3} color="var(--grid-dot)" />
            <Panel position="bottom-right">
              <ZoomChip />
            </Panel>
            {nodes.length === 0 && (
              <Panel position="top-center" className={styles.emptyPanel}>
                <div className={ui.empty}>
                  <strong>This canvas is empty</strong>
                  Use New note to add the first node.
                </div>
              </Panel>
            )}
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
        cryptoKey={cryptoKey}
        allNotes={notes}
        defaultCanvasOnly={true}
        canvasName={canvases.find((c) => c.id === activeCanvasId)?.name ?? null}
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
