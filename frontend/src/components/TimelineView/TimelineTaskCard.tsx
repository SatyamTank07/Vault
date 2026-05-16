import React from 'react';
import { Repeat, SkipForward } from 'lucide-react';
import styles from './TimelineView.module.css';

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

export interface TimelineTask {
  id: string;
  canvas_id: string;
  canvas_name: string;
  note: {
    id: string;
    title: string;
    content: string;
    created_at: string | null;
    updated_at: string | null;
  };
  scheduled_date: string;
  scheduled_time: string | null;
  status: string;
  is_recurring: boolean;
  occurrence_id: string | null;
  recurrence_rule: string | null;
}

interface TimelineTaskCardProps {
  task: TimelineTask;
  compact?: boolean;
  onOpenNote: (note: any) => void;
  onStatusChange: (taskId: string, newStatus: string, occurrenceId?: string | null) => void;
  onSkip?: (occurrenceId: string) => void;
}

export const TimelineTaskCard: React.FC<TimelineTaskCardProps> = ({
  task,
  compact = false,
  onOpenNote,
  onStatusChange,
  onSkip,
}) => {
  const handleStatusClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextStatus = STATUS_CYCLE[task.status] || 'todo';
    onStatusChange(task.id, nextStatus, task.occurrence_id);
  };

  const handleSkip = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (task.occurrence_id) {
      onSkip?.(task.occurrence_id);
    }
  };

  return (
    <div
      className={`${styles.taskCard} ${compact ? styles.taskCardCompact : ''} ${
        task.status === 'done' ? styles.taskDone : ''
      }`}
      onClick={() => onOpenNote(task.note)}
      title={`${task.note.title} — Click to view`}
    >
      <button
        className={`${styles.taskStatusDot} ${styles[task.status] || styles.todo}`}
        onClick={handleStatusClick}
        title={`Status: ${STATUS_LABELS[task.status] || 'To Do'} (click to cycle)`}
      />
      <div className={styles.taskInfo}>
        <div className={styles.taskTitle}>{task.note.title}</div>
        <div className={styles.taskMeta}>
          <span className={styles.taskCanvasName}>{task.canvas_name}</span>
          <span>·</span>
          {task.scheduled_time && (
            <>
              <span className={styles.taskTime}>{task.scheduled_time}</span>
              <span>·</span>
            </>
          )}
          <span className={styles.taskStatusLabel}>{STATUS_LABELS[task.status] || 'To Do'}</span>
          {task.is_recurring && (
            <>
              <span>·</span>
              <span className={styles.recurringBadge}>
                <Repeat size={11} />
                {RECURRENCE_LABELS[task.recurrence_rule || ''] || 'Recurring'}
              </span>
            </>
          )}
        </div>
      </div>
      {task.is_recurring && task.occurrence_id && (
        <button
          className={styles.skipBtn}
          onClick={handleSkip}
          title="Skip this occurrence"
        >
          <SkipForward size={13} />
        </button>
      )}
    </div>
  );
};

