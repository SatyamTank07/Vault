import React, { memo, useRef } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Plus, X, Calendar, Repeat } from 'lucide-react';
import styles from './MindMapNode.module.css';

interface MindMapNodeData {
  title: string;
  noteId: string;
  note: {
    id: string;
    title: string;
    content: string;
    created_at: string;
    updated_at: string;
    recurrence_rule?: string | null;
    recurrence_interval?: number;
    recurrence_end_date?: string | null;
  };
  scheduledDate: string | null;
  scheduledTime: string | null;
  status: string;
  recurrenceRule: string | null;
  onOpenNote?: (note: any) => void;
  onAddBranch?: (nodeId: string) => void;
  onRemoveNode?: (nodeId: string) => void;
  onUpdateSchedule?: (nodeId: string, date: string | null, time: string | null, status: string) => void;
  onRecurrenceClick?: (note: any) => void;
}

const STATUS_CYCLE: Record<string, string> = {
  todo: 'in_progress',
  in_progress: 'done',
  done: 'todo',
};

const STATUS_LABELS: Record<string, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
};

const RECURRENCE_LABELS: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

function buildRecurrenceTooltip(note: any): string {
  if (!note.recurrence_rule) return 'Set recurrence';
  const rule = RECURRENCE_LABELS[note.recurrence_rule] || note.recurrence_rule;
  const interval = note.recurrence_interval || 1;
  const freq = interval === 1
    ? rule
    : `Every ${interval} ${note.recurrence_rule === 'daily' ? 'days' : note.recurrence_rule === 'weekly' ? 'weeks' : 'months'}`;
  const end = note.recurrence_end_date
    ? ` until ${new Date(note.recurrence_end_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    : ' · Forever';
  return `${freq}${end} — Click to edit`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const MindMapNode: React.FC<NodeProps> = ({ id, data }) => {
  const nodeData = data as unknown as MindMapNodeData;
  const dateInputRef = useRef<HTMLInputElement>(null);
  const timeInputRef = useRef<HTMLInputElement>(null);

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const newDate = e.target.value || null;
    nodeData.onUpdateSchedule?.(id, newDate, nodeData.scheduledTime, nodeData.status || 'todo');
  };

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const newTime = e.target.value || null;
    nodeData.onUpdateSchedule?.(id, nodeData.scheduledDate, newTime, nodeData.status || 'todo');
  };

  const handleStatusClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const currentStatus = nodeData.status || 'todo';
    const nextStatus = STATUS_CYCLE[currentStatus] || 'todo';
    nodeData.onUpdateSchedule?.(id, nodeData.scheduledDate, nodeData.scheduledTime, nextStatus);
  };

  const handleCalendarClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    dateInputRef.current?.showPicker();
  };

  const handleRecurrenceClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    nodeData.onRecurrenceClick?.(nodeData.note);
  };

  return (
    <div className={styles.node}>
      <Handle type="target" position={Position.Top} className={styles.handle} />
      
      <div className={styles.titleRow}>
        <div
          className={styles.titleArea}
          onClick={() => nodeData.onOpenNote?.(nodeData.note)}
          title="Click to view / edit note"
        >
          <span className={styles.icon}>📝</span>
          <span className={styles.title}>{nodeData.title}</span>
        </div>

        {nodeData.scheduledDate && (
          <button
            className={`${styles.recurrenceBtn} ${nodeData.recurrenceRule ? styles.recurrenceBtnActive : ''}`}
            onClick={handleRecurrenceClick}
            title={buildRecurrenceTooltip(nodeData.note)}
          >
            <Repeat size={13} />
          </button>
        )}

        <button
          className={styles.dateBtn}
          onClick={handleCalendarClick}
          title="Set scheduled date"
        >
          <Calendar size={13} />
          <input
            ref={dateInputRef}
            type="date"
            className={styles.hiddenDateInput}
            value={nodeData.scheduledDate || ''}
            onChange={handleDateChange}
            onClick={(e) => e.stopPropagation()}
          />
        </button>
      </div>

      {/* Status pill (always visible) + date (when set) */}
      <div className={styles.metaRow}>
        <button
          className={`${styles.statusPill} ${styles[`status_${nodeData.status || 'todo'}`]}`}
          onClick={handleStatusClick}
          title={`Click to change status (${STATUS_LABELS[nodeData.status || 'todo']})`}
        >
          <span className={styles.statusPillDot} />
          {STATUS_LABELS[nodeData.status || 'todo']}
        </button>
        {nodeData.scheduledDate && (
          <>
            <span className={styles.dateSep}>·</span>
            <span className={styles.dateText}>{formatDate(nodeData.scheduledDate)}</span>
            <button
              className={styles.timeBtn}
              onClick={(e) => { e.stopPropagation(); timeInputRef.current?.showPicker(); }}
              title="Set scheduled time"
            >
              <span className={styles.timeText}>{nodeData.scheduledTime || '--:--'}</span>
              <input
                ref={timeInputRef}
                type="time"
                className={styles.hiddenDateInput}
                value={nodeData.scheduledTime || ''}
                onChange={handleTimeChange}
                onClick={(e) => e.stopPropagation()}
              />
            </button>
          </>
        )}
      </div>

      <div className={styles.actions}>
        <button
          className={styles.branchBtn}
          onClick={(e) => {
            e.stopPropagation();
            nodeData.onAddBranch?.(id);
          }}
          title="Add branch"
        >
          <Plus size={14} />
        </button>
        <button
          className={styles.removeBtn}
          onClick={(e) => {
            e.stopPropagation();
            nodeData.onRemoveNode?.(id);
          }}
          title="Remove from canvas"
        >
          <X size={14} />
        </button>
      </div>

      <Handle type="source" position={Position.Bottom} className={styles.handle} />
    </div>
  );
};

export default memo(MindMapNode);
