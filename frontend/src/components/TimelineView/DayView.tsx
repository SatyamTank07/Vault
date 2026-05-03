import React from 'react';
import { TimelineTaskCard, type TimelineTask } from './TimelineTaskCard';
import styles from './TimelineView.module.css';

interface DayViewProps {
  date: Date;
  tasks: TimelineTask[];
  onOpenNote: (note: any) => void;
  onStatusChange: (taskId: string, newStatus: string, occurrenceId?: string | null) => void;
  onSkip?: (occurrenceId: string) => void;
}

function formatDayHeader(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export const DayView: React.FC<DayViewProps> = ({ date, tasks, onOpenNote, onStatusChange, onSkip }) => {
  // Group tasks by canvas name
  const grouped = tasks.reduce<Record<string, TimelineTask[]>>((acc, task) => {
    const key = task.canvas_name;
    if (!acc[key]) acc[key] = [];
    acc[key].push(task);
    return acc;
  }, {});

  const canvasNames = Object.keys(grouped).sort();

  return (
    <div className={styles.dayView}>
      <div className={styles.dayHeader}>
        {formatDayHeader(date)}
        <span className={styles.dayHeaderSub}>
          {tasks.length} task{tasks.length !== 1 ? 's' : ''}
        </span>
      </div>

      {tasks.length === 0 ? (
        <div className={styles.emptyState}>
          <p>No tasks scheduled for this day.</p>
        </div>
      ) : (
        <div className={styles.dayContent}>
          {canvasNames.map((canvasName) => (
            <div key={canvasName} className={styles.canvasGroup}>
              <div className={styles.canvasGroupTitle}>{canvasName}</div>
              <div className={styles.taskList}>
                {grouped[canvasName].map((task) => (
                  <TimelineTaskCard
                    key={task.id}
                    task={task}
                    onOpenNote={onOpenNote}
                    onStatusChange={onStatusChange}
                    onSkip={onSkip}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
