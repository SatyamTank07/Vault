import React from 'react';
import { Repeat, SkipForward } from 'lucide-react';
import type { Note } from '../NoteCard/NoteCard';
import { describeRecurrence, formatDateRange, formatTime } from '../../lib/noteText';
import { StatusDot } from '../ui/StatusControl';
import ui from '../ui/ui.module.css';
import styles from './TimelineView.module.css';

export interface TimelineTask {
  id: string;
  canvas_id: string;
  canvas_name: string | null;
  note: {
    id: string;
    title: string;
    content: string;
    created_at: string | null;
    updated_at: string | null;
    recurrence_interval?: number;
  };
  scheduled_date: string;
  scheduled_time: string | null;
  status: string;
  is_recurring: boolean;
  occurrence_id: string | null;
  recurrence_rule: string | null;
  is_span?: boolean;
  start_date?: string;
  end_date?: string;
}

export type StatusChangeHandler = (taskId: string, newStatus: string, occurrenceId?: string | null) => void;

interface TaskRowProps {
  task: TimelineTask;
  /** Title of the note this task is grouped under, shown as "↳ parent". */
  parentTitle?: string;
  /** Hide the time in the meta line (the agenda already shows it in the rail). */
  hideTime?: boolean;
  onOpenNote: (note: Note) => void;
  onStatusChange: StatusChangeHandler;
  onSkip?: (occurrenceId: string) => void;
}

/** One task in a day column or agenda: status dot, title, canvas · time · repeat · parent. */
export const TaskRow: React.FC<TaskRowProps> = ({ task, parentTitle, hideTime, onOpenNote, onStatusChange, onSkip }) => {
  const title = task.note.title || 'Untitled';
  const meta: React.ReactNode[] = [];
  if (task.canvas_name) meta.push(<span key="cv" className={styles.metaCanvas}>{task.canvas_name}</span>);
  if (task.scheduled_time && !hideTime) meta.push(<span key="t" className="tnum">{formatTime(task.scheduled_time)}</span>);
  if (task.is_recurring) {
    meta.push(
      <span key="r" className={styles.metaRepeat}>
        <Repeat size={11} />
        {describeRecurrence({ recurrence_rule: task.recurrence_rule, recurrence_interval: task.note.recurrence_interval }) ||
          'Repeats'}
      </span>,
    );
  }
  if (parentTitle) meta.push(<span key="p" className={styles.metaParent}>↳ {parentTitle}</span>);

  return (
    <div
      className={`${styles.task} ${task.status === 'done' ? styles.taskDone : ''}`}
      onClick={() => onOpenNote(task.note as unknown as Note)}
    >
      <StatusDot
        status={task.status}
        label={title}
        onChange={(next) => onStatusChange(task.id, next, task.occurrence_id)}
      />
      <div className={styles.taskMain}>
        {/* The whole row opens the note on click; the title is the keyboard target. */}
        <button type="button" className={styles.taskTitle}>
          {title}
        </button>
        {meta.length > 0 && (
          <div className={styles.taskMeta}>{meta}</div>
        )}
      </div>
      {task.is_recurring && task.occurrence_id && onSkip && (
        <button
          type="button"
          className={`${ui.iconBtn} ${ui.iconSm} ${styles.skip}`}
          onClick={(event) => {
            event.stopPropagation();
            onSkip(task.occurrence_id as string);
          }}
          title="Skip this occurrence"
          aria-label={`Skip this occurrence of ${title}`}
        >
          <SkipForward size={13} />
        </button>
      )}
    </div>
  );
};

interface SpanRibbonProps {
  task: TimelineTask;
  style?: React.CSSProperties;
  onOpenNote: (note: Note) => void;
  onStatusChange: StatusChangeHandler;
}

/** A multi-day note drawn as a tinted ribbon (Ongoing row, Active horizons strip). */
export const SpanRibbon: React.FC<SpanRibbonProps> = ({ task, style, onOpenNote, onStatusChange }) => {
  const title = task.note.title || 'Untitled';
  const range = formatDateRange(task.start_date || task.scheduled_date, task.end_date);
  const statusClass =
    task.status === 'done' ? styles.ribbonDone : task.status === 'in_progress' ? styles.ribbonProgress : '';
  return (
    <div
      className={`${styles.ribbon} ${statusClass}`}
      style={style}
      onClick={() => onOpenNote(task.note as unknown as Note)}
      title={`${title} · ${range}`}
    >
      <span className={styles.ribbonLeft}>
        <StatusDot
          small
          status={task.status}
          label={title}
          onChange={(next) => onStatusChange(task.id, next, task.occurrence_id)}
        />
        <button type="button" className={styles.ribbonTitle}>
          {title}
        </button>
      </span>
      <span className={`${styles.ribbonDates} tnum`}>{range}</span>
    </div>
  );
};
