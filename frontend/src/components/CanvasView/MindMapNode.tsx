import React, { memo } from 'react';
import { Handle, NodeToolbar, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { FileText, Plus, Repeat, X } from 'lucide-react';
import type { Note } from '../NoteCard/NoteCard';
import { describeRecurrence, formatNoteDate } from '../../lib/noteText';
import { DateChip } from '../ui/DateChip';
import { StatusPill } from '../ui/StatusControl';
import ui from '../ui/ui.module.css';
import styles from './MindMapNode.module.css';

export interface MindMapNodeData {
  title: string;
  noteId: string;
  note: Note;
  scheduledDate: string | null;
  scheduledTime: string | null;
  status: string;
  recurrenceRule: string | null;
  /** No parent on this canvas: drawn with an accent top bar. */
  isRoot?: boolean;
  onOpenNote?: (note: Note) => void;
  onAddBranch?: (nodeId: string) => void;
  onRemoveNode?: (nodeId: string) => void;
  onUpdateSchedule?: (nodeId: string, date: string | null, time: string | null, status: string) => void;
  onRecurrenceClick?: (note: Note) => void;
}

const MindMapNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const nodeData = data as unknown as MindMapNodeData;
  const status = nodeData.status || 'todo';
  const repeatLabel = nodeData.recurrenceRule ? `Repeats: ${describeRecurrence(nodeData.note)}. Edit` : 'Set repeat';
  const dateText = formatNoteDate({
    scheduled_date: nodeData.scheduledDate,
    scheduled_time: nodeData.scheduledTime,
    end_date: nodeData.note?.end_date,
  });

  return (
    <div
      className={`${styles.node} ${selected ? styles.selected : ''} ${nodeData.isRoot ? styles.root : ''} ${
        status === 'done' ? styles.done : ''
      }`}
    >
      <NodeToolbar isVisible={selected} position={Position.Top} offset={10}>
        <div className={`${styles.bar} nodrag nopan`}>
          <button type="button" className={styles.barPrimary} onClick={() => nodeData.onOpenNote?.(nodeData.note)}>
            <FileText size={14} />
            Open
          </button>
          <span className={styles.barSep} />
          <button type="button" onClick={() => nodeData.onAddBranch?.(id)}>
            <Plus size={14} />
            Add branch
          </button>
          <button type="button" className={styles.barDanger} onClick={() => nodeData.onRemoveNode?.(id)}>
            <X size={14} />
            Remove
          </button>
        </div>
      </NodeToolbar>

      <Handle type="target" position={Position.Top} className={styles.handle} />

      <div className={styles.head}>
        <button
          type="button"
          className={`${styles.title} nodrag`}
          onClick={(event) => {
            event.stopPropagation();
            nodeData.onOpenNote?.(nodeData.note);
          }}
          title="Open note"
        >
          {nodeData.title || 'Untitled'}
        </button>
        {nodeData.scheduledDate && (
          <button
            type="button"
            className={`${ui.iconBtn} ${ui.iconSm} ${nodeData.recurrenceRule ? ui.on : ''} nodrag`}
            onClick={(event) => {
              event.stopPropagation();
              nodeData.onRecurrenceClick?.(nodeData.note);
            }}
            title={repeatLabel}
            aria-label={repeatLabel}
          >
            <Repeat size={14} />
          </button>
        )}
      </div>

      <div className={styles.meta}>
        <StatusPill
          status={status}
          label={nodeData.title}
          onChange={(next) => nodeData.onUpdateSchedule?.(id, nodeData.scheduledDate, nodeData.scheduledTime, next)}
        />
        <DateChip
          date={nodeData.scheduledDate}
          text={dateText}
          onChange={(date) => nodeData.onUpdateSchedule?.(id, date, date ? nodeData.scheduledTime : null, status)}
        />
      </div>

      <Handle type="source" position={Position.Bottom} className={styles.handle} />
    </div>
  );
};

export default memo(MindMapNode);
