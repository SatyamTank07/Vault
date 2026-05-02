import React from 'react';
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
  status: string;
}

interface TimelineTaskCardProps {
  task: TimelineTask;
  compact?: boolean;
  onOpenNote: (note: any) => void;
  onStatusChange: (taskId: string, newStatus: string) => void;
}

export const TimelineTaskCard: React.FC<TimelineTaskCardProps> = ({
  task,
  compact = false,
  onOpenNote,
  onStatusChange,
}) => {
  const handleStatusClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextStatus = STATUS_CYCLE[task.status] || 'todo';
    onStatusChange(task.id, nextStatus);
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
          <span className={styles.taskStatusLabel}>{STATUS_LABELS[task.status] || 'To Do'}</span>
        </div>
      </div>
    </div>
  );
};
